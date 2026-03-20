'use strict';

import { VIEW_KEY } from './constants.js';
import state from './state.js';
import { channelTabsEl, messageInput, typingIndicator, headerInfo } from './dom.js';
import { send, escHtml, scrollToBottom } from './helpers.js';
import { renderChannel, cancelReply } from './messages.js';

// ── View persistence ─────────────────────────────────────────────
export const saveView = () => {
  localStorage.setItem(VIEW_KEY, JSON.stringify({
    channel: state.activeChannel,
    dm: state.activeDm,
  }));
};

export const restoreView = () => {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return;
    const view = JSON.parse(raw);
    if (view.dm) {
      if (view.channel && view.channel !== state.activeChannel) {
        state.activeChannel = view.channel;
        document.querySelector('.header-channel').textContent = `#${view.channel}`;
        send({ type: 'switch_channel', channel: view.channel });
      }
      // openDm is called from ws.js after import to avoid circular
      return view.dm;
    } else if (view.channel && view.channel !== 'general') {
      switchChannel(view.channel);
    }
  } catch (_) {}
  return null;
};

// ── Channel list ─────────────────────────────────────────────────
export const handleChannelList = (newChannels) => {
  const list = Array.isArray(newChannels) ? newChannels : [];
  state.channels = list.map(ch => (typeof ch === 'string' ? ch : ch.name));
  state.channelOwners = new Map(list.map(ch =>
    typeof ch === 'string' ? [ch, null] : [ch.name, ch.owner || null]
  ));
  if (!state.channels.includes(state.activeChannel)) {
    state.activeChannel = 'general';
    document.querySelector('.header-channel').textContent = '#general';
    renderChannel('general');
  }
  renderChannelTabs();
};

// ── Render tabs ──────────────────────────────────────────────────
export const renderChannelTabs = () => {
  channelTabsEl.innerHTML = '';

  state.channels.forEach(ch => {
    const tab = document.createElement('button');
    tab.className = 'ch-tab' + (ch === state.activeChannel ? ' active' : '');
    tab.dataset.channel = ch;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ch-tab-name';
    nameSpan.textContent = `#${ch}`;
    tab.appendChild(nameSpan);

    const unread = state.channelUnread.get(ch) || 0;
    if (unread > 0 && ch !== state.activeChannel) {
      const badge = document.createElement('span');
      badge.className = 'ch-tab-unread';
      badge.textContent = unread > 99 ? '99+' : String(unread);
      tab.appendChild(badge);
    }

    const isOwner = ch !== 'general' && state.channelOwners.get(ch) === state.myUsername;
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

  const newBtn = document.createElement('button');
  newBtn.className = 'ch-tab-add';
  newBtn.textContent = '+';
  newBtn.title = 'Nouveau canal';
  newBtn.addEventListener('click', createChannelPrompt);
  channelTabsEl.appendChild(newBtn);
};

export const switchChannel = (name) => {
  if (name === state.activeChannel) return;
  cancelReply(); // Hide reply bar when switching channel
  state.activeChannel = name;
  state.channelUnread.set(name, 0);
  renderChannelTabs();
  document.querySelector('.header-channel').textContent = `#${name}`;
  send({ type: 'switch_channel', channel: name });
  renderChannel(name);
  scrollToBottom();
  updateTypingIndicator();
  messageInput.focus();
  saveView();
};

const createChannelPrompt = () => {
  const raw = prompt('Nom du canal (lettres, chiffres, tirets) :');
  if (!raw) return;
  const name = raw.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, 32);
  if (!name) { alert('Nom invalide. Utilisez uniquement lettres, chiffres, tirets.'); return; }
  send({ type: 'create_channel', name });
};

// ── Typing indicator ─────────────────────────────────────────────
export const sendTypingEvent = () => {
  const now = Date.now();
  if (now - state.typingThrottle < 2000) return;
  state.typingThrottle = now;
  send({ type: 'typing', channel: state.activeChannel });
};

export const handleTyping = (msg) => {
  if (msg.username === state.myUsername) return;
  const ch = msg.channel || 'general';
  if (!state.typingState.has(ch)) state.typingState.set(ch, new Map());
  const chTyping = state.typingState.get(ch);

  if (chTyping.has(msg.username)) clearTimeout(chTyping.get(msg.username));
  const tid = setTimeout(() => {
    chTyping.delete(msg.username);
    if (ch === state.activeChannel) updateTypingIndicator();
  }, 3000);
  chTyping.set(msg.username, tid);

  if (ch === state.activeChannel) updateTypingIndicator();
};

export const updateTypingIndicator = () => {
  const chTyping = state.typingState.get(state.activeChannel);
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
};

// ── Topic ────────────────────────────────────────────────────────
export const applyTopic = (content) => {
  if (headerInfo.querySelector('input')) return;
  headerInfo.dataset.topic = content;
  headerInfo.textContent = content || '[ définir un sujet ]';
};

export const initTopic = () => {
  headerInfo.title = 'Cliquer pour modifier le sujet';
  headerInfo.addEventListener('click', () => {
    if (headerInfo.querySelector('input')) return;
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
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
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
};
