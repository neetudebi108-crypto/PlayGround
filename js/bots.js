import * as THREE from '../vendor/three.module.js';
import { makeWeaponModel } from './weapons.js';
import { clamp, dist, heightAt, groundHeightAt, resolveWorldCollision, MAP } from './world.js';

/* ============================================================
   BOTS — lightweight battle-royale AI
   ============================================================ */
export const BOT_NAMES = ['RAVEN', 'VIPER', 'GHOST', 'NOVA', 'BLAZE', 'ECHO', 'SABLE', 'RIFT', 'KILO', 'ONYX', 'DRIFT', 'FROST'];

const skinColors = [0x9c7354, 0x7d5537, 0xc59a72, 0x6a4a31, 0xb0805c];
const vestColors = [0x39463a, 0x504435, 0x334045, 0x564135, 0x434b3d];

function b(parent, x, y, z, w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: .88, metalness: .03, flatShading: true, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0 })
  );
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

export class Bot {
  constructor(scene, world, name, x, z, idx) {
    this.scene = scene; this.world = world; this.name = name; this.idx = idx;
    this.position = new THREE.Vector3(x, groundHeightAt(x, z), z);
    this.health = MAP.health; this.maxHealth = MAP.health;
    this.alive = true; this.yaw = Math.random() * Math.PI * 2;
    this.state = 'patrol'; this.target = null; this.patrol = null;
    this.thinkTimer = Math.random() * .6; this.fireTimer = 1 + Math.random() * 1.5;
    this.reloadTimer = 0; this.walkPhase = Math.random() * 8;
    this.accuracy = .72 + Math.random() * .22;
    this.preferred = 18 + Math.random() * 18;
    this.deathTimer = 0; this.hitTimer = 0; this.strafeDir = Math.random() > .5 ? 1 : -1;
    this.zoneTimer = 0;
    this.skill = .75 + Math.random() * .4;
    this._tmp = new THREE.Vector3();

    this.buildModel();
    this.pickPatrol();
  }

  buildModel() {
    const g = new THREE.Group();
    g.position.copy(this.position);
    this.group = g;
    sceneAdd(this.scene, g);

    const skin = skinColors[this.idx % skinColors.length];
    const vest = vestColors[this.idx % vestColors.length];
    const pants = 0x2d332c;
    const accent = this.idx % 3 === 0 ? 0xff7a1f : 0xc4572f;

    this.torso = b(g, 0, 1.06, 0, .52, .62, .28, vest);
    b(g, 0, 1.13, -.03, .56, .4, .32, 0x2f352e);
    b(g, 0, .82, 0, .44, .18, .25, pants);
    b(g, 0, .98, .16, .36, .3, .12, 0x3b4038);
    b(g, 0, 1.22, .17, .24, .22, .1, accent); // backpack flash
    // head
    const head = new THREE.Mesh(new THREE.SphereGeometry(.19, 8, 6), new THREE.MeshStandardMaterial({ color: skin, roughness: .9, flatShading: true }));
    head.position.set(0, 1.6, 0); head.castShadow = true; g.add(head);
    this.head = head;
    // helmet
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(.225, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b4638, roughness: .8, metalness: .1, flatShading: true }));
    helmet.position.set(0, 1.63, 0); helmet.castShadow = true; g.add(helmet);
    b(g, 0, 1.68, -.03, .3, .06, .28, 0x2b332a);
    // mask
    b(g, 0, 1.56, -.17, .25, .14, .05, 0x232927);
    // arms
    this.armL = b(g, -.31, 1.13, -.03, .15, .52, .17, skin);
    this.armR = b(g, .31, 1.13, -.03, .15, .52, .17, skin);
    this.armL.rotation.x = -1.15; this.armR.rotation.x = -1.35;
    this.armL.position.z = -.14; this.armR.position.z = -.11;
    b(g, -.3, .88, -.16, .17, .18, .18, 0x1f2725);
    b(g, .3, .88, -.16, .17, .18, .18, 0x1f2725);
    // legs
    this.legL = b(g, -.15, .4, 0, .18, .78, .22, pants);
    this.legR = b(g, .15, .4, 0, .18, .78, .22, pants);
    b(g, -.15, .06, -.03, .2, .13, .3, 0x1e221f);
    b(g, .15, .06, -.03, .2, .13, .3, 0x1e221f);
    // gun
    const gun = makeWeaponModel(this.idx % 3 === 0 ? 'ak' : this.idx % 3 === 1 ? 'ump' : 'awm');
    gun.scale.setScalar(.9);
    gun.position.set(.2, 1.06, -.24);
    gun.rotation.y = .04;
    g.add(gun);
    this.gun = gun;
    // muzzle flash
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(.2, 1.06, -.82);
    g.add(this.muzzle);
    const flashTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,230,1)');
      grd.addColorStop(.3, 'rgba(255,190,80,.9)');
      grd.addColorStop(1, 'rgba(255,90,10,0)');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.scale.set(.5, .5, 1);
    this.flash.position.copy(this.muzzle.position);
    this.flash.visible = false;
    g.add(this.flash);
    this.muzzleFlashTimer = 0;
    // shadow blob
    const blob = new THREE.Mesh(new THREE.CircleGeometry(.55, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .24, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = .03; g.add(blob);

    this.group.rotation.y = this.yaw;
  }

  pickPatrol() {
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * 65;
    let x = this.position.x + Math.cos(a) * r;
    let z = this.position.z + Math.sin(a) * r;
    x = clamp(x, -MAP.playable, MAP.playable);
    z = clamp(z, -MAP.playable, MAP.playable);
    this.patrol = new THREE.Vector2(x, z);
  }

  eye(out = this._tmp) {
    return out.set(this.position.x, this.position.y + 1.55, this.position.z);
  }

  chest(out = this._tmp) {
    return out.set(this.position.x, this.position.y + 1.05, this.position.z);
  }

  /** Ray vs. head and torso spheres. Returns {t, head} or null. */
  rayHit(ray) {
    if (!this.alive) return null;
    let best = null;
    const spheres = [
      { y: 1.62, r: .26, head: true },
      { y: 1.06, r: .42, head: false },
      { y: .55, r: .3, head: false, limb: true },
    ];
    const oc = this._tmp;
    for (const s of spheres) {
      const cx = this.position.x, cy = this.position.y + s.y, cz = this.position.z;
      const ox = ray.origin.x - cx, oy = ray.origin.y - cy, oz = ray.origin.z - cz;
      const b = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z;
      const c = ox * ox + oy * oy + oz * oz - s.r * s.r;
      const h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t < 0) continue;
      if (!best || t < best.t) best = { t, head: !!s.head, limb: !!s.limb };
    }
    return best;
  }

  takeDamage(amount, attacker) {
    if (!this.alive) return false;
    this.health -= amount;
    this.hitTimer = .16;
    if (attacker) {
      this.lastAttacker = attacker;
      // turn toward the shooter
      const dx = attacker.position.x - this.position.x;
      const dz = attacker.position.z - this.position.z;
      this.yaw = Math.atan2(-dx, -dz);
    }
    if (this.health <= 0) {
      this.health = 0; this.alive = false; this.deathTimer = 0;
      this.target = null;
      return true;
    }
    return false;
  }

  update(dt, game) {
    if (!this.alive) {
      this.deathTimer += dt;
      const t = Math.min(1, this.deathTimer * 2.7);
      this.group.rotation.z = t * Math.PI / 2;
      this.group.position.y = this.position.y - Math.max(0, this.deathTimer - 4) * .4;
      if (this.deathTimer > 9) this.group.visible = false;
      return;
    }

    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    this.flash.visible = this.muzzleFlashTimer > 0;
    const hitGlow = this.hitTimer > 0 ? .55 : .0;
    this.torso.material.emissive.setHex(hitGlow > 0 ? 0x992211 : 0x000000);
    this.torso.material.emissiveIntensity = hitGlow;
    this.head.material.emissive.setHex(hitGlow > 0 ? 0x992211 : 0x000000);
    this.head.material.emissiveIntensity = hitGlow;

    const player = game.player;
    if (!player.alive) this.target = null;

    // Storm pushes bots toward the zone
    const zd = dist(this.position.x, this.position.z, game.zone.x, game.zone.z);
    const outside = zd > game.zone.radius * .92;
    if (outside) {
      this.zoneTimer -= dt;
      if (this.zoneTimer <= 0) {
        this.zoneTimer = 1;
        this.takeDamage(2.2, null);
        if (!this.alive) { game.onBotKilled(this, 'STORM', false); return; }
      }
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = .45 + Math.random() * .4;
      this.chooseTarget(game);
    }

    // Validate target
    let target = this.target;
    if (target && (!target.alive || (target !== player && target.position.distanceTo(this.position) > 140))) target = null;
    if (target && target !== player && !target.alive) target = null;
    this.target = target;

    let moveX = 0, moveZ = 0, speed = 0;
    const eye = this.eye(new THREE.Vector3());

    if (outside) {
      const dx = game.zone.x - this.position.x, dz = game.zone.z - this.position.z;
      const l = Math.hypot(dx, dz) || 1;
      moveX = dx / l; moveZ = dz / l; speed = 4.4;
      this.yaw = Math.atan2(-moveX, -moveZ);
    } else if (target) {
      const dx = target.position.x - this.position.x;
      const dz = target.position.z - this.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const los = worldLOS(this, target);
      if (los) {
        this.state = 'attack';
        const faceYaw = Math.atan2(-dx, -dz);
        this.yaw = smoothAngle(this.yaw, faceYaw, dt * 8);
        const pref = this.preferred;
        if (d > pref + 5) { moveX = dx / d; moveZ = dz / d; speed = 3.1; }
        else if (d < pref * .55) { moveX = -dx / d; moveZ = -dz / d; speed = 2.6; }
        else {
          const sx = -dz / d, sz = dx / d;
          moveX = sx * this.strafeDir; moveZ = sz * this.strafeDir; speed = 2.0;
          if (Math.random() < dt * .5) this.strafeDir *= -1;
        }
        this.fireTimer -= dt;
        if (this.fireTimer <= 0 && d < 105) {
          this.fireTimer = .62 + Math.random() * .7 + (d > 50 ? .3 : 0);
          this.fireAt(target, d, game);
        }
      } else {
        this.state = 'chase';
        moveX = dx / d; moveZ = dz / d; speed = 3.5;
        this.yaw = smoothAngle(this.yaw, Math.atan2(-dx, -dz), dt * 4);
      }
    } else {
      this.state = 'patrol';
      if (!this.patrol || dist(this.position.x, this.position.z, this.patrol.x, this.patrol.y) < 4) this.pickPatrol();
      const dx = this.patrol.x - this.position.x, dz = this.patrol.y - this.position.z;
      const l = Math.hypot(dx, dz) || 1;
      moveX = dx / l; moveZ = dz / l; speed = 2.2;
      this.yaw = smoothAngle(this.yaw, Math.atan2(-moveX, -moveZ), dt * 3);
      // drift toward the safe zone when idle
      if (Math.random() < dt * .25 && zd > game.zone.radius * .55) {
        this.patrol.set(game.zone.x + (Math.random() - .5) * game.zone.radius, game.zone.z + (Math.random() - .5) * game.zone.radius);
      }
    }

    if (speed > 0) {
      const nx = this.position.x + moveX * speed * dt;
      const nz = this.position.z + moveZ * speed * dt;
      this.position.x = nx; this.position.z = nz;
      resolveWorldCollision(this.position, .42);
      this.position.y = groundHeightAt(this.position.x, this.position.z);
      this.walkPhase += dt * speed * 2.4;
    } else {
      this.walkPhase += dt * .5;
    }

    // Animate legs / bob
    const swing = Math.sin(this.walkPhase) * (speed > 0 ? .55 : .05);
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
    this.group.rotation.z = 0;
    this.group.rotation.x = 0;
    this.torso.position.y = 1.06 + Math.abs(Math.sin(this.walkPhase)) * .02;
    this.armL.rotation.x = -1.15 + swing * .06;
    this.armR.rotation.x = -1.35 - swing * .06;
  }

  chooseTarget(game) {
    const player = game.player;
    let best = null, bestScore = Infinity;
    const candidates = [];
    if (player.alive) candidates.push(player);
    for (const bot of game.bots) if (bot !== this && bot.alive) candidates.push(bot);
    for (const c of candidates) {
      const d = dist(this.position.x, this.position.z, c.position.x, c.position.z);
      if (d > 105) continue;
      if (!worldLOS(this, c)) continue;
      let score = d + (c === player ? -8 : 20);
      if (c === this.lastAttacker) score -= 30;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (best) {
      this.target = best;
      this.fireTimer = Math.min(this.fireTimer, .35 + Math.random() * .4);
    } else if (this.target) {
      this.target = null;
    }
  }

  fireAt(target, d, game) {
    if (!this.alive) return;
    const muzzle = new THREE.Vector3();
    this.muzzle.getWorldPosition(muzzle);
    const aim = new THREE.Vector3(target.position.x, target.position.y + (target === game.player ? 1.35 : 1.15), target.position.z);
    const chanceBase = clamp(.72 - d / 155, .13, .64) * this.accuracy;
    const hit = Math.random() < chanceBase;
    const end = aim.clone();
    if (!hit) {
      end.x += (Math.random() - .5) * 3.2;
      end.y += (Math.random() - .5) * 1.7;
      end.z += (Math.random() - .5) * 3.2;
    }
    this.flash.visible = true; this.muzzleFlashTimer = .055;
    game.addTracer(muzzle, end, target === game.player ? 0xffa64d : 0xff6b42, .7);
    if (hit) {
      const dmg = 12 + Math.random() * 10 + (this.idx % 4 === 0 ? 4 : 0);
      if (target === game.player) {
        target.takeDamage(dmg, this, this.name);
      } else {
        const killed = target.takeDamage(dmg, this);
        if (killed) game.onBotKilled(target, this.name, false);
      }
    }
    if (game.audio && dist(this.position.x, this.position.z, game.player.position.x, game.player.position.z) < 150) {
      game.audio.shot(this.idx % 3 === 0 ? 'ak' : this.idx % 3 === 1 ? 'ump' : 'awm', true);
    }
  }
}

function sceneAdd(scene, obj) {
  scene.add(obj);
}

function smoothAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

function worldLOS(bot, target) {
  if (!bot.world) return true;
  const a = bot.eye(new THREE.Vector3());
  const b = new THREE.Vector3(target.position.x, target.position.y + (target === bot.game?.player ? 1.35 : 1.15), target.position.z);
  return bot.world.hasLineOfSight(a.x, a.y, a.z, b.x, b.y, b.z);
}

export function spawnBots(scene, world, count, spawnPoints) {
  const bots = [];
  for (let i = 0; i < Math.min(count, BOT_NAMES.length); i++) {
    let p = spawnPoints[i % spawnPoints.length];
    for (let tries = 0; tries < 20; tries++) {
      const x = clamp(p.x + (Math.random() - .5) * 24, -MAP.playable + 10, MAP.playable - 10);
      const z = clamp(p.z + (Math.random() - .5) * 24, -MAP.playable + 10, MAP.playable - 10);
      if (!world.pointBlocked(x, z, 1.4) && heightAt(x, z) > 1.5) { p = { x, z }; break; }
    }
    bots.push(new Bot(scene, world, BOT_NAMES[i], p.x, p.z, i));
  }
  return bots;
}
