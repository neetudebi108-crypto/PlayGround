import * as THREE from '../vendor/three.module.js';

/* ============================================================
   FIREZONE — procedural 1 km² island
   Axes: x east/west, z north/south.  Map spans -500..500.
   ============================================================ */

export const MAP_SIZE = 1000;
export const HALF = MAP_SIZE / 2;
export const WATER_LEVEL = 0.45;

export const POIS = [
  { id: 'factory', name: 'FACTORY', short: 'FAC', x: -260, z: -230, radius: 96, color: '#e29a45' },
  { id: 'clock', name: 'CLOCK TOWER', short: 'CLK', x: 10, z: 5, radius: 74, color: '#ffd35c' },
  { id: 'village', name: 'RIM RAM VILLAGE', short: 'VIL', x: 280, z: -150, radius: 88, color: '#9ed46c' },
  { id: 'peak', name: 'PEAK', short: 'PK', x: -200, z: 170, radius: 82, color: '#c7d2dc' },
  { id: 'riverside', name: 'RIVERSIDE', short: 'RIV', x: 100, z: 285, radius: 64, color: '#53d6f2' }
];

/* Deterministic RNG */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix, iz) {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = smooth(fx), sz = smooth(fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

function fbm(x, z, octaves = 4) {
  let v = 0, amp = 0.5, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(x * freq, z * freq) * amp;
    total += amp; amp *= 0.5; freq *= 2.03;
  }
  return v / total;
}

export function riverZ(x) {
  return 350 + Math.sin(x * 0.0055) * 45 + Math.sin(x * 0.013 + 2.0) * 14;
}

const FLAT_ZONES = [
  { x: -260, z: -230, r: 100, blend: 34 },
  { x: 10, z: 5, r: 76, blend: 30 },
  { x: 280, z: -150, r: 92, blend: 34 },
  { x: 100, z: 285, r: 66, blend: 28 },
  { x: -200, z: 170, r: 27, blend: 32 },
  { x: 100, z: 333, r: 21, blend: 20, h: 5.2 },
  { x: 100, z: 409, r: 21, blend: 20, h: 5.2 }
];

function rawHeight(x, z) {
  let h = 4.6;
  h += fbm(x * 0.0062 + 13.1, z * 0.0062 + 7.7, 4) * 12.5;
  h += fbm(x * 0.022 + 2.4, z * 0.022 + 9.2, 3) * 2.4;
  h += Math.sin(x * 0.008 + z * 0.004) * 1.5;

  // The Peak — a real mountain on the north-west side.
  const pdx = x + 200, pdz = z - 170;
  const pd = Math.sqrt(pdx * pdx + pdz * pdz);
  const mountain = Math.max(0, 1 - pd / 205);
  h += Math.pow(mountain, 2.2) * 48 + Math.pow(Math.max(0, 1 - pd / 72), 3) * 24;

  // Ridge line to make the peak feel connected to the island.
  const ridge = Math.max(0, 1 - Math.abs(x + 250 + Math.sin(z * 0.012) * 35) / 60) *
                Math.max(0, 1 - Math.abs(z - 20) / 280);
  h += ridge * 8;

  // River valley carve.
  const rz = riverZ(x);
  const rd = Math.abs(z - rz);
  const rw = 27 + Math.sin(x * 0.028) * 7;
  if (rd < rw + 34) {
    const t = smooth(clamp((rw + 34 - rd) / 34, 0, 1));
    h = lerp(h, -2.7, t);
  }
  return h;
}

for (const f of FLAT_ZONES) {
  if (f.h === undefined) f.h = rawHeight(f.x, f.z);
}

export function heightAt(x, z) {
  let h = rawHeight(x, z);
  for (const f of FLAT_ZONES) {
    const dx = x - f.x, dz = z - f.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < f.r + f.blend) {
      const t = smooth(clamp((f.r + f.blend - d) / f.blend, 0, 1));
      h = lerp(h, f.h, t);
    }
  }
  return h;
}

export function isWater(x, z) {
  return heightAt(x, z) < WATER_LEVEL - 0.05;
}

function makeCanvasTexture(draw, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeLabelTexture(title, sub, color = '#ffb44a') {
  return makeCanvasTexture((ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.textAlign = 'center';
    ctx.font = '700 34px Rajdhani, Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,.9)';
    ctx.shadowBlur = 8;
    ctx.fillText(title, s / 2, 92);
    ctx.font = '600 17px Rajdhani, Arial, sans-serif';
    ctx.fillStyle = 'rgba(235,244,250,.9)';
    ctx.fillText(sub, s / 2, 122);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s * 0.28, 76); ctx.lineTo(s * 0.42, 76);
    ctx.moveTo(s * 0.58, 76); ctx.lineTo(s * 0.72, 76);
    ctx.stroke();
  }, 256);
}

function makeClockTexture() {
  return makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = '#e8e0c8';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b2b25';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const r1 = s * 0.39, r2 = i % 3 === 0 ? s * 0.32 : s * 0.35;
      ctx.strokeStyle = '#2b2b25';
      ctx.lineWidth = i % 3 === 0 ? 7 : 3;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1);
      ctx.lineTo(s / 2 + Math.cos(a) * r2, s / 2 + Math.sin(a) * r2);
      ctx.stroke();
    }
    const now = new Date();
    const hA = ((now.getHours() % 12) / 12 + now.getMinutes() / 720) * Math.PI * 2 - Math.PI / 2;
    const mA = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
    const sA = (now.getSeconds() / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1b1b18'; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(hA) * s * 0.22, s / 2 + Math.sin(hA) * s * 0.22); ctx.stroke();
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(mA) * s * 0.31, s / 2 + Math.sin(mA) * s * 0.31); ctx.stroke();
    ctx.strokeStyle = '#a3321f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(sA) * s * 0.35, s / 2 + Math.sin(sA) * s * 0.35); ctx.stroke();
    ctx.fillStyle = '#1b1b18';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, 7, 0, Math.PI * 2); ctx.fill();
  }, 256);
}

export class World {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.rng = mulberry32(90210);
    this.colliders = [];
    this.raycastTargets = [];
    this.platforms = [];
    this.lootSpawns = [];
    this.botSpawns = [];
    this.flatZones = FLAT_ZONES;
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.time = 0;
    this.clockLast = 0;
    this.materials = {};
    this._buildMaterials();
    this.build();
  }

  _buildMaterials() {
    const std = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.02, ...opts });
    this.materials = {
      concrete: std(0x9a978b, { roughness: 1 }),
      concreteDark: std(0x5c605f, { roughness: 1 }),
      rust: std(0x9a4c2a, { roughness: 0.8, metalness: 0.18 }),
      red: std(0xb63a2c),
      blue: std(0x356f8e),
      green: std(0x4f6c3f),
      yellow: std(0xd5a52b),
      wood: std(0x77532f, { roughness: 1 }),
      woodDark: std(0x4b3420, { roughness: 1 }),
      roof: std(0x3f4950),
      roofRed: std(0x80382b),
      roofBlue: std(0x2f4d63),
      metal: std(0x7c858d, { roughness: 0.55, metalness: 0.45 }),
      metalDark: std(0x414951, { roughness: 0.6, metalness: 0.4 }),
      glass: std(0x7fd6e8, { roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.55 }),
      sand: std(0x8f815a, { roughness: 1 }),
      rock: std(0x777d7d, { roughness: 1, flatShading: true }),
      snow: std(0xd8e2e6, { roughness: 0.9 })
    };
  }

  addBox(x, z, w, h, d, material, opts = {}) {
    const {
      y, rot = 0, collide = true, ray = true, cast = true, receive = true, parent = this.group
    } = opts;
    const base = y !== undefined ? y : heightAt(x, z);
    const mat = typeof material === 'string' ? this.materials[material] : material;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, base + h / 2, z);
    mesh.rotation.y = rot;
    mesh.castShadow = cast && this.quality === 'high';
    mesh.receiveShadow = receive;
    parent.add(mesh);
    if (ray) this.raycastTargets.push(mesh);
    if (collide) {
      const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
      const ew = (w * c + d * s) / 2;
      const ed = (w * s + d * c) / 2;
      this.colliders.push({ minX: x - ew, maxX: x + ew, minY: base, maxY: base + h, minZ: z - ed, maxZ: z + ed });
    }
    return mesh;
  }

  addCylinder(x, z, radius, h, material, opts = {}) {
    const { y, segments = 12, collide = true, ray = true, cast = true, parent = this.group } = opts;
    const base = y !== undefined ? y : heightAt(x, z);
    const mat = typeof material === 'string' ? this.materials[material] : material;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.04, h, segments), mat);
    mesh.position.set(x, base + h / 2, z);
    mesh.castShadow = cast && this.quality === 'high';
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (ray) this.raycastTargets.push(mesh);
    if (collide) {
      this.colliders.push({
        minX: x - radius, maxX: x + radius, minY: base, maxY: base + h,
        minZ: z - radius, maxZ: z + radius
      });
    }
    return mesh;
  }

  addGableRoof(x, z, w, d, h, material, base, rot = 0) {
    const mat = typeof material === 'string' ? this.materials[material] : material;
    const slope = Math.sqrt((d / 2) * (d / 2) + h * h);
    const angle = Math.atan2(h, d / 2);
    const g = new THREE.Group();
    g.position.set(x, base, z);
    g.rotation.y = rot;
    for (const side of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.24, slope + 0.5), mat);
      plane.position.set(0, h / 2, side * d / 4);
      plane.rotation.x = side * angle;
      plane.castShadow = this.quality === 'high';
      plane.receiveShadow = true;
      g.add(plane);
      this.raycastTargets.push(plane);
    }
    this.group.add(g);
    return g;
  }

  addHouse(x, z, w, d, wallMat, roofMat, rot = 0, wallH = 3.8) {
    const base = heightAt(x, z);
    this.addBox(x, z, w + 0.5, 0.5, d + 0.5, 'concreteDark', { y: base - 0.15, rot, collide: false });
    this.addBox(x, z, w, wallH, d, wallMat, { y: base + 0.1, rot });
    this.addGableRoof(x, z, w, d, 2.2 + this.rng() * 1.2, roofMat, base + wallH + 0.1, rot);
    // Door
    const door = this.addBox(x, z, 1.4, 2.2, 0.12, 'woodDark', {
      y: base + 0.1, rot, collide: false, cast: false
    });
    door.position.x += Math.sin(rot) * (d / 2 + 0.08);
    door.position.z += Math.cos(rot) * (d / 2 + 0.08);
    // Windows
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const win = this.addBox(x + sx * (w / 2 - 1.3), z + sz * (d / 2 + 0.03), 1.5, 1.2, 0.1, 'glass', {
          y: base + 2.1, rot, collide: false, cast: false, ray: false
        });
        win.rotation.y = rot + (sz > 0 ? 0 : Math.PI);
      }
    }
    // Chimney
    if (this.rng() > 0.35) {
      const cx = x + Math.cos(rot) * (w * 0.28) - Math.sin(rot) * (d * 0.18);
      const cz = z - Math.sin(rot) * (w * 0.28) - Math.cos(rot) * (d * 0.18);
      this.addBox(cx, cz, 0.9, 2.6, 0.9, 'rust', { y: base + wallH + 1.1, rot, collide: false });
    }
    return base;
  }

  addFence(x1, z1, x2, z2, h = 1.25) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const rot = Math.atan2(dx, dz);
    const base = heightAt(mx, mz);
    this.addBox(mx, mz, 0.16, h, len, 'wood', { y: base, rot, collide: false, cast: false });
    const n = Math.max(2, Math.round(len / 5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = lerp(x1, x2, t), pz = lerp(z1, z2, t);
      this.addBox(px, pz, 0.24, h + 0.35, 0.24, 'woodDark', { y: heightAt(px, pz), rot, collide: false, cast: false });
    }
  }

  addLamp(x, z) {
    const base = heightAt(x, z);
    this.addCylinder(x, z, 0.16, 5.2, 'metalDark', { y: base, collide: false, segments: 6 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    bulb.position.set(x, base + 5.35, z);
    this.group.add(bulb);
  }

  addSign(x, z, title, sub, color, yOffset = 13, scale = 18) {
    const tex = makeLabelTexture(title, sub, color);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, opacity: 0.92 });
    const sprite = new THREE.Sprite(mat);
    const base = heightAt(x, z);
    sprite.position.set(x, base + yOffset, z);
    sprite.scale.set(scale, scale / 2, 1);
    sprite.renderOrder = 4;
    this.group.add(sprite);
    return sprite;
  }

  build() {
    this.buildTerrain();
    this.buildWater();
    this.buildRoads();
    this.buildFactory();
    this.buildClockTower();
    this.buildVillage();
    this.buildPeak();
    this.buildRiverside();
    this.buildNature();
    this.buildSpawns();
    this.buildMinimap();
  }

  buildTerrain() {
    const seg = this.quality === 'high' ? 190 : 130;
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color(0x426a35);
    const grassB = new THREE.Color(0x557c3e);
    const grassDry = new THREE.Color(0x78804a);
    const sand = new THREE.Color(0x9b8a5e);
    const wet = new THREE.Color(0x635d45);
    const rock = new THREE.Color(0x777d7c);
    const snow = new THREE.Color(0xdde6e8);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const n = valueNoise(x * 0.09, z * 0.09);
      if (h < WATER_LEVEL + 0.35) c.copy(wet);
      else if (h < 2.2) c.copy(sand).lerp(wet, (2.2 - h) / 2.2 * 0.6);
      else if (h > 47) c.copy(rock).lerp(snow, clamp((h - 52) / 20, 0, 1));
      else {
        c.copy(grassA).lerp(grassB, n);
        if (h > 26) c.lerp(rock, clamp((h - 26) / 24, 0, 0.75));
        if (n > 0.72) c.lerp(grassDry, (n - 0.72) * 2.4);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.98, metalness: 0,
      flatShading: true, side: THREE.FrontSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain';
    this.terrain = mesh;
    this.group.add(mesh);
    this.raycastTargets.push(mesh);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(MAP_SIZE + 80, MAP_SIZE + 80, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a718e, roughness: 0.22, metalness: 0.15,
      transparent: true, opacity: 0.78, depthWrite: false
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.y = WATER_LEVEL;
    this.water.renderOrder = 1;
    this.group.add(this.water);
  }

  buildRoads() {
    const routes = [
      [[-260, -230], [-150, -140], [-45, -60], [10, 5]],
      [[10, 5], [130, -55], [215, -110], [280, -150]],
      [[10, 5], [45, 125], [72, 210], [100, 285]],
      [[280, -150], [230, 30], [160, 190], [100, 285]],
      [[-260, -230], [-265, -70], [-238, 90], [-200, 170]],
      [[100, 285], [100, 333]],
      [[100, 409], [100, 500]]
    ];
    for (const pts of routes) this.addRoad(pts, 7.2);
    this.buildBridge();
  }

  addRoad(points, width = 7) {
    const curvePts = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.15);
    const steps = Math.max(18, Math.round(curve.getLength() / 7));
    const positions = [];
    const indices = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = curve.getPoint(t);
      const tangent = curve.getTangent(t).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(up, tangent).normalize().multiplyScalar(width / 2);
      for (const s of [-1, 1]) {
        const x = p.x + side.x * s, z = p.z + side.z * s;
        positions.push(x, heightAt(x, z) + 0.12, z);
      }
      if (i < steps) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8a806b, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.raycastTargets.push(mesh);
  }

  buildBridge() {
    const cx = 100, cz = riverZ(100);
    const len = 80, width = 10, deckY = 5.2;
    this.addBox(cx, cz, width, 0.75, len, 'concreteDark', { y: deckY - 0.75, collide: true });
    this.addBox(cx, cz, width - 1.2, 0.12, len - 1.2, 'wood', { y: deckY, collide: false, ray: false });
    // Railings
    for (const sx of [-1, 1]) {
      this.addBox(cx + sx * (width / 2 - 0.2), cz, 0.18, 1.1, len, 'metalDark', { y: deckY, collide: false, ray: false, cast: false });
      for (let i = -3; i <= 3; i++) {
        this.addBox(cx + sx * (width / 2 - 0.2), cz + i * (len / 7), 0.34, 1.45, 0.34, 'metal', { y: deckY, collide: false, ray: false, cast: false });
      }
    }
    // Pillars
    for (const pz of [cz - len / 2 + 6, cz, cz + len / 2 - 6]) {
      for (const sx of [-1, 1]) {
        this.addCylinder(cx + sx * 3.2, pz, 1.05, 6.2, 'concreteDark', { y: -1.2, collide: false, ray: true, segments: 8 });
      }
    }
    this.platforms.push({
      minX: cx - width / 2, maxX: cx + width / 2,
      minZ: cz - len / 2, maxZ: cz + len / 2, y: deckY
    });
    // Road surface on the bridge
    this.addBox(cx, cz, width - 1.8, 0.06, len - 2, new THREE.MeshStandardMaterial({ color: 0x8a806b, roughness: 1 }), {
      y: deckY + 0.06, collide: false, ray: false, cast: false
    });
    this.addSign(cx + 17, cz, 'OLD BRIDGE', 'RIVER CROSSING', '#9dd8e8', 10, 14);
  }

  buildFactory() {
    const cx = -260, cz = -230;
    const base = heightAt(cx, cz);
    // Main open warehouse
    const W = 58, D = 34, H = 13;
    this.addBox(cx, cz, W, 0.6, D, 'concreteDark', { y: base - 0.2, collide: false });
    this.addBox(cx, cz - D / 2, W, H, 1.2, 'concrete', { y: base });
    this.addBox(cx - W / 2, cz, 1.2, H, D, 'concrete', { y: base });
    this.addBox(cx + W / 2, cz, 1.2, H, D, 'concrete', { y: base });
    // front wall with a big doorway
    this.addBox(cx - 20, cz + D / 2, 18, H, 1.2, 'concrete', { y: base });
    this.addBox(cx + 20, cz + D / 2, 18, H, 1.2, 'concrete', { y: base });
    this.addBox(cx, cz + D / 2, 22, 3.2, 1.2, 'concrete', { y: base + H - 3.2 });
    this.addGableRoof(cx, cz, W, D, 5.5, 'metalDark', base + H);
    // Skylight strips
    for (let i = -2; i <= 2; i++) {
      this.addBox(cx + i * 9, cz, 3.5, 0.18, D - 7, 'glass', { y: base + H + 3.4, collide: false, ray: false, cast: false });
    }
    // Interior machines and crates
    const crates = [
      [-280, -232, 3.2, 2.4, 3.2, 'green'], [-272, -238, 2.6, 2.0, 2.6, 'yellow'],
      [-240, -228, 3.4, 2.8, 3.4, 'rust'], [-233, -242, 2.5, 1.8, 2.5, 'blue'],
      [-255, -212, 4.0, 2.2, 2.4, 'metal'], [-268, -220, 2.8, 1.6, 2.8, 'red'],
      [-246, -246, 3.0, 2.6, 3.0, 'green'], [-224, -214, 3.2, 2.0, 3.2, 'yellow']
    ];
    for (const [x, z, w, h, d, m] of crates) this.addBox(x, z, w, h, d, m, { y: base + 0.4, rot: this.rng() * 0.5 });
    // Machine block
    this.addBox(cx - 18, cz - 6, 8, 3.4, 5, 'metalDark', { y: base + 0.4 });
    this.addBox(cx + 15, cz - 8, 7, 2.6, 4, 'rust', { y: base + 0.4 });
    // Smokestacks
    for (const [sx, sz, h] of [[-39, 19, 30], [-30, 21, 24]]) {
      this.addCylinder(cx + sx, cz + sz, 2.4, h, 'concreteDark', { y: base, segments: 10 });
      for (let i = 0; i < 4; i++) {
        this.addCylinder(cx + sx, cz + sz, 2.55, 1.3, i % 2 ? 'red' : 'concrete', { y: base + 4 + i * 5.2, segments: 10, collide: false, ray: false, cast: false });
      }
      this.addCylinder(cx + sx, cz + sz, 2.7, 1.2, 'metalDark', { y: base + h - 1.2, segments: 10, collide: false, ray: false });
    }
    // Silos
    for (const [sx, sz] of [[38, -18], [45, -10], [36, -7]]) {
      this.addCylinder(cx + sx, cz + sz, 4.2, 17, 'metal', { y: base, segments: 14 });
      const cap = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2.4, 14), this.materials.metalDark);
      cap.position.set(cx + sx, base + 18.2, cz + sz);
      cap.castShadow = this.quality === 'high';
      this.group.add(cap);
      this.raycastTargets.push(cap);
    }
    // Containers
    const conts = [
      [-32, 8, 0], [-24, 8, 0.2], [22, 12, 0], [29, 13, -0.1], [-6, -17, 0.1], [4, -18, 0]
    ];
    const contMats = ['red', 'blue', 'yellow', 'green', 'rust', 'blue'];
    conts.forEach(([sx, sz, rot], i) => {
      this.addBox(cx + sx, cz + sz, 11, 2.9, 3.0, contMats[i], { y: base + 0.4, rot });
    });
    // Perimeter fence / barriers
    for (const sx of [-70, 70]) this.addFence(cx + sx, cz - 40, cx + sx, cz + 40);
    // Water tower
    this.addCylinder(cx + 55, cz - 32, 1.0, 9, 'metalDark', { y: base, collide: false, segments: 6 });
    this.addCylinder(cx + 55, cz - 32, 4.5, 5, 'metal', { y: base + 9, segments: 12 });
    this.addSign(cx, cz, 'FACTORY', 'INDUSTRIAL COMPLEX', '#f0a84d', 24, 30);
  }

  buildClockTower() {
    const cx = 10, cz = 5;
    const base = heightAt(cx, cz);
    // Plaza
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(34, 34.6, 0.5, 40), this.materials.concrete);
    plaza.position.set(cx, base - 0.05, cz);
    plaza.receiveShadow = true;
    this.group.add(plaza);
    this.raycastTargets.push(plaza);
    // Tower
    this.addBox(cx, cz, 18, 8, 18, 'concreteDark', { y: base });
    this.addBox(cx, cz, 10.5, 24, 10.5, 'concrete', { y: base + 8 });
    this.addBox(cx, cz, 12, 8, 12, 'concreteDark', { y: base + 32 });
    // Clock faces
    this.clockTexture = makeClockTexture();
    const clockMat = new THREE.MeshBasicMaterial({ map: this.clockTexture, transparent: true });
    const faceY = base + 36;
    const faces = [
      [0, 6.08, 0], [0, -6.08, Math.PI], [6.08, 0, Math.PI / 2], [-6.08, 0, -Math.PI / 2]
    ];
    for (const [dx, dz, ry] of faces) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), clockMat);
      face.position.set(cx + dx, faceY, cz + dz);
      face.rotation.y = ry;
      this.group.add(face);
    }
    // Spire
    const spire = new THREE.Mesh(new THREE.ConeGeometry(8.2, 9, 4), this.materials.roofRed);
    spire.position.set(cx, base + 44.5, cz);
    spire.rotation.y = Math.PI / 4;
    spire.castShadow = this.quality === 'high';
    this.group.add(spire);
    this.raycastTargets.push(spire);
    this.addCylinder(cx, cz, 0.22, 5, 'metalDark', { y: base + 49, collide: false, segments: 6, cast: false });
    // Fountain
    this.addCylinder(cx - 19, cz + 9, 4.5, 0.9, 'concreteDark', { y: base, segments: 20 });
    const water = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.18, 20), new THREE.MeshStandardMaterial({
      color: 0x47b7d9, roughness: 0.15, transparent: true, opacity: 0.8
    }));
    water.position.set(cx - 19, base + 0.95, cz + 9);
    this.group.add(water);
    this.addCylinder(cx - 19, cz + 9, 0.7, 3.2, 'concrete', { y: base + 0.9, segments: 10, collide: false });
    // Surrounding town buildings
    this.addHouse(cx - 32, cz - 22, 12, 9, 'concrete', 'roofRed', 0.2, 4.6);
    this.addHouse(cx + 29, cz - 20, 11, 8, 'concrete', 'roofBlue', -0.15, 4.0);
    this.addHouse(cx + 30, cz + 22, 10, 9, 'rust', 'roof', 0.1, 4.4);
    this.addHouse(cx - 31, cz + 24, 13, 8, 'concreteDark', 'roofRed', -0.2, 4.2);
    // Market stalls
    for (const [sx, sz, rot] of [[-8, 18, 0.2], [4, 19, -0.2], [17, 17, 0.1]]) {
      this.addBox(cx + sx, cz + sz, 4.5, 0.35, 2.4, 'wood', { y: base + 2.2, collide: false, rot });
      for (const ox of [-1.8, 1.8]) {
        this.addCylinder(cx + sx + Math.cos(rot) * ox, cz + sz - Math.sin(rot) * ox, 0.09, 2.2, 'woodDark', { y: base, collide: false, segments: 5, cast: false });
      }
      this.addBox(cx + sx, cz + sz, 4.8, 0.15, 2.7, 'red', { y: base + 2.55, collide: false, rot, cast: false });
    }
    // Benches and lamps
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.4;
      const lx = cx + Math.cos(a) * 24, lz = cz + Math.sin(a) * 24;
      this.addLamp(lx, lz);
    }
    for (const [sx, sz, rot] of [[-12, 14, 0], [14, 13, 1.57], [-13, -13, 0], [13, -14, 1.57]]) {
      this.addBox(cx + sx, cz + sz, 4, 0.6, 1.2, 'wood', { y: base + 0.5, rot, collide: false });
      this.addBox(cx + sx, cz + sz, 4, 0.9, 0.16, 'woodDark', { y: base + 1.1, rot, collide: false, cast: false });
    }
    this.addSign(cx, cz, 'CLOCK TOWER', 'OLD TOWN SQUARE', '#ffd45c', 56, 34);
  }

  buildVillage() {
    const cx = 280, cz = -150;
    const houses = [
      [-46, -26, 11, 8, 0.25, 'concrete', 'roofRed'],
      [-23, -39, 9, 8, -0.1, 'rust', 'roofBlue'],
      [8, -38, 12, 9, 0.05, 'concreteDark', 'roof'],
      [38, -24, 10, 8, -0.22, 'concrete', 'roofRed'],
      [44, 8, 9, 9, 0.15, 'rust', 'roofBlue'],
      [20, 34, 12, 8, 0.02, 'concrete', 'roofRed'],
      [-10, 38, 10, 9, -0.18, 'concreteDark', 'roof'],
      [-38, 24, 11, 8, 0.22, 'concrete', 'roofBlue'],
      [-2, 4, 13, 10, 0.08, 'rust', 'roofRed']
    ];
    for (const [dx, dz, w, d, rot, wall, roof] of houses) {
      this.addHouse(cx + dx, cz + dz, w, d, wall, roof, rot, 3.6 + this.rng() * 1.0);
    }
    // Fences
    this.addFence(cx - 58, cz - 50, cx - 58, cz + 50);
    this.addFence(cx + 58, cz - 50, cx + 58, cz + 48);
    this.addFence(cx - 58, cz + 50, cx - 8, cz + 50);
    // Well
    const wellX = cx + 4, wellZ = cz + 12;
    const wb = heightAt(wellX, wellZ);
    this.addCylinder(wellX, wellZ, 2.0, 1.2, 'concreteDark', { y: wb, segments: 14 });
    const wellWater = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.1, 14), new THREE.MeshStandardMaterial({ color: 0x2e7890, roughness: .1 }));
    wellWater.position.set(wellX, wb + 1.18, wellZ);
    this.group.add(wellWater);
    this.addCylinder(wellX - 1.6, wellZ, 0.12, 3.2, 'woodDark', { y: wb, collide: false, segments: 5, cast: false });
    this.addCylinder(wellX + 1.6, wellZ, 0.12, 3.2, 'woodDark', { y: wb, collide: false, segments: 5, cast: false });
    this.addBox(wellX, wellZ, 4.2, 0.16, 0.16, 'wood', { y: wb + 3.1, collide: false, cast: false });
    // Hay bales
    for (let i = 0; i < 6; i++) {
      const hx = cx - 48 + this.rng() * 14, hz = cz + 22 + this.rng() * 14;
      this.addCylinder(hx, hz, 1.2, 1.5, 'yellow', { y: heightAt(hx, hz), segments: 10, collide: false });
    }
    // Market
    this.addBox(cx - 20, cz + 18, 5, 0.35, 2.6, 'wood', { y: heightAt(cx - 20, cz + 18) + 2.2, collide: false });
    this.addBox(cx - 20, cz + 18, 5.4, 0.18, 3.0, 'red', { y: heightAt(cx - 20, cz + 18) + 2.55, collide: false, cast: false });
    // Watch tower
    const twX = cx + 52, twZ = cz + 42;
    const twB = heightAt(twX, twZ);
    for (const ox of [-2, 2]) for (const oz of [-2, 2]) {
      this.addBox(twX + ox, twZ + oz, 0.3, 7, 0.3, 'woodDark', { y: twB, collide: false, cast: false });
    }
    this.addBox(twX, twZ, 6.4, 0.4, 6.4, 'wood', { y: twB + 7, collide: false });
    this.addBox(twX, twZ, 6.8, 0.2, 6.8, 'roofRed', { y: twB + 10.2, collide: false, cast: false });
    for (const ox of [-2.6, 2.6]) for (const oz of [-2.6, 2.6]) {
      this.addBox(twX + ox, twZ + oz, 0.2, 2.4, 0.2, 'woodDark', { y: twB + 7.4, collide: false, cast: false });
    }
    this.addSign(cx, cz, 'RIM RAM VILLAGE', 'HOMES • MARKET • COVER', '#a7dd73', 19, 30);
  }

  buildPeak() {
    const cx = -200, cz = 170;
    const base = heightAt(cx, cz);
    // Radio tower
    for (const ox of [-2.4, 2.4]) for (const oz of [-2.4, 2.4]) {
      this.addBox(cx + ox, cz + oz, 0.34, 27, 0.34, 'metal', { y: base, collide: false, cast: false });
    }
    for (let i = 1; i <= 6; i++) {
      const y = base + i * 4.1;
      const s = 4.8 - i * 0.55;
      this.addBox(cx, cz - s, s * 2, 0.16, 0.16, 'metalDark', { y, collide: false, cast: false });
      this.addBox(cx, cz + s, s * 2, 0.16, 0.16, 'metalDark', { y, collide: false, cast: false });
      this.addBox(cx - s, cz, 0.16, 0.16, s * 2, 'metalDark', { y, collide: false, cast: false });
      this.addBox(cx + s, cz, 0.16, 0.16, s * 2, 'metalDark', { y, collide: false, cast: false });
    }
    this.addCylinder(cx, cz, 0.2, 9, 'metalDark', { y: base + 27, collide: false, segments: 6, cast: false });
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
    this.beacon.position.set(cx, base + 36.4, cz);
    this.group.add(this.beacon);
    // Bunker
    const bx = cx - 22, bz = cz + 17;
    const bb = heightAt(bx, bz);
    this.addBox(bx, bz, 15, 4.2, 11, 'concreteDark', { y: bb - 0.7 });
    this.addBox(bx, bz, 15.6, 0.5, 11.6, 'concrete', { y: bb + 3.5, collide: false });
    this.addBox(bx, bz + 5.55, 4, 2.8, 0.4, 'metalDark', { y: bb - 0.6, collide: false, cast: false });
    // Observation platform
    const ox2 = cx + 18, oz2 = cz - 8;
    const ob = heightAt(ox2, oz2);
    this.addBox(ox2, oz2, 12, 0.5, 8, 'wood', { y: ob + 0.2, collide: false });
    for (const sx of [-6, 6]) {
      for (const sz of [-4, 4]) {
        this.addBox(ox2 + sx, oz2 + sz, 0.18, 1.4, 0.18, 'metalDark', { y: ob + 0.7, collide: false, cast: false });
      }
      this.addBox(ox2 + sx, oz2, 0.16, 0.16, 8, 'metalDark', { y: ob + 2.0, collide: false, cast: false });
    }
    // Rocks around the summit
    for (let i = 0; i < 14; i++) {
      const a = this.rng() * Math.PI * 2, r = 12 + this.rng() * 32;
      const rx = cx + Math.cos(a) * r, rz = cz + Math.sin(a) * r;
      const s = 1.4 + this.rng() * 3.4;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this.materials.rock);
      rock.position.set(rx, heightAt(rx, rz) + s * 0.55, rz);
      rock.rotation.set(this.rng(), this.rng() * 3, this.rng());
      rock.castShadow = this.quality === 'high';
      this.group.add(rock);
      this.raycastTargets.push(rock);
      this.colliders.push({ minX: rx - s * 0.7, maxX: rx + s * 0.7, minY: heightAt(rx, rz), maxY: heightAt(rx, rz) + s * 1.2, minZ: rz - s * 0.7, maxZ: rz + s * 0.7 });
    }
    this.addSign(cx, cz, 'PEAK', 'RADIO RIDGE • HIGH GROUND', '#d7e2ea', 46, 30);
  }

  buildRiverside() {
    const cx = 100, cz = 285;
    const base = heightAt(cx, cz);
    // Two fishing huts
    this.addHouse(cx - 26, cz - 14, 9, 7, 'wood', 'roofRed', 0.1, 3.2);
    this.addHouse(cx + 24, cz - 5, 8, 7, 'concreteDark', 'roofBlue', -0.1, 3.0);
    // Docks reaching toward the river
    const dockY = 1.1;
    for (const [dx, dz, len] of [[-18, 32, 40], [14, 38, 34]]) {
      const wx = cx + dx, wz = cz + dz;
      this.addBox(wx, wz, 4.2, 0.35, len, 'wood', { y: dockY, collide: false });
      this.addBox(wx, wz, 4.4, 0.12, len, 'woodDark', { y: dockY + 0.32, collide: false, ray: false, cast: false });
      for (let i = -2; i <= 2; i++) {
        this.addCylinder(wx - 2, wz + i * (len / 5), 0.22, 4.2, 'woodDark', { y: -2.2, collide: false, segments: 6, cast: false });
        this.addCylinder(wx + 2, wz + i * (len / 5), 0.22, 4.2, 'woodDark', { y: -2.2, collide: false, segments: 6, cast: false });
      }
      this.platforms.push({ minX: wx - 2.1, maxX: wx + 2.1, minZ: wz - len / 2, maxZ: wz + len / 2, y: dockY + 0.35 });
    }
    // Boats
    for (const [bx, bz, rot] of [[cx - 28, cz + 77, 0.2], [cx + 30, cz + 80, -0.4], [cx - 62, cz + 91, 0.9]]) {
      const b = this.addBox(bx, bz, 3.2, 1.2, 7.5, 'wood', { y: 0.6, rot, collide: false });
      this.addBox(bx, bz, 2.2, 0.9, 2.4, 'woodDark', { y: 1.4, rot, collide: false, cast: false });
      const mast = this.addCylinder(bx, bz, 0.08, 4, 'woodDark', { y: 1.8, collide: false, segments: 5, cast: false });
      mast.rotation.z = 0.04;
    }
    // Small pier props
    for (let i = 0; i < 5; i++) {
      const px = cx - 12 + this.rng() * 30, pz = cz + 28 + this.rng() * 18;
      this.addBox(px, pz, 1.1, 1.0, 1.1, this.rng() > 0.5 ? 'rust' : 'wood', { y: dockY + 0.35, rot: this.rng(), collide: false, cast: false });
    }
    // Water tower / shack
    this.addCylinder(cx + 35, cz - 22, 0.15, 6, 'metalDark', { y: base, collide: false, segments: 5, cast: false });
    this.addCylinder(cx + 35, cz - 22, 2.6, 3.4, 'metal', { y: base + 6, segments: 12, collide: false });
    this.addSign(cx, cz, 'RIVERSIDE', 'DOCKS • BRIDGE • BOATS', '#63daf3', 14, 26);
  }

  buildNature() {
    const rng = this.rng;
    const treeCount = this.quality === 'high' ? 380 : 220;
    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.46, 3.2, 5);
    const leafGeo = new THREE.IcosahedronGeometry(1.7, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);
    trunks.castShadow = this.quality === 'high';
    leaves.castShadow = this.quality === 'high';
    trunks.receiveShadow = true; leaves.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0, attempts = 0;
    while (placed < treeCount && attempts < treeCount * 20) {
      attempts++;
      const x = (rng() - 0.5) * (MAP_SIZE - 30);
      const z = (rng() - 0.5) * (MAP_SIZE - 30);
      const h = heightAt(x, z);
      if (h < 1.4 || h > 46) continue;
      if (this.nearPOI(x, z, 16)) continue;
      if (this.nearRiver(x, z, 9)) continue;
      const s = 0.7 + rng() * 0.85;
      dummy.position.set(x, h + 1.55 * s, z);
      dummy.scale.set(s, s, s);
      dummy.rotation.y = rng() * Math.PI;
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      dummy.position.set(x, h + (3.7 + rng() * 0.5) * s, z);
      dummy.scale.set(s * (0.8 + rng() * 0.35), s * (0.9 + rng() * 0.5), s * (0.8 + rng() * 0.35));
      dummy.rotation.set(rng() * 0.2, rng() * Math.PI, rng() * 0.2);
      dummy.updateMatrix();
      leaves.setMatrixAt(placed, dummy.matrix);
      color.setHSL(0.27 + rng() * 0.06, 0.34 + rng() * 0.18, 0.23 + rng() * 0.1);
      leaves.setColorAt(placed, color);
      placed++;
    }
    trunks.count = placed; leaves.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.group.add(trunks, leaves);
    this.raycastTargets.push(trunks, leaves);

    // Rocks
    const rockCount = this.quality === 'high' ? 150 : 80;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, this.materials.rock, rockCount);
    rocks.castShadow = this.quality === 'high';
    rocks.receiveShadow = true;
    let rp = 0, ra = 0;
    while (rp < rockCount && ra < rockCount * 20) {
      ra++;
      const x = (rng() - 0.5) * (MAP_SIZE - 40);
      const z = (rng() - 0.5) * (MAP_SIZE - 40);
      const h = heightAt(x, z);
      if (h < 0.9 || this.nearPOI(x, z, 8)) continue;
      const s = 0.5 + rng() * 1.7;
      dummy.position.set(x, h + s * 0.42, z);
      dummy.scale.set(s * (0.7 + rng() * 0.7), s * (0.6 + rng() * 0.5), s * (0.7 + rng() * 0.7));
      dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      dummy.updateMatrix();
      rocks.setMatrixAt(rp, dummy.matrix);
      rp++;
    }
    rocks.count = rp;
    rocks.instanceMatrix.needsUpdate = true;
    this.group.add(rocks);
    this.raycastTargets.push(rocks);

    // Grass tufts
    const grassCount = this.quality === 'high' ? 1600 : 700;
    const grassGeo = new THREE.ConeGeometry(0.18, 0.65, 3);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x638a42, roughness: 1, flatShading: true });
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
    let gp = 0, ga = 0;
    while (gp < grassCount && ga < grassCount * 10) {
      ga++;
      const x = (rng() - 0.5) * (MAP_SIZE - 20);
      const z = (rng() - 0.5) * (MAP_SIZE - 20);
      const h = heightAt(x, z);
      if (h < 1.3 || h > 34) continue;
      if (this.nearPOI(x, z, 5)) continue;
      dummy.position.set(x, h + 0.3, z);
      const s = 0.6 + rng() * 1.2;
      dummy.scale.set(s, s, s);
      dummy.rotation.y = rng() * Math.PI;
      dummy.updateMatrix();
      grass.setMatrixAt(gp, dummy.matrix);
      gp++;
    }
    grass.count = gp;
    grass.instanceMatrix.needsUpdate = true;
    this.group.add(grass);
  }

  nearPOI(x, z, pad = 0) {
    for (const p of POIS) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < (p.radius + pad) * (p.radius + pad)) return true;
    }
    return false;
  }

  nearRiver(x, z, pad = 0) {
    return Math.abs(z - riverZ(x)) < 30 + pad;
  }

  buildSpawns() {
    const rng = mulberry32(424242);
    const open = (x, z) => {
      if (heightAt(x, z) < 1.2) return false;
      if (Math.abs(x) > HALF - 18 || Math.abs(z) > HALF - 18) return false;
      for (const c of this.colliders) {
        if (x > c.minX - 1.2 && x < c.maxX + 1.2 && z > c.minZ - 1.2 && z < c.maxZ + 1.2) return false;
      }
      return true;
    };

    // Loot is clustered around every named location plus a few field drops.
    for (const p of POIS) {
      for (let i = 0; i < 12; i++) {
        for (let a = 0; a < 30; a++) {
          const ang = rng() * Math.PI * 2;
          const rad = 6 + rng() * (p.radius * 0.85);
          const x = p.x + Math.cos(ang) * rad;
          const z = p.z + Math.sin(ang) * rad;
          if (open(x, z)) {
            this.lootSpawns.push({ x, z, poi: p.id });
            break;
          }
        }
      }
    }
    for (let i = 0; i < 14; i++) {
      for (let a = 0; a < 40; a++) {
        const x = (rng() - 0.5) * (MAP_SIZE - 120);
        const z = (rng() - 0.5) * (MAP_SIZE - 120);
        if (open(x, z) && !this.nearRiver(x, z, 5)) {
          this.lootSpawns.push({ x, z, poi: 'field' });
          break;
        }
      }
    }

    // Bot spawns: 4 near each POI, 4 roaming.
    for (const p of POIS) {
      for (let i = 0; i < 5; i++) {
        for (let a = 0; a < 30; a++) {
          const ang = rng() * Math.PI * 2;
          const rad = 18 + rng() * (p.radius * 0.8);
          const x = p.x + Math.cos(ang) * rad;
          const z = p.z + Math.sin(ang) * rad;
          if (open(x, z)) {
            this.botSpawns.push({ x, z, poi: p.id });
            break;
          }
        }
      }
    }
    for (let i = 0; i < 8; i++) {
      for (let a = 0; a < 50; a++) {
        const x = (rng() - 0.5) * (MAP_SIZE - 140);
        const z = (rng() - 0.5) * (MAP_SIZE - 140);
        if (open(x, z) && heightAt(x, z) > 2) {
          this.botSpawns.push({ x, z, poi: 'field' });
          break;
        }
      }
    }
    // Shuffle spawns deterministically.
    for (let i = this.botSpawns.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.botSpawns[i], this.botSpawns[j]] = [this.botSpawns[j], this.botSpawns[i]];
    }
  }

  buildMinimap() {
    const size = 300;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = (px / (size - 1) - 0.5) * MAP_SIZE;
        const z = (py / (size - 1) - 0.5) * MAP_SIZE;
        const h = heightAt(x, z);
        let r, g, b;
        if (h < WATER_LEVEL) {
          const d = clamp((WATER_LEVEL - h) / 3, 0, 1);
          r = 35 - d * 10; g = 82 - d * 22; b = 103 - d * 18;
        } else if (h < 2.4) {
          r = 143; g = 129; b = 88;
        } else if (h > 47) {
          const t = clamp((h - 47) / 25, 0, 1);
          r = lerp(112, 220, t); g = lerp(118, 228, t); b = lerp(118, 232, t);
        } else {
          const n = valueNoise(x * 0.05, z * 0.05);
          const t = clamp((h - 2) / 45, 0, 1);
          r = lerp(55, 98, t) + n * 14;
          g = lerp(91, 112, t) + n * 16;
          b = lerp(48, 72, t) + n * 8;
        }
        const i = (py * size + px) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Roads
    const routes = [
      [[-260, -230], [-150, -140], [-45, -60], [10, 5]],
      [[10, 5], [130, -55], [215, -110], [280, -150]],
      [[10, 5], [45, 125], [72, 210], [100, 285]],
      [[280, -150], [230, 30], [160, 190], [100, 285]],
      [[-260, -230], [-265, -70], [-238, 90], [-200, 170]],
      [[100, 285], [100, 333]],
      [[100, 409], [100, 500]]
    ];
    const toPx = (v) => (v / MAP_SIZE + 0.5) * size;
    ctx.strokeStyle = 'rgba(211,196,155,.5)';
    ctx.lineWidth = 2;
    for (const route of routes) {
      ctx.beginPath();
      route.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(toPx(x), toPx(z)); else ctx.lineTo(toPx(x), toPx(z));
      });
      ctx.stroke();
    }
    // Bridge
    ctx.strokeStyle = 'rgba(240,235,220,.85)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(toPx(100), toPx(333)); ctx.lineTo(toPx(100), toPx(409)); ctx.stroke();
    this.minimapCanvas = c;
  }

  groundHeight(x, z, currentY = Infinity) {
    let h = heightAt(x, z);
    for (const p of this.platforms) {
      if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ && p.y <= currentY + 1.4) {
        h = Math.max(h, p.y);
      }
    }
    return h;
  }

  resolveCollision(pos, radius = 0.55) {
    for (const c of this.colliders) {
      if (pos.y >= c.maxY - 0.42) continue;
      if (pos.y + 1.7 <= c.minY) continue;
      const nx = clamp(pos.x, c.minX, c.maxX);
      const nz = clamp(pos.z, c.minZ, c.maxZ);
      let dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 0.000001) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (radius - d);
          pos.z += (dz / d) * (radius - d);
        } else {
          const left = pos.x - c.minX, right = c.maxX - pos.x;
          const back = pos.z - c.minZ, front = c.maxZ - pos.z;
          const m = Math.min(left, right, back, front);
          if (m === left) pos.x = c.minX - radius;
          else if (m === right) pos.x = c.maxX + radius;
          else if (m === back) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
    }
  }

  hasLineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.01) return true;
    for (const c of this.colliders) {
      // Slab test in 3D
      let tmin = 0, tmax = 1;
      const axes = [
        [ax, dx, c.minX, c.maxX],
        [ay, dy, c.minY, c.maxY],
        [az, dz, c.minZ, c.maxZ]
      ];
      let hit = true;
      for (const [o, d, mn, mx] of axes) {
        if (Math.abs(d) < 0.00001) {
          if (o < mn || o > mx) { hit = false; break; }
        } else {
          let t1 = (mn - o) / d, t2 = (mx - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) { hit = false; break; }
        }
      }
      if (hit && tmax > 0.02 && tmin < 0.98) return false;
    }
    return true;
  }

  randomOpenPosition(cx = 0, cz = 0, radius = 80, rng = Math.random) {
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const r = radius * Math.sqrt(rng());
      const x = clamp(cx + Math.cos(a) * r, -HALF + 20, HALF - 20);
      const z = clamp(cz + Math.sin(a) * r, -HALF + 20, HALF - 20);
      if (heightAt(x, z) < 1.4) continue;
      let blocked = false;
      for (const c of this.colliders) {
        if (x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1) { blocked = true; break; }
      }
      if (!blocked) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  update(dt, time) {
    this.time = time;
    if (this.water) this.water.position.y = WATER_LEVEL + Math.sin(time * 0.7) * 0.035;
    if (this.beacon) {
      const pulse = 0.55 + Math.sin(time * 4.2) * 0.45;
      this.beacon.material.color.setRGB(1, 0.22 * pulse, 0.16 * pulse);
      this.beacon.scale.setScalar(0.85 + pulse * 0.35);
    }
    if (this.clockTexture && time - this.clockLast > 1) {
      this.clockLast = time;
      const ctx = this.clockTexture.image.getContext('2d');
      const s = 256;
      // redraw hands over a fresh face
      const now = new Date();
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = '#e8e0c8';
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2b2b25'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const r1 = s * 0.39, r2 = i % 3 === 0 ? s * 0.32 : s * 0.35;
        ctx.lineWidth = i % 3 === 0 ? 7 : 3;
        ctx.beginPath();
        ctx.moveTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1);
        ctx.lineTo(s / 2 + Math.cos(a) * r2, s / 2 + Math.sin(a) * r2);
        ctx.stroke();
      }
      const hA = ((now.getHours() % 12) / 12 + now.getMinutes() / 720) * Math.PI * 2 - Math.PI / 2;
      const mA = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
      const sA = (now.getSeconds() / 60) * Math.PI * 2 - Math.PI / 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1b1b18'; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(hA) * s * 0.22, s / 2 + Math.sin(hA) * s * 0.22); ctx.stroke();
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(mA) * s * 0.31, s / 2 + Math.sin(mA) * s * 0.31); ctx.stroke();
      ctx.strokeStyle = '#a3321f'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(sA) * s * 0.35, s / 2 + Math.sin(sA) * s * 0.35); ctx.stroke();
      ctx.fillStyle = '#1b1b18';
      ctx.beginPath(); ctx.arc(s / 2, s / 2, 7, 0, Math.PI * 2); ctx.fill();
      this.clockTexture.needsUpdate = true;
    }
  }
}
