// Tiny synthesized sound effects (WebAudio), so the site ships no audio files.
// Silent until the first user gesture (autoplay rules) and whenever the tray volume toggle is off.
import { state } from './state.js';

let ctx = null;

function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { capture: true });

function tone(freq, start, dur, { type = 'sine', vol = 0.12, to = null } = {}) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(start, dur, vol = 0.15) {
  const t0 = ctx.currentTime + start;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  gain.gain.value = vol;
  src.buffer = buf;
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t0);
}

const SOUNDS = {
  startup: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.16, 0.9, { vol: 0.08 })),
  error: () => { tone(220, 0, 0.16, { type: 'square', vol: 0.06 }); tone(196, 0.18, 0.22, { type: 'square', vol: 0.06 }); },
  notify: () => { tone(880, 0, 0.12, { vol: 0.09 }); tone(1318.5, 0.09, 0.2, { vol: 0.07 }); },
  crumple: () => { noise(0, 0.5); noise(0.18, 0.3, 0.1); },
};

export function play(name) {
  if (!state.soundOn || !ctx || ctx.state !== 'running') return;
  try { SOUNDS[name]?.(); } catch { /* audio is never essential */ }
}
