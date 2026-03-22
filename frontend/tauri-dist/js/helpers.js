'use strict';

import { SERVER_HOST, USER_COLORS, SERVER_BASE_URL_KEY } from './constants.js';
import { messagesList } from './dom.js';
import state from './state.js';

export const send = (obj) => {
  if (state.ws && state.ws.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify(obj));
};

export const getServerBackendBaseUrl = () => {
  try { return localStorage.getItem(SERVER_BASE_URL_KEY); } catch (_) { return null; }
};

export const getServerBackendProtocol = () => {
  const baseUrl = getServerBackendBaseUrl();
  if (baseUrl) return baseUrl.startsWith('https://') ? 'https:' : 'http:';
  return location.protocol === 'https:' ? 'https:' : 'http:';
};

export const isBackendUrlConfigured = () => {
  if (getServerBackendBaseUrl()) return true;
  if (SERVER_HOST) return true;
  return location.protocol === 'http:' || location.protocol === 'https:';
};

export const resolveHost = () => {
  const baseUrl = getServerBackendBaseUrl();
  if (baseUrl) {
    try { return new URL(baseUrl).host; } catch (_) {}
  }
  return SERVER_HOST || (location.host && location.protocol !== 'file:' ? location.host : 'localhost:3000');
};

export const serverUrl = (path) => {
  const baseUrl = getServerBackendBaseUrl();
  if (baseUrl) {
    if (typeof path === 'string' && /^https?:\/\//i.test(path)) return path;
    const p = String(path || '').startsWith('/') ? path : `/${path}`;
    return `${baseUrl.replace(/\/+$/, '')}${p}`;
  }

  if (location.protocol !== 'file:' && !SERVER_HOST) return path;

  const p = String(path || '').startsWith('/') ? path : `/${path}`;
  return `http://${resolveHost()}${p}`;
};

export const insertAtCursor = (input, text) => {
  const s = input.selectionStart, e = input.selectionEnd;
  input.value = input.value.slice(0, s) + text + input.value.slice(e);
  input.selectionStart = input.selectionEnd = s + text.length;
};

export const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export const scrollToBottom = () => {
  messagesList.scrollTop = messagesList.scrollHeight;
};

export const now = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const pad = (n) => String(n).padStart(2, '0');

export const escHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const colorFor = (name) => {
  let h = 0;
  for (const c of name) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
};

export const formatSize = (bytes) => {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

export const playBeep = () => {
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
};

export const positionAboveInput = (popup, anchor) => {
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
};
