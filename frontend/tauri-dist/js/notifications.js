'use strict';

import state from './state.js';
import { notifBadge, mentionCountEl, messagesList, lightbox, lightboxImg } from './dom.js';

export const clearMentions = () => {
  if (!state.mentionCount) return;
  state.mentionCount = 0;
  notifBadge.style.display = 'none';
  document.title = 'ChatFC';
};

export const openLightbox = (url) => {
  lightboxImg.src = url;
  lightbox.style.display = 'flex';
};

export const closeLightbox = () => {
  lightbox.style.display = 'none';
};

export const initNotifications = () => {
  notifBadge.addEventListener('click', () => {
    clearMentions();
    const first = messagesList.querySelector('.mentioned');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  lightbox.addEventListener('click', closeLightbox);
};
