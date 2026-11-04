import * as THREE from '../vendor/three.module.js';

/* ============================================================
   Effects: particles, tracers, sky, clouds
   ============================================================ */

export function makeRadialTexture(inner = 'rgba(255,245,210,1)', outer = 'rgba(255,120,20,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 18; i++) {
    const x = 25 + Math.random() * 206;
    const y = 58 + Math.random() * 38;
    const r = 16 + Math.random() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,.34)');
    g.addColorStop(0.6, 'rgba(255,255,255,.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  constructor(scene, quality = 'high') {
    const geo = new THREE.SphereGeometry(1200, 32, 18);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2f6fa8) },
        midColor: { value: new THREE.Color(0x8fc0dc) },
        bottomColor: { value: new THREE.Color(0xf0c99d) },
        sunDir: { value: new THREE.Vector3(-0.42, 0.26, -0.86).normalize() }
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        uniform vec3 sunDir;
        varying vec3 vWorld;
        void main() {
          vec3 d = normalize(vWorld);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.22, h));
          col = mix(col, topColor, smoothstep(0.18, 0.75, h));
          float sun = pow(max(dot(d, sunDir), 0.0), 220.0);
          col += vec3(1.0, 0.78, 0.42) * sun * 0.9;
          float haze = pow(max(dot(d, sunDir), 0.0), 8.0);
          col += vec3(1.0, 0.55, 0.24) * haze * 0.16;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    const sunTex = makeRadialTexture('rgba(255,250,220,1)', 'rgba(255,140,40,0)');
    const sunMat = new THREE.SpriteMaterial({
      map: sunTex, color: 0xffd9a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    });
    this.sun = new THREE.Sprite(sunMat);
    this.sun.position.set(-520, 300, -1050);
    this.sun.scale.set(300, 300, 1);
    this.sun.renderOrder = -9;
    scene.add(this.sun);

    this.clouds = [];
    const cloudTex = makeCloudTexture();
    const n = quality === 'high' ? 14 : 7;
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({
        map: cloudTex, color: 0xffffff, transparent: true,
        opacity: 0.24 + Math.random() * 0.18, depthWrite: false
      });
      const s = new THREE.Sprite(m);
      s.position.set((Math.random() - 0.5) * 1400, 150 + Math.random() * 130, (Math.random() - 0.5) * 1400);
      const w = 130 + Math.random() * 220;
      s.scale.set(w, w * 0.42, 1);
      s.userData.speed = 1.4 + Math.random() * 2.6;
      scene.add(s);
      this.clouds.push(s);
    }
  }

  update(dt, time) {
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 820) c.position.x = -820;
    }
    if (this.sun) this.sun.material.opacity = 0.9 + Math.sin(time * 0.25) * 0.04;
  }
}

export class ParticleSystem {
  constructor(scene, max = 600) {
    this.max = max;
    this.scene = scene;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.baseColor = new Float32Array(max * 3);
    this.cursor = 0;
    for (let i = 0; i < max; i++) this.positions[i * 3 + 1] = -9999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  spawn(pos, color, count = 8, speed = 4, gravity = 8, life = 0.5) {
    const c = new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.positions[i * 3] = pos.x;
      this.positions[i * 3 + 1] = pos.y;
      this.positions[i * 3 + 2] = pos.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.vel[i * 3] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[i * 3 + 1] = Math.cos(phi) * s * 0.9 + speed * 0.2;
      this.vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * s;
      const l = life * (0.6 + Math.random() * 0.8);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.gravity[i] = gravity;
      this.baseColor[i * 3] = c.r;
      this.baseColor[i * 3 + 1] = c.g;
      this.baseColor[i * 3 + 2] = c.b;
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -9999;
        continue;
      }
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.colors[i * 3] = this.baseColor[i * 3] * f;
      this.colors[i * 3 + 1] = this.baseColor[i * 3 + 1] * f;
      this.colors[i * 3 + 2] = this.baseColor[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) {
      this.life[i] = 0;
      this.positions[i * 3 + 1] = -9999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export class TracerSystem {
  constructor(scene, count = 30) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 5;
      scene.add(line);
      this.items.push({ line, life: 0, maxLife: 0.1 });
    }
    this.cursor = 0;
  }

  spawn(from, to, color = 0xffd27a) {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const pos = item.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    item.line.material.color.setHex(color);
    item.line.material.opacity = 0.95;
    item.line.visible = true;
    item.life = 0.11;
    item.maxLife = 0.11;
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      if (item.life <= 0) {
        item.line.visible = false;
        item.line.material.opacity = 0;
      } else {
        item.line.material.opacity = (item.life / item.maxLife) * 0.95;
      }
    }
  }

  clear() {
    for (const item of this.items) {
      item.life = 0;
      item.line.visible = false;
    }
  }
}
