'use strict';

import { GIF_HOSTS } from './constants.js';
import state from './state.js';
import { messagesList, messageInput, replyBar, replyBarText, replyCancel } from './dom.js';
import { send, escHtml, colorFor, scrollToBottom, serverUrl } from './helpers.js';
import { renderReactions, showEmojiPicker } from './emoji.js';
import { openLightbox } from './notifications.js';
import { playBeep } from './helpers.js';
import { notifBadge, mentionCountEl } from './dom.js';
import { renderChannelTabs } from './channels.js';

const EPHEMERAL_SYSTEM_MSG_REGEX = /\b(joined|left) the chat\b/i;
const JOINED_CHAT_FADE_DELAY_MS = 12000;
const JOINED_CHAT_FADE_DURATION_MS = 500;

// ── Content formatting ───────────────────────────────────────────
export const formatContent = (raw) => {
  const trimmed = raw.trim();
  if (GIF_HOSTS.test(trimmed) && !/\s/.test(trimmed)) {
    const esc = escHtml(trimmed);
    return `<img src="${esc}" class="inline-gif" alt="GIF" data-lightbox="${esc}">`;
  }

  const codeBlocks = [];
  let s = raw.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const normalized = code
      .replace(/\r\n/g, '\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');
    const escaped = escHtml(normalized);
    codeBlocks.push(escaped);
    return `\x00CODEBLOCK${codeBlocks.length - 1}\x00`;
  });

  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/@(\w+)/g, (m, name) => {
    const mine = name.toLowerCase() === state.myUsername.toLowerCase();
    return `<span class="mention${mine ? ' self-mention' : ''}">${m}</span>`;
  });

  const codeChunks = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codeChunks.push(code);
    return `\x00CODE${codeChunks.length - 1}\x00`;
  });

  s = s.replace(/\|\|([^|]+)\|\|/g,
    '<span class="spoiler" tabindex="0" role="button" aria-label="spoiler, click to reveal">$1</span>');
  s = s.replace(/^&gt; (.+)$/gm, '<span class="blockquote">$1</span>');
  s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, '<em>$1</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  s = s.replace(/:([a-z0-9_-]+):/g, (match, ename) => {
    const ce = state.customEmojis.get(ename);
    if (!ce) return match;
    return `<img src="${escHtml(serverUrl(ce.url))}" class="msg-custom-emoji" alt=":${escHtml(ename)}:" title=":${escHtml(ename)}:" loading="lazy">`;
  });

  s = s.replace(/(https?:\/\/[^\s<>"']+)/g, url => {
    if (GIF_HOSTS.test(url)) return `<img src="${url}" class="inline-gif" alt="GIF" data-lightbox="${url}">`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  // Restore code placeholders at the very end so markdown/autolink logic
  // never rewrites content that is supposed to stay literal.
  s = s.replace(/\x00CODE(\d+)\x00/g, (_, i) =>
    `<code class="inline-code">${escHtml(codeChunks[+i])}</code>`);
  s = s.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, i) =>
    `<div class="code-block-wrap"><button type="button" class="code-copy-btn" aria-label="Copier le bloc de code">Copier</button><pre class="code-block"><code>${codeBlocks[+i] || '&nbsp;'}</code></pre></div>`);

  return s;
};

const mentionsMe = (content) =>
  new RegExp(`@${state.myUsername}\\b`, 'i').test(content);

// ── Reply ────────────────────────────────────────────────────────
const startReply = (msgId, username, preview) => {
  state.replyingTo = { id: msgId, username, preview };
  replyBar.style.display = 'flex';
  replyBarText.textContent = `${username}: ${preview.slice(0, 80)}`;
  messageInput.focus();
};

export const cancelReply = () => {
  state.replyingTo = null;
  replyBar.style.display = 'none';
};

const insertMention = (username) => {
  messageInput.value += `@${username} `;
  messageInput.focus();
};

// ── Edit & delete ────────────────────────────────────────────────
const editMessage = (row) => {
  const contentEl = row.querySelector('.msg-content');
  const rawText   = row.dataset.raw || '';
  const savedHTML = contentEl.innerHTML;

  const wrap  = document.createElement('div'); wrap.className = 'edit-wrap';
  const inp   = document.createElement('input'); inp.type = 'text'; inp.className = 'edit-input'; inp.value = rawText;
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
};

export const applyEdit = (msgId, content) => {
  const row = document.querySelector(`[data-id="${msgId}"]`); if (!row) return;
  row.dataset.raw = content;
  const contentEl = row.querySelector('.msg-content'); if (!contentEl) return;
  contentEl.innerHTML = formatContent(content);
  if (!contentEl.querySelector('.edited-tag')) {
    const tag = document.createElement('span'); tag.className = 'edited-tag'; tag.textContent = '(edited)';
    contentEl.appendChild(tag);
  }
  for (const msgs of state.channelMessages.values()) {
    const m = msgs.find(m => m.id === msgId);
    if (m) { m.content = content; m.edited = true; break; }
  }
  // Also update cached DM thread entries (used when re-opening the DM panel).
  for (const dms of state.dmConvos.values()) {
    const m = dms.find(m => m.id === msgId);
    if (m) { m.content = content; m.edited = true; break; }
  }
};

const deleteMessage = (msgId) => {
  if (!confirm('Supprimer ce message ?')) return;
  send({ type: 'delete_message', message_id: msgId });
};

export const applyDelete = (msgId) => {
  const row = document.querySelector(`[data-id="${msgId}"]`); if (!row) return;
  row.classList.add('deleting');
  setTimeout(() => row.remove(), 260);
  for (const msgs of state.channelMessages.values()) {
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx !== -1) { msgs.splice(idx, 1); break; }
  }
  // Also update cached DM thread entries (used when re-opening the DM panel).
  for (const dms of state.dmConvos.values()) {
    const idx = dms.findIndex(m => m.id === msgId);
    if (idx !== -1) { dms.splice(idx, 1); break; }
  }
};

// ── Render ───────────────────────────────────────────────────────
const makeActBtn = (label, title, extraClass, handler) => {
  const btn = document.createElement('button');
  btn.className   = `msg-act${extraClass ? ' ' + extraClass : ''}`;
  btn.textContent = label; btn.title = title;
  btn.addEventListener('click', handler);
  return btn;
};

const appendMessageToDOM = (msg, animate, prevMsg) => {
  const isMine      = msg.username === state.myUsername;
  const isMentioned = !isMine && mentionsMe(msg.content);

  if (isMentioned && animate) {
    state.mentionCount++;
    mentionCountEl.textContent = state.mentionCount;
    notifBadge.style.display   = 'inline';
    document.title = `(${state.mentionCount}) ChatFC`;
    playBeep();
  }

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

  const body = document.createElement('div');
  body.className = 'msg-body';

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
    actions.className = 'msg-actions msg-actions-abs';
    row.appendChild(actions);
  } else {
    actions.className = 'msg-actions';
    header.appendChild(actions);
  }

  body.appendChild(header);

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
};

export const appendMessage = (msg, animate) => {
  const ch = msg.channel || 'general';
  if (!state.channelMessages.has(ch)) state.channelMessages.set(ch, []);
  state.channelMessages.get(ch).push(msg);

  if (ch !== state.activeChannel) {
    state.channelUnread.set(ch, (state.channelUnread.get(ch) || 0) + 1);
    renderChannelTabs();
    return;
  }

  const msgs = state.channelMessages.get(ch);
  const prev = msgs.length > 1 ? msgs[msgs.length - 2] : null;
  appendMessageToDOM(msg, animate, prev);
  if (animate) scrollToBottom();
};

export const renderChannel = (channel) => {
  messagesList.querySelectorAll('.message, .reconnect-banner').forEach(el => el.remove());
  const msgs = state.channelMessages.get(channel) || [];
  msgs.forEach((m, i) => {
    const prev = i > 0 ? msgs[i - 1] : null;
    appendMessageToDOM(m, false, prev);
  });
};

export const systemMsg = (text) => {
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

  // Keep join notifications visible briefly, then fade them out.
  if (EPHEMERAL_SYSTEM_MSG_REGEX.test(text)) {
    window.setTimeout(() => {
      if (!row.isConnected) return;
      row.classList.add('auto-fading');
      window.setTimeout(() => {
        if (row.isConnected) row.remove();
      }, JOINED_CHAT_FADE_DURATION_MS);
    }, JOINED_CHAT_FADE_DELAY_MS);
  }
};

export const appendBanner = (text) => {
  const div = document.createElement('div');
  div.className = 'reconnect-banner'; div.textContent = text;
  messagesList.appendChild(div); scrollToBottom();
};

export const initMessages = () => {
  replyCancel.addEventListener('click', cancelReply);

  const copyCodeToClipboard = async (text) => {
    if (!text) return false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  };

  // Spoiler reveal (delegated)
  messagesList.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.code-copy-btn');
    if (copyBtn) {
      const wrap = copyBtn.closest('.code-block-wrap');
      const codeEl = wrap?.querySelector('code');
      const copied = await copyCodeToClipboard(codeEl?.innerText || '');
      copyBtn.textContent = copied ? 'Copié !' : 'Erreur';
      setTimeout(() => { copyBtn.textContent = 'Copier'; }, 1200);
      return;
    }

    const sp = e.target.closest('.spoiler');
    if (sp) sp.classList.toggle('revealed');
    const lb = e.target.closest('[data-lightbox]');
    if (lb) openLightbox(lb.dataset.lightbox);
  });
  messagesList.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const sp = e.target.closest('.spoiler');
      if (sp) { e.preventDefault(); sp.classList.toggle('revealed'); }
    }
  });
};
