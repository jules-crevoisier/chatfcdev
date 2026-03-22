'use strict';

import { TENOR_KEY } from './constants.js';
import state from './state.js';
import { gifPicker, gifSearchEl, gifResultsEl, gifBtn, dmGifBtn, dmInput } from './dom.js';
import { send, fetchJson, positionAboveInput } from './helpers.js';
import { closeMsgEmojiPicker } from './emoji.js';
import { cancelReply } from './messages.js';

const fetchTrendingGifs = async () => {
  gifResultsEl.innerHTML = '<div class="gif-empty">Loading…</div>';
  try {
    const data = await fetchJson(
      `https://api.tenor.com/v1/trending?key=${encodeURIComponent(TENOR_KEY)}&limit=20&media_filter=minimal&contentfilter=medium`);
    renderGifs(data.results || []);
  } catch (_) { gifResultsEl.innerHTML = '<div class="gif-empty">Could not load GIFs.</div>'; }
};

const fetchGifs = async (query) => {
  gifResultsEl.innerHTML = '<div class="gif-empty">Searching…</div>';
  try {
    const data = await fetchJson(
      `https://api.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${encodeURIComponent(TENOR_KEY)}&limit=20&media_filter=minimal&contentfilter=medium`);
    renderGifs(data.results || []);
  } catch (_) { gifResultsEl.innerHTML = '<div class="gif-empty">Search failed.</div>'; }
};

const renderGifs = (results) => {
  gifResultsEl.innerHTML = '';
  if (!results.length) { gifResultsEl.innerHTML = '<div class="gif-empty">No results.</div>'; return; }
  results.forEach(r => {
    const media = r.media && r.media[0]; if (!media) return;
    const small = media.tinygif || media.gif;
    const full  = media.gif || media.tinygif;
    if (!small || !full) return;
    const item = document.createElement('div');
    item.className = 'gif-item';
    const img = document.createElement('img');
    img.src = small.url; img.loading = 'lazy'; img.alt = r.content_description || 'GIF';
    item.appendChild(img);
    item.addEventListener('click', () => {
      if (state.gifContext === 'dm' && state.activeDm) {
        send({
          type: 'direct_message',
          to: state.activeDm,
          content: full.url,
          reply_to: state.replyingTo ? state.replyingTo.id : null,
        });
        cancelReply();
        dmInput.focus();
      } else {
        send({ type: 'message', content: full.url, reply_to: null, channel: state.activeChannel });
      }
      closeGifPicker();
    });
    gifResultsEl.appendChild(item);
  });
};

const openGifPicker = (anchorBtn = gifBtn) => {
  state.activeGif = true;
  positionAboveInput(gifPicker, anchorBtn);
  gifSearchEl.focus();
  if (gifResultsEl.children.length === 0) fetchTrendingGifs();
};

export const closeGifPicker = () => {
  state.activeGif = false;
  gifPicker.style.display = 'none';
};

export const initGifPicker = () => {
  gifSearchEl.addEventListener('input', () => {
    clearTimeout(state.gifDebounce);
    const q = gifSearchEl.value.trim();
    state.gifDebounce = setTimeout(() => { if (q) fetchGifs(q); else fetchTrendingGifs(); }, 400);
  });

  gifBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (state.activeGif) { closeGifPicker(); return; }
    closeMsgEmojiPicker();
    state.gifContext = 'channel';
    openGifPicker(gifBtn);
  });

  dmGifBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (state.activeGif) { closeGifPicker(); return; }
    closeMsgEmojiPicker();
    state.gifContext = 'dm';
    openGifPicker(dmGifBtn);
  });
};
