import * as THREE from '../vendor/three.module.js';
import {
  createWorld, MAP, LANDMARKS, clamp, lerp, dist, heightAt, groundHeightAt, LANDMARK_BY_ID,
} from './world.js';
import { WEAPONS, WEAPON_ORDER, buildViewmodels, makeLootWeapon } from './weapons.js';
import { spawnBots } from './bots.js';
import { UI, formatTime, formatZoneTime } from './ui.js';
import { AudioEngine } from './audio.js';

/* ============================================================
   FIREZONE — game bootstrap & loop
   ============================================================ */
const ui = new UI();
const audio = new AudioEngine();
const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);

let renderer, scene, camera, vmScene, vmCamera, world;
let viewmodels, activeVM = null;
let sunLight, hemiLight, sunTarget;
let stormGroup, stormWall, stormRing, stormTopRing;

const state = {
  mode: 'boot',
  matchId: 0,
  ending: false,
  sensitivity: ui.settings.sensitivity,
  adsSens: ui.settings.adsSens,
  fov: ui.settings.fov,
  volume: ui.settings.volume,
  aimedBot: null,
  aimedDist: 0,
  nearLoot: null,
  suppressLock: false,
  lookSwayX: 0,
  lookSwayY: 0,
  aimTimer: 0,
  lastKillName: '',
  settingsReturn: 'lobby',
};

const player = {
  name: 'OPERATOR',
  position: new THREE.Vector3(14, 6.6, 424),
  health: MAP.health,
  maxHealth: MAP.health,
  alive: true,
  airborne: false,
  vy: 0,
  crouch: 0,
  bob: 0,
  stormAcc: 0,
  takeDamage(amount, source, sourceName) {
    if (!this.alive || state.mode !== 'playing') return;
    this.health -= amount;
    state.lastKillName = sourceName || 'STORM';
    audio.hurt();
    ui.flashDamage(clamp(.22 + amount / 48, .22, .85));
    if (source) {
      const dx = source.position.x - this.position.x;
      const dz = source.position.z - this.position.z;
      const fwdx = -Math.sin(yaw), fwdz = -Math.cos(yaw);
      const rgtx = Math.cos(yaw), rgtz = -Math.sin(yaw);
      const angle = Math.atan2(dx * rgtx + dz * rgtz, dx * fwdx + dz * fwdz) * 180 / Math.PI;
      ui.showHitDirection(angle);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      onPlayerDeath();
    }
  },
};

const input = {
  keys: new Set(),
  fire: false,
  firePressed: false,
  ads: false,
  sprint: false,
  crouch: false,
  joy: { x: 0, y: 0, active: false },
  look: { active: false, id: null, x: 0, y: 0 },
};

let yaw = 0, pitch = 0, recoilPitch = 0;
let walkPhase = 0;
let velocity = new THREE.Vector3();
let fireCooldown = 0, reloadTimer = 0, reloading = false;
let weaponKick = 0, muzzleTimer = 0;
let lobbyTime = 0;
let lastFrame = performance.now();
let elapsed = 0;
let kills = 0, damageDealt = 0, medkits = 0, matchCount = 0;
let shotsFired = 0, shotsHit = 0;
let inventory = {};
let activeId = 'ump';
let bots = [];
let loots = [];
let lootId = 0;
let tracers = [];
let effects = [];
let zone = {};
let lastMatchId = 0;
let aimRaf = 0;
let glowTexture, sparkTexture;
let gameOverTimer = null;

const botSpawnPoints = [
  { x: -302, z: -222 }, { x: -230, z: -112 }, { x: 230, z: -46 }, { x: 166, z: -128 },
  { x: -252, z: 242 }, { x: -202, z: 196 }, { x: 286, z: 316 }, { x: 344, z: 362 },
  { x: 42, z: -352 }, { x: 62, z: -292 }, { x: 18, z: 268 }, { x: -120, z: 54 },
];
const playerSpawn = { x: 14, z: 424 };

const ZONE_STAGES = [
  { wait: 55, shrink: 45, radius: 428 },
  { wait: 40, shrink: 38, radius: 248 },
  { wait: 34, shrink: 32, radius: 132 },
  { wait: 28, shrink: 26, radius: 60 },
  { wait: 24, shrink: 22, radius: 18 },
];

/* ============================================================
   BOOT
   ============================================================ */
bootstrap();

async function bootstrap() {
  ui.boot(.06, 'STARTING RENDERER');
  await nextFrame();
  initRenderer();
  ui.boot(.24, 'RAISING ISLA VERDE');
  await nextFrame();
  world = createWorld(scene);
  ui.boot(.55, 'PAINTING LANDMARKS');
  await nextFrame();
  setupLighting();
  setupViewmodel();
  createStorm();
  createTextures();
  setupInput();
  setupTouch();
  setupUIEvents();
  ui.boot(.84, 'LOADING LOADOUTS');
  await nextFrame();
  initLobbyCamera();
  ui.boot(1, 'READY');
  await delay(280);
  ui.hideBoot();
  state.mode = 'lobby';
  lastFrame = performance.now();
  requestAnimationFrame(loop);
}

function nextFrame() { return new Promise(r => requestAnimationFrame(() => r())); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc7dde0, 210, 930);
  camera = new THREE.PerspectiveCamera(86, window.innerWidth / window.innerHeight, .06, 1600);
  camera.rotation.order = 'YXZ';

  vmScene = new THREE.Scene();
  vmCamera = new THREE.PerspectiveCamera(86, window.innerWidth / window.innerHeight, .01, 12);
  const vmAmb = new THREE.AmbientLight(0xffffff, 1.1); vmScene.add(vmAmb);
  const vmHemi = new THREE.HemisphereLight(0xd9efff, 0x33402e, 1.2); vmScene.add(vmHemi);
  const vmDir = new THREE.DirectionalLight(0xffe5be, 2.2); vmDir.position.set(-1.5, 2.5, 1.2); vmScene.add(vmDir);
  const vmFill = new THREE.PointLight(0xff8a3c, 1.2, 3); vmFill.position.set(1, .2, .4); vmScene.add(vmFill);

  onResize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
}

function setupLighting() {
  hemiLight = new THREE.HemisphereLight(0xdff2ff, 0x3d4a2e, 1.35);
  scene.add(hemiLight);
  const ambient = new THREE.AmbientLight(0xb8c8b1, .22);
  scene.add(ambient);

  sunLight = new THREE.DirectionalLight(0xffe1ad, 2.35);
  sunLight.position.set(-160, 240, 120);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.left = -105;
  sunLight.shadow.camera.right = 105;
  sunLight.shadow.camera.top = 105;
  sunLight.shadow.camera.bottom = -105;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 460;
  sunLight.shadow.bias = -.0007;
  sunLight.shadow.normalBias = .035;
  sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sunLight.target = sunTarget;
  scene.add(sunLight);
}

function setupViewmodel() {
  viewmodels = buildViewmodels();
  for (const id of WEAPON_ORDER) {
    const root = viewmodels[id].root;
    root.visible = false;
    vmScene.add(root);
  }
}

function createStorm() {
  stormGroup = new THREE.Group();
  stormGroup.visible = false;
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x5fe3ff, transparent: true, opacity: .085, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  stormWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), wallMat);
  stormWall.position.y = .5;
  stormGroup.add(stormWall);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x74ecff, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  stormRing = new THREE.Mesh(new THREE.RingGeometry(.988, 1, 128), ringMat);
  stormRing.rotation.x = -Math.PI / 2;
  stormRing.position.y = .4;
  stormGroup.add(stormRing);
  stormTopRing = new THREE.Mesh(new THREE.RingGeometry(.994, 1, 128), ringMat.clone());
  stormTopRing.rotation.x = -Math.PI / 2;
  stormTopRing.position.y = 16;
  stormGroup.add(stormTopRing);
  scene.add(stormGroup);
}

function createTextures() {
  const makeGlow = (inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,.35)') => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner); g.addColorStop(.28, mid); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  glowTexture = makeGlow();
  sparkTexture = makeGlow('rgba(255,255,225,1)', 'rgba(255,180,80,.5)');
}

function initLobbyCamera() {
  camera.fov = 58;
  camera.updateProjectionMatrix();
  camera.position.set(205, 168, 474);
  camera.lookAt(-10, 24, 16);
  stormGroup.visible = false;
  sunTarget.position.set(0, 0, 0);
  sunLight.position.set(-170, 250, 130);
  if (activeVM) activeVM.root.visible = false;
}

function onResize() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vmCamera.aspect = w / h; vmCamera.updateProjectionMatrix();
  const portrait = h > w && isTouch;
  ui.showRotateHint(portrait && state.mode === 'playing');
}

/* ============================================================
   MATCH SETUP
   ============================================================ */
function clearMatch() {
  for (const b of bots) { scene.remove(b.group); disposeGroup(b.group); }
  bots = [];
  for (const l of loots) { scene.remove(l.group); disposeGroup(l.group); }
  loots = [];
  for (const t of tracers) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); }
  tracers = [];
  for (const e of effects) { scene.remove(e.sprite); e.sprite.material.dispose(); }
  effects = [];
  if (gameOverTimer) { clearTimeout(gameOverTimer); gameOverTimer = null; }
  ui.resetHUD();
}

function startMatch() {
  matchCount++;
  state.matchId++;
  const thisMatch = state.matchId;
  state.ending = false;
  state.aimedBot = null;
  state.nearLoot = null;
  state.suppressLock = true;
  if (gameOverTimer) { clearTimeout(gameOverTimer); gameOverTimer = null; }
  audio.init();
  audio.setVolume(state.volume);

  clearMatch();
  ui.hideEnd();
  ui.showGame();
  ui.showPause(false);
  ui.showSettings(false);
  if (isTouch) ui.showTouch(); else ui.hideTouch();
  ui.showRotateHint(window.innerHeight > window.innerWidth && isTouch);

  player.position.set(playerSpawn.x, groundHeightAt(playerSpawn.x, playerSpawn.z), playerSpawn.z);
  player.health = MAP.health;
  player.alive = true;
  player.airborne = false;
  player.vy = 0;
  player.crouch = 0;
  player.bob = 0;
  player.stormAcc = 0;
  yaw = 0; pitch = -.02; recoilPitch = 0;
  walkPhase = 0; velocity.set(0, 0, 0);
  fireCooldown = 0; reloadTimer = 0; reloading = false;
  weaponKick = 0; muzzleTimer = 0;
  elapsed = 0; kills = 0; damageDealt = 0; medkits = 0; shotsFired = 0; shotsHit = 0;
  inventory = { ump: { mag: 30, reserve: 90 }, ak: null, awm: null };
  activeId = 'ump';
  input.fire = false; input.firePressed = false; input.ads = false; input.crouch = false;
  input.joy.x = 0; input.joy.y = 0; input.joy.active = false;

  zone = { x: -6, z: 18, radius: ZONE_STAGES[0].radius + 332, from: 0, to: 0, timer: ZONE_STAGES[0].wait, state: 'waiting', stage: 0, dps: 2.5, nextRadius: ZONE_STAGES[0].radius, shrinkT: 0, duration: 0 };
  zone.from = zone.radius;
  stormGroup.visible = true;
  updateStormVisual();

  spawnAllLoot();
  bots = spawnBots(scene, world, 11, botSpawnPoints);
  // Guarantee no bot starts within 140m of the player
  for (const b of bots) {
    if (dist(b.position.x, b.position.z, player.position.x, player.position.z) < 140) {
      const a = Math.random() * Math.PI * 2;
      b.position.x = clamp(player.position.x + Math.cos(a) * 210, -MAP.playable, MAP.playable);
      b.position.z = clamp(player.position.z + Math.sin(a) * 210, -MAP.playable, MAP.playable);
      b.position.y = groundHeightAt(b.position.x, b.position.z);
      b.group.position.copy(b.position);
    }
  }

  updateCamera(dtPlaceholder(), true);
  setActiveModel(activeId);
  updateHUDState();

  state.mode = 'playing';
  lastFrame = performance.now();
  ui.showToast('DROP ZONE · ISLA VERDE', 2.4);
  setTimeout(() => {
    if (state.matchId === thisMatch && state.mode === 'playing') ui.showToast(isTouch ? 'TAP AIM TO ZOOM · LOOT THE BEACON' : 'FIND A RIFLE · RMB TO AIM · LMB TO FIRE', 2.2);
  }, 2600);

  if (!isTouch) {
    lockPointer();
    setTimeout(() => { state.suppressLock = false; }, 900);
  } else {
    state.suppressLock = false;
  }
}

function dtPlaceholder() { return .016; }

function spawnAllLoot() {
  const fixed = [
    { type: 'weapon', weaponId: 'ak', x: 28, z: 414 },
    { type: 'weapon', weaponId: 'awm', x: -8, z: 407 },
    { type: 'weapon', weaponId: 'ump', x: 13, z: 399 },
    { type: 'ammo', x: 21, z: 412 },
    { type: 'med', x: 2, z: 432 },
    { type: 'ammo', x: -14, z: 430 },
    { type: 'med', x: 36, z: 425 },
  ];
  for (const f of fixed) spawnLoot(f.x, f.z, f.type, f.weaponId);

  const anchors = world.lootAnchors
    .filter(a => Math.hypot(a.x - player.position.x, a.z - player.position.z) > 9)
    .filter(a => !world.pointBlocked(a.x, a.z, 1.3))
    .sort(() => Math.random() - .5)
    .slice(0, 54);

  for (const a of anchors) {
    const r = Math.random();
    if (r < .115) spawnLoot(a.x, a.z, 'weapon', 'ak');
    else if (r < .225) spawnLoot(a.x, a.z, 'weapon', 'ump');
    else if (r < .285) spawnLoot(a.x, a.z, 'weapon', 'awm');
    else if (r < .66) spawnLoot(a.x, a.z, 'ammo');
    else spawnLoot(a.x, a.z, 'med');
  }
}

function spawnLoot(x, z, type, weaponId) {
  const y = groundHeightAt(x, z);
  if (y < -1.5) return;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  scene.add(group);

  let color = 0xffc857;
  if (type === 'weapon') color = new THREE.Color(WEAPONS[weaponId].color).getHex();
  else if (type === 'ammo') color = 0x6fd6ff;
  else color = 0x7dff9a;

  const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .23, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.035, .19, 2.4, 7, 1, true), beamMat);
  beam.position.y = 1.25;
  group.add(beam);

  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.42, .58, 20), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = .06;
  group.add(ring);

  const float = new THREE.Group();
  float.position.y = 1.02;
  group.add(float);

  if (type === 'weapon') {
    const gun = makeLootWeapon(weaponId);
    float.add(gun);
  } else if (type === 'ammo') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(.62, .35, .45), new THREE.MeshStandardMaterial({ color: 0x5b6443, roughness: .8, metalness: .18, flatShading: true }));
    box.castShadow = true; float.add(box);
    const top = new THREE.Mesh(new THREE.BoxGeometry(.48, .06, .34), new THREE.MeshBasicMaterial({ color }));
    top.position.y = .2; float.add(top);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(.1, .02, .36), new THREE.MeshBasicMaterial({ color: 0xffe5a8 }));
    stripe.position.y = .235; float.add(stripe);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(.52, .42, .38), new THREE.MeshStandardMaterial({ color: 0xe8e3d4, roughness: .8, flatShading: true }));
    box.castShadow = true; float.add(box);
    const crossA = new THREE.Mesh(new THREE.BoxGeometry(.3, .1, .05), new THREE.MeshBasicMaterial({ color: 0x2fbe55 }));
    crossA.position.set(0, .03, .2); float.add(crossA);
    const crossB = new THREE.Mesh(new THREE.BoxGeometry(.1, .3, .05), new THREE.MeshBasicMaterial({ color: 0x2fbe55 }));
    crossB.position.set(0, .03, .2); float.add(crossB);
  }

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(2.2, 2.2, 1);
  glow.position.y = .85;
  group.add(glow);

  loots.push({ id: lootId++, type, weaponId, x, z, baseY: y, group, beamMat, ringMat, float, ring, glow, taken: false, phase: Math.random() * 6 });
}

function setActiveModel(id) {
  for (const k of WEAPON_ORDER) if (viewmodels[k]) viewmodels[k].root.visible = false;
  const vm = viewmodels[id];
  if (!vm) return;
  activeVM = vm;
  vm.root.visible = true;
  vm.flash.visible = false;
}

function updateStormVisual() {
  const r = Math.max(10, zone.radius);
  stormGroup.position.set(zone.x, 0, zone.z);
  stormWall.scale.set(r, 34, r);
  stormWall.position.y = 17;
  stormRing.scale.set(r, r, 1);
  stormRing.position.y = .8;
  stormTopRing.scale.set(r, r, 1);
  stormTopRing.position.y = 33.8;
  stormWall.material.opacity = .07 + Math.sin(elapsed * 1.4) * .012;
}

/* ============================================================
   INPUT
   ============================================================ */
function setupInput() {
  const canvas = renderer.domElement;

  window.addEventListener('keydown', e => {
    if (e.code === 'Escape') {
      if (ui.settingsOpen()) { closeSettings(); return; }
      if (state.mode === 'playing') { pauseGame(); return; }
      if (state.mode === 'paused') { resumeGame(); return; }
      return;
    }
    if (state.mode !== 'playing') return;
    if (['Space', 'ShiftLeft', 'ControlLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyE', 'KeyH', 'Digit1', 'Digit2', 'Digit3'].includes(e.code)) e.preventDefault();
    input.keys.add(e.code);
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyH') useMedkit();
    if (e.code === 'KeyC' || e.code === 'ControlLeft') input.crouch = !input.crouch;
    if (e.code === 'Space' && !player.airborne) {
      player.vy = 6.9; player.airborne = true;
    }
    if (e.code === 'Digit1') switchWeapon('ak');
    if (e.code === 'Digit2') switchWeapon('ump');
    if (e.code === 'Digit3') switchWeapon('awm');
  });
  window.addEventListener('keyup', e => {
    input.keys.delete(e.code);
  });

  document.addEventListener('mousemove', e => {
    if (state.mode !== 'playing' || document.pointerLockElement !== canvas) return;
    const mult = state.sensitivity * (input.ads ? state.adsSens : 1);
    yaw -= e.movementX * .0021 * mult;
    pitch -= e.movementY * .0021 * mult;
    pitch = clamp(pitch, -1.45, 1.45);
    state.lookSwayX = clamp(state.lookSwayX - e.movementX * .00045, -.035, .035);
    state.lookSwayY = clamp(state.lookSwayY - e.movementY * .00035, -.025, .025);
  });

  canvas.addEventListener('mousedown', e => {
    if (state.mode !== 'playing') return;
    if (!isTouch && document.pointerLockElement !== canvas) lockPointer();
    if (e.button === 0) { input.fire = true; input.firePressed = true; }
    if (e.button === 2) input.ads = true;
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) { input.fire = false; input.firePressed = false; }
    if (e.button === 2) input.ads = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => { if (e.button === 2) e.preventDefault(); }, { capture: true });

  // clicking canvas while unlocked re-locks
  canvas.addEventListener('pointerdown', () => {
    if (state.mode === 'playing' && !isTouch && document.pointerLockElement !== canvas) lockPointer();
  });

  document.addEventListener('pointerlockchange', () => {
    if (isTouch) return;
    const locked = document.pointerLockElement === canvas;
    if (!locked && state.mode === 'playing' && !state.suppressLock) pauseGame();
  });
  document.addEventListener('pointerlockerror', () => { /* fall back to click-drag is not needed on desktop */ });

  window.addEventListener('wheel', e => {
    if (state.mode !== 'playing') return;
    cycleWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  // Drag-look fallback when pointer lock is unavailable
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', e => {
    if (state.mode !== 'playing' || isTouch || document.pointerLockElement === canvas) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('pointermove', e => {
    if (!dragging || state.mode !== 'playing' || document.pointerLockElement === canvas) return;
    const mult = state.sensitivity * (input.ads ? state.adsSens : 1);
    yaw -= (e.clientX - lastX) * .0035 * mult;
    pitch -= (e.clientY - lastY) * .0035 * mult;
    pitch = clamp(pitch, -1.45, 1.45);
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('pointerup', () => { dragging = false; });
}

function setupTouch() {
  const joyZone = document.getElementById('joystick-zone');
  const knob = document.getElementById('joystick-knob');
  let joyId = null, joyCX = 0, joyCY = 0;
  joyZone.addEventListener('pointerdown', e => {
    if (state.mode !== 'playing') return;
    joyId = e.pointerId;
    const r = joyZone.getBoundingClientRect();
    joyCX = r.left + r.width / 2; joyCY = r.top + r.height / 2;
    input.joy.active = true;
    joyZone.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  joyZone.addEventListener('pointermove', e => {
    if (joyId !== e.pointerId) return;
    let dx = e.clientX - joyCX, dy = e.clientY - joyCY;
    const max = 48, d = Math.hypot(dx, dy);
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    input.joy.x = dx / max;
    input.joy.y = dy / max;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    e.preventDefault();
  });
  const endJoy = e => {
    if (e.pointerId !== joyId) return;
    joyId = null; input.joy.active = false; input.joy.x = 0; input.joy.y = 0;
    knob.style.transform = '';
  };
  joyZone.addEventListener('pointerup', endJoy);
  joyZone.addEventListener('pointercancel', endJoy);

  const look = document.getElementById('look-zone');
  look.addEventListener('pointerdown', e => {
    if (state.mode !== 'playing') return;
    input.look.active = true; input.look.id = e.pointerId;
    input.look.x = e.clientX; input.look.y = e.clientY;
    look.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  look.addEventListener('pointermove', e => {
    if (!input.look.active || e.pointerId !== input.look.id) return;
    const dx = e.clientX - input.look.x, dy = e.clientY - input.look.y;
    input.look.x = e.clientX; input.look.y = e.clientY;
    const mult = state.sensitivity * (input.ads ? state.adsSens : 1);
    yaw -= dx * .0042 * mult;
    pitch -= dy * .0042 * mult;
    pitch = clamp(pitch, -1.45, 1.45);
  });
  const endLook = e => { if (e.pointerId === input.look.id) input.look.active = false; };
  look.addEventListener('pointerup', endLook);
  look.addEventListener('pointercancel', endLook);

  const press = (id, down, up) => {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', e => { if (state.mode !== 'playing') return; e.preventDefault(); down(); });
    if (up) el.addEventListener('pointerup', e => { e.preventDefault(); up(); });
    el.addEventListener('pointercancel', () => { if (up) up(); });
  };
  press('touch-fire', () => { input.fire = true; input.firePressed = true; }, () => { input.fire = false; input.firePressed = false; });
  press('touch-aim', () => { input.ads = !input.ads; });
  press('touch-reload', () => startReload());
  press('touch-jump', () => { if (!player.airborne) { player.vy = 6.9; player.airborne = true; } });
  press('touch-crouch', () => { input.crouch = !input.crouch; });
  press('touch-heal', () => useMedkit());
  press('touch-interact', () => interact());
  document.getElementById('touch-swap').addEventListener('pointerdown', e => { e.preventDefault(); cycleWeapon(1); });
  document.getElementById('touch-pause').addEventListener('pointerdown', e => { e.preventDefault(); if (state.mode === 'playing') pauseGame(); });
  document.getElementById('touch-pause').addEventListener('click', e => { e.preventDefault(); if (state.mode === 'playing') pauseGame(); });
}

function setupUIEvents() {
  document.getElementById('start-btn').addEventListener('click', () => startMatch());
  document.getElementById('resume-btn').addEventListener('click', () => resumeGame());
  document.getElementById('pause-settings-btn').addEventListener('click', () => openSettings('pause'));
  document.getElementById('quit-btn').addEventListener('click', () => quitToLobby());
  document.getElementById('play-again-btn').addEventListener('click', () => startMatch());
  document.getElementById('end-lobby-btn').addEventListener('click', () => quitToLobby());
  document.getElementById('lobby-settings-btn').addEventListener('click', () => openSettings('lobby'));
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-done').addEventListener('click', closeSettings);
  document.getElementById('settings-modal').addEventListener('click', e => { if (e.target.id === 'settings-modal') closeSettings(); });

  ui.onSettings = s => {
    state.sensitivity = s.sensitivity;
    state.adsSens = s.adsSens;
    state.fov = s.fov;
    state.volume = s.volume;
    audio.setVolume(s.volume);
  };
  state.sensitivity = ui.settings.sensitivity;
  state.adsSens = ui.settings.adsSens;
  state.fov = ui.settings.fov;
  state.volume = ui.settings.volume;
}

function openSettings(from) {
  state.settingsReturn = from;
  ui.showSettings(true);
  ui.showPause(false);
}
function closeSettings() {
  ui.showSettings(false);
  if (state.settingsReturn === 'pause' && state.mode === 'paused') ui.showPause(true);
}
function closeOverlays() {
  ui.showSettings(false);
  ui.showPause(false);
}

function lockPointer() {
  if (isTouch) return;
  const el = renderer.domElement;
  if (document.pointerLockElement === el) return;
  try {
    const p = el.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch (_) { /* ignore */ }
}

/* ============================================================
   MATCH FLOW
   ============================================================ */
function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  input.fire = false; input.firePressed = false;
  ui.showPause(true);
  ui.showSettings(false);
  ui.hideInteract();
  ui.el.scope.classList.add('hidden');
  if (isTouch) ui.hideTouch(); else if (document.pointerLockElement) document.exitPointerLock();
  ui.setPauseStats(kills, damageDealt, aliveBots() + (player.alive ? 1 : 0));
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  state.suppressLock = true;
  closeOverlays();
  if (isTouch) ui.showTouch(); else lockPointer();
  lastFrame = performance.now();
  setTimeout(() => { state.suppressLock = false; }, 700);
}

function quitToLobby() {
  state.mode = 'lobby';
  state.ending = false;
  state.suppressLock = true;
  if (document.pointerLockElement) document.exitPointerLock();
  clearMatch();
  closeOverlays();
  ui.hideEnd();
  ui.showLobby();
  ui.hideTouch();
  stormGroup.visible = false;
  lobbyTime = 0;
  initLobbyCamera();
  setTimeout(() => { state.suppressLock = false; }, 700);
}

function onPlayerDeath() {
  if (state.ending) return;
  state.ending = true;
  state.mode = 'ending';
  input.fire = false; input.ads = false;
  ui.hideTouch();
  ui.hideInteract();
  ui.el.scope.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  audio.defeat();
  ui.addKill(state.lastKillName || 'THE STORM', 'YOU', false, false);
  const stats = buildStats(false, aliveBots() + 1);
  const myMatch = state.matchId;
  gameOverTimer = setTimeout(() => {
    if (state.matchId !== myMatch) return;
    ui.showEnd(false, stats);
  }, 1050);
}

function winMatch() {
  if (state.ending) return;
  state.ending = true;
  state.mode = 'ending';
  input.fire = false; input.ads = false;
  ui.hideTouch();
  ui.hideInteract();
  ui.el.scope.classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  audio.victory();
  const stats = buildStats(true, 1);
  const myMatch = state.matchId;
  gameOverTimer = setTimeout(() => {
    if (state.matchId !== myMatch) return;
    ui.showEnd(true, stats);
  }, 900);
}

function buildStats(win, placement) {
  return {
    win, placement,
    kills, damage: damageDealt, time: elapsed,
    alive: aliveBots() + (player.alive ? 1 : 0),
  };
}

function aliveBots() { return bots.reduce((n, b) => n + (b.alive ? 1 : 0), 0); }

function getPlacement() { return aliveBots() + 1; }

/* ============================================================
   GAME LOOP
   ============================================================ */
function loop(now) {
  const raw = (now - lastFrame) / 1000;
  lastFrame = now;
  const dt = Math.min(.05, Math.max(0, raw));

  if (state.mode === 'lobby') {
    lobbyTime += dt;
    world.update(dt);
    updateLobbyCamera(dt);
    if (sunTarget) { sunTarget.position.set(0, 0, 0); sunLight.position.set(-170, 250, 130); }
  } else if (state.mode === 'playing') {
    updateGame(dt);
  } else if (state.mode === 'paused') {
    world.update(dt * .08);
    updateStormVisual();
  } else if (state.mode === 'ending') {
    world.update(dt * .45);
    updateEffects(dt);
    updateStormVisual();
  }

  render();
  requestAnimationFrame(loop);
}

function updateLobbyCamera(dt) {
  if (activeVM) activeVM.root.visible = false;
  camera.fov += (58 - camera.fov) * (1 - Math.exp(-dt * 3));
  camera.updateProjectionMatrix();
  const a = .34 + lobbyTime * .017;
  const r = 438;
  const x = Math.sin(a) * r, z = Math.cos(a) * r;
  camera.position.set(x, 168 + Math.sin(lobbyTime * .35) * 9, z);
  camera.lookAt(-8, 22, 12);
  ui.updateCompass(((Math.atan2(-Math.sin(a), -Math.cos(a)) * 180 / Math.PI) + 360) % 360);
}

function render() {
  // Keep the sky dome centred on the viewer so it never clips against the far plane.
  if (world && world.sky) world.sky.position.copy(camera.position);
  renderer.clear();
  renderer.render(scene, camera);
  if (state.mode === 'playing' && activeVM && !(input.ads && activeId === 'awm')) {
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
}

/* ============================================================
   GAME UPDATE
   ============================================================ */
function updateGame(dt) {
  elapsed += dt;
  fireCooldown = Math.max(0, fireCooldown - dt);
  recoilPitch *= Math.exp(-dt * 9);
  state.lookSwayX *= Math.exp(-dt * 8);
  state.lookSwayY *= Math.exp(-dt * 8);
  weaponKick = Math.max(0, weaponKick - dt * 9);

  updatePlayer(dt);
  updateCamera(dt);
  camera.updateMatrixWorld();

  if (player.alive) {
    if (reloading) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) finishReload();
    }
    updateFiring(dt);
    updateLootInteraction(dt);
  }

  if (state.mode !== 'playing') return;

  updateZone(dt);
  updateBots(dt);
  updateLootAnimations(dt);
  updateEffects(dt);
  world.update(dt);
  updateStormVisual();
  updateSun(dt);
  ui.updateToast(dt);
  ui.updateKillfeed(dt);
  updateAimedBot(dt);
  updateViewmodel(dt);
  updateHUDState();

  if (player.alive && aliveBots() === 0 && !state.ending) winMatch();
}

function updatePlayer(dt) {
  if (!player.alive) return;
  const keys = input.keys;
  let ix = 0, iz = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
  if (input.joy.active) { ix = input.joy.x; iz = -input.joy.y; }
  const mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; }

  input.sprint = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && iz > .2 && !input.ads;
  const ads = input.ads && !input.sprint;
  const crouchTarget = (input.crouch || keys.has('ControlLeft')) ? 1 : 0;
  player.crouch += (crouchTarget - player.crouch) * (1 - Math.exp(-dt * 9));

  let speed = 5.2;
  if (input.sprint) speed = 8.3;
  if (player.crouch > .5) speed = 3.0;
  if (input.ads) speed = 3.1;
  if (!player.airborne && world.heightAt(player.position.x, player.position.z) < -.6) speed *= .55;

  const fwdx = -Math.sin(yaw), fwdz = -Math.cos(yaw);
  const rgtx = Math.cos(yaw), rgtz = -Math.sin(yaw);
  const desiredX = (fwdx * iz + rgtx * ix) * speed;
  const desiredZ = (fwdz * iz + rgtz * ix) * speed;
  const accel = player.airborne ? 4 : 14;
  velocity.x += (desiredX - velocity.x) * (1 - Math.exp(-dt * accel));
  velocity.z += (desiredZ - velocity.z) * (1 - Math.exp(-dt * accel));

  const nx = player.position.x + velocity.x * dt;
  const nz = player.position.z + velocity.z * dt;
  player.position.x = nx; player.position.z = nz;
  world.resolveCollision(player.position, .45);

  const ground = groundHeightAt(player.position.x, player.position.z);
  if (player.airborne) {
    player.vy -= 20 * dt;
    player.position.y += player.vy * dt;
    if (player.position.y <= ground) {
      player.position.y = ground; player.airborne = false; player.vy = 0;
    }
  } else {
    if (ground < player.position.y - .65) {
      player.airborne = true; player.vy = 0;
    } else {
      player.position.y = ground;
    }
  }

  const moving = Math.hypot(velocity.x, velocity.z);
  if (moving > .4 && !player.airborne) {
    walkPhase += dt * (input.sprint ? 12 : 8) * clamp(moving / 5, .3, 1.3);
    if (Math.floor(walkPhase / Math.PI) !== Math.floor((walkPhase - dt * 8) / Math.PI)) audio.step();
    player.bob = Math.sin(walkPhase) * (input.sprint ? .05 : .028);
  } else {
    player.bob *= Math.exp(-dt * 8);
  }
  if (input.ads) player.bob *= .3;
  if (player.airborne) player.bob = 0;
}

function updateCamera(dt) {
  const w = WEAPONS[activeId];
  const adsTarget = (input.ads && player.alive) ? 1 : 0;
  player.adsT = (player.adsT ?? 0) + (adsTarget - (player.adsT ?? 0)) * (1 - Math.exp(-dt * 13));
  const zoom = lerp(1, w.adsZoom, player.adsT);
  const targetFov = state.fov / zoom;
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-dt * 12));
  camera.updateProjectionMatrix();
  vmCamera.fov = camera.fov;
  vmCamera.updateProjectionMatrix();

  const eye = 1.67 - player.crouch * .48;
  camera.position.set(
    player.position.x,
    player.position.y + eye + player.bob,
    player.position.z
  );
  const swayRoll = Math.sin(walkPhase * .5) * .0025 * (input.ads ? .2 : 1);
  camera.rotation.set(pitch + recoilPitch, yaw, swayRoll);
  if (player.adsT > .72 && activeId === 'awm') {
    ui.el.scope.classList.remove('hidden');
  } else {
    ui.el.scope.classList.add('hidden');
  }
}

function updateFiring(dt) {
  const w = WEAPONS[activeId];
  const ammo = inventory[activeId];
  if (!ammo) return;
  if (reloading) return;
  if (input.fire && (w.auto || input.firePressed) && fireCooldown <= 0) {
    if (ammo.mag <= 0) {
      audio.empty();
      input.firePressed = false;
      startReload();
      return;
    }
    fireWeapon();
  }
  if (ammo.mag <= 0 && input.fire) startReload();
}

function fireWeapon() {
  const w = WEAPONS[activeId];
  const ammo = inventory[activeId];
  if (!ammo || ammo.mag <= 0) return;
  ammo.mag--;
  fireCooldown = 60 / w.rpm;
  shotsFired++;
  input.firePressed = false;
  recoilPitch += w.recoil * (player.adsT > .6 ? .0042 : .0072);
  weaponKick = 1;
  muzzleTimer = .05;
  if (activeVM) { activeVM.flash.visible = true; }
  audio.shot(w.sound);

  const origin = camera.position.clone();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const base = player.adsT > .55 ? w.adsSpread : w.spread;
  const move = Math.hypot(velocity.x, velocity.z) / 8;
  const spread = base + move * (player.adsT > .55 ? .002 : w.moveSpread) + (player.airborne ? .02 : 0);
  const angle = Math.sqrt(Math.random()) * spread;
  const theta = Math.random() * Math.PI * 2;
  const dir = forward.clone()
    .addScaledVector(right, Math.cos(theta) * angle)
    .addScaledVector(up, Math.sin(theta) * angle)
    .normalize();

  const maxDist = w.range;
  const wallDist = raycastWorldDistance(origin, dir, maxDist);
  let best = null;
  for (const bot of bots) {
    if (!bot.alive) continue;
    const hit = bot.rayHit({ origin, direction: dir });
    if (hit && hit.t < wallDist && (!best || hit.t < best.t)) best = { bot, ...hit };
  }

  let end;
  if (best) {
    let dmg = w.damage * (best.head ? w.head : best.limb ? w.limb : 1);
    const falloffStart = w.range * .55;
    if (best.t > falloffStart) dmg *= lerp(1, .7, clamp((best.t - falloffStart) / (w.range * .45), 0, 1));
    dmg = Math.max(1, Math.round(dmg));
    const killed = best.bot.takeDamage(dmg, player);
    shotsHit++;
    damageDealt += dmg;
    const labelPos = new THREE.Vector3(best.bot.position.x, best.bot.position.y + (best.head ? 1.86 : 1.25), best.bot.position.z);
    ui.popDamage(labelPos, dmg, killed ? 'kill' : best.head ? 'head' : 'hit', camera);
    ui.hitmarker(killed, best.head);
    audio.hit(best.head);
    end = origin.clone().addScaledVector(dir, best.t);
    if (killed) handleBotKilled(best.bot, 'YOU', best.head);
  } else {
    const d = Math.min(wallDist, maxDist);
    end = origin.clone().addScaledVector(dir, d);
    if (d < maxDist - .1) spawnImpact(end, 0xffd18a);
  }

  const muzzle = new THREE.Vector3(.13, -.08, -.6).applyMatrix4(camera.matrixWorld);
  addTracer(muzzle, end, activeId === 'awm' ? 0xfff2b0 : 0xffc15c, activeId === 'awm' ? .11 : .055);
  if (ammo.mag <= 0) setTimeout(() => { if (inventory[activeId] && inventory[activeId].mag === 0 && state.mode === 'playing') startReload(); }, 180);
}

function startReload() {
  if (state.mode !== 'playing' || !player.alive || reloading) return;
  const w = WEAPONS[activeId], ammo = inventory[activeId];
  if (!ammo || ammo.mag >= w.mag || ammo.reserve <= 0) return;
  reloading = true;
  reloadTimer = w.reload;
  audio.reload();
}

function finishReload() {
  const w = WEAPONS[activeId], ammo = inventory[activeId];
  if (!ammo) { reloading = false; return; }
  const need = w.mag - ammo.mag;
  const take = Math.min(need, ammo.reserve);
  ammo.mag += take; ammo.reserve -= take;
  reloading = false;
  reloadTimer = 0;
  ui.showToast(`${w.name} RELOADED`, .9);
}

function switchWeapon(id) {
  if (!inventory[id]) { ui.showToast('WEAPON NOT ACQUIRED', 1.1); return; }
  if (id === activeId) return;
  activeId = id;
  reloading = false; reloadTimer = 0;
  fireCooldown = .18;
  setActiveModel(id);
  ui.showToast(WEAPONS[id].name, .8);
}

function cycleWeapon(dir) {
  const owned = WEAPON_ORDER.filter(id => inventory[id]);
  if (owned.length <= 1) return;
  let i = owned.indexOf(activeId);
  i = (i + dir + owned.length) % owned.length;
  switchWeapon(owned[i]);
}

function useMedkit() {
  if (state.mode !== 'playing' || !player.alive) return;
  if (medkits <= 0) { ui.showToast('NO MEDKITS', 1); return; }
  if (player.health >= player.maxHealth) return;
  medkits--;
  player.health = Math.min(player.maxHealth, player.health + 60);
  audio.heal();
  ui.showToast('MEDKIT USED · +60 HP', 1.3);
}

/* ============================================================
   LOOT
   ============================================================ */
function updateLootInteraction(dt) {
  let nearest = null, nd = Infinity;
  for (const l of loots) {
    if (l.taken) continue;
    const d = dist(l.x, l.z, player.position.x, player.position.z);
    if (l.type !== 'weapon' && d < 1.65) { pickupLoot(l, true); continue; }
    if (l.type === 'weapon' && d < 3.15 && d < nd) { nd = d; nearest = l; }
  }
  state.nearLoot = nearest;
  if (nearest) {
    const w = WEAPONS[nearest.weaponId];
    const inv = inventory[nearest.weaponId];
    if (inv) ui.showInteract(`PICK UP ${w.name} AMMO`, `${w.className} · REFILL +${Math.ceil(w.reserve * .5)} ROUNDS`);
    else ui.showInteract(`PICK UP ${w.name}`, `${w.className} · ${w.mag} / ${w.reserve}`);
  } else {
    ui.hideInteract();
  }
}

function interact() {
  if (state.mode !== 'playing' || !player.alive) return;
  if (state.nearLoot && !state.nearLoot.taken) pickupLoot(state.nearLoot, false);
}

function pickupLoot(item, silent) {
  if (item.taken) return;
  item.taken = true;
  item.group.visible = false;
  if (item.type === 'weapon') {
    const w = WEAPONS[item.weaponId];
    if (!inventory[item.weaponId]) {
      inventory[item.weaponId] = { mag: w.mag, reserve: w.reserve };
      ui.showToast(`${w.name} ACQUIRED`, 1.6);
      switchWeapon(item.weaponId);
    } else {
      const add = Math.ceil(w.reserve * .5);
      inventory[item.weaponId].reserve = Math.min(w.reserve * 2, inventory[item.weaponId].reserve + add);
      ui.showToast(`${w.name} AMMO +${add}`, 1.2);
    }
    audio.pickup();
  } else if (item.type === 'ammo') {
    for (const id of WEAPON_ORDER) {
      if (!inventory[id]) continue;
      const w = WEAPONS[id];
      inventory[id].reserve = Math.min(w.reserve * 2, inventory[id].reserve + Math.ceil(w.reserve * .34));
    }
    audio.pickup();
    if (!silent) ui.showToast('AMMO RESUPPLIED', 1.1);
  } else if (item.type === 'med') {
    medkits = Math.min(3, medkits + 1);
    audio.pickup();
    if (!silent) ui.showToast('MEDKIT +1 · PRESS H TO HEAL', 1.4);
  }
  state.nearLoot = null;
  ui.hideInteract();
}

function updateLootAnimations(dt) {
  for (const l of loots) {
    if (l.taken) continue;
    l.float.position.y = 1.0 + Math.sin(elapsed * 2 + l.phase) * .12;
    l.float.rotation.y += dt * 1.15;
    l.ring.rotation.z += dt * .8;
    l.beamMat.opacity = .18 + Math.sin(elapsed * 2.2 + l.phase) * .07;
    l.glow.material.opacity = .38 + Math.sin(elapsed * 2 + l.phase) * .15;
  }
}

/* ============================================================
   ZONE
   ============================================================ */
function updateZone(dt) {
  const stage = ZONE_STAGES[zone.stage];
  if (zone.state === 'waiting') {
    zone.timer -= dt;
    if (zone.timer <= 0) {
      zone.state = 'shrinking';
      zone.from = zone.radius;
      zone.to = stage.radius;
      zone.duration = stage.shrink;
      zone.shrinkT = 0;
      zone.nextRadius = stage.radius;
      ui.showToast('SAFE ZONE IS SHRINKING', 1.6);
    }
    zone.dps = 2.5 + zone.stage * 2.2;
  } else if (zone.state === 'shrinking') {
    zone.shrinkT += dt;
    const t = clamp(zone.shrinkT / zone.duration, 0, 1);
    const eased = t * t * (3 - 2 * t);
    zone.radius = lerp(zone.from, zone.to, eased);
    zone.nextRadius = zone.to;
    zone.dps = 4 + zone.stage * 3;
    if (t >= 1) {
      zone.stage++;
      if (zone.stage < ZONE_STAGES.length) {
        zone.state = 'waiting';
        zone.timer = ZONE_STAGES[zone.stage].wait;
        zone.nextRadius = ZONE_STAGES[zone.stage].radius;
      } else {
        zone.state = 'final';
        zone.dps = 18;
        zone.nextRadius = zone.radius;
      }
    }
  } else {
    zone.dps = 18;
  }

  updateStormVisual();
  if (!player.alive) return;
  const d = dist(player.position.x, player.position.z, zone.x, zone.z);
  if (d > zone.radius) {
    player.stormAcc += zone.dps * dt;
    if (player.stormAcc >= 1) {
      const n = Math.floor(player.stormAcc);
      player.stormAcc -= n;
      player.takeDamage(n, null, 'STORM');
    }
  } else player.stormAcc = 0;
}

/* ============================================================
   BOTS
   ============================================================ */
const botGame = {
  player, bots, zone, audio,
  addTracer,
  onBotKilled: handleBotKilled,
};

function updateBots(dt) {
  botGame.bots = bots;
  botGame.zone = zone;
  for (const b of bots) b.update(dt, botGame);
}

function handleBotKilled(bot, killer, headshot) {
  // Bots mark themselves dead before this callback, so only guard against repeated calls
  if (bot._counted) return;
  bot._counted = true;
  if (killer === 'YOU') {
    kills++;
    ui.addKill('YOU', bot.name, headshot, true);
    audio.kill();
    ui.showToast(`${bot.name} ELIMINATED`, 1.1);
    if (state.aimedBot === bot) state.aimedBot = null;
  } else {
    ui.addKill(killer, bot.name, headshot, bot.name === 'YOU' || killer === 'YOU');
  }
  // Drop supplies where the bot fell
  const roll = Math.random();
  spawnLoot(bot.position.x + (Math.random() - .5) * 1.5, bot.position.z + (Math.random() - .5) * 1.5, roll < .55 ? 'ammo' : 'med');
  if (aliveBots() === 0 && player.alive && state.mode === 'playing') {
    setTimeout(() => { if (state.mode === 'playing') winMatch(); }, 500);
  }
}

/* ============================================================
   AIM / RAYS / EFFECTS
   ============================================================ */
function raycastWorldDistance(origin, dir, maxDist) {
  let nearest = maxDist;
  // terrain
  const step = 2.2;
  for (let d = step; d < nearest; d += step) {
    const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
    if (heightAt(x, z) > y) { nearest = d; break; }
  }
  // building boxes
  for (const c of world.colliders) {
    const t = rayAABB(origin, dir, c.minX, c.minY, c.minZ, c.maxX, c.maxY, c.maxZ);
    if (t > 0 && t < nearest) nearest = t;
  }
  return nearest;
}

function rayAABB(o, d, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [o.x, d.x, minX, maxX], [o.y, d.y, minY, maxY], [o.z, d.z, minZ, maxZ],
  ];
  for (const [oo, dd, mn, mx] of axes) {
    if (Math.abs(dd) < 1e-8) { if (oo < mn || oo > mx) return -1; continue; }
    let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin > 0 ? tmin : tmax > 0 ? tmax : -1;
}

function updateAimedBot(dt) {
  state.aimTimer -= dt;
  if (state.aimTimer > 0) return;
  state.aimTimer = .08;
  const origin = camera.position.clone();
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const wall = raycastWorldDistance(origin, dir, 700);
  let best = null;
  for (const bot of bots) {
    if (!bot.alive) continue;
    const hit = bot.rayHit({ origin, direction: dir });
    if (hit && hit.t < wall && (!best || hit.t < best.t)) best = { bot, t: hit.t };
  }
  state.aimedBot = best?.bot || null;
  state.aimedDist = best?.t || 0;
}

function addTracer(start, end, color = 0xffc15c, life = .07) {
  const geo = new THREE.BufferGeometry().setFromPoints([start.clone(), end.clone()]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: .95, depthWrite: false, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life, maxLife: life });
}

function spawnImpact(pos, color = 0xffd18a) {
  const mat = new THREE.SpriteMaterial({ map: sparkTexture, color, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending });
  const sp = new THREE.Sprite(mat);
  sp.position.copy(pos);
  sp.scale.set(.55, .55, 1);
  scene.add(sp);
  effects.push({ sprite: sp, life: .25, maxLife: .25 });
}

function updateEffects(dt) {
  for (const t of tracers) {
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / t.maxLife) * .95;
  }
  tracers = tracers.filter(t => {
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); return false; }
    return true;
  });
  for (const e of effects) {
    e.life -= dt;
    e.sprite.material.opacity = Math.max(0, e.life / e.maxLife) * .9;
    e.sprite.scale.multiplyScalar(1 + dt * 2.4);
  }
  effects = effects.filter(e => {
    if (e.life <= 0) { scene.remove(e.sprite); e.sprite.material.dispose(); return false; }
    return true;
  });
}

/* ============================================================
   VIEWMODEL
   ============================================================ */
function updateViewmodel(dt) {
  const vm = viewmodels[activeId];
  if (!vm) return;
  if (activeVM !== vm) setActiveModel(activeId);
  activeVM = vm;
  const scoped = input.ads && activeId === 'awm' && player.adsT > .7;
  vm.root.visible = !scoped;
  vm.flash.visible = muzzleTimer > 0;
  muzzleTimer = Math.max(0, muzzleTimer - dt);
  const ads = player.adsT;
  const hip = { x: .28, y: -.27, z: -.58 };
  const aim = activeId === 'awm' ? { x: .0, y: -.105, z: -.49 } : { x: .0, y: -.125, z: -.51 };
  const targetX = lerp(hip.x, aim.x, ads) + state.lookSwayX * (1 - ads * .6);
  const targetY = lerp(hip.y, aim.y, ads) + state.lookSwayY * (1 - ads * .6);
  const targetZ = lerp(hip.z, aim.z, ads);
  vm.root.position.x += (targetX - vm.root.position.x) * (1 - Math.exp(-dt * 16));
  vm.root.position.y += (targetY - vm.root.position.y) * (1 - Math.exp(-dt * 16));
  vm.root.position.z += (targetZ - vm.root.position.z) * (1 - Math.exp(-dt * 16));
  if (input.sprint && !input.ads) {
    vm.root.position.y -= .09;
    vm.root.rotation.z = lerp(vm.root.rotation.z, .15, 1 - Math.exp(-dt * 8));
  } else {
    vm.root.rotation.z = lerp(vm.root.rotation.z, -.015 + state.lookSwayX * .6, 1 - Math.exp(-dt * 10));
  }
  vm.root.rotation.x = lerp(vm.root.rotation.x, .02 + weaponKick * .12, 1 - Math.exp(-dt * 14));
  vm.root.rotation.y = lerp(vm.root.rotation.y, -.03 + (input.sprint && !input.ads ? .2 : 0), 1 - Math.exp(-dt * 8));
  vm.root.position.z += weaponKick * .07;
  if (input.sprint && !input.ads) vm.root.position.z += .05;
}

/* ============================================================
   HUD
   ============================================================ */
function updateHUDState() {
  const w = WEAPONS[activeId];
  const ammo = inventory[activeId] || { mag: 0, reserve: 0 };
  const outside = player.alive && dist(player.position.x, player.position.z, zone.x, zone.z) > zone.radius;
  const zoneState = zone.state === 'shrinking' ? 'shrinking' : zone.state === 'final' ? 'final' : 'waiting';
  let timer = '—';
  if (zone.state === 'waiting') timer = formatZoneTime(zone.timer);
  else if (zone.state === 'shrinking') timer = formatZoneTime(Math.max(0, zone.duration - zone.shrinkT));
  const moving = Math.hypot(velocity.x, velocity.z);
  const baseSpread = input.ads ? w.adsSpread : w.spread;
  const crosshair = clamp((baseSpread + moving / 8 * w.moveSpread + (player.airborne ? .025 : 0)) * 820, 3, 30);
  const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
  ui.updateCompass(heading);

  ui.updateHUD({
    health: player.health, maxHealth: player.maxHealth,
    weapon: w, mag: ammo.mag, reserve: ammo.reserve,
    inventory: { 1: !!inventory.ak, 2: !!inventory.ump, 3: !!inventory.awm },
    activeId: String(w.slot),
    medkits, alive: aliveBots() + (player.alive ? 1 : 0), kills,
    placement: getPlacement(),
    zoneState, zoneTimer: timer, outside, stormDps: zone.dps,
    ads: input.ads, crosshair, scoped: input.ads && activeId === 'awm' && player.adsT > .7,
    scopeRange: Math.round(state.aimedDist) || 0,
    reloading, reloadProgress: reloading ? clamp(1 - reloadTimer / WEAPONS[activeId].reload, 0, 1) : 0,
  });
  ui.updateLabels(bots, player, camera, state.aimedBot);
  ui.drawMinimap(player, bots, { x: zone.x, z: zone.z, radius: zone.radius, nextRadius: zone.nextRadius }, heading, world);
}

function updateSun(dt) {
  sunTarget.position.set(player.position.x, player.position.y, player.position.z);
  sunLight.position.set(player.position.x - 112, player.position.y + 190, player.position.z + 88);
  sunTarget.updateMatrixWorld();
}

function disposeGroup(group) {
  group.traverse(o => {
    // Materials are shared (weapon/viewmodel caches), so only release per-mesh geometry
    if (o.geometry) o.geometry.dispose();
  });
}


/* Debug surface for automated play-testing and capture */
window.__FZ = {
  state, player, input, get bots() { return bots; }, get loots() { return loots; }, get zone() { return zone; },
  get weapons() { return inventory; }, get activeId() { return activeId; },
  get camera() { return camera; }, get world() { return world; },
  get yaw() { return yaw; }, set yaw(v) { yaw = v; }, get pitch() { return pitch; }, set pitch(v) { pitch = v; },
  startMatch, pauseGame, resumeGame, quitToLobby, switchWeapon, useMedkit, interact,
  spawnLoot, updateHUDState,
  stats() { return { mode: state.mode, health: player.health, alive: player.alive, kills, damageDealt, botsAlive: aliveBots(), loots: loots.filter(l => !l.taken).length, zone: { ...zone }, pos: player.position.toArray() }; },
};
