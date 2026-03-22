'use strict';

import {
  emojiPicker, msgEmojiPicker, emojiMsgBtn, dmEmojiBtn,
  gifPicker, gifBtn, dmGifBtn, autocomplete, messageInput,
} from './js/dom.js';

import { initTheme } from './js/theme.js';
import { initServerConfig } from './js/serverConfig.js';
import { initAuth, tryAutoLogin } from './js/auth.js';
import { initVisibilityReconnect } from './js/ws.js';
import { initTopic } from './js/channels.js';
import { initMessages } from './js/messages.js';
import { initDm } from './js/dm.js';
import { initEmojiPickers, hideEmojiPicker, closeMsgEmojiPicker } from './js/emoji.js';
import { initGifPicker, closeGifPicker } from './js/gif.js';
import { initUpload } from './js/upload.js';
import { initSearch } from './js/search.js';
import { initNotifications } from './js/notifications.js';

// Close overlays on outside click
document.addEventListener('click', e => {
  if (!emojiPicker.contains(e.target)) hideEmojiPicker();
  if (!msgEmojiPicker.contains(e.target) && e.target !== emojiMsgBtn && e.target !== dmEmojiBtn) closeMsgEmojiPicker();
  if (!gifPicker.contains(e.target) && e.target !== gifBtn && e.target !== dmGifBtn) closeGifPicker();
  if (!autocomplete.contains(e.target) && e.target !== messageInput) {
    autocomplete.style.display = 'none';
  }
});

// ── Boot ─────────────────────────────────────────────────────────
initTheme();
initServerConfig();
initAuth();
initVisibilityReconnect();
initTopic();
initMessages();
initDm();
initEmojiPickers();
initGifPicker();
initUpload();
initSearch();
initNotifications();
tryAutoLogin();
