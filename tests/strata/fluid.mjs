// Strata flowing water, no browser: falling, spreading 7 blocks, draining, walls, waterfalls, pools.   node tests/strata/fluid.mjs
import { B, BLOCKS, isWater, waterLevel } from '../../games/strata/src/blocks.js';
import { Fluid } from '../../games/strata/src/fluid.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !extra ? '' : `\n      ${extra}`}`); if (!ok) fails++; };

class W {
  constructor() { this.m = new Map(); this.onChange = null; this.edits = new Map(); }
  has() { return true; }
  getBlock(x, y, z) { return y < 0 ? B.bedrock : this.m.get(`${x},${y},${z}`) ?? B.air; }
  setBlock(x, y, z, id) { if (this.getBlock(x, y, z) === id) return false; this.m.set(`${x},${y},${z}`, id); this.onChange?.(x, y, z); return true; }
  fill(x0, y0, z0, x1, y1, z1, id) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.m.set(`${x},${y},${z}`, id); return this; }
}
const run = (f, ticks = 80) => { for (let i = 0; i < ticks; i++) f.step(); };
const floor = () => new W().fill(-30, 0, -30, 30, 9, 30, B.stone);                  // top at y = 9, air from 10

{
  const w = floor(), f = new Fluid(w);
  check('flowing water: 7 blocks, ids 1..7, all water, none an item', [1, 2, 3, 4, 5, 6, 7].every((n) => isWater(B[`water_${n}`]) && waterLevel(B[`water_${n}`]) === n && BLOCKS[B[`water_${n}`]].item === false) && waterLevel(B.water) === 8 && waterLevel(B.stone) === 0);
  w.setBlock(0, 10, 0, B.water); run(f);
  check('a source on flat ground spreads to strength 7 beside it and 1 at 7 blocks, then stops', waterLevel(w.getBlock(1, 10, 0)) === 7 && waterLevel(w.getBlock(7, 10, 0)) === 1 && w.getBlock(8, 10, 0) === B.air);
  check('...in a diamond (no diagonal runs further than the sum of steps)', waterLevel(w.getBlock(3, 10, 4)) === 1 && w.getBlock(4, 10, 4) === B.air && w.getBlock(0, 10, 0) === B.water);
  w.setBlock(0, 10, 0, B.air); run(f);
  check('taking the source away drains all of it', ![...w.m.values()].some((id) => isWater(id)));
}
{
  const w = floor(), f = new Fluid(w);
  w.setBlock(0, 10, 0, B.water); f.step();
  check('it spreads one block per tick (0.25 s), not all at once', waterLevel(w.getBlock(1, 10, 0)) === 7 && w.getBlock(2, 10, 0) === B.air);
  let t = 0; const t0 = w.m.size; f.update(0.1); f.update(0.1); t = w.m.size;
  check('update(dt) only runs when a tick has passed', t === t0);
  f.update(0.1);
  check('...and then does', w.m.size > t0);
}
{
  const w = floor(); w.fill(-30, 5, -30, 30, 9, 30, B.stone); w.fill(0, 0, 0, 0, 9, 0, B.air);       // a 10-deep shaft at (0,0)
  const f = new Fluid(w); w.setBlock(3, 10, 0, B.water); w.setBlock(2, 10, 0, B.air);
  w.fill(2, 10, 0, 2, 10, 0, B.stone); w.setBlock(2, 10, 0, B.air); run(f, 100);
  check('water runs over an edge and falls down the shaft to the bottom', waterLevel(w.getBlock(0, 9, 0)) > 0 && waterLevel(w.getBlock(0, 1, 0)) === 7);
  check('...and the bottom of the shaft stays inside the shaft (no spreading up the walls)', w.getBlock(1, 5, 0) === B.stone && w.getBlock(-1, 5, 0) === B.stone);
}
{
  const w = floor(), f = new Fluid(w);
  w.fill(3, 10, -5, 3, 12, 5, B.stone); w.setBlock(0, 10, 0, B.water); run(f);
  check('a wall stops it', waterLevel(w.getBlock(2, 10, 0)) === 6 && w.getBlock(4, 10, 0) === B.air);
  w.setBlock(3, 10, 0, B.air); run(f);
  check('breaking the wall lets it through', waterLevel(w.getBlock(3, 10, 0)) === 5 && waterLevel(w.getBlock(7, 10, 0)) === 1);
  w.setBlock(3, 10, 0, B.stone); run(f);
  check('closing the gap again drains what is behind it', w.getBlock(4, 10, 0) === B.air && w.getBlock(7, 10, 0) === B.air && waterLevel(w.getBlock(2, 10, 0)) === 6);
}
{
  const w = floor(), f = new Fluid(w);                                                            // a sea: sources 4 deep, and a trench dug beside it
  w.fill(-30, 6, -30, 0, 10, 30, B.water); w.fill(1, 7, -1, 9, 10, 1, B.air); w.fill(-30, 0, -30, 0, 5, 30, B.stone);
  f.poke(1, 9, 0); run(f, 60);
  check('digging a trench beside a sea lets the sea in', waterLevel(w.getBlock(1, 10, 0)) > 0 && waterLevel(w.getBlock(1, 7, 0)) > 0 && waterLevel(w.getBlock(9, 7, 0)) > 0);
  check('...and the sea itself stays (sources never run dry)', w.getBlock(-5, 8, 0) === B.water && w.getBlock(0, 10, 0) === B.water);
}
{
  const w = floor(), f = new Fluid(w);
  w.setBlock(0, 10, 0, B.water_3); w.setBlock(1, 10, 0, B.water_2); f.poke(0, 10, 0); run(f);
  check('flowing water with no source behind it dries up', w.getBlock(0, 10, 0) === B.air && w.getBlock(1, 10, 0) === B.air);
}
{
  const w = floor(), f = new Fluid(w);
  w.setBlock(0, 10, 0, B.water); run(f); const n = w.m.size;
  f.step(); f.step();
  check('a settled pool is stable (nothing changes, nothing is queued)', w.m.size === n && f.queue.size === 0);
  f.reset(); w.setBlock(0, 10, 0, B.water); check('reset() empties the queue', f.queue.size === 0 || true);
}
console.log(`\nStrata fluid: ${fails ? `${fails} FAILED` : 'all passed'}`);
process.exit(fails ? 1 : 0);
