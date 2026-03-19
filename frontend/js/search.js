'use strict';

import state from './state.js';
import {
  searchModal, searchInput, searchResults, chatScreen,
  messageInput, autocomplete, sendBtn,
} from './dom.js';
import { send } from './helpers.js';
import { switchChannel, sendTypingEvent } from './channels.js';
import { openDm, closeDm } from './dm.js';
import { cancelReply } from './messages.js';
import { clearMentions } from './notifications.js';
import { hasStagedFiles, submitStagedFilesFromComposer } from './upload.js';

// ── Global search (Ctrl+K) ──────────────────────────────────────
const openSearch = () => {
  searchModal.style.display = 'flex';
  searchInput.value = '';
  updateSearchResults('');
  searchInput.focus();
};

export const closeSearch = () => {
  searchModal.style.display = 'none';
};

const updateSearchResults = (query) => {
  searchResults.innerHTML = '';
  const q = query.toLowerCase().trim();

  const matchingChannels = state.channels.filter(ch => !q || `#${ch}`.includes(q));
  matchingChannels.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'search-result';
    const st = document.createElement('span'); st.className = 'search-status';
    st.textContent = '▪'; st.style.color = 'var(--green)';
    const nm = document.createElement('span');
    nm.textContent = `#${ch}`;
    nm.style.color = ch === state.activeChannel ? 'var(--green)' : 'var(--text2)';
    div.appendChild(st); div.appendChild(nm);
    div.addEventListener('click', () => { closeSearch(); closeDm(); switchChannel(ch); });
    searchResults.appendChild(div);
  });

  const all = [...state.allUsers.online, ...state.allUsers.offline];
  const filtered = q ? all.filter(u => u.toLowerCase().includes(q)) : all;

  filtered.forEach(u => {
    const div = document.createElement('div'); div.className = 'search-result';
    const isOnline = state.allUsers.online.includes(u);
    const st = document.createElement('span'); st.className = 'search-status';
    st.textContent = isOnline ? '●' : '○';
    st.style.color = isOnline ? 'var(--green)' : 'var(--dim)';
    const nm = document.createElement('span'); nm.textContent = u;
    nm.style.color = isOnline ? 'var(--cyan)' : 'var(--dim)';
    div.appendChild(st); div.appendChild(nm);
    if (u === state.myUsername) {
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
};

// ── @ Autocomplete ───────────────────────────────────────────────
const updateAC = () => {
  if (hasStagedFiles()) { hideAC(); return; }
  const val = messageInput.value, cursor = messageInput.selectionStart;
  const match = val.slice(0, cursor).match(/@(\w*)$/);
  if (!match) { hideAC(); return; }
  const query   = match[1].toLowerCase();
  const matches = state.onlineUsers.filter(u => u.toLowerCase().startsWith(query) && u !== state.myUsername);
  if (!matches.length) { hideAC(); return; }

  autocomplete.innerHTML = ''; state.acIndex = -1;
  matches.forEach((u, i) => {
    const div = document.createElement('div');
    div.className = 'ac-item'; div.textContent = `@${u}`;
    div.addEventListener('mousedown', e => { e.preventDefault(); state.acIndex = i; confirmAC(); });
    autocomplete.appendChild(div);
  });

  const rect = messageInput.getBoundingClientRect();
  autocomplete.style.display = 'block';
  autocomplete.style.left    = `${rect.left}px`;
  autocomplete.style.width   = `${rect.width}px`;
  autocomplete.style.bottom  = `${window.innerHeight - rect.top + 4}px`;
  autocomplete.style.top     = 'auto';
};

const moveAC = (dir) => {
  const items = autocomplete.querySelectorAll('.ac-item');
  state.acIndex = (state.acIndex + dir + items.length) % items.length;
  items.forEach((el, i) => el.classList.toggle('selected', i === state.acIndex));
};

const confirmAC = () => {
  const items = autocomplete.querySelectorAll('.ac-item');
  const idx = state.acIndex >= 0 ? state.acIndex : 0;
  if (!items[idx]) return;
  const val = messageInput.value, cursor = messageInput.selectionStart;
  const user = items[idx].textContent.slice(1);
  const before = val.slice(0, cursor).replace(/@(\w*)$/, `@${user} `);
  messageInput.value = before + val.slice(cursor);
  messageInput.selectionStart = messageInput.selectionEnd = before.length;
  hideAC();
};

const hideAC = () => { autocomplete.style.display = 'none'; state.acIndex = -1; };

// ── Send message ─────────────────────────────────────────────────
const sendMessage = async () => {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  if (hasStagedFiles()) {
    await submitStagedFilesFromComposer();
    cancelReply(); hideAC(); clearMentions();
    return;
  }
  const content = messageInput.value.trim();
  if (!content) return;
  send({ type: 'message', content, reply_to: state.replyingTo ? state.replyingTo.id : null, channel: state.activeChannel });
  messageInput.value = '';
  cancelReply(); hideAC(); clearMentions();
};

// ── Init ─────────────────────────────────────────────────────────
export const initSearch = () => {
  // Search modal
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

  // Send message
  sendBtn.addEventListener('click', () => { void sendMessage(); });

  messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (autocomplete.style.display !== 'none') confirmAC();
      else void sendMessage();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (autocomplete.style.display !== 'none') confirmAC();
    } else if (e.key === 'ArrowUp'   && autocomplete.style.display !== 'none') { e.preventDefault(); moveAC(-1); }
      else if (e.key === 'ArrowDown' && autocomplete.style.display !== 'none') { e.preventDefault(); moveAC(1); }
      else if (e.key === 'Escape') { hideAC(); cancelReply(); }
  });

  messageInput.addEventListener('input', () => { updateAC(); if (!hasStagedFiles()) sendTypingEvent(); });
  messageInput.addEventListener('focus', clearMentions);
};
