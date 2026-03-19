'use strict';

import state from './state.js';
import {
  dmPanel, dmClose, dmTitle, dmStatus, dmMessages, dmInput, dmSend,
  usersList, userCount, offlineSection, offlineList, dmFileUpload,
} from './dom.js';
import { send, colorFor, serverUrl, now, escHtml } from './helpers.js';
import { openLightbox } from './notifications.js';
import { playBeep } from './helpers.js';
import { saveView } from './channels.js';
import { MAX_UPLOAD } from './constants.js';
import { systemMsg } from './messages.js';
import { messageInput } from './dom.js';

const dmSameUser = (a, b) =>
  a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// ── Users list ───────────────────────────────────────────────────
export const renderUsers = (online, offline) => {
  const on = Array.isArray(online) ? online : [];
  const off = Array.isArray(offline) ? offline : [];
  state.allUsers = { online: on, offline: off };
  state.onlineUsers = on;
  userCount.textContent = String(on.length);

  usersList.innerHTML = '';
  on.forEach(u => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span'); nameSpan.textContent = u;
    li.appendChild(nameSpan);
    if (u === state.myUsername) {
      li.classList.add('self');
    } else {
      const unread = state.dmUnread.get(u) || 0;
      if (unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'dm-badge'; badge.textContent = unread;
        li.appendChild(badge);
      }
      li.addEventListener('click', () => openDm(u));
    }
    usersList.appendChild(li);
  });

  if (off.length > 0) {
    offlineSection.style.display = 'block';
    offlineList.innerHTML = '';
    off.forEach(u => {
      const li = document.createElement('li'); li.textContent = u;
      li.addEventListener('click', () => openDm(u));
      offlineList.appendChild(li);
    });
  } else {
    offlineSection.style.display = 'none';
  }
};

// ── Open / close DM ──────────────────────────────────────────────
export const openDm = (user) => {
  state.activeDm = user;
  state.dmUnread.set(user, 0);
  dmTitle.textContent = `@${user}`;
  const isOnline = (Array.isArray(state.allUsers.online) ? state.allUsers.online : []).includes(user);
  dmStatus.textContent = isOnline ? '● online' : '○ offline';
  dmStatus.style.color = isOnline ? 'var(--green)' : 'var(--dim)';
  dmMessages.innerHTML = '';
  (state.dmConvos.get(user) || []).forEach(m => appendDmMessageEl(m, false));
  dmMessages.scrollTop = dmMessages.scrollHeight;
  dmInput.placeholder = `Message @${user}…`;
  dmPanel.style.display = 'flex';
  dmInput.focus();
  renderUsers(state.allUsers.online, state.allUsers.offline);
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    send({ type: 'load_dm', partner: user });
  }
  saveView();
};

export const closeDm = () => {
  state.activeDm = null;
  dmPanel.style.display = 'none';
  messageInput.focus();
  saveView();
};

const sendDm = () => {
  const content = dmInput.value.trim();
  if (!content || !state.activeDm || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  send({ type: 'direct_message', to: state.activeDm, content });
  dmInput.value = '';
};

// ── DM message rendering ─────────────────────────────────────────
const appendDmMessageEl = (msg, scroll) => {
  const div = document.createElement('div');
  div.className = 'dm-message' + (dmSameUser(msg.from, state.myUsername) ? ' dm-mine' : '');

  const u = document.createElement('span');
  u.className = 'dm-msg-user';
  u.textContent = `<${msg.from}>`;
  u.style.color = colorFor(msg.from);

  const body = document.createElement('span');
  body.className = 'dm-msg-body';

  if (msg.file) {
    if (msg.file.is_image) {
      const img = document.createElement('img');
      img.src = serverUrl(msg.file.url);
      img.alt = msg.file.filename;
      img.className = 'dm-msg-image';
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => openLightbox(serverUrl(msg.file.url)));
      body.appendChild(img);
    } else {
      const a = document.createElement('a');
      a.href = serverUrl(msg.file.url);
      a.textContent = `📎 ${msg.file.filename}`;
      a.target = '_blank';
      a.className = 'dm-msg-file-link';
      body.appendChild(a);
    }
    if (msg.content) {
      const caption = document.createElement('div');
      caption.className = 'dm-msg-content';
      caption.textContent = msg.content;
      body.appendChild(caption);
    }
  } else {
    const isImgUrl = /\.(gif|jpg|jpeg|png|webp)(\?|$)/i.test(msg.content)
                  || msg.content.includes('media.tenor.com');
    if (isImgUrl) {
      const img = document.createElement('img');
      img.src = msg.content;
      img.alt = 'image';
      img.className = 'dm-msg-image';
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => openLightbox(msg.content));
      body.appendChild(img);
    } else {
      const c = document.createElement('span');
      c.className = 'dm-msg-content';
      c.textContent = msg.content;
      body.appendChild(c);
    }
  }

  const t = document.createElement('span');
  t.className = 'dm-msg-ts';
  t.textContent = msg.ts;

  div.appendChild(u);
  div.appendChild(body);
  div.appendChild(t);
  dmMessages.appendChild(div);
  if (scroll) dmMessages.scrollTop = dmMessages.scrollHeight;
};

// ── Inbound handlers ─────────────────────────────────────────────
export const handleDmHistory = (dms) => {
  if (!Array.isArray(dms)) return;
  dms.forEach(dm => {
    if (!dm.id || state.dmSeenIds.has(dm.id)) return;
    state.dmSeenIds.add(dm.id);
    const partner = dmSameUser(dm.from, state.myUsername) ? dm.to : dm.from;
    const entry = { id: dm.id, from: dm.from, to: dm.to, content: dm.content,
                    ts: dm.timestamp || now(), file: dm.file || null };
    if (!state.dmConvos.has(partner)) state.dmConvos.set(partner, []);
    state.dmConvos.get(partner).push(entry);
  });
  renderUsers(state.allUsers.online, state.allUsers.offline);
  if (state.activeDm) {
    dmMessages.innerHTML = '';
    (state.dmConvos.get(state.activeDm) || []).forEach(m => appendDmMessageEl(m, false));
    dmMessages.scrollTop = dmMessages.scrollHeight;
  }
};

export const handleDmThread = (partner, dms) => {
  if (!partner || !Array.isArray(dms)) return;
  const list = [];
  dms.forEach(dm => {
    if (!dm.id) return;
    state.dmSeenIds.add(dm.id);
    list.push({
      id: dm.id, from: dm.from, to: dm.to, content: dm.content,
      ts: dm.timestamp || now(), file: dm.file || null,
    });
  });
  state.dmConvos.set(partner, list);
  if (state.activeDm != null && dmSameUser(state.activeDm, partner)) {
    state.activeDm = partner;
    dmTitle.textContent = `@${partner}`;
    dmMessages.innerHTML = '';
    list.forEach(m => appendDmMessageEl(m, false));
    dmMessages.scrollTop = dmMessages.scrollHeight;
  }
  renderUsers(state.allUsers.online, state.allUsers.offline);
};

export const handleDmMessage = (msg) => {
  if (msg.id) {
    if (state.dmSeenIds.has(msg.id)) return;
    state.dmSeenIds.add(msg.id);
  }

  const partner = dmSameUser(msg.from, state.myUsername) ? msg.to : msg.from;
  const ts    = msg.timestamp || now();
  const entry = { id: msg.id, from: msg.from, to: msg.to, content: msg.content, ts, file: msg.file || null };

  if (!state.dmConvos.has(partner)) state.dmConvos.set(partner, []);
  state.dmConvos.get(partner).push(entry);

  if (state.activeDm != null && dmSameUser(state.activeDm, partner)) {
    appendDmMessageEl(entry, true);
  } else if (!dmSameUser(msg.from, state.myUsername)) {
    state.dmUnread.set(partner, (state.dmUnread.get(partner) || 0) + 1);
    renderUsers(state.allUsers.online, state.allUsers.offline);
    playBeep();
  }
};

// ── DM file upload ───────────────────────────────────────────────
const uploadFileDm = async (file) => {
  if (!state.activeDm) return;
  const fd = new FormData(); fd.append('file', file);
  try {
    const host      = (await import('./helpers.js')).resolveHost();
    const httpProto = location.protocol === 'https:' ? 'https:' : 'http:';
    const res = await fetch(`${httpProto}//${host}/upload`, { method: 'POST', body: fd });
    if (res.status === 413) throw new Error('Fichier trop lourd (max 20 Mo)');
    if (!res.ok)            throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    send({
      type:    'direct_message',
      to:      state.activeDm,
      content: '',
      file:    { url: data.url, filename: data.filename, is_image: data.is_image },
    });
  } catch (err) {
    systemMsg(`⚠ Upload DM échoué : ${err.message}`);
  }
};

export const initDm = () => {
  dmClose.addEventListener('click', closeDm);
  dmInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDm(); }
    if (e.key === 'Escape') { e.preventDefault(); closeDm(); }
  });
  dmSend.addEventListener('click', sendDm);

  dmFileUpload.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    dmFileUpload.value = '';
    if (!state.activeDm || files.length === 0) return;
    files.forEach(f => {
      if (f.size > MAX_UPLOAD) { systemMsg(`❌ ${f.name} trop lourd (max 20 Mo)`); return; }
      uploadFileDm(f);
    });
  });
};
