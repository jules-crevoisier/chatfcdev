'use strict';

import { TOKEN_KEY, VIEW_KEY } from './constants.js';
import state from './state.js';
import {
  loginScreen, chatScreen, usernameInput, passwordInput, connectBtn,
  tabLogin, tabRegister, authError, authForm, messageInput,
  messagesList, logoutBtn, dmPanel, channelTabsEl, typingIndicator,
} from './dom.js';
import { resolveHost, getServerBackendProtocol, isBackendUrlConfigured } from './helpers.js';
import { connectWS } from './ws.js';
import { cancelStaging } from './upload.js';
import { closeSearch } from './search.js';

// ── Auth mode ────────────────────────────────────────────────────
const setAuthMode = (mode) => {
  state.authMode = mode;
  tabLogin.classList.toggle('active', mode === 'login');
  tabRegister.classList.toggle('active', mode === 'register');
  connectBtn.textContent = mode === 'login' ? '[ LOGIN ]' : '[ REGISTER ]';
  hideAuthError();
  passwordInput.focus();
};

const showAuthError = (msg) => { authError.textContent = msg; authError.style.display = 'block'; };
const hideAuthError = ()    => { authError.textContent = ''; authError.style.display = 'none'; };

// ── Submit ───────────────────────────────────────────────────────
const handleAuthSubmit = async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  hideAuthError();
  if (!username) { showAuthError('username required'); usernameInput.focus(); return; }
  if (!password) { showAuthError('password required'); passwordInput.focus(); return; }

  if (!isBackendUrlConfigured()) { showAuthError('Backend URL requise'); return; }
  const host      = resolveHost();
  const httpProto = getServerBackendProtocol();

  connectBtn.disabled = true; connectBtn.textContent = '[ … ]';
  try {
    const res  = await fetch(`${httpProto}//${host}/auth/${state.authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { showAuthError(data.error || 'Authentication failed'); return; }
    state.myUsername = data.username;
    localStorage.setItem(TOKEN_KEY, data.token);
    connectWS(data.token);
  } catch (_) { showAuthError('Connection failed. Is the server running?'); }
  finally {
    connectBtn.disabled = false;
    connectBtn.textContent = state.authMode === 'login' ? '[ LOGIN ]' : '[ REGISTER ]';
  }
};

// ── Auto login ───────────────────────────────────────────────────
export const tryAutoLogin = async () => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  if (!isBackendUrlConfigured()) return;
  const host      = resolveHost();
  const httpProto = getServerBackendProtocol();
  try {
    const res  = await fetch(`${httpProto}//${host}/auth/verify?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error('invalid');
    const data = await res.json();
    state.myUsername = data.username;
    connectWS(token);
  } catch (_) { localStorage.removeItem(TOKEN_KEY); }
};

// ── Logout ───────────────────────────────────────────────────────
const logout = () => {
  state.intentionalDisc = true;
  if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
  clearInterval(state.heartbeatTimer);
  clearTimeout(state.reconnectTimer);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(VIEW_KEY);
  state.myUsername    = '';
  state.customEmojis = new Map();

  state.mentionCount = 0;
  document.getElementById('notification-badge').style.display = 'none';
  document.title = 'ChatFC';

  state.activeDm = null; state.dmConvos = new Map(); state.dmUnread = new Map(); state.dmSeenIds = new Set();
  state.allUsers = { online: [], offline: [] };
  dmPanel.style.display = 'none';

  state.channelMessages = new Map();
  state.channelUnread   = new Map();
  state.channels        = ['general'];
  state.activeChannel   = 'general';
  state.typingState     = new Map();
  typingIndicator.innerHTML = '';
  channelTabsEl.innerHTML   = '';
  document.querySelector('.header-channel').textContent = '#general';

  cancelStaging();
  closeSearch();

  chatScreen.style.display  = 'none';
  loginScreen.style.display = 'flex';
  messagesList.innerHTML    = '';
  usernameInput.value = ''; passwordInput.value = '';
  hideAuthError();
  usernameInput.focus();
};

// ── Init ─────────────────────────────────────────────────────────
export const initAuth = () => {
  tabLogin.addEventListener('click', () => setAuthMode('login'));
  tabRegister.addEventListener('click', () => setAuthMode('register'));

  if (authForm) {
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAuthSubmit();
    });
  }

  usernameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); }
  });

  logoutBtn.addEventListener('click', logout);

  window.addEventListener('chatfc-server-configured', () => {
    // If a token exists (user logged in previously), try auto-login.
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) tryAutoLogin();
  });
};
