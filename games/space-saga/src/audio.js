// WebAudio synth only (no sample files), like the rest of System32. Plays only when the shell says soundOn; M mutes.
// Buses: master -> compressor -> out. music (bass / pad / arp+lead / drums, delay on the arp) and sfx both feed master.
// The score is A minor (Am F C G, one chord per bar). It gets denser by tier (0 / 400 / 1000 m) and faster with speed.
const mtof = (n) => 440 * 2 ** ((n - 69) / 12);

const CHORDS = [
  { root: 33, tones: [57, 60, 64] },   // Am
  { root: 29, tones: [53, 57, 60] },   // F
  { root: 36, tones: [55, 60, 64] },   // C
  { root: 31, tones: [55, 59, 62] },   // G
];
const BASS = [0, 0, 12, 0, 0, 7, 12, 7];                       // semitones above the chord root, one per 8th note
const ARP = [0, 1, 2, 1];                                      // chord tone index per 16th note
const LEAD = [                                                 // 4 bars x 8 eighth notes, 0 = rest (A minor pentatonic)
  76, 0, 72, 0, 69, 72, 0, 76,
  77, 0, 72, 0, 69, 0, 72, 77,
  79, 0, 76, 0, 72, 76, 0, 79,
  74, 0, 71, 0, 67, 71, 74, 0,
];
const MASTER = 0.55;

export class SagaAudio {
  constructor() {
    this.ctx = null;
    this.allowed = false;      // INIT / SOUND soundOn
    this.muted = false;
    this.music = false;
    this.mode = 'run';         // 'run' | 'title'
    this.tier = 0;
    this.suspended = false;
    this.step = 0;
    this.nextT = 0;
    this.noise = null;
    this.stepDist = 0;
    this.foot = 0;
    this.lastAlien = 0;
  }

  get active() { return this.allowed && !this.muted && !this.suspended; }

  /** Must run inside a user gesture the first time (a key press or click in the game frame counts). */
  unlock() {
    if (!this.allowed) return;
    if (this.ctx) { if (this.ctx.state === 'suspended' && !this.suspended) this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.18;
    this.master.connect(comp).connect(ctx.destination);
    this.#gain();

    const bus = (to, v = 1, filt) => {
      const g = ctx.createGain(); g.gain.value = v;
      if (filt) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt; g.connect(f).connect(to); } else g.connect(to);
      return g;
    };
    this.sfx = bus(this.master, 1);
    this.musicBus = bus(this.master, 1);
    this.bassBus = bus(this.musicBus, 0.9, 700);
    this.padBus = bus(this.musicBus, 0.8, 1600);
    this.drumBus = bus(this.musicBus, 0.9);
    this.arpBus = bus(this.musicBus, 0.8);
    const delay = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(), damp = ctx.createBiquadFilter();
    delay.delayTime.value = 0.3; fb.gain.value = 0.34; wet.gain.value = 0.38; damp.type = 'lowpass'; damp.frequency.value = 2400;
    this.arpBus.connect(delay); delay.connect(damp).connect(fb).connect(delay); damp.connect(wet).connect(this.musicBus);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.music) this.#wind(this.mode === 'run');
  }

  #gain() { if (this.master) this.master.gain.value = this.allowed && !this.muted ? MASTER : 0; }
  setAllowed(on) { this.allowed = !!on; this.#gain(); if (!this.allowed) this.#wind(false); else if (this.music && this.mode === 'run') this.#wind(true); }
  toggleMute() { this.muted = !this.muted; this.#gain(); return this.muted; }
  suspend() { this.suspended = true; this.ctx?.suspend?.(); }
  resume() { this.suspended = false; if (this.active) this.ctx?.resume?.(); }

  // ---------------------------------------------------------------- primitives
  #out(bus, pan) {
    if (!pan) return bus;
    const p = this.ctx.createStereoPanner(); p.pan.value = pan; p.connect(bus);
    return p;
  }

  /** One oscillator note with an attack/decay envelope. f1 !== f0 glides exponentially. */
  #osc(type, f0, f1, dur, vol, when = 0, { bus = this.sfx, a = 0.004, pan = 0, detune = 0 } = {}) {
    if (!this.ctx || !this.active) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(a, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.#out(bus, pan));
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  /** Filtered noise burst; the band sweeps lo -> hi. */
  #hiss(dur, vol, lo, hi, when = 0, { bus = this.sfx, pan = 0, type = 'bandpass', q = 1 } = {}) {
    if (!this.ctx || !this.active) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(lo, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, hi), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.#out(bus, pan));
    s.start(t);
    s.stop(t + dur + 0.03);
  }

  // ---------------------------------------------------------------- sound effects
  /** Alternating left / right boots; pitch wobbles a little so it never sounds machine-gunned. */
  footstep() {
    const k = (this.foot ^= 1) ? 1 : 0.86, j = 0.92 + Math.random() * 0.16;
    this.#osc('sine', 130 * k * j, 55, 0.07, 0.1);
    this.#hiss(0.05, 0.07, 1500 * k, 300, 0, { type: 'lowpass' });
  }
  jump() { this.#hiss(0.26, 0.1, 500, 3200); this.#osc('triangle', 260, 640, 0.2, 0.1); this.#osc('square', 520, 1040, 0.08, 0.025); }
  land() { this.#osc('sine', 120, 42, 0.14, 0.2); this.#hiss(0.1, 0.1, 1100, 200, 0, { type: 'lowpass' }); }
  slide() { this.#hiss(0.55, 0.12, 2600, 500, 0, { q: 0.8 }); this.#osc('sawtooth', 95, 55, 0.45, 0.03); }
  lane(dir = 0) { this.#hiss(0.14, 0.08, 500, 2000, 0, { pan: dir * 0.7 }); this.#osc('sine', 300, 200, 0.08, 0.04, 0, { pan: dir * 0.7 }); }
  pickup(combo = 0) {
    const f = 660 * 2 ** (Math.min(combo, 12) / 12);
    this.#osc('square', f, f * 1.5, 0.1, 0.07);
    this.#osc('triangle', f * 2, f * 2, 0.16, 0.06, 0.05);
  }
  orb() { [523, 659, 784, 1047, 1319].forEach((f, i) => { this.#osc('triangle', f, f, 0.2, 0.08, i * 0.06); this.#osc('square', f * 2, f * 2, 0.08, 0.02, i * 0.06); }); }
  comboUp() { [523, 659, 784, 1047].forEach((f, i) => { this.#osc('square', f, f, 0.14, 0.07, i * 0.07); this.#osc('triangle', f * 2, f * 2, 0.18, 0.05, i * 0.07); }); }
  clip() { this.#osc('sawtooth', 170, 55, 0.2, 0.16); this.#hiss(0.14, 0.14, 1200, 150, 0, { type: 'lowpass' }); }
  crash() {
    this.#hiss(0.8, 0.4, 2400, 60);
    this.#osc('sawtooth', 190, 25, 0.65, 0.22);
    this.#osc('sine', 80, 28, 0.6, 0.35);
  }
  /** The sad little run-over tune. */
  gameOver() { [440, 392, 330, 262].forEach((f, i) => { this.#osc('square', f, f * 0.98, 0.26, 0.06, 0.15 + i * 0.2); this.#osc('triangle', f / 2, f / 2, 0.3, 0.07, 0.15 + i * 0.2); }); }
  /** New best. */
  fanfare() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { this.#osc('square', f, f, i === 5 ? 0.6 : 0.14, 0.06, 0.15 + i * 0.1); this.#osc('triangle', f / 2, f / 2, i === 5 ? 0.6 : 0.16, 0.08, 0.15 + i * 0.1); }); }
  shatter() {
    this.#hiss(0.3, 0.16, 7000, 1200);
    for (let i = 0; i < 7; i++) { const f = 1800 + Math.random() * 4200; this.#osc('sine', f, f * 0.8, 0.16, 0.05, i * 0.025); }
  }
  /** A walker growls, a flyer chirps (spawner calls this when one starts moving). */
  alien(kind) {
    const now = this.ctx?.currentTime ?? 0;
    if (now - this.lastAlien < 0.35) return;
    this.lastAlien = now;
    if (kind === 'flyer') { this.#osc('sine', 700, 1300, 0.12, 0.07); this.#osc('sine', 1300, 800, 0.14, 0.06, 0.1); }
    else { this.#osc('sawtooth', 120, 170, 0.14, 0.07); this.#osc('sawtooth', 170, 80, 0.2, 0.07, 0.12); }
  }
  tierUp() { this.#osc('sawtooth', 160, 900, 0.6, 0.05, 0, { a: 0.4 }); [440, 554, 659].forEach((f) => this.#osc('triangle', f, f, 0.5, 0.06, 0.45)); }
  glitch() { for (let i = 0; i < 7; i++) this.#osc('square', 200 + Math.random() * 1800, 100 + Math.random() * 900, 0.05, 0.05, i * 0.045); }
  start() { this.#hiss(0.35, 0.1, 300, 3000); this.#osc('sine', 330, 660, 0.25, 0.1); this.#osc('square', 880, 880, 0.08, 0.04, 0.25); }

  /** Distance-driven footsteps: a tick every ~1.9 m, so the rate follows speed. */
  steps(distDelta, grounded) { this.stepDist += distDelta; if (this.stepDist >= 1.9) { this.stepDist = 0; if (grounded) this.footstep(); } }

  // ---------------------------------------------------------------- music
  /** @param mode 'run' (drums, bass, arp, lead) or 'title' (slow pad, soft arp) */
  startMusic(mode = 'run') {
    this.music = true; this.mode = mode; this.step = 0; this.nextT = 0; this.tier = 0;
    if (this.musicBus) { this.musicBus.gain.cancelScheduledValues(0); this.musicBus.gain.value = 1; }
    this.#wind(mode === 'run');
  }
  stopMusic(fadeS = 0.5) {
    this.music = false;
    this.#wind(false);
    if (this.musicBus && fadeS > 0) { const t = this.ctx.currentTime; this.musicBus.gain.cancelScheduledValues(t); this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t); this.musicBus.gain.linearRampToValueAtTime(0, t + fadeS); }
  }

  /** A looping breath of wind / engine hum under the run; louder and brighter with speed. */
  #wind(on) {
    if (!this.ctx) return;
    if (!on) { if (this.windSrc) { try { this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15); const s = this.windSrc; setTimeout(() => { try { s.stop(); } catch { /* already stopped */ } }, 600); } catch { /* ctx closed */ } this.windSrc = null; } return; }
    if (this.windSrc || !this.allowed) return;
    const s = this.windSrc = this.ctx.createBufferSource(), f = this.windFilter = this.ctx.createBiquadFilter(), g = this.windGain = this.ctx.createGain();
    s.buffer = this.noise; s.loop = true;
    f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.3);
    s.connect(f).connect(g).connect(this.sfx);
    s.start();
  }

  /** Call every frame; schedules the next 16th notes slightly ahead. Tempo rises with speed (100 bpm at 12 u/s, 140 at the cap). */
  tick(speed, tier = 0) {
    if (!this.music || !this.ctx || !this.active) return;
    const now = this.ctx.currentTime;
    const k = Math.min(1, Math.max(0, (speed - 12) / 22));
    if (this.windSrc) { this.windFilter.frequency.value = 400 + 1300 * k; this.windGain.gain.setTargetAtTime(0.045 + 0.06 * k, now, 0.2); }
    if (this.nextT < now) this.nextT = now + 0.05;
    this.tier = tier;
    const title = this.mode === 'title';
    const bpm = title ? 78 : 100 + 40 * k;
    const sixteenth = 60 / bpm / 4;
    while (this.nextT < now + 0.15) {
      const w = this.nextT - now, st = this.step, s = st % 16, chord = CHORDS[(st >> 4) & 3];
      if (title) this.#titleStep(st, s, chord, w, sixteenth);
      else this.#runStep(st, s, chord, w, sixteenth, tier);
      this.step++;
      this.nextT += sixteenth;
    }
  }

  #pad(chord, w, dur, vol) {
    for (const n of chord.tones) for (const d of [-7, 7]) this.#osc('sawtooth', mtof(n - 12), mtof(n - 12), dur, vol, w, { bus: this.padBus, a: 0.45, detune: d });
  }

  #titleStep(st, s, chord, w, sx) {
    if (s === 0) this.#pad(chord, w, sx * 16, 0.028);
    if (s === 0 || s === 8) this.#osc('sine', mtof(chord.root), mtof(chord.root), sx * 7, 0.2, w, { bus: this.bassBus, a: 0.03 });
    if (s % 4 === 0) this.#osc('triangle', mtof(chord.tones[ARP[(s >> 2) % 4]] + 12), mtof(chord.tones[ARP[(s >> 2) % 4]] + 12), 0.5, 0.05, w, { bus: this.arpBus });
    if (s === 0) { const n = LEAD[((st >> 4) & 3) * 8]; if (n) this.#osc('sine', mtof(n), mtof(n), sx * 8, 0.04, w, { bus: this.arpBus, a: 0.2 }); }
  }

  #runStep(st, s, chord, w, sx, tier) {
    // drums
    if (tier === 0 ? s % 8 === 0 : s % 4 === 0) this.#osc('sine', 150, 42, 0.2, 0.34, w, { bus: this.drumBus });
    if (s === 4 || s === 12) { this.#hiss(0.14, 0.09, 1900, 1000, w, { bus: this.drumBus }); this.#osc('triangle', 200, 120, 0.09, 0.07, w, { bus: this.drumBus }); }
    const hat = tier === 0 ? s % 4 === 2 : tier === 1 ? s % 2 === 0 : true;
    if (hat) this.#hiss(0.035, tier === 2 && s % 4 === 2 ? 0.07 : 0.045, 7500, 9500, w, { bus: this.drumBus, type: 'highpass' });
    // bass: quarter notes at first, then eighths
    if (s % 2 === 0 && (tier > 0 || s % 4 === 0)) {
      const n = chord.root + BASS[s >> 1], f = mtof(n);
      this.#osc('sawtooth', f, f, sx * 1.6, 0.16, w, { bus: this.bassBus, a: 0.006 });
    }
    // pad
    if (s === 0) this.#pad(chord, w, sx * 16, tier === 0 ? 0.02 : 0.026);
    // arp
    if (tier === 0 ? s % 4 === 2 : true) {
      const n = chord.tones[ARP[s % 4]] + (s % 8 >= 4 ? 12 : 0) + 12, f = mtof(n);
      this.#osc('triangle', f, f, sx * 1.8, tier === 0 ? 0.04 : 0.05, w, { bus: this.arpBus });
    }
    // lead, from tier 1
    if (tier > 0 && s % 2 === 0) {
      const n = LEAD[(st >> 1) % 32];
      if (n) {
        const f = mtof(n);
        this.#osc('square', f, f, sx * 1.7, 0.04, w, { bus: this.arpBus, a: 0.01 });
        if (tier > 1) this.#osc('sawtooth', f * 2, f * 2, sx * 1.4, 0.015, w, { bus: this.arpBus });
      }
    }
  }
}
