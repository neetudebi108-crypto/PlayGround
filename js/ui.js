import * as THREE from '../vendor/three.module.js';
import { LANDMARKS, MAP, riverCenterX, riverWidth, dist } from './world.js';

/* ============================================================
   UI / HUD
   ============================================================ */
const $ = id => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      boot: $('boot'), bootFill: $('boot-fill'), bootNote: $('boot-note'),
      lobby: $('lobby'), startBtn: $('start-btn'), lobbySens: $('lobby-sensitivity'), lobbySensVal: $('lobby-sensitivity-value'),
      hud: $('hud'), hpValue: $('hp-value'), hpFill: $('hp-fill'), healthBar: document.querySelector('.health-bar'), hpState: $('hp-state'),
      weaponName: $('weapon-name'), weaponClass: $('weapon-class'), fireMode: $('fire-mode'),
      ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammoFill: $('ammo-fill'),
      weaponDamage: $('weapon-damage'), weaponRange: $('weapon-range'), weaponReload: $('weapon-reload'),
      medCount: $('med-count'), alive: $('alive-count'), kills: $('kill-count'), placement: $('placement'),
      killfeed: $('killfeed'), zoneLabel: $('zone-label'), zoneTimer: $('zone-timer'), zoneBar: $('zone-bar'),
      zoneWarning: $('zone-warning'), stormDps: $('storm-dps'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), damageLayer: $('world-labels'),
      botLabels: $('bot-labels'), interact: $('interact-prompt'), interactTitle: $('interact-title'), interactSub: $('interact-sub'),
      touchInteract: $('touch-interact'), reloadRing: $('reload-ring'), reloadArc: $('reload-arc'),
      toast: $('toast'), damageVignette: $('damage-vignette'), hitDirection: $('hit-direction'),
      scope: $('scope-overlay'), scopeRange: $('scope-range'),
      pause: $('pause'), pauseKills: $('pause-kills'), pauseDamage: $('pause-damage'), pauseAlive: $('pause-alive'),
      settings: $('settings-modal'), end: $('end-screen'), endCard: document.querySelector('.end-card'),
      endRank: $('end-rank'), endKicker: $('end-kicker'), endTitle: $('end-title'), endSub: $('end-sub'),
      endPlacement: $('end-placement'), endKills: $('end-kills'), endDamage: $('end-damage'), endTime: $('end-time'),
      settingsSens: $('settings-sensitivity'), settingsSensVal: $('settings-sensitivity-value'),
      settingsAds: $('settings-ads'), settingsAdsVal: $('settings-ads-value'),
      settingsFov: $('settings-fov'), settingsFovVal: $('settings-fov-value'),
      settingsVolume: $('settings-volume'), settingsVolumeVal: $('settings-volume-value'),
      compass: $('compass'), compassMarks: $('compass-marks'),
      touchUI: $('touch-ui'), minimap: $('minimap'),
      slotEls: [...document.querySelectorAll('.slot')],
      hintBar: $('hint-bar'), rotate: $('rotate-hint'),
    };
    this.miniCtx = this.el.minimap.getContext('2d');
    this.labels = new Map();
    this.compassSpans = [];
    this.killfeeds = [];
    this.damageNumbers = [];
    this.toastTimer = 0;
    this.buildCompass();
    this.bindSettings();
    this.settings = this.readSettings();
    this.applySettingsToInputs();
  }

  readSettings() {
    const get = (k, d) => {
      const v = parseFloat(localStorage.getItem(k));
      return Number.isFinite(v) ? v : d;
    };
    return {
      sensitivity: get('fz-sens', 1.0),
      adsSens: get('fz-ads', .65),
      fov: get('fz-fov', 86),
      volume: get('fz-vol', .65),
    };
  }

  saveSettings() {
    localStorage.setItem('fz-sens', this.settings.sensitivity);
    localStorage.setItem('fz-ads', this.settings.adsSens);
    localStorage.setItem('fz-fov', this.settings.fov);
    localStorage.setItem('fz-vol', this.settings.volume);
  }

  fillRange(input) {
    const min = parseFloat(input.min) || 0, max = parseFloat(input.max) || 100;
    const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', pct + '%');
  }

  applySettingsToInputs() {
    const s = this.settings;
    const sensPct = Math.round(s.sensitivity * 100);
    const adsPct = Math.round(s.adsSens * 100);
    this.el.lobbySens.value = sensPct;
    this.el.lobbySensVal.textContent = s.sensitivity.toFixed(2) + '×';
    this.el.settingsSens.value = sensPct;
    this.el.settingsSensVal.textContent = s.sensitivity.toFixed(2) + '×';
    this.el.settingsAds.value = adsPct;
    this.el.settingsAdsVal.textContent = s.adsSens.toFixed(2) + '×';
    this.el.settingsFov.value = Math.round(s.fov);
    this.el.settingsFovVal.textContent = Math.round(s.fov) + '°';
    this.el.settingsVolume.value = Math.round(s.volume * 100);
    this.el.settingsVolumeVal.textContent = Math.round(s.volume * 100) + '%';
    for (const i of [this.el.lobbySens, this.el.settingsSens, this.el.settingsAds, this.el.settingsFov, this.el.settingsVolume]) this.fillRange(i);
  }

  bindSettings() {
    const updateSens = v => {
      this.settings.sensitivity = v;
      this.el.lobbySens.value = Math.round(v * 100);
      this.el.settingsSens.value = Math.round(v * 100);
      this.el.lobbySensVal.textContent = v.toFixed(2) + '×';
      this.el.settingsSensVal.textContent = v.toFixed(2) + '×';
      for (const i of [this.el.lobbySens, this.el.settingsSens]) this.fillRange(i);
      this.saveSettings();
      this.onSettings?.(this.settings);
    };
    this.el.lobbySens.addEventListener('input', e => updateSens(parseFloat(e.target.value) / 100));
    this.el.settingsSens.addEventListener('input', e => updateSens(parseFloat(e.target.value) / 100));
    this.el.settingsAds.addEventListener('input', e => {
      this.settings.adsSens = parseFloat(e.target.value) / 100;
      this.el.settingsAdsVal.textContent = this.settings.adsSens.toFixed(2) + '×';
      this.fillRange(e.target); this.saveSettings(); this.onSettings?.(this.settings);
    });
    this.el.settingsFov.addEventListener('input', e => {
      this.settings.fov = parseFloat(e.target.value);
      this.el.settingsFovVal.textContent = Math.round(this.settings.fov) + '°';
      this.fillRange(e.target); this.saveSettings(); this.onSettings?.(this.settings);
    });
    this.el.settingsVolume.addEventListener('input', e => {
      this.settings.volume = parseFloat(e.target.value) / 100;
      this.el.settingsVolumeVal.textContent = Math.round(this.settings.volume * 100) + '%';
      this.fillRange(e.target); this.saveSettings(); this.onSettings?.(this.settings);
    });
  }

  buildCompass() {
    const cards = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let deg = 0; deg < 360; deg += 15) {
      const span = document.createElement('span');
      const cardinal = deg % 45 === 0 ? cards[(deg / 45) % 8] : '';
      if (cardinal) { span.className = 'card' + (cardinal === 'N' ? ' n' : ''); span.textContent = cardinal; }
      else span.textContent = '·';
      this.el.compassMarks.appendChild(span);
      this.compassSpans.push({ el: span, deg });
    }
  }

  updateCompass(heading) {
    for (const s of this.compassSpans) {
      let d = ((s.deg - heading + 540) % 360) - 180;
      if (Math.abs(d) > 68) { s.el.style.display = 'none'; continue; }
      s.el.style.display = '';
      s.el.style.left = (50 + d / 68 * 50) + '%';
    }
  }

  boot(progress, note) {
    this.el.bootFill.style.width = Math.round(progress * 100) + '%';
    if (note) this.el.bootNote.textContent = note;
  }

  hideBoot() {
    this.el.boot.classList.add('done');
    this.el.lobby.classList.remove('hidden');
  }

  showLobby() {
    this.el.lobby.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.end.classList.add('hidden');
    this.el.settings.classList.add('hidden');
    this.el.scope.classList.add('hidden');
    this.hideTouch();
    document.body.classList.remove('in-match');
  }

  showGame() {
    this.el.lobby.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    document.body.classList.add('in-match');
  }

  showTouch() { this.el.touchUI.classList.remove('hidden'); }
  hideTouch() { this.el.touchUI.classList.add('hidden'); }

  resetHUD() {
    this.el.killfeed.innerHTML = '';
    this.labels.forEach(l => l.el.remove());
    this.labels.clear();
    this.damageNumbers.forEach(d => d.remove());
    this.damageNumbers = [];
    this.killfeeds = [];
    this.el.hitmarker.classList.remove('show', 'kill');
    this.el.zoneWarning.classList.add('hidden');
    this.el.interact.classList.add('hidden');
    this.el.touchInteract.classList.add('hidden');
    this.el.reloadRing.classList.add('hidden');
    this.el.toast.classList.remove('show');
    this.el.damageVignette.style.opacity = 0;
    this.el.hitDirection.style.opacity = 0;
    this.el.scope.classList.add('hidden');
  }

  updateHUD(s) {
    const hp = Math.max(0, Math.round(s.health));
    this.el.hpValue.textContent = hp;
    this.el.hpFill.style.width = Math.max(0, Math.min(100, hp / s.maxHealth * 100)) + '%';
    this.el.healthBar.classList.toggle('low', hp < s.maxHealth * .3);
    this.el.healthBar.classList.toggle('mid', hp >= s.maxHealth * .3 && hp < s.maxHealth * .7);
    this.el.hpState.textContent = hp === s.maxHealth ? 'FULL HEALTH' : hp < s.maxHealth * .3 ? 'CRITICAL' : 'INJURED';

    const w = s.weapon;
    this.el.weaponName.textContent = w.name;
    this.el.weaponClass.textContent = w.className;
    this.el.fireMode.textContent = w.auto ? 'AUTO' : 'BOLT';
    this.el.ammoMag.textContent = s.mag;
    this.el.ammoReserve.textContent = s.reserve;
    this.el.ammoFill.style.width = (s.mag / w.mag * 100) + '%';
    this.el.ammoFill.style.background = s.mag <= Math.ceil(w.mag * .2) ? 'var(--red)' : 'var(--orange)';
    this.el.weaponDamage.textContent = 'DMG ' + w.damage;
    this.el.weaponRange.textContent = 'RANGE ' + w.range + 'M';
    this.el.weaponReload.textContent = 'RELOAD ' + w.reload.toFixed(1) + 'S';
    this.el.medCount.textContent = s.medkits;
    this.el.alive.textContent = s.alive + ' ALIVE';
    this.el.kills.textContent = s.kills + ' KILLS';
    this.el.placement.textContent = '#' + s.placement;

    this.el.zoneBar.classList.toggle('shrink', s.zoneState === 'shrinking');
    this.el.zoneBar.classList.toggle('danger', s.zoneState === 'danger');
    this.el.zoneLabel.textContent = s.zoneState === 'final' ? 'FINAL ZONE' : s.zoneState === 'danger' ? 'STORM CLOSING' : s.zoneState === 'shrinking' ? 'ZONE SHRINKING' : 'SAFE ZONE';
    this.el.zoneTimer.textContent = s.zoneTimer;

    this.el.zoneWarning.classList.toggle('hidden', !s.outside);
    if (s.outside) this.el.stormDps.textContent = '-' + Math.round(s.stormDps) + ' HP/S';

    for (const slot of this.el.slotEls) {
      const id = slot.dataset.slot;
      const owned = !!s.inventory[id];
      slot.classList.toggle('owned', owned);
      slot.classList.toggle('active', owned && s.activeId === id);
    }
    this.el.crosshair.classList.toggle('ads', s.ads);
    this.el.crosshair.style.setProperty('--spread', s.crosshair + 'px');
    this.el.crosshair.classList.toggle('hidden-cross', s.scoped);
    this.el.scope.classList.toggle('hidden', !s.scoped);
    if (s.scoped) this.el.scopeRange.textContent = s.scopeRange + ' M';

    if (s.reloading) {
      this.el.reloadRing.classList.remove('hidden');
      this.el.reloadArc.style.strokeDashoffset = String(207 * (1 - s.reloadProgress));
    } else this.el.reloadRing.classList.add('hidden');
  }

  showInteract(title, sub) {
    this.el.interact.classList.remove('hidden');
    this.el.interactTitle.textContent = title;
    this.el.interactSub.textContent = sub;
    this.el.touchInteract.classList.remove('hidden');
  }
  hideInteract() {
    this.el.interact.classList.add('hidden');
    this.el.touchInteract.classList.add('hidden');
  }

  showToast(text, time = 1.8) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = time;
  }
  updateToast(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  hitmarker(kill = false, head = false) {
    const hm = this.el.hitmarker;
    hm.classList.remove('show', 'kill');
    void hm.offsetWidth;
    hm.classList.add('show');
    if (kill) hm.classList.add('kill');
    if (head) hm.style.filter = 'drop-shadow(0 0 5px #ffc857)';
    else hm.style.filter = '';
  }

  popDamage(worldPos, amount, type, camera) {
    const v = worldPos.clone().project(camera);
    if (v.z > 1 || v.z < -1) return;
    const x = (v.x * .5 + .5) * window.innerWidth;
    const y = (-v.y * .5 + .5) * window.innerHeight;
    if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) return;
    const el = document.createElement('div');
    el.className = 'damage-number' + (type === 'head' ? ' head' : type === 'kill' ? ' kill' : '');
    el.textContent = type === 'kill' ? 'ELIMINATED' : (type === 'head' ? 'HEADSHOT ' : '') + Math.round(amount);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    this.el.damageLayer.appendChild(el);
    this.damageNumbers.push(el);
    const cleanup = () => { el.remove(); this.damageNumbers = this.damageNumbers.filter(d => d !== el); };
    el.addEventListener('animationend', cleanup);
    setTimeout(cleanup, 1600);
  }

  flashDamage(intensity = .65) {
    const v = this.el.damageVignette;
    v.style.transition = 'none';
    v.style.opacity = String(intensity);
    requestAnimationFrame(() => { v.style.transition = 'opacity .55s ease'; v.style.opacity = '0'; });
  }

  showHitDirection(angleDeg) {
    const h = this.el.hitDirection;
    h.style.setProperty('--dir', angleDeg + 'deg');
    h.style.transition = 'none'; h.style.opacity = '.95';
    requestAnimationFrame(() => { h.style.transition = 'opacity .7s ease'; h.style.opacity = '0'; });
  }

  addKill(killer, victim, headshot = false, playerInvolved = false) {
    const div = document.createElement('div');
    const k = killer === 'YOU' ? '<span class="you">YOU</span>' : `<b>${killer}</b>`;
    const v = victim === 'YOU' ? '<span class="you">YOU</span>' : `<b>${victim}</b>`;
    div.innerHTML = `${k} <span class="hs">${headshot ? '⌖' : '›'}</span> ${v}`;
    if (playerInvolved) div.style.borderLeftColor = 'var(--orange)';
    this.el.killfeed.appendChild(div);
    this.killfeeds.push({ el: div, t: 5.4 });
    while (this.killfeeds.length > 5) { const old = this.killfeeds.shift(); old.el.remove(); }
  }

  updateKillfeed(dt) {
    for (const k of this.killfeeds) {
      k.t -= dt;
      k.el.style.opacity = String(Math.min(1, k.t));
    }
    this.killfeeds = this.killfeeds.filter(k => {
      if (k.t <= 0) { k.el.remove(); return false; }
      return true;
    });
  }

  updateLabels(bots, player, camera, aimedBot) {
    const w = window.innerWidth, h = window.innerHeight;
    for (const bot of bots) {
      let entry = this.labels.get(bot.idx);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'bot-label';
        el.innerHTML = `<b>${bot.name}</b><span class="bhp"><i></i></span>`;
        this.el.botLabels.appendChild(el);
        entry = { el, bar: el.querySelector('.bhp i') };
        this.labels.set(bot.idx, entry);
      }
      const d = dist(bot.position.x, bot.position.z, player.position.x, player.position.z);
      if (!bot.alive || d > 150) { entry.el.style.display = 'none'; continue; }
      const v = new THREE.Vector3(bot.position.x, bot.position.y + 2.02, bot.position.z).project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { entry.el.style.display = 'none'; continue; }
      entry.el.style.display = '';
      entry.el.style.transform = `translate(${(v.x * .5 + .5) * w}px, ${(-v.y * .5 + .5) * h}px) translate(-50%, -100%)`;
      entry.bar.style.width = Math.max(0, bot.health / bot.maxHealth * 100) + '%';
      entry.el.classList.toggle('aimed', aimedBot === bot);
    }
  }

  drawMinimap(player, bots, zone, heading, world) {
    const ctx = this.miniCtx;
    const W = this.el.minimap.width, H = this.el.minimap.height;
    const cx = W / 2, cy = H / 2;
    const R = W / 2 - 3;
    const scale = R / (MAP.half + 20);
    const wx = x => cx + x * scale;
    const wz = z => cy + z * scale;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    // island base
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bg.addColorStop(0, '#35533a'); bg.addColorStop(1, '#1d2e21');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // vegetation blobs
    ctx.globalAlpha = .2;
    for (const l of LANDMARKS) {
      ctx.fillStyle = l.color;
      ctx.beginPath(); ctx.arc(wx(l.x), wz(l.z), l.radius * scale * .9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // river
    ctx.strokeStyle = '#2c7d93'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let z = -480; z <= 480; z += 12) {
      const x = riverCenterX(z);
      if (z === -480) ctx.moveTo(wx(x), wz(z)); else ctx.lineTo(wx(x), wz(z));
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,220,235,.24)'; ctx.lineWidth = 2;
    ctx.stroke();
    // roads
    ctx.strokeStyle = 'rgba(208,184,140,.42)'; ctx.lineWidth = 2.4;
    for (const path of world.roadPaths) {
      ctx.beginPath();
      path.forEach((p, i) => { if (i === 0) ctx.moveTo(wx(p.x), wz(p.z)); else ctx.lineTo(wx(p.x), wz(p.z)); });
      ctx.stroke();
    }
    // zone
    const zx = wx(zone.x), zy = wz(zone.z), zr = zone.radius * scale;
    ctx.strokeStyle = 'rgba(98,229,255,.9)'; ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(98,229,255,.7)'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(zx, zy, zr, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    if (zone.nextRadius > zone.radius) {
      ctx.strokeStyle = 'rgba(98,229,255,.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(zx, zy, zone.nextRadius * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // landmarks
    for (const l of LANDMARKS) {
      const x = wx(l.x), y = wz(l.z);
      ctx.fillStyle = l.color;
      ctx.globalAlpha = .95;
      ctx.fillRect(x - 3, y - 3, 6, 6);
      ctx.globalAlpha = .9;
      ctx.font = '600 7px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.fillText(l.short, x, y - 6);
      ctx.globalAlpha = 1;
    }
    // nearby hostiles
    for (const bot of bots) {
      if (!bot.alive) continue;
      const d = dist(bot.position.x, bot.position.z, player.position.x, player.position.z);
      if (d > 170) continue;
      ctx.fillStyle = '#ff4b3e';
      ctx.beginPath(); ctx.arc(wx(bot.position.x), wz(bot.position.z), 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // player
    const px = wx(player.position.x), py = wz(player.position.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading * Math.PI / 180);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255,122,31,.9)'; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    // heading cone
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-heading * Math.PI / 180);
    const cone = ctx.createLinearGradient(0, 0, 0, -42);
    cone.addColorStop(0, 'rgba(255,255,255,.2)'); cone.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-20, -44); ctx.lineTo(20, -44); ctx.closePath(); ctx.fill();
    ctx.restore();
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(W * i / 4, 0); ctx.lineTo(W * i / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H * i / 4); ctx.lineTo(W, H * i / 4); ctx.stroke();
    }
    ctx.restore();
    // edge
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    // player coords
    ctx.font = '600 7px "Barlow Condensed", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(player.position.x)}, ${Math.round(player.position.z)}`, 10, H - 10);
  }

  showPause(show) { this.el.pause.classList.toggle('hidden', !show); }
  showSettings(show) { this.el.settings.classList.toggle('hidden', !show); }
  settingsOpen() { return !this.el.settings.classList.contains('hidden'); }

  showEnd(win, stats) {
    this.el.end.classList.remove('hidden');
    this.el.endCard.classList.toggle('win', win);
    this.el.endKicker.textContent = win ? 'MATCH VICTORY' : 'MATCH COMPLETE';
    this.el.endTitle.textContent = win ? 'BOOYAH!' : 'ELIMINATED';
    this.el.endSub.textContent = win ? 'Last operator standing on Isla Verde.' : 'The island claims another operator. Drop again?';
    this.el.endRank.textContent = '#' + stats.placement;
    this.el.endPlacement.textContent = '#' + stats.placement;
    this.el.endKills.textContent = stats.kills;
    this.el.endDamage.textContent = Math.round(stats.damage);
    this.el.endTime.textContent = formatTime(stats.time);
    this.el.end.classList.toggle('win', win);
  }
  hideEnd() { this.el.end.classList.add('hidden'); }

  setPauseStats(kills, damage, alive) {
    this.el.pauseKills.textContent = kills;
    this.el.pauseDamage.textContent = Math.round(damage);
    this.el.pauseAlive.textContent = alive;
  }

  showRotateHint(show) { this.el.rotate.classList.toggle('hidden', !show); }
}

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function formatZoneTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
