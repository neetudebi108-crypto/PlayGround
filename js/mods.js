/* ============================================================
   FIREZONE — local "mod menu" sandbox
   Offline-only assist tools. Everything stays in this browser.
   ============================================================ */
import * as THREE from '../vendor/three.module.js';

const STORE_KEY = 'firezone_mods_v1';
const PASSWORD = '5555';
const MAX_PITCH = 1.42;

const DEFAULTS = {
  aimbot: false,
  silentAim: false,
  autoHeadshot: false,
  aimlock: false,
  aimkill: false,
  hologram: false,
  fov: 38,
  smooth: 13
};

const LABELS = {
  aimbot: 'AIMBOT',
  silentAim: 'SILENT',
  autoHeadshot: 'HEADSHOT',
  aimlock: 'AIMLOCK',
  aimkill: 'AIMKILL',
  hologram: 'HOLOGRAM'
};

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof raw[key] === typeof DEFAULTS[key]) out[key] = raw[key];
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export class Mods {
  constructor(game) {
    this.game = game;
    this.state = loadState();
    this.unlocked = false;
    this.open = false;
    this._resumeFrom = null;
    this._target = null;
    this._targetTimer = 0;
    this._pulse = 0;
    this._holoMats = null;
    this._bind();
    this._syncPanel();
    this._syncStatus();
  }

  /* ---------------------------------------------------------- */
  /*  UI plumbing                                                */
  /* ---------------------------------------------------------- */
  _$(id) { return document.getElementById(id); }

  _bind() {
    const el = this._$('mod-menu');
    if (!el) return;

    this._$('mods-lobby-btn')?.addEventListener('click', () => this.openMenu());
    this._$('btn-mods')?.addEventListener('click', () => this.openMenu());
    this._$('mods-pause-btn')?.addEventListener('click', () => this.openMenu());
    this._$('mod-close')?.addEventListener('click', () => this.closeMenu());
    this._$('mod-done')?.addEventListener('click', () => this.closeMenu());
    this._$('mod-reset')?.addEventListener('click', () => this.reset());

    this._$('mod-unlock')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.tryUnlock();
    });
    this._$('mod-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.tryUnlock();
    });

    document.querySelectorAll('[data-mod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.mod;
        if (!(key in this.state)) return;
        this.state[key] = !this.state[key];
        this._save();
        this._syncPanel();
        this._syncStatus();
        this._updateHolograms(0);
        if (!this.state.aimlock && !this.state.aimbot) this._target = null;
        this.game.audio?.ui?.();
      });
    });

    const fov = this._$('mod-fov');
    const smooth = this._$('mod-smooth');
    fov?.addEventListener('input', () => {
      this.state.fov = Number(fov.value);
      this._save();
      this._syncPanel();
    });
    smooth?.addEventListener('input', () => {
      this.state.smooth = Number(smooth.value);
      this._save();
      this._syncPanel();
    });

    // Capture phase so the game never sees menu keys while the menu is open.
    window.addEventListener('keydown', (e) => {
      if (this.open) {
        if (e.code === 'Escape' || e.code === 'Backslash' || e.code === 'F9') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeMenu();
          return;
        }
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        e.stopPropagation();
        return;
      }
      if (e.code === 'Backslash' || e.code === 'F9') {
        const s = this.game.state;
        if (s === 'playing' || s === 'paused' || s === 'lobby') {
          e.preventDefault();
          this.openMenu();
        }
      }
    }, true);

    // Clicking the shaded backdrop closes the panel (but not while typing).
    el.addEventListener('mousedown', (e) => {
      if (e.target === el) this.closeMenu();
    });
  }

  openMenu() {
    if (this.open) return;
    const el = this._$('mod-menu');
    if (!el) return;
    this.open = true;
    this._resumeFrom = this.game.state;
    if (this.game.state === 'playing') this.game.pause();
    const done = this._$('mod-done');
    if (done) {
      done.textContent = this._resumeFrom === 'playing'
        ? 'BACK TO MATCH'
        : this._resumeFrom === 'paused' ? 'BACK TO PAUSE' : 'CLOSE';
    }
    el.classList.remove('hidden');
    this._syncPanel();
    if (this.unlocked) {
      this._$('mod-panel')?.classList.remove('hidden');
      this._$('mod-lock')?.classList.add('hidden');
    } else {
      this._$('mod-panel')?.classList.add('hidden');
      this._$('mod-lock')?.classList.remove('hidden');
      setTimeout(() => this._$('mod-password')?.focus(), 60);
    }
    this.game.audio?.ui?.();
  }

  closeMenu() {
    if (!this.open) return;
    this.open = false;
    this._$('mod-menu')?.classList.add('hidden');
    const err = this._$('mod-error');
    if (err) err.textContent = '';
    const pw = this._$('mod-password');
    if (pw) pw.value = '';
    if (this._resumeFrom === 'playing') {
      this.game.resume();
    }
    this._resumeFrom = null;
    this.game.audio?.ui?.();
  }

  tryUnlock() {
    const input = this._$('mod-password');
    const err = this._$('mod-error');
    const value = (input?.value || '').trim();
    if (value === PASSWORD) {
      this.unlocked = true;
      if (input) input.value = '';
      if (err) err.textContent = '';
      this._$('mod-lock')?.classList.add('hidden');
      this._$('mod-panel')?.classList.remove('hidden');
      this.game.audio?.ui?.();
      this._syncPanel();
    } else {
      if (err) {
        err.textContent = 'ACCESS DENIED — INVALID CODE';
        err.classList.remove('shake');
        void err.offsetWidth;
        err.classList.add('shake');
      }
      if (input) {
        input.value = '';
        input.focus();
      }
      this.game.audio?.empty?.();
    }
  }

  reset() {
    this.state = { ...DEFAULTS };
    this._save();
    this._syncPanel();
    this._syncStatus();
    this._updateHolograms(0);
    this._target = null;
    this.game.audio?.ui?.();
  }

  _save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch { /* noop */ }
  }

  _syncPanel() {
    document.querySelectorAll('[data-mod]').forEach((btn) => {
      const on = !!this.state[btn.dataset.mod];
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const fov = this._$('mod-fov');
    if (fov) fov.value = this.state.fov;
    const fovVal = this._$('mod-fov-val');
    if (fovVal) fovVal.textContent = `${Math.round(this.state.fov)}°`;
    const smooth = this._$('mod-smooth');
    if (smooth) smooth.value = this.state.smooth;
    const smoothVal = this._$('mod-smooth-val');
    if (smoothVal) smoothVal.textContent = `${Math.round(this.state.smooth)}`;
    const count = this._$('mod-active-count');
    if (count) count.textContent = `${this.activeCount()} ACTIVE`;
  }

  _syncStatus() {
    const active = Object.keys(LABELS).filter((k) => this.state[k]);
    const chip = this._$('mod-status');
    if (!chip) return;
    chip.classList.toggle('hidden', active.length === 0);
    chip.classList.toggle('danger', this.state.aimkill || this.state.aimlock);
    const text = this._$('mod-status-text');
    if (text) text.textContent = active.map((k) => LABELS[k]).join(' · ');
  }

  /* ---------------------------------------------------------- */
  /*  Targeting                                                  */
  /* ---------------------------------------------------------- */
  _aimPoint(bot) {
    const head = this.state.autoHeadshot || this.state.aimlock;
    return new THREE.Vector3(bot.pos.x, bot.pos.y + (head ? 1.72 : 1.24), bot.pos.z);
  }

  /**
   * Find the best visible enemy inside the aim cone.
   * Uses the live camera forward vector and checks line of sight.
   */
  findTarget(maxDist = 220, fovDeg = null) {
    const g = this.game;
    const p = g.player?.p;
    const camera = g.camera;
    if (!camera || !p || !p.alive || p.dropping) return null;
    const bots = g.botManager?.bots;
    if (!bots || bots.length === 0) return null;

    const origin = camera.position.clone();
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const fov = fovDeg == null ? this.state.fov : fovDeg;
    const cosLimit = Math.cos(THREE.MathUtils.degToRad(Math.max(2, fov) * 0.5));
    const candidates = [];

    for (const bot of bots) {
      if (!bot.alive) continue;
      const point = this._aimPoint(bot);
      const to = point.clone().sub(origin);
      const dist = to.length();
      if (dist < 0.4 || dist > maxDist) continue;
      to.multiplyScalar(1 / dist);
      const dot = to.dot(forward);
      if (dot < cosLimit) continue;
      candidates.push({ bot, point, dist, dot });
    }
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => (b.dot - a.dot) || (a.dist - b.dist));
    const tries = Math.min(candidates.length, 5);
    for (let i = 0; i < tries; i++) {
      const c = candidates[i];
      if (g.world.hasLineOfSight(origin.x, origin.y, origin.z, c.point.x, c.point.y, c.point.z)) {
        return c;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------- */
  /*  Per-frame update                                           */
  /* ---------------------------------------------------------- */
  update(dt) {
    this._updateHolograms(dt);
    const g = this.game;
    if (g.state !== 'playing') return;

    const wantsAim = this.state.aimbot || this.state.aimlock;
    if (!wantsAim) {
      this._target = null;
      return;
    }

    this._targetTimer -= dt;
    if (this._targetTimer <= 0 || !this._target || !this._target.bot.alive) {
      this._target = this.findTarget();
      this._targetTimer = 0.12;
    }
    const target = this._target;
    if (!target) return;

    const p = g.player.p;
    const cam = g.camera;
    const lock = this.state.aimlock;
    const active = lock || p.firing || p.ads;
    if (!active) return;

    const dx = target.point.x - cam.position.x;
    const dy = target.point.y - cam.position.y;
    const dz = target.point.z - cam.position.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const flat = Math.hypot(dx, dz);
    const wantPitch = Math.atan2(dy, flat);
    // Counter the live recoil offset so the camera (not just the state) lands on target.
    const aimYaw = wantYaw - p.recoilYaw;
    const aimPitch = wantPitch - p.recoilPitch;
    const rate = lock ? 60 : 45 / Math.max(2, this.state.smooth);
    const k = lock ? 1 : 1 - Math.exp(-rate * dt);

    let diff = aimYaw - p.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    p.yaw += diff * k;
    p.pitch += (aimPitch - p.pitch) * k;
    p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch));
  }

  /* ---------------------------------------------------------- */
  /*  Hologram ESP                                               */
  /* ---------------------------------------------------------- */
  _holoMaterials() {
    if (!this._holoMats) {
      this._holoMats = {
        ghostMat: new THREE.MeshBasicMaterial({
          color: 0x38e8ff, wireframe: true, transparent: true, opacity: 0.5,
          depthTest: false, depthWrite: false
        }),
        ringMat: new THREE.MeshBasicMaterial({
          color: 0x7ef6ff, transparent: true, opacity: 0.85,
          depthTest: false, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide
        })
      };
    }
    return this._holoMats;
  }

  _makeHologram(bot) {
    const { ghostMat, ringMat } = this._holoMaterials();
    const g = new THREE.Group();
    g.renderOrder = 28;

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.05, 0.46), ghostMat);
    torso.position.y = 1.18;
    torso.renderOrder = 28;
    g.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.38), ghostMat);
    head.position.y = 1.76;
    head.renderOrder = 28;
    g.add(head);

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.4), ghostMat);
    legs.position.y = 0.42;
    legs.renderOrder = 28;
    g.add(legs);

    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.016, 4, 28), ringMat);
    ringA.rotation.x = Math.PI / 2;
    ringA.position.y = 0.12;
    ringA.renderOrder = 29;
    g.add(ringA);

    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.012, 4, 24), ringMat);
    ringB.rotation.x = Math.PI / 2;
    ringB.position.y = 2.03;
    ringB.renderOrder = 29;
    g.add(ringB);

    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), ringMat);
    gem.position.y = 2.38;
    gem.renderOrder = 29;
    g.add(gem);

    g.visible = true;
    bot.mesh.add(g);
    bot.holo = { group: g, ringA, ringB, gem, phase: Math.random() * Math.PI * 2 };
  }

  _updateHolograms(dt) {
    const bots = this.game.botManager?.bots || [];
    const player = this.game.player?.p;
    this._pulse += dt;
    const stateOk = this.game.state === 'playing' || this.game.state === 'paused';
    const enabled = this.state.hologram && stateOk;
    for (const bot of bots) {
      if (!enabled) {
        if (bot.holo) bot.holo.group.visible = false;
        continue;
      }
      if (bot.alive && !bot.holo) this._makeHologram(bot);
      if (!bot.holo) continue;
      const h = bot.holo;
      const near = player
        ? Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z) < 190
        : true;
      h.group.visible = bot.alive && near;
      if (!h.group.visible) continue;
      h.ringA.rotation.z += dt * 1.8;
      h.ringB.rotation.z -= dt * 1.3;
      h.gem.rotation.y += dt * 2.4;
      h.gem.position.y = 2.38 + Math.sin(this._pulse * 2 + h.phase) * 0.06;
      const ghost = this._holoMats?.ghostMat;
      if (ghost) ghost.opacity = 0.42 + Math.sin(this._pulse * 3 + h.phase) * 0.1;
    }
  }

  /** Target for silent aim, resolved at the moment a shot is fired. */
  silentTarget(defRange = 600) {
    if (!this.state.silentAim) return null;
    return this.findTarget(defRange);
  }

  activeCount() {
    return Object.keys(LABELS).filter((k) => this.state[k]).length;
  }
}
