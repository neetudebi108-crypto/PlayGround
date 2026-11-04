// FREEFALL — procedural island world
import * as THREE from './vendor/three.module.js'

export const ISLAND_RADIUS = 118

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const hash = (x, z) => {
  let h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123
  return h - Math.floor(h)
}
const noise2 = (x, z) => {
  const xi = Math.floor(x), zi = Math.floor(z)
  const xf = x - xi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf)
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}
const fbm = (x, z) => {
  let n = 0, amp = 0.5, f = 1
  for (let i = 0; i < 4; i++) { n += noise2(x * f, z * f) * amp; f *= 2.03; amp *= 0.5 }
  return n
}

export function terrainHeight(x, z) {
  const d = Math.hypot(x, z)
  const mask = smooth(118, 60, d)
  let h = (fbm(x * 0.017 + 4.2, z * 0.017 - 1.8) * 9.5 + fbm(x * 0.045, z * 0.045) * 2.1) * mask
  h -= (1 - mask) * 8.5
  // beach shelf
  h -= smooth(64, 96, d) * 1.5 * mask
  // gentle central highland around the drop zone
  h += Math.exp(-Math.pow((x - 2) / 34, 2) - Math.pow((z - 16) / 30, 2)) * 3.4
  // radio ridge to the north-west
  h += Math.exp(-Math.pow((x + 30) / 19, 2) - Math.pow((z + 52) / 16, 2)) * 11
  // rocky bluff to the east
  h += Math.exp(-Math.pow((x - 55) / 15, 2) - Math.pow((z + 12) / 17, 2)) * 7
  return h
}

function makeCanvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  draw(ctx, size)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function detailTexture() {
  return makeCanvasTexture(256, (c, s) => {
    c.fillStyle = '#8f8f86'; c.fillRect(0, 0, s, s)
    for (let i = 0; i < 6000; i++) {
      const g = 100 + Math.random() * 100
      c.fillStyle = `rgba(${g},${g},${g * 0.94},${Math.random() * 0.35})`
      const r = Math.random() * 2.4
      c.fillRect(Math.random() * s, Math.random() * s, r, r)
    }
    for (let i = 0; i < 30; i++) {
      c.strokeStyle = `rgba(60,60,52,${Math.random() * 0.12})`
      c.lineWidth = 1 + Math.random() * 3
      c.beginPath(); c.moveTo(Math.random() * s, 0); c.lineTo(Math.random() * s, s); c.stroke()
    }
  }, 80)
}

function concreteTexture() {
  return makeCanvasTexture(256, (c, s) => {
    c.fillStyle = '#8d897d'; c.fillRect(0, 0, s, s)
    for (let i = 0; i < 2600; i++) {
      const g = 95 + Math.random() * 85
      c.fillStyle = `rgba(${g},${g - 4},${g - 10},${Math.random() * 0.5})`
      c.fillRect(Math.random() * s, Math.random() * s, Math.random() * 3, Math.random() * 3)
    }
    for (let i = 0; i < 7; i++) {
      c.strokeStyle = 'rgba(48,45,40,0.28)'; c.lineWidth = 1 + Math.random() * 2
      c.beginPath(); let x = Math.random() * s, y = Math.random() * s; c.moveTo(x, y)
      for (let j = 0; j < 5; j++) { x += (Math.random() - .5) * 45; y += Math.random() * 30; c.lineTo(x, y) }
      c.stroke()
    }
    const grd = c.createLinearGradient(0, 0, 0, s)
    grd.addColorStop(0, 'rgba(255,255,255,0.08)'); grd.addColorStop(1, 'rgba(20,18,14,0.25)')
    c.fillStyle = grd; c.fillRect(0, 0, s, s)
  }, 2)
}

function metalTexture(base = '#7b8279', rust = true) {
  return makeCanvasTexture(256, (c, s) => {
    c.fillStyle = base; c.fillRect(0, 0, s, s)
    for (let x = 0; x < s; x += 6) {
      c.fillStyle = `rgba(255,255,255,${Math.random() * 0.045})`
      c.fillRect(x, 0, 2, s)
    }
    for (let i = 0; i < 1400; i++) {
      const g = Math.random() * 90
      c.fillStyle = `rgba(${60 + g},${60 + g},${55 + g},${Math.random() * .3})`
      c.fillRect(Math.random() * s, Math.random() * s, Math.random() * 4, Math.random() * 4)
    }
    if (rust) {
      for (let i = 0; i < 22; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * 24
        const g = c.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, 'rgba(116,58,26,0.55)'); g.addColorStop(1, 'rgba(116,58,26,0)')
        c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
      }
    }
  }, 2)
}

function woodTexture() {
  return makeCanvasTexture(256, (c, s) => {
    c.fillStyle = '#73583e'; c.fillRect(0, 0, s, s)
    for (let y = 0; y < s; y += 32) {
      c.fillStyle = `rgba(${40 + Math.random() * 30},${28 + Math.random() * 20},15,0.35)`
      c.fillRect(0, y, s, 2)
      for (let i = 0; i < 26; i++) {
        c.strokeStyle = `rgba(40,26,14,${Math.random() * .25})`
        c.beginPath(); c.moveTo(0, y + Math.random() * 30); c.lineTo(s, y + Math.random() * 30); c.stroke()
      }
    }
    for (let i = 0; i < 12; i++) { c.fillStyle = 'rgba(30,24,14,0.5)'; c.beginPath(); c.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 0, 7); c.fill() }
  }, 3)
}

function containerTexture(color) {
  return makeCanvasTexture(256, (c, s) => {
    c.fillStyle = color; c.fillRect(0, 0, s, s)
    for (let x = 0; x < s; x += 16) {
      c.fillStyle = 'rgba(0,0,0,0.14)'; c.fillRect(x, 0, 3, s)
      c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x + 4, 0, 2, s)
    }
    for (let i = 0; i < 30; i++) {
      const g = c.createRadialGradient(Math.random() * s, Math.random() * s, 0, Math.random() * s, Math.random() * s, 20)
      g.addColorStop(0, 'rgba(110,55,24,0.35)'); g.addColorStop(1, 'rgba(110,55,24,0)')
      c.fillStyle = g; c.fillRect(0, 0, s, s)
    }
    c.fillStyle = 'rgba(230,230,220,0.65)'; c.font = 'bold 20px monospace'; c.fillText('FAILSAFE', 18, 40)
    c.font = '12px monospace'; c.fillText('CARGO • 0291', 18, 60)
  }, 1)
}

function signTexture(text, sub = '') {
  return makeCanvasTexture(512, (c, s) => {
    c.fillStyle = '#171a15'; c.fillRect(0, 0, s, s)
    c.strokeStyle = '#e8e2cf'; c.lineWidth = 10; c.strokeRect(18, 18, s - 36, s - 36)
    c.fillStyle = '#f3ead2'; c.font = '900 84px Orbitron, sans-serif'; c.textAlign = 'center'
    c.fillText(text, s / 2, s / 2 + 12)
    if (sub) { c.font = '600 30px Rajdhani, sans-serif'; c.fillStyle = '#e7a54b'; c.fillText(sub, s / 2, s / 2 + 70) }
  }, 1)
}

function glowTexture() {
  return makeCanvasTexture(128, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.2, 'rgba(255,225,170,0.95)')
    g.addColorStop(0.55, 'rgba(255,140,40,0.35)')
    g.addColorStop(1, 'rgba(255,120,20,0)')
    c.fillStyle = g; c.fillRect(0, 0, s, s)
  }, 1)
}

function cloudTexture() {
  return makeCanvasTexture(256, (c, s) => {
    c.clearRect(0, 0, s, s)
    for (let i = 0; i < 18; i++) {
      const x = s * 0.2 + Math.random() * s * 0.6
      const y = s * 0.35 + Math.random() * s * 0.3
      const r = 18 + Math.random() * 42
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill()
    }
  }, 1)
}

export function createWorld(scene) {
  const LOWEND = !!(typeof window !== 'undefined' && window.__FREEFALL_LOWEND__)
  const colliders = []
  const platforms = []
  const enemySpawns = []
  const pickupSpots = []
  const landmarks = []
  const roads = []

  const addCollider = (x, z, w, d, minY, maxY, tag = 'wall') => {
    colliders.push({ x, z, hw: w / 2, hd: d / 2, minY, maxY, tag })
  }
  const addPlatform = (x, z, w, d, y) => platforms.push({ x, z, hw: w / 2, hd: d / 2, y })

  const world = {
    colliders, platforms, enemySpawns, pickupSpots, landmarks, roads,
    groundHeight(x, z) {
      let y = terrainHeight(x, z)
      for (const p of platforms) {
        if (Math.abs(x - p.x) < p.hw && Math.abs(z - p.z) < p.hd && p.y > y && p.y - y < 4) y = p.y
      }
      return y
    }
  }

  // ------------------------------------------------------------------ lighting
  const sunDir = new THREE.Vector3(-0.55, 0.62, 0.56).normalize()
  const hemi = new THREE.HemisphereLight(0xbfd6ea, 0x6e5b3b, 1.08)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffe2b4, 3.35)
  sun.position.copy(sunDir).multiplyScalar(120)
  sun.castShadow = true
  sun.shadow.mapSize.set(LOWEND ? 1024 : 2048, LOWEND ? 1024 : 2048)
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 320
  sun.shadow.camera.left = -100; sun.shadow.camera.right = 100
  sun.shadow.camera.top = 100; sun.shadow.camera.bottom = -100
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  scene.add(sun)
  scene.add(sun.target)
  world.sun = sun

  // ---------------------------------------------------------------------- sky
  const skyGeo = new THREE.SphereGeometry(620, 40, 24)
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 sunDir;
      void main(){
        float h = clamp(vDir.y*0.5+0.5, 0.0, 1.0);
        vec3 low = vec3(0.96,0.79,0.62);
        vec3 mid = vec3(0.46,0.68,0.82);
        vec3 top = vec3(0.12,0.34,0.58);
        vec3 col = mix(low, mid, smoothstep(0.47,0.62,h));
        col = mix(col, top, smoothstep(0.6,1.0,h));
        float d = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += vec3(1.0,0.72,0.42) * pow(d, 18.0) * 0.55;
        col += vec3(1.0,0.92,0.72) * pow(d, 900.0) * 3.0;
        gl_FragColor = vec4(col,1.0);
      }`
  })
  const sky = new THREE.Mesh(skyGeo, skyMat)
  scene.add(sky)
  scene.fog = new THREE.FogExp2(0xacc6cf, 0.0042)

  const cloudTex = cloudTexture()
  for (let i = 0; i < 22; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.26 + Math.random() * 0.24, depthWrite: false, fog: false, color: 0xffffff })
    const s = new THREE.Sprite(mat)
    const a = Math.random() * Math.PI * 2, r = 110 + Math.random() * 320
    s.position.set(Math.cos(a) * r, 62 + Math.random() * 65, Math.sin(a) * r)
    const sc = 70 + Math.random() * 110
    s.scale.set(sc, sc * 0.42, 1)
    scene.add(s)
  }

  // ------------------------------------------------------------------- terrain
  const SIZE = 290, SEG = 168
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)
  terrainGeo.rotateX(-Math.PI / 2)
  const pos = terrainGeo.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const cSand = new THREE.Color(0xd8c28f)
  const cWet = new THREE.Color(0xb2a071)
  const cGrass = new THREE.Color(0x66813f)
  const cGrass2 = new THREE.Color(0x46622e)
  const cRock = new THREE.Color(0x7c7566)
  const cDirt = new THREE.Color(0x8b7651)
  const tmpColor = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const y = terrainHeight(x, z)
    pos.setY(i, y)
    const d = Math.hypot(x, z)
    const e = 0.7
    const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z)
    const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e)
    const slope = Math.hypot(hx, hz) / (2 * e)
    const n = fbm(x * 0.09 + 7, z * 0.09 - 3)
    if (y < -0.2) tmpColor.copy(cWet)
    else if (y < 1.25 + n * 0.8) tmpColor.copy(cSand).lerp(cWet, Math.max(0, -y) * .12)
    else if (slope > 0.52) tmpColor.copy(cRock).lerp(cSand, Math.max(0, .42 - slope) * .3)
    else tmpColor.copy(cGrass).lerp(cGrass2, n)
    if (d > 76 && d < 92 && y > 0.5) tmpColor.lerp(cSand, smooth(92, 76, d) * .72)
    if (n > .68 && y > 2 && slope < .4) tmpColor.lerp(cDirt, (n - .68) * 1.7)
    colors[i * 3] = tmpColor.r; colors[i * 3 + 1] = tmpColor.g; colors[i * 3 + 2] = tmpColor.b
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  terrainGeo.computeVertexNormals()
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detailTexture(), roughness: 0.97, metalness: 0 })
  const terrain = new THREE.Mesh(terrainGeo, terrainMat)
  terrain.receiveShadow = true
  terrain.castShadow = true
  scene.add(terrain)
  world.terrain = terrain

  // -------------------------------------------------------------------- water
  const waterGeo = new THREE.PlaneGeometry(560, 560, 80, 80)
  waterGeo.rotateX(-Math.PI / 2)
  const waterMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { time: { value: 0 }, sunDir: { value: sunDir.clone() }, deep: { value: new THREE.Color(0x0a3f4b) }, shallow: { value: new THREE.Color(0x2e8b8c) } },
    vertexShader: `
      uniform float time; varying vec3 vWorld; varying vec3 vNormalW;
      void main(){
        vec3 p = position;
        float w = sin(p.x*0.11 + time*0.9)*0.16 + sin(p.z*0.14 - time*0.7)*0.13 + sin((p.x+p.z)*0.05+time*0.4)*0.2;
        p.y += w;
        vec4 wp = modelMatrix * vec4(p,1.0); vWorld = wp.xyz;
        vNormalW = normalize(vec3(sin(p.x*0.11+time*0.9)*0.05, 1.0, sin(p.z*0.14-time*0.7)*0.05));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform float time; uniform vec3 sunDir; uniform vec3 deep; uniform vec3 shallow;
      varying vec3 vWorld; varying vec3 vNormalW;
      void main(){
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 n = normalize(vNormalW + vec3(sin(vWorld.x*0.9+time*1.7)*0.035,0.0,cos(vWorld.z*0.8-time*1.4)*0.035));
        float fres = pow(1.0 - max(dot(n,view),0.0), 2.4);
        vec3 col = mix(deep, shallow, 0.35 + 0.4*sin(vWorld.x*0.05+time*.3));
        col = mix(col, vec3(0.55,0.72,0.78), fres*0.75);
        vec3 h = normalize(normalize(sunDir)+view);
        float spec = pow(max(dot(n,h),0.0), 180.0);
        col += vec3(1.0,0.86,0.6) * spec * 2.2;
        float sparkle = pow(max(dot(n,h),0.0), 900.0);
        col += vec3(1.0) * sparkle;
        gl_FragColor = vec4(col, 0.87);
      }`
  })
  const water = new THREE.Mesh(waterGeo, waterMat)
  water.position.y = 0
  water.receiveShadow = false
  scene.add(water)
  world.water = water

  // -------------------------------------------------------------------- roads
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x7c6a4d, map: woodTexture(), roughness: 1, transparent: true, opacity: 0.9, depthWrite: false })
  roadMat.map.repeat.set(2, 8)
  function makeRoad(points, width = 4.2) {
    const verts = [], uvs = [], idx = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      const q = points[Math.min(points.length - 1, i + 1)]
      const o = points[Math.max(0, i - 1)]
      const dx = q[0] - o[0], dz = q[1] - o[1]
      const len = Math.hypot(dx, dz) || 1
      const nx = -dz / len, nz = dx / len
      for (let s = -1; s <= 1; s += 2) {
        const x = p[0] + nx * width / 2 * s, z = p[1] + nz * width / 2 * s
        verts.push(x, terrainHeight(x, z) + 0.055, z)
        uvs.push(s * 0.5 + 0.5, i * 0.6)
      }
      if (i < points.length - 1) {
        const b = i * 2
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(idx); g.computeVertexNormals()
    const m = new THREE.Mesh(g, roadMat)
    m.receiveShadow = true
    scene.add(m)
    roads.push(m)
  }
  makeRoad([[0, 12], [6, -4], [-8, -22], [-30, -30], [-48, -20], [-58, 4], [-60, 30]], 5)
  makeRoad([[2, 8], [18, 2], [34, 14], [46, 28], [48, 43]], 4.2)
  makeRoad([[-32, -32], [-24, -46], [-28, -58], [4, -68], [28, -54], [41, 28]], 3.6)

  // ----------------------------------------------------------------- materials
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0xb5ae9f, roughness: 0.92 })
  const concrete2Mat = new THREE.MeshStandardMaterial({ map: concreteTexture(), color: 0x8e8a7d, roughness: 0.95 })
  const darkMetalMat = new THREE.MeshStandardMaterial({ map: metalTexture('#4a4f4a', true), color: 0x929892, roughness: 0.65, metalness: 0.45 })
  const rustMat = new THREE.MeshStandardMaterial({ map: metalTexture('#8a5738', true), color: 0xbc8a65, roughness: 0.8, metalness: 0.25 })
  const roofMat = new THREE.MeshStandardMaterial({ map: metalTexture('#7d5a44', true), color: 0xb37c5e, roughness: 0.82, metalness: 0.28 })
  const roofTealMat = new THREE.MeshStandardMaterial({ map: metalTexture('#4c706d', true), color: 0x8bb6ac, roughness: 0.8, metalness: 0.2 })
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0xc09a70, roughness: 0.9 })
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x16262a, roughness: 0.16, metalness: 0.6, emissive: 0x0b2327, emissiveIntensity: 0.5 })
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0xa8946a, roughness: 1 })
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x1c1e1b, roughness: 0.85 })
  const orangeMat = new THREE.MeshStandardMaterial({ color: 0xc8611e, roughness: 0.8, emissive: 0x2a0e02, emissiveIntensity: 0.4 })
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xcfc9b9, roughness: 0.85 })

  const addBox = (parent, w, h, d, x, y, z, mat, ry = 0, collide = false, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    m.position.set(x, y, z); m.rotation.y = ry
    m.castShadow = cast; m.receiveShadow = true
    parent.add(m)
    if (collide) {
      parent.updateWorldMatrix(true, false)
      m.updateWorldMatrix(true, false)
      const box = new THREE.Box3().setFromObject(m)
      addCollider((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2,
        Math.max(.1, box.max.x - box.min.x), Math.max(.1, box.max.z - box.min.z),
        box.min.y, box.max.y)
    }
    return m
  }

  function labelSign(parent, text, sub, x, y, z, w = 3.2, h = 1.6, ry = 0) {
    const mat = new THREE.MeshBasicMaterial({ map: signTexture(text, sub), transparent: true, toneMapped: false })
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
    m.position.set(x, y, z); m.rotation.y = ry
    parent.add(m)
    return m
  }

  function pad(x, z, w, d) {
    let top = -99
    for (const [ox, oz] of [[-w/2,-d/2],[w/2,-d/2],[-w/2,d/2],[w/2,d/2],[0,0]]) {
      top = Math.max(top, terrainHeight(x + ox, z + oz))
    }
    top += 0.16
    const bottom = top - 1.1
    const m = addBox(scene, w + 0.8, top - bottom, d + 0.8, x, (top + bottom) / 2, z, concreteMat, 0, false, false)
    m.receiveShadow = true
    addPlatform(x, z, w + 0.8, d + 0.8, top)
    return top
  }

  function crate(x, z, size = 1.15, y = null, ry = 0) {
    const base = y ?? world.groundHeight(x, z)
    const m = addBox(scene, size, size, size, x, base + size / 2, z, woodMat, ry, true)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(size * 1.02, size * 0.11, size * 1.02), blackMat)
    frame.position.set(x, base + size * 0.82, z); frame.rotation.y = ry; scene.add(frame)
    return m
  }

  function barrel(x, z, color = 0xb64825) {
    const b = world.groundHeight(x, z)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.25, map: metalTexture('#8a5738') })
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.05, 12), mat)
    m.position.set(x, b + 0.53, z); m.castShadow = true; m.receiveShadow = true; scene.add(m)
    for (const yy of [0.24, 0.82]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.365, 0.025, 5, 14), darkMetalMat)
      ring.rotation.x = Math.PI / 2; ring.position.set(x, b + yy, z); scene.add(ring)
    }
    addCollider(x, z, .72, .72, b, b + 1.1, 'barrel')
    return m
  }

  function sandbags(x, z, length = 3, ry = 0) {
    const b = world.groundHeight(x, z)
    const group = new THREE.Group()
    for (let row = 0; row < 3; row++) {
      const count = Math.max(1, Math.round(length / 0.72) - row)
      for (let i = 0; i < count; i++) {
        const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 7), sandbagMat)
        bag.rotation.z = Math.PI / 2
        bag.rotation.y = ry + (Math.random() - .5) * .18
        const lx = (i - (count - 1) / 2) * 0.7
        bag.position.set(lx, 0.22 + row * 0.36, (Math.random() - .5) * .08)
        bag.castShadow = true; bag.receiveShadow = true; group.add(bag)
      }
    }
    group.position.set(x, b, z); group.rotation.y = ry
    scene.add(group)
    const c = Math.cos(ry), s = Math.sin(ry)
    addCollider(x, z, length * Math.abs(c) + 0.6 * Math.abs(s), length * Math.abs(s) + 0.6 * Math.abs(c), b, b + 1.3, 'sandbag')
    return group
  }

  // ----------------------------------------------------------------- buildings
  function house(x, z, w, d, ry, roofColor = 0) {
    const top = pad(x, z, w, d)
    const g = new THREE.Group(); g.position.set(x, top, z); g.rotation.y = ry; scene.add(g)
    const h = 3.2
    const t = 0.24
    // floor
    addBox(g, w, t, d, 0, t / 2, 0, concrete2Mat, 0, false)
    // walls: back + sides + split front
    addBox(g, w, h, t, 0, h / 2, -d / 2, concreteMat, 0, true)
    addBox(g, t, h, d, -w / 2, h / 2, 0, concreteMat, 0, true)
    addBox(g, t, h, d, w / 2, h / 2, 0, concreteMat, 0, true)
    addBox(g, (w - 1.7) / 2, h, t, -(w + 1.7) / 4, h / 2, d / 2, concreteMat, 0, true)
    addBox(g, (w - 1.7) / 2, h, t, (w + 1.7) / 4, h / 2, d / 2, concreteMat, 0, true)
    // header above door
    addBox(g, 1.7, 0.55, t, 0, h - 0.275, d / 2, concreteMat, 0, true)
    // window glass + frames on side walls
    for (const side of [-1, 1]) {
      addBox(g, .06, 1.1, 1.5, side * (w / 2 + .02), 1.95, 0, glassMat, 0, false, false)
      addBox(g, .1, 1.24, .12, side * (w / 2 + .03), 1.95, -.82, blackMat, 0, false, false)
      addBox(g, .1, 1.24, .12, side * (w / 2 + .03), 1.95, .82, blackMat, 0, false, false)
    }
    // pitched roof (two tilted slabs)
    const roofMatUse = roofColor ? roofTealMat : roofMat
    const half = d / 2 + .45, angle = 0.29
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + .9, .12, half / Math.cos(angle) + .1), roofMatUse)
      slab.position.set(0, h + .45, s * half / 2)
      slab.rotation.x = s * angle
      slab.castShadow = true; slab.receiveShadow = true
      g.add(slab)
    }
    addBox(g, w + .9, .15, .18, 0, h + .82, 0, darkMetalMat)
    // simple interior light
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd28a }))
    lamp.position.set(0, h - .4, 0); g.add(lamp)
    // props
    crate(x + w * .32, z - d * .34, .8, top)
    // sign
    labelSign(scene, 'SAFE HOUSE', 'SECTOR 03', x + Math.sin(ry) * (d / 2 + .02) + Math.cos(ry) * 0, top + 2.5, z + Math.cos(ry) * (d / 2 + .02) - Math.sin(ry) * 0, 1.7, .85, ry)
    world.enemySpawns.push([x - w / 2 - 5, z - d / 2 - 4], [x + w / 2 + 6, z + d / 2 + 5])
    pickupSpots.push([x, top + .7, z])
    landmarks.push({ name: 'SAFEHOUSE', x, z })
  }

  house(-42, -26, 9, 7, 0.12)
  house(-56, -14, 8, 6.5, -0.25, 1)
  house(-34, -44, 7.5, 6, 0.4)
  house(-63, 4, 9.5, 7.5, 0.02, 1)

  // market stalls
  for (let i = 0; i < 3; i++) {
    const x = -48 + i * 6.5, z = -4 - i * 1.5
    const b = world.groundHeight(x, z)
    const g = new THREE.Group(); g.position.set(x, b, z); scene.add(g)
    for (const [px, pz] of [[-1.2,-1.1],[1.2,-1.1],[-1.2,1.1],[1.2,1.1]]) addBox(g, .1, 2.3, .1, px, 1.15, pz, woodMat, 0, false)
    for (const s of [-1, 1]) {
      const cloth = addBox(g, 3.1, .05, 1.5, 0, 2.3, s * .55, orangeMat)
      cloth.rotation.z = s * .15
    }
    addBox(g, 2.5, .1, 2.0, 0, 1.0, 0, woodMat)
    crate(x + 1.4, z - 1.6, .8)
    world.enemySpawns.push([x + 4, z + 3])
  }
  landmarks.push({ name: 'NIGHT MARKET', x: -47, z: -6 })

  // ------------------------------------------------------------------ hangars
  function hangar(x, z, w, d, ry = 0, label = 'HANGAR 07') {
    const top = pad(x, z, w, d)
    const g = new THREE.Group(); g.position.set(x, top, z); g.rotation.y = ry; scene.add(g)
    const h = 5.2
    addBox(g, w, .25, d, 0, .12, 0, concrete2Mat, 0, false)
    addBox(g, w, h, .3, 0, h / 2, -d / 2, concreteMat, 0, true)
    addBox(g, .3, h, d, -w / 2, h / 2, 0, concreteMat, 0, true)
    addBox(g, .3, h, d, w / 2, h / 2, 0, concreteMat, 0, true)
    // front: two side panels + big door
    addBox(g, w * .26, h, .3, -w * .37, h / 2, d / 2, concreteMat, 0, true)
    addBox(g, w * .26, h, .3, w * .37, h / 2, d / 2, concreteMat, 0, true)
    addBox(g, w * .5, 1.0, .3, 0, h - .5, d / 2, concreteMat, 0, true)
    // rollup door
    const doorMat = new THREE.MeshStandardMaterial({ map: metalTexture('#6b6f68'), color: 0xa6a99f, roughness: .55, metalness: .45 })
    for (let i = 0; i < 8; i++) addBox(g, w * .5, .48, .1, 0, .3 + i * .49, d / 2 + .06, doorMat)
    // roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + .5, .22, d + .5), darkMetalMat)
    roof.position.y = h; roof.castShadow = true; g.add(roof)
    for (let i = -w / 2; i < w / 2; i += 3) addBox(g, .12, .2, d + .5, i, h + .2, 0, rustMat)
    labelSign(scene, label, 'RESTRICTED', x + Math.sin(ry) * (d / 2 + .25) + Math.cos(ry) * 0, top + 3.6, z + Math.cos(ry) * (d / 2 + .25) - Math.sin(ry) * 0, 3.1, 1.4, ry)
    world.enemySpawns.push([x - w / 2 - 6, z], [x + w / 2 + 6, z], [x, z - d / 2 - 6])
    pickupSpots.push([x, top + .8, z])
    landmarks.push({ name: label, x, z })
  }
  hangar(48, 28, 18, 13, -0.08)
  hangar(30, 44, 12, 10, 0.4, 'BUNKER 02')

  // containers
  const containerColors = ['#2f5f5b', '#8c4c2d', '#5d6440', '#394f67', '#8a6a32']
  function container(x, z, ry = 0, stack = 0, colorIdx = 0, size = [6, 2.6, 2.5]) {
    const base = world.groundHeight(x, z) + stack * 2.62
    const tex = containerTexture(containerColors[colorIdx % containerColors.length])
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .7, metalness: .35 })
    const m = addBox(scene, size[0], size[1], size[2], x, base + size[1] / 2, z, mat, ry, true)
    // door bars
    for (const s of [-1, 1]) addBox(scene, .08, size[1] * .9, .06, x + Math.cos(ry) * size[0] * .48, base + size[1] / 2, z - Math.sin(ry) * size[0] * .48 + s * size[2] * .25, blackMat)
    if (stack > 0) addCollider(x, z, size[0], size[2], base, base + size[1], 'container')
    return m
  }
  container(33, 22, 0, 1, 0)
  container(33, 22, 0, 0, 0)
  container(26.5, 26, .1, 0, 1); container(26.7, 23.4, .1, 0, 1)
  container(56, 18, -0.5, 0, 2); container(56.5, 15.5, -0.5, 1, 2)
  container(58, 38, .2, 0, 3)
  container(20, 37, 0, 0, 4); container(18, 40, .1, 1, 4)
  // crates & barrels
  for (const [x,z,s] of [[39,19,1.2],[41.5,18,1],[37.5,34,1.3],[52,33,1.1],[44,42,1.2],[24,31,1],[29,33,1.1]]) crate(x, z, s)
  for (const [x,z] of [[46,20],[43,23],[53,24],[35,39],[50,41],[23,42]]) barrel(x, z)
  for (const [x,z,ry,l] of [[54,28,0,4],[41,31,0,4.5],[28,18,1.57,3.5],[58,32,1.57,3]]) sandbags(x, z, l, ry)

  // watchtower
  function watchtower(x, z) {
    const b = world.groundHeight(x, z)
    const g = new THREE.Group(); g.position.set(x, b, z); scene.add(g)
    for (const [px, pz] of [[-1.4,-1.4],[1.4,-1.4],[-1.4,1.4],[1.4,1.4]]) {
      addBox(g, .22, 4.6, .22, px, 2.3, pz, woodMat, 0, true)
    }
    addBox(g, 3.6, .22, 3.6, 0, 4.5, 0, woodMat, 0, false)
    addBox(g, 3.6, .15, .15, 0, 5.45, -1.7, woodMat)
    addBox(g, 3.6, .15, .15, 0, 5.45, 1.7, woodMat)
    addBox(g, .15, .15, 3.6, -1.7, 5.45, 0, woodMat)
    addBox(g, .15, .15, 3.6, 1.7, 5.45, 0, woodMat)
    for (let i = 0; i < 6; i++) addBox(g, .04, 4.1, .06, -1.85 + 0.06, 2.2, .7 - i * .24, darkMetalMat)
    const roof = addBox(g, 4.4, .12, 4.4, 0, 5.9, 0, rustMat)
    roof.rotation.z = .06
    addPlatform(x, z, 3.6, 3.6, b + 4.6)
    addCollider(x - 1.4, z - 1.4, .4, .4, b, b + 4.6, 'tower')
    addCollider(x + 1.4, z - 1.4, .4, .4, b, b + 4.6, 'tower')
    addCollider(x - 1.4, z + 1.4, .4, .4, b, b + 4.6, 'tower')
    addCollider(x + 1.4, z + 1.4, .4, .4, b, b + 4.6, 'tower')
    world.enemySpawns.push([x + 4, z + 3])
    pickupSpots.push([x + .2, b + 5.3, z + .2])
  }
  watchtower(60, 30)

  // --------------------------------------------------------------------- docks
  const dockX = -70, dockZ = 34
  {
    const b = 0.55
    const g = new THREE.Group(); scene.add(g)
    for (let i = 0; i < 12; i++) {
      const x = dockX + i * 2.8
      addBox(g, 2.7, .18, 3.1, x, b, dockZ, woodMat)
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(.16, .18, 3.4, 7), woodMat)
        post.position.set(x, b - 1.2, dockZ + s * 1.35); post.castShadow = true; g.add(post)
      }
    }
    addPlatform(dockX + 15, dockZ, 34, 3.2, b + .1)
    // shack
    const top = b + .1
    addBox(g, 5, 2.7, 4, dockX + 9, top + 1.35, dockZ - 3.4, woodMat, 0, true)
    const r = addBox(g, 6, .15, 5, dockX + 9, top + 2.8, dockZ - 3.4, roofTealMat); r.rotation.z = .05
    labelSign(g, 'DOCKS', 'PIER 09', dockX + 9, top + 2.1, dockZ - 1.3, 2.5, 1.2, 0)
    // boat
    const boat = new THREE.Group(); boat.position.set(dockX + 25, .5, dockZ + 2.8); scene.add(boat)
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5.2, .8, 1.8), whiteMat); hull.castShadow = true; boat.add(hull)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(.9, 1.8, 4), whiteMat); nose.rotation.z = -Math.PI / 2; nose.rotation.y = Math.PI / 4; nose.position.x = 3.2; boat.add(nose)
    addBox(boat, 2.2, .75, 1.4, -.5, .6, 0, darkMetalMat)
    addBox(boat, .3, .7, .5, -2.6, .35, 0, blackMat)
    world.enemySpawns.push([dockX + 8, dockZ + 4], [dockX + 20, dockZ - 1], [dockX + 4, dockZ - 8])
    pickupSpots.push([dockX + 12, top + .8, dockZ])
    landmarks.push({ name: 'PIER 09', x: dockX + 12, z: dockZ })
  }

  // ----------------------------------------------------------------- radio tower
  {
    const x = -28, z = -68
    const b = world.groundHeight(x, z)
    const g = new THREE.Group(); g.position.set(x, b, z); scene.add(g)
    const h = 20
    const legs = [[-1.6,-1.6],[1.6,-1.6],[-1.6,1.6],[1.6,1.6]]
    for (const [px, pz] of legs) {
      const geo = new THREE.CylinderGeometry(.07, .17, h, 5)
      const m = new THREE.Mesh(geo, rustMat); m.position.set(px * .6, h / 2, pz * .6); m.castShadow = true; g.add(m)
    }
    for (let i = 1; i < 9; i++) {
      const yy = i * h / 9, s = 2.2 - i * .18
      for (const rot of [0, Math.PI / 2]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(s, .06, .06), darkMetalMat)
        bar.position.set(0, yy, 0); bar.rotation.y = rot; g.add(bar)
      }
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), whiteMat)
    dish.rotation.x = -1.2; dish.position.set(.7, h * .73, .3); g.add(dish)
    const red = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2d0a }))
    red.position.y = h + .2; g.add(red)
    const light = new THREE.PointLight(0xff2a00, 2, 12); light.position.y = h + .2; g.add(light)
    world.radioLight = { light, mesh: red }
    const hut = addBox(g, 4.5, 2.8, 3.6, 0, 1.6, 4.5, concreteMat, 0, true)
    addBox(g, 5.2, .15, 4.2, 0, 3.1, 4.5, roofMat)
    world.enemySpawns.push([x + 5, z + 5], [x - 5, z - 5], [x + 3, z - 7])
    pickupSpots.push([x, b + 1.1, z + 4.5])
    landmarks.push({ name: 'RELAY TOWER', x, z })
  }

  // ruins on the bluff
  {
    const x = 56, z = -13
    const b = world.groundHeight(x, z)
    const g = new THREE.Group(); g.position.set(x, b, z); scene.add(g)
    for (let i = 0; i < 5; i++) {
      const w = 2.6 + Math.random() * 2.4, h = 1.2 + Math.random() * 2.6
      const m = addBox(g, w, h, .5, (i - 2) * 3.2, h / 2, (Math.random() - .5) * 3, concrete2Mat, (Math.random() - .5) * .8, true)
      m.rotation.z = (Math.random() - .5) * .08
    }
    for (let i = 0; i < 7; i++) {
      const r = .4 + Math.random() * 1.3
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: 0x827a68, roughness: 1 }))
      rock.position.set((Math.random() - .5) * 18, r * .3, (Math.random() - .5) * 12)
      rock.rotation.set(Math.random(), Math.random(), Math.random()); rock.castShadow = true; g.add(rock)
    }
    world.enemySpawns.push([x - 4, z + 5], [x + 7, z + 3])
    pickupSpots.push([x, b + .8, z])
    landmarks.push({ name: 'OLD RUINS', x, z })
  }

  // central drop-zone beacon
  {
    const x = 0, z = 12, b = world.groundHeight(x, z)
    const g = new THREE.Group(); g.position.set(x, b, z); scene.add(g)
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + .4
      addBox(g, .18, 2.6, .18, Math.cos(a) * 1.7, 1.3, Math.sin(a) * 1.7, darkMetalMat)
    }
    addBox(g, 3.4, .2, 3.4, 0, .1, 0, concrete2Mat)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, .06, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff7a1a }))
    ring.rotation.x = Math.PI / 2; ring.position.y = 2.7; g.add(ring)
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 24, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa246, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false }))
    beacon.position.y = 12; g.add(beacon)
    world.beacon = { ring, beacon }
    world.enemySpawns.push([x + 8, z + 6], [x - 9, z - 4])
    landmarks.push({ name: 'DROP ZONE', x, z })
  }

  // --------------------------------------------------------------------- trees
  const leafGeo = (() => {
    const segs = 10, verts = [], idx = [], uvs = []
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const x = t * 3.6
      const y = -Math.pow(t, 2.1) * 1.55 + t * 0.22
      const w = 0.52 * (1 - Math.pow(t, 1.4)) + 0.03
      verts.push(x, y, -w, x, y, w)
      uvs.push(t, 0, t, 1)
      if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2) }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(idx); g.computeVertexNormals()
    return g
  })()
  const trunkGeo = new THREE.CylinderGeometry(.17, .34, 6.6, 7, 4)
  trunkGeo.translate(0, 3.3, 0)
  const trunkMat = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0x8d6e4d, roughness: 1 })
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4d7a32, roughness: .88, side: THREE.DoubleSide })
  const palmPositions = []
  let attempts = 0
  while (palmPositions.length < 62 && attempts < 3000) {
    attempts++
    const a = Math.random() * Math.PI * 2, r = 12 + Math.sqrt(Math.random()) * 84
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const h = terrainHeight(x, z)
    if (h < 1.4) continue
    if (world.groundHeight(x, z) > h + .1) continue
    let bad = false
    for (const c of colliders) if (Math.abs(x - c.x) < c.hw + 2.5 && Math.abs(z - c.z) < c.hd + 2.5) { bad = true; break }
    for (const p of palmPositions) if (Math.hypot(x - p[0], z - p[1]) < 6) { bad = true; break }
    if (bad) continue
    for (const l of landmarks) if (Math.hypot(x - l.x, z - l.z) < 9) { bad = true; break }
    if (bad) continue
    palmPositions.push([x, z])
  }
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, palmPositions.length)
  trunkMesh.castShadow = true; trunkMesh.receiveShadow = true
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, palmPositions.length * 8)
  leafMesh.castShadow = false; leafMesh.receiveShadow = true
  const nutGeo = new THREE.SphereGeometry(.18, 6, 5)
  const nutMesh = new THREE.InstancedMesh(nutGeo, new THREE.MeshStandardMaterial({ color: 0x4b3422, roughness: 1 }), palmPositions.length * 3)
  nutMesh.castShadow = false
  const dummy = new THREE.Object3D()
  let leafI = 0, nutI = 0
  palmPositions.forEach(([x, z], pi) => {
    const b = terrainHeight(x, z)
    const tilt = (Math.random() - .5) * .18, ang = Math.random() * 6.28
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, ang, (Math.random() - .5) * .1))
    dummy.position.set(x, b, z); dummy.quaternion.copy(q); dummy.scale.set(1, .8 + Math.random() * .5, 1)
    dummy.updateMatrix(); trunkMesh.setMatrixAt(pi, dummy.matrix)
    const top = new THREE.Vector3(0, 6.6, 0).applyQuaternion(q).add(new THREE.Vector3(x, b, z))
    for (let i = 0; i < 8; i++) {
      const a = ang + i / 8 * Math.PI * 2 + Math.random() * .35
      dummy.position.copy(top)
      dummy.rotation.set((Math.random() - .5) * .1, a, .18 + Math.random() * .15)
      dummy.scale.set(.9 + Math.random() * .25, .9 + Math.random() * .2, .9 + Math.random() * .2)
      dummy.updateMatrix(); leafMesh.setMatrixAt(leafI++, dummy.matrix)
    }
    for (let i = 0; i < 3; i++) {
      dummy.position.set(top.x + (Math.random() - .5) * .7, top.y - .35, top.z + (Math.random() - .5) * .7)
      dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix()
      nutMesh.setMatrixAt(nutI++, dummy.matrix)
    }
  })
  scene.add(trunkMesh, leafMesh, nutMesh)

  // bushes and rocks
  const bushGeo = new THREE.IcosahedronGeometry(.8, 0)
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x3f5a2b, roughness: 1, flatShading: true })
  const bushCount = 130
  const bushMesh = new THREE.InstancedMesh(bushGeo, bushMat, bushCount)
  bushMesh.castShadow = !LOWEND
  for (let i = 0; i < bushCount; i++) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.sqrt(Math.random()) * 92
    const x = Math.cos(a) * r, z = Math.sin(a) * r, b = terrainHeight(x, z)
    dummy.position.set(x, Math.max(.4, b) + .3, z)
    dummy.rotation.set(Math.random(), Math.random(), Math.random())
    dummy.scale.set(.7 + Math.random() * 1.5, .5 + Math.random() * .8, .7 + Math.random() * 1.4)
    dummy.updateMatrix(); bushMesh.setMatrixAt(i, dummy.matrix)
  }
  scene.add(bushMesh)

  const rockGeo = new THREE.DodecahedronGeometry(1, 0)
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x797264, roughness: 1, flatShading: true })
  const rockCount = 55
  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockCount)
  rockMesh.castShadow = !LOWEND; rockMesh.receiveShadow = true
  for (let i = 0; i < rockCount; i++) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.sqrt(Math.random()) * 96
    const x = Math.cos(a) * r, z = Math.sin(a) * r, b = terrainHeight(x, z)
    const s = .35 + Math.random() * 1.8
    dummy.position.set(x, Math.max(-.4, b) + s * .25, z)
    dummy.rotation.set(Math.random(), Math.random(), Math.random())
    dummy.scale.set(s * (0.7 + Math.random() * .8), s * .6, s)
    dummy.updateMatrix(); rockMesh.setMatrixAt(i, dummy.matrix)
    if (s > 1.4) addCollider(x, z, s * 1.5, s * 1.5, b, b + s, 'rock')
  }
  scene.add(rockMesh)

  // grass tufts — a single instanced draw call that adds a lot of ground texture
  const tuftGeo = new THREE.ConeGeometry(.055, .5, 3, 1)
  tuftGeo.translate(0, .25, 0)
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })
  const tuftCount = LOWEND ? 900 : 1800
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount)
  const tuftColor = new THREE.Color()
  let ti = 0, tuftTries = 0
  while (ti < tuftCount && tuftTries < tuftCount * 8) {
    tuftTries++
    const a = Math.random() * Math.PI * 2, r = 5 + Math.sqrt(Math.random()) * 100
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    const b = terrainHeight(x, z)
    if (b < 1.1) continue
    let blocked = false
    for (const c of colliders) if (Math.abs(x - c.x) < c.hw + .4 && Math.abs(z - c.z) < c.hd + .4) { blocked = true; break }
    if (blocked) continue
    dummy.position.set(x, b, z)
    dummy.rotation.set((Math.random() - .5) * .3, Math.random() * 6.28, (Math.random() - .5) * .3)
    const sc = .65 + Math.random() * 1.1
    dummy.scale.set(sc * (.7 + Math.random() * .6), sc, sc * (.7 + Math.random() * .6))
    dummy.updateMatrix()
    tuftMesh.setMatrixAt(ti, dummy.matrix)
    tuftColor.setHSL(.24 + Math.random() * .06, .42 + Math.random() * .2, .2 + Math.random() * .14)
    tuftMesh.setColorAt(ti, tuftColor)
    ti++
  }
  tuftMesh.count = ti
  tuftMesh.instanceMatrix.needsUpdate = true
  if (tuftMesh.instanceColor) tuftMesh.instanceColor.needsUpdate = true
  scene.add(tuftMesh)
  world.grass = tuftMesh

  // distant island silhouettes for depth beyond the playable water
  const isleGeo = new THREE.ConeGeometry(1, 1, 7, 1)
  isleGeo.translate(0, .5, 0)
  const isleMat = new THREE.MeshStandardMaterial({ color: 0x5d6f5f, roughness: 1, flatShading: true })
  const isleMesh = new THREE.InstancedMesh(isleGeo, isleMat, 18)
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * .25
    const r = 175 + Math.random() * 90
    const sx = 16 + Math.random() * 28
    dummy.position.set(Math.cos(a) * r, -3 - Math.random() * 2, Math.sin(a) * r)
    dummy.rotation.set(0, Math.random() * 6.28, 0)
    dummy.scale.set(sx, 9 + Math.random() * 17, sx * (.6 + Math.random() * .7))
    dummy.updateMatrix()
    isleMesh.setMatrixAt(i, dummy.matrix)
  }
  scene.add(isleMesh)

  // ------------------------------------------------------------- distant cliffs
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + Math.random() * .2
    const r = 128 + Math.random() * 14
    const s = 3 + Math.random() * 8
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), new THREE.MeshStandardMaterial({ color: 0x6e6a5d, roughness: 1, flatShading: true }))
    rock.position.set(Math.cos(a) * r, -1 + Math.random() * 2, Math.sin(a) * r)
    rock.scale.y = 1.3 + Math.random(); rock.rotation.set(Math.random(), Math.random(), Math.random())
    rock.castShadow = true; scene.add(rock)
  }

  // ----------------------------------------------------------- extra world data
  world.enemySpawns.push(
    [6, -2], [12, 10], [-10, 2], [20, -18], [-18, 22], [-8, 34], [16, 30],
    [4, 52], [-40, 22], [-22, -12], [36, -24], [70, 8], [-72, 18], [62, -34], [-52, 55]
  )
  world.pickupSpots.push([3, world.groundHeight(3, 14) + .6, 14], [12, world.groundHeight(12, 10) + .6, 10], [-18, world.groundHeight(-18, 22) + .6, 22])
  world.spawn = new THREE.Vector3(6, world.groundHeight(6, 17) + 1.75, 17)
  world.spawnYaw = 0.55

  // small physical boundary
  world.clampPosition = (p) => {
    const d = Math.hypot(p.x, p.z)
    if (d > 112) { p.x *= 112 / d; p.z *= 112 / d }
  }

  world.update = (t) => {
    waterMat.uniforms.time.value = t
    if (world.beacon) {
      world.beacon.ring.rotation.z = t * .6
      world.beacon.ring.position.y = 2.7 + Math.sin(t * 2) * .08
      world.beacon.beacon.material.opacity = .12 + Math.sin(t * 1.4) * .035
    }
    if (world.radioLight) {
      const on = (t * 1.2) % 2 < .18
      world.radioLight.light.intensity = on ? 4 : 0.2
      world.radioLight.mesh.material.color.setHex(on ? 0xff3b12 : 0x4b1006)
    }
  }

  return world
}

export function makeGlowTexture() { return glowTexture() }
