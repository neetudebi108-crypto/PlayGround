/* ============================================================
   FIREZONE — UI / HUD / rank progression
   ============================================================ */

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'firezone_settings_v1';
const PROFILE_KEY = 'firezone_profile_v1';

export const RANKS = [
  { name: 'BRONZE', min: 0, max: 500, letter: 'B', color: '#d28a4a', dark: '#5e3a1e' },
  { name: 'SILVER', min: 500, max: 1000, letter: 'S', color: '#c7d0d7', dark: '#4d565d' },
  { name: 'GOLD', min: 1000, max: 1600, letter: 'G', color: '#ffc94a', dark: '#6b4d0e' },
  { name: 'PLATINUM', min: 1600, max: 2200, letter: 'P', color: '#79e5d6', dark: '#1c5a55' },
  { name: 'DIAMOND', min: 2200, max: 2800, letter: 'D', color: '#7fc7ff', dark: '#1e4b73' },
  { name: 'HEROIC', min: 2800, max: 3400, letter: 'H', color: '#ff8c5a', dark: '#6b2d16' },
  { name: 'GRANDMASTER', min: 3400, max: 4000, letter: 'GM', color: '#ff5e7a', dark: '#66152a' }
];

export function rankFor(rp) {
  const points = Math.max(0, Math.min(3999, Math.round(rp)));
  let current = RANKS[0];
  for (const r of RANKS) if (points >= r.min) current = r;
  const next = RANKS.find(r => r.min > points) || null;
  const span = current.max - current.min;
  const progress = next ? Math.min(1, (points - current.min) / span) : 1;
  return { current, next, progress, points };
}

const DEFAULT_SETTINGS = {
  sensitivity: 1,
  adsSensitivity: 0.75,
  volume: 70,
  quality: 'high',
  invertY: false
};

const COMPASS_DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? { ...fallback, ...v } : { ...fallback };
  } catch { return { ...fallback }; }
}

export class UI {
  constructor() {
    this.settings = loadJSON(SETTINGS_KEY, DEFAULT_SETTINGS);
    this.profile = loadJSON(PROFILE_KEY, {
      rp: 0, matches: 0, wins: 0, kills: 0, preferred: 'ak47', name: 'ROOKIE'
    });
    this.callbacks = {};
    this.isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
    this.world = null;
    this.pickupKey = '';
    this.lastHud = {};
    this.bannerTimer = 0;
    this.zoneWarn = false;
    this._bind();
    this._applySettings();
    this._buildCompass();
    this.updateLobby();
    this.setWeaponSelection(this.profile.preferred || 'ak47', false);
  }

  on(name, fn) { this.callbacks[name] = fn; }

  _bind() {
    if (this.isTouch) document.body.classList.add('touch');

    document.querySelectorAll('[data-setting]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.setting;
        let val = input.type === 'checkbox' ? input.checked : input.value;
        if (input.type === 'range') val = Number(val);
        if (key === 'quality' || key === 'invertY') val = input.type === 'checkbox' ? input.checked : input.value;
        this.settings[key] = val;
        this._syncSettingInputs(key, val);
        this._saveSettings();
        this.callbacks.onSettingsChange?.(this.settings, key);
      });
    });

    $('deploy-btn').addEventListener('click', () => {
      this.callbacks.onDeploy?.(this.profile.preferred || 'ak47');
    });

    document.querySelectorAll('.weapon-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.setWeaponSelection(card.dataset.weapon, true);
        this.profile.preferred = card.dataset.weapon;
        this._saveProfile();
        this.callbacks.onWeaponSelect?.(card.dataset.weapon);
        this.callbacks.onUiSound?.();
      });
    });

    $('resume-btn').addEventListener('click', () => this.callbacks.onResume?.());
    $('quit-btn').addEventListener('click', () => this.callbacks.onQuit?.());
    $('play-again-btn').addEventListener('click', () => this.callbacks.onPlayAgain?.());
    $('back-lobby-btn').addEventListener('click', () => this.callbacks.onBackLobby?.());
    $('dismiss-rotate').addEventListener('click', () => $('rotate-hint').classList.add('hidden'));
    $('lobby-settings-btn').addEventListener('click', () => {
      const screen = $('lobby');
      screen.classList.toggle('show-settings');
      if (window.innerWidth > 960) {
        const panel = $('settings-panel');
        panel.animate([
          { boxShadow: '0 0 0 0 rgba(255,106,26,0)' },
          { boxShadow: '0 0 0 3px rgba(255,106,26,.55)' },
          { boxShadow: '0 0 0 0 rgba(255,106,26,0)' }
        ], { duration: 900 });
      }
    });

    // Keep iOS from scrolling/zooming the page.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('#game-canvas')) e.preventDefault();
    });
  }

  _saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* noop */ }
  }

  _saveProfile() {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile)); } catch { /* noop */ }
  }

  _syncSettingInputs(key, val) {
    document.querySelectorAll(`[data-setting="${key}"]`).forEach((el) => {
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = val;
    });
    document.querySelectorAll(`[data-value-for="${key}"]`).forEach((el) => {
      if (key === 'volume') el.textContent = String(Math.round(Number(val)));
      else el.textContent = Number(val).toFixed(2);
    });
  }

  _applySettings() {
    for (const [key, val] of Object.entries(this.settings)) this._syncSettingInputs(key, val);
  }

  _buildCompass() {
    const strip = $('compass-strip');
    strip.innerHTML = '';
    for (let deg = -360; deg <= 720; deg += 15) {
      const span = document.createElement('span');
      const idx = ((deg % 360) + 360) % 360;
      const dir = COMPASS_DIRS[Math.round(idx / 22.5) % 16];
      span.textContent = dir;
      if (idx % 90 === 0) span.className = 'major';
      strip.appendChild(span);
    }
    this.compassStrip = strip;
  }

  setWorld(world) {
    this.world = world;
    this.minimapCtx = $('minimap').getContext('2d');
  }

  setLoading(pct, text) {
    $('loader-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    $('loader-pct').textContent = `${Math.round(pct)}%`;
    if (text) $('loader-text').textContent = text;
  }

  hideLoading() {
    const el = $('loading');
    el.style.opacity = '0';
    setTimeout(() => el.classList.add('hidden'), 380);
  }

  showLobby() {
    $('lobby').classList.remove('hidden');
    $('lobby').classList.remove('show-settings');
    $('results').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('hud').classList.add('hidden');
    this.updateLobby();
  }

  hideLobby() {
    $('lobby').classList.add('hidden');
    $('lobby').classList.remove('show-settings');
  }

  updateLobby() {
    const r = rankFor(this.profile.rp);
    const shield = document.querySelector('.rank-shield');
    if (shield) {
      shield.style.borderColor = r.current.color;
      shield.style.background = `linear-gradient(160deg, ${r.current.color}66, ${r.current.dark} 55%, #120b06)`;
      shield.style.boxShadow = `inset 0 0 26px ${r.current.color}44, 0 0 24px ${r.current.color}33`;
    }
    $('rank-letter').textContent = r.current.letter;
    $('rank-tier').textContent = r.current.name;
    $('rank-tier').style.color = r.current.color;
    $('rank-points').textContent = r.points;
    $('rank-fill').style.width = `${r.progress * 100}%`;
    $('rank-fill').style.background = `linear-gradient(90deg, ${r.current.dark}, ${r.current.color})`;
    if (r.next) {
      $('rank-next-label').textContent = `${r.next.min - r.points} RP TO ${r.next.name}`;
      $('rank-next-value').textContent = `${r.points} / ${r.next.min}`;
    } else {
      $('rank-next-label').textContent = 'MAX RANK REACHED';
      $('rank-next-value').textContent = `${r.points} / 4000`;
    }
    $('stat-matches').textContent = this.profile.matches;
    $('stat-wins').textContent = this.profile.wins;
    $('stat-kills').textContent = this.profile.kills;
    $('profile-name').textContent = this.profile.name || 'ROOKIE';
    $('profile-matches').textContent = `${this.profile.matches} MATCHES`;
  }

  setWeaponSelection(id, playSound = true) {
    document.querySelectorAll('.weapon-card').forEach((c) => {
      c.classList.toggle('selected', c.dataset.weapon === id);
    });
    if (playSound) this.callbacks.onUiSound?.();
  }

  setHudVisible(visible) {
    $('hud').classList.toggle('hidden', !visible);
  }

  showPause(stats) {
    $('pause').classList.remove('hidden');
    if (stats) {
      $('pause-alive').textContent = stats.alive;
      $('pause-kills').textContent = stats.kills;
      $('pause-damage').textContent = stats.damage;
      $('pause-time').textContent = stats.time;
    }
  }

  hidePause() { $('pause').classList.add('hidden'); }

  updateHealth(health, max, healing, healProgress) {
    const pct = Math.max(0, Math.min(1, health / max));
    const key = `${Math.round(pct * 100)}|${healing}|${Math.round(healProgress * 100)}`;
    if (this.lastHud.healthKey === key) return;
    this.lastHud.healthKey = key;
    $('health-value').textContent = Math.ceil(Math.max(0, health));
    $('health-fill').style.width = `${pct * 100}%`;
    $('health-fill').classList.toggle('warn', pct <= 0.5 && pct > 0.25);
    $('health-fill').classList.toggle('crit', pct <= 0.25);
    $('low-health').classList.toggle('active', pct <= 0.28 && health > 0);
    const healEl = $('heal-progress');
    healEl.classList.toggle('hidden', !healing);
    if (healing) healEl.querySelector('i').style.width = `${healProgress * 100}%`;
  }

  setMedkits(n) {
    if (this.lastHud.medkits === n) return;
    this.lastHud.medkits = n;
    $('medkit-count').textContent = n;
  }

  updateWeapon(state) {
    const key = `${state.weapon}|${state.mag}|${state.reserve}|${state.reloading}|${state.slots.map(s => s.name + s.active).join(',')}`;
    if (this.lastHud.weaponKey === key) {
      if (state.reloading) this.updateReload(state.reloadProgress);
      return;
    }
    this.lastHud.weaponKey = key;
    $('weapon-name').textContent = state.weapon;
    $('weapon-cat').textContent = state.category;
    $('ammo-mag').textContent = state.mag;
    $('ammo-mag').classList.toggle('empty', state.mag === 0);
    $('ammo-reserve').textContent = state.reserve;
    const slots = $('weapon-slots');
    slots.innerHTML = '';
    state.slots.forEach((s, i) => {
      const el = document.createElement('span');
      el.className = 'wslot' + (s.active ? ' active' : '');
      el.innerHTML = `<b>${i + 1}</b> ${s.name}`;
      slots.appendChild(el);
    });
    const bar = $('reload-bar');
    bar.classList.toggle('hidden', !state.reloading);
    this.updateReload(state.reloadProgress);
  }

  updateReload(progress) {
    const bar = $('reload-bar');
    if (!bar.classList.contains('hidden')) bar.querySelector('i').style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }

  updateMatch(alive, kills) {
    if (this.lastHud.alive !== alive) { this.lastHud.alive = alive; $('alive-count').textContent = alive; }
    if (this.lastHud.kills !== kills) { this.lastHud.kills = kills; $('kill-count').textContent = kills; }
  }

  updateZone(phase, seconds, outside, nextSeconds = null) {
    const t = Math.max(0, Math.ceil(seconds));
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    const label = outside ? 'STORM' : `ZONE ${phase}`;
    if (this.lastHud.zone !== `${label}${mm}${ss}`) {
      this.lastHud.zone = `${label}${mm}${ss}`;
      $('zone-phase').textContent = label;
      $('zone-timer').textContent = `${mm}:${ss}`;
    }
    const chip = document.querySelector('.zone-chip');
    chip.classList.toggle('warn', outside);
    $('storm-warning').classList.toggle('hidden', !outside);
  }

  updateCompass(yaw) {
    const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const idx = (heading + 360) / 15;
    const offset = 120 - idx * 60;
    this.compassStrip.style.transform = `translateX(${offset}px)`;
  }

  setPickup(pickup) {
    const key = pickup ? `${pickup.action}|${pickup.name}|${pickup.sub}` : '';
    if (key === this.pickupKey) return;
    this.pickupKey = key;
    const el = $('pickup-prompt');
    if (!pickup) { el.classList.add('hidden'); return; }
    $('pickup-action').textContent = pickup.action;
    $('pickup-name').textContent = pickup.name;
    $('pickup-sub').textContent = pickup.sub || '';
    el.classList.remove('hidden');
  }

  showBanner(kicker, text, duration = 2200) {
    $('banner-kicker').textContent = kicker;
    $('banner-text').textContent = text;
    const el = $('banner');
    el.classList.remove('hidden');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  showHitmarker(kill = false, head = false) {
    const el = $('hitmarker');
    el.classList.remove('show', 'kill');
    if (head) el.style.filter = 'drop-shadow(0 0 4px #ffd23f)';
    else el.style.filter = '';
    void el.offsetWidth;
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  damageNumber(x, y, amount, head = false) {
    const container = $('damage-numbers');
    const el = document.createElement('div');
    el.className = 'dmg-num' + (head ? ' head' : '');
    el.textContent = head ? `${amount} HEAD` : String(amount);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  addKill(killer, victim, weapon, opts = {}) {
    const feed = $('killfeed');
    const item = document.createElement('div');
    item.className = 'kill-item' + (opts.me ? ' me' : '') + (opts.head ? ' head' : '');
    const k = document.createElement('span'); k.className = 'k-killer'; k.textContent = killer;
    const w = document.createElement('span'); w.className = 'k-weapon'; w.textContent = weapon;
    const v = document.createElement('span'); v.className = 'k-victim'; v.textContent = victim;
    item.append(k, w, v);
    feed.prepend(item);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => item.remove(), 7000);
  }

  setFps(fps) {
    const el = $('fps-meter');
    if (el) el.textContent = `${Math.round(fps)} FPS`;
  }

  setScope(active) {
    $('scope-overlay').classList.toggle('hidden', !active);
    $('crosshair').classList.toggle('hide', active);
  }

  setCrosshairGap(gap, enemy = false) {
    document.documentElement.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    $('crosshair').classList.toggle('enemy', enemy);
  }

  showDamageFlash() {
    const el = $('damage-flash');
    el.style.opacity = '1';
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { el.style.opacity = '0'; }, 90);
  }

  showResults(data) {
    $('results').classList.remove('hidden');
    $('hud').classList.add('hidden');
    const title = $('result-title');
    title.textContent = data.win ? 'BOOYAH!' : 'ELIMINATED';
    title.classList.toggle('lost', !data.win);
    $('result-kicker').textContent = data.win ? 'VICTORY ROYALE' : 'MATCH COMPLETE';
    $('result-place').textContent = data.placement;
    $('result-place-total').textContent = `/ ${data.total}`;
    $('result-sub').textContent = data.win ? 'LAST ONE STANDING' : data.subtitle || 'BETTER LUCK NEXT DROP';
    $('result-kills').textContent = data.kills;
    $('result-damage').textContent = Math.round(data.damage);
    $('result-time').textContent = data.time;
    $('result-acc').textContent = `${Math.round(data.accuracy)}%`;
    const rank = rankFor(data.rp);
    $('result-rank-gain').textContent = `+${data.rpGain} RP`;
    $('result-rank-tier').textContent = rank.current.name;
    $('result-rank-tier').style.color = rank.current.color;
    $('result-rank-points').textContent = `${rank.points} RP`;
    const fill = $('result-rank-fill');
    fill.style.width = `${rank.progress * 100}%`;
    fill.style.background = `linear-gradient(90deg, ${rank.current.dark}, ${rank.current.color})`;
    $('result-rank-gain').style.color = rank.current.color;
  }

  hideResults() { $('results').classList.add('hidden'); }

  updateMinimap(state) {
    if (!this.world || !this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const S = 240;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.world.minimapCanvas, 0, 0, S, S);
    const toPx = (x, z) => [((x + 500) / 1000) * S, ((z + 500) / 1000) * S];

    // Storm overlay
    const [zx, zy] = toPx(state.zone.x, state.zone.z);
    const zr = (state.zone.radius / 1000) * S;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.arc(zx, zy, zr, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(126, 37, 177, .38)';
    ctx.fill('evenodd');
    ctx.restore();
    ctx.beginPath();
    ctx.arc(zx, zy, zr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(190, 120, 255, .95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    if (state.zone.nextRadius && state.zone.nextRadius > 0) {
      const [nx, ny] = toPx(state.zone.nextX, state.zone.nextZ);
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.arc(nx, ny, (state.zone.nextRadius / 1000) * S, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // POIs
    for (const p of state.pois) {
      const [px, py] = toPx(p.x, p.z);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 7px Rajdhani, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.72)';
      ctx.textAlign = 'center';
      ctx.fillText(p.short, px, py - 5);
    }

    // Nearby loot
    for (const l of state.nearLoot || []) {
      const [lx, ly] = toPx(l.x, l.z);
      ctx.fillStyle = 'rgba(255,210,63,.9)';
      ctx.fillRect(lx - 1, ly - 1, 2, 2);
    }

    // Nearby enemies
    for (const b of state.nearBots || []) {
      const [bx, by] = toPx(b.x, b.z);
      ctx.beginPath();
      ctx.arc(bx, by, 2.3, 0, Math.PI * 2);
      ctx.fillStyle = b.visible ? '#ff4a3d' : 'rgba(255,74,61,.45)';
      ctx.fill();
    }

    // Player arrow
    const [px, py] = toPx(state.player.x, state.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-state.player.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(4.4, 5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.4, 5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Compass north
    ctx.font = '700 8px Rajdhani, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.textAlign = 'center';
    ctx.fillText('N', S / 2, 10);
  }

  addProfileResult({ win, kills, placement }) {
    this.profile.matches += 1;
    this.profile.kills += kills;
    if (win) this.profile.wins += 1;
    if (placement <= 10) { /* handled via rp */ }
    this._saveProfile();
    this.updateLobby();
  }

  addRankPoints(points) {
    this.profile.rp = Math.max(0, Math.min(3999, this.profile.rp + Math.round(points)));
    this._saveProfile();
    this.updateLobby();
    return this.profile.rp;
  }

  applyVolume() {
    this.callbacks.onSettingsChange?.(this.settings, 'volume');
  }
}
