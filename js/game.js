// FREEFALL — Island Ops
import * as THREE from './vendor/three.module.js'
import { createWorld, terrainHeight, makeGlowTexture } from './world.js'
import { AudioEngine } from './audio.js'

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp = (a, b, t) => a + (b - a) * t
const rand = (a, b) => a + Math.random() * (b - a)
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

// ───────────────────────────────────────────────────────────── renderer / scene
const canvas = $('#game')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
// Detect software rasterisers (SwiftShader / llvmpipe) so the game stays playable
// in CI, VMs and low-power devices instead of rendering millions of fill-rate heavy pixels.
let softwareRenderer = false, gpuName = ''
try {
  const gl = renderer.getContext()
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  gpuName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : ''
  softwareRenderer = /swiftshader|llvmpipe|software|microsoft basic|mesa offscreen/i.test(gpuName)
} catch (err) { /* renderer info unavailable */ }
const basePixelRatio = softwareRenderer ? 0.72 : Math.min(window.devicePixelRatio || 1, 1.5)
let currentPixelRatio = basePixelRatio
renderer.setPixelRatio(currentPixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = softwareRenderer ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.06
renderer.autoClear = false
renderer.setClearColor(0x9ab8c6, 1)
window.__FREEFALL_GPU__ = gpuName || 'unknown'
window.__FREEFALL_SOFTWARE__ = softwareRenderer
window.__FREEFALL_LOWEND__ = softwareRenderer

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 800)
camera.rotation.order = 'YXZ'
scene.add(camera)

const world = createWorld(scene)

// environment reflections
try {
  const envScene = new THREE.Scene()
  const envSky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x7da9c2, side: THREE.BackSide })
  )
  envScene.add(envSky)
  const envSun = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff0cf }))
  envSun.position.set(-25, 35, 24)
  envScene.add(envSun)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(envScene, 0.25).texture
  pmrem.dispose()
} catch (err) { console.warn('Environment map unavailable', err) }

// viewmodel scene
const viewScene = new THREE.Scene()
viewScene.environment = scene.environment
const viewCamera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 10)
viewScene.add(viewCamera)
viewScene.add(new THREE.HemisphereLight(0xe8f2ff, 0x2a2118, 1.4))
const vKey = new THREE.DirectionalLight(0xffd6a3, 2.8)
vKey.position.set(-1.4, 2.6, 2.2)
viewScene.add(vKey)
const vRim = new THREE.DirectionalLight(0x8fe9ff, 1.1)
vRim.position.set(2, 0.4, -2)
viewScene.add(vRim)

const audio = new AudioEngine()

// ──────────────────────────────────────────────────────────────── game state
const MODS = {
  hologram: false, silent: false, headshot: false, aimkill: false, aimbot: false,
  infinite: false, norecoil: false, tracers: true, damageNumbers: true,
  wireframe: false, noslow: false, god: false, slowmo: false
}
const settings = { sensitivity: 1, invertY: false, volume: 0.7, shadows: true }

const game = {
  phase: 'lobby', mode: 'solo', target: 20, running: false,
  kills: 0, headshots: 0, shots: 0, hits: 0, elapsed: 0, startTime: 0,
  zoneTime: 100, zoneRadius: 132, zoneTarget: 132, zoneCenter: new THREE.Vector2(0, 0), zoneShrinking: false,
  modOpen: false, fromLobbyMod: false, modWasRunning: false, everLocked: false,
  victory: false, resultShown: false, deployTimer: 0
}

const player = {
  pos: world.spawn.clone(),
  yaw: world.spawnYaw, pitch: -0.03,
  health: 100, armor: 50, stamina: 100,
  vy: 0, onGround: true, eye: 1.72, crouch: 0,
  recoilPitch: 0, recoilYaw: 0, shake: 0, adsT: 0,
  walkPhase: 0, moveSpeed: 0, sprinting: false, lastDamage: -99, damageTick: 0
}

const WEAPONS = [
  { id: 'rifle', name: 'VX-9 HAVOC', type: 'ASSAULT RIFLE', slot: 'VX-9', shortType: 'RIFLE', mag: 30, reserve: 180, rpm: 660, damage: 26, headMult: 2.55, spread: 0.018, adsSpread: 0.0045, recoil: 0.013, reloadTime: 1.95, range: 230, auto: true, sound: 'rifle' },
  { id: 'smg', name: 'HORNET MP-5', type: 'SUBMACHINE GUN', slot: 'HORNET', shortType: 'SMG', mag: 40, reserve: 240, rpm: 900, damage: 17, headMult: 2.2, spread: 0.027, adsSpread: 0.008, recoil: 0.008, reloadTime: 1.7, range: 140, auto: true, sound: 'smg' }
]
const weaponState = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserve }))
let weaponIndex = 0
let currentWeapon = WEAPONS[0]
let firing = false, aiming = false, triggerReady = 0, reloading = false, reloadEnd = 0, switching = 0

const enemies = []
const pickups = []
const effects = []
const tracers = []
const damageTexts = []
const colliderList = world.colliders

const keys = {}
const touch = { joyX: 0, joyY: 0, firing: false, aiming: false, active: false, lookId: null, lookX: 0, lookY: 0 }

const names = ['VIPER', 'KESTREL', 'GHOST', 'RAVEN', 'ONYX', 'SABLE', 'WRAITH', 'NOMAD', 'ECHO', 'HALO', 'CINDER', 'RIFT', 'TALON', 'VANTA', 'HEX', 'MACE', 'FROST', 'DAGGER', 'EMBER', 'SCOUT', 'AXIOM', 'NOVA', 'STRIDER', 'VIGIL']

// ─────────────────────────────────────────────────────────────── UI helpers
const ui = {
  hud: $('#hud'), lobby: $('#lobby'), modMenu: $('#modMenu'), settings: $('#settings'),
  pause: $('#pause'), result: $('#result'), deploy: $('#deploy'),
  healthBar: $('#healthBar'), healthVal: $('#healthVal'), armorBar: $('#armorBar'), armorVal: $('#armorVal'),
  staminaBar: $('#staminaBar'), staminaVal: $('#staminaVal'), ammoMag: $('#ammoMag'), ammoReserve: $('#ammoReserve'),
  ammoLine: $('.ammo-line'), ammoTicks: $('#ammoTicks'), weaponName: $('#weaponName'), weaponType: $('#weaponType'),
  crosshair: $('#crosshair'), hitmarker: $('.hitmarker'), targetLabel: $('#targetLabel'), modChips: $('#modChips'),
  objectiveText: $('#objectiveText'), objectiveSub: $('#objectiveSub'), aliveCount: $('#aliveCount'),
  killfeed: $('#killfeed'), zoneTimer: $('#zoneTimer'), zonePill: $('.zone-pill'), toast: $('#toast'),
  statusBanner: $('#statusBanner'), damageFlash: $('#damageFlash'), damageDir: $('#damageDir'), dmgLayer: $('#dmgLayer'),
  compass: $('#compass'), minimap: $('#minimap')
}

function toast(text, ms = 2000) {
  ui.toast.textContent = text
  ui.toast.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => ui.toast.classList.remove('show'), ms)
}

function banner(text, ms = 1800) {
  ui.statusBanner.textContent = text
  ui.statusBanner.classList.add('show')
  clearTimeout(banner._t)
  banner._t = setTimeout(() => ui.statusBanner.classList.remove('show'), ms)
}

// ─────────────────────────────────────────────────────────────── weapon models
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x2b2f2b, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.2 })
const gunDark = new THREE.MeshStandardMaterial({ color: 0x141715, metalness: 0.65, roughness: 0.55 })
const gunPoly = new THREE.MeshStandardMaterial({ color: 0x30372e, metalness: 0.2, roughness: 0.72 })
const gunAccent = new THREE.MeshStandardMaterial({ color: 0xff6b1c, emissive: 0x8d2c05, emissiveIntensity: 0.45, metalness: 0.4, roughness: 0.36 })
const gunGlass = new THREE.MeshBasicMaterial({ color: 0xffc07a })
const gloveMat = new THREE.MeshStandardMaterial({ color: 0x28302a, roughness: 0.86, metalness: 0.05 })

function addPart(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz)
  parent.add(m)
  return m
}
function boxMesh(parent, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  return addPart(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz)
}
function cylMesh(parent, r1, r2, h, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  return addPart(parent, new THREE.CylinderGeometry(r1, r2, h, 12), mat, x, y, z, rx, ry, rz)
}

const vmSkin = new THREE.MeshStandardMaterial({ color: 0x9c6f4e, roughness: 0.78, metalness: 0.02 })
const vmSleeve = new THREE.MeshStandardMaterial({ color: 0x39422f, roughness: 0.92 })
const vmSleeve2 = new THREE.MeshStandardMaterial({ color: 0x2c3327, roughness: 0.95 })

function buildRifle() {
  const g = new THREE.Group()
  // receiver, upper, handguard
  boxMesh(g, .135, .14, .44, gunMetal, 0, 0, -.12)
  boxMesh(g, .12, .1, .34, gunDark, 0, .008, -.5)
  boxMesh(g, .128, .05, .34, gunMetal, 0, .076, -.48)
  boxMesh(g, .11, .035, .4, gunMetal, 0, -.075, -.2)
  // barrel + brake
  addPart(g, new THREE.CylinderGeometry(.017, .017, .4, 10), gunDark, 0, .016, -.83, Math.PI / 2)
  addPart(g, new THREE.CylinderGeometry(.034, .034, .1, 10), gunMetal, 0, .016, -1.04, Math.PI / 2)
  boxMesh(g, .07, .075, .1, gunDark, 0, .016, -1.04)
  // stock with cheek riser
  boxMesh(g, .11, .12, .3, gunPoly, 0, -.005, .23)
  boxMesh(g, .1, .14, .09, gunDark, 0, -.015, .39)
  boxMesh(g, .08, .05, .16, gunDark, 0, .078, .2)
  boxMesh(g, .12, .03, .05, gunMetal, 0, -.075, .12)
  // magazine + grip
  boxMesh(g, .085, .2, .115, gunDark, 0, -.14, -.02, .16)
  boxMesh(g, .078, .23, .14, gunMetal, 0, -.165, -.23, .06)
  boxMesh(g, .082, .17, .1, gunDark, 0, -.13, .12, -.28)
  // top rail + optic
  for (let i = 0; i < 6; i++) boxMesh(g, .055, .018, .035, gunMetal, 0, .108, -.06 - i * .07)
  boxMesh(g, .06, .03, .11, gunDark, 0, .126, -.23)
  cylMesh(g, .034, .034, .16, gunDark, 0, .162, -.25, Math.PI / 2)
  addPart(g, new THREE.CircleGeometry(.026, 16), gunGlass, 0, .162, -.334, 0, Math.PI, 0)
  cylMesh(g, .04, .04, .03, gunMetal, 0, .162, -.158, Math.PI / 2)
  // accents + detailing
  boxMesh(g, .138, .018, .05, gunAccent, 0, -.045, -.31)
  boxMesh(g, .02, .028, .2, gunAccent, .068, .02, -.46)
  boxMesh(g, .03, .04, .1, gunMetal, -.075, .02, -.2)
  boxMesh(g, .05, .05, .05, gunMetal, .06, .05, .02)
  // hands
  boxMesh(g, .088, .115, .15, gloveMat, 0, -.12, .05, -.18)
  boxMesh(g, .095, .09, .16, gloveMat, 0, -.045, -.4, .06)
  // right forearm / sleeve reaching to lower-right of frame
  boxMesh(g, .092, .1, .34, vmSkin, .055, -.2, .22, .26, -.08, 0)
  boxMesh(g, .12, .13, .22, vmSleeve, .085, -.3, .38, .2, -.05, 0)
  boxMesh(g, .13, .14, .1, vmSleeve2, .1, -.36, .48, .1)
  // left forearm bracing the handguard
  boxMesh(g, .085, .09, .3, vmSkin, -.13, -.18, -.27, .12, .18, .25)
  boxMesh(g, .11, .12, .16, vmSleeve, -.2, -.25, -.16, .18, .2, .3)
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, .016, -1.1); g.add(muzzle)
  return { group: g, muzzle }
}
function buildSmg() {
  const g = new THREE.Group()
  boxMesh(g, .12, .125, .34, gunMetal, 0, 0, -.04)
  boxMesh(g, .1, .09, .22, gunDark, 0, .006, -.31)
  boxMesh(g, .105, .045, .3, gunMetal, 0, .068, -.28)
  addPart(g, new THREE.CylinderGeometry(.016, .016, .26, 9), gunDark, 0, .014, -.55, Math.PI / 2)
  addPart(g, new THREE.CylinderGeometry(.028, .028, .07, 9), gunMetal, 0, .014, -.67, Math.PI / 2)
  boxMesh(g, .075, .09, .2, gunPoly, 0, -.02, .17)
  boxMesh(g, .065, .065, .09, gunDark, 0, -.005, .29)
  boxMesh(g, .062, .24, .1, gunMetal, 0, -.17, -.11, .12)
  boxMesh(g, .07, .16, .085, gunDark, 0, -.13, .07, -.3)
  boxMesh(g, .085, .04, .1, gunDark, 0, -.055, -.2)
  boxMesh(g, .032, .036, .22, gunDark, 0, .092, -.24)
  cylMesh(g, .027, .027, .09, gunDark, 0, .128, -.22, Math.PI / 2)
  boxMesh(g, .02, .026, .16, gunAccent, -.064, .02, -.27)
  boxMesh(g, .085, .018, .05, gunAccent, 0, -.03, -.4)
  // hands + forearms
  boxMesh(g, .082, .1, .13, gloveMat, 0, -.115, .07, -.2)
  boxMesh(g, .09, .082, .15, gloveMat, 0, -.03, -.36, .05)
  boxMesh(g, .086, .095, .32, vmSkin, .05, -.19, .22, .28, -.1, 0)
  boxMesh(g, .115, .125, .2, vmSleeve, .08, -.28, .36, .2, -.06, 0)
  boxMesh(g, .13, .13, .1, vmSleeve2, .1, -.33, .45, .1)
  boxMesh(g, .08, .085, .28, vmSkin, -.12, -.16, -.25, .12, .16, .26)
  boxMesh(g, .105, .11, .15, vmSleeve, -.19, -.24, -.15, .16, .18, .3)
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, .014, -.72); g.add(muzzle)
  return { group: g, muzzle }
}

const rifleModel = buildRifle()
const smgModel = buildSmg()
const weaponRig = new THREE.Group()
rifleModel.group.scale.setScalar(.5)
smgModel.group.scale.setScalar(.5)
rifleModel.group.position.set(.30, -.27, -1.0)
smgModel.group.position.set(.30, -.26, -.96)
weaponRig.add(rifleModel.group, smgModel.group)
viewScene.add(weaponRig)

const glowTex = makeGlowTexture()
function makeFlashSprite(scale = .32) {
  const mat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc078, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
  const s = new THREE.Sprite(mat)
  s.scale.setScalar(scale)
  s.visible = false
  return s
}
const viewFlash = makeFlashSprite(.42)
rifleModel.muzzle.add(viewFlash)
const smgFlash = makeFlashSprite(.30)
smgModel.muzzle.add(smgFlash)
const worldFlash = makeFlashSprite(.34)
worldFlash.position.set(0, 0, 0)
scene.add(worldFlash)
const muzzleLight = new THREE.PointLight(0xffa450, 0, 12, 2)
scene.add(muzzleLight)

function currentModel() { return weaponIndex === 0 ? rifleModel : smgModel }
function currentFlash() { return weaponIndex === 0 ? viewFlash : smgFlash }

// ────────────────────────────────────────────────────────────── enemy factory
const ENEMY_PALETTES = [
  { shirt: 0x3f4a3a, pants: 0x2a3028, vest: 0x222a20, helmet: 0x2e362c },
  { shirt: 0x4d4a3b, pants: 0x333026, vest: 0x2b2c24, helmet: 0x3a3b30 },
  { shirt: 0x38434a, pants: 0x272e32, vest: 0x222a2e, helmet: 0x303940 },
  { shirt: 0x52412f, pants: 0x32291f, vest: 0x2d241b, helmet: 0x3b3125 }
]
const skinTones = [0xb58a68, 0x8f6748, 0xd0a47e, 0x6e4d36, 0x9e7452]

function labelTexture(name, elite = false) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 96
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, 320, 96)
  ctx.fillStyle = 'rgba(3,20,24,.72)'; ctx.fillRect(0, 20, 320, 54)
  ctx.strokeStyle = elite ? '#ff7a28' : '#48e8ff'; ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(320, 20); ctx.moveTo(0, 74); ctx.lineTo(320, 74); ctx.stroke()
  ctx.fillStyle = elite ? '#ffb06a' : '#8ff5ff'
  ctx.font = '700 27px Orbitron, sans-serif'; ctx.textAlign = 'left'
  ctx.fillText(name, 12, 57)
  ctx.font = '600 16px Rajdhani, sans-serif'; ctx.fillStyle = elite ? '#ffd0a5' : '#b9f8ff'
  ctx.textAlign = 'right'; ctx.fillText(elite ? 'ELITE' : 'HOSTILE', 310, 55)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Merge a list of coloured primitives into one vertex-coloured BufferGeometry.
// parts: [geo, colour, x, y, z, rx, ry, rz, sx, sy, sz]
function mergeColored(parts) {
  const pos = [], nor = [], uv = [], col = []
  const c = new THREE.Color(), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3()
  for (const [geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    e.set(rx, ry, rz); q.setFromEuler(e); v.set(x, y, z); s.set(sx, sy, sz)
    mtx.compose(v, q, s); g.applyMatrix4(mtx)
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv
    c.setHex(color)
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nor.push(n.getX(i), n.getY(i), n.getZ(i))
      if (t) uv.push(t.getX(i), t.getY(i)); else uv.push(0, 0)
      col.push(c.r, c.g, c.b)
    }
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  out.computeBoundingSphere()
  return out
}

const enemyGeoCache = new Map()
const enemyGunMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .72, roughness: .38 })
const enemyVisorGeo = new THREE.BoxGeometry(.24, .065, .05)
const enemyGeo = (pal, idx) => {
  if (enemyGeoCache.has(idx)) return enemyGeoCache.get(idx)
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d)
  const S = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs)
  const C = (r, h, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg)
  const skin = skinTones[idx % skinTones.length]
  const boot = 0x191b18, dark = 0x23271f, accent = 0xff6b1c
  const body = mergeColored([
    // pelvis / belt
    [B(.46, .2, .34), pal.pants, 0, .87, 0],
    [B(.5, .07, .36), dark, 0, .97, 0],
    // torso + plate carrier
    [B(.5, .5, .3), pal.shirt, 0, 1.2, 0],
    [B(.55, .4, .36), pal.vest, 0, 1.26, 0],
    [B(.47, .15, .34), pal.vest, 0, 1.02, 0],
    [B(.28, .07, .3), pal.vest, 0, 1.48, 0],
    // chest rig pouches + admin panel
    [B(.12, .14, .07), dark, -.17, 1.15, -.2],
    [B(.12, .14, .07), dark, .17, 1.15, -.2],
    [B(.11, .11, .06), dark, 0, 1.31, -.2],
    [B(.1, .04, .02), accent, -.16, 1.4, -.19],
    // backpack + straps
    [B(.33, .33, .15), dark, 0, 1.22, .23],
    [B(.05, .4, .02), dark, -.14, 1.22, -.18],
    [B(.05, .4, .02), dark, .14, 1.22, -.18],
    // shoulders
    [S(.135, 8, 6), pal.vest, -.34, 1.44, 0, 0, 0, 0, 1.15, .8, 1.2],
    [S(.135, 8, 6), pal.vest, .34, 1.44, 0, 0, 0, 0, 1.15, .8, 1.2],
    // neck + head
    [C(.072, .12), skin, 0, 1.51, 0],
    [S(.175, 12, 10), skin, 0, 1.67, -.005, 0, 0, 0, .92, 1.06, .96],
    [B(.17, .075, .15), skin, 0, 1.6, -.016],
    // helmet, brim, rails, headset
    [S(.215, 12, 7, 0, Math.PI * 2, 0, Math.PI * .58), pal.helmet, 0, 1.72, 0],
    [B(.38, .05, .35), pal.helmet, 0, 1.735, 0],
    [B(.035, .035, .28), dark, -.16, 1.78, .02],
    [B(.035, .035, .28), dark, .16, 1.78, .02],
    [B(.04, .09, .1), dark, -.2, 1.65, .01],
    [B(.04, .09, .1), dark, .2, 1.65, .01],
    [B(.03, .035, .12), dark, .1, 1.59, -.13]
  ])
  const leg = mergeColored([
    [B(.19, .41, .23), pal.pants, 0, -.19, 0],
    [B(.11, .16, .09), dark, .06, -.2, -.14],
    [B(.21, .13, .24), dark, 0, -.4, -.01],
    [B(.17, .4, .2), pal.pants, 0, -.61, 0],
    [B(.2, .16, .31), boot, 0, -.89, -.04],
    [B(.18, .1, .12), boot, 0, -.91, -.18]
  ])
  const arm = mergeColored([
    [B(.14, .28, .15), pal.shirt, 0, -.14, 0],
    [B(.145, .09, .16), dark, 0, -.29, 0],
    [B(.13, .26, .14), skin, 0, -.44, 0],
    [B(.15, .11, .16), gloveMat.color.getHex(), 0, -.6, 0]
  ])
  const gun = mergeColored([
    [B(.08, .11, .4), 0x242824, 0, 0, -.16],
    [B(.07, .08, .2), 0x30352f, 0, .005, -.36],
    [C(.017, .3), 0x161916, 0, .012, -.55, Math.PI / 2],
    [C(.031, .13), 0x111311, 0, .012, -.72, Math.PI / 2],
    [B(.07, .1, .2), 0x242824, 0, -.02, .15],
    [B(.06, .2, .085), 0x1b1e1b, 0, -.14, -.02, .12],
    [B(.05, .14, .07), 0x1b1e1b, 0, -.11, .09, -.26],
    [B(.055, .03, .12), 0x30352f, 0, .073, -.19],
    [C(.028, .09), 0x111311, 0, .105, -.19, Math.PI / 2],
    [B(.082, .018, .16), accent, 0, .014, -.31]
  ])
  const set = { body, leg, arm, gun }
  enemyGeoCache.set(idx, set)
  return set
}

function createEnemy(x, z, idx, elite = false) {
  const g = new THREE.Group()
  g.position.set(x, world.groundHeight(x, z), z)
  g.rotation.y = rand(-Math.PI, Math.PI)
  scene.add(g)

  const pal = ENEMY_PALETTES[idx % ENEMY_PALETTES.length]
  const geos = enemyGeo(pal, idx % ENEMY_PALETTES.length)
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .88, metalness: .07 })
  const visorMat = new THREE.MeshBasicMaterial({ color: elite ? 0xff7a1a : 0x69e8ff })
  const bodyMats = [bodyMat]

  const addMerged = (geo, mat = bodyMat, parent = g) => {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = true; m.receiveShadow = true
    parent.add(m)
    return m
  }
  addMerged(geos.body)
  const visor = addMerged(enemyVisorGeo, visorMat)
  visor.position.set(0, 1.69, -.175); visor.castShadow = false; visor.receiveShadow = false

  // legs
  const mkLeg = (s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * .145, .82, 0); g.add(pivot)
    addMerged(geos.leg, bodyMat, pivot)
    return pivot
  }
  const legL = mkLeg(-1), legR = mkLeg(1)
  // arms
  const mkArm = (s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * .34, 1.44, 0); g.add(pivot)
    addMerged(geos.arm, bodyMat, pivot)
    return pivot
  }
  const armL = mkArm(-1), armR = mkArm(1)
  armR.rotation.x = -.25
  // weapon
  const gun = new THREE.Group(); gun.position.set(.26, 1.29, -.36); g.add(gun)
  addMerged(geos.gun, enemyGunMat, gun)
  const flash = makeFlashSprite(.8)
  flash.position.set(.26, 1.32, -.78); g.add(flash)

  // hologram overlay
  const holoMat = new THREE.MeshBasicMaterial({ color: elite ? 0xff8b3a : 0x50eaff, wireframe: true, transparent: true, opacity: .55, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })
  const holo = new THREE.Group()
  const holoPart = (w, h, d, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), holoMat)
    m.position.set(px, py, pz); m.renderOrder = 120; m.frustumCulled = false; holo.add(m)
  }
  holoPart(.6, .68, .35, 0, 1.22, 0)
  const hh = new THREE.Mesh(new THREE.SphereGeometry(.21, 8, 6), holoMat); hh.position.set(0, 1.72, 0); hh.renderOrder = 120; hh.frustumCulled = false; holo.add(hh)
  holoPart(.22, .95, .24, -.15, .47, 0)
  holoPart(.22, .95, .24, .15, .47, 0)
  holoPart(.18, .7, .18, -.35, 1.16, 0)
  holoPart(.18, .7, .18, .35, 1.16, 0)
  holo.visible = false
  g.add(holo)

  // holo label
  const labelTex = labelTexture(names[idx % names.length], elite)
  const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
  const label = new THREE.Sprite(labelMat)
  label.scale.set(2.15, .64, 1)
  label.position.set(0, 2.35, 0)
  label.renderOrder = 121
  label.visible = false
  g.add(label)

  // health bar
  const hbCanvas = document.createElement('canvas'); hbCanvas.width = 128; hbCanvas.height = 16
  const hbTex = new THREE.CanvasTexture(hbCanvas)
  const hbMat = new THREE.SpriteMaterial({ map: hbTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
  const healthBar = new THREE.Sprite(hbMat)
  healthBar.scale.set(.86, .11, 1)
  healthBar.position.set(0, 2.08, 0)
  healthBar.visible = false
  healthBar.renderOrder = 50
  g.add(healthBar)
  const drawHealth = () => {
    const c = hbCanvas.getContext('2d'); c.clearRect(0, 0, 128, 16)
    c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(0, 0, 128, 16)
    c.fillStyle = elite ? '#ff7a1c' : '#9ee66c'; c.fillRect(2, 2, 124 * clamp(enemy.hp / enemy.maxHp, 0, 1), 12)
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1; c.strokeRect(1, 1, 126, 14)
    hbTex.needsUpdate = true
  }

  const name = names[idx % names.length]
  const enemy = {
    id: idx, name, elite, group: g, holo, holoMat, label, labelMat, labelTex, healthBar, drawHealth,
    hp: elite ? 170 : 100, maxHp: elite ? 170 : 100, dead: false, deathT: 0, removeAt: 0,
    pos: g.position, yaw: g.rotation.y, state: 'patrol', home: new THREE.Vector2(x, z),
    patrol: new THREE.Vector2(x, z), lastSeen: new THREE.Vector2(x, z), canSee: false,
    fireAt: performance.now() / 1000 + rand(.8, 2.4), burst: 0, flash: 0, hitT: 0,
    legL, legR, armL, armR, torso: g.children[0], bodyMats, gun, flashSprite: flash, anim: rand(0, 6),
    headWorld: new THREE.Vector3(), chestWorld: new THREE.Vector3(), speed: elite ? 3.5 : rand(2.4, 3.2),
    dmg: elite ? 9 : 6, movePhase: 0
  }
  drawHealth()
  enemies.push(enemy)
  return enemy
}

function enemyMuzzleWorld(e) {
  return new THREE.Vector3(.27, 1.34, -.8).applyMatrix4(e.group.matrixWorld)
}

function removeEnemy(e) {
  scene.remove(e.group)
  e.labelTex.dispose(); e.labelMat.dispose()
  const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1)
}

// ──────────────────────────────────────────────────────────────── pickups
function createPickup(x, z, kind = null) {
  const y = world.groundHeight(x, z) + 0.55
  const isHealth = kind ? kind === 'health' : Math.random() < .5
  const color = isHealth ? 0x8cf06a : 0xffb35e
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g)
  const geo = isHealth ? new THREE.OctahedronGeometry(.32, 0) : new THREE.BoxGeometry(.42, .42, .42)
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .7, roughness: .3, metalness: .25 })
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; g.add(mesh)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.52, .018, 6, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .7, blending: THREE.AdditiveBlending }))
  ring.rotation.x = Math.PI / 2; g.add(ring)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }))
  halo.scale.setScalar(1.5); g.add(halo)
  const p = { group: g, mesh, ring, kind: isHealth ? 'health' : 'ammo', alive: true, respawn: 0, baseY: y, phase: rand(0, 6) }
  pickups.push(p)
  return p
}

// ───────────────────────────────────────────────────────────── tracers & effects
const tracerGeo = new THREE.CylinderGeometry(.005, .005, 1, 4, 1, true)
for (let i = 0; i < 36; i++) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb168, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
  const m = new THREE.Mesh(tracerGeo, mat)
  m.visible = false; m.frustumCulled = false
  scene.add(m)
  tracers.push({ mesh: m, life: 0, max: .09 })
}
function spawnTracer(from, to, color = 0xffb168) {
  const t = tracers.find(x => x.life <= 0) || tracers[0]
  const dir = to.clone().sub(from)
  const len = dir.length()
  if (len < .01) return
  t.mesh.position.copy(from).addScaledVector(dir, .5)
  t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  t.mesh.scale.set(1, len, 1)
  t.mesh.material.color.setHex(color)
  t.mesh.material.opacity = .72
  t.mesh.visible = true
  t.life = .07; t.max = .07
}

function spawnImpact(point, color = 0xffc181) {
  const count = 10
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(count * 3)
  const vel = []
  for (let i = 0; i < count; i++) {
    pos[i * 3] = point.x; pos[i * 3 + 1] = point.y; pos[i * 3 + 2] = point.z
    vel.push(new THREE.Vector3(rand(-2.2, 2.2), rand(0.4, 3.2), rand(-2.2, 2.2)))
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ color, size: .085, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
  const pts = new THREE.Points(geo, mat)
  scene.add(pts)
  effects.push({ type: 'spark', obj: pts, vel, life: .5, max: .5, positions: pos, geo })
}
function spawnBlood(point) {
  spawnImpact(point, 0xff4326)
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i]
    e.life -= dt
    if (e.life <= 0) {
      scene.remove(e.obj)
      if (e.geo) e.geo.dispose()
      if (e.obj.material) e.obj.material.dispose()
      effects.splice(i, 1); continue
    }
    if (e.type === 'spark') {
      const arr = e.positions
      for (let j = 0; j < e.vel.length; j++) {
        e.vel[j].y -= 8 * dt
        arr[j * 3] += e.vel[j].x * dt
        arr[j * 3 + 1] += e.vel[j].y * dt
        arr[j * 3 + 2] += e.vel[j].z * dt
      }
      e.geo.attributes.position.needsUpdate = true
      e.obj.material.opacity = Math.max(0, e.life / e.max)
    }
  }
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * .72
      if (t.life <= 0) t.mesh.visible = false
    }
  }
}

// ─────────────────────────────────────────────────────────── world ray casting
function rayAABB(origin, dir, c, maxT) {
  let tmin = 0, tmax = maxT
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis]
    const d = dir[axis]
    const lo = c[axis] - (axis === 'x' ? c.hw : axis === 'z' ? c.hd : 0)
    const hi = c[axis] + (axis === 'x' ? c.hw : axis === 'z' ? c.hd : 0)
    const minY = c.minY, maxY = c.maxY
    const mn = axis === 'y' ? minY : lo
    const mx = axis === 'y' ? maxY : hi
    if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) return null; continue }
    let t1 = (mn - o) / d, t2 = (mx - o) / d
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  return tmin
}

function raycastWorld(origin, dir, maxT, ignoreTags = null) {
  let t = maxT
  for (const c of colliderList) {
    if (ignoreTags && ignoreTags.includes(c.tag)) continue
    const hit = rayAABB(origin, dir, c, t)
    if (hit !== null && hit > .02 && hit < t) t = hit
  }
  const step = 1.15
  for (let d = .8; d < Math.min(t, maxT); d += step) {
    const px = origin.x + dir.x * d, py = origin.y + dir.y * d, pz = origin.z + dir.z * d
    if (py < terrainHeight(px, pz)) { t = d; break }
  }
  return t < maxT ? { t, point: origin.clone().addScaledVector(dir, t) } : null
}

function segmentHitsAABB(a, b, c) {
  const dir = b.clone().sub(a)
  const len = dir.length()
  if (len < .0001) return false
  dir.divideScalar(len)
  const t = rayAABB(a, dir, c, len)
  return t !== null && t > .15 && t < len - .15
}

function hasLOS(a, b) {
  for (const c of colliderList) {
    if (segmentHitsAABB(a, b, c)) return false
  }
  const d = b.clone().sub(a)
  const len = d.length()
  if (len < .01) return true
  d.divideScalar(len)
  for (let t = 1; t < len; t += 2.5) {
    const p = a.clone().addScaledVector(d, t)
    if (p.y < terrainHeight(p.x, p.z) + .1) return false
  }
  return true
}

function raySphere(origin, dir, center, radius) {
  const oc = origin.clone().sub(center)
  const b = oc.dot(dir)
  const c = oc.dot(oc) - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  let t = -b - sq
  if (t < 0) t = -b + sq
  return t > 0 ? t : null
}

function enemyHitTest(origin, dir, maxT) {
  let best = null
  for (const e of enemies) {
    if (e.dead) continue
    const head = new THREE.Vector3(e.pos.x, e.pos.y + 1.71, e.pos.z)
    const chest = new THREE.Vector3(e.pos.x, e.pos.y + 1.24, e.pos.z)
    const hips = new THREE.Vector3(e.pos.x, e.pos.y + .85, e.pos.z)
    let t = raySphere(origin, dir, head, .23)
    let headHit = t !== null
    if (t === null) t = raySphere(origin, dir, chest, .36)
    if (t === null) t = raySphere(origin, dir, hips, .34)
    if (t !== null && t < maxT && (!best || t < best.t)) {
      best = { t, enemy: e, head: headHit, point: origin.clone().addScaledVector(dir, t) }
    }
  }
  return best
}

function traceShot(origin, dir, maxT) {
  const worldHit = raycastWorld(origin, dir, maxT)
  let tWorld = worldHit ? worldHit.t : maxT
  const eHit = enemyHitTest(origin, dir, tWorld)
  if (eHit) return { ...eHit, world: false }
  return { t: tWorld, point: origin.clone().addScaledVector(dir, tWorld), enemy: null, world: true }
}

// ───────────────────────────────────────────────────────────── target finding
function cameraDir() {
  const d = new THREE.Vector3()
  camera.getWorldDirection(d)
  return d
}

function syncAimCamera() {
  camera.position.copy(player.pos)
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw + player.recoilYaw, 0)
  camera.updateMatrixWorld(true)
}

function findTarget(maxFovDeg = 30, maxDist = 200, requireLOS = true) {
  const camPos = camera.position
  const fwd = cameraDir()
  let best = null, bestScore = Infinity
  for (const e of enemies) {
    if (e.dead) continue
    const point = new THREE.Vector3(e.pos.x, e.pos.y + (MODS.headshot ? 1.71 : 1.28), e.pos.z)
    const to = point.clone().sub(camPos)
    const dist = to.length()
    if (dist > maxDist) continue
    const angle = fwd.angleTo(to)
    if (angle > maxFovDeg * Math.PI / 180) continue
    if (requireLOS && !hasLOS(camPos, point)) continue
    const score = angle * 110 + dist * .03
    if (score < bestScore) { bestScore = score; best = { enemy: e, point, dist, angle } }
  }
  return best
}

// ──────────────────────────────────────────────────────────── weapon mechanics
function updateWeaponHud() {
  const w = currentWeapon
  ui.weaponName.textContent = w.name
  ui.weaponType.textContent = w.type
  ui.ammoMag.textContent = weaponState[weaponIndex].mag
  ui.ammoReserve.textContent = weaponState[weaponIndex].reserve
  ui.ammoLine.classList.toggle('low', weaponState[weaponIndex].mag <= Math.ceil(w.mag * .25))
  ui.ammoTicks.innerHTML = ''
  for (let i = 0; i < w.mag; i++) {
    const tick = document.createElement('i')
    if (i >= weaponState[weaponIndex].mag) tick.className = 'off'
    ui.ammoTicks.appendChild(tick)
  }
  $$('.wslot').forEach((el, i) => el.classList.toggle('active', i === weaponIndex))
}

function startReload() {
  if (reloading || game.phase !== 'playing') return
  const ws = weaponState[weaponIndex]
  if (ws.mag >= currentWeapon.mag || ws.reserve <= 0) return
  reloading = true
  reloadEnd = performance.now() / 1000 + currentWeapon.reloadTime
  audio.reload()
  toast('RELOADING — ' + currentWeapon.name, 900)
}

function finishReload() {
  const ws = weaponState[weaponIndex]
  const need = currentWeapon.mag - ws.mag
  const take = Math.min(need, ws.reserve)
  ws.mag += take
  if (!MODS.infinite) ws.reserve -= take
  reloading = false
  updateWeaponHud()
  audio.ui()
}

function switchWeapon(index) {
  if (index === weaponIndex || reloading) return
  if (index < 0 || index >= WEAPONS.length) return
  weaponIndex = index
  currentWeapon = WEAPONS[weaponIndex]
  reloading = false
  switching = .28
  rifleModel.group.visible = index === 0
  smgModel.group.visible = index === 1
  updateWeaponHud()
  audio.tone({ freq: 380, dur: .06, gain: .08, type: 'square' })
  banner(currentWeapon.name, 700)
}

function muzzleWorld() {
  const dir = cameraDir()
  const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize()
  return camera.position.clone().addScaledVector(right, .2).addScaledVector(dir, .65).add(new THREE.Vector3(0, -.14, 0))
}

function fireShot() {
  if (game.phase !== 'playing' || reloading || switching > 0) return
  syncAimCamera()
  const now = performance.now() / 1000
  if (now < triggerReady) return
  const ws = weaponState[weaponIndex]
  if (ws.mag <= 0) { audio.empty(); triggerReady = now + .28; if (ws.reserve > 0) startReload(); return }
  ws.mag--
  triggerReady = now + 60 / currentWeapon.rpm
  game.shots++

  const origin = camera.position.clone()
  const fwd = cameraDir()
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize()
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
  const spread = aiming ? currentWeapon.adsSpread : currentWeapon.spread
  const bloom = clamp(player.moveSpeed * .0015, 0, .01)
  let dir = fwd.clone()
  if (!aiming) {
    dir.addScaledVector(right, rand(-1, 1) * (spread + bloom))
    dir.addScaledVector(up, rand(-1, 1) * (spread + bloom))
    dir.normalize()
  } else {
    dir.addScaledVector(right, rand(-1, 1) * spread).addScaledVector(up, rand(-1, 1) * spread).normalize()
  }

  // silent aim redirects the projectile, not the camera
  let silentTarget = null
  if (MODS.silent) {
    silentTarget = findTarget(22, parseFloat($('#silentRange').value || '80'), true)
    if (silentTarget) {
      const aimPoint = new THREE.Vector3(silentTarget.enemy.pos.x, silentTarget.enemy.pos.y + (MODS.headshot ? 1.71 : 1.26), silentTarget.enemy.pos.z)
      dir = aimPoint.clone().sub(origin).normalize()
    }
  }

  const hit = traceShot(origin, dir, currentWeapon.range)
  const end = hit.point
  const shotFrom = muzzleWorld()
  spawnTracer(shotFrom, end, MODS.tracers ? 0xffb168 : 0xffffff)

  if (hit.enemy) {
    game.hits++
    let isHead = hit.head
    if (MODS.headshot) isHead = true
    let dmg = currentWeapon.damage * (isHead ? currentWeapon.headMult : 1)
    if (MODS.aimkill) dmg = 9999
    damageEnemy(hit.enemy, dmg, isHead, hit.point)
  } else if (hit.world) {
    spawnImpact(end, 0xffc181)
  }

  // recoil & feedback
  if (!MODS.norecoil) {
    player.recoilPitch += currentWeapon.recoil * (aiming ? .55 : 1)
    player.recoilYaw += rand(-1, 1) * currentWeapon.recoil * .45
    player.shake = Math.max(player.shake, .035)
  }
  flashMuzzle()
  audio.shot(currentWeapon.sound)
  updateWeaponHud()
  if (ws.mag === 0) setTimeout(() => { if (game.phase === 'playing') startReload() }, 180)
}

function flashMuzzle() {
  const f = currentFlash()
  f.visible = true
  f.material.opacity = 1
  f.material.rotation = rand(0, 6.28)
  clearTimeout(flashMuzzle._t)
  flashMuzzle._t = setTimeout(() => { f.visible = false }, 45)
  const local = new THREE.Vector3(0, 0, 0)
  currentModel().muzzle.getWorldPosition(local)
  // map viewmodel muzzle to a point near the camera for world lighting
  const p = camera.position.clone().addScaledVector(cameraDir(), 1.25)
  muzzleLight.position.copy(p)
  muzzleLight.intensity = 9
  worldFlash.position.copy(p)
  worldFlash.visible = true
  worldFlash.material.opacity = .9
  setTimeout(() => { muzzleLight.intensity = 0; worldFlash.visible = false }, 55)
}

function damageEnemy(enemy, dmg, head, point) {
  if (enemy.dead) return
  enemy.hp -= dmg
  enemy.flash = .12
  enemy.state = 'combat'
  enemy.lastSeen.set(player.pos.x, player.pos.z)
  enemy.drawHealth()
  enemy.healthBar.visible = true
  enemy.healthBar.material.opacity = 1
  audio.hit(head)
  showHitmarker(false)
  if (MODS.damageNumbers) {
    addDamageText(point, MODS.aimkill ? 'KILL' : Math.round(dmg), head ? 'head' : '')
  }
  if (enemy.hp <= 0) {
    killEnemy(enemy, head)
  } else if (head) {
    showHitmarker(true)
  }
}

function killEnemy(enemy, head) {
  if (enemy.dead) return
  enemy.dead = true
  enemy.deathT = 0
  enemy.deathBaseY = enemy.pos.y
  enemy.holo.visible = false
  enemy.label.visible = false
  enemy.healthBar.visible = false
  enemy.flashSprite.visible = false
  game.kills++
  if (head) game.headshots++
  audio.kill()
  showHitmarker(true, true)
  addKillfeed(enemy.name, head)
  banner(head ? 'HEADSHOT ELIMINATION' : 'HOSTILE ELIMINATED', 900)
  spawnBlood(new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.2, enemy.pos.z))
  // drop
  if (Math.random() < .38) {
    const p = createPickup(enemy.pos.x + rand(-.8, .8), enemy.pos.z + rand(-.8, .8), Math.random() < .45 ? 'health' : 'ammo')
    p.respawn = 0
  }
  updateAliveCount()
  if (game.mode === 'solo' && game.kills >= game.target) {
    setTimeout(() => victory(), 900)
  } else if (game.mode === 'training') {
    setTimeout(() => spawnTrainingWave(1), 3500)
  }
}

function showHitmarker(head = false, kill = false) {
  const hm = ui.hitmarker
  hm.classList.remove('show', 'kill')
  void hm.offsetWidth
  hm.classList.add('show')
  if (kill) hm.classList.add('kill')
}

function addKillfeed(name, head) {
  const el = document.createElement('div')
  el.className = 'kf-item'
  el.innerHTML = `<b>RONIN</b> <i>▸</i> ${name}${head ? ' <span class="hs">HEADSHOT</span>' : ''}`
  ui.killfeed.appendChild(el)
  while (ui.killfeed.children.length > 5) ui.killfeed.firstChild.remove()
  setTimeout(() => el.remove(), 6500)
}

function addDamageText(pos, text, cls = '') {
  const v = pos.clone().project(camera)
  if (v.z > 1 || v.z < -1) return
  const el = document.createElement('div')
  el.className = 'dmg-num ' + cls
  el.textContent = text
  el.style.left = ((v.x * .5 + .5) * window.innerWidth + rand(-7, 7)) + 'px'
  el.style.top = ((-v.y * .5 + .5) * window.innerHeight + rand(-5, 5)) + 'px'
  ui.dmgLayer.appendChild(el)
  setTimeout(() => el.remove(), 780)
}

function damagePlayer(amount, sourcePos, enemy = null) {
  if (game.phase !== 'playing') return
  if (MODS.god) {
    ui.damageFlash.classList.add('show')
    setTimeout(() => ui.damageFlash.classList.remove('show'), 80)
    return
  }
  let dmg = amount
  if (player.armor > 0) {
    const absorb = Math.min(player.armor, dmg * .62)
    player.armor -= absorb; dmg -= absorb
  }
  player.health -= dmg
  player.lastDamage = game.elapsed
  audio.hurt()
  player.shake = Math.max(player.shake, .2)
  ui.damageFlash.classList.add('show')
  clearTimeout(damagePlayer._t)
  damagePlayer._t = setTimeout(() => ui.damageFlash.classList.remove('show'), 260)
  if (sourcePos) {
    const dir = sourcePos.clone().sub(player.pos)
    const angle = Math.atan2(-dir.x, -dir.z) - player.yaw
    ui.damageDir.style.transform = `rotate(${angle}rad)`
    ui.damageDir.classList.add('show')
    clearTimeout(damagePlayer._d)
    damagePlayer._d = setTimeout(() => ui.damageDir.classList.remove('show'), 500)
  }
  if (player.health <= 0) {
    if (game.mode === 'training') {
      player.health = 0
      setTimeout(() => respawnTraining(), 1000)
    } else {
      defeat()
    }
  }
  refreshHealth()
}

function refreshHealth() {
  ui.healthBar.style.width = clamp(player.health, 0, 100) + '%'
  ui.healthVal.textContent = Math.max(0, Math.round(player.health))
  ui.armorBar.style.width = clamp(player.armor, 0, 50) / 50 * 100 + '%'
  ui.armorVal.textContent = Math.max(0, Math.round(player.armor))
  ui.staminaBar.style.width = clamp(player.stamina, 0, 100) + '%'
  ui.staminaVal.textContent = Math.round(player.stamina)
}

// ────────────────────────────────────────────────────────────────── spawning
function distToPlayer(x, z) { return Math.hypot(x - player.pos.x, z - player.pos.z) }

function validSpawnPoint(x, z) {
  const h = terrainHeight(x, z)
  if (h < .6) return false
  for (const c of colliderList) {
    if (Math.abs(x - c.x) < c.hw + .9 && Math.abs(z - c.z) < c.hd + .9) return false
  }
  return true
}

function spawnInitialEnemies() {
  const spots = [...world.enemySpawns].sort(() => Math.random() - .5)
  let made = 0
  const wanted = 24
  for (let attempt = 0; attempt < 120 && made < wanted; attempt++) {
    const base = spots[attempt % spots.length]
    const x = base[0] + rand(-4, 4), z = base[1] + rand(-4, 4)
    if (!validSpawnPoint(x, z)) continue
    if (distToPlayer(x, z) < 20) continue
    if (enemies.some(e => e.pos.distanceTo(new THREE.Vector3(x, 0, z)) < 3.5)) continue
    createEnemy(x, z, made, made % 9 === 4)
    made++
  }
  // ensure enough targets
  let guard = 0
  while (made < wanted && guard++ < 400) {
    const a = Math.random() * Math.PI * 2, r = rand(30, 86)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!validSpawnPoint(x, z) || distToPlayer(x, z) < 20) continue
    createEnemy(x, z, made, made % 9 === 4)
    made++
  }
  updateAliveCount()
}

function spawnTrainingWave(n = 1) {
  if (game.phase !== 'playing' || game.mode !== 'training') return
  for (let i = 0; i < n; i++) {
    let x, z, ok = false
    for (let t = 0; t < 30; t++) {
      const a = Math.random() * Math.PI * 2, r = rand(28, 82)
      x = Math.cos(a) * r; z = Math.sin(a) * r
      if (validSpawnPoint(x, z) && distToPlayer(x, z) > 24) { ok = true; break }
    }
    if (ok) createEnemy(x, z, Math.floor(Math.random() * 100), Math.random() < .14)
  }
  updateAliveCount()
}

function spawnPickups() {
  for (const p of world.pickupSpots) if (distToPlayer(p[0], p[2]) > 9) createPickup(p[0], p[2], null)
  // add extra supply points around the island
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, r = rand(25, 90)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (validSpawnPoint(x, z)) createPickup(x, z, null)
  }
}

function updateAliveCount() {
  const n = enemies.filter(e => !e.dead).length
  ui.aliveCount.textContent = String(n).padStart(2, '0')
}

// ─────────────────────────────────────────────────────────────── enemy update
function enemyTryMove(e, dx, dz) {
  const nx = e.pos.x + dx, nz = e.pos.z + dz
  if (Math.hypot(nx, nz) > 106) return false
  for (const c of colliderList) {
    if (e.pos.y + 1.6 < c.minY || e.pos.y > c.maxY - .05) continue
    if (Math.abs(nx - c.x) < c.hw + .42 && Math.abs(nz - c.z) < c.hd + .42) return false
  }
  e.pos.x = nx; e.pos.z = nz
  return true
}

function updateEnemy(e, dt) {
  if (e.dead) {
    e.deathT += dt
    const fall = clamp(e.deathT / .55, 0, 1)
    e.group.rotation.x = -Math.PI / 2 * fall
    e.group.position.y = (e.deathBaseY ?? e.pos.y) - Math.max(0, e.deathT - 2.6) * .22
    if (!e.removeAt) e.removeAt = game.elapsed + 5.5
    if (game.elapsed > e.removeAt) { removeEnemy(e); updateAliveCount() }
    return
  }

  const px = player.pos.x, pz = player.pos.z
  const dist = Math.hypot(px - e.pos.x, pz - e.pos.z)
  const eye = new THREE.Vector3(e.pos.x, e.pos.y + 1.55, e.pos.z)
  const chest = new THREE.Vector3(px, player.pos.y - .25, pz)
  const nowSec = performance.now() / 1000
  if (dist < 68) {
    if (nowSec >= (e.losAt || 0)) {
      e.canSee = hasLOS(eye, chest)
      e.losAt = nowSec + .16
    }
  } else e.canSee = false
  const los = e.canSee && game.elapsed > 2.0
  if (los) {
    e.lastSeen.set(px, pz)
    if (e.state === 'patrol') e.state = 'alert'
    e.alertT = (e.alertT || 0) + dt
    if (e.state !== 'combat' && e.alertT > .35) {
      e.state = 'combat'
      e.fireAt = Math.max(e.fireAt, nowSec + rand(1.2, 2.2))
    }
  } else {
    e.alertT = 0
    if (e.state === 'combat') e.state = 'search'
  }

  let moveX = 0, moveZ = 0, moving = false
  if (e.state === 'combat') {
    const desired = e.elite ? 12 : 15
    if (dist > desired + 4) { moveX = (px - e.pos.x) / dist; moveZ = (pz - e.pos.z) / dist; moving = true }
    else if (dist < desired - 3) { moveX = (e.pos.x - px) / dist; moveZ = (e.pos.z - pz) / dist; moving = true }
    else {
      // strafe around the player
      const side = (e.id % 2 ? 1 : -1)
      moveX = -(pz - e.pos.z) / (dist || 1) * side * .6
      moveZ = (px - e.pos.x) / (dist || 1) * side * .6
      moving = true
    }
  } else if (e.state === 'search' || e.state === 'alert') {
    const dx = e.lastSeen.x - e.pos.x, dz = e.lastSeen.y - e.pos.z
    const d = Math.hypot(dx, dz)
    if (d > 2.5) { moveX = dx / d; moveZ = dz / d; moving = true }
    else { e.state = 'patrol'; e.patrol.set(e.home.x + rand(-12, 12), e.home.y + rand(-12, 12)) }
  } else {
    const dx = e.patrol.x - e.pos.x, dz = e.patrol.y - e.pos.z
    const d = Math.hypot(dx, dz)
    if (d < 1.2) {
      e.patrol.set(e.home.x + rand(-14, 14), e.home.y + rand(-14, 14))
    } else {
      moveX = dx / d; moveZ = dz / d; moving = true
      e.movePhase += dt * .8
    }
  }

  if (moving) {
    const spd = e.speed * (e.state === 'combat' ? 1 : .55)
    let stepX = moveX * spd * dt, stepZ = moveZ * spd * dt
    if (!enemyTryMove(e, stepX, stepZ)) {
      const a = rand(-1.4, 1.4)
      const sx = stepX * Math.cos(a) - stepZ * Math.sin(a)
      const sz = stepX * Math.sin(a) + stepZ * Math.cos(a)
      if (!enemyTryMove(e, sx, sz)) enemyTryMove(e, -stepZ, stepX)
    }
    if (e.state === 'patrol') e.movePhase += dt * 6
  }

  const ground = world.groundHeight(e.pos.x, e.pos.z)
  e.pos.y = lerp(e.pos.y, Math.max(.15, ground), clamp(dt * 8, 0, 1))

  // face the player or movement direction
  let targetYaw = e.yaw
  if (los || e.state === 'combat') targetYaw = Math.atan2(-(px - e.pos.x), -(pz - e.pos.z))
  else if (moving) targetYaw = Math.atan2(-moveX, -moveZ)
  e.yaw = e.yaw + angleDelta(e.yaw, targetYaw) * clamp(dt * 5, 0, 1)
  e.group.rotation.y = e.yaw

  // animation
  const animSpeed = moving ? (e.state === 'combat' ? 8 : 5) : 1.5
  e.anim += dt * animSpeed
  const legSwing = moving ? Math.sin(e.anim) * .55 : Math.sin(e.anim * .7) * .03
  e.legL.rotation.x = legSwing
  e.legR.rotation.x = -legSwing
  if (los || e.state === 'combat') {
    e.armL.rotation.x = lerp(e.armL.rotation.x, -1.02, dt * 7)
    e.armR.rotation.x = lerp(e.armR.rotation.x, -1.18, dt * 7)
  } else {
    e.armL.rotation.x = lerp(e.armL.rotation.x, -legSwing * .5, dt * 5)
    e.armR.rotation.x = lerp(e.armR.rotation.x, legSwing * .5, dt * 5)
  }

  // hit flash
  if (e.flash > 0) {
    e.flash -= dt
    for (const m of e.bodyMats) { m.emissive.setHex(0x7a1305); m.emissiveIntensity = e.flash * 7 }
  } else {
    for (const m of e.bodyMats) { m.emissive.setHex(0x000000); m.emissiveIntensity = 0 }
  }

  // shooting
  if (los && (e.state === 'combat' || e.state === 'alert') && dist < 60 && game.phase === 'playing') {
    if (nowSec >= e.fireAt) {
      enemyShoot(e, dist)
      e.fireAt = nowSec + (e.elite ? rand(.8, 1.35) : rand(1.15, 2.1))
      e.burst = e.elite ? 3 : 1
    }
  }

  // holo labels
  if (MODS.hologram) {
    e.holo.visible = true
    e.label.visible = true
    e.holoMat.opacity = .42 + Math.sin(performance.now() * .004 + e.id) * .12
    e.label.position.y = 2.35 + Math.sin(performance.now() * .002 + e.id) * .025
  } else {
    e.holo.visible = false
    e.label.visible = false
  }
  if (e.healthBar.visible && e.hp < e.maxHp && !MODS.hologram) {
    // fade after a moment
    e.healthBar.material.opacity = Math.max(0, e.healthBar.material.opacity - dt * .32)
    if (e.healthBar.material.opacity <= 0) e.healthBar.visible = false
  }
}

function enemyShoot(e, dist) {
  const eye = new THREE.Vector3(e.pos.x, e.pos.y + 1.48, e.pos.z)
  const target = new THREE.Vector3(player.pos.x + rand(-.2, .2), player.pos.y - rand(.15, .55), player.pos.z + rand(-.2, .2))
  const hitChance = clamp(.62 - dist * .006 - (player.sprinting ? .12 : 0) - (player.crouch > .5 ? .08 : 0), .14, .55)
  const hit = Math.random() < hitChance
  let end = target.clone()
  let from = enemyMuzzleWorld(e)
  if (!hit) end.add(new THREE.Vector3(rand(-2.4, 2.4), rand(-.5, 2.2), rand(-2.4, 2.4)))
  if (hit && hasLOS(eye, target)) {
    damagePlayer(e.dmg * rand(.85, 1.2), eye, e)
  }
  spawnTracer(from, end, 0xff5a1f)
  e.flashSprite.visible = true
  setTimeout(() => { e.flashSprite.visible = false }, 55)
  audio.enemyShot(dist)
  // small chance to suppress
  if (!hit) ui.damageDir.classList.add('show')
  setTimeout(() => ui.damageDir.classList.remove('show'), 120)
}

// ───────────────────────────────────────────────────────────── player movement
function circleBlocked(x, z, feetY, radius = .36) {
  for (const c of colliderList) {
    if (feetY + 1.6 < c.minY || feetY > c.maxY - .05) continue
    if (Math.abs(x - c.x) < c.hw + radius && Math.abs(z - c.z) < c.hd + radius) return true
  }
  return false
}

function updatePlayer(dt) {
  if (game.phase !== 'playing') return
  if (reloading && performance.now() / 1000 >= reloadEnd) finishReload()
  if (switching > 0) switching = Math.max(0, switching - dt)

  const forwardInput = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + (touch.active ? -touch.joyY : 0)
  const rightInput = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + (touch.active ? touch.joyX : 0)
  let mx = clamp(forwardInput, -1, 1), mz = clamp(rightInput, -1, 1)
  const inputLen = Math.hypot(mx, mz)
  if (inputLen > 1) { mx /= inputLen; mz /= inputLen }

  const wantSprint = (keys.ShiftLeft || keys.ShiftRight) && mx > .2 && !aiming && player.stamina > 1
  player.crouch = lerp(player.crouch, keys.ControlLeft || keys.KeyC ? 1 : 0, clamp(dt * 9, 0, 1))
  player.sprinting = wantSprint && !MODS.noslow ? true : (wantSprint && MODS.noslow)
  let speed = 5.6
  if (player.sprinting) speed = MODS.noslow ? 9.5 : 8.5
  if (aiming) speed *= .58
  if (player.crouch > .5) speed *= .55
  if (reloading) speed *= .9

  if (player.sprinting) player.stamina = Math.max(0, player.stamina - dt * 17)
  else player.stamina = Math.min(100, player.stamina + dt * (MODS.noslow ? 40 : 11))
  if (player.stamina <= 0) player.sprinting = false

  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw)
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw)
  const wishX = (fx * mx + rx * mz) * speed
  const wishZ = (fz * mx + rz * mz) * speed

  const accel = player.onGround ? 14 : 4.5
  const vx = lerp(player._vx || 0, wishX, clamp(accel * dt, 0, 1))
  const vz = lerp(player._vz || 0, wishZ, clamp(accel * dt, 0, 1))
  player._vx = vx; player._vz = vz
  player.moveSpeed = Math.hypot(vx, vz)

  const feet = player.pos.y - player.eye
  // XZ movement with wall sliding
  const nx = player.pos.x + vx * dt
  if (!circleBlocked(nx, player.pos.z, feet)) player.pos.x = nx
  const nz = player.pos.z + vz * dt
  if (!circleBlocked(player.pos.x, nz, feet)) player.pos.z = nz
  world.clampPosition(player.pos)

  // jump / gravity
  const groundEye = world.groundHeight(player.pos.x, player.pos.z) + player.eye - player.crouch * .55
  if ((keys.Space || touch.jump) && player.onGround) {
    player.vy = 6.1; player.onGround = false
    if (touch.jump) touch.jump = false
    audio.step()
  }
  player.vy -= 18 * dt
  player.pos.y += player.vy * dt
  if (player.pos.y <= groundEye) {
    player.pos.y = groundEye
    player.vy = 0
    player.onGround = true
  }
  if (player.pos.y > groundEye + .05) player.onGround = false

  // footsteps and bob
  if (player.onGround && player.moveSpeed > .8) {
    player.walkPhase += dt * player.moveSpeed * 1.25
    if (Math.sin(player.walkPhase) < -.85) audio.step()
  }
  player.bob = Math.sin(player.walkPhase) * (player.sprinting ? .045 : .028) * clamp(player.moveSpeed / 5, 0, 1)

  // health regen
  if (game.elapsed - player.lastDamage > 6 && player.health < 100 && !(game.mode === 'training' && player.health <= 0)) {
    player.health = Math.min(100, player.health + dt * 7)
    if (Math.random() < .08) refreshHealth()
  }

  // recoil recovery
  player.recoilPitch = lerp(player.recoilPitch, 0, clamp(dt * 9, 0, 1))
  player.recoilYaw = lerp(player.recoilYaw, 0, clamp(dt * 9, 0, 1))
  player.shake = Math.max(0, player.shake - dt * 1.4)
  player.adsT = lerp(player.adsT, aiming ? 1 : 0, clamp(dt * 12, 0, 1))

  // aimbot
  syncAimCamera()
  const nowMs = performance.now()
  if (nowMs - (player._aimCacheAt || 0) > 110) {
    player._aimCacheAt = nowMs
    player._aimTarget = findTarget(parseFloat($('#aimFov').value || '32'), 160, true)
  }
  let lockTarget = MODS.aimbot ? player._aimTarget : null
  if (MODS.aimbot) {
    if (lockTarget && (aiming || firing || touch.firing)) {
      const desiredYaw = Math.atan2(-(lockTarget.point.x - player.pos.x), -(lockTarget.point.z - player.pos.z))
      const flatDist = Math.hypot(lockTarget.point.x - player.pos.x, lockTarget.point.z - player.pos.z)
      const desiredPitch = Math.atan2(lockTarget.point.y - (player.pos.y - player.crouch * .55), flatDist)
      const smooth = parseFloat($('#aimSmooth').value || '55') / 100
      const rate = 1 - Math.exp(-(14 * (1 - smooth * .82)) * dt)
      player.yaw += angleDelta(player.yaw, desiredYaw) * rate
      player.pitch = lerp(player.pitch, desiredPitch, rate)
      player.shake = Math.max(0, player.shake - dt * .5)
    }
  }
  syncAimCamera()
  const assist = !!(player._aimTarget && player._aimTarget.angle < 9 * Math.PI / 180)
  updateTargetFeedback(lockTarget, aiming, assist)

  // auto fire
  if ((firing || touch.firing) && game.phase === 'playing') {
    if (currentWeapon.auto) fireShot()
    else if (!player._semiLatch) { fireShot(); player._semiLatch = true }
  } else {
    player._semiLatch = false
  }

  // weapon ADS fov
  const targetFov = aiming ? 50 : 72
  if (Math.abs(camera.fov - targetFov) > .05) { camera.fov = lerp(camera.fov, targetFov, clamp(dt * 12, 0, 1)); camera.updateProjectionMatrix() }

  // zone damage
  if (game.zoneRadius < 128) {
    const zoneDist = Math.hypot(player.pos.x - game.zoneCenter.x, player.pos.z - game.zoneCenter.y)
    if (zoneDist > game.zoneRadius) {
      player.damageTick += dt
      if (player.damageTick > .9) {
        player.damageTick = 0
        damagePlayer(3.5, null)
        banner('OUTSIDE THE STORM — MOVE TO SAFETY', 1200)
      }
    } else player.damageTick = 0
  }
}

function updateTargetFeedback(lockTarget, aiming, assist) {
  ui.crosshair.classList.toggle('target', !!assist)
  const locked = !!(MODS.aimbot && lockTarget && (aiming || firing || touch.firing))
  ui.crosshair.classList.toggle('locked', locked)
  ui.crosshair.classList.toggle('aimbot', !!(MODS.aimbot && lockTarget))
  if (lockTarget) {
    ui.targetLabel.textContent = (MODS.headshot ? 'HEAD LOCK' : 'TARGET LOCK') + ' // ' + Math.round(lockTarget.dist) + 'M'
  }
}

// ─────────────────────────────────────────────────────────────── camera update
function updateCamera(dt) {
  if (game.phase === 'lobby') {
    const t = performance.now() * .00005
    const a = t + .9
    camera.position.set(Math.cos(a) * 96, 26 + Math.sin(t * 2.2) * 3.4, Math.sin(a) * 96)
    camera.lookAt(0, 6 + Math.sin(t * 1.2) * 1.2, 0)
    if (camera.fov !== 56) { camera.fov = 56; camera.updateProjectionMatrix() }
    viewScene.userData.show = false
    return
  }
  if (game.phase === 'result') {
    const t = performance.now() * .00004
    camera.position.set(Math.cos(t) * 70, 22, Math.sin(t) * 70)
    camera.lookAt(0, 4, 0)
    if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix() }
    viewScene.userData.show = false
    return
  }
  const bobY = player.bob * (1 - player.adsT * .7)
  const bobX = Math.cos(player.walkPhase * .5) * .02 * (1 - player.adsT * .7)
  camera.position.set(
    player.pos.x + Math.cos(player.yaw) * bobX + (Math.random() - .5) * player.shake * .25,
    player.pos.y + bobY + (Math.random() - .5) * player.shake * .35,
    player.pos.z - Math.sin(player.yaw) * bobX
  )
  camera.rotation.y = player.yaw + player.recoilYaw + (Math.random() - .5) * player.shake * .02
  camera.rotation.x = player.pitch + player.recoilPitch + (Math.random() - .5) * player.shake * .02
  camera.rotation.z = (Math.random() - .5) * player.shake * .01
  viewScene.userData.show = true
  updateViewModel(dt)
}

function updateViewModel(dt) {
  const model = currentModel()
  const other = weaponIndex === 0 ? smgModel : rifleModel
  model.group.visible = true; other.group.visible = false
  const base = weaponIndex === 0 ? new THREE.Vector3(.30, -.27, -1.0) : new THREE.Vector3(.30, -.26, -.96)
  const ads = weaponIndex === 0 ? new THREE.Vector3(0, -.081, -.88) : new THREE.Vector3(0, -.064, -.84)
  const pos = base.clone().lerp(ads, player.adsT)
  const swayX = Math.cos(player.walkPhase * .5) * .009 * (1 - player.adsT * .85)
  const swayY = Math.sin(player.walkPhase) * .014 * (1 - player.adsT * .85)
  const recoilKick = clamp(player.recoilPitch * 2.2, 0, .08)
  pos.x += swayX
  pos.y += swayY - recoilKick * .4
  pos.z += recoilKick
  model.group.position.lerp(pos, clamp(dt * 18, 0, 1))
  model.group.rotation.x = lerp(model.group.rotation.x, -recoilKick * 2.2, clamp(dt * 20, 0, 1))
  model.group.rotation.y = lerp(model.group.rotation.y, (player.yaw - (player._lastYaw ?? player.yaw)) * -2.2, clamp(dt * 14, 0, 1))
  model.group.rotation.z = lerp(model.group.rotation.z, -swayX * 2.5, clamp(dt * 12, 0, 1))
  player._lastYaw = player.yaw
  viewCamera.fov = lerp(viewCamera.fov, aiming ? 48 : 58, clamp(dt * 12, 0, 1))
  viewCamera.updateProjectionMatrix()
}

// ──────────────────────────────────────────────────────────────── HUD updates
function updateCompass() {
  const cv = ui.compass, ctx = cv.getContext('2d')
  const w = cv.width, h = cv.height
  ctx.clearRect(0, 0, w, h)
  const deg = ((-player.yaw * 180 / Math.PI) % 360 + 360) % 360
  const fov = 120
  const start = deg - fov / 2
  const pxPerDeg = w / fov
  const marks = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  for (let d = Math.floor(start / 10) * 10; d <= start + fov; d += 10) {
    const x = (d - start) * pxPerDeg
    const major = ((d % 90) + 90) % 90 === 0
    const mid = d % 30 === 0
    ctx.strokeStyle = major ? 'rgba(255,154,77,.8)' : mid ? 'rgba(230,242,225,.5)' : 'rgba(210,225,205,.22)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, h - 2); ctx.lineTo(x, h - (major ? 13 : mid ? 8 : 5)); ctx.stroke()
    if (major) {
      const idx = ((Math.round(d / 45) % 8) + 8) % 8
      ctx.fillStyle = idx === 0 ? '#ffb168' : 'rgba(230,242,225,.86)'
      ctx.font = idx === 0 ? '700 15px Orbitron, sans-serif' : '600 11px Rajdhani, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(marks[idx], x, 16)
    }
  }
  ctx.fillStyle = '#ff9a4d'; ctx.font = '700 9px Rajdhani, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(String(Math.round(deg)).padStart(3, '0') + '°', w / 2, h - 14)
}

let minimapTick = 0
function updateMinimap() {
  const cv = ui.minimap, ctx = cv.getContext('2d')
  const S = cv.width, C = S / 2
  const scale = (C - 12) / 118
  ctx.clearRect(0, 0, S, S)
  ctx.save()
  ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip()
  // water
  const gg = ctx.createRadialGradient(C, C, 20, C, C, C)
  gg.addColorStop(0, '#20312b'); gg.addColorStop(1, '#0b1717')
  ctx.fillStyle = gg; ctx.fillRect(0, 0, S, S)
  // island
  ctx.beginPath(); ctx.arc(C, C, 91 * scale, 0, Math.PI * 2)
  ctx.fillStyle = '#4b5837'; ctx.fill()
  ctx.beginPath(); ctx.arc(C, C, 80 * scale, 0, Math.PI * 2)
  ctx.fillStyle = '#5f6b41'; ctx.fill()
  // roads
  ctx.strokeStyle = 'rgba(160,140,100,.35)'; ctx.lineWidth = 3
  for (const road of world.roads) { /* roads are meshes; sketch a few paths instead */ }
  ctx.beginPath(); ctx.moveTo(C, C + 13 * scale); ctx.bezierCurveTo(C - 25 * scale, C, C + 20 * scale, C - 20 * scale, C + 45 * scale, C + 30 * scale); ctx.stroke()
  // structures
  for (const c of colliderList) {
    if (c.tag === 'barrel' || c.tag === 'rock' || c.tag === 'sandbag') continue
    const x = C + c.x * scale, z = C + c.z * scale
    const w = Math.max(1.5, c.hw * 2 * scale), h = Math.max(1.5, c.hd * 2 * scale)
    ctx.fillStyle = 'rgba(20,25,18,.7)'; ctx.fillRect(x - w / 2, z - h / 2, w, h)
  }
  // pickups
  for (const p of pickups) {
    if (!p.alive) continue
    ctx.fillStyle = p.kind === 'health' ? '#8cf06a' : '#ffb35e'
    ctx.fillRect(C + p.group.position.x * scale - 1.5, C + p.group.position.z * scale - 1.5, 3, 3)
  }
  // enemies
  for (const e of enemies) {
    if (e.dead) continue
    const within = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z) < 47
    if (!within && !MODS.hologram) continue
    const x = C + e.pos.x * scale, z = C + e.pos.z * scale
    ctx.beginPath(); ctx.arc(x, z, MODS.hologram ? 3.2 : 2.4, 0, 7)
    ctx.fillStyle = MODS.hologram ? (e.elite ? '#ff9a4d' : '#ff5638') : '#d9b09b'
    ctx.fill()
  }
  // zone
  ctx.beginPath(); ctx.arc(C + game.zoneCenter.x * scale, C + game.zoneCenter.y * scale, game.zoneRadius * scale, 0, Math.PI * 2)
  ctx.strokeStyle = game.zoneShrinking ? 'rgba(88,236,255,.9)' : 'rgba(88,236,255,.55)'; ctx.lineWidth = 2; ctx.stroke()
  // player arrow
  const px = C + player.pos.x * scale, pz = C + player.pos.z * scale
  ctx.save(); ctx.translate(px, pz); ctx.rotate(-player.yaw)
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath()
  ctx.fillStyle = '#ff9a4d'; ctx.shadowColor = '#ff6b1c'; ctx.shadowBlur = 8; ctx.fill(); ctx.restore()
  // sweep
  const sweep = (performance.now() * .0005) % (Math.PI * 2)
  const sg = ctx.createConicGradient ? ctx.createConicGradient(sweep, C, C) : null
  if (sg) {
    sg.addColorStop(0, 'rgba(88,236,255,.16)'); sg.addColorStop(.08, 'rgba(88,236,255,0)'); sg.addColorStop(1, 'rgba(88,236,255,0)')
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(C, C, C - 3, 0, 7); ctx.fill()
  }
  ctx.restore()
}

function updateObjectiveHud() {
  if (game.mode === 'solo') {
    ui.objectiveText.textContent = 'ELIMINATE ' + game.target + ' HOSTILES'
    ui.objectiveSub.textContent = game.kills + ' / ' + game.target
  } else {
    ui.objectiveText.textContent = 'TRAINING — SURVIVE & ELIMINATE'
    ui.objectiveSub.textContent = game.kills + ' ELIMINATIONS'
  }
}

function refreshModChips() {
  const chips = []
  if (MODS.hologram) chips.push(['HOLOGRAM', ''])
  if (MODS.silent) chips.push(['SILENT AIM', ''])
  if (MODS.headshot) chips.push(['AUTO HS', 'orange'])
  if (MODS.aimkill) chips.push(['AIM KILL', 'orange'])
  if (MODS.aimbot) chips.push(['AIMBOT', ''])
  if (MODS.infinite) chips.push(['∞ AMMO', ''])
  if (MODS.norecoil) chips.push(['NO RECOIL', ''])
  if (MODS.god) chips.push(['GOD', 'orange'])
  ui.modChips.innerHTML = chips.map(([t, c]) => `<span class="mod-chip ${c}">${t}</span>`).join('')
}

function updateZoneHud() {
  if (game.zoneRadius > 127) {
    const remaining = Math.max(0, 100 - game.elapsed)
    ui.zoneTimer.textContent = 'ZONE CLOSES ' + Math.floor(remaining / 60) + ':' + String(Math.floor(remaining % 60)).padStart(2, '0')
    ui.zonePill.classList.remove('warn')
  } else if (game.zoneShrinking) {
    ui.zoneTimer.textContent = 'STORM MOVING'
    ui.zonePill.classList.add('warn')
  } else {
    ui.zoneTimer.textContent = 'FINAL ZONE'
    ui.zonePill.classList.add('warn')
  }
}

// ─────────────────────────────────────────────────────────────── zone / storm
const stormMat = new THREE.ShaderMaterial({
  transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { time: { value: 0 }, col: { value: new THREE.Color(0x4fe4ff) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform float time; uniform vec3 col; varying vec2 vUv;
    void main(){
      float bands = sin(vUv.x*180.0 + time*2.0)*.5+.5;
      float vert = smoothstep(0.0,0.18,vUv.y)*(1.0-smoothstep(0.82,1.0,vUv.y));
      float a = (0.05 + bands*0.08) * vert;
      gl_FragColor = vec4(col, a);
    }`
})
const stormWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 120, 96, 1, true), stormMat)
stormWall.position.set(0, 55, 0)
stormWall.visible = false
scene.add(stormWall)

function updateZone(dt) {
  if (game.zoneRadius > 127) {
    if (game.elapsed > 100) {
      game.zoneShrinking = true
      game.zoneTarget = 66
      const a = Math.random() * Math.PI * 2
      game.zoneCenter.set(Math.cos(a) * 16, Math.sin(a) * 16)
      banner('STORM WALL INBOUND — MOVE TO THE SAFE ZONE', 2600)
    }
  } else if (game.zoneShrinking) {
    game.zoneRadius = lerp(game.zoneRadius, game.zoneTarget, clamp(dt * .12, 0, 1))
    if (Math.abs(game.zoneRadius - game.zoneTarget) < .4) {
      game.zoneRadius = game.zoneTarget
      game.zoneShrinking = false
      banner('FINAL ZONE LOCKED', 2000)
    }
  }
  if (game.zoneRadius < 127) stormWall.visible = true
  stormWall.position.x = game.zoneCenter.x
  stormWall.position.z = game.zoneCenter.y
  stormWall.scale.set(game.zoneRadius, 1, game.zoneRadius)
  stormMat.uniforms.time.value = performance.now() * .001
}

// ──────────────────────────────────────────────────────────────── input setup
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return
  if (e.code === 'Insert' && !e.repeat) { e.preventDefault(); toggleModMenu(); return }
  if ((e.code === 'KeyM') && !e.repeat && !$('#settings').classList.contains('hidden')) return
  if (e.code === 'KeyM' && !e.repeat) { e.preventDefault(); toggleModMenu(); return }
  if (e.code === 'Escape') {
    if (game.modOpen) { closeModMenu(); return }
    if (!$('#settings').classList.contains('hidden')) { $('#settings').classList.add('hidden'); return }
    if (game.phase === 'playing') { pauseGame(); return }
    if (game.phase === 'paused' && !game.modOpen) { resumeGame(); return }
  }
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault()
  keys[e.code] = true
  if (e.code === 'KeyR' && !e.repeat) startReload()
  if (e.code === 'Digit1') switchWeapon(0)
  if (e.code === 'Digit2') switchWeapon(1)
})
window.addEventListener('keyup', (e) => { keys[e.code] = false })
window.addEventListener('blur', () => { firing = false; aiming = false; for (const k in keys) keys[k] = false })

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas && game.phase === 'playing' && !game.modOpen) {
    const sens = settings.sensitivity * .0021
    player.yaw -= e.movementX * sens
    player.pitch -= e.movementY * sens * (settings.invertY ? -1 : 1)
    player.pitch = clamp(player.pitch, -1.48, 1.48)
  }
})
canvas.addEventListener('click', () => {
  if (game.phase === 'playing' && !game.modOpen && !isMobile() && document.pointerLockElement !== canvas) {
    requestLock()
  }
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('button, input, .mod-shell, .settings-card, .pause-card, .result-card')) return
  if (game.phase !== 'playing' || game.modOpen) return
  if (e.button === 0) firing = true
  if (e.button === 2) { aiming = true; e.preventDefault() }
  if (e.button === 0 && document.pointerLockElement !== canvas && !isMobile()) requestLock()
})
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false
  if (e.button === 2) aiming = false
})
document.addEventListener('wheel', (e) => {
  if (game.phase !== 'playing' || game.modOpen) return
  switchWeapon((weaponIndex + (e.deltaY > 0 ? 1 : -1) + WEAPONS.length) % WEAPONS.length)
}, { passive: true })

function requestLock() {
  try {
    const p = canvas.requestPointerLock?.()
    if (p && p.catch) p.catch(() => {})
  } catch (err) {}
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) { game.everLocked = true; return }
  if (game.phase === 'playing' && game.everLocked && !game.modOpen) pauseGame()
})

// ─────────────────────────────────────────────────────────────── mobile input
function isMobile() {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
}
function setupMobile() {
  if (!isMobile()) return
  touch.active = true
  $('#mobileControls').classList.remove('hidden')
  $('#mobileControls').classList.add('show')
  document.body.classList.add('is-mobile')
  const joy = $('#joystick'), knob = $('#joyKnob')
  let joyId = null
  const setJoy = (e) => {
    const r = joy.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    const max = r.width * .32
    const d = Math.hypot(dx, dy)
    const k = d > max ? max / d : 1
    const x = dx * k, y = dy * k
    knob.style.transform = `translate(${x}px,${y}px)`
    touch.joyX = x / max; touch.joyY = y / max
  }
  joy.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); setJoy(e); e.stopPropagation() })
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) setJoy(e) })
  const endJoy = () => { joyId = null; touch.joyX = 0; touch.joyY = 0; knob.style.transform = 'translate(0,0)' }
  joy.addEventListener('pointerup', endJoy); joy.addEventListener('pointercancel', endJoy)

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || game.phase !== 'playing' || game.modOpen) return
    if (e.clientX < window.innerWidth * .35 && e.clientY > window.innerHeight * .55) return
    touch.lookId = e.pointerId; touch.lookX = e.clientX; touch.lookY = e.clientY
  })
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.lookId) return
    const dx = e.clientX - touch.lookX, dy = e.clientY - touch.lookY
    touch.lookX = e.clientX; touch.lookY = e.clientY
    const sens = settings.sensitivity * .0045
    player.yaw -= dx * sens
    player.pitch -= dy * sens * (settings.invertY ? -1 : 1)
    player.pitch = clamp(player.pitch, -1.48, 1.48)
  })
  const endLook = (e) => { if (e.pointerId === touch.lookId) touch.lookId = null }
  canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook)

  const hold = (id, on, off) => {
    const el = $(id)
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); })
    el.addEventListener('pointerup', (e) => { e.preventDefault(); off?.() })
    el.addEventListener('pointercancel', () => off?.())
    el.addEventListener('pointerleave', () => off?.())
  }
  hold('#touchFire', () => { touch.firing = true }, () => { touch.firing = false })
  hold('#touchAds', () => { aiming = !aiming; $('#touchAds').classList.toggle('active', aiming) })
  hold('#touchReload', () => startReload())
  hold('#touchJump', () => { touch.jump = true })
  hold('#touchSwitch', () => switchWeapon((weaponIndex + 1) % 2))
  hold('#touchMod', () => toggleModMenu())
}

// ─────────────────────────────────────────────────────────────── mod menu UI
function syncModUI() {
  $$('[data-modkey]').forEach(input => {
    input.checked = !!MODS[input.dataset.modkey]
    input.closest('.mod-row')?.classList.toggle('on', input.checked)
  })
  $('#aimFovVal').textContent = $('#aimFov').value + '°'
  $('#aimSmoothVal').textContent = $('#aimSmooth').value + '%'
  $('#silentRangeVal').textContent = $('#silentRange').value + ' M'
  refreshModChips()
  applyWireframe()
}
function setMod(key, value) {
  MODS[key] = value
  audio.init(); audio.toggle(value)
  syncModUI()
  const labels = { hologram: 'HOLOGRAM', silent: 'SILENT AIM', headshot: 'AUTO HEADSHOT', aimkill: 'AIM KILL', aimbot: 'AIMBOT', infinite: 'INFINITE AMMO', norecoil: 'NO RECOIL', wireframe: 'WIREFRAME', noslow: 'OVERCLOCK', god: 'GOD MODE', slowmo: 'BULLET TIME' }
  if (labels[key]) toast((value ? '◉ ' : '○ ') + labels[key] + (value ? ' ENABLED' : ' DISABLED'), 1400)
}
function applyWireframe() {
  const want = MODS.wireframe
  scene.traverse(o => {
    if (!o.isMesh || o === stormWall) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (m && m.type === 'MeshStandardMaterial') m.wireframe = want
    }
  })
}
function openModMenu(fromLobby = game.phase === 'lobby') {
  if (game.modOpen) return
  game.modOpen = true
  game.fromLobbyMod = fromLobby
  game.modWasRunning = game.phase === 'playing'
  if (game.phase === 'playing') { game.phase = 'paused'; firing = false; aiming = false }
  if (document.pointerLockElement === canvas) document.exitPointerLock?.()
  ui.modMenu.classList.remove('hidden')
  syncModUI()
  audio.init(); audio.ui()
}
function closeModMenu() {
  if (!game.modOpen) return
  game.modOpen = false
  ui.modMenu.classList.add('hidden')
  if (game.fromLobbyMod) {
    game.phase = 'lobby'
  } else if (game.modWasRunning) {
    game.phase = 'playing'
    if (!isMobile()) setTimeout(requestLock, 60)
  } else if (game.phase === 'paused') {
    ui.pause.classList.remove('hidden')
  }
  audio.ui()
}
function toggleModMenu() {
  if (game.modOpen) closeModMenu()
  else openModMenu(game.phase === 'lobby')
}

$$('.mod-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.mod-tab').forEach(t => t.classList.toggle('active', t === tab))
    $$('.mod-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab))
    audio.ui()
  })
})
$$('[data-modkey]').forEach(input => {
  input.addEventListener('change', () => setMod(input.dataset.modkey, input.checked))
})
$('#aimFov').addEventListener('input', () => { $('#aimFovVal').textContent = $('#aimFov').value + '°' })
$('#aimSmooth').addEventListener('input', () => { $('#aimSmoothVal').textContent = $('#aimSmooth').value + '%' })
$('#silentRange').addEventListener('input', () => { $('#silentRangeVal').textContent = $('#silentRange').value + ' M' })
$('#enableAll').addEventListener('click', () => {
  ['hologram', 'silent', 'headshot', 'aimkill', 'aimbot', 'infinite', 'norecoil'].forEach(k => MODS[k] = true)
  audio.init(); audio.toggle(true)
  syncModUI()
  toast('ALL COMBAT MODULES ENABLED', 1600)
})
$('#modReset').addEventListener('click', () => {
  Object.assign(MODS, { hologram: false, silent: false, headshot: false, aimkill: false, aimbot: false, infinite: false, norecoil: false, tracers: true, damageNumbers: true, wireframe: false, noslow: false, god: false, slowmo: false })
  $$('[data-modkey]').forEach(i => { if (i.dataset.modkey === 'tracers' || i.dataset.modkey === 'damageNumbers') i.checked = true })
  $('#aimFov').value = 32; $('#aimSmooth').value = 55; $('#silentRange').value = 80
  syncModUI(); toast('MOD DEFAULTS RESTORED', 1400)
})
$('#modApply').addEventListener('click', closeModMenu)
$('#modClose').addEventListener('click', closeModMenu)
$('#modMenuLobbyBtn').addEventListener('click', () => openModMenu(true))

// ─────────────────────────────────────────────────────────── settings & lobby
function syncSettings() {
  $('#sensSlider').value = Math.round(settings.sensitivity * 100)
  $('#sensVal').textContent = settings.sensitivity.toFixed(2)
  $('#volSlider').value = Math.round(settings.volume * 100)
  $('#volVal').textContent = Math.round(settings.volume * 100)
  $('#shadowToggle').checked = settings.shadows
  $('#invertToggle').checked = settings.invertY
}
$('#settingsBtn').addEventListener('click', () => { syncSettings(); ui.settings.classList.remove('hidden'); audio.init(); audio.ui() })
$('#settingsClose').addEventListener('click', () => ui.settings.classList.add('hidden'))
$('#settingsApply').addEventListener('click', () => ui.settings.classList.add('hidden'))
$('#sensSlider').addEventListener('input', (e) => { settings.sensitivity = e.target.value / 100; $('#sensVal').textContent = settings.sensitivity.toFixed(2) })
$('#volSlider').addEventListener('input', (e) => { settings.volume = e.target.value / 100; $('#volVal').textContent = e.target.value; audio.setVolume(settings.volume) })
$('#shadowToggle').addEventListener('change', (e) => {
  settings.shadows = e.target.checked
  renderer.shadowMap.enabled = settings.shadows
  world.sun.castShadow = settings.shadows
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true })
})
$('#invertToggle').addEventListener('change', (e) => { settings.invertY = e.target.checked })

let selectedMode = 'solo', selectedWeapon = 0
$$('.mode-card').forEach(card => {
  card.addEventListener('click', () => {
    selectedMode = card.dataset.mode
    $$('.mode-card').forEach(c => c.classList.toggle('selected', c === card))
    $('.start-meta').textContent = selectedMode === 'solo' ? 'DEPLOY TO ISLAND · 20 TARGETS' : 'ENDLESS AI TRAINING'
    audio.init(); audio.ui()
  })
})
$$('.loadout-card').forEach(card => {
  card.addEventListener('click', () => {
    selectedWeapon = card.dataset.weapon === 'rifle' ? 0 : 1
    $$('.loadout-card').forEach(c => c.classList.toggle('selected', c === card))
    audio.init(); audio.ui()
  })
})
$('#startBtn').addEventListener('click', () => startGame(selectedMode, selectedWeapon))

// ────────────────────────────────────────────────────────────── game flow
function startGame(mode, startWeapon = 0) {
  audio.init(); audio.resume()
  if (game.running) cleanupRound()
  game.phase = 'playing'; game.running = true; game.mode = mode
  game.target = mode === 'solo' ? 20 : 99999
  game.kills = 0; game.headshots = 0; game.shots = 0; game.hits = 0; game.elapsed = 0
  game.zoneTime = 100; game.zoneRadius = 132; game.zoneTarget = 66; game.zoneCenter.set(0, 0); game.zoneShrinking = false; game.resultShown = false; game.victory = false
  stormWall.visible = false
  player.pos.copy(world.spawn)
  player.yaw = world.spawnYaw; player.pitch = -0.03
  player.health = 100; player.armor = 50; player.stamina = 100; player.vy = 0; player.onGround = true
  player._vx = 0; player._vz = 0; player.crouch = 0; player.lastDamage = -99; player.damageTick = 0; player.recoilPitch = 0; player.recoilYaw = 0
  weaponIndex = startWeapon; currentWeapon = WEAPONS[weaponIndex]; reloading = false; switching = 0; firing = false; aiming = false
  weaponState.forEach((s, i) => { s.mag = WEAPONS[i].mag; s.reserve = WEAPONS[i].reserve })
  rifleModel.group.visible = weaponIndex === 0; smgModel.group.visible = weaponIndex === 1
  cleanupEnemies(); cleanupPickups()
  updateWeaponHud(); refreshHealth(); updateAliveCount(); updateObjectiveHud(); refreshModChips()
  // build the round on the next tick so the START interaction returns immediately
  setTimeout(() => {
    if (game.phase !== 'playing' || !game.running) return
    spawnInitialEnemies(); spawnPickups()
    updateAliveCount(); updateObjectiveHud(); updateMinimap()
  }, 60)
  ui.lobby.classList.add('hidden')
  ui.result.classList.add('hidden'); ui.pause.classList.add('hidden')
  ui.hud.classList.remove('hidden'); requestAnimationFrame(() => ui.hud.classList.add('active'))
  ui.deploy.classList.remove('hidden')
  clearTimeout(startGame._deploy)
  startGame._deploy = setTimeout(() => ui.deploy.classList.add('hidden'), 900)
  setTimeout(() => { if (game.phase === 'playing' && !isMobile()) requestLock() }, 750)
  updateCompass(); updateMinimap(); updateZoneHud()
  banner(mode === 'solo' ? 'OPERATION START — 20 HOSTILES ON THE ISLAND' : 'TRAINING PROTOCOL ACTIVE', 2200)
  audio.tone({ freq: 420, dur: .2, gain: .1, type: 'triangle' })
}

function pauseGame() {
  if (game.phase !== 'playing') return
  game.phase = 'paused'
  firing = false; aiming = false
  $('#pauseKills').textContent = game.kills
  $('#pauseTime').textContent = formatTime(game.elapsed)
  $('#pauseAcc').textContent = (game.shots ? Math.round(game.hits / game.shots * 100) : 0) + '%'
  ui.pause.classList.remove('hidden')
  document.exitPointerLock?.()
}
function resumeGame() {
  if (game.phase !== 'paused' || game.modOpen) return
  game.phase = 'playing'
  ui.pause.classList.add('hidden')
  if (!isMobile()) requestLock()
}
$('#resumeBtn').addEventListener('click', resumeGame)
$('#pauseModBtn').addEventListener('click', () => { ui.pause.classList.add('hidden'); openModMenu(false) })
$('#quitBtn').addEventListener('click', returnToLobby)

function victory() {
  if (game.resultShown || !game.running || game.phase === 'lobby') return
  game.resultShown = true; game.victory = true
  game.phase = 'result'
  document.exitPointerLock?.()
  ui.resultKicker.textContent = 'OPERATION COMPLETE'
  $('#resultTitle').textContent = 'LAST ONE STANDING'
  $('#resultCopy').textContent = 'The island is clear. Every hostile operator has been neutralized.'
  $('#resKills').textContent = game.kills
  $('#resAcc').textContent = (game.shots ? Math.round(game.hits / game.shots * 100) : 0) + '%'
  $('#resHeads').textContent = game.headshots
  $('#resTime').textContent = formatTime(game.elapsed)
  ui.result.classList.remove('hidden')
  ui.hud.classList.remove('active')
  audio.victory()
}
function defeat() {
  if (game.resultShown) return
  game.resultShown = true; game.victory = false
  game.phase = 'result'
  document.exitPointerLock?.()
  ui.resultKicker.textContent = 'SIGNAL LOST'
  $('#resultTitle').textContent = 'OPERATOR DOWN'
  $('#resultCopy').textContent = 'You were eliminated on Fallen Cay. Regroup, re-kit, and take the island back.'
  $('#resKills').textContent = game.kills
  $('#resAcc').textContent = (game.shots ? Math.round(game.hits / game.shots * 100) : 0) + '%'
  $('#resHeads').textContent = game.headshots
  $('#resTime').textContent = formatTime(game.elapsed)
  ui.result.classList.remove('hidden')
  ui.hud.classList.remove('active')
  audio.defeat()
}
function respawnTraining() {
  if (game.phase !== 'playing') return
  player.health = 100; player.armor = 50; player.stamina = 100
  player.pos.copy(world.spawn); player.vy = 0
  player.yaw = world.spawnYaw; player.pitch = -.03
  player.lastDamage = game.elapsed
  refreshHealth()
  banner('RECONSTRUCTED — TRAINING CONTINUES', 1800)
}
function returnToLobby() {
  game.phase = 'lobby'; game.running = false; game.modOpen = false
  ui.result.classList.add('hidden'); ui.pause.classList.add('hidden'); ui.modMenu.classList.add('hidden')
  ui.hud.classList.remove('active'); setTimeout(() => ui.hud.classList.add('hidden'), 250)
  ui.lobby.classList.remove('hidden')
  cleanupRound()
  document.exitPointerLock?.()
  audio.ui()
}
function cleanupEnemies() { for (const e of [...enemies]) removeEnemy(e) }
function cleanupPickups() { for (const p of pickups) scene.remove(p.group); pickups.length = 0 }
function cleanupRound() {
  cleanupEnemies(); cleanupPickups()
  for (const e of effects) { scene.remove(e.obj); if (e.geo) e.geo.dispose() }
  effects.length = 0
  for (const t of tracers) { t.life = 0; t.mesh.visible = false }
  document.getElementById('dmgLayer').innerHTML = ''
  ui.killfeed.innerHTML = ''
}
function formatTime(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') }
$('#redeployBtn').addEventListener('click', () => startGame(game.mode || 'solo', weaponIndex))
$('#lobbyBtn').addEventListener('click', returnToLobby)

// pause when hidden
document.addEventListener('visibilitychange', () => { if (document.hidden && game.phase === 'playing') pauseGame() })

// ──────────────────────────────────────────────────────────────── main update
let lastTime = performance.now()
let hudClock = 0, mapClock = 0, compassClock = 0

function update(dtRaw) {
  const dt = Math.min(.055, dtRaw) * (MODS.slowmo ? .35 : 1)
  world.update(performance.now() * .001)
  if (game.phase === 'lobby' || game.phase === 'result') {
    updateLobbyUI(dtRaw)
  } else {
    game.elapsed += dt
    updatePlayer(dt)
    for (const e of [...enemies]) updateEnemy(e, dt)
    updatePickups(dt)
    updateEffects(dt)
    updateZone(dt)
  }
  if (game.phase === 'paused') updateEffects(dt * .2)
  updateCamera(dtRaw)

  hudClock += dtRaw
  if (hudClock > .08 && (game.phase === 'playing' || game.phase === 'paused')) {
    hudClock = 0
    updateObjectiveHud()
    updateZoneHud()
    refreshHealth()
    updateAliveCount()
    if (game.phase === 'playing') updateCompass()
    mapClock += .08
    if (mapClock > .12) { mapClock = 0; updateMinimap() }
  }
  if (game.phase === 'playing') {
    compassClock += dtRaw
    if (compassClock > .03) { compassClock = 0; updateCompass() }
  }
}

function updateLobbyUI(dt) {
  // idle scene animation only; kept for future lobby flourishes
}

function updatePickups(dt) {
  const t = performance.now() * .001
  for (const p of pickups) {
    if (!p.alive) {
      p.respawn -= dt
      if (p.respawn <= 0) {
        p.alive = true; p.group.visible = true
        p.respawn = 999
      }
      continue
    }
    p.group.position.y = p.baseY + Math.sin(t * 2 + p.phase) * .07
    p.mesh.rotation.y += dt * 1.8
    p.ring.rotation.z += dt * 1.2
    const d = Math.hypot(player.pos.x - p.group.position.x, player.pos.z - p.group.position.z)
    if (d < 1.5 && Math.abs(player.pos.y - p.baseY) < 2.5) {
      p.alive = false; p.group.visible = false; p.respawn = 24
      if (p.kind === 'health') {
        player.health = Math.min(100, player.health + 35)
        banner('+35 HEALTH', 900)
      } else {
        const ws = weaponState[weaponIndex]
        if (!MODS.infinite) ws.reserve += 60
        else { ws.mag = currentWeapon.mag }
        banner('+60 ' + currentWeapon.shortType + ' AMMO', 900)
        updateWeaponHud()
      }
      refreshHealth()
      audio.tone({ freq: 700, dur: .1, gain: .1, type: 'triangle' })
    }
  }
}

function render() {
  renderer.clear()
  renderer.render(scene, camera)
  if (viewScene.userData.show !== false && (game.phase === 'playing' || game.phase === 'paused') && !game.modOpen) {
    renderer.clearDepth()
    renderer.render(viewScene, viewCamera)
  }
}

function loop(now) {
  requestAnimationFrame(loop)
  const dt = Math.min(.06, (now - lastTime) / 1000)
  lastTime = now
  update(dt)
  render()
  // adaptive resolution keeps movement responsive on software rasterisers / weak phones
  perfTime += dt; perfFrames++
  if (perfTime > 2.2) {
    const fps = perfFrames / perfTime
    perfTime = 0; perfFrames = 0
    if (game.phase === 'playing' || game.phase === 'lobby') {
      let next = currentPixelRatio
      if (fps < 30) next = Math.max(.55, currentPixelRatio - .1)
      else if (fps > 55 && currentPixelRatio < basePixelRatio) next = Math.min(basePixelRatio, currentPixelRatio + .1)
      if (Math.abs(next - currentPixelRatio) > .001) {
        currentPixelRatio = next
        renderer.setPixelRatio(currentPixelRatio)
        renderer.setSize(window.innerWidth, window.innerHeight)
      }
    }
  }
}
let perfTime = 0, perfFrames = 0

// ──────────────────────────────────────────────────────────────── boot
function onResize() {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setPixelRatio(currentPixelRatio)
  renderer.setSize(w, h)
  camera.aspect = w / h; camera.updateProjectionMatrix()
  viewCamera.aspect = w / h; viewCamera.updateProjectionMatrix()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  ui.minimap.width = ui.minimap.height = Math.round(220 * dpr)
  ui.minimap.style.width = ui.minimap.style.height = '100%'
}
window.addEventListener('resize', onResize)

syncModUI()
syncSettings()
updateWeaponHud()
refreshHealth()
updateObjectiveHud()
updateAliveCount()
refreshModChips()
setupMobile()
onResize()
requestAnimationFrame(loop)
setTimeout(() => { try { renderer.compile(scene, camera); renderer.compile(viewScene, viewCamera) } catch (err) {} }, 400)

window.__FREEFALL__ = { game, player, enemies, MODS, world, camera, startGame, renderer, scene, viewScene }
