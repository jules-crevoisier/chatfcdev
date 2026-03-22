'use strict';

import { THEME_KEY } from './constants.js';

export const applyTheme = (name) => {
  document.body.className = name ? `theme-${name}` : '';
  localStorage.setItem(THEME_KEY, name || '');
  document.querySelectorAll('.theme-dot').forEach(dot =>
    dot.classList.toggle('active', dot.dataset.theme === (name || '')));
};

export const initTheme = () => {
  document.querySelectorAll('.theme-dot').forEach(dot =>
    dot.addEventListener('click', () => applyTheme(dot.dataset.theme)));
  applyTheme(localStorage.getItem(THEME_KEY) || '');
};
