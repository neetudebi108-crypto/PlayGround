import * as THREE from '../vendor/three.module.js';

/* ============================================================
   Weapon definitions + low-poly first-person models
   ============================================================ */

export const WEAPONS = {
  ak47: {
    id: 'ak47', name: 'AK47', category: 'ASSAULT RIFLE', rarity: 'RARE',
    damage: 29, headMult: 2.15, rpm: 600, mag: 30, reserve: 90,
    reload: 2.25, spreadHip: 0.031, spreadAds: 0.0062, recoil: 0.014,
    range: 230, auto: true, zoomFov: 52, color: '#d99955', tracer: '#ffd27a',
    audio: 'ak', lootColor: 0xffa33c, desc: 'Hard-hitting full auto'
  },
  awm: {
    id: 'awm', name: 'AWM', category: 'SNIPER RIFLE', rarity: 'EPIC',
    damage: 112, headMult: 2.5, rpm: 48, mag: 5, reserve: 25,
    reload: 3.1, spreadHip: 0.065, spreadAds: 0.0008, recoil: 0.042,
    range: 600, auto: false, zoomFov: 25, scope: true, color: '#5c9b6e', tracer: '#c9ffe6',
    audio: 'awm', lootColor: 0x59e0a0, desc: 'One shot. One kill.'
  },
  ump: {
    id: 'ump', name: 'UMP', category: 'SUBMACHINE GUN', rarity: 'UNCOMMON',
    damage: 23, headMult: 1.8, rpm: 720, mag: 25, reserve: 100,
    reload: 1.8, spreadHip: 0.024, spreadAds: 0.0072, recoil: 0.0085,
    range: 130, auto: true, zoomFov: 58, color: '#7f93a6', tracer: '#a9e6ff',
    audio: 'ump', lootColor: 0x5ec8ff, desc: 'Fast, stable close range'
  },
  m1911: {
    id: 'm1911', name: 'M1911', category: 'PISTOL', rarity: 'COMMON',
    damage: 27, headMult: 2.0, rpm: 280, mag: 12, reserve: 48,
    reload: 1.55, spreadHip: 0.03, spreadAds: 0.011, recoil: 0.011,
    range: 100, auto: false, zoomFov: 62, color: '#9aa2a8', tracer: '#ffe0a0',
    audio: 'pistol', lootColor: 0xcfd6dc, desc: 'Reliable sidearm'
  }
};

const MET = new THREE.MeshStandardMaterial({ color: 0x4a5057, roughness: 0.42, metalness: 0.55 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.5, metalness: 0.4 });
const WOOD = new THREE.MeshStandardMaterial({ color: 0x9b5d2f, roughness: 0.72, metalness: 0.02 });
const TAN = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.75, metalness: 0.05 });
const GREEN = new THREE.MeshStandardMaterial({ color: 0x51664a, roughness: 0.7, metalness: 0.12 });
const BLACK = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.55, metalness: 0.35 });
const SILVER = new THREE.MeshStandardMaterial({ color: 0x9aa6ad, roughness: 0.35, metalness: 0.7 });

function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}

function cyl(parent, r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 10, rx = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  parent.add(m);
  return m;
}

function buildAK() {
  const g = new THREE.Group();
  box(g, 0.11, 0.15, 0.52, DARK, 0, 0, -0.16);
  box(g, 0.12, 0.09, 0.34, WOOD, 0, 0.045, -0.48);
  cyl(g, 0.024, 0.024, 0.46, MET, 0, 0.02, -0.84, 8);
  cyl(g, 0.031, 0.031, 0.09, DARK, 0, 0.02, -1.05, 8);
  box(g, 0.09, 0.11, 0.3, WOOD, 0, -0.02, 0.22);
  box(g, 0.08, 0.18, 0.1, MET, 0, -0.15, -0.07, 0.28);
  box(g, 0.055, 0.14, 0.075, DARK, 0, -0.11, 0.07, -0.2);
  box(g, 0.04, 0.07, 0.05, MET, 0, 0.115, -0.67);
  box(g, 0.035, 0.05, 0.035, DARK, 0, 0.115, -0.94);
  box(g, 0.045, 0.025, 0.16, MET, 0, 0.085, -0.02);
  // sling hint
  box(g, 0.018, 0.02, 0.5, BLACK, 0.075, -0.06, 0.02, 0, 0, 0.06);
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -1.11), sightY: 0.13 };
}

function buildAWM() {
  const g = new THREE.Group();
  box(g, 0.1, 0.12, 0.72, GREEN, 0, 0, -0.28);
  box(g, 0.085, 0.13, 0.45, GREEN, 0, -0.01, 0.28);
  box(g, 0.09, 0.06, 0.2, BLACK, 0, 0.08, -0.2);
  cyl(g, 0.021, 0.021, 0.9, MET, 0, 0.02, -1.03, 8);
  cyl(g, 0.032, 0.032, 0.1, DARK, 0, 0.02, -1.5, 8);
  // scope
  cyl(g, 0.045, 0.045, 0.4, BLACK, 0, 0.17, -0.23, 12);
  cyl(g, 0.06, 0.06, 0.06, DARK, 0, 0.17, -0.44, 12);
  cyl(g, 0.052, 0.052, 0.06, DARK, 0, 0.17, -0.02, 12);
  box(g, 0.03, 0.06, 0.04, MET, 0, 0.115, -0.13);
  box(g, 0.03, 0.06, 0.04, MET, 0, 0.115, -0.33);
  // bolt + magazine + stock pad
  box(g, 0.12, 0.03, 0.03, MET, 0.1, 0.02, -0.03);
  box(g, 0.075, 0.13, 0.12, BLACK, 0, -0.13, -0.14);
  box(g, 0.1, 0.16, 0.05, BLACK, 0, -0.02, 0.52);
  // bipod
  box(g, 0.02, 0.02, 0.26, MET, -0.06, -0.1, -1.25, 0.5, 0, 0.5);
  box(g, 0.02, 0.02, 0.26, MET, 0.06, -0.1, -1.25, 0.5, 0, -0.5);
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -1.56), sightY: 0.17 };
}

function buildUMP() {
  const g = new THREE.Group();
  box(g, 0.11, 0.15, 0.4, DARK, 0, 0, -0.1);
  box(g, 0.09, 0.11, 0.25, BLACK, 0, 0.01, -0.4);
  cyl(g, 0.026, 0.026, 0.28, MET, 0, 0.02, -0.63, 8);
  cyl(g, 0.035, 0.035, 0.06, DARK, 0, 0.02, -0.78, 8);
  box(g, 0.07, 0.2, 0.1, MET, 0, -0.15, -0.13, 0.16);
  box(g, 0.055, 0.13, 0.07, DARK, 0, -0.1, 0.11, -0.22);
  box(g, 0.08, 0.09, 0.22, BLACK, 0, -0.01, 0.24);
  box(g, 0.03, 0.07, 0.04, MET, 0, 0.11, -0.33);
  box(g, 0.16, 0.02, 0.035, MET, 0, 0.07, 0.02);
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.82), sightY: 0.11 };
}

function buildPistol() {
  const g = new THREE.Group();
  box(g, 0.07, 0.09, 0.28, SILVER, 0, 0.02, -0.1);
  box(g, 0.06, 0.16, 0.09, DARK, 0, -0.11, 0.03, -0.18);
  cyl(g, 0.021, 0.021, 0.09, MET, 0, 0.02, -0.27, 8);
  box(g, 0.025, 0.04, 0.03, DARK, 0, 0.075, -0.2);
  return { group: g, muzzle: new THREE.Vector3(0, 0.02, -0.33), sightY: 0.08 };
}

const BUILDERS = { ak47: buildAK, awm: buildAWM, ump: buildUMP, m1911: buildPistol };

export function buildWeaponModel(weaponId, opts = {}) {
  const builder = BUILDERS[weaponId] || buildAK;
  const built = builder();
  const group = built.group;
  if (opts.scale) group.scale.setScalar(opts.scale);
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = opts.castShadow !== false;
      o.receiveShadow = false;
      if (opts.emissive) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(opts.emissive);
        o.material.emissiveIntensity = 0.18;
      }
    }
  });
  group.userData.muzzle = built.muzzle.clone();
  group.userData.sightY = built.sightY;
  return group;
}

export function makeLootWeapon(weaponId) {
  const def = WEAPONS[weaponId];
  const group = buildWeaponModel(weaponId, { scale: 0.55, castShadow: false });
  group.rotation.set(0, Math.PI / 2, -0.18);
  const ringMat = new THREE.MeshBasicMaterial({
    color: def.lootColor, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  const beamMat = new THREE.MeshBasicMaterial({
    color: def.lootColor, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.5, 5, 10, 1, true), beamMat);
  beam.position.y = 2.5;
  group.add(beam);
  group.userData.ring = ring;
  group.userData.beam = beam;
  return group;
}

export function makeAmmoBox(color = 0xd7a52b) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.2 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.42), mat);
  b.position.y = 0.25;
  g.add(b);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.1, 0.45), new THREE.MeshStandardMaterial({ color: 0x2c3136 }));
  band.position.y = 0.27;
  g.add(band);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.5, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

export function makeMedkit() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.6 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.48), mat);
  b.position.y = 0.22;
  g.add(b);
  const red = new THREE.MeshStandardMaterial({ color: 0xd62f2f, roughness: 0.5 });
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.1), red); c1.position.y = 0.4;
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.34), red); c2.position.y = 0.4;
  g.add(c1, c2);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.5, 20), new THREE.MeshBasicMaterial({ color: 0x7ef06a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

export function weaponStatsLabel(id) {
  const w = WEAPONS[id];
  return `${w.damage} DMG • ${w.rpm} RPM • ${w.mag} MAG`;
}
