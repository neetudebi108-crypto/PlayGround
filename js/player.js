import * as THREE from '../vendor/three.module.js';
import { WEAPONS, buildWeaponModel } from './weapons.js';
import { makeRadialTexture } from './effects.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

const GRAVITY = 20;
const EYE_HEIGHT = 1.72;
const CROUCH_EYE = 1.08;

export class Player {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.camera = game.camera;
    this.scene = game.scene;
    this.ui = game.ui;
    this.audio = game.audio;
    this.effects = game.effects;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 600;
    this.active = false;
    this.flashTex = makeRadialTexture('rgba(255,248,210,1)', 'rgba(255,120,20,0)');
    this.p = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      health: 200, maxHealth: 200, alive: true,
      kills: 0, damage: 0, shots: 0, hits: 0,
      slots: [], selected: 0, medkits: 1,
      reloading: false, reloadTimer: 0,
      healing: false, healTimer: 0,
      dropping: false, parachute: false, dropPoi: '',
      onGround: true, crouching: false, sprinting: false,
      ads: false, adsBlend: 0, firing: false,
      recoilPitch: 0, recoilYaw: 0, viewKick: 0,
      bob: 0, bobAmt: 0, crouchBlend: 0,
      lookX: 0, lookY: 0, inWater: false,
      lastShot: -10, bolt: 0, flashUntil: 0,
      zoneTick: 0, deathTime: 0, lastHurt: -10, shield: 0
    };
    this.viewmodels = {};
    this._buildViewmodels();
  }

  _buildViewmodels() {
    const ids = ['ak47', 'awm', 'ump', 'm1911'];
    for (const id of ids) {
      const vm = buildWeaponModel(id, { castShadow: false });
      vm.position.set(0.34, -0.3, -0.62);
      vm.scale.setScalar(0.84);
      vm.visible = false;
      const flashMat = new THREE.SpriteMaterial({
        map: this.flashTex, color: 0xffd28a, transparent: true,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
      });
      const flash = new THREE.Sprite(flashMat);
      flash.scale.set(0.26, 0.26, 1);
      flash.position.copy(vm.userData.muzzle);
      flash.visible = false;
      flash.renderOrder = 40;
      vm.add(flash);
      vm.userData.flash = flash;
      this.camera.add(vm);
      this.viewmodels[id] = vm;
    }
  }

  resetMatch(preferredId = 'ak47') {
    const def = WEAPONS[preferredId] || WEAPONS.ak47;
    const p = this.p;
    p.pos.set(0, 0, 0);
    p.vel.set(0, 0, 0);
    p.yaw = 0; p.pitch = 0;
    p.health = p.maxHealth;
    p.alive = true;
    p.kills = 0; p.damage = 0; p.shots = 0; p.hits = 0;
    p.slots = [
      { id: def.id, mag: def.mag, reserve: def.mag * 2 },
      { id: 'm1911', mag: 12, reserve: 48 },
      null
    ];
    p.selected = 0;
    p.medkits = 1;
    p.reloading = false; p.reloadTimer = 0;
    p.healing = false; p.healTimer = 0;
    p.dropping = false; p.parachute = false; p.dropPoi = '';
    p.onGround = true; p.crouching = false; p.sprinting = false;
    p.ads = false; p.adsBlend = 0; p.firing = false;
    p.recoilPitch = 0; p.recoilYaw = 0; p.viewKick = 0;
    p.bob = 0; p.bobAmt = 0; p.crouchBlend = 0;
    p.lookX = 0; p.lookY = 0; p.inWater = false;
    p.lastShot = -10; p.bolt = 0; p.flashUntil = 0;
    p.zoneTick = 0; p.deathTime = 0; p.lastHurt = -10; p.shield = 0;
    this.active = true;
    this.camera.fov = 74;
    this.camera.updateProjectionMatrix();
    this.setWeapon(0);
  }

  spawnDrop(x, z, yaw, poiName) {
    const p = this.p;
    const ground = this.world.groundHeight(x, z, Infinity);
    p.pos.set(x, ground + 72, z);
    p.vel.set(0, 0, 0);
    p.yaw = yaw;
    p.pitch = -0.18;
    p.dropping = true;
    p.parachute = false;
    p.dropPoi = poiName;
    p.onGround = false;
    p.alive = true;
    p.health = p.maxHealth;
    p.shield = 0;
    this.camera.fov = 78;
    this.camera.updateProjectionMatrix();
  }

  currentSlot() {
    return this.p.slots[this.p.selected] || null;
  }

  currentDef() {
    const slot = this.currentSlot();
    return slot ? WEAPONS[slot.id] : WEAPONS.m1911;
  }

  slotsForHud() {
    return this.p.slots.map((s) => s ? { name: WEAPONS[s.id].name, active: s === this.currentSlot() } : null).filter(Boolean);
  }

  setActive(active) {
    this.active = active;
    if (!active) for (const id in this.viewmodels) this.viewmodels[id].visible = false;
  }

  setWeapon(index) {
    const p = this.p;
    if (index < 0 || index >= p.slots.length || !p.slots[index]) return;
    p.selected = index;
    p.reloading = false;
    for (const id in this.viewmodels) this.viewmodels[id].visible = false;
  }

  look(dx, dy) {
    const s = this.ui.settings;
    const sens = s.sensitivity * (this.p.ads ? s.adsSensitivity : 1);
    const inv = s.invertY ? -1 : 1;
    this.p.yaw -= dx * 0.00225 * sens;
    this.p.pitch -= dy * 0.00225 * sens * inv;
    this.p.pitch = clamp(this.p.pitch, -1.42, 1.42);
    this.p.lookX += dx;
    this.p.lookY += dy;
  }

  isScoped() {
    const def = this.currentDef();
    return this.p.ads && !!def.scope && this.p.alive && !this.p.dropping;
  }

  getMuzzleWorld() {
    const p = this.p;
    const def = this.currentDef();
    const vm = this.viewmodels[def.id];
    this.camera.updateMatrixWorld(true);
    if (vm && vm.visible) {
      const v = vm.localToWorld(vm.userData.muzzle.clone());
      return v;
    }
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    return this.camera.position.clone().addScaledVector(dir, 0.8).addScaledVector(right, 0.13).add(new THREE.Vector3(0, -0.08, 0));
  }

  update(dt, input, time) {
    const p = this.p;
    if (!this.active) return;
    if (!p.alive) {
      for (const id in this.viewmodels) this.viewmodels[id].visible = false;
      return;
    }
    if (p.dropping) {
      this._updateDrop(dt, input);
      this._updateCamera(dt);
      return;
    }

    if (p.reloading) {
      p.reloadTimer += dt;
      const def = this.currentDef();
      if (p.reloadTimer >= def.reload) {
        const slot = this.currentSlot();
        if (slot) {
          const need = def.mag - slot.mag;
          const take = Math.min(need, slot.reserve);
          slot.mag += take;
          slot.reserve -= take;
        }
        p.reloading = false;
        p.reloadTimer = 0;
      }
    }
    if (p.healing) {
      p.healTimer += dt;
      if (p.healTimer >= 2.0) {
        p.healing = false;
        p.healTimer = 0;
        if (p.medkits > 0 && p.health < p.maxHealth) {
          p.medkits--;
          p.health = Math.min(p.maxHealth, p.health + 75);
          this.audio.heal();
          this.ui.showBanner('MEDKIT', '+75 HEALTH', 900);
        }
      }
    }

    p.crouching = !!input.crouch;
    const wantSprint = !!input.sprint && input.forward > 0.25 && !p.ads && !p.crouching;
    p.sprinting = wantSprint;
    const speed = p.crouching ? 2.5 : p.ads ? 3.3 : wantSprint ? 7.4 : 4.9;

    let forward = input.forward || 0;
    let right = input.right || 0;
    const len = Math.hypot(forward, right);
    if (len > 1) { forward /= len; right /= len; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const wx = -sy * forward + cy * right;
    const wz = -cy * forward - sy * right;
    const waterFactor = p.inWater ? 0.55 : 1;
    const targetX = wx * speed * waterFactor;
    const targetZ = wz * speed * waterFactor;
    const accel = p.onGround ? 13 : 3.5;
    p.vel.x = lerp(p.vel.x, targetX, 1 - Math.exp(-accel * dt));
    p.vel.z = lerp(p.vel.z, targetZ, 1 - Math.exp(-accel * dt));
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    p.pos.x = clamp(p.pos.x, -495, 495);
    p.pos.z = clamp(p.pos.z, -495, 495);
    this.world.resolveCollision(p.pos, 0.55);

    const ground = this.world.groundHeight(p.pos.x, p.pos.z, p.pos.y);
    const deepWater = ground < 0.1 && p.pos.y < 1.4;
    p.inWater = deepWater;
    if (p.onGround) {
      if (ground < p.pos.y - 1.1) {
        p.onGround = false;
      } else {
        p.pos.y = deepWater ? Math.max(ground, -1.0) : ground;
      }
    }
    if (input.jump && p.onGround) {
      p.vel.y = 7.3;
      p.onGround = false;
      p.pos.y += 0.06;
    }
    if (!p.onGround) {
      p.vel.y -= GRAVITY * dt;
      p.pos.y += p.vel.y * dt;
      const g2 = this.world.groundHeight(p.pos.x, p.pos.z, p.pos.y);
      if (p.pos.y <= g2) {
        p.pos.y = g2;
        p.vel.y = 0;
        p.onGround = true;
      }
    }

    const hspeed = Math.hypot(p.vel.x, p.vel.z);
    p.bobAmt = lerp(p.bobAmt, p.onGround ? clamp(hspeed / 7, 0, 1) : 0, 1 - Math.exp(-8 * dt));
    p.bob += dt * (4.5 + hspeed * 1.1);
    p.crouchBlend = lerp(p.crouchBlend, p.crouching ? 1 : 0, 1 - Math.exp(-12 * dt));
    p.adsBlend = lerp(p.adsBlend, p.ads ? 1 : 0, 1 - Math.exp(-13 * dt));
    p.recoilPitch *= Math.exp(-8 * dt);
    p.recoilYaw *= Math.exp(-8 * dt);
    p.viewKick *= Math.exp(-10 * dt);
    p.lookX *= Math.exp(-12 * dt);
    p.lookY *= Math.exp(-12 * dt);
    if (p.bolt > 0) p.bolt -= dt;
    if (p.shield > 0) p.shield = Math.max(0, p.shield - dt);

    this._updateCamera(dt);
    this._updateViewmodel(dt);
    if (p.firing) this.tryShoot(time);
  }

  _updateDrop(dt, input) {
    const p = this.p;
    const ground = this.world.groundHeight(p.pos.x, p.pos.z, p.pos.y);
    if (!p.parachute && p.pos.y - ground < 28) {
      p.parachute = true;
      this.ui.showBanner('DEPLOYMENT', 'PARACHUTE OPEN', 900);
    }
    const fall = p.parachute ? 6.5 : 19;
    p.pos.y -= fall * dt;
    const moveSpeed = p.parachute ? 8 : 13;
    let forward = input.forward || 0;
    let right = input.right || 0;
    const len = Math.hypot(forward, right);
    if (len > 1) { forward /= len; right /= len; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    p.pos.x += (-sy * forward + cy * right) * moveSpeed * dt;
    p.pos.z += (-cy * forward - sy * right) * moveSpeed * dt;
    p.pos.x = clamp(p.pos.x, -490, 490);
    p.pos.z = clamp(p.pos.z, -490, 490);
    if (p.pos.y <= ground + 1.8) {
      p.pos.y = ground;
      p.vel.set(0, 0, 0);
      p.dropping = false;
      p.parachute = false;
      p.onGround = true;
      p.shield = 3;
      this.game.onLanded(p.dropPoi);
    }
  }

  _updateCamera(dt) {
    const p = this.p;
    const eye = lerp(EYE_HEIGHT, CROUCH_EYE, p.crouchBlend);
    const bobY = p.dropping ? 0 : Math.sin(p.bob) * 0.035 * p.bobAmt;
    const bobX = p.dropping ? 0 : Math.cos(p.bob * 0.5) * 0.022 * p.bobAmt;
    this.camera.position.set(p.pos.x + bobX, p.pos.y + eye + bobY, p.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(p.pitch + p.recoilPitch, p.yaw + p.recoilYaw, p.dropping ? Math.sin(p.bob * 0.2) * 0.02 : 0);
    const def = this.currentDef();
    const targetFov = p.dropping ? 80 : p.ads ? def.zoomFov : (p.sprinting ? 79 : 74);
    this.camera.fov = lerp(this.camera.fov, targetFov, 1 - Math.exp(-11 * dt));
    this.camera.updateProjectionMatrix();
  }

  _updateViewmodel(dt) {
    const p = this.p;
    const def = this.currentDef();
    const vm = this.viewmodels[def.id];
    for (const id in this.viewmodels) this.viewmodels[id].visible = false;
    if (!vm || !p.alive || p.dropping || this.isScoped()) {
      if (vm) vm.userData.flash.visible = false;
      return;
    }
    vm.visible = true;
    const ads = p.adsBlend;
    const hip = new THREE.Vector3(0.34, -0.3, -0.62);
    const aim = new THREE.Vector3(0.0, -0.19, -0.52);
    vm.position.lerpVectors(hip, aim, ads);
    const sprintDrop = p.sprinting ? (1 - ads) * 0.09 : 0;
    vm.position.y -= sprintDrop;
    vm.position.x += Math.sin(p.bob) * 0.008 * p.bobAmt * (1 - ads);
    vm.position.y += Math.abs(Math.cos(p.bob)) * 0.006 * p.bobAmt * (1 - ads);
    vm.position.z += p.viewKick * 0.06;
    vm.rotation.x = -p.viewKick * 0.24 + p.lookY * 0.0009;
    vm.rotation.y = p.lookX * 0.0009;
    vm.rotation.z = (1 - ads) * (p.sprinting ? 0.16 : 0) + Math.sin(p.bob * 0.5) * 0.006 * p.bobAmt;
    const flash = vm.userData.flash;
    flash.visible = this.game.time < p.flashUntil;
    if (flash.visible) {
      const s = 0.2 + Math.random() * 0.18;
      flash.scale.set(s, s, 1);
      flash.material.rotation = Math.random() * Math.PI;
    }
  }

  tryShoot(time) {
    const p = this.p;
    if (this.game.state !== 'playing' || !p.alive || p.dropping || p.healing || p.reloading) return;
    const slot = this.currentSlot();
    if (!slot) return;
    const def = WEAPONS[slot.id];
    const cooldown = 60 / def.rpm;
    if (time - p.lastShot < cooldown || p.bolt > 0) return;
    if (slot.mag <= 0) {
      this.audio.empty();
      if (slot.reserve > 0) this.startReload();
      return;
    }

    slot.mag -= 1;
    p.shots += 1;
    p.lastShot = time;
    p.bolt = def.auto ? 0 : 0.55;
    p.flashUntil = time + 0.055;
    p.recoilPitch += def.recoil * (p.ads ? 0.62 : 1) * (0.8 + Math.random() * 0.45);
    p.recoilYaw += (Math.random() - 0.5) * def.recoil * 0.7;
    p.viewKick = 1;
    this.audio.shot(def.audio);

    this.camera.updateMatrixWorld(true);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    let spread = p.ads ? def.spreadAds : def.spreadHip;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 0.8) spread *= 1.45;
    if (p.crouching) spread *= 0.8;
    if (!p.onGround) spread *= 1.5;
    dir.addScaledVector(right, (Math.random() - 0.5) * spread * 2);
    dir.addScaledVector(up, (Math.random() - 0.5) * spread * 2);
    dir.normalize();

    const origin = this.camera.position.clone();
    this.raycaster.set(origin, dir);
    this.raycaster.far = def.range;
    const targets = this.game.botManager ? this.game.botManager.hitMeshes : [];
    const hits = this.raycaster.intersectObjects([...targets, ...this.world.raycastTargets], false);
    let hit = null;
    for (const h of hits) {
      if (h.distance > def.range) continue;
      hit = h;
      break;
    }

    const muzzle = this.getMuzzleWorld();
    let end;
    if (hit) {
      end = hit.point.clone();
      const bot = hit.object.userData.bot;
      if (bot && bot.alive) {
        const head = !!hit.object.userData.isHead;
        const falloff = 1 - clamp(hit.distance / def.range, 0, 1) * 0.16;
        const damage = def.damage * (head ? def.headMult : 1) * falloff;
        p.hits += 1;
        p.damage += damage;
        this.game.hitBot(bot, damage, head, hit.point, def.name);
        this.ui.showHitmarker(false, head);
        this.audio.hit(head);
        const sp = this._project(hit.point);
        if (sp) this.ui.damageNumber(sp.x, sp.y, Math.round(damage), head);
        this.effects.spawn(hit.point, head ? 0xffd24a : 0xd8462e, 10, 3.4, 9, 0.45);
      } else {
        this.effects.spawn(hit.point, 0xffc66a, 7, 3.2, 9, 0.4);
      }
    } else {
      end = origin.clone().addScaledVector(dir, def.range);
    }
    this.effects.tracers.spawn(muzzle, end, new THREE.Color(def.tracer).getHex());

    if (slot.mag === 0 && slot.reserve > 0) {
      setTimeout(() => {
        if (this.game.state === 'playing' && this.currentSlot() === slot && slot.mag === 0) this.startReload();
      }, 420);
    }
  }

  _project(point) {
    const v = point.clone().project(this.camera);
    if (v.z < -1 || v.z > 1) return null;
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight
    };
  }

  startReload() {
    const p = this.p;
    if (!p.alive || p.dropping || p.reloading) return;
    const slot = this.currentSlot();
    if (!slot) return;
    const def = WEAPONS[slot.id];
    if (slot.mag >= def.mag || slot.reserve <= 0) return;
    p.reloading = true;
    p.reloadTimer = 0;
    this.audio.reload();
  }

  heal() {
    const p = this.p;
    if (!p.alive || p.dropping || p.healing) return;
    if (p.medkits <= 0) {
      this.ui.showBanner('MEDKIT', 'NO MEDKITS LEFT', 1000);
      return;
    }
    if (p.health >= p.maxHealth) {
      this.ui.showBanner('HEALTH', 'ALREADY AT FULL HEALTH', 900);
      return;
    }
    p.healing = true;
    p.healTimer = 0;
    this.audio.heal();
  }

  switchWeapon(index) {
    const p = this.p;
    if (!p.alive || p.dropping) return;
    if (index === p.selected || !p.slots[index]) return;
    this.setWeapon(index);
    this.audio.ui();
  }

  cycleWeapon() {
    const p = this.p;
    for (let i = 1; i <= p.slots.length; i++) {
      const idx = (p.selected + i) % p.slots.length;
      if (p.slots[idx]) { this.switchWeapon(idx); return; }
    }
  }

  giveWeapon(id) {
    const p = this.p;
    const def = WEAPONS[id];
    if (!def) return { type: 'none' };
    const same = p.slots.findIndex((s) => s && s.id === id);
    if (same >= 0) {
      p.slots[same].reserve = Math.min(def.mag * 6, p.slots[same].reserve + def.mag * 2);
      return { type: 'ammo', name: def.name };
    }
    const empty = p.slots.findIndex((s) => !s);
    if (empty >= 0) {
      p.slots[empty] = { id, mag: def.mag, reserve: def.mag * 2 };
      this.setWeapon(empty);
      return { type: 'pickup', name: def.name };
    }
    const old = p.slots[p.selected];
    p.slots[p.selected] = { id, mag: def.mag, reserve: def.mag * 2 };
    this.setWeapon(p.selected);
    return { type: 'swap', name: def.name, oldId: old.id };
  }

  giveAmmo(amount) {
    const slot = this.currentSlot();
    if (!slot) return;
    const def = WEAPONS[slot.id];
    slot.reserve = Math.min(def.mag * 6, slot.reserve + amount);
  }

  giveMedkit() {
    this.p.medkits = Math.min(5, this.p.medkits + 1);
  }

  takeDamage(amount, sourceName, weaponName, head = false) {
    const p = this.p;
    if (!p.alive || p.dropping) return;
    if (p.shield > 0 && sourceName && sourceName !== 'ZONE') return;
    p.health -= amount;
    p.lastHurt = this.game.time;
    p.healing = false;
    p.healTimer = 0;
    this.ui.showDamageFlash();
    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      p.deathTime = this.game.time;
      for (const id in this.viewmodels) this.viewmodels[id].visible = false;
      this.ui.setScope(false);
      this.game.onPlayerDeath(sourceName, weaponName, head);
    }
  }
}
