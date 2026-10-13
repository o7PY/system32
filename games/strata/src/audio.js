// Strata audio: Kenney samples per material group (dig, break, footsteps, place, pickup, UI, furnace, tool break, the first-iron-tool jingle) with simple
// direction panning and distance falloff, plus a sparse synthesized ambient pad every few minutes. Plays only while the shell's sound is on (INIT / SOUND);
// the volume and music switch are game settings. Samples are fetched during loading and decoded once the AudioContext exists (after the first gesture).
import { CONFIG } from './config.js';
import { BLOCKS } from './blocks.js';

const mtof = (n) => 440 * 2 ** ((n - 69) / 12);

export class StrataAudio {
  constructor() {
    this.ctx = null; this.master = null;
    this.allowed = false; this.suspended = false;
    this.volume = CONFIG.settings.volume; this.music = CONFIG.settings.music;
    this.raw = new Map();        // role -> [ArrayBuffer]
    this.bufs = new Map();       // role -> [AudioBuffer]
    this.decoding = null;
    this.nextMusic = 20;         // seconds until the next ambient piece
    this.lastStep = 0;
    this.count = 0;              // sounds played (tests)
    this.played = [];            // last roles played (tests)
  }
  get active() { return this.allowed && !this.suspended && this.volume > 0; }

  /** Fetch every sample (compressed bytes only). onProgress(0..1). A missing file is skipped, never fatal. */
  async load(base, onProgress = () => {}) {
    const list = await (await fetch(`${base}sounds.json`)).json();
    const files = Object.entries(list).flatMap(([role, names]) => names.map((n) => [role, n]));
    let done = 0;
    await Promise.all(files.map(async ([role, name]) => {
      try {
        const b = await (await fetch(`${base}sounds/${name}`)).arrayBuffer();
        (this.raw.get(role) ?? this.raw.set(role, []).get(role)).push(b);
      } catch { /* a missing sample just stays silent */ }
      onProgress(++done / files.length);
    }));
  }

  /** Create the context (must happen inside a user gesture) and decode the samples. */
  unlock() {
    if (!this.allowed) return;
    if (this.ctx) { if (this.ctx.state === 'suspended' && !this.suspended) this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.#applyVolume();
    this.decoding = Promise.all([...this.raw].map(async ([role, arr]) => {
      const out = [];
      for (const b of arr) { try { out.push(await this.ctx.decodeAudioData(b.slice(0))); } catch { /* undecodable: skip */ } }
      this.bufs.set(role, out);
    }));
  }
  #applyVolume() { if (this.master) this.master.gain.value = this.allowed ? this.volume : 0; }
  setAllowed(on) { this.allowed = !!on; this.#applyVolume(); }
  setVolume(v) { this.volume = Math.min(1, Math.max(0, v)); this.#applyVolume(); }
  setMusic(on) { this.music = !!on; }
  suspend() { this.suspended = true; this.ctx?.suspend?.(); }
  resume() { this.suspended = false; if (this.active) this.ctx?.resume?.(); }

  /**
   * Play a role. `at` = { x, y, z } makes it positional (pan and volume from the listener); `listener` = { x, y, z, yaw }.
   * Returns the role if it played (or would have, with sound on), so tests can see what the game asked for.
   */
  play(role, { at = null, listener = null, vol = 1, rate = 1 } = {}) {
    this.played.push(role); if (this.played.length > 50) this.played.shift();
    if (!this.ctx || !this.active) return false;
    const list = this.bufs.get(role);
    if (!list?.length) return false;
    const buf = list[Math.floor(Math.random() * list.length)];
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    let out = g, pan = 0, gain = vol;
    if (at && listener) {
      const dx = at.x - listener.x, dz = at.z - listener.z, d = Math.hypot(dx, dz, at.y - listener.y);
      gain *= 1 / (1 + d * 0.12);
      if (d > 0.5) pan = Math.max(-1, Math.min(1, (dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw)) / d));        // the listener's right is (cos yaw, -sin yaw)
    }
    g.gain.value = gain;
    src.connect(g);
    if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(this.master); } else out.connect(this.master);
    src.start();
    this.count++;
    return role;
  }

  /** dig / break / step for a block id (its material group picks the samples). */
  block(kind, blockId, opts) { return this.play(`${kind}.${BLOCKS[blockId]?.group ?? 'stone'}`, opts); }
  ui(name) { return this.play(`ui.${name}`, { vol: 0.8 }); }

  // ---------------------------------------------------------------- ambient music
  /** Call every frame while playing: every 2.5 to 5 minutes a slow pad of 3 or 4 chords drifts in and out. */
  tick(dt) {
    this.nextMusic -= dt;
    if (this.nextMusic > 0) return;
    const [a, b] = CONFIG.musicEveryS;
    this.nextMusic = a + Math.random() * (b - a);
    if (this.music) this.ambient();
  }

  ambient() {
    this.played.push('music');
    if (!this.ctx || !this.active) return false;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.2, roots = [57, 53, 60, 55];     // A F C G, one pad chord each
    const bus = ctx.createGain(); bus.gain.value = 0.5 * this.volume; bus.connect(this.master);
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.45; const fb = ctx.createGain(); fb.gain.value = 0.4; delay.connect(fb).connect(delay); delay.connect(bus);
    const chords = 3 + Math.floor(Math.random() * 2);
    for (let c = 0; c < chords; c++) {
      const t = t0 + c * 9, root = roots[(c + Math.floor(Math.random() * 4)) % 4];
      for (const n of [root - 12, root, root + 4 - (root === 53 ? 0 : 1), root + 7]) {
        for (const d of [-6, 6]) {
          const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
          o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = d;
          f.type = 'lowpass'; f.frequency.value = 700;
          g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.018, t + 3.5); g.gain.linearRampToValueAtTime(0.0001, t + 10);
          o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + 10.2);
        }
      }
      for (let k = 0; k < 2; k++) {                                                   // a soft bell or two over the chord
        const o = ctx.createOscillator(), g = ctx.createGain(), when = t + 1 + Math.random() * 6;
        o.type = 'sine'; o.frequency.value = mtof(root + 12 + [0, 7, 12, 4][Math.floor(Math.random() * 4)]);
        g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(0.05, when + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, when + 3);
        o.connect(g); g.connect(bus); g.connect(delay); o.start(when); o.stop(when + 3.1);
      }
    }
    return true;
  }
}
