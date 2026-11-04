import * as THREE from '../vendor/three.module.js';

/* ============================================================
   WEAPONS — stats, models and viewmodels
   ============================================================ */

export const WEAPONS = {
  ak: {
    id: 'ak', slot: 1, name: 'AK-47', className: 'ASSAULT RIFLE', short: 'AK',
    damage: 34, head: 2.2, limb: .68, rpm: 600, mag: 30, reserve: 120,
    reload: 2.25, spread: .016, adsSpread: .0045, range: 420, auto: true,
    recoil: 1.15, adsZoom: 1.32, moveSpread: .02, color: '#ff9a3c',
    sound: 'ak', bulletSpeed: 780,
  },
  ump: {
    id: 'ump', slot: 2, name: 'UMP', className: 'SUBMACHINE GUN', short: 'UMP',
    damage: 24, head: 1.95, limb: .66, rpm: 720, mag: 30, reserve: 120,
    reload: 2.0, spread: .021, adsSpread: .0075, range: 180, auto: true,
    recoil: .72, adsZoom: 1.22, moveSpread: .014, color: '#7fd8ff',
    sound: 'ump', bulletSpeed: 520,
  },
  awm: {
    id: 'awm', slot: 3, name: 'AWM', className: 'SNIPER RIFLE', short: 'AWM',
    damage: 115, head: 2.4, limb: .62, rpm: 48, mag: 5, reserve: 25,
    reload: 3.35, spread: .0016, adsSpread: .0003, range: 800, auto: false,
    recoil: 3.2, adsZoom: 4.2, moveSpread: .05, color: '#9bf08b',
    sound: 'awm', bulletSpeed: 900,
  },
};

export const WEAPON_ORDER = ['ak', 'ump', 'awm'];

const matCache = new Map();
function wm(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? .55, metalness: opts.metalness ?? .35,
    flatShading: true, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  matCache.set(key, m);
  return m;
}
function b(parent, x, y, z, w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || wm(color, opts));
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  m.castShadow = !!opts.cast;
  parent.add(m);
  return m;
}
function cyl(parent, x, y, z, r1, r2, h, color, seg = 8, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), opts.material || wm(color, opts));
  m.position.set(x, y, z);
  m.rotation.x = Math.PI / 2;
  if (opts.rx) m.rotation.x += opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  parent.add(m);
  return m;
}

/** Returns a low-poly weapon group pointed down -Z. */
export function makeWeaponModel(id) {
  const g = new THREE.Group();
  const dark = 0x1c2020, steel = 0x3d4545, wood = 0x75452a, tan = 0x88764f, green = 0x495440;
  if (id === 'ak') {
    b(g, 0, 0, 0, .105, .125, .44, dark);
    b(g, 0, .012, -.31, .095, .09, .26, wood, { roughness: .8, metalness: .05 });
    cyl(g, 0, .015, -.53, .021, .021, .34, steel, 8);
    cyl(g, 0, .015, -.705, .028, .028, .07, 0x151919, 8);
    b(g, 0, -.145, .02, .085, .24, .105, steel, { rx: .28 });
    b(g, 0, -.1, .18, .075, .19, .075, wood, { rx: -.24 });
    b(g, 0, .005, .39, .085, .115, .29, wood);
    b(g, 0, .124, .01, .07, .035, .17, steel);
    b(g, 0, .135, -.36, .025, .055, .045, steel);
    b(g, 0, .135, .16, .03, .05, .04, steel);
    b(g, 0, .02, -.09, .115, .025, .12, 0x2b302d);
    b(g, .075, .01, -.06, .015, .04, .1, steel);
  } else if (id === 'ump') {
    b(g, 0, 0, -.02, .105, .13, .4, 0x3c4244);
    b(g, 0, -.06, .18, .095, .11, .24, 0x2e3335);
    b(g, 0, .012, -.33, .07, .06, .2, 0x252a2b);
    cyl(g, 0, .012, -.46, .019, .019, .12, 0x1c1f20, 8);
    b(g, 0, -.22, .02, .07, .26, .085, 0x242829, { rx: .1 });
    b(g, 0, -.08, .18, .06, .17, .07, 0x2b3031, { rx: -.18 });
    b(g, 0, .09, -.02, .045, .04, .29, 0x1d2122);
    b(g, 0, .14, -.1, .025, .045, .04, 0x2d3233);
    b(g, 0, .14, .09, .025, .04, .035, 0x2d3233);
    b(g, .075, .02, .01, .015, .03, .17, 0x505758);
  } else {
    // AWM
    b(g, 0, 0, -.02, .09, .105, .54, green);
    cyl(g, 0, .015, -.55, .021, .021, .54, 0x272d2a, 8);
    cyl(g, 0, .015, -.82, .032, .032, .09, 0x171b18, 8);
    b(g, 0, .105, -.04, .055, .055, .28, 0x1f2421);
    cyl(g, 0, .15, -.04, .052, .052, .3, 0x141817, 10);
    cyl(g, 0, .15, -.2, .062, .052, .07, 0x0f1211, 10);
    b(g, .075, .06, .02, .02, .02, .12, steel);
    b(g, .09, .07, .04, .055, .022, .045, steel);
    b(g, 0, -.02, .34, .1, .14, .34, 0x394433);
    b(g, 0, -.07, .16, .06, .16, .07, 0x2a3227, { rx: -.18 });
    b(g, 0, -.2, -.04, .085, .22, .08, 0x2a3029, { rx: .16 });
    b(g, -.07, -.2, -.57, .025, .22, .025, 0x2a3029, { rx: .25 });
    b(g, .07, -.2, -.57, .025, .22, .025, 0x2a3029, { rx: .25 });
    b(g, 0, -.01, .18, .1, .02, .16, 0x242c22);
  }
  return g;
}

/** First-person viewmodels, one per weapon, with gloved hands. */
export function buildViewmodels() {
  const groups = {};
  const muzzle = {};
  for (const id of WEAPON_ORDER) {
    const root = new THREE.Group();
    root.name = 'vm-' + id;
    const gun = makeWeaponModel(id);
    gun.scale.setScalar(1.06);
    root.add(gun);

    const glove = 0x1f2725;
    const handA = b(root, .045, -.2, .13, .085, .11, .14, glove, { roughness: .95, metalness: .02 });
    handA.rotation.x = -.2;
    const handB = b(root, -.035, -.145, -.24, .09, .1, .13, glove, { roughness: .95, metalness: .02 });
    handB.rotation.x = .3;
    const sleeve = b(root, .04, -.31, .23, .13, .18, .14, 0x45513d, { roughness: .95, metalness: .02 });
    sleeve.rotation.x = -.3;

    if (id === 'awm') {
      const lens = new THREE.Mesh(
        new THREE.CircleGeometry(.045, 16),
        new THREE.MeshBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: .85 })
      );
      lens.position.set(0, .15, -.196);
      lens.rotation.y = Math.PI;
      root.add(lens);
    }
    if (id === 'ump') {
      // small torch / laser
      const dot = new THREE.Mesh(new THREE.BoxGeometry(.03, .03, .03), wm(0xff7a1f, { emissive: 0xff6a12, emissiveIntensity: 2 }));
      dot.position.set(.06, .02, -.42);
      root.add(dot);
    }

    // Muzzle flash sprite
    const flashTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const ctx = c.getContext('2d');
      const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,235,1)');
      grd.addColorStop(.18, 'rgba(255,220,120,.95)');
      grd.addColorStop(.45, 'rgba(255,120,30,.55)');
      grd.addColorStop(1, 'rgba(255,80,10,0)');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    flash.scale.set(.34, .34, 1);
    flash.position.set(0, .02, id === 'awm' ? -.88 : id === 'ak' ? -.75 : -.54);
    flash.visible = false;
    flash.renderOrder = 50;
    root.add(flash);

    // world-space muzzle tip used for tracers
    const muzzleTip = new THREE.Vector3(0, .02, id === 'awm' ? -.9 : id === 'ak' ? -.78 : -.58);

    // offset the whole model into the lower-right of the screen
    root.scale.setScalar(.72);
    root.position.set(.28, -.27, -.58);
    root.rotation.set(.02, -.03, -.015);

    groups[id] = { root, gun, flash, muzzleTip };
  }
  return groups;
}

/** Simple icon-ish weapon mesh for ground loot. */
export function makeLootWeapon(id) {
  const g = makeWeaponModel(id);
  g.scale.setScalar(2.1);
  g.rotation.z = Math.PI / 2;
  g.rotation.y = -.2;
  return g;
}
