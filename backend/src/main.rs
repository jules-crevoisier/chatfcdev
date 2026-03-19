use std::{collections::{HashMap, HashSet}, path::PathBuf, sync::Arc};

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
use tokio::sync::{broadcast, mpsc, Mutex};
use tower_http::{cors::CorsLayer, services::ServeDir};
use uuid::Uuid;

const MAX_MESSAGES: usize = 200;
const CHANNEL_CAPACITY: usize = 1024;
const USERS_FILE:  &str = "data/users.json";
const EMOJIS_FILE: &str = "data/emojis.json";
const MAX_EMOJI_SIZE: usize = 1024 * 1024; // 1 MB
const MAX_CUSTOM_EMOJIS: usize = 200;

// ── Auth ──────────────────────────────────────────────────────────────────────

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

async fn load_users() -> UserStore {
    tokio::fs::read_to_string(USERS_FILE)
        .await
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

async fn save_users(store: &UserStore) {
    if let Ok(json) = serde_json::to_string_pretty(store) {
        let _ = tokio::fs::write(USERS_FILE, json).await;
    }
}

// ── Channel helpers ───────────────────────────────────────────────────────────

fn default_channel() -> String { "general".to_string() }

fn sanitize_channel(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-')
        .take(24)
        .collect::<String>()
        .to_lowercase()
}

// ── Chat data types ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
struct CustomEmoji {
    name: String,
    url: String,
    uploader: String,
}

async fn load_emojis() -> Vec<CustomEmoji> {
    tokio::fs::read_to_string(EMOJIS_FILE).await
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

async fn save_emojis(emojis: &[CustomEmoji]) {
    if let Ok(json) = serde_json::to_string_pretty(emojis) {
        let _ = tokio::fs::write(EMOJIS_FILE, json).await;
    }
}

/// Sent as part of ChannelList so the client knows who owns each channel.
#[derive(Serialize, Deserialize, Clone, Debug)]
struct ChannelInfo {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct FileAttachment {
    url: String,
    filename: String,
    is_image: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ReplyInfo {
    id: String,
    username: String,
    preview: String,
}

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

/// Messages the CLIENT sends over WebSocket
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
    EditMessage { message_id: String, content: String },
    DeleteMessage { message_id: String },
    DirectMessage { to: String, content: String },
    SetTopic {
        content: String,
        #[serde(default = "default_channel")]
        channel: String,
    },
    /// Client is typing in a channel
    Typing {
        #[serde(default = "default_channel")]
        channel: String,
    },
    /// Client wants history for a specific channel
    SwitchChannel { channel: String },
    CreateChannel { name: String },
    DeleteChannel { name: String },
}

/// Messages the SERVER sends over WebSocket
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMsg {
    History { messages: Vec<ChatMessage>, channel: String },
    Message { message: ChatMessage },
    System { content: String },
    Users { online: Vec<String>, offline: Vec<String> },
    Reaction { message_id: String, reactions: HashMap<String, Vec<String>> },
    MessageEdited { message_id: String, content: String },
    MessageDeleted { message_id: String },
    DirectMessage { from: String, to: String, content: String },
    TopicChanged { content: String, channel: String },
    Typing { username: String, channel: String },
    ChannelList { channels: Vec<ChannelInfo> },
    ChannelCreated { name: String },
    ChannelDeleted { name: String },
    EmojiList { emojis: Vec<CustomEmoji> },
}

// ── Shared state ──────────────────────────────────────────────────────────────

struct AppState {
    tx: broadcast::Sender<String>,
    users: DashMap<String, ()>,
    /// Per-channel message history (Arc so we can hold outside DashMap lock)
    channels: DashMap<String, Arc<Mutex<Vec<ChatMessage>>>>,
    /// Ordered list of channel names
    channel_list: Mutex<Vec<String>>,
    auth: Mutex<UserStore>,
    dm_senders: DashMap<String, mpsc::UnboundedSender<String>>,
    dm_queue: DashMap<String, Vec<String>>,
    /// Per-channel topics
    topics: DashMap<String, String>,
    /// channel name → username of creator (general has no owner)
    channel_owners: DashMap<String, String>,
    /// server-wide custom emojis
    emojis: Mutex<Vec<CustomEmoji>>,
}

impl AppState {
    async fn new() -> Arc<Self> {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let auth   = load_users().await;
        let emojis = load_emojis().await;
        let channels: DashMap<String, Arc<Mutex<Vec<ChatMessage>>>> = DashMap::new();
        channels.insert("general".to_string(), Arc::new(Mutex::new(Vec::new())));
        Arc::new(Self {
            tx,
            users: DashMap::new(),
            channels,
            channel_list: Mutex::new(vec!["general".to_string()]),
            auth: Mutex::new(auth),
            dm_senders: DashMap::new(),
            dm_queue: DashMap::new(),
            topics: DashMap::new(),
            channel_owners: DashMap::new(),
            emojis: Mutex::new(emojis),
        })
    }

    /// Clone the Arc for a channel's message list.
    /// Releases DashMap shard lock immediately — safe to .await after.
    fn get_channel_arc(&self, channel: &str) -> Option<Arc<Mutex<Vec<ChatMessage>>>> {
        self.channels.get(channel).map(|e| e.value().clone())
    }

    /// Build the ChannelInfo list from the ordered channel list + owners map.
    fn channel_infos(&self, names: &[String]) -> Vec<ChannelInfo> {
        names.iter().map(|name| ChannelInfo {
            name: name.clone(),
            owner: self.channel_owners.get(name).map(|e| e.clone()),
        }).collect()
    }
}

// ── Search helper ─────────────────────────────────────────────────────────────

/// Find a message by ID across all channels; return the channel's Arc if found.
async fn find_message_arc(
    state: &Arc<AppState>,
    message_id: &str,
) -> Option<Arc<Mutex<Vec<ChatMessage>>>> {
    let channels = state.channel_list.lock().await.clone();
    for ch in &channels {
        if let Some(arc) = state.get_channel_arc(ch) {
            let found = { arc.lock().await.iter().any(|m| m.id == message_id) };
            if found { return Some(arc); }
        }
    }
    None
}

// ── Entry point ───────────────────────────────────────────────────────────────

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

// ── Auth handlers ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct AuthRequest {
    username: String,
    password: String,
}

async fn register_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AuthRequest>,
) -> impl IntoResponse {
    let username: String = req
        .username
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .take(24)
        .collect();

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

    let salt = Uuid::new_v4().to_string();
    let password_hash = hash_password(&salt, &req.password);
    let token = Uuid::new_v4().to_string();

    auth.insert(username.clone(), UserRecord { salt, password_hash, token: token.clone() });
    save_users(&auth).await;

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
    save_users(&auth).await;

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
        None     => StatusCode::UNAUTHORIZED.into_response(),
    }
}

// ── WebSocket handler ─────────────────────────────────────────────────────────

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

    state.users.insert(username.clone(), ());

    let (dm_tx, mut dm_rx) = mpsc::unbounded_channel::<String>();
    state.dm_senders.insert(username.clone(), dm_tx);

    let mut rx = state.tx.subscribe();

    // 1. Channel list
    {
        let names = state.channel_list.lock().await.clone();
        let channels = state.channel_infos(&names);
        if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelList { channels }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 2. History for #general
    {
        let messages = if let Some(arc) = state.get_channel_arc("general") {
            arc.lock().await.clone()
        } else { vec![] };
        if let Ok(json) = serde_json::to_string(&ServerMsg::History {
            messages, channel: "general".to_string()
        }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 3. User list (online + offline)
    {
        let online: Vec<String> = {
            let mut v: Vec<String> = state.users.iter().map(|e| e.key().clone()).collect();
            v.sort(); v
        };
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

    // 4. Topic for #general (if any)
    {
        if let Some(topic) = state.topics.get("general").map(|e| e.clone()) {
            if !topic.is_empty() {
                if let Ok(json) = serde_json::to_string(&ServerMsg::TopicChanged {
                    content: topic, channel: "general".to_string(),
                }) {
                    let _ = sender.send(Message::Text(json)).await;
                }
            }
        }
    }

    // 5. Custom emoji list
    {
        let emojis = state.emojis.lock().await.clone();
        if let Ok(json) = serde_json::to_string(&ServerMsg::EmojiList { emojis }) {
            let _ = sender.send(Message::Text(json)).await;
        }
    }

    // 7. Drain offline DM queue
    if let Some((_, queued)) = state.dm_queue.remove(&username) {
        for msg in queued {
            let _ = sender.send(Message::Text(msg)).await;
        }
    }

    // 6. Announce join
    broadcast_system(&state, format!("{} joined the chat", username));
    broadcast_users(&state).await;

    // Task: forward broadcast + DM → client
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                result = rx.recv() => {
                    match result {
                        Ok(msg) => { if sender.send(Message::Text(msg)).await.is_err() { break; } }
                        Err(_)  => break,
                    }
                }
                dm_msg = dm_rx.recv() => {
                    match dm_msg {
                        Some(msg) => { if sender.send(Message::Text(msg)).await.is_err() { break; } }
                        None      => break,
                    }
                }
            }
        }
    });

    // Task: receive from client
    let state_clone    = state.clone();
    let username_clone = username.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => handle_client_message(&text, &username_clone, &state_clone).await,
                Message::Close(_)   => break,
                _                   => {}
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }

    state.users.remove(&username);
    state.dm_senders.remove(&username);
    broadcast_system(&state, format!("{} left the chat", username));
    broadcast_users(&state).await;
}

async fn handle_client_message(text: &str, username: &str, state: &Arc<AppState>) {
    let Ok(client_msg) = serde_json::from_str::<ClientMsg>(text) else { return; };

    match client_msg {
        // ── Public message ────────────────────────────────────────
        ClientMsg::Message { content, reply_to, channel } => {
            if content.is_empty() || content.len() > 2000 { return; }
            let channel = sanitize_channel(&channel);
            let channel = if channel.is_empty() { "general".to_string() } else { channel };
            let arc = match state.get_channel_arc(&channel) { Some(a) => a, None => return };

            // Search across all channels for the reply target
            let reply_info = if let Some(ref rid) = reply_to {
                let channels = state.channel_list.lock().await.clone();
                let mut found = None;
                'outer: for ch in &channels {
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
            {
                let mut msgs = arc.lock().await;
                msgs.push(msg);
                if msgs.len() > MAX_MESSAGES { msgs.remove(0); }
            }
            if let Ok(json) = serde_json::to_string(&server_msg) { let _ = state.tx.send(json); }
        }

        // ── Reaction ──────────────────────────────────────────────
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
                    if let Ok(json) = serde_json::to_string(&ServerMsg::Reaction { message_id, reactions }) {
                        let _ = state.tx.send(json);
                    }
                }
            }
        }

        // ── File message (with optional caption) ──────────────────
        ClientMsg::FileMessage { filename, url, is_image, caption, channel } => {
            if !url.starts_with("/uploads/") { return; }
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
            {
                let mut msgs = arc.lock().await;
                msgs.push(msg);
                if msgs.len() > MAX_MESSAGES { msgs.remove(0); }
            }
            if let Ok(json) = serde_json::to_string(&server_msg) { let _ = state.tx.send(json); }
        }

        // ── Edit (own only) ───────────────────────────────────────
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
                    if let Ok(json) = serde_json::to_string(&ServerMsg::MessageEdited { message_id, content }) {
                        let _ = state.tx.send(json);
                    }
                }
            }
        }

        // ── Delete (own only) ─────────────────────────────────────
        ClientMsg::DeleteMessage { message_id } => {
            if let Some(arc) = find_message_arc(state, &message_id).await {
                let deleted = {
                    let mut msgs = arc.lock().await;
                    if let Some(pos) = msgs.iter().position(|m| m.id == message_id && m.username == username) {
                        msgs.remove(pos); true
                    } else { false }
                };
                if deleted {
                    if let Ok(json) = serde_json::to_string(&ServerMsg::MessageDeleted { message_id }) {
                        let _ = state.tx.send(json);
                    }
                }
            }
        }

        // ── Direct message ────────────────────────────────────────
        ClientMsg::DirectMessage { to, content } => {
            if content.is_empty() || content.len() > 2000 { return; }
            let to_clean: String = to.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .take(24).collect();
            if to_clean.is_empty() || to_clean == username { return; }
            { let auth = state.auth.lock().await; if !auth.contains_key(&to_clean) { return; } }

            let dm_json = match serde_json::to_string(&ServerMsg::DirectMessage {
                from: username.to_string(), to: to_clean.clone(), content,
            }) { Ok(j) => j, Err(_) => return };

            if let Some(tx) = state.dm_senders.get(&to_clean) { let _ = tx.send(dm_json.clone()); }
            else { state.dm_queue.entry(to_clean).or_default().push(dm_json.clone()); }
            if let Some(tx) = state.dm_senders.get(username) { let _ = tx.send(dm_json); }
        }

        // ── Set channel topic ─────────────────────────────────────
        ClientMsg::SetTopic { content, channel } => {
            let channel = sanitize_channel(&channel);
            let channel = if channel.is_empty() { "general".to_string() } else { channel };
            let content: String = content.chars().take(200).collect();
            state.topics.insert(channel.clone(), content.clone());
            broadcast_system(state, format!("{} a changé le sujet de #{} : {}",
                username, channel,
                if content.is_empty() { "(vide)".to_string() } else { content.clone() }));
            if let Ok(json) = serde_json::to_string(&ServerMsg::TopicChanged { content, channel }) {
                let _ = state.tx.send(json);
            }
        }

        // ── Typing indicator (broadcast, not stored) ──────────────
        ClientMsg::Typing { channel } => {
            let channel = sanitize_channel(&channel);
            if channel.is_empty() { return; }
            if let Ok(json) = serde_json::to_string(&ServerMsg::Typing {
                username: username.to_string(), channel,
            }) {
                let _ = state.tx.send(json);
            }
        }

        // ── Switch channel → send history privately ───────────────
        ClientMsg::SwitchChannel { channel } => {
            let channel = sanitize_channel(&channel);
            if channel.is_empty() { return; }
            if let Some(tx) = state.dm_senders.get(username) {
                let messages = if let Some(arc) = state.get_channel_arc(&channel) {
                    arc.lock().await.clone()
                } else { vec![] };
                if let Ok(json) = serde_json::to_string(&ServerMsg::History {
                    messages, channel: channel.clone()
                }) {
                    let _ = tx.send(json);
                }
                // Also send topic for this channel
                let topic = state.topics.get(&channel).map(|e| e.clone()).unwrap_or_default();
                if let Ok(json) = serde_json::to_string(&ServerMsg::TopicChanged {
                    content: topic, channel,
                }) {
                    let _ = tx.send(json);
                }
            }
        }

        // ── Create channel ────────────────────────────────────────
        ClientMsg::CreateChannel { name } => {
            let name = sanitize_channel(&name);
            if name.is_empty() || name == "general" { return; }
            let mut list = state.channel_list.lock().await;
            if !list.contains(&name) && list.len() < 20 {
                list.push(name.clone());
                state.channels.insert(name.clone(), Arc::new(Mutex::new(Vec::new())));
                state.channel_owners.insert(name.clone(), username.to_string());
                let names = list.clone();
                drop(list);
                let channels = state.channel_infos(&names);
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelCreated { name }) {
                    let _ = state.tx.send(json);
                }
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelList { channels }) {
                    let _ = state.tx.send(json);
                }
            }
        }

        // ── Delete channel (owner only, cannot delete general) ───
        ClientMsg::DeleteChannel { name } => {
            let name = sanitize_channel(&name);
            if name.is_empty() || name == "general" { return; }
            // Only the creator may delete their channel
            let is_owner = state.channel_owners
                .get(&name)
                .map(|owner| owner.as_str() == username)
                .unwrap_or(false);
            if !is_owner { return; }
            let mut list = state.channel_list.lock().await;
            if list.contains(&name) {
                list.retain(|c| c != &name);
                state.channels.remove(&name);
                state.topics.remove(&name);
                state.channel_owners.remove(&name);
                let names = list.clone();
                drop(list);
                let channels = state.channel_infos(&names);
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelDeleted { name }) {
                    let _ = state.tx.send(json);
                }
                if let Ok(json) = serde_json::to_string(&ServerMsg::ChannelList { channels }) {
                    let _ = state.tx.send(json);
                }
            }
        }
    }
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

fn broadcast_system(state: &Arc<AppState>, content: String) {
    if let Ok(json) = serde_json::to_string(&ServerMsg::System { content }) {
        let _ = state.tx.send(json);
    }
}

async fn broadcast_users(state: &Arc<AppState>) {
    let online: Vec<String> = {
        let mut v: Vec<String> = state.users.iter().map(|e| e.key().clone()).collect();
        v.sort(); v
    };
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

// ── Custom emoji upload ───────────────────────────────────────────────────────

async fn emoji_upload_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HashMap<String, String>>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    // Authenticate via token query param
    let token = params.get("token").map(|s| s.as_str()).unwrap_or("");
    let username = {
        let auth = state.auth.lock().await;
        auth.iter().find(|(_, r)| r.token == token).map(|(u, _)| u.clone())
    };
    let username = match username {
        Some(u) => u,
        None => return (StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"}))).into_response(),
    };

    let mut raw_name = String::new();
    let mut file_bytes: Vec<u8> = Vec::new();
    let mut file_ext = String::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        match field.name().unwrap_or("").to_string().as_str() {
            "name" => { raw_name = field.text().await.unwrap_or_default(); }
            "file" => {
                let fname = field.file_name().map(|f| f.to_string()).unwrap_or_default();
                file_ext = PathBuf::from(&fname).extension()
                    .and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                file_bytes = field.bytes().await.unwrap_or_default().to_vec();
            }
            _ => {}
        }
    }

    // Validate name
    let name: String = raw_name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .take(32).collect::<String>().to_lowercase();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "nom invalide"}))).into_response();
    }

    // Validate extension
    if !matches!(file_ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "webp") {
        return (StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "format non supporté (jpg/png/gif/webp)"}))).into_response();
    }

    // Validate size
    if file_bytes.is_empty() {
        return (StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "fichier manquant"}))).into_response();
    }
    if file_bytes.len() > MAX_EMOJI_SIZE {
        return (StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({"error": "fichier trop lourd (max 1 Mo)"}))).into_response();
    }

    // Check limits + duplicate names
    {
        let emojis = state.emojis.lock().await;
        if emojis.len() >= MAX_CUSTOM_EMOJIS {
            return (StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "limite d'emojis atteinte"}))).into_response();
        }
        if emojis.iter().any(|e| e.name == name) {
            return (StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "ce nom est déjà utilisé"}))).into_response();
        }
    }

    // Save file
    tokio::fs::create_dir_all("uploads/emojis").await.ok();
    let unique = format!("{}_{}.{}", name, &Uuid::new_v4().to_string()[..6], file_ext);
    let path = format!("uploads/emojis/{}", unique);
    if let Err(e) = tokio::fs::write(&path, &file_bytes).await {
        return (StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()}))).into_response();
    }

    let url   = format!("/uploads/emojis/{}", unique);
    let emoji = CustomEmoji { name: name.clone(), url: url.clone(), uploader: username };

    // Persist + broadcast
    {
        let mut emojis = state.emojis.lock().await;
        emojis.push(emoji);
        save_emojis(&emojis).await;
        if let Ok(json) = serde_json::to_string(&ServerMsg::EmojiList { emojis: emojis.clone() }) {
            let _ = state.tx.send(json);
        }
    }

    Json(serde_json::json!({"name": name, "url": url})).into_response()
}

// ── File upload ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE: usize = 20 * 1024 * 1024; // 20 MB

async fn upload_handler(
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    while let Some(field) = multipart.next_field().await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let filename = field.file_name().map(|f| f.to_string()).unwrap_or_else(|| "file".to_string());
        let safe_name: String = filename.chars()
            .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
            .collect();
        let safe_name = if safe_name.is_empty() { "file".to_string() } else { safe_name };
        let ext = PathBuf::from(&safe_name).extension()
            .and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let data = field.bytes().await.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        if data.len() > MAX_FILE_SIZE {
            return Err((StatusCode::PAYLOAD_TOO_LARGE, "File too large (max 20 MB)".to_string()));
        }
        let unique_name = format!("{}_{}", &Uuid::new_v4().to_string()[..8], safe_name);
        let path = format!("uploads/{}", unique_name);
        tokio::fs::write(&path, &data).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let is_image = matches!(ext.as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "avif");
        return Ok(Json(serde_json::json!({
            "url": format!("/uploads/{}", unique_name),
            "filename": safe_name,
            "is_image": is_image
        })));
    }
    Err((StatusCode::BAD_REQUEST, "No file in request".to_string()))
}
