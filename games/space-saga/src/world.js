// The scenery: treadmill track (procedural), side decor (kit models), starfield, planets, lighting, pop-up ad debris.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { MODELS } from './assets.js';
import { setPlanetRadius } from './curve.js';

const SKY = 0x090818;
const DIV = 8;            // the planet bend works per vertex, so long meshes need cuts (2.5 m along the track)

function floorTexture() {
  const W = 512, H = 1024;                                      // 9.2 m x 20 m
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#12131f'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(${90 + (i % 5) * 20},${100 + (i % 7) * 15},140,${0.03 + (i % 9) * 0.006})`; g.fillRect((i * 97) % W, (i * 331) % H, 2 + (i % 3), 2 + (i % 4)); }
  g.strokeStyle = '#1c1e30'; g.lineWidth = 3;                   // panel seams (the pattern repeats exactly every segment)
  for (let y = 0; y <= H; y += 256) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  const px = (m) => (m / 9.2 + 0.5) * W;                         // metres from the centre -> canvas x
  g.shadowColor = '#3de0ff'; g.shadowBlur = 10; g.strokeStyle = '#46d7f5'; g.lineWidth = 4;
  g.setLineDash([60, 40]);                                       // dashed lane lines between lanes
  for (const m of [-1.3, 1.3]) { g.beginPath(); g.moveTo(px(m), 0); g.lineTo(px(m), H); g.stroke(); }
  g.setLineDash([]);
  g.shadowColor = '#ff3df0'; g.strokeStyle = '#ff5af2'; g.lineWidth = 6;                       // solid edge lines
  for (const m of [-3.95, 3.95]) { g.beginPath(); g.moveTo(px(m), 0); g.lineTo(px(m), H); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The pop-up ad drifting past as debris (a DOM-ination callback). */
function adTexture() {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#c0c0c0'; g.fillRect(0, 0, 320, 200);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 2); g.fillRect(0, 0, 2, 200);
  g.fillStyle = '#000080'; g.fillRect(4, 4, 312, 24);
  g.fillStyle = '#fff'; g.font = 'bold 16px sans-serif'; g.fillText('CONGRATULATIONS!!!', 10, 22);
  g.fillStyle = '#c0c0c0'; g.fillRect(292, 7, 20, 18); g.fillStyle = '#000'; g.fillText('x', 298, 22);
  g.fillStyle = '#fff'; g.fillRect(10, 36, 300, 110);
  g.fillStyle = '#000'; g.font = '20px sans-serif'; g.fillText('You won a', 24, 66);
  g.fillStyle = '#d00000'; g.font = 'bold 44px sans-serif'; g.fillText('FREE GPU!', 24, 118);
  g.fillStyle = '#00a000'; g.fillRect(90, 156, 140, 32);
  g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText('CLAIM NOW', 106, 178);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Regolith for the planet surface: dark violet-teal speckle with craters. Tiles in both directions (every feature is drawn wrapped). */
function groundTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#4a4a78'; g.fillRect(0, 0, S, S);
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wrap = (x, y, fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(x + dx, y + dy); };
  for (let i = 0; i < 420; i++) {                                  // large soft patches
    const x = r() * S, y = r() * S, rad = 20 + r() * 50, h = r() < 0.5 ? '70,60,120' : '40,90,110';
    wrap(x, y, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, rad); gr.addColorStop(0, `rgba(${h},0.10)`); gr.addColorStop(1, `rgba(${h},0)`); g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2); });
  }
  for (let i = 0; i < 14; i++) {                                   // craters: dark bowl, bright rim on the sun side
    const x = r() * S, y = r() * S, rad = 8 + r() * 26;
    wrap(x, y, (px, py) => {
      g.fillStyle = 'rgba(8,8,22,0.45)'; g.beginPath(); g.ellipse(px, py, rad, rad * 0.8, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(150,150,210,0.35)'; g.lineWidth = 2; g.beginPath(); g.ellipse(px, py - 1.5, rad, rad * 0.8, 0, 3.4, 6.0); g.stroke();
    });
  }
  for (let i = 0; i < 2600; i++) { const v = 90 + r() * 120; g.fillStyle = `rgba(${v},${v},${v + 40},${0.04 + r() * 0.1})`; const s = 1 + r() * 2.5; g.fillRect(r() * S, r() * S, s, s); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export class World {
  constructor({ scene, assets, rng, low }) {
    this.scene = scene;
    this.assets = assets;
    this.rng = rng;
    this.low = low;
    this.segs = [];
    this.decorPool = new Map();
    this.planets = [];
    this.shards = [];
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(CONFIG.fog.color, CONFIG.fog.near, CONFIG.fog.far);
    setPlanetRadius(CONFIG.planet.radius);
    this.#lights();
    this.#track();
    this.#sky();
    this.#planets();
    this.#shardPool();
    this.adTex = adTexture();
    this.adGeo = new THREE.BoxGeometry(2.0, 1.25, 0.08);
    this.adMats = [0, 1, 2, 3, 5].map(() => new THREE.MeshBasicMaterial({ color: 0x20243a }));
    this.adMats.splice(4, 0, new THREE.MeshBasicMaterial({ map: this.adTex }));
  }

  #lights() {
    const { scene } = this;
    scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x2b1d46, 1.35));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dd, 1.9);
    sun.position.set(-5, 11, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 30 });
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.5 }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.position.y = 0.03;
    this.catcher.receiveShadow = true;
    scene.add(this.catcher);
  }

  #track() {
    const { segLen, segs, halfWidth } = CONFIG.track;
    const floorMat = new THREE.MeshBasicMaterial({ map: floorTexture() });
    const floorGeo = new THREE.PlaneGeometry(halfWidth * 2, segLen, 1, DIV);
    const railGeo = new THREE.BoxGeometry(0.45, 0.5, segLen, 1, 1, DIV);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x1a2040, roughness: 0.5, metalness: 0.6 });
    const stripGeo = new THREE.BoxGeometry(0.12, 0.08, segLen, 1, 1, DIV);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xff4df0 });
    const { ground, halfWidth: gw } = CONFIG.planet;
    const bedGeo = new THREE.BoxGeometry(halfWidth * 2 + 1, -ground, segLen, 1, 1, DIV);                   // the road bed the track rests on
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x141828, roughness: 0.7, metalness: 0.4 });
    const groundGeo = new THREE.PlaneGeometry(gw * 2, segLen, gw / 2, DIV);
    const base = groundTexture();
    base.repeat.set(gw * 2 / segLen, 1);
    const groundMats = [0, 0.37, 0.71].map((o) => {                                              // three offsets so the 20 m repeat is harder to spot
      const m = base.clone(); m.repeat.copy(base.repeat); m.offset.set(o, 0); m.needsUpdate = true;
      return new THREE.MeshLambertMaterial({ map: m, emissive: 0xffffff, emissiveMap: m, emissiveIntensity: 0.32 });   // the emissive term keeps it readable in the dark
    });
    for (let i = 0; i < segs; i++) {
      const g = new THREE.Group();
      const f = new THREE.Mesh(floorGeo, floorMat);
      f.rotation.x = -Math.PI / 2;
      g.add(f);
      const bed = new THREE.Mesh(bedGeo, bedMat); bed.position.y = ground / 2;
      const gr = new THREE.Mesh(groundGeo, groundMats[i % groundMats.length]);
      gr.rotation.x = -Math.PI / 2; gr.position.y = ground;
      g.add(bed, gr);
      for (const s of [-1, 1]) {
        const r = new THREE.Mesh(railGeo, railMat); r.position.set(s * (halfWidth + 0.1), 0.25, 0);
        const st = new THREE.Mesh(stripGeo, stripMat); st.position.set(s * (halfWidth + 0.1), 0.54, 0);
        g.add(r, st);
      }
      g.userData.decor = [];
      this.scene.add(g);
      this.segs.push(g);
    }
    this.reset();
  }

  /** Put segments back in a row (segment 0 spans z 0..+20, the last one ends 220 m ahead) and re-roll their decor. */
  reset() {
    const { segLen } = CONFIG.track;
    this.segs.forEach((g, i) => { g.position.z = segLen / 2 - i * segLen; this.#decorate(g); });
  }

  #takeDecor(name) {
    const pool = this.decorPool.get(name);
    return pool?.length ? pool.pop() : this.assets.instance(name);
  }

  #decorate(seg) {
    for (const d of seg.userData.decor) { seg.remove(d); (this.decorPool.get(d.userData.model) ?? this.decorPool.set(d.userData.model, []).get(d.userData.model)).push(d); }
    seg.userData.decor.length = 0;
    const { rng } = this;
    const [lo, hi] = this.low ? CONFIG.decor.perSideLow : CONFIG.decor.perSide;
    const half = CONFIG.track.segLen / 2;
    for (const side of [-1, 1]) {
      const n = lo + Math.floor(rng() * (hi - lo + 1));
      for (let k = 0; k < n; k++) {
        const u = Math.pow(rng(), CONFIG.decor.nearBias);                                          // more props near the track, a scatter out to the horizon
        const name = MODELS.decor[Math.floor(rng() * MODELS.decor.length)];
        const d = this.#takeDecor(name);
        const s = (0.85 + rng() * 0.45) * (1 + u * 0.7);
        d.userData.model = name;
        d.scale.setScalar(s);
        d.rotation.y = rng() * Math.PI * 2;
        d.position.set(side * (CONFIG.decor.xMin + u * (CONFIG.decor.xMax - CONFIG.decor.xMin)), CONFIG.planet.ground - 0.02, (rng() * 2 - 1) * half * 0.95);
        seg.add(d);
        seg.userData.decor.push(d);
      }
    }
  }

  #sky() {
    this.sky = new THREE.Group();
    const n = CONFIG.stars.count, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const tints = [[1, 1, 1], [0.7, 0.85, 1], [1, 0.8, 0.9], [1, 0.95, 0.7]];
    for (let i = 0; i < n; i++) {
      const u = this.rng() * 2 - 1, a = this.rng() * Math.PI * 2, r = Math.sqrt(1 - u * u), R = CONFIG.stars.radius;
      pos.set([R * r * Math.cos(a), R * u, R * r * Math.sin(a)], i * 3);
      const t = tints[i % tints.length], b = 0.45 + this.rng() * 0.55;
      col.set([t[0] * b, t[1] * b, t[2] * b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.sky.add(this.stars);
    this.scene.add(this.sky);
  }

  #planets() {
    const spots = [[-170, 55, -560], [230, 95, -780], [60, 175, -430]];
    MODELS.planets.forEach((name, i) => {
      const p = this.assets.instance(name);
      p.position.set(...spots[i]);
      p.userData.drift = (i % 2 ? -1 : 1) * (0.35 + i * 0.1);
      this.scene.add(p);
      this.planets.push(p);
    });
  }

  #shardPool() {
    const geo = new THREE.PlaneGeometry(0.34, 0.26);
    const cols = [0xc0c0c0, 0x000080, 0xffffff, 0xd00000, 0x00a000];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, transparent: true }));
      m.visible = false;
      m.userData = { v: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 };
      this.scene.add(m);
      this.shards.push(m);
    }
  }

  /** The popup mesh a spawner places (decorative; the spawner owns its position). */
  makePopup() { return new THREE.Mesh(this.adGeo, this.adMats); }

  shatter(pos) {
    this.shards.forEach((s, i) => {
      s.visible = true;
      s.position.copy(pos);
      s.userData.life = 0.7;
      s.userData.v.set((this.rng() - 0.5) * 6, 1 + this.rng() * 4, (this.rng() - 0.5) * 4);
      s.userData.spin.set(this.rng() * 8, this.rng() * 8, this.rng() * 8);
      s.material.opacity = 1;
    });
  }

  setLow(low) {
    this.low = low;
    this.stars.geometry.setDrawRange(0, low ? CONFIG.stars.low : CONFIG.stars.count);
    this.sun.castShadow = !low;
    this.catcher.visible = !low;
    this.segs.forEach((g) => this.#decorate(g));
  }

  /** @param dz how far the world moved toward the camera this step */
  update(dz, dt, camera) {
    const { segLen, segs } = CONFIG.track;
    for (const g of this.segs) {
      g.position.z += dz;
      if (g.position.z > segLen * 1.5) { g.position.z -= segLen * segs; this.#decorate(g); }    // fully behind the camera: send to the far end
    }
    this.stars.rotation.y += dt * 0.004;
    this.stars.rotation.x += dt * 0.0015;
    this.sky.position.copy(camera.position);
    for (const p of this.planets) { p.position.x += p.userData.drift * dt; p.rotation.y += dt * 0.03; }
    for (const s of this.shards) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; continue; }
      u.v.y -= 9 * dt;
      s.position.addScaledVector(u.v, dt);
      s.position.z += dz;
      s.rotation.x += u.spin.x * dt; s.rotation.y += u.spin.y * dt;
      s.material.opacity = Math.min(1, u.life / 0.4);
    }
  }
}
