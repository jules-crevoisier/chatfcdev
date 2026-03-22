'use strict';

import { MAX_UPLOAD, TOKEN_KEY } from './constants.js';
import state from './state.js';
import {
  messagesList, messageInput, fileUpload, fileStaging,
  stagingPreview, stagingCancel, sendBtn,
} from './dom.js';
import { send, resolveHost, escHtml, scrollToBottom, formatSize, getServerBackendProtocol } from './helpers.js';
import { systemMsg } from './messages.js';

const inputArea = document.getElementById('input-area');
const defaultInputPlaceholder = messageInput.placeholder;

// ── File staging ─────────────────────────────────────────────────
const makeStagedItem = (file) => {
  const isImage = file.type.startsWith('image/');
  return {
    id: crypto.randomUUID(),
    file,
    isImage,
    objectUrl: isImage ? URL.createObjectURL(file) : null,
  };
};

export const hasStagedFiles = () => state.stagedFiles.length > 0;

const setComposerMode = (active) => {
  if (active) {
    inputArea.classList.add('staging-active');
    messageInput.placeholder = 'Ajouter une légende pour les pièces jointes…';
    sendBtn.textContent = `UPLOAD ▶`;
    sendBtn.title = 'Envoyer les pièces jointes';
  } else {
    inputArea.classList.remove('staging-active');
    messageInput.placeholder = defaultInputPlaceholder;
    sendBtn.textContent = 'SEND ▶';
    sendBtn.title = '';
  }
};

const renderStaging = () => {
  const count = state.stagedFiles.length;
  if (count === 0) {
    fileStaging.style.display = 'none';
    stagingPreview.innerHTML = '';
    setComposerMode(false);
    return;
  }

  setComposerMode(true);
  fileStaging.style.display = 'flex';
  stagingPreview.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'staging-wrap';

  const head = document.createElement('div');
  head.className = 'staging-headline';
  head.innerHTML = `<span>${count} fichier${count > 1 ? 's' : ''} prêt${count > 1 ? 's' : ''}</span><span>Ajoutez-en encore via 📎 ou glisser-déposer</span>`;
  wrap.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'staging-grid';

  state.stagedFiles.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'staging-card';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'staging-remove';
    removeBtn.title = `Retirer ${item.file.name}`;
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removeStagedFile(item.id));
    card.appendChild(removeBtn);

    if (item.isImage && item.objectUrl) {
      const img = document.createElement('img');
      img.className = 'staging-thumb';
      img.src = item.objectUrl;
      img.alt = item.file.name;
      card.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'staging-file-icon';
      icon.textContent = '📄';
      card.appendChild(icon);
    }

    const meta = document.createElement('div');
    meta.className = 'staging-meta';
    meta.innerHTML = `<span class="staging-name">${escHtml(item.file.name)}</span><span class="staging-size">${formatSize(item.file.size)}</span>`;
    card.appendChild(meta);
    grid.appendChild(card);
  });

  wrap.appendChild(grid);
  stagingPreview.appendChild(wrap);
  sendBtn.textContent = count > 1 ? `UPLOAD ${count} ▶` : 'UPLOAD ▶';
};

const stageFiles = (files, { append = true } = {}) => {
  if (!append) cancelStaging();

  const valid = [];
  files.forEach((file) => {
    if (file.size > MAX_UPLOAD) {
      systemMsg(`❌ Fichier trop lourd : ${file.name} (${formatSize(file.size)} — max 20 Mo)`);
      return;
    }
    valid.push(makeStagedItem(file));
  });

  if (valid.length === 0) return;
  if (state.stagedFiles.length === 0) {
    state.stagedDraft = messageInput.value;
    messageInput.value = '';
  }
  state.stagedFiles.push(...valid);
  state.stagedFile = state.stagedFiles[0] || null;
  renderStaging();
  messageInput.focus();
};

const removeStagedFile = (id) => {
  const idx = state.stagedFiles.findIndex((x) => x.id === id);
  if (idx === -1) return;
  const [removed] = state.stagedFiles.splice(idx, 1);
  if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
  state.stagedFile = state.stagedFiles[0] || null;
  renderStaging();
};

export const cancelStaging = (restoreDraft = true) => {
  state.stagedFiles.forEach((item) => {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  });
  state.stagedFile = null;
  state.stagedFiles = [];
  if (restoreDraft) {
    messageInput.value = state.stagedDraft || '';
  }
  state.stagedDraft = '';
  fileStaging.style.display = 'none';
  stagingPreview.innerHTML  = '';
  setComposerMode(false);
};

const sendStagedFiles = async () => {
  if (!state.stagedFiles.length) return false;
  const files = [...state.stagedFiles];
  const caption = messageInput.value.trim();
  sendBtn.disabled = true;
  stagingCancel.disabled = true;
  sendBtn.textContent = 'Envoi…';
  cancelStaging(false);
  await Promise.all(files.map((item) => uploadFile(item.file, caption)));
  sendBtn.disabled = false;
  stagingCancel.disabled = false;
  sendBtn.textContent = 'SEND ▶';
  messageInput.value = '';
  messageInput.focus();
  return true;
};

export const submitStagedFilesFromComposer = async () => sendStagedFiles();

// ── Upload ───────────────────────────────────────────────────────
const appendUploadPlaceholder = (name) => {
  const p = document.createElement('div');
  p.className = 'message system-msg';
  p.innerHTML = `<div class="msg-avatar"></div><div class="msg-body"><div class="msg-content upload-progress">⏳ Envoi de ${escHtml(name)}…</div></div>`;
  messagesList.appendChild(p); scrollToBottom();
  return p;
};

const uploadFile = async (file, caption) => {
  const placeholder = appendUploadPlaceholder(file.name);
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
    const host      = resolveHost();
    const httpProto = getServerBackendProtocol();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { throw new Error('Unauthorized: missing token'); }
    const res = await fetch(
      `${httpProto}//${host}/upload?token=${encodeURIComponent(token)}`,
      { method: 'POST', body: fd }
    );

    if (!res.ok) {
      const serverMsg = await readErrorMessage(res);
      // Petite normalisation : si serveur dit déjà "fichier trop lourd", on respecte son texte.
      if (res.status === 413 && serverMsg.toLowerCase().includes('lourd')) {
        throw new Error(serverMsg);
      }
      // Souvent pour les erreurs type SVG : backend renvoie le message.
      throw new Error(serverMsg || `HTTP ${res.status}`);
    }

    const data = await res.json();
    placeholder.remove();
    send({ type: 'file_message', filename: data.filename, url: data.url,
           is_image: data.is_image, caption: caption || undefined,
           channel: state.activeChannel });
  } catch (err) {
    placeholder.remove();
    systemMsg(`⚠ Upload échoué : ${err.message}`);
  }
};

// ── Drag & drop ──────────────────────────────────────────────────
const handleDrop = (e) => {
  e.preventDefault();
  messagesList.classList.remove('dragging');
  const files = Array.from(e.dataTransfer.files);
  if (files.length === 0) return;
  stageFiles(files, { append: true });
};

export const initUpload = () => {
  stagingCancel.addEventListener('click', cancelStaging);

  fileUpload.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    fileUpload.value = '';
    if (files.length === 0) return;
    stageFiles(files, { append: true });
  });

  // Replace inline handlers from HTML
  messagesList.addEventListener('dragover', e => {
    e.preventDefault();
    messagesList.classList.add('dragging');
  });
  messagesList.addEventListener('dragleave', () => {
    messagesList.classList.remove('dragging');
  });
  messagesList.addEventListener('drop', handleDrop);
};
