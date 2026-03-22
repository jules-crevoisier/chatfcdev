'use strict';

import { SERVER_BASE_URL_KEY } from './constants.js';

const DEFAULT_BACKEND_BASE_URL = 'https://fcchat.srko.fr';

const safeGet = (key) => {
  try { return localStorage.getItem(key); } catch (_) { return null; }
};

const safeSet = (key, value) => {
  try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
};

const normalizeBackendOrigin = (raw) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  // Allow users to paste "fcchat.srko.fr:3000" without scheme.
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin; // keep only scheme + host + port
  } catch (_) {
    return null;
  }
};

export const initServerConfig = () => {
  const screenEl = document.getElementById('server-config-screen');
  if (!screenEl) return;

  const inputEl = document.getElementById('server-url-input');
  const saveBtn = document.getElementById('server-save-btn');
  const errorEl = document.getElementById('server-config-error');
  const openBtn = document.getElementById('server-config-open-btn');
  if (!inputEl || !saveBtn || !errorEl) return;

  const saved = safeGet(SERVER_BASE_URL_KEY);
  const initialValue = saved || DEFAULT_BACKEND_BASE_URL;
  inputEl.value = initialValue;

  const setError = (msg) => {
    errorEl.textContent = msg || '';
    errorEl.style.display = msg ? 'block' : 'none';
  };

  const showScreen = () => {
    const latest = safeGet(SERVER_BASE_URL_KEY);
    inputEl.value = latest || DEFAULT_BACKEND_BASE_URL;
    setError('');
    screenEl.style.display = 'flex';
    inputEl.focus();
    if (typeof inputEl.select === 'function') inputEl.select();
  };

  if (saved) {
    screenEl.style.display = 'none';
    setError('');
  } else {
    screenEl.style.display = 'flex';
    setError('');
  }

  const handleSave = () => {
    const origin = normalizeBackendOrigin(inputEl.value);
    if (!origin) {
      setError('URL backend invalide. Ex: https://fcchat.srko.fr ou fcchat.srko.fr:3000');
      return;
    }
    const ok = safeSet(SERVER_BASE_URL_KEY, origin);
    if (!ok) {
      setError('Impossible d\'enregistrer la configuration sur cet environnement.');
      return;
    }
    setError('');
    screenEl.style.display = 'none';

    // Let auth.js retry login if a token already exists.
    window.dispatchEvent(new Event('chatfc-server-configured'));
  };

  saveBtn.addEventListener('click', handleSave);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
  });

  if (openBtn) openBtn.addEventListener('click', showScreen);

  inputEl.focus();
  if (typeof inputEl.select === 'function') inputEl.select();
};

