// Fixed layouts of the end game, shared by the game, the tests and (as plain numbers, checked by a test) the worker: the Kernel Gate in the middle of the Underlayer and the
// Kernel arena. Positions are in blocks. The arena is a template: it is generated from scratch every time you enter, so a lost fight never leaves a half-deleted arena.
export const GATE = {
  x: 256, z: 256, floor: 40,                              // the dark frame stands on the flat centre (y 40); the player arrives in front of it (south, +z)
  frame: { x0: 253, x1: 259, y0: 40, y1: 48 },           // outer rack frame: x 253..259, y 40..48 at z 256
  inner: { x0: 254, x1: 258, y0: 41, y1: 47 },           // the opening, filled with `vault_door` until the key opens it, then with `rift_white`
  front: { x: 256.5, y: 41, z: 261.5 },                   // where you stand in front of it (and where a loaded save puts you back)
};
export const ARENA = {
  size: 128, cx: 64, cz: 64, top: 60, thick: 3, radius: 32, // a 64-block platform of memory blocks, 3 layers: y 58, 59, 60 (the top surface is y 61)
  spawn: { x: 64.5, y: 61, z: 92.5 },                      // arrive at the south edge, facing the boss
  boss: { x: 64.5, y: 61, z: 56.5 },
  crystals: [[44, 44], [84, 44], [44, 84], [84, 84]].map(([x, z]) => ({ x, y: 67, z })),   // one Kernel crystal block on top of a 6 high pillar of memory blocks
  pillarH: 6,
  shrink: { from: 32, to: 8, step: 4, everyS: 10 },
  void: -32,
};
export const arenaCell = (x, y, z) => {                 // is (x, y, z) part of the template platform?
  const dx = x + 0.5 - ARENA.cx, dz = z + 0.5 - ARENA.cz;
  return y >= ARENA.top - ARENA.thick + 1 && y <= ARENA.top && Math.hypot(dx, dz) <= ARENA.radius;
};
