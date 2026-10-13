// three.js side of Strata: chunk meshes (one shader for atlas + vertex AO + fog + day/night), sky, sun and moon drawn in code, clouds, stars, the targeted-block
// outline, the crack overlay, the world-border grid and the drop meshes. Everything is in plain sRGB values (no colour management), so the colours in the
// shaders and in the CSS match.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { BLOCKS } from './blocks.js';

THREE.ColorManagement.enabled = false;

const CS = CONFIG.chunk;
// face axes as in worker.js (u x v = outward normal)
const FACE_AXES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] }, { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] }, { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const CHUNK_VS = `
attribute float aBr;
#ifndef ENTITY
attribute float aSky; attribute float aBlk; attribute float aAnim;
#endif
varying vec2 vUv; varying float vBr; varying float vSky; varying float vBlk; varying float vDist;
uniform float uTime; uniform float uWave; uniform float uStride;
#ifdef ENTITY
uniform vec2 uEnt;
#endif
void main() {
  vUv = uv; vBr = aBr;
  #ifdef ENTITY
  vSky = uEnt.x; vBlk = uEnt.y;
  #else
  vSky = aSky; vBlk = aBlk;
  if (aAnim > 0.5) vUv.x += floor(mod(uTime * 3.0, aAnim)) * uStride;      // animated tiles (Rift, server racks, torch flame): frames sit side by side
  #endif
  vec3 p = position;
  #ifdef WATER
  vec4 wp = modelMatrix * vec4(p, 1.0);
  if (fract(p.y) > 0.5) p.y += sin(uTime * 1.7 + wp.x * 0.9 + wp.z * 0.7) * 0.04 * uWave;   // only the exposed surface (1/8 below the top) moves
  #endif
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
// Light: the sky part follows the time of day (uSun = daylight, uTint = its colour), the block part is warm torchlight that flickers a little; the brighter wins.
// Both are baked per vertex as 0..1 (level / 15) and bent with a gamma curve so a torch falls off quickly. uMin is the least light anywhere (a cave is not pitch black).
const CHUNK_FS = `
uniform sampler2D uMap; uniform float uSun; uniform vec3 uTint; uniform vec3 uWarm; uniform float uFlick; uniform float uMin; uniform vec3 uMinCol;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform float uAlpha; uniform float uHurt;
varying vec2 vUv; varying float vBr; varying float vSky; varying float vBlk; varying float vDist;
void main() {
  vec4 t = texture2D(uMap, vUv);
  #ifdef CUTOUT
  if (t.a < 0.5) discard;
  #endif
  vec3 light = max(vec3(pow(vSky, 1.5) * uSun) * uTint, vec3(pow(vBlk, 1.5) * uFlick) * uWarm);
  light = max(light, uMinCol * uMin);
  vec3 c = t.rgb * vBr * light;
  c = mix(c, vec3(1.0, 0.18, 0.12), uHurt);                       // a hurt mob flashes red (uHurt is only ever set on entity materials)
  #ifdef WATER
  c *= vec3(0.62, 0.8, 1.0);                       // deeper blue, so the sea floor does not stripe through
  #endif
  float f = smoothstep(uFogNear, uFogFar, vDist);
  #ifdef WATER
  gl_FragColor = vec4(mix(c, uFogColor, f), uAlpha);
  #else
  gl_FragColor = vec4(mix(c, uFogColor, f), 1.0);
  #endif
}`;

function pixelTexture(draw, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

/** The sun and the moon, drawn in code as square pixel-art discs. */
const sunTexture = () => pixelTexture((g, S) => {
  g.clearRect(0, 0, S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,240,170,0.55)'); gr.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff2a8'; g.fillRect(S * 0.3, S * 0.3, S * 0.4, S * 0.4);
  g.fillStyle = '#ffd84a'; g.fillRect(S * 0.34, S * 0.34, S * 0.32, S * 0.32);
  g.fillStyle = '#fff9d6'; g.fillRect(S * 0.38, S * 0.38, S * 0.14, S * 0.14);
}, 32);
const moonTexture = () => pixelTexture((g, S) => {
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#d9dde8'; g.fillRect(S * 0.3, S * 0.3, S * 0.4, S * 0.4);
  g.fillStyle = '#b4bacb'; g.fillRect(S * 0.36, S * 0.34, S * 0.1, S * 0.1); g.fillRect(S * 0.52, S * 0.5, S * 0.12, S * 0.12); g.fillRect(S * 0.38, S * 0.56, S * 0.08, S * 0.08);
  g.fillStyle = '#eef1f8'; g.fillRect(S * 0.3, S * 0.3, S * 0.4, S * 0.04);
}, 32);

/** Cloud pattern: flat white cells on a 64 x 64 tile (repeats), blocky like everything else. */
const cloudTexture = () => {
  let a = 1234567;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const cells = new Float32Array(16 * 16);
  for (let i = 0; i < 256; i++) cells[i] = r();
  const t = pixelTexture((g, S) => {
    g.clearRect(0, 0, S, S);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = (cells[y * 16 + x] + cells[((y + 1) & 15) * 16 + x] * 0.5 + cells[y * 16 + ((x + 1) & 15)] * 0.5) / 2;
      if (v > 0.62) { g.fillStyle = '#ffffff'; g.fillRect(x * 4, y * 4, 4, 4); }
    }
  }, 64);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

/** 10 crack stages: the same random cracks, a few more drawn at each stage. */
function crackTextures() {
  let s = 99;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const segs = [];
  for (let i = 0; i < 60; i++) {
    const a = r() * Math.PI * 2, len = 3 + r() * 9, x = 16 + (r() - 0.5) * 14, y = 16 + (r() - 0.5) * 14;
    segs.push([Math.round(x), Math.round(y), Math.round(x + Math.cos(a) * len), Math.round(y + Math.sin(a) * len)]);
  }
  return Array.from({ length: 10 }, (_, stage) => pixelTexture((g) => {
    g.clearRect(0, 0, 32, 32);
    g.fillStyle = `rgba(0,0,0,${0.55 + stage * 0.03})`;
    const n = Math.ceil(((stage + 1) / 10) * segs.length);
    for (let i = 0; i < n; i++) {
      const [x0, y0, x1, y1] = segs[i], steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
      for (let k = 0; k <= steps; k++) g.fillRect(Math.round(x0 + ((x1 - x0) * k) / steps), Math.round(y0 + ((y1 - y0) * k) / steps), 1, 1);
    }
  }, 32));
}

export class Renderer {
  constructor(canvas, { low = false } = {}) {
    this.low = low;
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setClearColor(0x87aaf0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.render.fov, 1, CONFIG.render.near, 1000);
    this.camera.rotation.order = 'YXZ';
    this.chunkMeshes = new Map();
    this.time = 0.1;
    this.viewBlocks = CONFIG.view.default * CS;
    this.uniforms = {
      uSun: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uWarm: { value: new THREE.Vector3(1, 0.8, 0.52) }, uFlick: { value: 1 }, uHurt: { value: 0 }, uMin: { value: 0.035 }, uMinCol: { value: new THREE.Vector3(0.8, 0.85, 1) }, uStride: { value: 0 }, uFogColor: { value: new THREE.Vector3(0.7, 0.83, 1) },
      uFogNear: { value: 60 }, uFogFar: { value: 120 }, uTime: { value: 0 }, uWave: { value: low ? 0 : 1 }, uAlpha: { value: 0.82 },
    };
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.tex = {};
    this.dropPool = [];
    this.dropGeo = new Map();
  }

  async init(atlasUrl, itemsUrl) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const load = (u) => loader.loadAsync(u).then((t) => { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; return t; });
    [this.tex.atlas, this.tex.items] = await Promise.all([load(atlasUrl), load(itemsUrl)]);
    this.#materials();
    this.#sky();
    this.#overlays();
    this.crackTex = crackTextures();
  }

  /** `entity`: the light does not come from vertex data but from the uEnt uniform, set per object in onBeforeRender (drops, mobs). */
  #mat(map, { cutout = false, water = false, entity = false, side = THREE.FrontSide } = {}) {
    const defines = {};
    if (cutout) defines.CUTOUT = 1;
    if (water) defines.WATER = 1;
    if (entity) defines.ENTITY = 1;
    return new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, ...this.uniforms, ...(entity ? { uEnt: { value: new THREE.Vector2(1, 0) }, uHurt: { value: 0 } } : {}) }, vertexShader: CHUNK_VS, fragmentShader: CHUNK_FS, defines, side,
      transparent: water, depthWrite: !water,
    });
  }

  /** Screen position (px) of a world point, or null when it is behind the camera. */
  project(x, y, z) {
    const v = (this._pv ??= new THREE.Vector3()).set(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (1 - (v.y * 0.5 + 0.5)) * innerHeight };
  }

  /** A material for models of mobs: lit by the uEnt uniform (set per object) and tinted red by uHurt. */
  entityMaterial(map, { cutout = false } = {}) { return this.#mat(map, { entity: true, cutout }); }

  #materials() {
    this.mat = { opaque: this.#mat(this.tex.atlas), cut: this.#mat(this.tex.atlas, { cutout: true, side: THREE.DoubleSide }), water: this.#mat(this.tex.atlas, { water: true }) };
    this.mat.water.renderOrder = 2;
    this.entMat = this.#mat(this.tex.atlas, { entity: true });
    this.itemMat = this.#mat(this.tex.items, { cutout: true, entity: true, side: THREE.DoubleSide });
  }

  #sky() {
    const sky = this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uTop: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() }, uSunDir: { value: this.sunDir }, uGlow: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform float uGlow; varying vec3 vDir;
        void main() { vec3 d = normalize(vDir); float h = max(d.y, 0.0);
          vec3 c = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.75, h), 0.65));
          c = mix(c, uHorizon * 0.8, smoothstep(0.0, -0.4, d.y));
          c += uGlow * vec3(1.0, 0.55, 0.25) * pow(max(dot(d, normalize(uSunDir)), 0.0), 6.0) * 0.55;
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), sky);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    const quad = (tex) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); m.renderOrder = -9; m.frustumCulled = false; this.scene.add(m); return m; };
    this.sun = quad(sunTexture()); this.moon = quad(moonTexture());

    const n = 450, pos = new Float32Array(n * 3);
    let a = 4242; const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) { const u = r() * 2 - 1, t = r() * Math.PI * 2, q = Math.sqrt(1 - u * u); pos.set([q * Math.cos(t) * 280, u * 280, q * Math.sin(t) * 280], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.renderOrder = -9; this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    if (!this.low) {
      this.cloudMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uMap: { value: cloudTexture() }, uOffset: { value: new THREE.Vector2() }, uColor: { value: new THREE.Vector3(1, 1, 1) }, uFar: { value: 400 } },
        vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform sampler2D uMap; uniform vec2 uOffset; uniform vec3 uColor; uniform float uFar; varying vec3 vW;
          void main() { vec4 t = texture2D(uMap, (vW.xz + uOffset) / 192.0); float d = length(vW.xz - cameraPosition.xz);
            gl_FragColor = vec4(uColor, t.a * 0.85 * (1.0 - smoothstep(uFar * 0.55, uFar, d))); if (gl_FragColor.a < 0.01) discard; }`,
      });
      this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), this.cloudMat);
      this.clouds.rotation.x = -Math.PI / 2; this.clouds.position.y = CONFIG.clouds.y; this.clouds.renderOrder = 1; this.clouds.frustumCulled = false;
      this.scene.add(this.clouds);
    }
  }

  #overlays() {
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 }));
    this.outline.visible = false; this.outline.renderOrder = 3;
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: null, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.crack.visible = false; this.crack.renderOrder = 3;
    this.scene.add(this.outline, this.crack);

    // world border: a faint grid on the wall, fading in within CONFIG.border.gridDist blocks
    const S = CONFIG.worldSize, Hh = CONFIG.height, walls = [];
    const wallMat = (axis, at) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uCam: { value: new THREE.Vector3() }, uAt: { value: at }, uAxis: { value: axis === 'x' ? 0 : 1 }, uMax: { value: CONFIG.border.gridDist } },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uCam; uniform float uAt; uniform float uAxis; uniform float uMax; varying vec3 vW;
        float line(float v) { return 1.0 - smoothstep(0.0, 0.05, abs(fract(v) - 0.5) * 2.0 - 0.9 + 0.0); }
        void main() { float d = abs((uAxis < 0.5 ? uCam.x : uCam.z) - uAt); float fade = 1.0 - clamp(d / uMax, 0.0, 1.0);
          float a = max(line(vW.y + 0.5), line((uAxis < 0.5 ? vW.z : vW.x) + 0.5));
          gl_FragColor = vec4(0.35, 0.85, 1.0, a * fade * 0.55); if (gl_FragColor.a < 0.01) discard; }`,
    });
    for (const [axis, at] of [['x', 0], ['x', S], ['z', 0], ['z', S]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(S, Hh), wallMat(axis, at));
      if (axis === 'x') { m.rotation.y = Math.PI / 2; m.position.set(at, Hh / 2, S / 2); } else m.position.set(S / 2, Hh / 2, at);
      m.frustumCulled = false; m.renderOrder = 4; m.visible = false;
      this.scene.add(m); walls.push(m);
    }
    this.walls = walls;
    this.wallDefs = walls.map((m, i) => ({ m, axis: i < 2 ? 'x' : 'z', at: i % 2 ? CONFIG.worldSize : 0 }));
  }

  /** The atlas layout: animated tiles have their frames in neighbouring cells, `stride` pixels apart. */
  setAtlas(atlas) {
    const stride = Object.values(atlas.tiles).find((t) => t.stride)?.stride ?? 0;
    this.uniforms.uStride.value = stride / atlas.size;
  }

  /** 'overworld' (the sky, sun, moon, stars, clouds) or a sky-less dimension: a fixed dark fog, no celestial bodies, a dim coloured floor of light. */
  setDimension(dim) {
    this.dimension = dim;
    const c = CONFIG.underlayer, under = dim === 'underlayer', kernel = dim === 'kernel';
    if (dim === 'overworld') { this.setAmbient(0.035, [0.8, 0.85, 1]); return; }
    this.setAmbient(under ? c.ambient : 0.05, under ? c.ambientColor : [0.35, 1, 0.55]);
    const fog = under ? c.fog : [0.01, 0.03, 0.02];
    this.uniforms.uFogColor.value.set(...fog); this.gl.setClearColor(new THREE.Color(...fog));
    this.uniforms.uSun.value = 0; this.uniforms.uTint.value.set(1, 1, 1);
    this.skyMat.uniforms.uTop.value.set(...fog); this.skyMat.uniforms.uHorizon.value.set(...fog); this.skyMat.uniforms.uGlow.value = 0;
    this.stars.material.opacity = 0; this.sun.material.opacity = 0; this.moon.material.opacity = 0;
    if (this.cloudMat) this.clouds.visible = false;
    void kernel;
  }

  /** The least light anywhere and its colour (a dimension without a sky has a dim red floor of light). */
  setAmbient(min, col = [0.8, 0.85, 1]) { this.uniforms.uMin.value = min; this.uniforms.uMinCol.value.set(...col); }

  /** Move the four border walls for a world of another size. */
  setWorldSize(S) {
    this.worldSize = S;
    for (const { m, axis, at } of this.wallDefs) {
      const a = at === 0 ? 0 : S;
      m.scale.x = S / CONFIG.worldSize; m.material.uniforms.uAt.value = a;
      if (axis === 'x') m.position.set(a, CONFIG.height / 2, S / 2); else m.position.set(S / 2, CONFIG.height / 2, a);
    }
  }

  // ---------------------------------------------------------------- chunks
  addChunk(chunk, mesh) {
    this.removeChunk(chunk);
    const key = `${chunk.cx},${chunk.cz}`, group = new THREE.Group();
    group.position.set(chunk.cx * CS, 0, chunk.cz * CS);
    for (const [name, mat] of [['opaque', this.mat.opaque], ['cut', this.mat.cut], ['water', this.mat.water]]) {
      const L = mesh[name];
      if (!L.faces) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(L.pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(L.uv, 2));
      g.setAttribute('aBr', new THREE.BufferAttribute(L.br, 1));
      g.setAttribute('aSky', new THREE.BufferAttribute(L.sk, 1));
      g.setAttribute('aBlk', new THREE.BufferAttribute(L.bl, 1));
      g.setAttribute('aAnim', new THREE.BufferAttribute(L.an, 1));
      g.setIndex(new THREE.BufferAttribute(L.idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, CONFIG.height / 2, 8), 75);
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      if (name === 'water') m.renderOrder = 2;
      group.add(m);
    }
    group.updateMatrixWorld(true);
    this.scene.add(group);
    this.chunkMeshes.set(key, group);
  }

  removeChunk(chunk) {
    const key = `${chunk.cx},${chunk.cz}`, g = this.chunkMeshes.get(key);
    if (!g) return;
    this.scene.remove(g);
    g.children.forEach((m) => m.geometry.dispose());
    this.chunkMeshes.delete(key);
  }

  clearChunks() { for (const g of this.chunkMeshes.values()) { this.scene.remove(g); g.children.forEach((m) => m.geometry.dispose()); } this.chunkMeshes.clear(); }

  setView(chunks) {
    this.viewBlocks = chunks * CS;
    this.uniforms.uFogNear.value = this.viewBlocks * 0.55;
    this.uniforms.uFogFar.value = this.viewBlocks * 0.98;
    if (this.cloudMat) this.cloudMat.uniforms.uFar.value = Math.max(260, this.viewBlocks * 1.8);
  }

  // ---------------------------------------------------------------- time of day
  /** t: 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight. Returns the daylight 0..1. */
  setTime(t, now = 0) {
    this.time = t;
    if (this.dimension && this.dimension !== 'overworld') { this.uniforms.uTime.value = now; return 0; }
    if (this.clouds) this.clouds.visible = true;
    const a = t * Math.PI * 2, sunH = Math.sin(a);
    this.sunDir.set(Math.cos(a), sunH, 0.25).normalize();
    const day = smooth(-0.12, 0.2, sunH), glow = Math.exp(-((sunH / 0.2) ** 2));
    const top = mixv([0.015, 0.02, 0.07], [0.3, 0.55, 0.95], day), hor0 = mixv([0.045, 0.06, 0.15], [0.68, 0.83, 1.0], day), hor = mixv(hor0, [1.0, 0.58, 0.32], glow * 0.7);
    this.skyMat.uniforms.uTop.value.set(...top); this.skyMat.uniforms.uHorizon.value.set(...hor); this.skyMat.uniforms.uGlow.value = glow * day;
    this.uniforms.uFogColor.value.set(...hor);
    this.gl.setClearColor(new THREE.Color(...hor));
    this.uniforms.uSun.value = 0.2 + 0.8 * day;
    const tint = mixv([0.55, 0.62, 1.0], [1.0, 0.99, 0.95], day);
    this.uniforms.uTint.value.set(tint[0] * (1 + glow * 0.12), tint[1] * (1 - glow * 0.08), tint[2] * (1 - glow * 0.18));
    this.uniforms.uTime.value = now;
    this.stars.material.opacity = 1 - smooth(-0.15, 0.1, sunH);
    this.sun.material.opacity = smooth(-0.06, 0.08, sunH);
    this.moon.material.opacity = smooth(-0.06, 0.08, -sunH);
    if (this.cloudMat) { const c = mixv([0.35, 0.4, 0.6], [1, 1, 1], day); this.cloudMat.uniforms.uColor.value.set(c[0] * (1 + glow * 0.1), c[1], c[2] * (1 - glow * 0.12)); this.cloudMat.uniforms.uOffset.value.set(now * CONFIG.clouds.speed, 0); }
    return day;
  }

  // ---------------------------------------------------------------- overlays
  setTarget(hit) {
    this.outline.visible = !!hit;
    if (hit) this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }
  /** progress 0..1 of the block being mined (null / 0 hides the cracks) */
  setCrack(hit, progress) {
    const stage = Math.min(9, Math.floor(progress * 10));
    this.crack.visible = !!hit && progress > 0;
    if (!this.crack.visible) return;
    this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crack.material.map = this.crackTex[stage];
    this.crack.material.needsUpdate = true;
  }

  // ---------------------------------------------------------------- drops
  #dropGeometry(visual, atlas) {
    const key = visual.block !== undefined ? `b${visual.block}` : `i${visual.sheet}`;
    let g = this.dropGeo.get(key);
    if (g) return g;
    g = new THREE.BufferGeometry();
    if (visual.block !== undefined) {
      const tiles = BLOCKS[visual.block].tiles, size = 0.25, pos = [], uv = [], br = [], idx = [];
      FACE_AXES.forEach((F, f) => {
        const rect = atlas.rect(tiles[f]), base = pos.length / 3;
        for (const [cu, cv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          pos.push(...[0, 1, 2].map((k) => (F.n[k] * 0.5 + F.u[k] * (cu - 0.5) + F.v[k] * (cv - 0.5)) * size));
          uv.push(rect[0] + (rect[2] - rect[0]) * cu, rect[1] + (rect[3] - rect[1]) * cv);
          br.push([0.8, 0.8, 1, 0.55, 0.7, 0.7][f]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aBr', new THREE.Float32BufferAttribute(br, 1));
      g.setIndex(idx);
    } else {
      const r = atlas.icon(visual.sheet), s = 0.2;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([r[0], r[1], r[2], r[1], r[2], r[3], r[0], r[3]], 2));
      g.setAttribute('aBr', new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
      g.setIndex([0, 1, 2, 0, 2, 3]);
    }
    this.dropGeo.set(key, g);
    return g;
  }

  /** drops: [{ x, y, z, spin, visual, light: [sky, block] (0..1) }]; atlas: { rect(tile), icon(name) } gives UV rects. Meshes are pooled; each is lit by its own cell. */
  setDrops(drops, atlas) {
    while (this.dropPool.length < drops.length) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.entMat); m.frustumCulled = false;
      m.onBeforeRender = (r, sc, cam, geo, material) => { material.uniforms.uEnt.value.set(m.userData.sky ?? 1, m.userData.blk ?? 0); material.uniformsNeedUpdate = true; };
      this.scene.add(m); this.dropPool.push(m);
    }
    this.dropPool.forEach((m, i) => {
      const d = drops[i];
      m.visible = !!d;
      if (!d) return;
      m.geometry = this.#dropGeometry(d.visual, atlas);
      m.material = d.visual.block !== undefined ? this.entMat : this.itemMat;
      m.position.set(d.x, d.y, d.z);
      m.rotation.y = d.spin;
      m.userData.sky = d.light?.[0] ?? 1; m.userData.blk = d.light?.[1] ?? 0;
    });
  }

  // ---------------------------------------------------------------- frame
  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, this.low ? 1 : CONFIG.render.dprMax);
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(now = 0) {
    const cam = this.camera.position;
    this.sky.position.copy(cam); this.stars.position.copy(cam);
    this.sun.position.copy(cam).addScaledVector(this.sunDir, 250); this.sun.lookAt(cam);
    this.moon.position.copy(cam).addScaledVector(this.sunDir, -250); this.moon.lookAt(cam);
    if (this.clouds) this.clouds.position.set(cam.x, CONFIG.clouds.y, cam.z);
    const g = CONFIG.border.gridDist;
    this.walls.forEach((w, i) => { const u = w.material.uniforms; u.uCam.value.copy(cam); const d = Math.abs((i < 2 ? cam.x : cam.z) - u.uAt.value); w.visible = d < g; });
    this.uniforms.uTime.value = now;
    this.uniforms.uFlick.value = 1 + 0.04 * Math.sin(now * 11.3) * Math.sin(now * 7.1 + 1.3);
    this.gl.render(this.scene, this.camera);
  }

  get info() { return this.gl.info.render; }
  dispose() { this.clearChunks(); this.gl.dispose(); }
}
