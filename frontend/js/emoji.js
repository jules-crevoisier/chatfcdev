'use strict';

import { EMOJIS, EMOJI_CATS, CUSTOM_CAT_IDX, TOKEN_KEY } from './constants.js';
import state from './state.js';
import {
  emojiPicker, emojiGrid, msgEmojiPicker, emojiSearch,
  emojiCatsEl, emojiListEl, emojiMsgBtn, dmEmojiBtn, messageInput, dmInput,
} from './dom.js';
import { send, insertAtCursor, serverUrl, escHtml, positionAboveInput } from './helpers.js';
import { closeGifPicker } from './gif.js';

// ── Reactions ────────────────────────────────────────────────────
export const sendReaction = (msgId, emoji) => {
  send({ type: 'reaction', message_id: msgId, emoji });
};

export const renderReactions = (container, reactions, msgId) => {
  container.innerHTML = '';
  Object.entries(reactions).forEach(([emoji, users]) => {
    if (!users || users.length === 0) return;
    const btn = document.createElement('button');
    btn.className = `reaction${users.includes(state.myUsername) ? ' mine' : ''}`;
    btn.title = users.join(', ');
    btn.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
    btn.addEventListener('click', () => sendReaction(msgId, emoji));
    container.appendChild(btn);
  });
};

export const applyReactions = (msgId, reactions) => {
  const c = document.getElementById(`r-${msgId}`);
  if (c) renderReactions(c, reactions, msgId);
};

// ── Reaction emoji picker (per-message) ──────────────────────────
export const showEmojiPicker = (msgId, anchor) => {
  state.emojiTarget = msgId;
  emojiPicker.style.top    = '-9999px';
  emojiPicker.style.left   = '-9999px';
  emojiPicker.style.display = 'block';

  const pw   = emojiPicker.offsetWidth;
  const ph   = emojiPicker.offsetHeight;
  const rect = anchor.getBoundingClientRect();
  const pad  = 6;

  let top  = rect.top - ph - pad;
  let left = rect.left;
  if (top < pad) top = rect.bottom + pad;
  if (top + ph > window.innerHeight - pad) top = window.innerHeight - ph - pad;
  if (left + pw > window.innerWidth - pad) left = window.innerWidth - pw - pad;
  if (left < pad) left = pad;

  emojiPicker.style.top  = `${top}px`;
  emojiPicker.style.left = `${left}px`;
};

export const hideEmojiPicker = () => {
  emojiPicker.style.display = 'none';
  state.emojiTarget = null;
};

// ── Message emoji picker (insert into text) ──────────────────────
const renderEmojiList = (emojis) => {
  emojiListEl.innerHTML = '';
  emojis.forEach(em => {
    const btn = document.createElement('button');
    btn.className   = 'pick-emoji-btn';
    btn.textContent = em;
    btn.addEventListener('click', () => {
      const target = state.emojiActiveInput || messageInput;
      insertAtCursor(target, em);
      target.focus();
    });
    emojiListEl.appendChild(btn);
  });
};

const renderCustomEmojiList = (filter = '') => {
  emojiListEl.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-emoji-tab';

  const grid = document.createElement('div');
  grid.className = 'custom-emoji-grid';
  const all = [...state.customEmojis.values()];
  const filtered = filter ? all.filter(e => e.name.toLowerCase().includes(filter)) : all;

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
        const target = state.emojiActiveInput || messageInput;
        insertAtCursor(target, `:${e.name}:`);
        target.focus();
      });
      grid.appendChild(btn);
    });
  }
  wrapper.appendChild(grid);

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

    fileInput.addEventListener('change', () => {
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
};

const uploadCustomEmoji = async (name, file) => {
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
};

const openMsgEmojiPicker = (anchorBtn = emojiMsgBtn) => {
  state.activeMsgEmoji = true;
  positionAboveInput(msgEmojiPicker, anchorBtn);
  emojiSearch.focus();
};

export const closeMsgEmojiPicker = () => {
  state.activeMsgEmoji = false;
  msgEmojiPicker.style.display = 'none';
  emojiSearch.value = '';
  if (state.currentEmojiCat !== CUSTOM_CAT_IDX) {
    renderEmojiList(EMOJI_CATS[state.currentEmojiCat].emojis);
  }
};

export const handleEmojiList = (emojis) => {
  state.customEmojis = new Map((emojis || []).map(e => [e.name, e]));
  if (state.currentEmojiCat === CUSTOM_CAT_IDX) renderCustomEmojiList();
};

export const refreshCustomEmojiTab = () => {
  if (state.currentEmojiCat === CUSTOM_CAT_IDX) renderCustomEmojiList();
};

export const initEmojiPickers = () => {
  // Reaction emoji grid
  EMOJIS.forEach(em => {
    const btn = document.createElement('button');
    btn.className   = 'emoji-btn';
    btn.textContent = em;
    btn.addEventListener('click', () => {
      if (state.emojiTarget) { sendReaction(state.emojiTarget, em); hideEmojiPicker(); }
    });
    emojiGrid.appendChild(btn);
  });

  // Message emoji picker categories
  EMOJI_CATS.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className   = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
    btn.textContent = cat.icon;
    btn.title       = cat.name;
    btn.addEventListener('click', () => {
      state.currentEmojiCat = i;
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
    state.currentEmojiCat = CUSTOM_CAT_IDX;
    emojiCatsEl.querySelectorAll('.emoji-cat-btn').forEach((b, j) =>
      b.classList.toggle('active', j === CUSTOM_CAT_IDX));
    renderCustomEmojiList();
  });
  emojiCatsEl.appendChild(customBtn);

  renderEmojiList(EMOJI_CATS[0].emojis);

  emojiSearch.addEventListener('input', () => {
    const q = emojiSearch.value.trim().toLowerCase();
    if (state.currentEmojiCat === CUSTOM_CAT_IDX) { renderCustomEmojiList(q); return; }
    if (!q) { renderEmojiList(EMOJI_CATS[state.currentEmojiCat].emojis); return; }
    renderEmojiList(EMOJI_CATS.flatMap(c => c.emojis).slice(0, 80));
  });

  // Open/close bindings
  emojiMsgBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (state.activeMsgEmoji) { closeMsgEmojiPicker(); return; }
    closeGifPicker();
    state.emojiActiveInput = messageInput;
    openMsgEmojiPicker(emojiMsgBtn);
  });

  dmEmojiBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (state.activeMsgEmoji) { closeMsgEmojiPicker(); return; }
    closeGifPicker();
    state.emojiActiveInput = dmInput;
    openMsgEmojiPicker(dmEmojiBtn);
  });
};
