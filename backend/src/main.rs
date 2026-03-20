use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Multipart, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use dashmap::DashMap;
use futures::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqliteSynchronous},
    Row as SqlxRow,
    SqlitePool,
};
use tokio::sync::{broadcast, mpsc, Mutex};
use tower_http::{cors::CorsLayer, services::ServeDir};
use uuid::Uuid;

// ── Constants ──────────────────────────────────────────────────────────────────

/// In-memory cache per channel (DB holds the full history).
const HISTORY_CACHE:    usize = 200;
const CHANNEL_CAPACITY: usize = 1024;
const MESSAGES_DB:      &str  = "data/chatfc.db";
const MAX_EMOJI_SIZE:   usize = 1024 * 1024; // 1 MB
const MAX_CUSTOM_EMOJIS: usize = 200;
const MAX_FILE_SIZE:    usize = 20 * 1024 * 1024; // 20 MB

/// Anti-spam: max messages per window before muting.
const SPAM_WINDOW_SECS: u64   = 5;
const SPAM_MAX_MSGS:    usize  = 5;
/// Escalating mute durations in seconds (index = violation count - 1, clamped).
const SPAM_MUTES: &[u64] = &[15, 60, 300, 600];

// ── SQLite – init & schema ─────────────────────────────────────────────────────

async fn init_db() -> SqlitePool {
    // Ne pas utiliser `sqlite://data/...` : l’URL interprète `data` comme hôte et ouvre souvent
    // le mauvais fichier (ex. `/chatfc.db` à la racine) → MP / users « vides » ou non persistés.
    let db_path = PathBuf::from(MESSAGES_DB);
    if let Some(parent) = db_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let opts = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(5))
        .statement_cache_capacity(256);

    let pool = SqlitePool::connect_with(opts)
        .await
        .expect("Failed to open SQLite database");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS users (
            username      TEXT PRIMARY KEY,
            salt          TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            token         TEXT NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (unixepoch())
        )"
    ).execute(&pool).await.expect("create users table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS emojis (
            name       TEXT PRIMARY KEY,
            url        TEXT NOT NULL,
            uploader   TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )"
    ).execute(&pool).await.expect("create emojis table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS channels (
            name       TEXT PRIMARY KEY,
            owner      TEXT,
            topic      TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )"
    ).execute(&pool).await.expect("create channels table");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id         TEXT PRIMARY KEY,
            channel    TEXT NOT NULL,
            username   TEXT NOT NULL,
            content    TEXT NOT NULL,
            timestamp  TEXT NOT NULL,
            reactions  TEXT NOT NULL DEFAULT '{}',
            file       TEXT,
            reply_to   TEXT,
            edited     INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )"
    ).execute(&pool).await.expect("create messages table");

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_msg_channel_time ON messages(channel, created_at)"
    ).execute(&pool).await.expect("create index");

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS direct_messages (
            id         TEXT PRIMARY KEY,
            from_user  TEXT NOT NULL,
            to_user    TEXT NOT NULL,
            content    TEXT NOT NULL,
            timestamp  TEXT NOT NULL,
            file       TEXT,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )"
    ).execute(&pool).await.expect("create direct_messages table");

    // Migration: add `file` column for databases created before this column existed.
    let _ = sqlx::query("ALTER TABLE direct_messages ADD COLUMN file TEXT")
        .execute(&pool).await;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_dm_participants ON direct_messages(from_user, to_user, created_at)"
    ).execute(&pool).await.expect("create dm index");

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_dm_participants_rev ON direct_messages(to_user, from_user, created_at)"
    ).execute(&pool).await.expect("create reverse dm index");

    pool
}

// ── Auth types ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct UserRecord {
    salt: String,
    password_hash: String,
    token: String,
}
type UserStore = HashMap<String, UserRecord>;

fn hash_password(salt: &str, password: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes());
    h.update(b":");
    h.update(password.as_bytes());
    hex::encode(h.finalize())
}

// ── SQLite – users ─────────────────────────────────────────────────────────────

async fn db_load_users(pool: &SqlitePool) -> UserStore {
    sqlx::query("SELECT username, salt, password_hash, token FROM users")
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|row| {
            let username: String = row.try_get("username").ok()?;
            Some((username, UserRecord {
                salt:          row.try_get("salt").ok()?,
                password_hash: row.try_get("password_hash").ok()?,
                token:         row.try_get("token").ok()?,
            }))
        })
        .collect()
}

async fn db_upsert_user(pool: &SqlitePool, username: &str, rec: &UserRecord) {
    let _ = sqlx::query(
        "INSERT INTO users (username, salt, password_hash, token)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(username) DO UPDATE SET
             salt=excluded.salt, password_hash=excluded.password_hash, token=excluded.token"
    )
    .bind(username).bind(&rec.salt).bind(&rec.password_hash).bind(&rec.token)
    .execute(pool).await;
}

async fn db_update_token(pool: &SqlitePool, username: &str, token: &str) {
    let _ = sqlx::query("UPDATE users SET token=?1 WHERE username=?2")
        .bind(token).bind(username).execute(pool).await;
}

/// On first startup, migrate old users.json → DB.
async fn migrate_users_json(pool: &SqlitePool) {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(pool).await.unwrap_or(0);
    if count > 0 { return; }

    let Ok(raw) = tokio::fs::read_to_string("data/users.json").await else { return; };
    let Ok(store) = serde_json::from_str::<UserStore>(&raw) else { return; };
    for (username, rec) in &store {
        db_upsert_user(pool, username, rec).await;
    }
    tracing::info!("Migrated {} users from users.json → SQLite", store.len());
}

// ── SQLite – emojis ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
struct CustomEmoji {
    name: String,
    url: String,
    uploader: String,
}

async fn db_load_emojis(pool: &SqlitePool) -> Vec<CustomEmoji> {
    sqlx::query("SELECT name, url, uploader FROM emojis ORDER BY created_at ASC")
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|row| Some(CustomEmoji {
            name:     row.try_get("name").ok()?,
            url:      row.try_get("url").ok()?,
            uploader: row.try_get("uploader").ok()?,
        }))
        .collect()
}

async fn db_save_emoji(pool: &SqlitePool, emoji: &CustomEmoji) {
    let _ = sqlx::query(
        "INSERT OR IGNORE INTO emojis (name, url, uploader) VALUES (?1, ?2, ?3)"
    )
    .bind(&emoji.name).bind(&emoji.url).bind(&emoji.uploader)
    .execute(pool).await;
}

/// On first startup, migrate old emojis.json → DB.
async fn migrate_emojis_json(pool: &SqlitePool) {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM emojis")
        .fetch_one(pool).await.unwrap_or(0);
    if count > 0 { return; }

    let Ok(raw) = tokio::fs::read_to_string("data/emojis.json").await else { return; };
    let Ok(emojis) = serde_json::from_str::<Vec<CustomEmoji>>(&raw) else { return; };
    for e in &emojis {
        db_save_emoji(pool, e).await;
    }
    tracing::info!("Migrated {} emojis from emojis.json → SQLite", emojis.len());
}

// ── SQLite – channels ──────────────────────────────────────────────────────────

async fn db_load_channels(pool: &SqlitePool) -> Vec<(String, Option<String>, String)> {
    sqlx::query("SELECT name, owner, topic FROM channels ORDER BY created_at ASC")
        .fetch_all(pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter_map(|row| Some((
            row.try_get::<String, _>("name").ok()?,
            row.try_get::<Option<String>, _>("owner").ok().flatten(),
            row.try_get::<String, _>("topic").unwrap_or_default(),
        )))
        .collect()
}

async fn db_save_channel(pool: &SqlitePool, name: &str, owner: Option<&str>) {
    let _ = sqlx::query("INSERT OR IGNORE INTO channels (name, owner) VALUES (?1, ?2)")
        .bind(name).bind(owner).execute(pool).await;
}

async fn db_delete_channel(pool: &SqlitePool, name: &str) {
    let _ = sqlx::query("DELETE FROM channels WHERE name=?1").bind(name).execute(pool).await;
    let _ = sqlx::query("DELETE FROM messages WHERE channel=?1").bind(name).execute(pool).await;
}

async fn db_update_topic(pool: &SqlitePool, channel: &str, topic: &str) {
    let _ = sqlx::query("UPDATE channels SET topic=?1 WHERE name=?2")
        .bind(topic).bind(channel).execute(pool).await;
}

// ── SQLite – messages ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FileAttachment { url: String, filename: String, is_image: bool }

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ReplyInfo { id: String, username: String, preview: String }

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ChatMessage {
    id: String,
    username: String,
    content: String,
    timestamp: String,
    reactions: HashMap<String, Vec<String>>,
    file: Option<FileAttachment>,
    reply_to: Option<ReplyInfo>,
    edited: bool,
    #[serde(default = "default_channel")]
    channel: String,
}

fn default_channel() -> String { "general".to_string() }

async fn db_load_messages(pool: &SqlitePool, channel: &str, limit: i64) -> Vec<ChatMessage> {
    let rows = sqlx::query(
        "SELECT id, channel, username, content, timestamp, reactions, file, reply_to, edited
         FROM (
             SELECT *, rowid AS _rowid FROM messages WHERE channel=?1
             ORDER BY created_at DESC, _rowid DESC LIMIT ?2
         ) ORDER BY created_at ASC, _rowid ASC"
    )
    .bind(channel).bind(limit)
    .fetch_all(pool).await.unwrap_or_default();

    rows.into_iter().filter_map(|row| Some(ChatMessage {
        id:        row.try_get("id").ok()?,
        channel:   row.try_get("channel").ok()?,
        username:  row.try_get("username").ok()?,
        content:   row.try_get("content").ok()?,
        timestamp: row.try_get("timestamp").ok()?,
        reactions: serde_json::from_str(
            &row.try_get::<String, _>("reactions").unwrap_or_else(|_| "{}".to_string())
        ).unwrap_or_default(),
        file: row.try_get::<Option<String>, _>("file").ok().flatten()
            .and_then(|s| serde_json::from_str(&s).ok()),
        reply_to: row.try_get::<Option<String>, _>("reply_to").ok().flatten()
            .and_then(|s| serde_json::from_str(&s).ok()),
        edited: row.try_get::<i64, _>("edited").ok().map(|v| v != 0).unwrap_or(false),
    })).collect()
}

async fn db_save_message(pool: &SqlitePool, msg: &ChatMessage) {
    let reactions = serde_json::to_string(&msg.reactions).unwrap_or_else(|_| "{}".to_string());
    let file      = msg.file.as_ref().and_then(|f| serde_json::to_string(f).ok());
    let reply_to  = msg.reply_to.as_ref().and_then(|r| serde_json::to_string(r).ok());
    let _ = sqlx::query(
        "INSERT OR REPLACE INTO messages
             (id, channel, username, content, timestamp, reactions, file, reply_to, edited)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"
    )
    .bind(&msg.id).bind(&msg.channel).bind(&msg.username)
    .bind(&msg.content).bind(&msg.timestamp)
    .bind(reactions).bind(file).bind(reply_to).bind(msg.edited)
    .execute(pool).await;
}

async fn db_update_reactions(pool: &SqlitePool, msg_id: &str, reactions: &HashMap<String, Vec<String>>) {
    let json = serde_json::to_string(reactions).unwrap_or_else(|_| "{}".to_string());
    let _ = sqlx::query("UPDATE messages SET reactions=?1 WHERE id=?2")
        .bind(json).bind(msg_id).execute(pool).await;
}

async fn db_edit_message(pool: &SqlitePool, msg_id: &str, content: &str) {
    let _ = sqlx::query("UPDATE messages SET content=?1, edited=1 WHERE id=?2")
        .bind(content).bind(msg_id).execute(pool).await;
}

async fn db_delete_message(pool: &SqlitePool, msg_id: &str) {
    let _ = sqlx::query("DELETE FROM messages WHERE id=?1")
        .bind(msg_id).execute(pool).await;
}

// ── SQLite – direct messages ───────────────────────────────────────────────────

#[derive(Clone)]
struct DmRecord {
    id:        String,
    from_user: String,
    to_user:   String,
    content:   String,
    timestamp: String,
    file:      Option<String>, // JSON-serialized FileAttachment
}

async fn db_save_dm(pool: &SqlitePool, dm: &DmRecord) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO direct_messages (id, from_user, to_user, content, timestamp, file)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
    )
    .bind(&dm.id).bind(&dm.from_user).bind(&dm.to_user)
    .bind(&dm.content).bind(&dm.timestamp).bind(&dm.file)
    .execute(pool).await?;
    Ok(())
}

/// Load the last `limit` DMs involving `username` (as sender or recipient),
/// returned in chronological order.
async fn db_load_dms(pool: &SqlitePool, username: &str, limit: i64) -> Vec<DmRecord> {
    let result = sqlx::query(
        "SELECT id, from_user, to_user, content, timestamp, file
         FROM (
             SELECT *, rowid AS _rowid FROM direct_messages
             WHERE from_user=?1 OR to_user=?1
             ORDER BY created_at DESC, _rowid DESC
             LIMIT ?2
         ) ORDER BY created_at ASC, _rowid ASC"
    )
    .bind(username).bind(limit)
    .fetch_all(pool).await;
    let rows = match result {
        Ok(r) => r,
        Err(e) => { tracing::error!("db_load_dms QUERY FAILED for {}: {}", username, e); return vec![]; }
    };

    rows.into_iter().filter_map(|row| Some(DmRecord {
        id:        row.try_get("id").ok()?,
        from_user: row.try_get("from_user").ok()?,
        to_user:   row.try_get("to_user").ok()?,
        content:   row.try_get("content").ok()?,
        timestamp: row.try_get("timestamp").ok()?,
        file:      row.try_get("file").ok().flatten(),
    })).collect()
}

/// All DMs between two users, newest-first window then chronological, up to `limit` rows.
async fn db_load_dm_thread(pool: &SqlitePool, user_a: &str, user_b: &str, limit: i64) -> Vec<DmRecord> {
    let rows = sqlx::query(
        "SELECT id, from_user, to_user, content, timestamp, file
         FROM (
             SELECT *, rowid AS _rowid FROM direct_messages
             WHERE (from_user=?1 AND to_user=?2) OR (from_user=?2 AND to_user=?1)
             ORDER BY created_at DESC, _rowid DESC
             LIMIT ?3
         ) ORDER BY created_at ASC, _rowid ASC"
    )
    .bind(user_a).bind(user_b).bind(limit)
    .fetch_all(pool).await.unwrap_or_default();

    rows.into_iter().filter_map(|row| Some(DmRecord {
        id:        row.try_get("id").ok()?,
        from_user: row.try_get("from_user").ok()?,
        to_user:   row.try_get("to_user").ok()?,
        content:   row.try_get("content").ok()?,
        timestamp: row.try_get("timestamp").ok()?,
        file:      row.try_get("file").ok().flatten(),
    })).collect()
}

// ── Channel helpers ────────────────────────────────────────────────────────────

fn sanitize_channel(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .take(24)
        .collect::<String>()
        .to_lowercase()
}

// ── Anti-spam ──────────────────────────────────────────────────────────────────

struct SpamState {
    /// Timestamps of recent messages within the current window.
    timestamps: VecDeque<Instant>,
    /// If set, the user is silenced until this instant.
    muted_until: Option<Instant>,
    /// Total number of times the rate limit was exceeded.
    violations: usize,
}

impl SpamState {
    fn new() -> Self {
        Self { timestamps: VecDeque::new(), muted_until: None, violations: 0 }
    }
}

/// Returns `None` if the message is allowed, or `Some(remaining_secs)` if the user is muted.
async fn check_spam(state: &Arc<AppState>, username: &str) -> Option<u64> {
    let arc = state.spam_tracker
        .entry(username.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(SpamState::new())))
        .clone();

    let mut s = arc.lock().await;
    let now = Instant::now();

    // Still muted from a previous violation?
    if let Some(until) = s.muted_until {
        if now < until {
            return Some((until - now).as_secs() + 1);
        }
        s.muted_until = None;
    }

    // Evict timestamps outside the current window.
    let window = Duration::from_secs(SPAM_WINDOW_SECS);
    s.timestamps.retain(|&t| now.duration_since(t) < window);

    // Over the limit → mute with escalating duration.
    if s.timestamps.len() >= SPAM_MAX_MSGS {
        s.violations += 1;
        let idx      = (s.violations - 1).min(SPAM_MUTES.len() - 1);
        let mute_sec = SPAM_MUTES[idx];
        s.muted_until = Some(now + Duration::from_secs(mute_sec));
        return Some(mute_sec);
    }

    s.timestamps.push_back(now);
    None
}

/// Send an ephemeral warning to the user's own session(s).
fn notify_spam(state: &Arc<AppState>, username: &str, secs: u64) {
    let json = serde_json::to_string(&ServerMsg::System {
        content: format!("⛔ Anti-spam : tu envoies trop vite. Silence pendant {}s.", secs),
    })
    .unwrap_or_default();
    send_to_user(state, username, &json);
}

// ── WebSocket message types ────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Message {
        content: String,
        reply_to: Option<String>,
        #[serde(default = "default_channel")]
        channel: String,
    },
    Reaction { message_id: String, emoji: String },
    FileMessage {
        filename: String,
        url: String,
        is_image: bool,
        #[serde(default)]
        caption: Option<String>,
        #[serde(default = "default_channel")]
        channel: String,
    },
    EditMessage   { message_id: String, content: String },
    DeleteMessage { message_id: String },
    DirectMessage { to: String, content: String, #[serde(default)] file: Option<FileAttachment> },
    SetTopic {
        content: String,
        #[serde(default = "default_channel")]
        channel: String,
    },
    Typing {
        #[serde(default = "default_channel")]
        channel: String,
    },
    SwitchChannel { channel: String },
    /// Refresh DM thread from DB for this session (same idea as SwitchChannel).
    #[serde(rename = "load_dm")]
    LoadDm { partner: String },
    /// Heartbeat from client — ignored, but must parse so we don't drop the message silently.
    #[serde(rename = "ping")]
    Ping,
    CreateChannel { name: String },
    DeleteChannel { name: String },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMsg {
    History      { messages: Vec<ChatMessage>, channel: String },
    Message      { message: ChatMessage },
    System       { content: String },
    Users        { online: Vec<String>, offline: Vec<String> },
    Reaction     { message_id: String, reactions: HashMap<String, Vec<String>> },
    MessageEdited  { message_id: String, content: String },
    MessageDeleted { message_id: String },
    DirectMessage  { id: String, from: String, to: String, content: String, timestamp: String, #[serde(skip_serializing_if = "Option::is_none")] file: Option<FileAttachment> },
    TopicChanged   { content: String, channel: String },
    Typing         { username: String, channel: String },
    ChannelList    { channels: Vec<ChannelInfo> },
    ChannelCreated { name: String },
    ChannelDeleted { name: String },
    EmojiList      { emojis: Vec<CustomEmoji> },
    DmHistory      { dms: Vec<DmHistoryEntry> },
    /// Full thread with one partner — replaces client cache for that partner (like History per channel).
    #[serde(rename = "dm_thread")]
    DmThread       { partner: String, dms: Vec<DmHistoryEntry> },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct DmHistoryEntry {
    id:        String,
    from:      String,
    to:        String,
    content:   String,
    timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file:      Option<FileAttachment>,
}

fn dm_record_to_history_entry(dm: DmRecord) -> DmHistoryEntry {
    let file = dm.file.as_deref()
        .and_then(|s| serde_json::from_str::<FileAttachment>(s).ok());
    DmHistoryEntry {
        id:        dm.id,
        from:      dm.from_user,
        to:        dm.to_user,
        content:   dm.content,
        timestamp: dm.timestamp,
        file,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ChannelInfo {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
}

// ── Shared state ───────────────────────────────────────────────────────────────

struct AppState {
    tx: broadcast::Sender<String>,
    users: DashMap<String, ()>,
    /// Per-channel in-memory cache (last HISTORY_CACHE messages).
    channels: DashMap<String, Arc<Mutex<Vec<ChatMessage>>>>,
    channel_list: Mutex<Vec<String>>,
    /// In-memory user store (source of truth is SQLite).
    auth: Mutex<UserStore>,
    /// session_id → WS sender (one per connection, not per user).
    dm_senders: DashMap<String, mpsc::UnboundedSender<String>>,
    /// username → active session IDs (multi-tab / multi-device).
    user_sessions: DashMap<String, Vec<String>>,
    topics: DashMap<String, String>,
    channel_owners: DashMap<String, String>,
    /// In-memory emoji list (source of truth is SQLite).
    emojis: Mutex<Vec<CustomEmoji>>,
    /// Per-user spam tracking.
    spam_tracker: DashMap<String, Arc<Mutex<SpamState>>>,
    db: SqlitePool,
}

impl AppState {
    async fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let db = init_db().await;

        // One-time JSON → DB migrations (no-op if DB already populated).
        migrate_users_json(&db).await;
        migrate_emojis_json(&db).await;

        let auth   = db_load_users(&db).await;
        let emojis = db_load_emojis(&db).await;

        // Bootstrap #general.
        db_save_channel(&db, "general", None).await;
        let db_channels = db_load_channels(&db).await;

        let topics: DashMap<String, String>        = DashMap::new();
        let channel_owners: DashMap<String, String> = DashMap::new();
        let channels: DashMap<String, Arc<Mutex<Vec<ChatMessage>>>> = DashMap::new();
        let mut channel_names = vec!["general".to_string()];

        for (name, owner, topic) in &db_channels {
            if name != "general" && !channel_names.contains(name) {
                channel_names.push(name.clone());
            }
            if !topic.is_empty() { topics.insert(name.clone(), topic.clone()); }
            if let Some(o) = owner { channel_owners.insert(name.clone(), o.clone()); }
        }

        for name in &channel_names {
            let msgs = db_load_messages(&db, name, HISTORY_CACHE as i64).await;
            channels.insert(name.clone(), Arc::new(Mutex::new(msgs)));
        }

        Arc::new(Self {
            tx,
            users: DashMap::new(),
            channels,
            channel_list: Mutex::new(channel_names),
            auth: Mutex::new(auth),
            dm_senders: DashMap::new(),
            user_sessions: DashMap::new(),
            topics,
            channel_owners,
            emojis: Mutex::new(emojis),
            spam_tracker: DashMap::new(),
            db,
        })
    }

    fn get_channel_arc(&self, channel: &str) -> Option<Arc<Mutex<Vec<ChatMessage>>>> {
        self.channels.get(channel).map(|e| e.value().clone())
    }

    fn channel_infos(&self, names: &[String]) -> Vec<ChannelInfo> {
        names.iter().map(|name| ChannelInfo {
            name: name.clone(),
            owner: self.channel_owners.get(name).map(|e| e.clone()),
        }).collect()
    }
}

// ── Session helpers ────────────────────────────────────────────────────────────

/// Map sanitized input to the exact username key stored in `auth` (case-sensitive store, tolerant lookup).
fn resolve_auth_username(auth: &UserStore, sanitized: &str) -> Option<String> {
    if sanitized.is_empty() {
        return None;
    }
    if auth.contains_key(sanitized) {
        return Some(sanitized.to_string());
    }
    auth.keys().find(|k| k.eq_ignore_ascii_case(sanitized)).cloned()
}

fn send_to_user(state: &Arc<AppState>, username: &str, msg: &str) {
    if let Some(sessions) = state.user_sessions.get(username) {
        for sid in sessions.value().iter() {
            if let Some(tx) = state.dm_senders.get(sid) {
                let _ = tx.send(msg.to_string());
            }
        }
    }
}

// ── Search helper ──────────────────────────────────────────────────────────────

async fn find_message_arc(
    state: &Arc<AppState>,
    message_id: &str,
) -> Option<Arc<Mutex<Vec<ChatMessage>>>> {
    let channels = state.channel_list.lock().await.clone();
    for ch in &channels {
        if let Some(arc) = state.get_channel_arc(ch) {
            if arc.lock().await.iter().any(|m| m.id == message_id) { return Some(arc); }
        }
    }
    None
}

// ── Entry point ────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("chatserver=info".parse().unwrap()),
        )
        .init();

    tokio::fs::create_dir_all("uploads").await.unwrap();
    tokio::fs::create_dir_all("frontend").await.unwrap();
    tokio::fs::create_dir_all("data").await.unwrap();

    let state = AppState::new().await;

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/upload", post(upload_handler))
        .route("/emoji/upload", post(emoji_upload_handler))
        .route("/auth/register", post(register_handler))
        .route("/auth/login", post(login_handler))
        .route("/auth/verify", get(verify_handler))
        .nest_service("/uploads", ServeDir::new("uploads"))
        .nest_service("/", ServeDir::new("frontend"))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("Chat server listening on http://{}", addr);
    println!("╔══════════════════════════╗");
    println!("║  ChatFC → http://{}  ║", addr);
    println!("╚══════════════════════════╝");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ── Auth handlers ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AuthRequest { username: String, password: String }

async fn register_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AuthRequest>,
) -> impl IntoResponse {
    let username: String = req.username.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .take(24).collect();

    if username.is_empty() {
        return (StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid username"}))).into_response();
    }
    if req.password.len() < 4 {
        return (StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "password must be at least 4 characters"}))).into_response();
    }

    let mut auth = state.auth.lock().await;
    if auth.contains_key(&username) {
        return (StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "username already taken"}))).into_response();
    }

    let salt          = Uuid::new_v4().to_string();
    let password_hash = hash_password(&salt, &req.password);
    let token         = Uuid::new_v4().to_string();
    let rec = UserRecord { salt, password_hash, token: token.clone() };

    db_upsert_user(&state.db, &username, &rec).await;
    auth.insert(username.clone(), rec);

    Json(serde_json::json!({"username": username, "token": token})).into_response()
}

async fn login_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AuthRequest>,
) -> impl IntoResponse {
    let mut auth = state.auth.lock().await;

    let record = match auth.get(&req.username) {
        Some(r) => r.clone(),
        None => return (StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid credentials"}))).into_response(),
    };

    if hash_password(&record.salt, &req.password) != record.password_hash {
        return (StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "invalid credentials"}))).into_response();
    }

    let token = Uuid::new_v4().to_string();
    auth.get_mut(&req.username).unwrap().token = token.clone();
    db_update_token(&state.db, &req.username, &token).await;

    Json(serde_json::json!({"username": req.username, "token": token})).into_response()
}

async fn verify_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let token = params.get("token").map(|s| s.as_str()).unwrap_or("");
    let auth = state.auth.lock().await;
    match auth.iter().find(|(_, r)| r.token == token).map(|(u, _)| u.clone()) {
        Some(u) => Json(serde_json::json!({"username": u})).into_response(),
        None    => StatusCode::UNAUTHORIZED.into_response(),
    }
}

// ── WebSocket handler ──────────────────────────────────────────────────────────

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(params): Query<HashMap<String, String>>,
) -> axum::response::Response {
    let token = params.get("token").cloned().unwrap_or_default();
    let username = {
        let auth = state.auth.lock().await;
        auth.iter().find(|(_, r)| r.token == token).map(|(u, _)| u.clone())
    };
    match username {
        Some(u) => ws.on_upgrade(move |socket| handle_socket(socket, state, u)).into_response(),
        None    => (StatusCode::UNAUTHORIZED, "Invalid or missing token").into_response(),
    }
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, username: String) {
    let (mut sender, mut receiver) = socket.split();

    let session_id = Uuid::new_v4().to_string();
    let (dm_tx, mut dm_rx) = mpsc::unbounded_channel::<String>();
    state.dm_senders.insert(session_id.clone(), dm_tx);

    let is_first_session = {
        let mut sessions = state.user_sessions
            .entry(username.clone()).or_insert_with(Vec::new);
        sessions.push(session_id.clone());
        sessions.len() == 1
    };

    if is_first_session { state.users.insert(username.clone(), ()); }

    let mut rx = state.tx.subscribe();

    // 1. Channel list
    {
        let names    = state.channel_list.lock().await.clone();
        let channels = state.channel_infos(&names);
        if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelList { channels }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 2. History for #general
    {
        let messages = if let Some(arc) = state.get_channel_arc("general") {
            arc.lock().await.clone()
        } else {
            Vec::new()
        };
        if let Ok(json) = serde_json::to_string(&ServerMsg::History {
            messages, channel: "general".to_string()
        }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 3. User list
    {
        let online: Vec<String> = { let mut v: Vec<String> = state.users.iter().map(|e| e.key().clone()).collect(); v.sort(); v };
        let offline: Vec<String> = {
            let auth = state.auth.lock().await;
            let set: HashSet<&str> = online.iter().map(|s| s.as_str()).collect();
            let mut v: Vec<String> = auth.keys().filter(|u| !set.contains(u.as_str())).cloned().collect();
            v.sort(); v
        };
        if let Ok(json) = serde_json::to_string(&ServerMsg::Users { online, offline }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 4. Topic for #general
    if let Some(topic) = state.topics.get("general").map(|e| e.clone()) {
        if !topic.is_empty() {
            if let Ok(json) = serde_json::to_string(&ServerMsg::TopicChanged {
                content: topic, channel: "general".to_string(),
            }) { let _ = sender.send(Message::Text(json)).await; }
        }
    }

    // 5. Emoji list
    {
        let emojis = state.emojis.lock().await.clone();
        if let Ok(json) = serde_json::to_string(&ServerMsg::EmojiList { emojis }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 6. DM history — sent as a single batch so the frontend can distinguish
    //    historical DMs from real-time ones (no spurious beeps / unread counts).
    {
        let dms = db_load_dms(&state.db, &username, 300).await;
        tracing::info!("dm_history for {}: {} records", username, dms.len());
        let entries: Vec<DmHistoryEntry> = dms.into_iter().map(dm_record_to_history_entry).collect();
        if let Ok(json) = serde_json::to_string(&ServerMsg::DmHistory { dms: entries }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 7. Announce (first session only)
    if is_first_session {
        broadcast_system(&state, format!("{} joined the chat", username));
        broadcast_users(&state).await;
    }

    // Task: broadcast + DM → client
    // `biased`: always drain session-specific (dm_rx) first so load_dm / switch_channel answers
    // are not delayed behind a busy public broadcast channel (same class of bug as stale history).
    let username_for_send_task = username.clone();
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                dm_msg = dm_rx.recv() => match dm_msg {
                    Some(msg) => { if sender.send(Message::Text(msg)).await.is_err() { break; } }
                    None      => break,
                },
                result = rx.recv() => match result {
                    Ok(msg) => { if sender.send(Message::Text(msg)).await.is_err() { break; } }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::debug!(user = %username_for_send_task, skipped, "broadcast receiver lagged");
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                },
            }
        }
    });

    // Task: client → server
    let state_c  = state.clone();
    let uname_c  = username.clone();
    let session_c = session_id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => handle_client_message(&text, &uname_c, &session_c, &state_c).await,
                Message::Close(_)   => break,
                _                   => {}
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }

    // Cleanup
    state.dm_senders.remove(&session_id);
    let remaining = {
        let mut sessions = state.user_sessions
            .entry(username.clone()).or_insert_with(Vec::new);
        sessions.retain(|s| s != &session_id);
        sessions.len()
    };
    if remaining == 0 {
        state.users.remove(&username);
        state.user_sessions.remove(&username);
        state.spam_tracker.remove(&username);
        broadcast_system(&state, format!("{} left the chat", username));
        broadcast_users(&state).await;
    }
}

async fn handle_client_message(text: &str, username: &str, session_id: &str, state: &Arc<AppState>) {
    let Ok(client_msg) = serde_json::from_str::<ClientMsg>(text) else {
        tracing::debug!(len = text.len(), "ignored non-json or unknown client message");
        return;
    };

    match client_msg {
        ClientMsg::Ping => {}

        // ── Public message ─────────────────────────────────────────
        ClientMsg::Message { content, reply_to, channel } => {
            if content.is_empty() || content.len() > 2000 { return; }

            if let Some(secs) = check_spam(state, username).await {
                notify_spam(state, username, secs); return;
            }

            let channel = sanitize_channel(&channel);
            let channel = if channel.is_empty() { "general".to_string() } else { channel };
            let arc = match state.get_channel_arc(&channel) { Some(a) => a, None => return };

            let reply_info = if let Some(ref rid) = reply_to {
                let chlist = state.channel_list.lock().await.clone();
                let mut found = None;
                'outer: for ch in &chlist {
                    if let Some(ch_arc) = state.get_channel_arc(ch) {
                        let msgs = ch_arc.lock().await;
                        if let Some(m) = msgs.iter().find(|m| &m.id == rid) {
                            found = Some(ReplyInfo {
                                id: m.id.clone(), username: m.username.clone(),
                                preview: m.content.chars().take(120).collect(),
                            });
                            break 'outer;
                        }
                    }
                }
                found
            } else { None };

            let msg = ChatMessage {
                id: Uuid::new_v4().to_string(), username: username.to_string(),
                content, timestamp: chrono::Local::now().format("%H:%M").to_string(),
                reactions: HashMap::new(), file: None, reply_to: reply_info,
                edited: false, channel: channel.clone(),
            };
            let server_msg = ServerMsg::Message { message: msg.clone() };
            { let mut msgs = arc.lock().await; msgs.push(msg.clone()); if msgs.len() > HISTORY_CACHE { msgs.remove(0); } }
            let db = state.db.clone(); let m = msg.clone();
            tokio::spawn(async move { db_save_message(&db, &m).await; });
            if let Ok(json) = serde_json::to_string(&server_msg) { let _ = state.tx.send(json); }
        }

        // ── Reaction ───────────────────────────────────────────────
        ClientMsg::Reaction { message_id, emoji } => {
            if emoji.chars().count() > 8 { return; }
            if let Some(arc) = find_message_arc(state, &message_id).await {
                let reactions_opt = {
                    let mut msgs = arc.lock().await;
                    if let Some(msg) = msgs.iter_mut().find(|m| m.id == message_id) {
                        let users = msg.reactions.entry(emoji).or_default();
                        if let Some(pos) = users.iter().position(|u| u == username) { users.remove(pos); }
                        else if users.len() < 100 { users.push(username.to_string()); }
                        Some(msg.reactions.clone())
                    } else { None }
                };
                if let Some(reactions) = reactions_opt {
                    let db = state.db.clone(); let mid = message_id.clone(); let r = reactions.clone();
                    tokio::spawn(async move { db_update_reactions(&db, &mid, &r).await; });
                    if let Ok(json) = serde_json::to_string(&ServerMsg::Reaction { message_id, reactions }) {
                        let _ = state.tx.send(json);
                    }
                }
            }
        }

        // ── File message ───────────────────────────────────────────
        ClientMsg::FileMessage { filename, url, is_image, caption, channel } => {
            if !url.starts_with("/uploads/") { return; }

            if let Some(secs) = check_spam(state, username).await {
                notify_spam(state, username, secs); return;
            }

            let channel = sanitize_channel(&channel);
            let channel = if channel.is_empty() { "general".to_string() } else { channel };
            let arc = match state.get_channel_arc(&channel) { Some(a) => a, None => return };
            let content = caption.unwrap_or_default().chars().take(500).collect::<String>();
            let msg = ChatMessage {
                id: Uuid::new_v4().to_string(), username: username.to_string(),
                content, timestamp: chrono::Local::now().format("%H:%M").to_string(),
                reactions: HashMap::new(),
                file: Some(FileAttachment { url, filename, is_image }),
                reply_to: None, edited: false, channel: channel.clone(),
            };
            let server_msg = ServerMsg::Message { message: msg.clone() };
            { let mut msgs = arc.lock().await; msgs.push(msg.clone()); if msgs.len() > HISTORY_CACHE { msgs.remove(0); } }
            let db = state.db.clone(); let m = msg.clone();
            tokio::spawn(async move { db_save_message(&db, &m).await; });
            if let Ok(json) = serde_json::to_string(&server_msg) { let _ = state.tx.send(json); }
        }

        // ── Edit (own only) ────────────────────────────────────────
        ClientMsg::EditMessage { message_id, content } => {
            if content.is_empty() || content.len() > 2000 { return; }
            if let Some(arc) = find_message_arc(state, &message_id).await {
                let edited = {
                    let mut msgs = arc.lock().await;
                    if let Some(msg) = msgs.iter_mut().find(|m| m.id == message_id && m.username == username) {
                        msg.content = content.clone(); msg.edited = true; true
                    } else { false }
                };
                if edited {
                    let db = state.db.clone(); let mid = message_id.clone(); let c = content.clone();
                    tokio::spawn(async move { db_edit_message(&db, &mid, &c).await; });
                    if let Ok(json) = serde_json::to_string(&ServerMsg::MessageEdited { message_id, content }) {
                        let _ = state.tx.send(json);
                    }
                }
            }
        }

        // ── Delete (own only) ──────────────────────────────────────
        ClientMsg::DeleteMessage { message_id } => {
            if let Some(arc) = find_message_arc(state, &message_id).await {
                let deleted = {
                    let mut msgs = arc.lock().await;
                    if let Some(pos) = msgs.iter().position(|m| m.id == message_id && m.username == username) {
                        msgs.remove(pos); true
                    } else { false }
                };
                if deleted {
                    let db = state.db.clone(); let mid = message_id.clone();
                    tokio::spawn(async move { db_delete_message(&db, &mid).await; });
                    if let Ok(json) = serde_json::to_string(&ServerMsg::MessageDeleted { message_id }) {
                        let _ = state.tx.send(json);
                    }
                }
            }
        }

        // ── Direct message ─────────────────────────────────────────
        ClientMsg::DirectMessage { to, content, file } => {
            // Require at least some content or a file attachment.
            if content.is_empty() && file.is_none() { return; }
            if content.len() > 2000 { return; }

            if let Some(secs) = check_spam(state, username).await {
                notify_spam(state, username, secs); return;
            }

            let to_clean: String = to.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .take(24).collect();
            let auth = state.auth.lock().await;
            let Some(to_canonical) = resolve_auth_username(&auth, &to_clean) else { return; };
            drop(auth);
            if to_canonical == username { return; }

            let dm_id  = Uuid::new_v4().to_string();
            let ts     = chrono::Local::now().format("%H:%M").to_string();
            let file_json = file.as_ref()
                .and_then(|f| serde_json::to_string(f).ok());
            let record = DmRecord {
                id:        dm_id.clone(),
                from_user: username.to_string(),
                to_user:   to_canonical.clone(),
                content:   content.clone(),
                timestamp: ts.clone(),
                file:      file_json,
            };

            if let Err(e) = db_save_dm(&state.db, &record).await {
                tracing::error!("db_save_dm FAILED for id={}: {}", record.id, e);
                let json = serde_json::to_string(&ServerMsg::System {
                    content: "❌ Impossible d'enregistrer le message privé. Réessaie.".to_string(),
                })
                .unwrap_or_default();
                send_to_user(state, username, &json);
                return;
            }

            let dm_json = match serde_json::to_string(&ServerMsg::DirectMessage {
                id:        dm_id,
                from:      username.to_string(),
                to:        to_canonical.clone(),
                content,
                timestamp: ts,
                file,
            }) { Ok(j) => j, Err(_) => return };

            tracing::info!("db_save_dm OK: id={} from={} to={}", record.id, record.from_user, record.to_user);
            // Deliver to recipient if online (offline users will get it from DB on next connect).
            send_to_user(state, &to_canonical, &dm_json);
            // Echo to all sessions of the sender (other tabs see it too).
            send_to_user(state, username, &dm_json);
        }

        // ── Set topic ──────────────────────────────────────────────
        ClientMsg::SetTopic { content, channel } => {
            let channel = sanitize_channel(&channel);
            let channel = if channel.is_empty() { "general".to_string() } else { channel };
            let content: String = content.chars().take(200).collect();
            state.topics.insert(channel.clone(), content.clone());
            let db = state.db.clone(); let ch = channel.clone(); let t = content.clone();
            tokio::spawn(async move { db_update_topic(&db, &ch, &t).await; });
            broadcast_system(state, format!("{} a changé le sujet de #{} : {}",
                username, channel,
                if content.is_empty() { "(vide)".to_string() } else { content.clone() }));
            if let Ok(json) = serde_json::to_string(&ServerMsg::TopicChanged { content, channel }) {
                let _ = state.tx.send(json);
            }
        }

        // ── Typing ─────────────────────────────────────────────────
        ClientMsg::Typing { channel } => {
            let channel = sanitize_channel(&channel);
            if channel.is_empty() { return; }
            if let Ok(json) = serde_json::to_string(&ServerMsg::Typing {
                username: username.to_string(), channel,
            }) { let _ = state.tx.send(json); }
        }

        // ── Switch channel (history to requesting session only) ────
        ClientMsg::SwitchChannel { channel } => {
            let channel = sanitize_channel(&channel);
            if channel.is_empty() { return; }
            let messages = if let Some(arc) = state.get_channel_arc(&channel) {
                arc.lock().await.clone()
            } else {
                Vec::new()
            };
            let topic = state.topics.get(&channel).map(|e| e.clone()).unwrap_or_default();
            if let Some(tx) = state.dm_senders.get(session_id) {
                if let Ok(json) = serde_json::to_string(&ServerMsg::History {
                    messages, channel: channel.clone()
                }) { let _ = tx.send(json); }
                if let Ok(json) = serde_json::to_string(&ServerMsg::TopicChanged {
                    content: topic, channel,
                }) { let _ = tx.send(json); }
            }
        }

        // ── Load DM thread from DB (to requesting session only) ─────
        ClientMsg::LoadDm { partner } => {
            let partner_clean: String = partner.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .take(24).collect();
            let auth = state.auth.lock().await;
            let Some(partner_canonical) = resolve_auth_username(&auth, &partner_clean) else {
                let json = serde_json::to_string(&ServerMsg::System {
                    content: "❌ Utilisateur introuvable pour les messages privés.".to_string(),
                })
                .unwrap_or_default();
                drop(auth);
                send_to_user(state, username, &json);
                return;
            };
            drop(auth);
            if partner_canonical == username { return; }
            let dms = db_load_dm_thread(&state.db, username, &partner_canonical, 500).await;
            let entries: Vec<DmHistoryEntry> = dms.into_iter().map(dm_record_to_history_entry).collect();
            let Some(tx) = state.dm_senders.get(session_id) else {
                tracing::warn!("load_dm: no dm sender for session {}", session_id);
                return;
            };
            if let Ok(json) = serde_json::to_string(&ServerMsg::DmThread {
                partner: partner_canonical,
                dms: entries,
            }) {
                let _ = tx.send(json);
            }
        }

        // ── Create channel ─────────────────────────────────────────
        ClientMsg::CreateChannel { name } => {
            let name = sanitize_channel(&name);
            if name.is_empty() || name == "general" { return; }
            let mut list = state.channel_list.lock().await;
            if !list.contains(&name) && list.len() < 20 {
                list.push(name.clone());
                state.channels.insert(name.clone(), Arc::new(Mutex::new(Vec::new())));
                state.channel_owners.insert(name.clone(), username.to_string());
                let names    = list.clone(); drop(list);
                let channels = state.channel_infos(&names);
                let db = state.db.clone(); let n = name.clone(); let owner = username.to_string();
                tokio::spawn(async move { db_save_channel(&db, &n, Some(&owner)).await; });
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelCreated { name }) { let _ = state.tx.send(json); }
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelList { channels })  { let _ = state.tx.send(json); }
            }
        }

        // ── Delete channel (owner only) ────────────────────────────
        ClientMsg::DeleteChannel { name } => {
            let name = sanitize_channel(&name);
            if name.is_empty() || name == "general" { return; }
            let is_owner = state.channel_owners.get(&name)
                .map(|o| o.as_str() == username).unwrap_or(false);
            if !is_owner { return; }
            let mut list = state.channel_list.lock().await;
            if list.contains(&name) {
                list.retain(|c| c != &name);
                state.channels.remove(&name);
                state.topics.remove(&name);
                state.channel_owners.remove(&name);
                let names    = list.clone(); drop(list);
                let channels = state.channel_infos(&names);
                let db = state.db.clone(); let n = name.clone();
                tokio::spawn(async move { db_delete_channel(&db, &n).await; });
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelDeleted { name })   { let _ = state.tx.send(json); }
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelList { channels })  { let _ = state.tx.send(json); }
            }
        }
    }
}

// ── Broadcast helpers ──────────────────────────────────────────────────────────

fn broadcast_system(state: &Arc<AppState>, content: String) {
    if let Ok(json) = serde_json::to_string(&ServerMsg::System { content }) {
        let _ = state.tx.send(json);
    }
}

async fn broadcast_users(state: &Arc<AppState>) {
    let online: Vec<String> = { let mut v: Vec<String> = state.users.iter().map(|e| e.key().clone()).collect(); v.sort(); v };
    let offline: Vec<String> = {
        let auth = state.auth.lock().await;
        let set: HashSet<&str> = online.iter().map(|s| s.as_str()).collect();
        let mut v: Vec<String> = auth.keys().filter(|u| !set.contains(u.as_str())).cloned().collect();
        v.sort(); v
    };
    if let Ok(json) = serde_json::to_string(&ServerMsg::Users { online, offline }) {
        let _ = state.tx.send(json);
    }
}

// ── Custom emoji upload ────────────────────────────────────────────────────────

async fn emoji_upload_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HashMap<String, String>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let token    = params.get("token").map(|s| s.as_str()).unwrap_or("");
    let username = {
        let auth = state.auth.lock().await;
        auth.iter().find(|(_, r)| r.token == token).map(|(u, _)| u.clone())
    };
    let username = match username {
        Some(u) => u,
        None => return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "unauthorized"}))).into_response(),
    };

    let mut raw_name   = String::new();
    let mut file_bytes: Vec<u8> = Vec::new();
    let mut file_ext   = String::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or("").to_string().as_str() {
            "name" => { raw_name = field.text().await.unwrap_or_default(); }
            "file" => {
                let fname = field.file_name().map(|f| f.to_string()).unwrap_or_default();
                file_ext  = PathBuf::from(&fname).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                file_bytes = field.bytes().await.unwrap_or_default().to_vec();
            }
            _ => {}
        }
    }

    let name: String = raw_name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .take(32).collect::<String>().to_lowercase();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "nom invalide"}))).into_response();
    }
    if !matches!(file_ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp") {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "format non supporté (jpg/png/gif/webp)"}))).into_response();
    }
    if file_bytes.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "fichier manquant"}))).into_response();
    }
    if file_bytes.len() > MAX_EMOJI_SIZE {
        return (StatusCode::PAYLOAD_TOO_LARGE, Json(serde_json::json!({"error": "fichier trop lourd (max 1 Mo)"}))).into_response();
    }

    {
        let emojis = state.emojis.lock().await;
        if emojis.len() >= MAX_CUSTOM_EMOJIS {
            return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "limite d'emojis atteinte"}))).into_response();
        }
        if emojis.iter().any(|e| e.name == name) {
            return (StatusCode::CONFLICT, Json(serde_json::json!({"error": "ce nom est déjà utilisé"}))).into_response();
        }
    }

    tokio::fs::create_dir_all("uploads/emojis").await.ok();
    let unique = format!("{}_{}.{}", name, &Uuid::new_v4().to_string()[..6], file_ext);
    let path   = format!("uploads/emojis/{}", unique);
    if let Err(e) = tokio::fs::write(&path, &file_bytes).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))).into_response();
    }

    let url   = format!("/uploads/emojis/{}", unique);
    let emoji = CustomEmoji { name: name.clone(), url: url.clone(), uploader: username };

    {
        let mut emojis = state.emojis.lock().await;
        emojis.push(emoji.clone());
        db_save_emoji(&state.db, &emoji).await;
        if let Ok(json) = serde_json::to_string(&ServerMsg::EmojiList { emojis: emojis.clone() }) {
            let _ = state.tx.send(json);
        }
    }

    Json(serde_json::json!({"name": name, "url": url})).into_response()
}

// ── File upload ────────────────────────────────────────────────────────────────

async fn upload_handler(
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    while let Some(field) = multipart.next_field().await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let filename  = field.file_name().map(|f| f.to_string()).unwrap_or_else(|| "file".to_string());
        let safe_name: String = filename.chars()
            .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '_' || *c == '-').collect();
        let safe_name = if safe_name.is_empty() { "file".to_string() } else { safe_name };
        let ext = PathBuf::from(&safe_name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let data = field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        if data.len() > MAX_FILE_SIZE {
            return Err((StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 20 MB)".to_string()));
        }
        let unique_name = format!("{}_{}", &Uuid::new_v4().to_string()[..8], safe_name);
        let path = format!("uploads/{}", unique_name);
        tokio::fs::write(&path, &data).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let is_image = matches!(ext.as_str(), "jpg"|"jpeg"|"png"|"gif"|"webp"|"svg"|"avif");
        return Ok(Json(serde_json::json!({
            "url":      format!("/uploads/{}", unique_name),
            "filename": safe_name,
            "is_image": is_image
        })));
    }
    Err((StatusCode::BAD_REQUEST, "No file in request".to_string()))
}

#[cfg(test)]
mod wire_format_tests {
    use super::{ClientMsg, ServerMsg};

    #[test]
    fn client_parses_load_dm_and_ping() {
        let m: ClientMsg = serde_json::from_str(r#"{"type":"load_dm","partner":"alice"}"#).unwrap();
        assert!(matches!(m, ClientMsg::LoadDm { .. }));
        let p: ClientMsg = serde_json::from_str(r#"{"type":"ping"}"#).unwrap();
        assert!(matches!(p, ClientMsg::Ping));
    }

    #[test]
    fn server_dm_thread_json_tag() {
        let m = ServerMsg::DmThread { partner: "bob".into(), dms: vec![] };
        let s = serde_json::to_string(&m).unwrap();
        assert!(s.contains("\"type\":\"dm_thread\""), "{s}");
        assert!(s.contains("\"partner\":\"bob\""), "{s}");
    }
}
