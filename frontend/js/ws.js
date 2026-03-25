'use strict';

import state from './state.js';
import { loginScreen, chatScreen, messageInput } from './dom.js';
import { send, resolveHost, getServerBackendProtocol } from './helpers.js';
import { handleServer } from './router.js';
import { appendBanner } from './messages.js';
import { restoreView } from './channels.js';
import { openDm } from './dm.js';
import { TOKEN_KEY } from './constants.js';
import { restoreVoiceIfNeeded } from './voice.js';

export const connectWS = (token) => {
  clearTimeout(state.reconnectTimer);
  if (state.ws) { try { state.ws.close(); } catch (_) {} }
  const host  = resolveHost();
  const proto = getServerBackendProtocol() === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${proto}//${host}/ws?token=${encodeURIComponent(token)}`);

  state.ws.onopen = () => {
    state.reconnectDelay = 1000;
    state.intentionalDisc = false;
    loginScreen.style.display = 'none';
    chatScreen.style.display  = 'flex';
    messageInput.focus();
    startHeartbeat();
    if (state.activeDm) {
      send({ type: 'load_dm', partner: state.activeDm });
    } else {
      const dmPartner = restoreView();
      if (dmPartner) openDm(dmPartner);
    }
    // Restore voice session after reload if the user was in a voice call.
    restoreVoiceIfNeeded();
  };
  state.ws.onmessage = e => {
    let data;
    try { data = JSON.parse(e.data); } catch (_) { return; }
    handleServer(data);
  };
  state.ws.onclose = () => {
    stopHeartbeat();
    if (!state.intentionalDisc && chatScreen.style.display !== 'none') scheduleReconnect();
  };
  state.ws.onerror = () => {};
};

const scheduleReconnect = () => {
  appendBanner(`⚠ Disconnected. Reconnecting in ${Math.round(state.reconnectDelay / 1000)}s…`);
  state.reconnectTimer = setTimeout(() => {
    appendBanner('↺ Reconnecting…');
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { state.reconnectDelay = Math.min(state.reconnectDelay * 2, 30000); return; }

    (async () => {
      // If token is expired, stop infinite reconnect loops.
      const host      = resolveHost();
      const httpProto = getServerBackendProtocol();
      try {
        const res = await fetch(`${httpProto}//${host}/auth/verify?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          localStorage.removeItem(TOKEN_KEY);
          state.intentionalDisc = true;
          appendBanner('Session expirée. Reconnecte-toi.');
          loginScreen.style.display = 'flex';
          chatScreen.style.display  = 'none';
          messageInput.value = '';
          return;
        }
      } catch (_) { /* keep going */ }

      connectWS(token);
    })();

    state.reconnectDelay = Math.min(state.reconnectDelay * 2, 30000);
  }, state.reconnectDelay);
};

const startHeartbeat = () => {
  state.heartbeatTimer = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send('{"type":"ping"}');
  }, 25000);
};

const stopHeartbeat = () => {
  clearInterval(state.heartbeatTimer);
};

export const initVisibilityReconnect = () => {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.ws && state.ws.readyState !== WebSocket.OPEN
        && !state.reconnectTimer && chatScreen.style.display !== 'none') {
      state.reconnectDelay = 1000;
      scheduleReconnect();
    }
  });
};
