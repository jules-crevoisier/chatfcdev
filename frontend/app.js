'use strict';

// ── Config ───────────────────────────────────────────────────────
const SERVER_HOST  = null;   // null = auto-detect from URL
const TENOR_KEY    = 'LIVDSRZULELA';
const TOKEN_KEY    = 'chatfc_token';
const THEME_KEY    = 'chatfc_theme';
const MAX_UPLOAD   = 20 * 1024 * 1024; // 20 MB — must match backend

// ── Reaction emojis ──────────────────────────────────────────────
const EMOJIS = [
  '👍','❤️','😂','😮','😢','👎','🔥','🎉',
  '😎','👀','✅','❌','⚡','🤔','💯','🐛',
  '🙏','💀','🤣','😍','😤','🫡','🫠','🎯',
];

// ── Message emoji categories ─────────────────────────────────────
const EMOJI_CATS = [
  { icon:'😀', name:'Smileys', emojis:[
    '😀','😃','😄','😁','😆','🤣','😂','🙂','🙃','😉','😊','😇',
    '🥰','😍','🤩','😘','😗','😚','😋','😛','😜','🤪','😝','🤑',
    '🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄',
    '😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮',
    '🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐',
    '😕','😟','🙁','☹️','😮','😲','😳','🥺','😦','😨','😰','😥',
    '😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡',
    '😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','🤖',
  ]},
  { icon:'👋', name:'People', emojis:[
    '👋','🤚','🖐️','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙',
    '👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏',
    '🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','👀','👄',
    '🧠','🦷','🦴','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩',
    '🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷',
  ]},
  { icon:'🐶', name:'Animals', emojis:[
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮',
    '🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉',
    '🦇','🐺','🐴','🦄','🐝','🦋','🐛','🐢','🐍','🐙','🦑','🐬',
    '🐳','🦈','🐘','🦒','🐕','🐈','🌲','🌺','🌸','🌼','🌻',
    '🌈','⛄','❄️','🔥','💧','🌊','🌙','⭐','🌟','☀️','⛅',
  ]},
  { icon:'🍕', name:'Food', emojis:[
    '🍎','🍊','🍋','🍇','🍓','🍒','🥝','🍅','🥑','🌽','🥕','🧄',
    '🍕','🍔','🍟','🌭','🍿','🌮','🌯','🥗','🍜','🍝','🍣','🍱',
    '🍙','🍚','🧁','🍰','🎂','🍩','🍪','🍫','🍭','🍦','☕','🍵',
    '🧃','🥤','🍺','🍷','🍸','🍹','🥂','🫖','🧊','🧂',
  ]},
  { icon:'⚽', name:'Activity', emojis:[
    '⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🎯','🎲',
    '🎮','🎰','🧩','🎭','🎨','🎬','🎤','🎧','🎵','🎶','🎸','🎺',
    '🎷','🥁','🎻','🏆','🥇','🥈','🥉','🎉','🎊','🎈','🎁','🎀',
  ]},
  { icon:'🚗', name:'Travel', emojis:[
    '🚗','🚕','🚙','🏎️','🚓','🚑','🚒','🚚','🚜','🏍️','🚲','✈️',
    '🚀','🛸','🚂','🚢','🚁','🏙️','🏖️','🌋','🗺️','🏔️','🏕️',
    '🏠','🏡','🏢','🏰','🗼','🗽','⛪','🌍','🌎','🌏',
  ]},
  { icon:'💡', name:'Objects', emojis:[
    '⌚','📱','💻','⌨️','🖥️','📷','📹','📺','📻','📡','🔋','💡',
    '🔦','🕯️','💰','💳','💎','🔧','🔨','🔑','🔒','📚','📖','✏️',
    '📝','📌','📍','🔭','🔬','💊','🩺','🧲','🪄','🎁','🛍️','💌',
    '🗑️','📦','🧰','🔐','🚪','🪞','🛋️','🧸',
  ]},
  { icon:'❤️', name:'Symbols', emojis:[
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','💕','💞',
    '💓','💗','💖','💘','💝','✅','❌','⭕','🛑','⚠️','💯','♻️',
    '✔️','❗','❓','‼️','💤','✨','🌟','⭐','🔔','🔕','📢','🎵',
    '🏳️','🏴','🚩','🎌','🔱','⚜️','🔰','♾️','©️','®️','™️',
  ]},
];

const CUSTOM_CAT_IDX = EMOJI_CATS.length; // index of the custom emoji tab

const USER_COLORS = [
  '#ff6b6b','#ffd93d','#6bcb77','#4d96ff',
  '#ff922b','#cc5de8','#20c997','#f06595',
  '#74c0fc','#a9e34b','#ffa94d','#da77f2',
];

// ── State ────────────────────────────────────────────────────────
let ws              = null;
let myUsername      = '';
let authMode        = 'login';
let onlineUsers     = [];
let allUsers        = { online: [], offline: [] };
let mentionCount    = 0;
let acIndex         = -1;
let emojiTarget     = null;
let activeMsgEmoji  = false;
let activeGif       = false;
let currentEmojiCat = 0;
let gifDebounce     = null;
let replyingTo      = null;
let reconnectDelay  = 1000;
let reconnectTimer  = null;
let heartbeatTimer  = null;
let intentionalDisc = false;

// DM state
let activeDm = null;
let dmConvos = new Map();
let dmUnread = new Map();

// File staging state
let stagedFile = null;  // { file: File, objectUrl?: string }

// Channel state
let channels        = ['general'];   // known channel names from server
let channelOwners   = new Map();     // channelName -> ownerUsername (null for general)
let activeChannel   = 'general';     // currently viewed channel
let channelMessages = new Map();     // channelName -> ChatMessage[]
let channelUnread   = new Map();     // channelName -> unread count

// Typing indicator state
let typingState    = new Map();  // channelName -> Map<username, timeoutId>
let typingThrottle = 0;          // ms timestamp of last typing event sent

// Custom emoji state
let customEmojis = new Map();    // name -> { name, url, uploader }

// ── DOM refs ─────────────────────────────────────────────────────
const loginScreen    = document.getElementById('login-screen');
const chatScreen     = document.getElementById('chat-screen');
const usernameInput  = document.getElementById('username-input');
const passwordInput  = document.getElementById('password-input');
const connectBtn     = document.getElementById('connect-btn');
const tabLogin       = document.getElementById('tab-login');
const tabRegister    = document.getElementById('tab-register');
const authError      = document.getElementById('auth-error');
const messagesList   = document.getElementById('messages');
const messageInput   = document.getElementById('message-input');
const sendBtn        = document.getElementById('send-btn');
const usersList      = document.getElementById('users-list');
const userCount      = document.getElementById('user-count');
const logoutBtn      = document.getElementById('logout-btn');
const emojiPicker    = document.getElementById('emoji-picker');
const emojiGrid      = document.getElementById('emoji-grid');
const msgEmojiPicker = document.getElementById('msg-emoji-picker');
const emojiSearch    = document.getElementById('emoji-search');
const emojiCatsEl    = document.getElementById('emoji-cats');
const emojiListEl    = document.getElementById('emoji-list');
const emojiMsgBtn    = document.getElementById('emoji-msg-btn');
const gifPicker      = document.getElementById('gif-picker');
const gifSearchEl    = document.getElementById('gif-search');
const gifResultsEl   = document.getElementById('gif-results');
const gifBtn         = document.getElementById('gif-btn');
const notifBadge     = document.getElementById('notification-badge');
const mentionCountEl = document.getElementById('mention-count');
const fileUpload     = document.getElementById('file-upload');
const autocomplete   = document.getElementById('autocomplete');
const lightbox       = document.getElementById('lightbox');
const lightboxImg    = document.getElementById('lightbox-img');
const replyBar       = document.getElementById('reply-bar');
const replyBarText   = document.getElementById('reply-bar-text');
const replyCancel    = document.getElementById('reply-cancel');
const dmPanel        = document.getElementById('dm-panel');
const dmClose        = document.getElementById('dm-close');
const dmTitle        = document.getElementById('dm-title');
const dmStatus       = document.getElementById('dm-status');
const dmMessages     = document.getElementById('dm-messages');
const dmInput        = document.getElementById('dm-input');
const dmSend         = document.getElementById('dm-send');
const searchModal    = document.getElementById('search-modal');
const searchInput    = document.getElementById('search-input');
const searchResults  = document.getElementById('search-results');
const offlineSection = document.getElementById('offline-section');
const offlineList    = document.getElementById('offline-list');
const headerInfo     = document.getElementById('header-info');
const fileStaging    = document.getElementById('file-staging');
const stagingPreview = document.getElementById('staging-preview');
const stagingCaption = document.getElementById('staging-caption');
const stagingSend    = document.getElementById('staging-send');
const stagingCancel  = document.getElementById('staging-cancel');
const channelTabsEl   = document.getElementById('channel-tabs');
const typingIndicator = document.getElementById('typing-indicator');

// ── Theme system ─────────────────────────────────────────────────
function applyTheme(name) {
  document.body.className = name ? `theme-${name}` : '';
  localStorage.setItem(THEME_KEY, name || '');
  document.querySelectorAll('.theme-dot').forEach(dot =>
    dot.classList.toggle('active', dot.dataset.theme === (name || '')));
}

document.querySelectorAll('.theme-dot').forEach(dot =>
  dot.addEventListener('click', () => applyTheme(dot.dataset.theme)));

applyTheme(localStorage.getItem(THEME_KEY) || '');

// ── Reaction emoji grid ──────────────────────────────────────────
EMOJIS.forEach(em => {
  const btn = document.createElement('button');
  btn.className   = 'emoji-btn';
  btn.textContent = em;
  btn.addEventListener('click', () => {
    if (emojiTarget) { sendReaction(emojiTarget, em); hideEmojiPicker(); }
  });
  emojiGrid.appendChild(btn);
});

// ── Close overlays on outside click ─────────────────────────────
document.addEventListener('click', e => {
  if (!emojiPicker.contains(e.target))  hideEmojiPicker();
  if (!msgEmojiPicker.contains(e.target) && e.target !== emojiMsgBtn) closeMsgEmojiPicker();
  if (!gifPicker.contains(e.target)     && e.target !== gifBtn)       closeGifPicker();
  if (!autocomplete.contains(e.target)  && e.target !== messageInput) hideAC();
});

// ── Message emoji picker ─────────────────────────────────────────
function initMsgEmojiPicker() {
  EMOJI_CATS.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className   = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
    btn.textContent = cat.icon;
    btn.title       = cat.name;
    btn.addEventListener('click', () => {
      currentEmojiCat = i;
      emojiCatsEl.querySelectorAll('.emoji-cat-btn').forEach((b, j) =>
        b.classList.toggle('active', j === i));
      renderEmojiList(cat.emojis);
    });
    emojiCatsEl.appendChild(btn);
  });
  // Custom emoji tab
  const customBtn = document.createElement('button');
  customBtn.className = 'emoji-cat-btn';
  customBtn.textContent = '✨';
  customBtn.title = 'Emojis personnalisés';
  customBtn.addEventListener('click', () => {
    currentEmojiCat = CUSTOM_CAT_IDX;
    emojiCatsEl.querySelectorAll('.emoji-cat-btn').forEach((b, j) =>
      b.classList.toggle('active', j === CUSTOM_CAT_IDX));
    renderCustomEmojiList();
  });
  emojiCatsEl.appendChild(customBtn);

  renderEmojiList(EMOJI_CATS[0].emojis);

  emojiSearch.addEventListener('input', () => {
    const q = emojiSearch.value.trim().toLowerCase();
    if (currentEmojiCat === CUSTOM_CAT_IDX) { renderCustomEmojiList(q); return; }
    if (!q) { renderEmojiList(EMOJI_CATS[currentEmojiCat].emojis); return; }
    renderEmojiList(EMOJI_CATS.flatMap(c => c.emojis).slice(0, 80));
  });
}

function renderEmojiList(emojis) {
  emojiListEl.innerHTML = '';
  emojis.forEach(em => {
    const btn = document.createElement('button');
    btn.className   = 'pick-emoji-btn';
    btn.textContent = em;
    btn.addEventListener('click', () => { insertAtCursor(messageInput, em); messageInput.focus(); });
    emojiListEl.appendChild(btn);
  });
}

function renderCustomEmojiList(filter = '') {
  emojiListEl.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-emoji-tab';

  // Grid of existing custom emojis
  const grid = document.createElement('div');
  grid.className = 'custom-emoji-grid';
  const all = [...customEmojis.values()];
  const filtered = filter
    ? all.filter(e => e.name.toLowerCase().includes(filter))
    : all;

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'custom-emoji-empty';
    empty.textContent = filter ? 'Aucun résultat.' : 'Aucun emoji personnalisé — ajoutez-en ci-dessous !';
    grid.appendChild(empty);
  } else {
    filtered.forEach(e => {
      const btn = document.createElement('button');
      btn.className = 'custom-emoji-pick-btn';
      btn.title     = `:${e.name}:`;
      btn.setAttribute('aria-label', `:${e.name}:`);
      const img = document.createElement('img');
      img.src   = serverUrl(e.url);
      img.alt   = `:${e.name}:`;
      img.className = 'custom-emoji-preview';
      btn.appendChild(img);
      btn.addEventListener('click', () => {
        insertAtCursor(messageInput, `:${e.name}:`);
        messageInput.focus();
      });
      grid.appendChild(btn);
    });
  }
  wrapper.appendChild(grid);

  // Upload form (hidden when searching)
  if (!filter) {
    const sep = document.createElement('div');
    sep.className = 'custom-emoji-sep';
    wrapper.appendChild(sep);

    const form = document.createElement('div');
    form.className = 'custom-emoji-form';

    const nameInput = document.createElement('input');
    nameInput.type        = 'text';
    nameInput.placeholder = 'nom (ex: monserveur)';
    nameInput.maxLength   = 32;
    nameInput.className   = 'custom-emoji-name';

    const fileLabel = document.createElement('label');
    fileLabel.className = 'custom-emoji-file-label';
    fileLabel.textContent = 'Choisir image';
    fileLabel.setAttribute('tabindex', '0');
    const fileInput = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/gif,image/webp';
    fileLabel.appendChild(fileInput);

    const uploadBtn = document.createElement('button');
    uploadBtn.className   = 'custom-emoji-upload-btn';
    uploadBtn.textContent = 'Ajouter';

    const status = document.createElement('span');
    status.className = 'custom-emoji-status';

    // Show chosen file name
    fileInput.addEventListener('change', () => {
      fileLabel.dataset.fileName = fileInput.files[0]?.name || 'Choisir image';
      fileLabel.childNodes[0].textContent = fileInput.files[0]?.name || 'Choisir image';
    });

    uploadBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const file = fileInput.files[0];
      if (!name) { status.textContent = 'Entrez un nom.'; return; }
      if (!file)  { status.textContent = 'Choisissez une image.'; return; }
      status.textContent = 'Envoi…';
      uploadBtn.disabled = true;
      const err = await uploadCustomEmoji(name, file);
      uploadBtn.disabled = false;
      if (err) {
        status.textContent = err;
      } else {
        nameInput.value   = '';
        fileInput.value   = '';
        fileLabel.childNodes[0].textContent = 'Choisir image';
        status.textContent = 'Emoji ajouté !';
        setTimeout(() => { status.textContent = ''; }, 3000);
      }
    });

    form.appendChild(nameInput);
    form.appendChild(fileLabel);
    form.appendChild(uploadBtn);
    form.appendChild(status);
    wrapper.appendChild(form);
  }

  emojiListEl.appendChild(wrapper);
}

async function uploadCustomEmoji(name, file) {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    const url   = serverUrl(`/emoji/upload?token=${encodeURIComponent(token)}`);
    const fd    = new FormData();
    fd.append('name', name);
    fd.append('file', file);
    const res  = await fetch(url, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) return data.error || 'Erreur inconnue';
    return null;
  } catch (e) {
    return e.message;
  }
}

emojiMsgBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (activeMsgEmoji) { closeMsgEmojiPicker(); return; }
  closeGifPicker();
  openMsgEmojiPicker();
});

function openMsgEmojiPicker() {
  activeMsgEmoji = true;
  positionAboveInput(msgEmojiPicker, emojiMsgBtn);
  emojiSearch.focus();
}
function closeMsgEmojiPicker() {
  activeMsgEmoji = false;
  msgEmojiPicker.style.display = 'none';
  emojiSearch.value = '';
  if (currentEmojiCat !== CUSTOM_CAT_IDX) {
    renderEmojiList(EMOJI_CATS[currentEmojiCat].emojis);
  }
}

// ── GIF picker (Tenor v1) ────────────────────────────────────────
function initGifPicker() {
  gifSearchEl.addEventListener('input', () => {
    clearTimeout(gifDebounce);
    const q = gifSearchEl.value.trim();
    gifDebounce = setTimeout(() => { if (q) fetchGifs(q); else fetchTrendingGifs(); }, 400);
  });
}

gifBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (activeGif) { closeGifPicker(); return; }
  closeMsgEmojiPicker();
  openGifPicker();
});

function openGifPicker() {
  activeGif = true;
  positionAboveInput(gifPicker, gifBtn);
  gifSearchEl.focus();
  if (gifResultsEl.children.length === 0) fetchTrendingGifs();
}
function closeGifPicker() { activeGif = false; gifPicker.style.display = 'none'; }

async function fetchTrendingGifs() {
  gifResultsEl.innerHTML = '<div class="gif-empty">Loading…</div>';
  try {
    const data = await fetchJson(
      `https://api.tenor.com/v1/trending?key=${encodeURIComponent(TENOR_KEY)}&limit=20&media_filter=minimal&contentfilter=medium`);
    renderGifs(data.results || []);
  } catch (_) { gifResultsEl.innerHTML = '<div class="gif-empty">Could not load GIFs.</div>'; }
}

async function fetchGifs(query) {
  gifResultsEl.innerHTML = '<div class="gif-empty">Searching…</div>';
  try {
    const data = await fetchJson(
      `https://api.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${encodeURIComponent(TENOR_KEY)}&limit=20&media_filter=minimal&contentfilter=medium`);
    renderGifs(data.results || []);
  } catch (_) { gifResultsEl.innerHTML = '<div class="gif-empty">Search failed.</div>'; }
}

function renderGifs(results) {
  gifResultsEl.innerHTML = '';
  if (!results.length) { gifResultsEl.innerHTML = '<div class="gif-empty">No results.</div>'; return; }
  results.forEach(r => {
    const media = r.media && r.media[0]; if (!media) return;
    const small = media.tinygif || media.gif;
    const full  = media.gif || media.tinygif;
    if (!small || !full) return;
    const item = document.createElement('div');
    item.className = 'gif-item';
    const img = document.createElement('img');
    img.src = small.url; img.loading = 'lazy'; img.alt = r.content_description || 'GIF';
    item.appendChild(img);
    item.addEventListener('click', () => {
      send({ type: 'message', content: full.url, reply_to: null, channel: activeChannel });
      closeGifPicker();
    });
    gifResultsEl.appendChild(item);
  });
}

// ── Auth ──────────────────────────────────────────────────────────
tabLogin.addEventListener('click', () => setAuthMode('login'));
tabRegister.addEventListener('click', () => setAuthMode('register'));

function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle('active', mode === 'login');
  tabRegister.classList.toggle('active', mode === 'register');
  connectBtn.textContent = mode === 'login' ? '[ LOGIN ]' : '[ REGISTER ]';
  hideAuthError();
  passwordInput.focus();
}

function showAuthError(msg) { authError.textContent = msg; authError.style.display = 'block'; }
function hideAuthError()    { authError.textContent = ''; authError.style.display = 'none'; }

connectBtn.addEventListener('click', handleAuthSubmit);
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); } });
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuthSubmit(); });

async function handleAuthSubmit() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  hideAuthError();
  if (!username) { showAuthError('username required'); usernameInput.focus(); return; }
  if (!password) { showAuthError('password required'); passwordInput.focus(); return; }

  const host      = resolveHost();
  const httpProto = location.protocol === 'https:' ? 'https:' : 'http:';

  connectBtn.disabled = true; connectBtn.textContent = '[ … ]';
  try {
    const res  = await fetch(`${httpProto}//${host}/auth/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { showAuthError(data.error || 'Authentication failed'); return; }
    myUsername = data.username;
    localStorage.setItem(TOKEN_KEY, data.token);
    connectWS(data.token);
  } catch (_) { showAuthError('Connection failed. Is the server running?'); }
  finally {
    connectBtn.disabled = false;
    connectBtn.textContent = authMode === 'login' ? '[ LOGIN ]' : '[ REGISTER ]';
  }
}

async function tryAutoLogin() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const host      = resolveHost();
  const httpProto = location.protocol === 'https:' ? 'https:' : 'http:';
  try {
    const res  = await fetch(`${httpProto}//${host}/auth/verify?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error('invalid');
    const data = await res.json();
    myUsername = data.username;
    connectWS(token);
  } catch (_) { localStorage.removeItem(TOKEN_KEY); }
}

logoutBtn.addEventListener('click', logout);

function logout() {
  intentionalDisc = true;
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  stopHeartbeat();
  clearTimeout(reconnectTimer);
  localStorage.removeItem(TOKEN_KEY);
  myUsername    = '';
  customEmojis  = new Map();

  // Reset notifications
  mentionCount = 0;
  notifBadge.style.display = 'none';
  document.title = 'ChatFC';

  // Reset DM state
  activeDm = null; dmConvos = new Map(); dmUnread = new Map();
  allUsers = { online: [], offline: [] };
  dmPanel.style.display = 'none';

  // Reset channel state
  channelMessages = new Map();
  channelUnread   = new Map();
  channels        = ['general'];
  activeChannel   = 'general';
  typingState     = new Map();
  typingIndicator.innerHTML = '';
  channelTabsEl.innerHTML   = '';
  document.querySelector('.header-channel').textContent = '#general';

  // Cancel any staged file
  cancelStaging();
  closeSearch();

  chatScreen.style.display  = 'none';
  loginScreen.style.display = 'flex';
  messagesList.innerHTML    = '';
  usernameInput.value = ''; passwordInput.value = '';
  hideAuthError();
  usernameInput.focus();
}

// ── WebSocket connection ──────────────────────────────────────────
function connectWS(token) {
  clearTimeout(reconnectTimer);
  if (ws) { try { ws.close(); } catch (_) {} }
  const host  = resolveHost();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${host}/ws?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    reconnectDelay = 1000; intentionalDisc = false;
    loginScreen.style.display = 'none';
    chatScreen.style.display  = 'flex';
    messageInput.focus();
    startHeartbeat();
  };
  ws.onmessage = e => handleServer(JSON.parse(e.data));
  ws.onclose   = () => {
    stopHeartbeat();
    if (!intentionalDisc && chatScreen.style.display !== 'none') scheduleReconnect();
  };
  ws.onerror = () => {};
}

function scheduleReconnect() {
  appendBanner(`⚠ Disconnected. Reconnecting in ${Math.round(reconnectDelay/1000)}s…`);
  reconnectTimer = setTimeout(() => {
    appendBanner('↺ Reconnecting…');
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) connectWS(token);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }, reconnectDelay);
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
  }, 25000);
}
function stopHeartbeat() { clearInterval(heartbeatTimer); }

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ws && ws.readyState !== WebSocket.OPEN
      && !reconnectTimer && chatScreen.style.display !== 'none') {
    reconnectDelay = 1000;
    scheduleReconnect();
  }
});

// ── WebSocket inbound ────────────────────────────────────────────
function handleServer(msg) {
  switch (msg.type) {
    case 'history':
      // Store all messages grouped by channel
      channelMessages = new Map();
      msg.messages.forEach(m => {
        const ch = m.channel || 'general';
        if (!channelMessages.has(ch)) channelMessages.set(ch, []);
        channelMessages.get(ch).push(m);
      });
      // Render the active channel
      renderChannel(activeChannel);
      scrollToBottom();
      break;
    case 'message':         appendMessage(msg.message, true); break;
    case 'system':          systemMsg(msg.content); break;
    case 'users':           renderUsers(msg.online, msg.offline); break;
    case 'reaction':        applyReactions(msg.message_id, msg.reactions); break;
    case 'message_edited':  applyEdit(msg.message_id, msg.content); break;
    case 'message_deleted': applyDelete(msg.message_id); break;
    case 'direct_message':  handleDmMessage(msg); break;
    case 'topic_changed':   applyTopic(msg.content); break;
    case 'channel_list':    handleChannelList(msg.channels); break;
    case 'typing':          handleTyping(msg); break;
    case 'emoji_list':      handleEmojiList(msg.emojis); break;
  }
}

// ── Channel management ───────────────────────────────────────────
function handleChannelList(newChannels) {
  // newChannels is [{name, owner?}, ...] from the backend
  channels = newChannels.map(ch => (typeof ch === 'string' ? ch : ch.name));
  channelOwners = new Map(newChannels.map(ch =>
    typeof ch === 'string' ? [ch, null] : [ch.name, ch.owner || null]
  ));
  if (!channels.includes(activeChannel)) {
    activeChannel = 'general';
    document.querySelector('.header-channel').textContent = '#general';
    renderChannel('general');
  }
  renderChannelTabs();
}

function handleEmojiList(emojis) {
  customEmojis = new Map((emojis || []).map(e => [e.name, e]));
  // Re-render messages so :name: tokens become images
  renderChannel(activeChannel);
  // Refresh picker tab if open
  if (currentEmojiCat === CUSTOM_CAT_IDX) renderCustomEmojiList();
}

function renderChannelTabs() {
  channelTabsEl.innerHTML = '';

  channels.forEach(ch => {
    const tab = document.createElement('button');
    tab.className = 'ch-tab' + (ch === activeChannel ? ' active' : '');
    tab.dataset.channel = ch;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ch-tab-name';
    nameSpan.textContent = `#${ch}`;
    tab.appendChild(nameSpan);

    // Unread badge
    const unread = channelUnread.get(ch) || 0;
    if (unread > 0 && ch !== activeChannel) {
      const badge = document.createElement('span');
      badge.className = 'ch-tab-unread';
      badge.textContent = unread > 99 ? '99+' : String(unread);
      tab.appendChild(badge);
    }

    // Close button — only for owner of non-general channels
    const isOwner = ch !== 'general' && channelOwners.get(ch) === myUsername;
    if (isOwner) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'ch-tab-close';
      closeBtn.textContent = '✕';
      closeBtn.title = `Supprimer #${ch}`;
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`Supprimer le canal #${ch} et tous ses messages ?`)) {
          send({ type: 'delete_channel', name: ch });
        }
      });
      tab.appendChild(closeBtn);
    }

    tab.addEventListener('click', () => switchChannel(ch));
    channelTabsEl.appendChild(tab);
  });

  // "+" create channel button
  const newBtn = document.createElement('button');
  newBtn.className = 'ch-tab-add';
  newBtn.textContent = '+';
  newBtn.title = 'Nouveau canal';
  newBtn.addEventListener('click', createChannelPrompt);
  channelTabsEl.appendChild(newBtn);
}

function switchChannel(name) {
  if (name === activeChannel) return;
  activeChannel = name;
  channelUnread.set(name, 0);
  renderChannelTabs();
  document.querySelector('.header-channel').textContent = `#${name}`;
  renderChannel(name);
  scrollToBottom();
  updateTypingIndicator();
  messageInput.focus();
}

function renderChannel(channel) {
  // Clear current messages from DOM
  messagesList.querySelectorAll('.message, .reconnect-banner').forEach(el => el.remove());
  const msgs = channelMessages.get(channel) || [];
  msgs.forEach((m, i) => {
    const prev = i > 0 ? msgs[i - 1] : null;
    appendMessageToDOM(m, false, prev);
  });
}

function createChannelPrompt() {
  const raw = prompt('Nom du canal (lettres, chiffres, tirets) :');
  if (!raw) return;
  const name = raw.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
  if (!name) { alert('Nom invalide. Utilisez uniquement lettres, chiffres, tirets.'); return; }
  send({ type: 'create_channel', name });
}

// ── Typing indicator ─────────────────────────────────────────────
function sendTypingEvent() {
  const now = Date.now();
  if (now - typingThrottle < 2000) return;
  typingThrottle = now;
  send({ type: 'typing', channel: activeChannel });
}

function handleTyping(msg) {
  if (msg.username === myUsername) return;
  const ch = msg.channel || 'general';
  if (!typingState.has(ch)) typingState.set(ch, new Map());
  const chTyping = typingState.get(ch);

  // Reset the clear timeout for this user
  if (chTyping.has(msg.username)) clearTimeout(chTyping.get(msg.username));
  const tid = setTimeout(() => {
    chTyping.delete(msg.username);
    if (ch === activeChannel) updateTypingIndicator();
  }, 3000);
  chTyping.set(msg.username, tid);

  if (ch === activeChannel) updateTypingIndicator();
}

function updateTypingIndicator() {
  const chTyping = typingState.get(activeChannel);
  if (!chTyping || chTyping.size === 0) {
    typingIndicator.innerHTML = '';
    return;
  }
  const users = Array.from(chTyping.keys());
  const dots = '<span class="typing-dots"><span></span><span></span><span></span></span>';
  const u = (name) => `<span style="color:var(--cyan);font-style:normal;font-weight:bold">${escHtml(name)}</span>`;
  let text;
  if (users.length === 1)
    text = `${dots}${u(users[0])} est en train d'écrire…`;
  else if (users.length === 2)
    text = `${dots}${u(users[0])} et ${u(users[1])} écrivent…`;
  else
    text = `${dots}Plusieurs personnes écrivent…`;
  typingIndicator.innerHTML = text;
}

// ── Render a message ─────────────────────────────────────────────
function appendMessage(msg, animate) {
  const ch = msg.channel || 'general';

  // Store in channel messages map
  if (!channelMessages.has(ch)) channelMessages.set(ch, []);
  channelMessages.get(ch).push(msg);

  if (ch !== activeChannel) {
    // Increment unread for that tab
    channelUnread.set(ch, (channelUnread.get(ch) || 0) + 1);
    renderChannelTabs();
    return; // Don't render to DOM
  }

  // Find previous message for grouping
  const msgs = channelMessages.get(ch);
  const prev = msgs.length > 1 ? msgs[msgs.length - 2] : null;
  appendMessageToDOM(msg, animate, prev);
  if (animate) scrollToBottom();
}

function appendMessageToDOM(msg, animate, prevMsg) {
  const isMine      = msg.username === myUsername;
  const isMentioned = !isMine && mentionsMe(msg.content);

  if (isMentioned && animate) {
    mentionCount++;
    mentionCountEl.textContent = mentionCount;
    notifBadge.style.display   = 'inline';
    document.title = `(${mentionCount}) ChatFC`;
    playBeep();
  }

  // Determine grouping: same user, same minute, no reply
  const shouldGroup = prevMsg
    && !prevMsg._isSystem
    && prevMsg.username === msg.username
    && prevMsg.timestamp === msg.timestamp
    && !msg.reply_to;

  const row = document.createElement('div');
  row.className  = 'message' + (animate ? ' new' : '') + (shouldGroup ? ' grouped' : '');
  row.dataset.id       = msg.id;
  row.dataset.raw      = msg.content;
  row.dataset.username = msg.username;
  if (isMentioned) row.classList.add('mentioned');

  // ── Body ──────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'msg-body';

  // Reply context
  if (msg.reply_to) {
    const ctx = document.createElement('div');
    ctx.className = 'reply-context';
    ctx.innerHTML = `<span class="reply-ctx-user">↩ ${escHtml(msg.reply_to.username)}</span>`
                  + `<span class="reply-ctx-preview">${escHtml(msg.reply_to.preview.slice(0,80))}</span>`;
    ctx.addEventListener('click', () => {
      const orig = document.querySelector(`[data-id="${msg.reply_to.id}"]`);
      if (orig) orig.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    body.appendChild(ctx);
  }

  // ── Header: username + timestamp + actions ────────────────────
  const header = document.createElement('div');
  header.className = 'msg-header';

  if (!shouldGroup) {
    const uSpan = document.createElement('span');
    uSpan.className = 'msg-username';
    uSpan.textContent = msg.username;
    uSpan.style.color = colorFor(msg.username);
    uSpan.title = 'Click to mention';
    uSpan.addEventListener('click', () => insertMention(msg.username));
    header.appendChild(uSpan);

    const tsSpan = document.createElement('span');
    tsSpan.className   = 'msg-timestamp';
    tsSpan.textContent = msg.timestamp;
    header.appendChild(tsSpan);
  }

  // Build actions container
  const actions = document.createElement('div');

  actions.appendChild(makeActBtn('↩', 'Répondre', '', () => startReply(msg.id, msg.username, msg.content)));

  const reactBtn = document.createElement('button');
  reactBtn.className = 'msg-act';
  reactBtn.title = 'Réagir';
  reactBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9.5" r=".8" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r=".8" fill="currentColor" stroke="none"/></svg>`;
  reactBtn.addEventListener('click', e => { e.stopPropagation(); showEmojiPicker(msg.id, reactBtn); });
  actions.appendChild(reactBtn);

  if (isMine) {
    actions.appendChild(makeActBtn('✎', 'Modifier', '', () => editMessage(row)));
    actions.appendChild(makeActBtn('🗑', 'Supprimer', 'del', () => deleteMessage(msg.id)));
  }

  if (shouldGroup) {
    // Grouped: absolute positioning → completely outside flow, zero layout shift
    actions.className = 'msg-actions msg-actions-abs';
    row.appendChild(actions);
  } else {
    // Non-grouped: inline in header (same height as username/timestamp row, no shift)
    actions.className = 'msg-actions';
    header.appendChild(actions);
  }

  body.appendChild(header);

  // Content text (caption for files, or regular message text)
  const isAutoFilename = msg.file && (
    !msg.content ||
    msg.content === `📎 ${msg.file.filename}` ||
    msg.content === `📄 ${msg.file.filename}`
  );
  if (!isAutoFilename) {
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = formatContent(msg.content);
    if (msg.edited) {
      const tag = document.createElement('span');
      tag.className = 'edited-tag'; tag.textContent = '(edited)';
      content.appendChild(tag);
    }
    body.appendChild(content);
  }

  // File attachment
  if (msg.file) {
    const att = document.createElement('div');
    att.className = 'file-attachment';
    if (msg.file.is_image) {
      const img = document.createElement('img');
      img.src = serverUrl(msg.file.url); img.alt = msg.file.filename;
      img.addEventListener('click', () => openLightbox(serverUrl(msg.file.url)));
      att.appendChild(img);
    } else {
      const link = document.createElement('a');
      link.href = serverUrl(msg.file.url); link.className = 'file-link';
      link.download = msg.file.filename;
      link.textContent = `📄 ${msg.file.filename}`;
      att.appendChild(link);
    }
    body.appendChild(att);
  }

  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'reactions';
  reactionsDiv.id = `r-${msg.id}`;
  renderReactions(reactionsDiv, msg.reactions || {}, msg.id);
  body.appendChild(reactionsDiv);

  row.appendChild(body);
  messagesList.appendChild(row);
}

function makeActBtn(label, title, extraClass, handler) {
  const btn = document.createElement('button');
  btn.className   = `msg-act${extraClass ? ' ' + extraClass : ''}`;
  btn.textContent = label; btn.title = title;
  btn.addEventListener('click', handler);
  return btn;
}

function systemMsg(text) {
  // System messages are scoped to the active channel
  const row = document.createElement('div');
  row.className = 'message system-msg new';
  row._isSystem = true;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'msg-avatar';
  avatarDiv.textContent = '—';

  const body = document.createElement('div');
  body.className = 'msg-body';
  const c = document.createElement('div');
  c.className = 'msg-content';
  c.textContent = `*** ${text}`;
  body.appendChild(c);

  row.appendChild(avatarDiv);
  row.appendChild(body);
  messagesList.appendChild(row);
  scrollToBottom();
}

function appendBanner(text) {
  const div = document.createElement('div');
  div.className = 'reconnect-banner'; div.textContent = text;
  messagesList.appendChild(div); scrollToBottom();
}

// ── Content formatting (Markdown + mentions + URLs) ──────────────
const GIF_HOSTS = /^https?:\/\/(media\.tenor\.com|media1\.tenor\.com|c\.tenor\.com|media\.giphy\.com|i\.giphy\.com)\//i;

function formatContent(raw) {
  const trimmed = raw.trim();
  // Pure GIF URL → show inline
  if (GIF_HOSTS.test(trimmed) && !/\s/.test(trimmed)) {
    const esc = escHtml(trimmed);
    return `<img src="${esc}" class="inline-gif" alt="GIF" onclick="openLightbox('${esc}')">`;
  }

  // 1. Extract fenced code blocks FIRST (before any escaping) to protect their content
  const codeBlocks = [];
  let s = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const escaped = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    codeBlocks.push(escaped);
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });

  // 2. HTML escape the rest
  s = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 3. @mentions
  s = s.replace(/@(\w+)/g, (m, name) => {
    const mine = name.toLowerCase() === myUsername.toLowerCase();
    return `<span class="mention${mine ? ' self-mention' : ''}">${m}</span>`;
  });

  // 4. Inline code (protect before markdown)
  const codeChunks = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codeChunks.push(code);
    return `\x00CODE${codeChunks.length - 1}\x00`;
  });

  // 5. Spoilers ||text||  (Discord-style)
  s = s.replace(/\|\|([^|]+)\|\|/g,
    '<span class="spoiler" tabindex="0" role="button" aria-label="spoiler, click to reveal">$1</span>');

  // 6. Blockquotes  > text  (per line)
  s = s.replace(/^&gt; (.+)$/gm, '<span class="blockquote">$1</span>');

  // 7. Bold / italic / strikethrough / underline
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<u>$1</u>');               // Discord: __ = underline
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<em>$1</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 8. Restore inline code
  s = s.replace(/\x00CODE(\d+)\x00/g, (_, i) =>
    `<code class="inline-code">${escHtml(codeChunks[+i])}</code>`);

  // 9. Restore code blocks
  s = s.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) =>
    `<pre class="code-block">${codeBlocks[+i]}</pre>`);

  // 10. Custom emojis  :name:  (before URL processing)
  s = s.replace(/:([a-z0-9_-]+):/g, (match, ename) => {
    const ce = customEmojis.get(ename);
    if (!ce) return match;
    return `<img src="${escHtml(serverUrl(ce.url))}" class="msg-custom-emoji" alt=":${escHtml(ename)}:" title=":${escHtml(ename)}:" loading="lazy">`;
  });

  // 11. URLs (after markdown so * in URLs isn't mangled)
  s = s.replace(/(https?:\/\/[^\s<>"']+)/g, url => {
    if (GIF_HOSTS.test(url)) return `<img src="${url}" class="inline-gif" alt="GIF" onclick="openLightbox('${url}')">`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  return s;
}

function mentionsMe(content) {
  return new RegExp(`@${myUsername}\\b`, 'i').test(content);
}

// ── Channel topic ─────────────────────────────────────────────────
headerInfo.title = 'Cliquer pour modifier le sujet';

headerInfo.addEventListener('click', () => {
  if (headerInfo.querySelector('input')) return; // already editing
  const current = headerInfo.dataset.topic || '';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'topic-input';
  inp.value = current; inp.maxLength = 200;
  inp.placeholder = 'Sujet du canal… (Enter pour sauvegarder)';
  headerInfo.innerHTML = ''; headerInfo.appendChild(inp);
  inp.focus(); inp.select();

  const save = () => {
    const val = inp.value.trim();
    headerInfo.dataset.topic = val;
    headerInfo.textContent = val || '[ définir un sujet ]';
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: 'set_topic', content: val });
    }
  };
  const cancel = () => {
    headerInfo.textContent = current || '[ définir un sujet ]';
  };

  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); inp.removeEventListener('blur', cancel); save(); }
    if (e.key === 'Escape') { e.preventDefault(); inp.removeEventListener('blur', save); cancel(); }
  });
  inp.addEventListener('blur', save, { once: true });
});

function applyTopic(content) {
  if (headerInfo.querySelector('input')) return;
  headerInfo.dataset.topic = content;
  headerInfo.textContent = content || '[ définir un sujet ]';
}

// ── Reply ────────────────────────────────────────────────────────
replyCancel.addEventListener('click', cancelReply);

function startReply(msgId, username, preview) {
  replyingTo = { id: msgId, username, preview };
  replyBar.style.display = 'flex';
  replyBarText.textContent = `${username}: ${preview.slice(0, 80)}`;
  messageInput.focus();
}
function cancelReply() { replyingTo = null; replyBar.style.display = 'none'; }

// ── Edit & delete ────────────────────────────────────────────────
function editMessage(row) {
  const contentEl = row.querySelector('.msg-content');
  const rawText   = row.dataset.raw || '';
  const savedHTML = contentEl.innerHTML;

  const wrap = document.createElement('div'); wrap.className = 'edit-wrap';
  const inp  = document.createElement('input'); inp.type = 'text'; inp.className = 'edit-input'; inp.value = rawText;
  const okBtn = document.createElement('button'); okBtn.className = 'edit-ok';     okBtn.textContent = '✓';
  const cxBtn = document.createElement('button'); cxBtn.className = 'edit-cancel'; cxBtn.textContent = '✕';
  wrap.appendChild(inp); wrap.appendChild(okBtn); wrap.appendChild(cxBtn);
  contentEl.innerHTML = ''; contentEl.appendChild(wrap);
  inp.focus(); inp.select();

  const confirm = () => {
    const nc = inp.value.trim();
    if (nc && nc !== rawText) send({ type: 'edit_message', message_id: row.dataset.id, content: nc });
    else contentEl.innerHTML = savedHTML;
  };
  const cancel = () => { contentEl.innerHTML = savedHTML; };

  okBtn.addEventListener('click', confirm);
  cxBtn.addEventListener('click', cancel);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

function applyEdit(msgId, content) {
  const row = document.querySelector(`[data-id="${msgId}"]`); if (!row) return;
  row.dataset.raw = content;
  const contentEl = row.querySelector('.msg-content'); if (!contentEl) return;
  contentEl.innerHTML = formatContent(content);
  if (!contentEl.querySelector('.edited-tag')) {
    const tag = document.createElement('span'); tag.className = 'edited-tag'; tag.textContent = '(edited)';
    contentEl.appendChild(tag);
  }
  // Also update in channelMessages store
  for (const msgs of channelMessages.values()) {
    const m = msgs.find(m => m.id === msgId);
    if (m) { m.content = content; m.edited = true; break; }
  }
}

function deleteMessage(msgId) {
  if (!confirm('Supprimer ce message ?')) return;
  send({ type: 'delete_message', message_id: msgId });
}
function applyDelete(msgId) {
  const row = document.querySelector(`[data-id="${msgId}"]`); if (!row) return;
  row.classList.add('deleting');
  setTimeout(() => row.remove(), 260);
  // Remove from channelMessages store
  for (const msgs of channelMessages.values()) {
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx !== -1) { msgs.splice(idx, 1); break; }
  }
}

// ── Users list ───────────────────────────────────────────────────
function renderUsers(online, offline) {
  allUsers = { online, offline };
  onlineUsers = online;
  userCount.textContent = online.length;

  usersList.innerHTML = '';
  online.forEach(u => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span'); nameSpan.textContent = u;
    li.appendChild(nameSpan);
    if (u === myUsername) {
      li.classList.add('self');
    } else {
      const unread = dmUnread.get(u) || 0;
      if (unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'dm-badge'; badge.textContent = unread;
        li.appendChild(badge);
      }
      li.addEventListener('click', () => openDm(u));
    }
    usersList.appendChild(li);
  });

  if (offline.length > 0) {
    offlineSection.style.display = 'block';
    offlineList.innerHTML = '';
    offline.forEach(u => {
      const li = document.createElement('li'); li.textContent = u;
      li.addEventListener('click', () => openDm(u));
      offlineList.appendChild(li);
    });
  } else {
    offlineSection.style.display = 'none';
  }
}

// ── DM (private conversations) ───────────────────────────────────
function openDm(user) {
  activeDm = user;
  dmUnread.set(user, 0);
  dmTitle.textContent = `@${user}`;
  const isOnline = allUsers.online.includes(user);
  dmStatus.textContent = isOnline ? '● online' : '○ offline';
  dmStatus.style.color = isOnline ? 'var(--green)' : 'var(--dim)';
  dmMessages.innerHTML = '';
  (dmConvos.get(user) || []).forEach(m => appendDmMessageEl(m, false));
  dmMessages.scrollTop = dmMessages.scrollHeight;
  dmInput.placeholder = `Message @${user}…`;
  dmPanel.style.display = 'flex';
  dmInput.focus();
  renderUsers(allUsers.online, allUsers.offline);
}

function closeDm() { activeDm = null; dmPanel.style.display = 'none'; messageInput.focus(); }

dmClose.addEventListener('click', closeDm);
dmInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDm(); }
  if (e.key === 'Escape') { e.preventDefault(); closeDm(); }
});
dmSend.addEventListener('click', sendDm);

function sendDm() {
  const content = dmInput.value.trim();
  if (!content || !activeDm || !ws || ws.readyState !== WebSocket.OPEN) return;
  send({ type: 'direct_message', to: activeDm, content });
  dmInput.value = '';
}

function handleDmMessage(msg) {
  const partner = msg.from === myUsername ? msg.to : msg.from;
  const entry   = { from: msg.from, to: msg.to, content: msg.content, ts: now() };
  if (!dmConvos.has(partner)) dmConvos.set(partner, []);
  dmConvos.get(partner).push(entry);
  if (activeDm === partner) {
    appendDmMessageEl(entry, true);
  } else if (msg.from !== myUsername) {
    dmUnread.set(partner, (dmUnread.get(partner) || 0) + 1);
    renderUsers(allUsers.online, allUsers.offline);
    playBeep();
  }
}

function appendDmMessageEl(msg, scroll) {
  const div = document.createElement('div');
  div.className = 'dm-message' + (msg.from === myUsername ? ' dm-mine' : '');
  const u = document.createElement('span'); u.className = 'dm-msg-user';
  u.textContent = `<${msg.from}>`; u.style.color = colorFor(msg.from);
  const c = document.createElement('span'); c.className = 'dm-msg-content'; c.textContent = msg.content;
  const t = document.createElement('span'); t.className = 'dm-msg-ts';      t.textContent = msg.ts;
  div.appendChild(u); div.appendChild(c); div.appendChild(t);
  dmMessages.appendChild(div);
  if (scroll) dmMessages.scrollTop = dmMessages.scrollHeight;
}

// ── Global search (Ctrl+K) ────────────────────────────────────────
function openSearch() {
  searchModal.style.display = 'flex';
  searchInput.value = '';
  updateSearchResults('');
  searchInput.focus();
}
function closeSearch() { searchModal.style.display = 'none'; }

function updateSearchResults(query) {
  searchResults.innerHTML = '';
  const q = query.toLowerCase().trim();

  // Always show channels at the top
  const matchingChannels = channels.filter(ch => !q || `#${ch}`.includes(q));
  matchingChannels.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'search-result';
    const st = document.createElement('span'); st.className = 'search-status';
    st.textContent = '▪'; st.style.color = 'var(--green)';
    const nm = document.createElement('span');
    nm.textContent = `#${ch}`;
    nm.style.color = ch === activeChannel ? 'var(--green)' : 'var(--text2)';
    div.appendChild(st); div.appendChild(nm);
    div.addEventListener('click', () => { closeSearch(); closeDm(); switchChannel(ch); });
    searchResults.appendChild(div);
  });

  // Users
  const all = [...allUsers.online, ...allUsers.offline];
  const filtered = q ? all.filter(u => u.toLowerCase().includes(q)) : all;

  filtered.forEach(u => {
    const div = document.createElement('div'); div.className = 'search-result';
    const isOnline = allUsers.online.includes(u);
    const st = document.createElement('span'); st.className = 'search-status';
    st.textContent = isOnline ? '●' : '○';
    st.style.color = isOnline ? 'var(--green)' : 'var(--dim)';
    const nm = document.createElement('span'); nm.textContent = u;
    nm.style.color = isOnline ? 'var(--cyan)' : 'var(--dim)';
    div.appendChild(st); div.appendChild(nm);
    if (u === myUsername) {
      const you = document.createElement('span');
      you.style.cssText = 'color:var(--dim);font-size:11px'; you.textContent = '(vous)';
      div.appendChild(you);
    } else {
      div.addEventListener('click', () => { closeSearch(); openDm(u); });
    }
    searchResults.appendChild(div);
  });

  if (!searchResults.children.length) {
    const empty = document.createElement('div'); empty.className = 'search-empty';
    empty.textContent = 'Aucun résultat.';
    searchResults.appendChild(empty);
  }
}

searchInput.addEventListener('input', () => updateSearchResults(searchInput.value));
searchModal.addEventListener('click', e => { if (e.target === searchModal) closeSearch(); });
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  if (e.key === 'Enter') {
    const first = searchResults.querySelector('.search-result');
    if (first) first.click();
  }
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (chatScreen.style.display === 'none') return;
    searchModal.style.display !== 'none' ? closeSearch() : openSearch();
  }
});

// ── Reactions ────────────────────────────────────────────────────
function renderReactions(container, reactions, msgId) {
  container.innerHTML = '';
  Object.entries(reactions).forEach(([emoji, users]) => {
    if (!users || users.length === 0) return;
    const btn = document.createElement('button');
    btn.className = `reaction${users.includes(myUsername) ? ' mine' : ''}`;
    btn.title = users.join(', ');
    btn.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
    btn.addEventListener('click', () => sendReaction(msgId, emoji));
    container.appendChild(btn);
  });
}
function applyReactions(msgId, reactions) {
  const c = document.getElementById(`r-${msgId}`);
  if (c) renderReactions(c, reactions, msgId);
}
function sendReaction(msgId, emoji) { send({ type: 'reaction', message_id: msgId, emoji }); }

// ── Reaction emoji picker ─────────────────────────────────────────
function showEmojiPicker(msgId, anchor) {
  emojiTarget = msgId;

  // Make visible off-screen first so we can read real dimensions
  emojiPicker.style.top    = '-9999px';
  emojiPicker.style.left   = '-9999px';
  emojiPicker.style.display = 'block';

  const pw   = emojiPicker.offsetWidth;
  const ph   = emojiPicker.offsetHeight;
  const rect = anchor.getBoundingClientRect();
  const pad  = 6;

  // Prefer opening above the anchor
  let top  = rect.top - ph - pad;
  let left = rect.left;

  // If goes above viewport → open below
  if (top < pad) top = rect.bottom + pad;

  // If still overflows bottom → clamp
  if (top + ph > window.innerHeight - pad) top = window.innerHeight - ph - pad;

  // Clamp horizontal so picker never goes off left or right
  if (left + pw > window.innerWidth - pad) left = window.innerWidth - pw - pad;
  if (left < pad) left = pad;

  emojiPicker.style.top  = `${top}px`;
  emojiPicker.style.left = `${left}px`;
}
function hideEmojiPicker() { emojiPicker.style.display = 'none'; emojiTarget = null; }

// ── File staging area ─────────────────────────────────────────────
stagingCancel.addEventListener('click', cancelStaging);
stagingSend.addEventListener('click', sendStagedFile);
stagingCaption.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); sendStagedFile(); }
  if (e.key === 'Escape') { e.preventDefault(); cancelStaging(); }
});

function stageFile(file) {
  if (file.size > MAX_UPLOAD) {
    systemMsg(`❌ Fichier trop lourd : ${file.name} (${formatSize(file.size)} — max 20 Mo)`);
    return;
  }

  cancelStaging();
  stagedFile = { file };

  stagingPreview.innerHTML = '';
  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.className = 'staging-img';
    img.src = URL.createObjectURL(file);
    stagedFile.objectUrl = img.src;
    stagingPreview.appendChild(img);
  } else {
    const info = document.createElement('div');
    info.className = 'staging-file-info';
    info.innerHTML = `<span style="font-size:18px">📄</span>
      <span>${escHtml(file.name)}</span>
      <span class="staging-size">${formatSize(file.size)}</span>`;
    stagingPreview.appendChild(info);
  }

  fileStaging.style.display = 'flex';
  stagingCaption.value = '';
  stagingCaption.focus();
}

function cancelStaging() {
  if (stagedFile && stagedFile.objectUrl) URL.revokeObjectURL(stagedFile.objectUrl);
  stagedFile = null;
  fileStaging.style.display = 'none';
  stagingPreview.innerHTML  = '';
}

async function sendStagedFile() {
  if (!stagedFile) return;
  const caption = stagingCaption.value.trim();
  const file    = stagedFile.file;
  cancelStaging();
  await uploadFile(file, caption);
}

// ── Send message ─────────────────────────────────────────────────
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (autocomplete.style.display !== 'none') confirmAC();
    else sendMessage();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    if (autocomplete.style.display !== 'none') confirmAC();
  } else if (e.key === 'ArrowUp'   && autocomplete.style.display !== 'none') { e.preventDefault(); moveAC(-1); }
    else if (e.key === 'ArrowDown' && autocomplete.style.display !== 'none') { e.preventDefault(); moveAC(1); }
    else if (e.key === 'Escape') { hideAC(); cancelReply(); }
});

messageInput.addEventListener('focus', clearMentions);

function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;
  send({ type: 'message', content, reply_to: replyingTo ? replyingTo.id : null, channel: activeChannel });
  messageInput.value = '';
  cancelReply(); hideAC(); clearMentions();
}

// ── @ Autocomplete ────────────────────────────────────────────────
function updateAC() {
  const val = messageInput.value, cursor = messageInput.selectionStart;
  const match = val.slice(0, cursor).match(/@(\w*)$/);
  if (!match) { hideAC(); return; }
  const query   = match[1].toLowerCase();
  const matches = onlineUsers.filter(u => u.toLowerCase().startsWith(query) && u !== myUsername);
  if (!matches.length) { hideAC(); return; }

  autocomplete.innerHTML = ''; acIndex = -1;
  matches.forEach((u, i) => {
    const div = document.createElement('div');
    div.className = 'ac-item'; div.textContent = `@${u}`;
    div.addEventListener('mousedown', e => { e.preventDefault(); acIndex = i; confirmAC(); });
    autocomplete.appendChild(div);
  });

  const rect = messageInput.getBoundingClientRect();
  autocomplete.style.display = 'block';
  autocomplete.style.left    = `${rect.left}px`;
  autocomplete.style.width   = `${rect.width}px`;
  autocomplete.style.bottom  = `${window.innerHeight - rect.top + 4}px`;
  autocomplete.style.top     = 'auto';
}

messageInput.addEventListener('input', () => { updateAC(); sendTypingEvent(); });

function moveAC(dir) {
  const items = autocomplete.querySelectorAll('.ac-item');
  acIndex = (acIndex + dir + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('selected', i === acIndex));
}
function confirmAC() {
  const items = autocomplete.querySelectorAll('.ac-item');
  const idx = acIndex >= 0 ? acIndex : 0;
  if (!items[idx]) return;
  replaceAtWord(items[idx].textContent.slice(1));
  hideAC();
}
function hideAC() { autocomplete.style.display = 'none'; acIndex = -1; }
function replaceAtWord(user) {
  const val = messageInput.value, cursor = messageInput.selectionStart;
  const before = val.slice(0, cursor).replace(/@(\w*)$/, `@${user} `);
  messageInput.value = before + val.slice(cursor);
  messageInput.selectionStart = messageInput.selectionEnd = before.length;
}
function insertMention(username) { messageInput.value += `@${username} `; messageInput.focus(); }

// ── File upload ──────────────────────────────────────────────────
fileUpload.addEventListener('change', e => {
  const files = Array.from(e.target.files);
  fileUpload.value = '';
  if (files.length === 0) return;
  if (files.length === 1) {
    stageFile(files[0]);
  } else {
    files.forEach(f => {
      if (f.size > MAX_UPLOAD) { systemMsg(`❌ ${f.name} trop lourd (max 20 Mo)`); return; }
      uploadFile(f, '');
    });
  }
});

async function uploadFile(file, caption) {
  const placeholder = appendUploadPlaceholder(file.name);
  const fd = new FormData(); fd.append('file', file);
  try {
    const host      = resolveHost();
    const httpProto = location.protocol === 'https:' ? 'https:' : 'http:';
    const res = await fetch(`${httpProto}//${host}/upload`, { method: 'POST', body: fd });
    if (res.status === 413) throw new Error('Fichier trop lourd (max 20 Mo)');
    if (!res.ok)            throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    placeholder.remove();
    send({ type: 'file_message', filename: data.filename, url: data.url,
           is_image: data.is_image, caption: caption || undefined,
           channel: activeChannel });
  } catch (err) {
    placeholder.remove();
    systemMsg(`⚠ Upload échoué : ${err.message}`);
  }
}

function appendUploadPlaceholder(name) {
  const p = document.createElement('div');
  p.className = 'message system-msg';
  p.innerHTML = `<div class="msg-avatar"></div><div class="msg-body"><div class="msg-content upload-progress">⏳ Envoi de ${escHtml(name)}…</div></div>`;
  messagesList.appendChild(p); scrollToBottom();
  return p;
}

// ── Drag & drop ──────────────────────────────────────────────────
function handleDrop(e) {
  e.preventDefault();
  messagesList.classList.remove('dragging');
  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;
  if (files.length === 1) { stageFile(files[0]); }
  else { files.forEach(f => { if (f.size > MAX_UPLOAD) { systemMsg(`❌ ${f.name} trop lourd`); return; } uploadFile(f, ''); }); }
}

// ── Lightbox ─────────────────────────────────────────────────────
function openLightbox(url) { lightboxImg.src = url; lightbox.style.display = 'flex'; }
function closeLightbox()   { lightbox.style.display = 'none'; }

// ── Notifications ─────────────────────────────────────────────────
notifBadge.addEventListener('click', () => {
  clearMentions();
  const first = messagesList.querySelector('.mentioned');
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
function clearMentions() {
  if (!mentionCount) return;
  mentionCount = 0; notifBadge.style.display = 'none'; document.title = 'ChatFC';
}

// ── Picker positioning ────────────────────────────────────────────
function positionAboveInput(popup, anchor) {
  const ar   = anchor.getBoundingClientRect();
  const maxH = Math.max(100, ar.top - 8);
  popup.style.maxHeight = `${maxH}px`;
  popup.style.top       = 'auto';
  popup.style.bottom    = `${window.innerHeight - ar.top + 6}px`;
  popup.style.display   = 'flex';
  const w    = popup.offsetWidth || 340;
  let   left = Math.min(ar.left, window.innerWidth - w - 6);
  if (left < 6) left = 6;
  popup.style.left = `${left}px`;
}

// ── Helpers ──────────────────────────────────────────────────────
function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

function resolveHost() {
  return SERVER_HOST || (location.host && location.protocol !== 'file:' ? location.host : 'localhost:3000');
}
function serverUrl(path) {
  if (location.protocol !== 'file:' && !SERVER_HOST) return path;
  return `http://${resolveHost()}${path}`;
}
function insertAtCursor(input, text) {
  const s = input.selectionStart, e = input.selectionEnd;
  input.value = input.value.slice(0, s) + text + input.value.slice(e);
  input.selectionStart = input.selectionEnd = s + text.length;
}
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function scrollToBottom() { messagesList.scrollTop = messagesList.scrollHeight; }
function now()  { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function pad(n) { return String(n).padStart(2, '0'); }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function colorFor(name) {
  let h = 0;
  for (const c of name) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

function formatSize(bytes) {
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)     return `${(bytes/1024).toFixed(1)} Ko`;
  return `${(bytes/(1024*1024)).toFixed(1)} Mo`;
}

function playBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25);
  } catch (_) {}
}

// ── Spoiler reveal (delegated, works for dynamically added messages) ──
messagesList.addEventListener('click', e => {
  const sp = e.target.closest('.spoiler');
  if (sp) sp.classList.toggle('revealed');
});
messagesList.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    const sp = e.target.closest('.spoiler');
    if (sp) { e.preventDefault(); sp.classList.toggle('revealed'); }
  }
});

// ── Init ─────────────────────────────────────────────────────────
initMsgEmojiPicker();
initGifPicker();
tryAutoLogin();
