// Mobs on screen: every model is built in code from boxes, every face is painted procedurally into ONE small atlas at startup (16 x 16 px per texture, pixel-art palettes
// per mob), so there is nothing to download. A MobRenderer keeps one model (a three.js Group) per Mob, animates its limbs from the walking speed, points the head, flashes
// it red when it is hurt, tips it over when it dies, and lights it with the light of the cell it stands in (the ENTITY shader of renderer.js).
import * as THREE from 'three';
import { MOBS } from './mobdefs.js';

const T = 16;                                        // texture size in pixels
const FACE_SHADE = [0.8, 0.8, 1.0, 0.55, 0.7, 0.7];  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex = (s) => { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb = (c, k = 1) => `rgb(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(clamp(c[2] * k, 0, 255))})`;
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const hashStr = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Paint one 16 x 16 texture: a base colour with a pattern, and (for heads) a face. */
function paint(g, x0, y0, spec, seed, withFace) {
  const r = rng(seed), base = hex(spec.base), alt = spec.alt ? hex(spec.alt) : base.map((v) => v * 0.8);
  g.fillStyle = rgb(base); g.fillRect(x0, y0, T, T);
  const px = (x, y, c) => { g.fillStyle = typeof c === 'string' ? c : rgb(c); g.fillRect(x0 + x, y0 + y, 1, 1); };
  switch (spec.pattern) {
    case 'spots': for (let i = 0; i < 5; i++) { const cx = Math.floor(r() * T), cy = Math.floor(r() * T), w = 2 + Math.floor(r() * 4), h = 2 + Math.floor(r() * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cx + x < T && cy + y < T) px(cx + x, cy + y, alt); } break;
    case 'stripes': for (let y = 0; y < T; y += 3) for (let x = 0; x < T; x++) px(x, y, alt); break;
    case 'wool': for (let i = 0; i < 46; i++) px(Math.floor(r() * T), Math.floor(r() * T), rgb(r() < 0.5 ? alt : base.map((v) => Math.min(255, v + 12)))); break;
    case 'plates': for (let y = 0; y < T; y += 4) for (let x = 0; x < T; x++) px(x, y, alt); for (let x = 0; x < T; x += 5) for (let y = 0; y < T; y++) px(x, y, alt); break;
    case 'grid': for (let i = 0; i < T; i += 4) for (let k = 0; k < T; k++) { px(i, k, alt); px(k, i, alt); } break;
    default: for (let i = 0; i < 22; i++) px(Math.floor(r() * T), Math.floor(r() * T), rgb(base, 0.93 + r() * 0.14));
  }
  if (withFace) face(px, spec.face, base, alt);
}

function face(px, kind, base, alt) {
  const dark = [24, 22, 28], white = [245, 245, 245];
  switch (kind) {
    case 'pig': px(3, 6, dark); px(4, 6, dark); px(11, 6, dark); px(12, 6, dark); for (let x = 5; x < 11; x++) for (let y = 10; y < 13; y++) px(x, y, [240, 170, 180]); px(6, 11, dark); px(9, 11, dark); break;
    case 'cow': px(3, 6, dark); px(4, 6, dark); px(11, 6, dark); px(12, 6, dark); for (let x = 4; x < 12; x++) for (let y = 10; y < 14; y++) px(x, y, [218, 178, 158]); px(6, 11, dark); px(9, 11, dark); break;
    case 'sheep': px(3, 6, white); px(4, 6, dark); px(11, 6, dark); px(12, 6, white); for (let x = 6; x < 10; x++) px(x, 11, [200, 130, 130]); break;
    case 'chicken': px(3, 5, dark); px(4, 5, dark); px(11, 5, dark); px(12, 5, dark); break;
    case 'zombie': px(3, 5, [20, 40, 20]); px(4, 5, [20, 40, 20]); px(11, 5, [20, 40, 20]); px(12, 5, [20, 40, 20]); for (let x = 4; x < 12; x++) px(x, 11, [30, 50, 30]); break;
    case 'skull': for (const [x, y] of [[3, 5], [4, 5], [3, 6], [4, 6], [11, 5], [12, 5], [11, 6], [12, 6]]) px(x, y, dark); for (let x = 5; x < 11; x += 2) for (let y = 11; y < 14; y++) px(x, y, dark); break;
    case 'spider': for (const x of [3, 5, 9, 11]) for (const y of [4, 5]) px(x, y, [255, 40, 40]); break;
    case 'ad': for (let x = 2; x < 14; x++) for (let y = 3; y < 13; y++) px(x, y, [250, 250, 250]); for (let x = 2; x < 14; x++) px(x, 3, [0, 0, 128]); px(12, 3, [220, 40, 40]); for (let x = 4; x < 11; x++) px(x, 6, [70, 70, 70]); for (let x = 4; x < 9; x++) px(x, 8, [70, 70, 70]); for (let x = 7; x < 12; x++) for (let y = 9; y < 12; y++) px(x, y, [30, 160, 50]); break;
    case 'imp': px(3, 5, [255, 220, 60]); px(4, 5, [255, 220, 60]); px(11, 5, [255, 220, 60]); px(12, 5, [255, 220, 60]); for (let x = 5; x < 11; x++) px(x, 11, [40, 10, 10]); break;
    case 'glitch': for (let i = 0; i < 18; i++) px((i * 7) % T, (i * 5) % T, i % 2 ? [255, 60, 220] : [60, 255, 240]); px(4, 6, white); px(11, 6, white); break;
    case 'bin': for (let x = 3; x < 13; x++) px(x, 4, dark); px(5, 7, [120, 255, 150]); px(10, 7, [120, 255, 150]); for (let x = 4; x < 12; x++) px(x, 12, dark); break;
    case 'core': for (let x = 4; x < 12; x++) for (let y = 4; y < 12; y++) px(x, y, [120, 255, 170]); for (let x = 6; x < 10; x++) for (let y = 6; y < 10; y++) px(x, y, [255, 255, 255]); break;
    default: void base; void alt;
  }
}

/** One canvas with every texture of every mob; { canvas, rect(mob, key, withFace) -> [u0, v0, u1, v1] }. */
export function buildMobAtlas() {
  const entries = [];
  for (const [mob, def] of Object.entries(MOBS)) for (const [key, spec] of Object.entries(def.model.tex)) { entries.push([mob, key, spec, false]); if (spec.face) entries.push([mob, key, spec, true]); }
  const cols = 16, rows = Math.ceil(entries.length / cols), canvas = document.createElement('canvas');
  canvas.width = cols * T; canvas.height = rows * T;
  const g = canvas.getContext('2d'), index = new Map();
  entries.forEach(([mob, key, spec, withFace], i) => { const x = (i % cols) * T, y = Math.floor(i / cols) * T; paint(g, x, y, spec, hashStr(`${mob}.${key}`) + (withFace ? 77 : 0), withFace); index.set(`${mob}.${key}.${withFace ? 1 : 0}`, [x, y]); });
  const W = canvas.width, H = canvas.height;
  const rect = (mob, key, withFace = false) => { const [x, y] = index.get(`${mob}.${key}.${withFace ? 1 : 0}`) ?? index.get(`${mob}.${key}.0`); return [(x + 0.5) / W, 1 - (y + T - 0.5) / H, (x + T - 0.5) / W, 1 - (y + 0.5) / H]; };
  return { canvas, rect, tiles: entries.length };
}

/** A BoxGeometry sized in pixels whose faces use atlas rects (the front, -z, may use a different one: a face) and carry the per-face shade the entity shader wants. */
function boxGeometry(size, rectAll, rectFront) {
  const g = new THREE.BoxGeometry(size[0] / 16, size[1] / 16, size[2] / 16), uv = g.attributes.uv, br = new Float32Array(24);
  for (let f = 0; f < 6; f++) {
    const r = f === 5 && rectFront ? rectFront : rectAll;
    uv.setXY(f * 4 + 0, r[0], r[3]); uv.setXY(f * 4 + 1, r[2], r[3]); uv.setXY(f * 4 + 2, r[0], r[1]); uv.setXY(f * 4 + 3, r[2], r[1]);
    for (let k = 0; k < 4; k++) br[f * 4 + k] = FACE_SHADE[f];
  }
  g.setAttribute('aBr', new THREE.BufferAttribute(br, 1));
  return g;
}

/** The three.js model of one mob type. Returns { root, parts: [{ group, mesh, spec }], bare? }. */
function buildModel(type, atlas, material) {
  const def = MOBS[type], root = new THREE.Group(), parts = [];
  for (const spec of def.model.parts) {
    const tex = def.model.tex[spec.tex], rectAll = atlas.rect(type, spec.tex, false), rectFront = tex?.face ? atlas.rect(type, spec.tex, true) : null;
    const geo = boxGeometry(spec.size, rectAll, rectFront), mesh = new THREE.Mesh(geo, material), group = new THREE.Group();
    group.position.set(spec.at[0] / 16, spec.at[1] / 16, spec.at[2] / 16);
    if (spec.limb?.pivot === 'top') mesh.position.y = -spec.size[1] / 32;
    group.add(mesh); root.add(group);
    const rec = { group, mesh, spec, geo };
    if (spec.wool && def.model.tex.woolBare) rec.bareGeo = boxGeometry(spec.size, atlas.rect(type, 'woolBare', false), null);
    parts.push(rec);
  }
  return { root, parts, def };
}

export class MobRenderer {
  /** @param game the Renderer of renderer.js: needs .scene and .entityMaterial(map) */
  constructor(game) {
    this.game = game;
    this.atlas = buildMobAtlas();
    this.tex = new THREE.CanvasTexture(this.atlas.canvas);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter; this.tex.generateMipmaps = false; this.tex.colorSpace = THREE.NoColorSpace;
    this.material = game.entityMaterial(this.tex, { cutout: true });
    this.models = new Map();            // mob id -> { model, mob }
    this.pool = [];                     // spare models by type
    this.puffs = [];                    // death smoke: { mesh, vx, vy, vz, t }
  }

  /** Create, move, animate and remove models so they match `mobs`. light(x, y, z) -> [sky, block] (0..1). */
  sync(mobs, now, light, dt = 0.016) {
    const live = new Set(mobs.map((m) => m.id));
    for (const [id, rec] of this.models) if (!live.has(id)) { this.game.scene.remove(rec.model.root); this.models.delete(id); }
    for (const m of mobs) {
      let rec = this.models.get(m.id);
      if (!rec) { rec = { model: buildModel(m.type, this.atlas, this.material), mob: m, lit: [1, 0] }; this.models.set(m.id, rec); this.game.scene.add(rec.model.root); this.#wire(rec); }
      this.#pose(rec, m, now, light);
    }
    this.#puffs(dt);
  }

  #wire(rec) {
    for (const p of rec.model.parts) p.mesh.onBeforeRender = (r, sc, cam, geo, material) => {
      const u = material.uniforms; u.uEnt.value.set(rec.lit[0], rec.lit[1]); u.uHurt.value = rec.hurt ?? 0; material.uniformsNeedUpdate = true;
    };
  }

  #pose(rec, m, now, light) {
    const { root, parts, def } = rec.model, d = m.def, k = clamp(m.moveSpeed / Math.max(0.5, d.speed), 0, 1.6);
    root.position.set(m.x, m.y, m.z); root.rotation.set(0, m.yaw, 0);
    rec.lit = light(m.x, m.y + d.h * 0.5, m.z); rec.hurt = clamp(m.hurtT / 0.35, 0, 1) * 0.75;
    if (m.dead) { const t = clamp(m.deadT / 0.55, 0, 1); root.rotation.z = t * Math.PI / 2; root.position.y += t * 0.15; const fade = clamp(1 - (m.deadT - 0.4) / 0.4, 0, 1); root.scale.setScalar(Math.max(0.01, fade)); rec.hurt = 0.6; }
    else root.scale.setScalar(1);
    for (const p of parts) {
      const s = p.spec, l = s.limb;
      if (s.wool && p.bareGeo) p.mesh.geometry = m.sheared ? p.bareGeo : p.geo;
      p.group.rotation.set(0, 0, 0);
      if (l) {
        if (s.flap) { const open = m.onGround ? 0.15 : 0.6 + Math.sin(now * 32 + m.id) * 0.5; p.group.rotation.z = (l.amp > 0 ? 1 : -1) * open * Math.abs(l.amp); }
        else { const ang = Math.sin(m.walk * 1.7 + l.phase * Math.PI + m.id) * l.amp * k * (m.dead ? 0 : 1); p.group.rotation[l.swing] = ang; }
      }
      if (s.head && !m.dead) { p.group.rotation.y = clamp(m.look.yaw, -0.9, 0.9); p.group.rotation.x = clamp(m.look.pitch, -0.6, 0.6); }
    }
    void def;
  }

  /** A puff of smoke where something died. */
  puff(x, y, z, n = 10, color = 0xdddddd) {
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      mesh.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.5);
      this.game.scene.add(mesh);
      this.puffs.push({ mesh, vx: (Math.random() - 0.5) * 1.2, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.2, t: 0 });
    }
  }
  #puffs(dt) {
    for (const p of this.puffs) {
      p.t += dt; p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.material.opacity = Math.max(0, 0.9 - p.t * 1.3); p.mesh.scale.setScalar(1 + p.t * 1.5);
    }
    this.puffs = this.puffs.filter((p) => { if (p.t > 0.75) { this.game.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); return false; } return true; });
  }

  clear() { for (const rec of this.models.values()) this.game.scene.remove(rec.model.root); this.models.clear(); for (const p of this.puffs) this.game.scene.remove(p.mesh); this.puffs = []; }
}
