'use strict';

import state from './state.js';
import {
  dmPanel, dmClose, dmTitle, dmStatus, dmMessages, dmInput, dmSend,
  usersList, userCount, offlineSection, offlineList, dmFileUpload,
  notifBadge, mentionCountEl, messageInput, replyBar, replyBarText,
} from './dom.js';
import { send, colorFor, serverUrl, now, escHtml, resolveHost } from './helpers.js';
import { openLightbox } from './notifications.js';
import { playBeep } from './helpers.js';
import { saveView } from './channels.js';
import { MAX_UPLOAD, TOKEN_KEY } from './constants.js';
import { systemMsg, formatContent, cancelReply } from './messages.js';
import { renderReactions, showEmojiPicker } from './emoji.js';

const dmSameUser = (a, b) =>
  a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const mentionsMe = (content) =>
  new RegExp(`@${state.myUsername}\\b`, 'i').test(content || '');

const insertMention = (username) => {
  dmInput.value += `@${username} `;
  dmInput.focus();
};

const startReplyDm = (msgId, username, preview) => {
  state.replyingTo = { id: msgId, username, preview };
  replyBar.style.display = 'flex';
  replyBarText.textContent = `${username}: ${String(preview || '').slice(0, 80)}`;
  dmInput.focus();
};

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
  cancelReply(); // Hide reply bar when switching to another MP
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
  cancelReply(); // Hide reply bar when leaving MP mode
  state.activeDm = null;
  dmPanel.style.display = 'none';
  messageInput.focus();
  saveView();
};

const sendDm = () => {
  const content = dmInput.value.trim();
  if (!content || !state.activeDm || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  send({
    type: 'direct_message',
    to: state.activeDm,
    content,
    reply_to: state.replyingTo ? state.replyingTo.id : null,
  });
  dmInput.value = '';
  cancelReply();
  dmInput.focus();
};

// ── DM message rendering ─────────────────────────────────────────
const makeActBtn = (label, title, extraClass, handler) => {
  const btn = document.createElement('button');
  btn.className = `msg-act${extraClass ? ' ' + extraClass : ''}`;
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', handler);
  return btn;
};

const editDmMessage = (row) => {
  const contentEl = row.querySelector('.msg-content');
  if (!contentEl) return;
  const rawText = row.dataset.raw || '';
  const savedHTML = contentEl.innerHTML;

  const wrap = document.createElement('div');
  wrap.className = 'edit-wrap';

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'edit-input';
  inp.value = rawText;

  const okBtn = document.createElement('button');
  okBtn.className = 'edit-ok';
  okBtn.textContent = '✓';

  const cxBtn = document.createElement('button');
  cxBtn.className = 'edit-cancel';
  cxBtn.textContent = '✕';

  wrap.appendChild(inp);
  wrap.appendChild(okBtn);
  wrap.appendChild(cxBtn);
  contentEl.innerHTML = '';
  contentEl.appendChild(wrap);

  inp.focus();
  inp.select();

  const confirm = () => {
    const nc = inp.value.trim();
    if (nc && nc !== rawText) {
      send({ type: 'edit_message', message_id: row.dataset.id, content: nc });
    } else {
      contentEl.innerHTML = savedHTML;
    }
  };

  const cancel = () => {
    contentEl.innerHTML = savedHTML;
  };

  okBtn.addEventListener('click', confirm);
  cxBtn.addEventListener('click', cancel);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
};

const deleteDmMessage = (msgId) => {
  if (!confirm('Supprimer ce message ?')) return;
  send({ type: 'delete_message', message_id: msgId });
};

const appendDmMessageEl = (msg, animate, prevMsg) => {
  const isMine = dmSameUser(msg.from, state.myUsername);
  const isMentioned = !isMine && mentionsMe(msg.content);
  const shouldGroup = !!prevMsg
    && !prevMsg._isSystem
    && dmSameUser(prevMsg.from, msg.from)
    && prevMsg.ts === msg.ts
    && !msg.reply_to;

  const row = document.createElement('div');
  row.className = 'message' + (animate ? ' new' : '') + (shouldGroup ? ' grouped' : '');
  row.dataset.id = msg.id;
  row.dataset.raw = msg.content || '';
  row.dataset.username = msg.from;
  if (isMentioned) row.classList.add('mentioned');

  if (isMentioned && animate) {
    state.mentionCount++;
    mentionCountEl.textContent = state.mentionCount;
    notifBadge.style.display = 'inline';
    document.title = `(${state.mentionCount}) ChatFC`;
    playBeep();
  }

  const header = document.createElement('div');
  header.className = 'msg-header';

  const uSpan = document.createElement('span');
  uSpan.className = 'msg-username';
  uSpan.textContent = msg.from;
  uSpan.style.color = colorFor(msg.from);
  uSpan.title = 'Click to mention';
  uSpan.addEventListener('click', () => insertMention(msg.from));
  if (!shouldGroup) header.appendChild(uSpan);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const replyPreview = (msg.content && msg.content.trim())
    ? msg.content
    : (msg.file ? msg.file.filename : '');

  actions.appendChild(makeActBtn(
    '↩',
    'Répondre',
    '',
    () => startReplyDm(msg.id, msg.from, replyPreview)
  ));

  const reactBtn = document.createElement('button');
  reactBtn.className = 'msg-act';
  reactBtn.title = 'Réagir';
  reactBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9.5" r=".8" fill="currentColor" stroke="none"/><circle cx="15" cy="9.5" r=".8" fill="currentColor" stroke="none"/></svg>`;
  reactBtn.addEventListener('click', e => {
    e.stopPropagation();
    showEmojiPicker(msg.id, reactBtn);
  });
  actions.appendChild(reactBtn);

  if (isMine) {
    actions.appendChild(makeActBtn('✎', 'Modifier', '', () => editDmMessage(row)));
    actions.appendChild(makeActBtn('🗑', 'Supprimer', 'del', () => deleteDmMessage(msg.id)));
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  if (msg.reply_to) {
    const ctx = document.createElement('div');
    ctx.className = 'reply-context';
    ctx.innerHTML = `<span class="reply-ctx-user">↩ ${escHtml(msg.reply_to.username)}</span>`
                  + `<span class="reply-ctx-preview">${escHtml(String(msg.reply_to.preview || '')).slice(0,80)}</span>`;
    ctx.addEventListener('click', () => {
      const orig = dmMessages.querySelector(`[data-id="${msg.reply_to.id}"]`);
      if (orig) orig.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    body.appendChild(ctx);
  }
  body.appendChild(header);

  if (msg.file) {
    const att = document.createElement('div');
    att.className = 'file-attachment';

    const filenameLower = String(msg.file.filename || '').toLowerCase();
    const urlLower = String(msg.file.url || '').toLowerCase();
    const allowInlineImage = msg.file.is_image
      && !filenameLower.endsWith('.svg')
      && !urlLower.endsWith('.svg');
    if (allowInlineImage) {
      const img = document.createElement('img');
      img.src = serverUrl(msg.file.url);
      img.alt = msg.file.filename;
      img.addEventListener('click', () => openLightbox(serverUrl(msg.file.url)));
      att.appendChild(img);
    } else {
      const link = document.createElement('a');
      link.href = serverUrl(msg.file.url);
      link.download = msg.file.filename;
      link.className = 'file-link';
      link.textContent = `📄 ${msg.file.filename}`;
      att.appendChild(link);
    }
    body.appendChild(att);
  }

  const isAutoFilename = msg.file && (
    !msg.content ||
    msg.content === `📎 ${msg.file.filename}` ||
    msg.content === `📄 ${msg.file.filename}`
  );

  if (!isAutoFilename) {
    const contentEl = document.createElement('div');
    contentEl.className = 'msg-content';
    contentEl.innerHTML = formatContent(msg.content || '');
    if (msg.edited) {
      const tag = document.createElement('span');
      tag.className = 'edited-tag';
      tag.textContent = '(edited)';
      contentEl.appendChild(tag);
    }
    body.appendChild(contentEl);
  }

  const reactionsDiv = document.createElement('div');
  reactionsDiv.className = 'reactions';
  reactionsDiv.id = `r-${msg.id}`;
  renderReactions(reactionsDiv, msg.reactions || {}, msg.id);
  body.appendChild(reactionsDiv);

  const tsSpan = document.createElement('span');
  tsSpan.className = 'msg-timestamp';
  tsSpan.textContent = msg.ts;
  if (!shouldGroup) header.appendChild(tsSpan);

  if (shouldGroup) {
    actions.className = 'msg-actions msg-actions-abs';
    row.appendChild(actions);
  } else {
    actions.className = 'msg-actions';
    header.appendChild(actions);
  }

  row.appendChild(body);
  dmMessages.appendChild(row);
  if (animate) dmMessages.scrollTop = dmMessages.scrollHeight;
};

// ── Inbound handlers ─────────────────────────────────────────────
export const handleDmHistory = (dms) => {
  if (!Array.isArray(dms)) return;
  dms.forEach(dm => {
    if (!dm.id || state.dmSeenIds.has(dm.id)) return;
    state.dmSeenIds.add(dm.id);
    const partner = dmSameUser(dm.from, state.myUsername) ? dm.to : dm.from;
    const entry = { id: dm.id, from: dm.from, to: dm.to, content: dm.content,
                    ts: dm.timestamp || now(), file: dm.file || null,
                    reactions: dm.reactions || {}, edited: !!dm.edited,
                    reply_to: dm.reply_to || null };
    if (!state.dmConvos.has(partner)) state.dmConvos.set(partner, []);
    state.dmConvos.get(partner).push(entry);
  });
  renderUsers(state.allUsers.online, state.allUsers.offline);
  if (state.activeDm) {
    dmMessages.innerHTML = '';
    const list = state.dmConvos.get(state.activeDm) || [];
    list.forEach((m, i) => appendDmMessageEl(m, false, i > 0 ? list[i - 1] : null));
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
      reactions: dm.reactions || {}, edited: !!dm.edited,
      reply_to: dm.reply_to || null,
    });
  });
  state.dmConvos.set(partner, list);
  if (state.activeDm != null && dmSameUser(state.activeDm, partner)) {
    state.activeDm = partner;
    dmTitle.textContent = `@${partner}`;
    dmMessages.innerHTML = '';
    list.forEach((m, i) => appendDmMessageEl(m, false, i > 0 ? list[i - 1] : null));
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
  const entry = { id: msg.id, from: msg.from, to: msg.to, content: msg.content, ts, file: msg.file || null,
                    reactions: msg.reactions || {}, edited: !!msg.edited,
                    reply_to: msg.reply_to || null };

  if (!state.dmConvos.has(partner)) state.dmConvos.set(partner, []);
  const list = state.dmConvos.get(partner);
  const prevMsg = list.length > 0 ? list[list.length - 1] : null;
  list.push(entry);

  if (state.activeDm != null && dmSameUser(state.activeDm, partner)) {
    appendDmMessageEl(entry, true, prevMsg);
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

  const readErrorMessage = async (res) => {
    // Axum renvoie souvent un String (pas du JSON). On lit une seule fois en text,
    // puis on tente de parser en JSON si possible.
    let txt = '';
    try { txt = await res.text(); } catch (_) {}
    txt = (txt || '').trim();
    if (!txt) return `HTTP ${res.status}`;

    try {
      const data = JSON.parse(txt);
      if (data?.error) return String(data.error);
      if (data?.message) return String(data.message);
      return JSON.stringify(data);
    } catch (_) {
      return txt;
    }
  };

  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error('Unauthorized: missing token');
    const host      = resolveHost();
    const httpProto = location.protocol === 'https:' ? 'https:' : 'http:';
    const res = await fetch(
      `${httpProto}//${host}/upload?token=${encodeURIComponent(token)}`,
      { method: 'POST', body: fd }
    );
    if (!res.ok) {
      const serverMsg = await readErrorMessage(res);
      if (res.status === 413 && serverMsg.toLowerCase().includes('lourd')) {
        throw new Error(serverMsg);
      }
      throw new Error(serverMsg || `HTTP ${res.status}`);
    }
    const data = await res.json();
    send({
      type:    'direct_message',
      to:      state.activeDm,
      content: '',
      reply_to: state.replyingTo ? state.replyingTo.id : null,
      file:    { url: data.url, filename: data.filename, is_image: data.is_image },
    });
    cancelReply();
    dmInput.focus();
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
