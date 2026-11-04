import { Game } from './game.js';

function boot() {
  try {
    window.firezone = new Game();
  } catch (err) {
    console.error('[FIREZONE] failed to boot', err);
    const text = document.getElementById('loader-text');
    const pct = document.getElementById('loader-pct');
    if (text) text.textContent = 'FAILED TO START — CHECK CONSOLE';
    if (pct) pct.textContent = 'ERR';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
