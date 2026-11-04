import * as THREE from '../vendor/three.module.js';

/* ============================================================
   ISLA VERDE — 1 km² open-world generation
   ============================================================ */

export const MAP = { size: 1000, half: 500, playable: 476, health: 200 };
export const WEAPON_NAMES = ['AK-47', 'UMP', 'AWM'];

export const LANDMARKS = [
  { id: 'factory', name: 'FACTORY', short: 'FAC', x: -262, z: -176, radius: 86, color: '#ff9a3c', spawn: { x: -320, z: -250 } },
  { id: 'peak', name: 'PEAK', short: 'PEAK', x: 42, z: -352, radius: 66, color: '#bcd7ff', spawn: { x: 10, z: -420 } },
  { id: 'clock', name: 'CLOCK TOWER', short: 'CLK', x: 230, z: -44, radius: 74, color: '#ffd166', spawn: { x: 285, z: -95 } },
  { id: 'rimram', name: 'RIM RAM VILLAGE', short: 'RRV', x: -252, z: 242, radius: 82, color: '#9bf08b', spawn: { x: -325, z: 300 } },
  { id: 'tivers', name: 'TIVERS', short: 'TIV', x: 286, z: 316, radius: 76, color: '#68ddff', spawn: { x: 350, z: 370 } },
];
export const LANDMARK_BY_ID = Object.fromEntries(LANDMARKS.map(l => [l.id, l]));

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261104);
const rr = (a, b) => a + (b - a) * rand();
const pick = arr => arr[Math.floor(rand() * arr.length)];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function dist2(x1, z1, x2, z2) {
  const dx = x1 - x2, dz = z1 - z2;
  return dx * dx + dz * dz;
}
export function dist(x1, z1, x2, z2) { return Math.sqrt(dist2(x1, z1, x2, z2)); }

function gauss(x, z, cx, cz, r) {
  return Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
}

export function riverCenterX(z) {
  return 124 + 68 * Math.sin(z * 0.0068) + 23 * Math.sin(z * 0.019 + 0.8);
}
export function riverWidth(z) {
  return 22 + 9 * Math.sin(z * 0.011 + 1.7);
}

/** Height of the terrain at a world coordinate. */
export function heightAt(x, z) {
  let h = 6.2
    + 3.1 * Math.sin(x * 0.0062 + 0.4)
    + 2.4 * Math.cos(z * 0.0079 - 0.7)
    + 1.7 * Math.sin((x - z) * 0.014)
    + 0.7 * Math.sin(x * 0.041) * Math.cos(z * 0.037);

  // The mountain at the north of the island
  h += 48 * gauss(x, z, 42, -352, 178);
  h += 8 * gauss(x, z, -252, 242, 120);
  h += 4 * gauss(x, z, 286, 316, 90);

  // Flattened settlements
  const flats = [
    [-262, -176, 84, 7.4],
    [230, -44, 64, 8.6],
    [-252, 242, 78, 12.8],
    [286, 316, 66, 4.2],
    [14, 424, 44, 6.6],
    [42, -352, 19, 51.5],
  ];
  for (const [cx, cz, r, target] of flats) {
    const d = dist(x, z, cx, cz);
    h = lerp(h, target, 1 - smoothstep(r * 0.38, r, d));
  }

  // River valley carved down toward the water
  const rx = riverCenterX(z);
  const rw = riverWidth(z);
  const rd = Math.abs(x - rx) / (rw + 14);
  if (rd < 1) h -= 13 * (1 - rd * rd) ** 2;

  return h;
}

const colliders = [];
const platforms = [];
const lootAnchors = [];

export function groundHeightAt(x, z) {
  let h = heightAt(x, z);
  for (const p of platforms) {
    if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
    const py = typeof p.y === 'function' ? p.y(x, z) : p.y;
    if (py > h && py < h + 9) h = py;
  }
  return h;
}

export function resolveWorldCollision(pos, radius) {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      const nx = clamp(pos.x, c.minX, c.maxX);
      const nz = clamp(pos.z, c.minZ, c.maxZ);
      let dx = pos.x - nx, dz = pos.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 0.000001) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
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
  pos.x = clamp(pos.x, -MAP.playable, MAP.playable);
  pos.z = clamp(pos.z, -MAP.playable, MAP.playable);
}

export function pointBlocked(x, z, r = 0.4) {
  for (const c of colliders) {
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
  }
  return false;
}

export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  // Terrain occlusion
  const steps = 18;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = lerp(ax, bx, t), z = lerp(az, bz, t);
    const y = lerp(ay, by, t);
    if (heightAt(x, z) > y + 1.1) return false;
    if (pointBlocked(x, z, 0.1)) {
      // Only block if the wall is tall enough to matter
      const c = colliders.find(c => x > c.minX - .1 && x < c.maxX + .1 && z > c.minZ - .1 && z < c.maxZ + .1);
      if (c && c.maxY > Math.min(ay, by) + 0.4) return false;
    }
  }
  return true;
}

export function pushLootAnchor(x, z, tag = 'wild') {
  lootAnchors.push({ x, z, tag });
}

export function getLootAnchors() { return lootAnchors; }
export function getColliders() { return colliders; }
export function getPlatforms() { return platforms; }

/* ============================================================
   Material / mesh helpers
   ============================================================ */
const materials = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (materials.has(key)) return materials.get(key);
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0.03,
    flatShading: opts.flat ?? false,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  materials.set(key, m);
  return m;
}

function box(parent, x, y, z, w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || mat(color, opts));
  m.position.set(x, y, z);
  if (opts.rotY) m.rotation.y = opts.rotY;
  if (opts.rotZ) m.rotation.z = opts.rotZ;
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  parent.add(m);
  return m;
}

function cylinder(parent, x, y, z, rt, rb, h, color, seg = 10, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), opts.material || mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function addCollider(cx, cz, w, d, baseY, height, label = '') {
  colliders.push({
    minX: cx - w / 2, maxX: cx + w / 2,
    minZ: cz - d / 2, maxZ: cz + d / 2,
    minY: baseY, maxY: baseY + height, label,
  });
}

function localToWorld(x, z, lx, lz, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: x + lx * c - lz * s, z: z + lx * s + lz * c };
}

function addLocalCollider(x, z, rot, lx, lz, w, d, baseY, h, label) {
  const p = localToWorld(x, z, lx, lz, rot);
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  const sw = w * c + d * s, sd = w * s + d * c;
  addCollider(p.x, p.z, sw, sd, baseY, h, label);
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function textTexture(text, { fg = '#f5f0e3', bg = '#171d17', accent = '#ff7a1f', font = 700, size = 74 } = {}) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, 14, h);
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(14, h - 8, w - 14, 8);
    ctx.font = `${font} ${size}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    ctx.fillText(text, w / 2 + 7, h / 2 + 4);
  });
}

function addSign(parent, text, x, y, z, rotY = 0, width = 8, height = 2, opts = {}) {
  const tex = textTexture(text, opts);
  const geo = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.FrontSide });
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;

  const front = new THREE.Mesh(geo, material);
  front.position.z = 0.012;
  g.add(front);

  // Back face reads correctly too, instead of showing mirrored text.
  const back = new THREE.Mesh(geo, material);
  back.position.z = -0.012;
  back.rotation.y = Math.PI;
  g.add(back);

  parent.add(g);
  return g;
}

/* ============================================================
   World builder
   ============================================================ */
export function createWorld(scene) {
  const world = new THREE.Group();
  world.name = 'IslaVerde';
  scene.add(world);

  const animated = { chimneys: [], flags: [], boats: [], clockHands: [], clouds: [] };

  /* ---------- Sky ---------- */
  const skyGeo = new THREE.SphereGeometry(1350, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3f87c8) },
      mid: { value: new THREE.Color(0x9dd0e3) },
      bottom: { value: new THREE.Color(0xf7d6a0) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
      void main(){ float h = normalize(vP).y; vec3 c = h > 0.06 ? mix(mid, top, smoothstep(0.06, 0.85, h)) : mix(bottom, mid, smoothstep(-0.12, 0.06, h));
      float glow = pow(max(0.0, 1.0 - abs(h - 0.03) * 6.0), 5.0);
      c += vec3(1.0,0.68,0.32) * glow * 0.34;
      gl_FragColor = vec4(c,1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Sun
  const sunTex = canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,244,204,1)');
    g.addColorStop(.18, 'rgba(255,218,140,.95)');
    g.addColorStop(.5, 'rgba(255,182,85,.24)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sunSprite.scale.set(340, 340, 1);
  sunSprite.position.set(-620, 420, -820);
  scene.add(sunSprite);

  /* ---------- Distant mountains ---------- */
  const farMat = mat(0x78957f, { flat: true, roughness: 1 });
  const farMat2 = mat(0x8aa896, { flat: true, roughness: 1 });
  const far = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * .08;
    const r = rr(640, 850);
    const h = rr(60, 190);
    const rad = rr(90, 170);
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 6, 1), i % 2 ? farMat : farMat2);
    m.position.set(Math.cos(a) * r, h / 2 - 22, Math.sin(a) * r);
    m.rotation.y = rand() * Math.PI;
    m.scale.z = rr(.7, 1.3);
    far.add(m);
  }
  world.add(far);

  /* ---------- Terrain ---------- */
  const SEG = 190;
  const terrainGeo = new THREE.PlaneGeometry(MAP.size, MAP.size, SEG, SEG);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrass = new THREE.Color(0x5a9448);
  const cGrass2 = new THREE.Color(0x467f3f);
  const cDry = new THREE.Color(0x88a45c);
  const cSand = new THREE.Color(0xb8a678);
  const cRock = new THREE.Color(0x7f8878);
  const cSnow = new THREE.Color(0xe4e8e2);
  const cDeep = new THREE.Color(0x3c6c58);
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = (Math.sin(x * .11 + z * .07) + Math.sin(x * .037 - z * .061)) * .5;
    if (h < -1.5) col.copy(cDeep);
    else if (h < 1.5) col.copy(cSand);
    else if (h > 40) col.copy(cSnow).lerp(cRock, clamp((52 - h) / 18, 0, 1));
    else if (h > 27) col.copy(cRock);
    else {
      col.copy(cGrass).lerp(cGrass2, clamp(n * .5 + .5, 0, 1));
      col.lerp(cDry, clamp((Math.sin(x * .022 + 1) * Math.cos(z * .018) + .4) * .42, 0, .55));
    }
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, flatShading: true,
  }));
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  world.add(terrain);

  /* ---------- Water ---------- */
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.size, MAP.size, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2e8aa1, transparent: true, opacity: .8, roughness: .16, metalness: .25 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.15;
  water.receiveShadow = true;
  world.add(water);

  // A soft river highlight ribbon
  const riverPts = [];
  for (let z = -MAP.half; z <= MAP.half; z += 12) riverPts.push({ x: riverCenterX(z), z });
  const riverHi = new THREE.Group();
  for (let i = 0; i < riverPts.length - 1; i++) {
    const a = riverPts[i], b = riverPts[i + 1];
    const seg = new THREE.Mesh(
      new THREE.PlaneGeometry(riverWidth(a.z) * 1.45, Math.hypot(b.x - a.x, b.z - a.z) + 1),
      new THREE.MeshBasicMaterial({ color: 0x8fd9e2, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide })
    );
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = Math.atan2(b.x - a.x, b.z - a.z);
    seg.position.set((a.x + b.x) / 2, -1.05, (a.z + b.z) / 2);
    riverHi.add(seg);
  }
  world.add(riverHi);

  /* ---------- Roads ---------- */
  const roadPaths = [
    [{ x: 14, z: 452 }, { x: 12, z: 390 }, { x: 24, z: 312 }, { x: 18, z: 230 }, { x: 5, z: 140 }, { x: 0, z: 54 }, { x: 34, z: 12 }],
    [{ x: 34, z: 12 }, { x: 88, z: 2 }, { x: 148, z: -1 }, { x: 190, z: -14 }, { x: 230, z: -44 }],
    [{ x: 0, z: 54 }, { x: -64, z: 34 }, { x: -138, z: 0 }, { x: -205, z: -66 }, { x: -250, z: -132 }, { x: -262, z: -176 }],
    [{ x: 0, z: 54 }, { x: -78, z: 86 }, { x: -154, z: 130 }, { x: -216, z: 188 }, { x: -252, z: 242 }],
    [{ x: 34, z: 12 }, { x: 90, z: 72 }, { x: 150, z: 140 }, { x: 216, z: 224 }, { x: 264, z: 288 }, { x: 286, z: 316 }],
    [{ x: 34, z: 12 }, { x: 48, z: -58 }, { x: 48, z: -140 }, { x: 56, z: -234 }, { x: 44, z: -316 }, { x: 42, z: -352 }],
    [{ x: -138, z: 0 }, { x: -132, z: -84 }, { x: -178, z: -128 }, { x: -232, z: -150 }],
    [{ x: 216, z: 224 }, { x: 270, z: 188 }, { x: 330, z: 130 }, { x: 372, z: 56 }],
  ];
  const roadGeoList = [];
  const roadColors = new THREE.Color(0xb9a071);
  for (const path of roadPaths) {
    const curve = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'catmullrom', 0.18);
    const n = Math.max(40, Math.floor(curve.getLength() / 5));
    const samples = curve.getSpacedPoints(n);
    const verts = [], idx = [], uvs = [];
    let w = 9.5;
    for (let i = 0; i < samples.length; i++) {
      const p = samples[i];
      const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
      const tx = next.x - prev.x, tz = next.z - prev.z;
      const l = Math.hypot(tx, tz) || 1;
      const sx = -tz / l, sz = tx / l;
      const hw = w / 2;
      const y = heightAt(p.x, p.z) + .11;
      verts.push(p.x + sx * hw, y, p.z + sz * hw, p.x - sx * hw, y, p.z - sz * hw);
      uvs.push(0, i / 3, 1, i / 3);
    }
    for (let i = 0; i < samples.length - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    roadGeoList.push(g);
  }
  for (const g of roadGeoList) {
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: roadColors, roughness: 1, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true;
    world.add(m);
  }

  // Central plaza
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(27, 24), mat(0xb1a27d, { roughness: 1 }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(14, heightAt(14, 14) + .12, 14);
  plaza.receiveShadow = true;
  world.add(plaza);

  /* ---------- Bridge across the river ---------- */
  const bankA = heightAt(84, 0), bankB = heightAt(160, 0);
  const deckY = Math.max(bankA, bankB) + .55;
  const bridge = new THREE.Group();
  box(bridge, 122, deckY - .2, 0, 78, .45, 12.5, 0x8e7350, { roughness: 1 });
  box(bridge, 122, deckY - .02, 5.6, 78, 1.0, .22, 0x6e573c);
  box(bridge, 122, deckY - .02, -5.6, 78, 1.0, .22, 0x6e573c);
  for (let x = 86; x <= 160; x += 7.4) {
    box(bridge, x, deckY + .5, 5.6, .25, 1.2, .25, 0x6e573c);
    box(bridge, x, deckY + .5, -5.6, .25, 1.2, .25, 0x6e573c);
    box(bridge, x, deckY + 1.02, 5.6, .16, .16, 12.4, 0x6e573c, { cast: false });
    box(bridge, x, deckY + 1.02, -5.6, .16, .16, 12.4, 0x6e573c, { cast: false });
  }
  // stone piers
  cylinder(bridge, 100, (deckY - 8) / 2 + 1, 0, 2.3, 3.2, deckY + 5, 0x8b8573, 8);
  cylinder(bridge, 144, (deckY - 8) / 2 + 1, 0, 2.3, 3.2, deckY + 5, 0x8b8573, 8);
  world.add(bridge);
  platforms.push({ minX: 83, maxX: 161, minZ: -6.1, maxZ: 6.1, y: deckY + .03 });
  addCollider(122, 5.9, 78, .45, deckY, 1.4, 'bridge rail');
  addCollider(122, -5.9, 78, .45, deckY, 1.4, 'bridge rail');

  // Gentle approach ramps (walkable platforms)
  platforms.push({ minX: 72, maxX: 84, minZ: -4.3, maxZ: 4.3, y: (x) => lerp(heightAt(72, 0), deckY + .03, (x - 72) / 12) });
  platforms.push({ minX: 160, maxX: 173, minZ: -4.3, maxZ: 4.3, y: (x) => lerp(deckY + .03, heightAt(173, 0), (x - 160) / 13) });

  /* ---------- Shared builders ---------- */
  const lootNear = (x, z, tag) => pushLootAnchor(x, z, tag);

  function addCrate(x, z, yOff = 0, size = 1.4, color = 0x8a6a3c) {
    const y = (yOff || groundHeightAt(x, z)) + size / 2;
    box(world, x, y, z, size, size, size, color, { roughness: .95 });
    box(world, x, y + size / 2 + .03, z, size * .8, .06, size * .8, 0x5d4528, { cast: false });
    return y;
  }
  function addBarrel(x, z, color = 0x9a3f2f) {
    const y = groundHeightAt(x, z) + .75;
    cylinder(world, x, y, z, .55, .55, 1.5, color, 12);
    cylinder(world, x, y + .45, z, .57, .57, .18, 0x40362a, 12);
  }
  function addContainer(x, z, rot, color) {
    const y = groundHeightAt(x, z) + 1.4;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rot; world.add(g);
    box(g, 0, 0, 0, 12, 2.8, 3.2, color);
    for (let i = -5; i <= 5; i += 1.4) box(g, i, 0, 1.62, .12, 2.5, .06, 0x2a241d, { cast: false });
    addLocalCollider(x, z, rot, 0, 0, 12, 3.2, y - 1.4, 2.8, 'container');
  }
  function addFence(x1, z1, x2, z2, posts = 6, color = 0x6d583d) {
    for (let i = 0; i <= posts; i++) {
      const t = i / posts, x = lerp(x1, x2, t), z = lerp(z1, z2, t);
      const y = groundHeightAt(x, z);
      box(world, x, y + .65, z, .15, 1.3, .15, color, { cast: false });
      if (i < posts) {
        const nx = lerp(x1, x2, (i + .5) / posts), nz = lerp(z1, z2, (i + .5) / posts);
        box(world, nx, y + 1.05, nz, Math.hypot(x2 - x1, z2 - z1) / posts, .1, .1, color, { cast: false });
      }
    }
  }

  function addHouse(x, z, opts = {}) {
    const {
      w = 8.5, d = 7, h = 4.1, rot = 0, wall = 0xd6c7a9, roof = 0x8c3f31,
      accent = 0x3c4b3a, floors = 1, sign = null, platform = true, loot = true,
    } = opts;
    const base = heightAt(x, z);
    const g = new THREE.Group(); g.position.set(x, base, z); g.rotation.y = rot; world.add(g);
    const floorY = base + .16;
    box(g, 0, .08, 0, w + .5, .3, d + .5, 0x8c7d61, { cast: false });
    const t = .32;
    const doorW = 1.9;
    // front wall (+z) with doorway
    const sideW = (w - doorW) / 2;
    box(g, -(doorW / 2 + sideW / 2), h / 2, d / 2 - t / 2, sideW, h, t, wall);
    box(g, (doorW / 2 + sideW / 2), h / 2, d / 2 - t / 2, sideW, h, t, wall);
    box(g, 0, h - .45, d / 2 - t / 2, doorW, .9, t, wall);
    // back & sides
    box(g, 0, h / 2, -d / 2 + t / 2, w, h, t, wall);
    box(g, -w / 2 + t / 2, h / 2, 0, t, h, d, wall);
    box(g, w / 2 - t / 2, h / 2, 0, t, h, d, wall);
    // floor
    box(g, 0, .2, 0, w - .2, .16, d - .2, 0x9c8968, { cast: false });
    // roof (gable)
    const roofH = Math.max(1.6, w * .3);
    const slope = Math.atan2(roofH, w / 2);
    const slopeLen = Math.hypot(w / 2, roofH);
    box(g, -w / 4, h + roofH / 2, 0, slopeLen + .2, .18, d + .9, roof, { rotZ: slope });
    box(g, w / 4, h + roofH / 2, 0, slopeLen + .2, .18, d + .9, roof, { rotZ: -slope });
    // gable ends
    for (const zz of [d / 2 - .02, -d / 2 + .02]) {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, roofH); shape.lineTo(-w / 2, 0);
      const gm = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(wall));
      gm.position.set(0, h, zz);
      gm.castShadow = true;
      g.add(gm);
    }
    // windows
    const winMat = mat(0x1b2420, { emissive: 0xffb04a, emissiveIntensity: .35, roughness: .6 });
    const win = (wx, wy, wz, rot2 = 0) => {
      const m = box(g, wx, wy, wz, 1.0, 1.15, .12, 0, { material: winMat, cast: false });
      m.rotation.y = rot2;
      box(g, wx, wy, wz + .03, 1.12, .1, .08, accent, { cast: false });
    };
    win(-w * .3, h * .55, d / 2 + .02);
    win(w * .3, h * .55, d / 2 + .02);
    win(-w * .3, h * .55, -d / 2 - .02, 0);
    win(-w / 2 - .02, h * .55, 0, Math.PI / 2);
    win(w / 2 + .02, h * .55, 0, Math.PI / 2);
    // door frame + dark opening
    box(g, 0, 1.05, d / 2 + .03, doorW - .1, 2.1, .08, 0x241f18, { cast: false });
    box(g, 0, h - .45, d / 2 + .05, doorW + .25, .14, .1, accent, { cast: false });
    // colliders for walls
    const baseY = base - .2;
    addLocalCollider(x, z, rot, -(doorW / 2 + sideW / 2), d / 2 - t / 2, sideW, t, baseY, h + .2, 'wall');
    addLocalCollider(x, z, rot, (doorW / 2 + sideW / 2), d / 2 - t / 2, sideW, t, baseY, h + .2, 'wall');
    addLocalCollider(x, z, rot, 0, -d / 2 + t / 2, w, t, baseY, h + .2, 'wall');
    addLocalCollider(x, z, rot, -w / 2 + t / 2, 0, t, d, baseY, h + .2, 'wall');
    addLocalCollider(x, z, rot, w / 2 - t / 2, 0, t, d, baseY, h + .2, 'wall');
    if (platform) platforms.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y: floorY });
    // interior dressing
    if (rand() > .4) box(g, w * .24, .6, -d * .2, .8, .9, 1.6, 0x5f4a31);
    if (rand() > .55) addCrate(x + Math.cos(rot) * w * .3, z + Math.sin(rot) * w * .3, floorY + .2, 1.0, 0x7c5e38);
    if (sign) addSign(g, sign, 0, h + .9, d / 2 + .15, 0, Math.min(w * .8, 6), 1.4, { size: 64 });
    if (loot) lootNear(x + rr(-1.6, 1.6), z + rr(-1.2, 1.2), 'house');
    return { g, base, w, d, h };
  }

  function addWarehouse(x, z, w, d, h, rot, color, label) {
    const base = heightAt(x, z);
    const g = new THREE.Group(); g.position.set(x, base, z); g.rotation.y = rot; world.add(g);
    box(g, 0, h / 2, 0, w, h, d, color);
    box(g, 0, .12, 0, w + .4, .24, d + .4, 0x7c7464, { cast: false });
    // roof
    box(g, 0, h + .2, 0, w + .6, .4, d + .6, 0x5c5145);
    // corrugation
    for (let i = -w / 2 + 1.2; i < w / 2; i += 2.4) box(g, i, h / 2, d / 2 + .03, .1, h - .4, .06, 0x4f4638, { cast: false });
    // roll-up door
    box(g, 0, 2.4, d / 2 + .04, 5.2, 4.8, .14, 0x353028, { cast: false });
    for (let yy = .4; yy < 4.8; yy += .55) box(g, 0, yy, d / 2 + .12, 5.0, .06, .05, 0x8f8672, { cast: false });
    // windows strip
    for (let i = -w / 2 + 3; i < w / 2 - 1; i += 4.2) {
      box(g, i, h - 1.2, d / 2 + .05, 2.2, 1.2, .1, 0x141d1c, { material: mat(0x1b2420, { emissive: 0x9bd8e6, emissiveIntensity: .25 }), cast: false });
    }
    addLocalCollider(x, z, rot, 0, 0, w, d, base, h, label || 'warehouse');
    addSign(g, label || 'FACTORY', 0, h + 1.15, d / 2 + .3, 0, Math.min(w * .6, 13), 2.2, { size: 72 });
    return { g, base };
  }

  function addWatchtower(x, z, baseY, height, name) {
    const g = new THREE.Group(); g.position.set(x, baseY, z); world.add(g);
    const leg = .32;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(g, sx * 2.5, height / 2, sz * 2.5, leg, height, leg, 0x6d583e);
    }
    for (let y = 3; y < height; y += 5) {
      box(g, 0, y, 2.5, 5.3, .18, .18, 0x5c4a35, { cast: false });
      box(g, 0, y, -2.5, 5.3, .18, .18, 0x5c4a35, { cast: false });
      box(g, 2.5, y, 0, .18, .18, 5.3, 0x5c4a35, { cast: false });
      box(g, -2.5, y, 0, .18, .18, 5.3, 0x5c4a35, { cast: false });
    }
    // platform
    box(g, 0, height, 0, 7.2, .35, 7.2, 0x7b6546);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      box(g, Math.cos(a) * 3.5, height + .9, Math.sin(a) * 3.5, i % 2 ? .15 : 7.0, .18, i % 2 ? 7.0 : .15, 0x6d583e, { cast: false });
      box(g, Math.cos(a) * 3.5, height + .45, Math.sin(a) * 3.5, i % 2 ? .1 : 7.0, 1.7, i % 2 ? 7.0 : .1, 0x8a7657, { cast: false });
    }
    // cabin roof
    box(g, 0, height + 3.5, 0, 6.2, .3, 6.2, 0x533c2d);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, sx * 2.8, height + 2.0, sz * 2.8, .22, 3.3, .22, 0x6d583e);
    addSign(g, name || 'PEAK', 0, height + 3.9, 3.2, 0, 5.5, 1.4, { size: 62, bg: '#2b2118', accent: '#ffc857' });
    addCollider(x, z, 5.2, 5.2, baseY, height, 'tower legs');
    platforms.push({ minX: x - 3.5, maxX: x + 3.5, minZ: z - 3.5, maxZ: z + 3.5, y: baseY + height + .2 });
    return g;
  }

  /* ============================================================
     FACTORY
     ============================================================ */
  {
    const L = LANDMARK_BY_ID.factory;
    const g = new THREE.Group(); world.add(g);
    addSign(g, 'FACTORY', L.x, heightAt(L.x, L.z) + 6, L.z + 54, 0, 18, 4.2, { size: 88, bg: '#2b2a25', accent: '#ff9a3c' });
    addWarehouse(L.x - 34, L.z - 14, 32, 19, 11, 0, 0x8d8b7a, 'FACTORY');
    addWarehouse(L.x + 20, L.z + 20, 26, 17, 9, Math.PI / 2, 0x7e8273, 'STORAGE');
    addWarehouse(L.x + 42, L.z - 30, 18, 14, 8, 0, 0x958b74, 'DEPOT');

    // Chimneys
    for (const [cx, cz, hh] of [[L.x - 54, L.z + 26, 31], [L.x - 42, L.z + 38, 25]]) {
      const b = heightAt(cx, cz);
      cylinder(world, cx, b + hh / 2, cz, 2.1, 2.7, hh, 0x8c7160, 10);
      cylinder(world, cx, b + hh - .4, cz, 2.35, 2.35, .8, 0x3a332d, 10);
      // warning stripe
      cylinder(world, cx, b + hh - 4, cz, 2.5, 2.5, 1.6, 0xe3b53f, 10);
      addCollider(cx, cz, 5.4, 5.4, b, hh, 'chimney');
      animated.chimneys.push({ x: cx, y: b + hh, z: cz, t: rand() * 10 });
    }

    // Silos
    for (const [sx, sz] of [[L.x + 50, L.z + 35], [L.x + 56, L.z + 48]]) {
      const b = heightAt(sx, sz);
      cylinder(world, sx, b + 7, sz, 3.6, 3.8, 14, 0xa7a297, 14);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(3.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8f8a80));
      dome.position.set(sx, b + 14, sz); dome.scale.y = .55; dome.castShadow = true; world.add(dome);
      addCollider(sx, sz, 7.6, 7.6, b, 15, 'silo');
    }

    // Containers and yard clutter
    addContainer(L.x - 10, L.z + 46, .22, 0x8d4b36);
    addContainer(L.x - 1, L.z + 49, .22, 0x3f6272);
    addContainer(L.x + 8, L.z + 47, -.1, 0x7b6a3f);
    addContainer(L.x + 14, L.z + 48, 1.6, 0x526b53);
    addFence(L.x + 62, L.z - 54, L.x + 62, L.z + 6, 9);
    addFence(L.x + 62, L.z + 6, L.x + 24, L.z + 58, 7);
    for (let i = 0; i < 22; i++) {
      const a = rand() * Math.PI * 2, r = rr(8, 60);
      const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
      if (pointBlocked(x, z, 1.2)) continue;
      if (rand() > .5) addCrate(x, z, 0, rr(1.0, 1.7), pick([0x8a6a3c, 0x7b5a30, 0x9a7945]));
      else addBarrel(x, z, pick([0x9a3f2f, 0x3d5c6b, 0x8b7436]));
    }
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2, r = rr(10, 64);
      lootNear(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r, 'factory');
    }
  }

  /* ============================================================
     PEAK
     ============================================================ */
  {
    const L = LANDMARK_BY_ID.peak;
    const top = heightAt(L.x, L.z);
    // cairn / flag
    const flagPole = cylinder(world, L.x + 13, top + 6, L.z - 8, .12, .18, 12, 0x6f6a5b, 6);
    addSign(world, 'PEAK', L.x, top + 5.5, L.z + 4, 0, 11, 2.6, { size: 90, bg: '#3c3f3c', accent: '#bcd7ff' });
    addWatchtower(L.x + 4, L.z + 8, top, 11, 'PEAK');
    // radio mast
    cylinder(world, L.x - 10, top + 9, L.z - 4, .1, .25, 18, 0x6f756e, 5);
    box(world, L.x - 10, top + 18.4, L.z - 4, .3, .3, .3, 0xff3b28, { emissive: 0xff2a18, emissiveIntensity: 1.8, cast: false });
    // rocks on summit
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, r = rr(8, 48);
      const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
      const y = heightAt(x, z);
      const s = rr(1.5, 5);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat(0x838a7e, { flat: true }));
      rock.position.set(x, y + s * .35, z); rock.rotation.set(rand(), rand(), rand());
      rock.castShadow = true; rock.receiveShadow = true; world.add(rock);
    }
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2, r = rr(10, 54);
      lootNear(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r, 'peak');
    }
    // flag cloth
    const flagMesh = box(world, L.x + 13, top + 10.4, L.z - 8 + 1.5, .08, 2.2, 3, 0xff7a1f, { cast: false });
    animated.flags.push(flagMesh);
    addCrate(L.x - 4, L.z + 2, top + .2, 1.4, 0x6f5c3c);
    addCrate(L.x - 2.5, L.z + 4, top + .2, 1.1, 0x80693f);
  }

  /* ============================================================
     CLOCK TOWER
     ============================================================ */
  {
    const L = LANDMARK_BY_ID.clock;
    const base = heightAt(L.x, L.z);
    // plaza
    const plaza2 = new THREE.Mesh(new THREE.CylinderGeometry(33, 34, .5, 32), mat(0xb4a787, { roughness: 1 }));
    plaza2.position.set(L.x, base + .05, L.z); plaza2.receiveShadow = true; world.add(plaza2);
    // clock tower
    const tower = new THREE.Group(); tower.position.set(L.x, base, L.z); world.add(tower);
    box(tower, 0, 3.0, 0, 11, 6, 11, 0xcfc4a9);
    box(tower, 0, 13.5, 0, 8.2, 15, 8.2, 0xdbd0b4);
    box(tower, 0, 22.5, 0, 9.4, 3, 9.4, 0xbfb294);
    box(tower, 0, 25.4, 0, 10.8, 1.2, 10.8, 0x8a7f68);
    box(tower, 0, 27.0, 0, 9.6, 2.0, 9.6, 0xb7ab8c);
    // arches
    for (const side of [0, 1, 2, 3]) {
      const a = side * Math.PI / 2;
      const g2 = new THREE.Group(); g2.rotation.y = a; g2.position.y = 0; tower.add(g2);
      box(g2, 0, 1.4, 5.54, 3.8, 2.8, .08, 0x564d3d, { cast: false });
      box(g2, 0, 4.1, 5.56, 4.4, .4, .16, 0x6a5f4b, { cast: false });
    }
    // top clock block + faces
    for (const side of [0, 1, 2, 3]) {
      const a = side * Math.PI / 2;
      const g2 = new THREE.Group(); g2.rotation.y = a; tower.add(g2);
      const faceTex = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#efe7d2'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 118, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3b3428'; ctx.lineWidth = 10; ctx.stroke();
        ctx.strokeStyle = '#3b3428'; ctx.lineWidth = 6;
        for (let i = 0; i < 12; i++) {
          const ang = i / 12 * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(w / 2 + Math.cos(ang) * 92, h / 2 + Math.sin(ang) * 92);
          ctx.lineTo(w / 2 + Math.cos(ang) * 106, h / 2 + Math.sin(ang) * 106);
          ctx.stroke();
        }
        ctx.lineCap = 'round';
        ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(-Math.PI / 3) * 54, h / 2 + Math.sin(-Math.PI / 3) * 54); ctx.stroke();
        ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(w / 2, h / 2);
        ctx.lineTo(w / 2 + Math.cos(Math.PI * .86) * 82, h / 2 + Math.sin(Math.PI * .86) * 82); ctx.stroke();
        ctx.fillStyle = '#ff7a1f'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 8, 0, Math.PI * 2); ctx.fill();
      });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), new THREE.MeshBasicMaterial({ map: faceTex, transparent: false }));
      face.position.set(0, 22.2, 4.72); g2.add(face);
      // minute hand (animated)
      const hand = new THREE.Mesh(new THREE.BoxGeometry(.12, 2.1, .1), mat(0x2b261e));
      hand.position.set(0, 22.9, 4.78); hand.rotation.z = 0; g2.add(hand);
      animated.clockHands.push(hand);
    }
    // belfry roof
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 8.5, 4), mat(0x7e3b31));
    roof.position.set(0, 32.2, 0); roof.rotation.y = Math.PI / 4; roof.castShadow = true; tower.add(roof);
    cylinder(tower, 0, 37.2, 0, .1, .18, 3.4, 0x5a5143, 5);
    box(tower, 0, 39.2, 0, .4, .4, .4, 0xffc857, { emissive: 0xffb31a, emissiveIntensity: 1.5, cast: false });
    addCollider(L.x, L.z, 11.5, 11.5, base, 30, 'clock tower');
    // plaza lamps and market
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + .2;
      const x = L.x + Math.cos(a) * 26, z = L.z + Math.sin(a) * 26;
      if (Math.abs(z - L.z) < 6) continue;
      const y = heightAt(x, z);
      cylinder(world, x, y + 2.4, z, .08, .1, 4.8, 0x3b3a31, 6);
      box(world, x, y + 5.0, z, .55, .55, .55, 0xffc857, { emissive: 0xffb84a, emissiveIntensity: 1.1, cast: false });
    }
    // market stalls
    for (const [mx, mz, rot2] of [[L.x - 30, L.z + 18, .3], [L.x + 26, L.z + 20, -.4], [L.x + 28, L.z - 24, .2]]) {
      const y = heightAt(mx, mz);
      const g2 = new THREE.Group(); g2.position.set(mx, y, mz); g2.rotation.y = rot2; world.add(g2);
      box(g2, 0, 1.0, 0, 5.2, .18, 2.4, 0x7b5f3d);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g2, sx * 2.3, 1.8, sz * 1.0, .12, 2.8, .12, 0x5c4a33);
      const canopy = box(g2, 0, 3.1, 0, 5.4, .12, 2.7, 0xa54831);
      canopy.rotation.z = .05;
      addCrate(mx, mz + 2.2, y + .1, 1.0, 0x8d6e42);
    }
    // houses around
    addHouse(L.x - 46, L.z + 34, { w: 9, d: 8, h: 4.4, rot: .0, wall: 0xd9caa8, roof: 0x915040, loot: true });
    addHouse(L.x + 50, L.z - 42, { w: 8, d: 7, h: 3.8, rot: Math.PI / 2, wall: 0xc9bda0, roof: 0x7c4536 });
    addHouse(L.x + 62, L.z + 26, { w: 7, d: 6, h: 3.6, rot: Math.PI, wall: 0xdfd2b4, roof: 0x9b4c38, platform: true });
    for (let i = 0; i < 11; i++) {
      const a = rand() * Math.PI * 2, r = rr(8, 42);
      lootNear(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r, 'clock');
    }
  }

  /* ============================================================
     RIM RAM VILLAGE
     ============================================================ */
  {
    const L = LANDMARK_BY_ID.rimram;
    const base = heightAt(L.x, L.z);
    addSign(world, 'RIM RAM', L.x, base + 4.2, L.z + 56, Math.PI, 15, 3.4, { size: 88, bg: '#283023', accent: '#9bf08b' });
    const houseDefs = [
      [-34, -20, 9, 7.5, 0], [0, -34, 8, 7, Math.PI / 2], [36, -14, 10, 8, -0.0],
      [-40, 24, 8, 7, Math.PI / 2], [38, 26, 9, 7.5, Math.PI / 2], [-8, 34, 7.5, 6.5, Math.PI],
      [12, 6, 7, 6, Math.PI / 2], [-18, 10, 6.5, 5.5, 0],
    ];
    for (const [ox, oz, w, d, rot] of houseDefs) {
      addHouse(L.x + ox, L.z + oz, {
        w, d, h: 4.0 + rand() * .7, rot,
        wall: pick([0xd8c6a1, 0xcbb894, 0xe0d3b5, 0xc4b48e]),
        roof: pick([0x8b4232, 0x7b3f30, 0x9b563a, 0x6f4934]),
        accent: pick([0x3d4f39, 0x5d4b33]),
      });
    }
    // central well
    const well = new THREE.Group(); well.position.set(L.x, base, L.z); world.add(well);
    cylinder(well, 0, .65, 0, 1.8, 1.9, 1.3, 0x8e8777, 12);
    cylinder(well, 0, 1.32, 0, 1.55, 1.55, .18, 0x2d4e54, 12);
    for (const sx of [-1, 1]) box(well, sx * 1.66, 1.6, 0, .16, 3, .16, 0x6d583e);
    box(well, 0, 3.05, 0, 3.6, .16, .16, 0x6d583e);
    box(well, 0, 1.8, 0, .1, 2.2, .1, 0x6d583e);
    addCollider(L.x, L.z, 3.8, 3.8, base, 1.6, 'well');
    // fences / yards
    addFence(L.x - 54, L.z - 40, L.x - 14, L.z - 40, 7);
    addFence(L.x + 14, L.z + 40, L.x + 58, L.z + 40, 8);
    addFence(L.x + 58, L.z - 4, L.x + 58, L.z + 40, 7);
    // banners
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, r = rr(6, 52);
      const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
      if (pointBlocked(x, z, 1.1)) continue;
      if (rand() > .55) addCrate(x, z, 0, rr(.9, 1.5), 0x8a6a3c);
      else addBarrel(x, z, pick([0x8a4a34, 0x4b5d48]));
    }
    // hay bales
    for (let i = 0; i < 8; i++) {
      const x = L.x + rr(-48, 48), z = L.z + rr(-48, 48);
      if (pointBlocked(x, z, 1.5)) continue;
      const y = heightAt(x, z);
      cylinder(world, x, y + .9, z, 1.15, 1.15, 1.8, 0xc5a34c, 10);
    }
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, r = rr(6, 52);
      lootNear(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r, 'rimram');
    }
  }

  /* ============================================================
     TIVERS
     ============================================================ */
  {
    const L = LANDMARK_BY_ID.tivers;
    const base = heightAt(L.x, L.z);
    addSign(world, 'TIVERS', L.x, base + 4.4, L.z - 50, Math.PI, 15, 3.4, { size: 92, bg: '#1f2c2d', accent: '#68ddff' });
    // stilt houses close to the bank
    const stiltDefs = [
      [-44, -20, 8, 7.5, 0], [-40, 18, 7, 6.5, Math.PI / 2],
      [2, -38, 9, 7, 0], [24, 30, 8, 7, Math.PI / 2],
      [50, 0, 8.5, 7.5, Math.PI], [-8, 38, 7.5, 6.5, 0],
    ];
    for (const [ox, oz, w, d, rot] of stiltDefs) {
      addHouse(L.x + ox, L.z + oz, {
        w, d, h: 3.7, rot,
        wall: pick([0xa9a288, 0xb5aa8c, 0xc0b693]),
        roof: pick([0x4d5b58, 0x6a4a38, 0x53645b]),
        accent: 0x2e4141,
      });
    }
    // docks extending toward the water (west)
    const dockY = base + .8;
    const dock = new THREE.Group(); world.add(dock);
    for (let x = L.x - 46; x >= L.x - 104; x -= 6) {
      box(dock, x, dockY, L.z - 4, 6.1, .22, 3.0, 0x7b603f);
      box(dock, x, dockY + .65, L.z - 5.35, .18, 1.3, .18, 0x5f4a31);
    }
    for (let z = L.z - 18; z <= L.z + 20; z += 7) {
      box(dock, L.x - 54, dockY - .3, z, .28, 1.8, .28, 0x5f4a31);
    }
    box(dock, L.x - 75, dockY + .1, L.z - 4, 62, .18, 3.0, 0x7b603f);
    platforms.push({ minX: L.x - 108, maxX: L.x - 42, minZ: L.z - 5.8, maxZ: L.z - 2.2, y: dockY + .2 });
    // boats
    for (let i = 0; i < 3; i++) {
      const bx = L.x - 112 - i * 14, bz = L.z - 22 + i * 17;
      const boat = new THREE.Group(); boat.position.set(bx, -0.4, bz); boat.rotation.y = rr(-.4, .4); world.add(boat);
      const hull = new THREE.Mesh(new THREE.SphereGeometry(2.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x6f5540));
      hull.scale.set(1.0, .45, .55); hull.rotation.x = Math.PI; hull.castShadow = true; boat.add(hull);
      box(boat, 0, .7, 0, .2, 1.5, .2, 0x5b4a35);
      box(boat, 0, 1.4, 0, 3.4, .1, .12, 0x8a7354);
      animated.boats.push({ group: boat, baseY: -0.4, phase: rand() * 6 });
    }
    // fishing crates, nets, barrels
    for (let i = 0; i < 18; i++) {
      const a = rand() * Math.PI * 2, r = rr(8, 58);
      const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
      if (pointBlocked(x, z, 1.1)) continue;
      if (rand() > .45) addCrate(x, z, 0, rr(.9, 1.6), 0x7e623c);
      else addBarrel(x, z, pick([0x3b5c64, 0x8a4c32, 0x5e6a47]));
    }
    // market canopy
    const canopy = new THREE.Group(); canopy.position.set(L.x + 6, base, L.z + 6); world.add(canopy);
    for (const [sx, sz] of [[-3, -2.2], [3, -2.2], [-3, 2.2], [3, 2.2]]) box(canopy, sx, 1.6, sz, .12, 2.6, .12, 0x574631);
    box(canopy, 0, 3.0, 0, 6.6, .12, 5.0, 0x3d6b72);
    addCrate(L.x + 6, L.z + 7.4, base, 1.1, 0x8a6a3c);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2, r = rr(6, 56);
      lootNear(L.x + Math.cos(a) * r, L.z + Math.sin(a) * r, 'tivers');
    }
  }

  /* ============================================================
     SCATTERED HAMLETS
     ============================================================ */
  const hamlets = [
    [-152, 198], [-116, -312], [138, -204], [352, 116], [-354, 82], [150, 344], [-78, -110], [312, 214],
  ];
  for (const [hx, hz] of hamlets) {
    if (heightAt(hx, hz) < 2.2) continue;
    addHouse(hx, hz, {
      w: rr(6.5, 8.5), d: rr(5.8, 7.4), h: rr(3.4, 4.3), rot: Math.round(rand() * 4) % 4 * Math.PI / 2,
      wall: pick([0xd3c3a1, 0xc8b792, 0xdfd0b0]),
      roof: pick([0x8a4333, 0x77402f, 0x9a5438]),
      loot: true,
    });
    if (rand() > .4) addCrate(hx + rr(7, 12), hz + rr(-5, 5), 0, 1.2, 0x83633a);
  }

  /* ============================================================
     SPAWN CAMP
     ============================================================ */
  {
    const sx = 14, sz = 424;
    const b = heightAt(sx, sz);
    // small landing pad
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(13, 13.5, .35, 20), mat(0x8f8b74, { roughness: 1 }));
    pad.position.set(sx, b + .05, sz); pad.receiveShadow = true; world.add(pad);
    addSign(world, 'DROP ZONE', sx - 31, b + 3.1, sz - 4, Math.PI / 2, 7.4, 1.8, { size: 72, bg: '#242b23', accent: '#ff7a1f' });
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + .6;
      const x = sx + Math.cos(a) * 15, z = sz + Math.sin(a) * 15;
      addCrate(x, z, 0, rr(1.1, 1.7), 0x8a6a3c);
    }
    for (let i = 0; i < 6; i++) lootNear(sx + rr(-18, 18), sz + rr(-16, 16), 'spawn');
    // supply beacon
    cylinder(world, sx + 3, b + 3, sz + 4, .08, .08, 6, 0x4b4a42, 5);
    box(world, sx + 3, b + 6.1, sz + 4, .4, .4, .4, 0xff7a1f, { emissive: 0xff6a12, emissiveIntensity: 1.5, cast: false });
  }

  /* ---------- Extra loot along roads ---------- */
  const roadLootPoints = [
    [-100, 20], [-190, -92], [122, 10], [200, 70], [310, 210], [-206, 188], [50, -170], [340, 90], [-330, 140], [70, 320],
  ];
  for (const [x, z] of roadLootPoints) lootNear(x + rr(-4, 4), z + rr(-4, 4), 'road');

  /* ============================================================
     TREES / ROCKS / BUSHES
     ============================================================ */
  function awayFromLandmarks(x, z, margin = 16) {
    for (const l of LANDMARKS) if (dist2(x, z, l.x, l.z) < (l.radius + margin) ** 2) return false;
    return true;
  }
  const treePositions = [];
  let tries = 0;
  while (treePositions.length < 560 && tries < 6000) {
    tries++;
    const x = rr(-472, 472), z = rr(-472, 472);
    const h = heightAt(x, z);
    if (h < 3 || h > 33) continue;
    if (!awayFromLandmarks(x, z, 8)) continue;
    if (Math.abs(x - riverCenterX(z)) < riverWidth(z) + 10) continue;
    if (dist2(x, z, 14, 424) < 40 * 40) continue;
    if (pointBlocked(x, z, 2.4)) continue;
    treePositions.push({ x, z, h, s: rr(.8, 1.35), pine: rand() > .42 });
  }
  const trunkGeo = new THREE.CylinderGeometry(.28, .48, 4.2, 5);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, mat(0x5b422d, { flat: true }), treePositions.length);
  trunkMesh.castShadow = true; trunkMesh.receiveShadow = true;
  const pineGeo = new THREE.ConeGeometry(2.2, 6.6, 7);
  const pineMesh = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), treePositions.length);
  pineMesh.castShadow = true; pineMesh.receiveShadow = true;
  const leafGeo = new THREE.IcosahedronGeometry(2.25, 0);
  const leafMesh = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), treePositions.length);
  leafMesh.castShadow = true; leafMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const leafColor = new THREE.Color();
  treePositions.forEach((t, i) => {
    dummy.position.set(t.x, t.h + 1.9 * t.s, t.z);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    dummy.scale.setScalar(t.s);
    dummy.updateMatrix(); trunkMesh.setMatrixAt(i, dummy.matrix);
    if (t.pine) {
      dummy.position.y = t.h + 5.7 * t.s;
      dummy.scale.set(t.s * .95, t.s * 1.15, t.s * .95);
      dummy.updateMatrix(); pineMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0; dummy.scale.setScalar(0); dummy.updateMatrix(); leafMesh.setMatrixAt(i, dummy.matrix);
      leafColor.setHSL(.31 + rand() * .04, .32, .22 + rand() * .07);
      pineMesh.setColorAt(i, leafColor);
      leafMesh.setColorAt(i, leafColor);
    } else {
      dummy.position.y = t.h + 5.2 * t.s;
      dummy.rotation.y = rand() * Math.PI;
      dummy.scale.set(t.s * 1.18, t.s, t.s * 1.18);
      dummy.updateMatrix(); leafMesh.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0; dummy.scale.setScalar(0); dummy.updateMatrix(); pineMesh.setMatrixAt(i, dummy.matrix);
      leafColor.setHSL(.27 + rand() * .06, .42, .28 + rand() * .1);
      leafMesh.setColorAt(i, leafColor);
      pineMesh.setColorAt(i, leafColor);
    }
  });
  world.add(trunkMesh, pineMesh, leafMesh);

  // Rocks
  const rocks = [];
  tries = 0;
  while (rocks.length < 130 && tries < 2000) {
    tries++;
    const x = rr(-470, 470), z = rr(-470, 470);
    const h = heightAt(x, z);
    if (h < 1 || h > 42) continue;
    if (!awayFromLandmarks(x, z, -6)) continue;
    if (pointBlocked(x, z, 2)) continue;
    rocks.push({ x, z, h, s: rr(.5, 2.2) });
  }
  const rockMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0x7f8779, { flat: true }), rocks.length);
  rockMesh.castShadow = true; rockMesh.receiveShadow = true;
  rocks.forEach((r, i) => {
    dummy.position.set(r.x, r.h + r.s * .35, r.z);
    dummy.rotation.set(rand(), rand() * 6, rand());
    dummy.scale.set(r.s, r.s * .72, r.s);
    dummy.updateMatrix(); rockMesh.setMatrixAt(i, dummy.matrix);
  });
  world.add(rockMesh);

  // Low bushes
  const bushes = [];
  tries = 0;
  while (bushes.length < 380 && tries < 3000) {
    tries++;
    const x = rr(-474, 474), z = rr(-474, 474);
    const h = heightAt(x, z);
    if (h < 2.5 || h > 30) continue;
    if (!awayFromLandmarks(x, z, 2)) continue;
    if (pointBlocked(x, z, 1.2)) continue;
    bushes.push({ x, z, h, s: rr(.5, 1.2) });
  }
  const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({ color: 0x3e7338, roughness: 1, flatShading: true }), bushes.length);
  bushMesh.castShadow = true; bushMesh.receiveShadow = true;
  bushes.forEach((b, i) => {
    dummy.position.set(b.x, b.h + b.s * .4, b.z);
    dummy.rotation.set(0, rand() * 6, 0);
    dummy.scale.set(b.s * 1.25, b.s * .7, b.s * 1.25);
    dummy.updateMatrix(); bushMesh.setMatrixAt(i, dummy.matrix);
  });
  world.add(bushMesh);

  /* ---------- Smoke for chimneys ---------- */
  const smokeTex = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(235,235,230,.85)');
    g.addColorStop(.45, 'rgba(210,210,205,.35)');
    g.addColorStop(1, 'rgba(200,200,195,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  for (const ch of animated.chimneys) {
    const count = 22;
    const arr = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pm = new THREE.PointsMaterial({ map: smokeTex, size: 13, transparent: true, opacity: .5, depthWrite: false, color: 0xe7e4dc, blending: THREE.NormalBlending });
    const points = new THREE.Points(geo, pm);
    world.add(points);
    ch.points = points; ch.count = count;
    for (let i = 0; i < count; i++) {
      arr[i * 3] = ch.x + rr(-1, 1);
      arr[i * 3 + 1] = ch.y + rr(0, 22);
      arr[i * 3 + 2] = ch.z + rr(-1, 1);
    }
  }

  /* ---------- Clouds ---------- */
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: .82 });
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(rand() * 4);
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rr(9, 18), 0), cloudMat);
      m.position.set(rr(-22, 22), rr(-4, 5), rr(-12, 12));
      m.scale.set(1, rr(.45, .7), 1);
      g.add(m);
    }
    g.position.set(rr(-520, 520), rr(120, 190), rr(-520, 520));
    world.add(g);
    animated.clouds.push({ g, speed: rr(.5, 1.6) });
  }

  /* ---------- world API ---------- */
  let elapsed = 0;
  function update(dt) {
    elapsed += dt;
    for (const c of animated.chimneys) {
      const p = c.points.geometry.attributes.position.array;
      for (let i = 0; i < c.count; i++) {
        p[i * 3 + 1] += dt * (2.2 + (i % 5) * .4);
        p[i * 3] += dt * .45;
        if (p[i * 3 + 1] > c.y + 26) {
          p[i * 3] = c.x + rr(-1, 1);
          p[i * 3 + 1] = c.y;
          p[i * 3 + 2] = c.z + rr(-1, 1);
        }
      }
      c.points.geometry.attributes.position.needsUpdate = true;
    }
    for (const b of animated.boats) {
      b.group.position.y = b.baseY + Math.sin(elapsed * 1.1 + b.phase) * .12;
      b.group.rotation.z = Math.sin(elapsed * .8 + b.phase) * .035;
    }
    for (const f of animated.flags) {
      f.rotation.y = Math.sin(elapsed * 2.2) * .08;
    }
    for (const h of animated.clockHands) h.rotation.z = -elapsed * .02;
    for (const c of animated.clouds) {
      c.g.position.x += dt * c.speed;
      if (c.g.position.x > 620) c.g.position.x = -620;
    }
    water.material.opacity = .78 + Math.sin(elapsed * .5) * .03;
  }

  // Ensure spawn area and town anchors
  for (const l of LANDMARKS) lootNear(l.x + rr(-4, 4), l.z + rr(-4, 4), l.id);

  return {
    group: world, terrain, water, sky, sunSprite,
    update, heightAt, groundHeightAt, resolveCollision: resolveWorldCollision,
    hasLineOfSight, pointBlocked, colliders, platforms, lootAnchors,
    roadPaths, riverPts,
    landmarkAt(x, z) {
      let best = null, bd = Infinity;
      for (const l of LANDMARKS) {
        const d = dist(x, z, l.x, l.z);
        if (d < l.radius + 30 && d < bd) { bd = d; best = l; }
      }
      return best;
    },
  };
}
