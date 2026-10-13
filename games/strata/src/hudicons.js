// The survival HUD icons (hearts, food, air bubbles, armor), drawn in code as 9 x 9 pixel art and cached as data URLs. They are not assets: nothing is downloaded.
// Full / half / empty variants share one drawing; "empty" is the same shape in a dim colour and "half" fills the left half.
const MAPS = {
  heart: ['.aaa.aaa.', 'abbbabbba', 'abcbbbbba', 'abbbbbbba', '.abbbbba.', '..abbba..', '...aba...', '....a....'],
  food: ['....aaa..', '...abbba.', '..abcbbba', '..abbbbba', '...abbba.', '..ada.a..', '.adea....', '.dd......'],
  armor: ['.aa...aa.', 'abba.abba', 'abbbaabbb', 'abcbbbbba', 'abbbbbbba', '.abbbbba.', '..abbba..', '...aba...'],
  bubble: ['..aaaaa..', '.abbbbba.', 'abcbbbbba', 'abcbbbbba', 'abbbbbbba', 'abbbbbbba', '.abbbbba.', '..aaaaa..'],
};
const PAL = {
  heart: { full: { a: '#3b0a0a', b: '#e02828', c: '#ff9a9a' }, empty: { a: '#2a1414', b: '#4a2e2e', c: '#5a3a3a' } },
  food: { full: { a: '#4a2a10', b: '#c7733a', c: '#ecaa66', d: '#f2ead2', e: '#bdb394' }, empty: { a: '#2c2418', b: '#4c4034', c: '#584a3c', d: '#5a5444', e: '#4a4638' } },
  armor: { full: { a: '#262d3a', b: '#8fa0b8', c: '#dbe6f5' }, empty: { a: '#222630', b: '#3a4252', c: '#454e60' } },
  bubble: { full: { a: '#1d4f8f', b: '#6fb4ff', c: '#e4f4ff' }, empty: { a: '#1d4f8f', b: 'rgba(0,0,0,0)', c: 'rgba(0,0,0,0)' } },
};

function draw(name, variant) {
  const rows = MAPS[name], w = 9, c = document.createElement('canvas');
  c.width = w; c.height = 9;
  const g = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const half = variant === 'half' && x > 4;                              // the right half of a half icon is the empty colour
    const pal = PAL[name][variant === 'full' || (variant === 'half' && !half) ? 'full' : 'empty'];
    g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1);
  }));
  return c.toDataURL();
}

let cache = null;
/** { heart: {full, half, empty}, food: {...}, armor: {...}, bubble: {full, empty} } as data URLs. */
export function hudIcons() {
  if (cache) return cache;
  cache = {};
  for (const name of Object.keys(MAPS)) cache[name] = Object.fromEntries((name === 'bubble' ? ['full', 'empty'] : ['full', 'half', 'empty']).map((v) => [v, draw(name, v)]));
  return cache;
}
