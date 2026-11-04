import * as THREE from '../vendor/three.module.js';
import { WEAPONS } from './weapons.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);

const NAMES = [
  'RAVEN', 'NOVA', 'GHOST', 'KIRA', 'BLAZE', 'VIPER', 'ROOK', 'ECHO',
  'SABLE', 'FURY', 'ONYX', 'LYNX', 'HAVOC', 'ZERO', 'MIRAGE', 'TALON',
  'RIFT', 'SPECTER', 'JINX', 'ACE', 'WRAITH', 'CIPHER', 'BOLT', 'DUSK'
];
const COLORS = [0x9d3c2f, 0x2f6d9d, 0x7a6a2f, 0x3c7a4a, 0x7a3c76, 0x59616a, 0x9a5a2a, 0x2f7a7a];

function angleLerp(a, b, t) {
  let d = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class BotManager {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.scene = game.scene;
    this.player = game.player;
    this.ui = game.ui;
    this.audio = game.audio;
    this.effects = game.effects;
    this.bots = [];
    this.hitMeshes = [];
  }

  spawn(count = 23) {
    const spawns = this.world.botSpawns;
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const sp = spawns[i % Math.max(1, spawns.length)] || { x: rand(-300, 300), z: rand(-300, 300) };
      const x = clamp(sp.x + rand(-7, 7), -480, 480);
      const z = clamp(sp.z + rand(-7, 7), -480, 480);
      const y = this.world.groundHeight(x, z, Infinity);
      const roll = Math.random();
      const weaponId = roll < 0.52 ? 'ak47' : roll < 0.82 ? 'ump' : 'awm';
      const bot = {
        id: i, name: names[i % names.length],
        pos: new THREE.Vector3(x, y, z),
        yaw: rand(-Math.PI, Math.PI),
        health: 100, maxHealth: 100, alive: true,
        weaponId, def: WEAPONS[weaponId],
        fireTimer: rand(1.2, 3.5), think: rand(0, 0.6),
        target: null, targetType: null,
        wander: new THREE.Vector3(x, y, z),
        mesh: null, hpGroup: null, hpFill: null,
        hitMeshes: [], legL: null, legR: null, armL: null, armR: null,
        walk: Math.random() * 6, deadTimer: 0, kills: 0,
        skill: rand(0.75, 1.18), stormTick: 0,
        stuck: 0, lastX: x, lastZ: z, strafe: Math.random() > 0.5 ? 1 : -1
      };
      this._buildMesh(bot);
      this.bots.push(bot);
      this.hitMeshes.push(...bot.hitMeshes);
    }
  }

  _buildMesh(bot) {
    const group = new THREE.Group();
    group.position.copy(bot.pos);
    group.rotation.y = bot.yaw;
    const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS[bot.id % COLORS.length], roughness: 0.78, metalness: 0.04 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x252b30, roughness: 0.7, metalness: 0.18 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xb9855f, roughness: 0.9 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xd6a02e, roughness: 0.6, metalness: 0.2 });

    const add = (parent, w, h, d, mat, x, y, z, head = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = this.world.quality === 'high';
      m.userData.bot = bot;
      if (head) m.userData.isHead = true;
      parent.add(m);
      bot.hitMeshes.push(m);
      return m;
    };

    add(group, 0.56, 0.62, 0.34, bodyMat, 0, 1.23, 0);
    add(group, 0.58, 0.12, 0.36, accentMat, 0, 1.18, 0);
    add(group, 0.34, 0.34, 0.32, skinMat, 0, 1.72, 0, true);
    add(group, 0.38, 0.14, 0.36, darkMat, 0, 1.9, 0);
    add(group, 0.4, 0.4, 0.18, darkMat, 0, 1.22, 0.23);

    const legL = new THREE.Group();
    legL.position.set(-0.16, 0.9, 0);
    add(legL, 0.21, 0.74, 0.23, darkMat, 0, -0.36, 0);
    add(legL, 0.24, 0.14, 0.3, darkMat, 0, -0.76, -0.03);
    group.add(legL);
    const legR = new THREE.Group();
    legR.position.set(0.16, 0.9, 0);
    add(legR, 0.21, 0.74, 0.23, darkMat, 0, -0.36, 0);
    add(legR, 0.24, 0.14, 0.3, darkMat, 0, -0.76, -0.03);
    group.add(legR);

    const armL = new THREE.Group();
    armL.position.set(-0.38, 1.45, 0);
    add(armL, 0.15, 0.5, 0.17, bodyMat, 0, -0.23, 0);
    group.add(armL);
    const armR = new THREE.Group();
    armR.position.set(0.38, 1.45, 0);
    add(armR, 0.15, 0.5, 0.17, bodyMat, 0, -0.23, 0);
    group.add(armR);

    // Simple rifle silhouette in the bot's hands.
    add(group, 0.09, 0.1, 0.62, darkMat, 0.27, 1.27, -0.32);
    add(group, 0.05, 0.05, 0.3, accentMat, 0.27, 1.28, -0.72);
    add(group, 0.08, 0.14, 0.09, darkMat, 0.27, 1.14, -0.2);

    this.game.matchGroup.add(group);
    bot.mesh = group;
    bot.legL = legL; bot.legR = legR; bot.armL = armL; bot.armR = armR;

    const hp = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.02, 0.13),
      new THREE.MeshBasicMaterial({ color: 0x0a0b0d, transparent: true, opacity: 0.72, depthWrite: false })
    );
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.075),
      new THREE.MeshBasicMaterial({ color: 0x6ee66a, depthWrite: false })
    );
    fill.position.z = 0.002;
    hp.add(bg, fill);
    hp.position.set(bot.pos.x, bot.pos.y + 2.22, bot.pos.z);
    hp.visible = false;
    hp.renderOrder = 20;
    this.game.matchGroup.add(hp);
    bot.hpGroup = hp;
    bot.hpFill = fill;
    bot.hpBg = bg;
  }

  aliveCount() {
    let n = 0;
    for (const b of this.bots) if (b.alive) n++;
    return n;
  }

  damageBot(bot, damage, head, point, weaponName) {
    if (!bot || !bot.alive) return;
    bot.health -= damage;
    bot.lastHurt = this.game.time;
    if (bot.health <= 0) {
      this.killBot(bot, this.game.player, weaponName, head);
    }
  }

  killBot(bot, killer, weaponName, head = false) {
    if (!bot.alive) return;
    bot.alive = false;
    bot.health = 0;
    bot.deadTimer = 0;
    if (bot.hpGroup) bot.hpGroup.visible = false;
    for (const m of bot.hitMeshes) {
      const idx = this.hitMeshes.indexOf(m);
      if (idx >= 0) this.hitMeshes.splice(idx, 1);
    }
    bot.hitMeshes = [];
    const byPlayer = killer === this.game.player;
    let killerName = 'STORM';
    if (killer === this.game.player) killerName = 'YOU';
    else if (killer && killer.name) { killerName = killer.name; killer.kills += 1; }

    this.effects.spawn(new THREE.Vector3(bot.pos.x, bot.pos.y + 1.2, bot.pos.z), 0xb51f1f, 16, 4.5, 11, 0.7);
    this.ui.addKill(killerName, bot.name, weaponName, { me: byPlayer, head });
    if (byPlayer) {
      this.player.p.kills += 1;
      this.audio.kill();
      this.ui.showHitmarker(true, head);
      this.ui.showBanner('ELIMINATED', bot.name, 800);
    }

    this.game.spawnLootAt(bot.pos.x + rand(-1, 1), bot.pos.z + rand(-1, 1), 'weapon', bot.weaponId, 0.4);
    if (Math.random() < 0.55) {
      this.game.spawnLootAt(bot.pos.x + rand(-1.5, 1.5), bot.pos.z + rand(-1.5, 1.5), 'medkit', null, 0.4);
    }
    this.game.checkVictory();
  }

  update(dt) {
    const player = this.player.p;
    const zone = this.game.zone;
    for (const bot of this.bots) {
      if (!bot.alive) {
        bot.deadTimer += dt;
        if (bot.mesh) {
          if (bot.deadTimer < 0.55) {
            const t = bot.deadTimer / 0.55;
            bot.mesh.rotation.z = t * Math.PI * 0.5;
            bot.mesh.position.y = bot.pos.y + Math.sin(t * Math.PI) * 0.12;
          } else {
            bot.mesh.position.y -= dt * 0.22;
            bot.mesh.rotation.z = Math.PI * 0.5;
          }
          if (bot.deadTimer > 7) {
            bot.mesh.visible = false;
            if (bot.hpGroup) bot.hpGroup.visible = false;
          }
        }
        continue;
      }

      const ground = this.world.groundHeight(bot.pos.x, bot.pos.z, bot.pos.y);
      bot.pos.y = ground < 0.1 && bot.pos.y < 1.4 ? Math.max(ground, -0.85) : ground;
      if (Math.hypot(bot.pos.x - bot.lastX, bot.pos.z - bot.lastZ) < 0.05) bot.stuck += dt;
      else { bot.stuck = 0; bot.lastX = bot.pos.x; bot.lastZ = bot.pos.z; }

      const dz = Math.hypot(bot.pos.x - zone.x, bot.pos.z - zone.z);
      const outside = dz > zone.radius;
      if (outside) {
        bot.stormTick += dt;
        if (bot.stormTick > 1) {
          bot.stormTick = 0;
          bot.health -= zone.damage;
          if (bot.health <= 0) { this.killBot(bot, null, 'ZONE'); continue; }
        }
      } else bot.stormTick = 0;

      bot.think -= dt;
      if (bot.think <= 0) {
        bot.think = rand(0.6, 1.15);
        this._think(bot, outside);
      }

      this._move(bot, dt, outside);

      // Shooting
      if (bot.target) {
        const targetPos = bot.targetType === 'player' ? player.pos : bot.target.pos;
        const dist = Math.hypot(targetPos.x - bot.pos.x, targetPos.z - bot.pos.z);
        if (bot.fireTimer > 0) bot.fireTimer -= dt;
        if (bot.fireTimer <= 0 && dist < (bot.weaponId === 'awm' ? 140 : 75)) {
          if (this.world.hasLineOfSight(bot.pos.x, bot.pos.y + 1.3, bot.pos.z, targetPos.x, targetPos.y + 1.2, targetPos.z)) {
            this._shoot(bot, targetPos, dist);
            const rpm = bot.weaponId === 'awm' ? 44 : bot.def.rpm * 0.36;
            bot.fireTimer = (60 / rpm) * rand(1.9, 3.1);
          }
        }
      }

      if (bot.mesh) {
        bot.mesh.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
        bot.mesh.rotation.y = bot.yaw;
        const moving = Math.hypot(bot.pos.x - bot.lastX, bot.pos.z - bot.lastZ) > 0.01;
        if (moving) bot.walk += dt * 7;
        const swing = moving ? Math.sin(bot.walk) * 0.55 : 0;
        if (bot.legL) bot.legL.rotation.x = swing;
        if (bot.legR) bot.legR.rotation.x = -swing;
        if (bot.armL) bot.armL.rotation.x = -swing * 0.35;
        if (bot.armR) bot.armR.rotation.x = swing * 0.35;
      }
      if (bot.hpGroup) {
        const d = Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
        bot.hpGroup.visible = d < 120;
        if (bot.hpGroup.visible) {
          bot.hpGroup.position.set(bot.pos.x, bot.pos.y + 2.22, bot.pos.z);
          bot.hpGroup.quaternion.copy(this.game.camera.quaternion);
          const f = clamp(bot.health / bot.maxHealth, 0, 1);
          bot.hpFill.scale.x = f;
          bot.hpFill.position.x = -(1 - f) * 0.46;
          bot.hpFill.material.color.setHex(f > 0.55 ? 0x6ee66a : f > 0.28 ? 0xffd23f : 0xff3d3d);
        }
      }
    }
  }

  _think(bot, outside) {
    const player = this.player.p;
    const zone = this.game.zone;
    if (outside) {
      bot.target = null;
      bot.targetType = null;
      bot.wander.set(zone.x + rand(-zone.radius * 0.35, zone.radius * 0.35), 0, zone.z + rand(-zone.radius * 0.35, zone.radius * 0.35));
      return;
    }
    const pd = Math.hypot(player.pos.x - bot.pos.x, player.pos.z - bot.pos.z);
    if (player.alive && !player.dropping && pd < 72) {
      if (this.world.hasLineOfSight(bot.pos.x, bot.pos.y + 1.3, bot.pos.z, player.pos.x, player.pos.y + 1.2, player.pos.z)) {
        bot.target = player;
        bot.targetType = 'player';
        bot.strafe = Math.random() > 0.5 ? 1 : -1;
        return;
      }
    }
    let best = null, bestD = 58;
    for (const other of this.bots) {
      if (other === bot || !other.alive) continue;
      const d = Math.hypot(other.pos.x - bot.pos.x, other.pos.z - bot.pos.z);
      if (d < bestD) {
        if (this.world.hasLineOfSight(bot.pos.x, bot.pos.y + 1.3, bot.pos.z, other.pos.x, other.pos.y + 1.2, other.pos.z)) {
          best = other; bestD = d;
        }
      }
    }
    if (best) {
      bot.target = best; bot.targetType = 'bot';
      return;
    }
    bot.target = null; bot.targetType = null;
    const r = zone.radius * 0.55;
    bot.wander.set(zone.x + rand(-r, r), 0, zone.z + rand(-r, r));
  }

  _move(bot, dt, outside) {
    let tx, tz, speed;
    if (bot.target) {
      const t = bot.targetType === 'player' ? this.player.p.pos : bot.target.pos;
      const dist = Math.hypot(t.x - bot.pos.x, t.z - bot.pos.z);
      const desired = bot.weaponId === 'awm' ? 58 : bot.weaponId === 'ump' ? 17 : 28;
      const dx = (t.x - bot.pos.x) / (dist || 1);
      const dz = (t.z - bot.pos.z) / (dist || 1);
      if (dist > desired + 7) { tx = bot.pos.x + dx * 10; tz = bot.pos.z + dz * 10; }
      else if (dist < desired - 5) { tx = bot.pos.x - dx * 10; tz = bot.pos.z - dz * 10; }
      else {
        tx = bot.pos.x - dz * bot.strafe * 10;
        tz = bot.pos.z + dx * bot.strafe * 10;
      }
      speed = 3.0;
      bot.yaw = angleLerp(bot.yaw, Math.atan2(-(t.x - bot.pos.x), -(t.z - bot.pos.z)), 1 - Math.exp(-7 * dt));
    } else {
      if (Math.hypot(bot.wander.x - bot.pos.x, bot.wander.z - bot.pos.z) < 3) {
        const r = this.game.zone.radius * 0.55;
        bot.wander.set(this.game.zone.x + rand(-r, r), 0, this.game.zone.z + rand(-r, r));
      }
      tx = bot.wander.x; tz = bot.wander.z;
      speed = outside ? 5.1 : 2.8;
      if (outside) speed = 5.2;
    }
    const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.0) {
      const vx = dx / d * speed, vz = dz / d * speed;
      bot.pos.x += vx * dt;
      bot.pos.z += vz * dt;
      bot.pos.x = clamp(bot.pos.x, -492, 492);
      bot.pos.z = clamp(bot.pos.z, -492, 492);
      if (!bot.target) bot.yaw = angleLerp(bot.yaw, Math.atan2(-vx, -vz), 1 - Math.exp(-5 * dt));
      this.world.resolveCollision(bot.pos, 0.48);
    }
    if (bot.stuck > 1.1) {
      bot.stuck = 0;
      bot.wander.set(bot.pos.x + rand(-25, 25), 0, bot.pos.z + rand(-25, 25));
      bot.pos.x += rand(-0.5, 0.5);
      bot.pos.z += rand(-0.5, 0.5);
    }
  }

  _shoot(bot, targetPos, dist) {
    const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.28, bot.pos.z);
    const isPlayer = bot.targetType === 'player';
    const head = Math.random() < 0.06;
    let chance = clamp(0.27 - dist * 0.0023, 0.05, 0.25) * bot.skill;
    if (isPlayer) {
      if (this.player.p.sprinting) chance *= 0.72;
      if (this.player.p.crouching) chance *= 1.04;
    }
    const hit = Math.random() < chance;
    const aim = new THREE.Vector3(targetPos.x, targetPos.y + (isPlayer ? 1.25 : 1.1), targetPos.z);
    if (!hit) {
      aim.x += rand(-3.2, 3.2);
      aim.y += rand(-1.2, 1.6);
      aim.z += rand(-3.2, 3.2);
    }
    this.effects.tracers.spawn(from, aim, bot.weaponId === 'awm' ? 0xffd27a : 0xff8a4a);
    this.effects.spawn(from, 0xffb35a, 4, 2.4, 7, 0.18);
    if (Math.hypot(bot.pos.x - this.player.p.pos.x, bot.pos.z - this.player.p.pos.z) < 48) {
      this.audio.shot(bot.def.audio);
    }
    if (!hit) return;

    if (isPlayer) {
      const base = bot.weaponId === 'awm' ? 30 : bot.weaponId === 'ump' ? 5 : 6.5;
      const dmg = base * rand(0.85, 1.15) * (head ? 1.7 : 1);
      this.player.takeDamage(dmg, bot.name, bot.def.name, head);
    } else if (bot.target && bot.target.alive) {
      const base = bot.weaponId === 'awm' ? 38 : bot.weaponId === 'ump' ? 7 : 8.5;
      bot.target.health -= base * rand(0.8, 1.2) * (head ? 1.6 : 1);
      if (bot.target.health <= 0) this.killBot(bot.target, bot, bot.def.name, head);
    }
  }

  clear() {
    this.bots = [];
    this.hitMeshes = [];
  }
}
