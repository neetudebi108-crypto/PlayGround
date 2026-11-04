import * as THREE from '../vendor/three.module.js';
import { World, POIS, HALF, WATER_LEVEL } from './world.js';
import { WEAPONS, makeLootWeapon, makeAmmoBox, makeMedkit } from './weapons.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { Sky, ParticleSystem, TracerSystem } from './effects.js';
import { Player } from './player.js';
import { BotManager } from './bots.js';
import { Mods } from './mods.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ui = new UI();
    this.audio = new AudioEngine(this.ui.settings.volume / 100);
    this.state = 'loading';
    this.time = 0;
    this.matchTime = 0;
    this.lobbyAngle = 0.7;
    this.preferred = WEAPONS[this.ui.profile.preferred] ? this.ui.profile.preferred : 'ak47';
    this.keys = {};
    this.touchMove = { x: 0, y: 0 };
    this.touchLook = { x: 0, y: 0 };
    this.crouchToggle = false;
    this.jumpQueued = false;
    this.loot = [];
    this.nearLoot = null;
    this.bots = [];
    this.zone = null;
    this.matchGroup = null;
    this.matchEnded = false;
    this.pendingResult = null;
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.minimapTimer = 0;
    this.crosshairTimer = 0;
    this.crosshairEnemy = false;
    this.lastMouse = { x: 0, y: 0 };
    this.isTouch = this.ui.isTouch;
    this._bindUI();
    this._bindInput();
    this.mods = new Mods(this);
    this.animate = this.animate.bind(this);
    this.init().catch((err) => {
      console.error(err);
      this.ui.setLoading(100, 'FAILED TO START — CHECK CONSOLE');
    });
  }

  _bindUI() {
    this.ui.on('onDeploy', (id) => this.deploy(id));
    this.ui.on('onResume', () => this.resume());
    this.ui.on('onQuit', () => this.quitToLobby());
    this.ui.on('onPlayAgain', () => this.playAgain());
    this.ui.on('onBackLobby', () => this.quitToLobby());
    this.ui.on('onWeaponSelect', (id) => { this.preferred = id; });
    this.ui.on('onSettingsChange', (settings, key) => this.applySettings(key));
    this.ui.on('onUiSound', () => this.audio.ui());
  }

  async init() {
    this.ui.setLoading(4, 'BOOTING WEBGL RENDERER');
    await nextFrame();
    this._setupRenderer();
    this._setupScene();
    this.ui.setLoading(14, 'GENERATING 1 KM² ISLAND');
    await nextFrame();
    await nextFrame();
    this.world = new World(this.scene, this.ui.settings.quality);
    this.ui.setLoading(62, 'GROWING FORESTS & RAISING LANDMARKS');
    await nextFrame();
    this.sky = new Sky(this.scene, this.ui.settings.quality);
    const particles = new ParticleSystem(this.scene, this.ui.settings.quality === 'high' ? 650 : 350);
    const tracers = new TracerSystem(this.scene, 34);
    this.effects = { particles, tracers, spawn: (...args) => particles.spawn(...args) };
    this.ui.setLoading(80, 'DEPLOYING SURVIVORS');
    await nextFrame();
    this.player = new Player(this);
    this.botManager = new BotManager(this);
    this.player.setActive(false);
    this.ui.setWorld(this.world);
    this.applySettings('volume');
    this.ui.setLoading(94, 'CALIBRATING SENSITIVITY');
    await nextFrame();
    this._lobbyCamera(true);
    this.state = 'lobby';
    this.ui.setLoading(100, 'READY TO DEPLOY');
    await new Promise((r) => setTimeout(r, 420));
    this.ui.hideLoading();
    this.ui.showLobby();
    this.ui.setHudVisible(false);
    if (this.isTouch) {
      document.getElementById('mobile-controls').classList.remove('hidden');
    }
    this.lastFrame = performance.now();
    requestAnimationFrame(this.animate);
  }

  _setupRenderer() {
    const quality = this.ui.settings.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: quality === 'high',
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.6 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb9c7c9, 200, 820);
    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.06, 1500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6f684d, 1.35);
    this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xffe0b8, 2.35);
    this.sunLight.position.set(140, 210, 80);
    this.sunLight.castShadow = this.ui.settings.quality === 'high';
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 500;
    this.sunLight.shadow.camera.left = -95;
    this.sunLight.shadow.camera.right = 95;
    this.sunLight.shadow.camera.top = 95;
    this.sunLight.shadow.camera.bottom = -95;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.target.position.set(0, 0, 0);
    this.scene.add(this.sunLight, this.sunLight.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.ambient);
  }

  _lobbyCamera(initial = false) {
    if (!this.camera) return;
    this.lobbyAngle = initial ? 0.7 : this.lobbyAngle;
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(Math.cos(this.lobbyAngle) * 300, 116, Math.sin(this.lobbyAngle) * 300);
    this.camera.lookAt(10, 22, 5);
    if (this.sunLight) {
      this.sunLight.position.set(140, 210, 80);
      this.sunLight.target.position.set(0, 0, 0);
      this.sunLight.target.updateMatrixWorld();
    }
  }

  animate() {
    requestAnimationFrame(this.animate);
    if (!this.renderer || !this.scene || !this.camera) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0.016);
    this.lastFrame = now;
    this.time += dt;
    this.world.update(dt, this.time);
    if (this.sky) this.sky.update(dt, this.time);
    if (this.effects) {
      this.effects.particles.update(dt);
      this.effects.tracers.update(dt);
    }
    if (this.state === 'lobby') {
      this.lobbyAngle += dt * 0.035;
      this.camera.position.set(Math.cos(this.lobbyAngle) * 300, 116 + Math.sin(this.lobbyAngle * 0.7) * 8, Math.sin(this.lobbyAngle) * 300);
      this.camera.lookAt(10, 22, 5);
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
    } else if (this.state === 'playing') {
      this._updateMatch(dt);
    }
    this.renderer.render(this.scene, this.camera);

    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fps = this.frameCount / this.fpsTimer;
      this.frameCount = 0;
      this.fpsTimer = 0;
      this.ui.setFps(this.fps);
    }
  }

  deploy(preferredId) {
    if (this.state !== 'lobby') return;
    this.audio.init();
    this.audio.setVolume(this.ui.settings.volume / 100);
    this.audio.startAmbience();
    this.preferred = WEAPONS[preferredId] ? preferredId : this.preferred;
    this.ui.hideLobby();
    this.ui.hideResults();
    this.ui.hidePause();
    this.ui.setHudVisible(true);
    this.startMatch(this.preferred);
    this.requestLock();
  }

  startMatch(preferredId) {
    this.cleanupMatch();
    this.matchEnded = false;
    this.matchTime = 0;
    this.crouchToggle = false;
    this.jumpQueued = false;
    this.nearLoot = null;
    this.crosshairEnemy = false;
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    const knob = document.getElementById('move-knob');
    if (knob) knob.style.transform = 'translate(0px, 0px)';
    this.matchGroup = new THREE.Group();
    this.scene.add(this.matchGroup);
    this.zone = this._makeZone();
    this._createZoneMesh();

    this.player.resetMatch(preferredId);
    this.player.setActive(true);
    const poi = POIS[Math.floor(Math.random() * POIS.length)];
    const spawn = this.world.randomOpenPosition(poi.x, poi.z, Math.min(75, poi.radius));
    this.player.spawnDrop(spawn.x, spawn.z, rand(-Math.PI, Math.PI), poi.name);
    this.botManager.spawn(23);
    this._spawnLoot();
    this.matchGroup.updateMatrixWorld(true);

    this.ui.lastHud = {};
    this.ui.pickupKey = '';
    this.ui.setPickup(null);
    this.ui.setScope(false);
    document.getElementById('killfeed').innerHTML = '';
    this.ui.showBanner('DROP ZONE', poi.name, 2100);
    this.ui.setHudVisible(true);
    this.ui.hideResults();
    this.ui.hidePause();
    document.getElementById('btn-crouch')?.classList.remove('active');
    document.getElementById('btn-ads')?.classList.remove('active');
    this.state = 'playing';
    this.audio.startAmbience();
    this.camera.fov = 78;
    this.camera.updateProjectionMatrix();
    if (this.isTouch && window.innerHeight > window.innerWidth) {
      const hint = document.getElementById('rotate-hint');
      if (hint && !hint.dataset.dismissed) hint.classList.remove('hidden');
    }
  }

  cleanupMatch() {
    if (this.pendingResult) { clearTimeout(this.pendingResult); this.pendingResult = null; }
    if (this.matchGroup) {
      this.scene.remove(this.matchGroup);
      this.matchGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      this.matchGroup = null;
    }
    if (this.botManager) this.botManager.clear();
    if (this.mods) this.mods._target = null;
    if (this.player) this.player.setActive(false);
    this.loot = [];
    this.zone = null;
    this.nearLoot = null;
    if (this.effects) { this.effects.particles.clear(); this.effects.tracers.clear(); }
    this.ui.setScope(false);
    this.ui.setPickup(null);
  }

  _makeZone() {
    const x = rand(-80, 80), z = rand(-80, 80);
    const zone = {
      x, z, radius: 620,
      phase: 1, state: 'wait', timer: 22,
      shrinkDuration: 22, damage: 1.5,
      startX: x, startZ: z, startRadius: 620,
      targetX: x, targetZ: z, targetRadius: 440,
      nextX: x, nextZ: z, nextRadius: 440
    };
    this._computeNextZone(zone);
    return zone;
  }

  _computeNextZone(z) {
    const nextRadius = Math.max(24, z.radius * 0.72);
    const maxOffset = Math.max(0, z.radius - nextRadius) * 0.72;
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * maxOffset;
    z.nextX = clamp(z.x + Math.cos(a) * d, -HALF + 80, HALF - 80);
    z.nextZ = clamp(z.z + Math.sin(a) * d, -HALF + 80, HALF - 80);
    z.nextRadius = nextRadius;
  }

  _createZoneMesh() {
    const geo = new THREE.CylinderGeometry(1, 1, 150, 64, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8a3cff, transparent: true, opacity: 0.15,
      side: THREE.DoubleSide, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.zone.x, 70, this.zone.z);
    mesh.scale.set(this.zone.radius, 1, this.zone.radius);
    mesh.renderOrder = 3;
    this.matchGroup.add(mesh);
    this.zoneMesh = mesh;
  }

  _spawnLoot() {
    const spots = [...this.world.lootSpawns];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const weaponIds = ['ak47', 'ump', 'ak47', 'awm', 'ump', 'ak47', 'awm', 'ump'];
    let wi = 0;
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      if (i < 30) {
        const id = weaponIds[wi % weaponIds.length];
        wi++;
        this.spawnLootAt(sp.x, sp.z, 'weapon', id, 0);
      } else if (i < 54) {
        this.spawnLootAt(sp.x, sp.z, 'ammo', null, 0);
      } else if (i < 74) {
        this.spawnLootAt(sp.x, sp.z, 'medkit', null, 0);
      }
    }
  }

  spawnLootAt(x, z, type, weaponId = null, delay = 0) {
    if (!this.matchGroup) return null;
    let mesh;
    if (type === 'weapon' && weaponId) mesh = makeLootWeapon(weaponId);
    else if (type === 'ammo') mesh = makeAmmoBox();
    else mesh = makeMedkit();
    const y = this.world.groundHeight(x, z, Infinity) + 0.22;
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.visible = delay <= 0;
    this.matchGroup.add(mesh);
    const item = {
      type, weaponId, x, z, baseY: y, mesh,
      ring: mesh.userData.ring || null,
      taken: false, delay, phase: Math.random() * 6
    };
    this.loot.push(item);
    return item;
  }

  _updateLoot(dt) {
    let nearest = null, nearestD = 3.8;
    const px = this.player.p.pos.x, pz = this.player.p.pos.z;
    for (const item of this.loot) {
      if (item.taken) continue;
      if (item.delay > 0) {
        item.delay -= dt;
        if (item.delay <= 0) item.mesh.visible = true;
        continue;
      }
      item.mesh.position.y = item.baseY + Math.sin(this.time * 2 + item.phase) * 0.055;
      if (item.ring) item.ring.rotation.z += dt * 1.15;
      const d = Math.hypot(item.x - px, item.z - pz);
      if (d < nearestD) { nearestD = d; nearest = item; }
    }
    this.nearLoot = nearest;
    if (!this.player.p.alive || this.player.p.dropping) {
      this.ui.setPickup(null);
      return;
    }
    if (!nearest) { this.ui.setPickup(null); return; }
    this.ui.setPickup(this._pickupPrompt(nearest));
  }

  _pickupPrompt(item) {
    if (item.type === 'weapon') {
      const def = WEAPONS[item.weaponId];
      const owned = this.player.p.slots.some((s) => s && s.id === item.weaponId);
      const empty = this.player.p.slots.some((s) => !s);
      if (owned) return { action: 'AMMO', name: def.name, sub: '+ RESERVE AMMO' };
      return { action: empty ? 'PICK UP' : 'SWAP', name: def.name, sub: def.category };
    }
    if (item.type === 'ammo') return { action: 'PICK UP', name: 'AMMO BOX', sub: '+ RESERVE' };
    return { action: 'PICK UP', name: 'MEDKIT', sub: '+1 MEDKIT' };
  }

  pickupNearest() {
    if (this.state !== 'playing' || !this.nearLoot) return;
    this._pickupItem(this.nearLoot);
  }

  _pickupItem(item) {
    if (!item || item.taken || item.delay > 0) return;
    if (item.type === 'weapon') {
      const def = WEAPONS[item.weaponId];
      const res = this.player.giveWeapon(item.weaponId);
      if (res.oldId) {
        this.spawnLootAt(this.player.p.pos.x + rand(-1.4, 1.4), this.player.p.pos.z + rand(-1.4, 1.4), 'weapon', res.oldId, 1.5);
      }
      this.ui.showBanner('LOOT', `${def.name} ${res.type === 'ammo' ? 'AMMO' : 'ACQUIRED'}`, 900);
      this.audio.pickup();
    } else if (item.type === 'ammo') {
      this.player.giveAmmo(30);
      this.ui.showBanner('LOOT', '+30 RESERVE AMMO', 850);
      this.audio.pickup();
    } else if (item.type === 'medkit') {
      if (this.player.p.medkits >= 5) {
        this.ui.showBanner('MEDKIT', 'MEDKIT POUCH FULL', 900);
        return;
      }
      this.player.giveMedkit();
      this.ui.showBanner('LOOT', '+1 MEDKIT', 850);
      this.audio.pickup();
    }
    item.taken = true;
    item.mesh.visible = false;
    if (this.nearLoot === item) this.nearLoot = null;
    this.ui.setPickup(null);
  }

  _updateMatch(dt) {
    this.matchTime += dt;
    const p = this.player.p;
    const forward = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0) - this.touchMove.y;
    const right = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0) + this.touchMove.x;
    const input = {
      forward, right,
      jump: this.jumpQueued,
      sprint: !!(this.keys.ShiftLeft || this.keys.ShiftRight) || Math.hypot(this.touchMove.x, this.touchMove.y) > 0.92,
      crouch: this.crouchToggle
    };
    this.jumpQueued = false;
    this.mods?.update(dt);
    this.player.update(dt, input, this.time);
    this.botManager.update(dt);
    this._updateZone(dt);
    this._updateLoot(dt);
    this._updateHud(dt);
    this._followShadow();
    this.checkVictory();
    if (p.alive) {
      const z = this.zone;
      const outside = Math.hypot(p.pos.x - z.x, p.pos.z - z.z) > z.radius;
      if (outside) {
        p.zoneTick += dt;
        if (p.zoneTick >= 0.5) {
          p.zoneTick = 0;
          this.player.takeDamage(z.damage * 0.5, null, 'ZONE');
        }
      } else p.zoneTick = 0;
    }
  }

  _updateZone(dt) {
    const z = this.zone;
    if (!z) return;
    if (z.state === 'wait') {
      z.timer -= dt;
      if (z.timer <= 0) {
        z.state = 'shrink';
        z.shrinkDuration = Math.max(10, 22 - z.phase * 1.5);
        z.timer = z.shrinkDuration;
        z.startX = z.x; z.startZ = z.z; z.startRadius = z.radius;
        z.targetX = z.nextX; z.targetZ = z.nextZ; z.targetRadius = z.nextRadius;
        this.ui.showBanner('STORM', 'SAFE ZONE SHRINKING', 1600);
        this.audio.zone();
      }
    } else if (z.state === 'shrink') {
      z.timer -= dt;
      const t = 1 - clamp(z.timer / z.shrinkDuration, 0, 1);
      z.x = lerp(z.startX, z.targetX, t);
      z.z = lerp(z.startZ, z.targetZ, t);
      z.radius = lerp(z.startRadius, z.targetRadius, t);
      if (z.timer <= 0) {
        z.x = z.targetX; z.z = z.targetZ; z.radius = z.targetRadius;
        z.phase += 1;
        z.state = 'wait';
        z.timer = Math.max(11, 24 - z.phase * 1.5);
        z.damage = 1.5 + z.phase * 1.4;
        this._computeNextZone(z);
        this.audio.zone();
      }
    }
    if (this.zoneMesh) {
      this.zoneMesh.position.set(z.x, 70, z.z);
      this.zoneMesh.scale.set(z.radius, 1, z.radius);
      const pulse = 0.12 + Math.sin(this.time * 2.4) * 0.035;
      this.zoneMesh.material.opacity = pulse;
      const outside = Math.hypot(this.player.p.pos.x - z.x, this.player.p.pos.z - z.z) > z.radius;
      this.zoneMesh.material.color.setHex(outside ? 0xb03cff : 0x8a3cff);
    }
  }

  _followShadow() {
    if (!this.sunLight || !this.player) return;
    const p = this.player.p.pos;
    this.sunLight.position.set(p.x + 65, p.y + 110, p.z + 35);
    this.sunLight.target.position.set(p.x, p.y, p.z);
    this.sunLight.target.updateMatrixWorld();
  }

  _updateHud(dt) {
    const p = this.player.p;
    const def = this.player.currentDef();
    const slot = this.player.currentSlot();
    const alive = this.botManager.aliveCount() + (p.alive ? 1 : 0);
    const z = this.zone;
    const outside = z ? Math.hypot(p.pos.x - z.x, p.pos.z - z.z) > z.radius : false;
    this.ui.updateHealth(p.health, p.maxHealth, p.healing, p.healTimer / 2);
    this.ui.setMedkits(p.medkits);
    this.ui.updateWeapon({
      weapon: def.name, category: def.category,
      mag: slot ? slot.mag : 0, reserve: slot ? slot.reserve : 0,
      reloading: p.reloading, reloadProgress: p.reloadTimer / def.reload,
      slots: this.player.slotsForHud()
    });
    this.ui.updateMatch(alive, p.kills);
    if (z) this.ui.updateZone(z.phase, z.timer, outside);
    this.ui.updateCompass(p.yaw);
    this.ui.setScope(this.player.isScoped());

    const scoped = this.player.isScoped();
    const spread = scoped ? 0.002 : (p.ads ? def.spreadAds : def.spreadHip);
    let gap = 4 + spread * 520;
    if (Math.hypot(p.vel.x, p.vel.z) > 0.8) gap += 2.5;
    if (!p.onGround) gap += 3;
    this.ui.setCrosshairGap(clamp(gap, 4, 26), this.crosshairEnemy);

    this.minimapTimer -= dt;
    this.crosshairTimer -= dt;
    if (this.crosshairTimer <= 0) {
      this.crosshairTimer = 0.12;
      this._checkCrosshair();
    }
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.1;
      const nearBots = [];
      for (const b of this.botManager.bots) {
        if (!b.alive) continue;
        const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
        if (d < 160) nearBots.push({ x: b.pos.x, z: b.pos.z, visible: d < 105 });
      }
      const nearLoot = [];
      for (const item of this.loot) {
        if (item.taken || item.delay > 0) continue;
        if (Math.hypot(item.x - p.pos.x, item.z - p.pos.z) < 75) nearLoot.push({ x: item.x, z: item.z });
        if (nearLoot.length > 18) break;
      }
      this.ui.updateMinimap({
        player: { x: p.pos.x, z: p.pos.z, yaw: p.yaw },
        zone: {
          x: z.x, z: z.z, radius: z.radius,
          nextX: z.nextX, nextZ: z.nextZ, nextRadius: z.nextRadius
        },
        pois: POIS, nearBots, nearLoot
      });
    }
  }

  _checkCrosshair() {
    if (!this.player || !this.player.p.alive || this.player.p.dropping) {
      this.crosshairEnemy = false;
      return;
    }
    this.camera.updateMatrixWorld(true);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const ray = new THREE.Raycaster(this.camera.position.clone(), dir, 0, 220);
    const hits = ray.intersectObjects(this.botManager.hitMeshes, false);
    this.crosshairEnemy = hits.length > 0;
  }

  checkVictory() {
    if (this.state !== 'playing' || this.matchEnded) return;
    if (this.player.p.alive && this.botManager.aliveCount() === 0) {
      this.endMatch(true);
    }
  }

  onLanded(poiName) {
    this.ui.showBanner('MATCH START', `${poiName} • 3S DROP SHIELD`, 2400);
    this.audio.ui();
  }

  hitBot(bot, damage, head, point, weaponName) {
    this.botManager.damageBot(bot, damage, head, point, weaponName);
  }

  onPlayerDeath(sourceName, weaponName, head) {
    if (this.matchEnded) return;
    const killer = sourceName || 'STORM';
    this.ui.addKill(killer, 'YOU', weaponName || 'ZONE', { head });
    this.audio.defeat();
    this.endMatch(false);
  }

  endMatch(win) {
    if (this.matchEnded) return;
    this.matchEnded = true;
    this.state = 'ending';
    this.player.p.firing = false;
    this.player.p.ads = false;
    this.ui.setScope(false);
    this.ui.setPickup(null);
    this.ui.hidePause();
    this.exitLock();
    const p = this.player.p;
    const placement = win ? 1 : this.botManager.aliveCount() + 1;
    const stats = {
      win, placement, total: 24,
      kills: p.kills,
      damage: p.damage,
      survival: this.matchTime,
      accuracy: p.shots > 0 ? (p.hits / p.shots) * 100 : 0
    };
    if (win) {
      this.ui.showBanner('VICTORY', 'BOOYAH!', 2000);
      this.audio.victory();
    } else {
      this.ui.showBanner('ELIMINATED', `#${placement} OF 24`, 1600);
    }
    this.pendingResult = setTimeout(() => this._finishMatch(stats), win ? 1700 : 1900);
  }

  _finishMatch(stats) {
    this.pendingResult = null;
    const table = [0, 120, 90, 70, 55, 45, 38, 32, 27, 23, 20, 17, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const placementPoints = table[stats.placement] || 0;
    const killPoints = stats.kills * 12;
    const damagePoints = Math.min(25, Math.floor(stats.damage / 300));
    const rpGain = placementPoints + killPoints + damagePoints;
    this.ui.addProfileResult({ win: stats.win, kills: stats.kills, placement: stats.placement });
    this.ui.addRankPoints(rpGain);
    let subtitle = 'BETTER LUCK NEXT DROP';
    if (stats.placement === 1) subtitle = 'LAST ONE STANDING';
    else if (stats.placement <= 3) subtitle = 'SO CLOSE TO BOOYAH';
    else if (stats.placement <= 10) subtitle = 'TOP 10 FINISH';
    this.ui.showResults({
      win: stats.win,
      placement: stats.placement,
      total: 24,
      kills: stats.kills,
      damage: stats.damage,
      time: fmtTime(stats.survival),
      accuracy: stats.accuracy,
      rp: this.ui.profile.rp,
      rpGain,
      subtitle
    });
    this.ui.setHudVisible(false);
    this.player.setActive(false);
    this.audio.stopAmbience();
    this.state = 'results';
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.player.p.firing = false;
    this.player.p.ads = false;
    this.ui.setScope(false);
    this.exitLock();
    this.ui.showPause({
      alive: this.botManager.aliveCount() + (this.player.p.alive ? 1 : 0),
      kills: this.player.p.kills,
      damage: Math.round(this.player.p.damage),
      time: fmtTime(this.matchTime)
    });
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hidePause();
    this.audio.startAmbience();
    this.requestLock();
  }

  quitToLobby() {
    this.cleanupMatch();
    this.ui.hidePause();
    this.ui.hideResults();
    this.ui.setHudVisible(false);
    document.getElementById('rotate-hint')?.classList.add('hidden');
    this.state = 'lobby';
    this.audio.stopAmbience();
    this._lobbyCamera(true);
    this.ui.showLobby();
    this.exitLock();
  }

  playAgain() {
    this.ui.hideResults();
    this.ui.hidePause();
    this.ui.setHudVisible(true);
    this.audio.init();
    this.audio.startAmbience();
    this.startMatch(this.preferred);
    this.requestLock();
  }

  applySettings(key) {
    const s = this.ui.settings;
    if (key === 'volume') this.audio.setVolume(s.volume / 100);
    if (key === 'quality' && this.renderer) {
      const high = s.quality === 'high';
      this.renderer.shadowMap.enabled = high;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 1.6 : 1));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }

  requestLock() {
    if (this.isTouch || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock can be denied */ }
  }

  exitLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* noop */ }
  }

  /* ============================================================
     INPUT — desktop keyboard / mouse + touch controls
     ============================================================ */
  _bindInput() {
    const canvas = this.canvas;

    // ---- Keyboard -------------------------------------------------
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (this.state === 'playing') {
        if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyE',
          'Digit1', 'Digit2', 'Digit3', 'ShiftLeft', 'ShiftRight'].includes(code)) {
          e.preventDefault();
        }
      }
      this.keys[code] = true;
      if (e.repeat) return;

      if (code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        return;
      }
      if (this.state !== 'playing' || !this.player) return;

      switch (code) {
        case 'KeyR': this.player.startReload(); break;
        case 'KeyF': this.player.heal(); break;
        case 'KeyE': this.pickupNearest(); break;
        case 'KeyC': this.crouchToggle = !this.crouchToggle; break;
        case 'KeyQ': this.player.cycleWeapon(); break;
        case 'Digit1': this.player.switchWeapon(0); break;
        case 'Digit2': this.player.switchWeapon(1); break;
        case 'Digit3': this.player.switchWeapon(2); break;
        case 'Space': if (!e.repeat) this.jumpQueued = true; break;
        default: break;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // ---- Mouse look / fire / aim ----------------------------------
    window.addEventListener('mousemove', (e) => {
      if (this.state !== 'playing' || !this.player) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked && !this._dragLook) return;
      const dx = locked ? e.movementX : (e.clientX - this.lastMouse.x);
      const dy = locked ? e.movementY : (e.clientY - this.lastMouse.y);
      this.lastMouse.x = e.clientX;
      this.lastMouse.y = e.clientY;
      if (dx || dy) this.player.look(dx, dy);
    });

    canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || !this.player) return;
      if (e.button === 0) {
        this.player.p.firing = true;
        this._dragLook = true;
        this.lastMouse.x = e.clientX;
        this.lastMouse.y = e.clientY;
        if (!this.isTouch && !document.pointerLockElement) this.requestLock();
      } else if (e.button === 2) {
        this.player.p.ads = true;
      }
      e.preventDefault();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this._dragLook = false;
        if (this.player) this.player.p.firing = false;
      }
      if (e.button === 2 && this.player) this.player.p.ads = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('wheel', (e) => {
      if (this.state !== 'playing' || !this.player) return;
      e.preventDefault();
      this.player.cycleWeapon();
    }, { passive: false });

    // ---- Pointer lock ---------------------------------------------
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        this._hadLock = true;
        return;
      }
      if (this._hadLock) {
        this._hadLock = false;
        if (this.state === 'playing' && !this.isTouch) this.pause();
      }
    });

    // ---- Window / lifecycle ---------------------------------------
    window.addEventListener('resize', () => this._onResize());
    window.addEventListener('blur', () => {
      this.keys = {};
      this._dragLook = false;
      if (this.player) {
        this.player.p.firing = false;
        this.player.p.ads = false;
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    document.getElementById('btn-pause')?.addEventListener('click', () => this.pause());
    document.getElementById('dismiss-rotate')?.addEventListener('click', (e) => {
      e.currentTarget.closest('#rotate-hint').dataset.dismissed = '1';
    });

    // ---- Touch controls -------------------------------------------
    if (this.isTouch) this._bindTouch();
  }

  _onResize() {
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.ui.settings.quality === 'high' ? 1.6 : 1));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    if (this.camera) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    }
    if (this.isTouch) {
      const hint = document.getElementById('rotate-hint');
      if (!hint) return;
      if (this.state === 'playing' && window.innerHeight > window.innerWidth && !hint.dataset.dismissed) {
        hint.classList.remove('hidden');
      } else if (window.innerHeight <= window.innerWidth) {
        hint.classList.add('hidden');
      }
    }
  }

  _bindTouch() {
    const moveZone = document.getElementById('move-zone');
    const knob = document.getElementById('move-knob');
    const lookZone = document.getElementById('look-zone');
    let movePointer = null;
    let lookPointer = null;
    let lookX = 0, lookY = 0;
    const capture = (el, id) => {
      try { el.setPointerCapture?.(id); } catch { /* synthetic or stale pointer */ }
    };

    const resetMove = () => {
      movePointer = null;
      this.touchMove.x = 0;
      this.touchMove.y = 0;
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    };

    if (moveZone) {
      moveZone.addEventListener('pointerdown', (e) => {
        if (this.state !== 'playing') return;
        movePointer = e.pointerId;
        capture(moveZone, e.pointerId);
        this._updateJoystick(e, moveZone, knob);
        e.preventDefault();
      });
      moveZone.addEventListener('pointermove', (e) => {
        if (e.pointerId !== movePointer) return;
        this._updateJoystick(e, moveZone, knob);
        e.preventDefault();
      });
      const endMove = (e) => {
        if (e.pointerId !== movePointer) return;
        resetMove();
      };
      moveZone.addEventListener('pointerup', endMove);
      moveZone.addEventListener('pointercancel', endMove);
      moveZone.addEventListener('lostpointercapture', endMove);
    }

    if (lookZone) {
      lookZone.addEventListener('pointerdown', (e) => {
        if (this.state !== 'playing') return;
        lookPointer = e.pointerId;
        lookX = e.clientX;
        lookY = e.clientY;
        capture(lookZone, e.pointerId);
        e.preventDefault();
      });
      lookZone.addEventListener('pointermove', (e) => {
        if (e.pointerId !== lookPointer || this.state !== 'playing' || !this.player) return;
        const dx = e.clientX - lookX;
        const dy = e.clientY - lookY;
        lookX = e.clientX;
        lookY = e.clientY;
        this.player.look(dx * 1.45, dy * 1.45);
        e.preventDefault();
      });
      const endLook = (e) => {
        if (e.pointerId === lookPointer) lookPointer = null;
      };
      lookZone.addEventListener('pointerup', endLook);
      lookZone.addEventListener('pointercancel', endLook);
      lookZone.addEventListener('lostpointercapture', endLook);
    }

    const tap = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        if (this.state !== 'playing') return;
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };

    const fireBtn = document.getElementById('btn-fire');
    if (fireBtn) {
      const start = (e) => {
        if (this.state !== 'playing' || !this.player) return;
        e.preventDefault();
        capture(fireBtn, e.pointerId);
        this.player.p.firing = true;
        fireBtn.classList.add('active');
      };
      const stop = (e) => {
        e.preventDefault();
        if (this.player) this.player.p.firing = false;
        fireBtn.classList.remove('active');
      };
      fireBtn.addEventListener('pointerdown', start);
      fireBtn.addEventListener('pointerup', stop);
      fireBtn.addEventListener('pointercancel', stop);
      fireBtn.addEventListener('lostpointercapture', stop);
    }

    const adsBtn = document.getElementById('btn-ads');
    if (adsBtn) {
      adsBtn.addEventListener('pointerdown', (e) => {
        if (this.state !== 'playing' || !this.player) return;
        e.preventDefault();
        e.stopPropagation();
        this.player.p.ads = !this.player.p.ads;
        adsBtn.classList.toggle('active', this.player.p.ads);
      });
    }

    tap('btn-reload', () => this.player.startReload());
    tap('btn-jump', () => { this.jumpQueued = true; });
    tap('btn-crouch', () => {
      this.crouchToggle = !this.crouchToggle;
      document.getElementById('btn-crouch')?.classList.toggle('active', this.crouchToggle);
    });
    tap('btn-heal', () => this.player.heal());
    tap('btn-pickup', () => this.pickupNearest());
    tap('btn-swap', () => this.player.cycleWeapon());
  }

  _updateJoystick(e, zone, knob) {
    const r = zone.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const max = r.width * 0.34;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.touchMove.x = dx / max;
    this.touchMove.y = dy / max;
    if (knob) knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  }
}
