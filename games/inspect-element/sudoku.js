/* Sudoku for the vault escape hatch (FINAL_SPEC §6). Pure functions, no DOM, no libraries. Classic script; also loadable from Node (module.exports) for the tests.
   A grid is an array of 81 numbers, 0 = empty, index = row * 9 + col. */
(function (root) {
  'use strict';

  var ROW = [], COL = [], BOX = [], i;
  for (i = 0; i < 81; i++) { ROW[i] = Math.floor(i / 9); COL[i] = i % 9; BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3); }
  var PEERS = [];
  for (i = 0; i < 81; i++) {
    PEERS[i] = [];
    for (var j = 0; j < 81; j++) if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) PEERS[i].push(j);
  }

  /** A small seedable generator (mulberry32), so tests can generate the same puzzle twice. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, rnd) {
    for (var k = a.length - 1; k > 0; k--) { var m = Math.floor(rnd() * (k + 1)), t = a[k]; a[k] = a[m]; a[m] = t; }
    return a;
  }

  /**
   * Backtracking search with bit masks and the fewest-candidates-first rule. Counts solutions up to `limit`; when `rnd` is given the candidate order is random
   * (that is how a full grid is generated); `out` (optional array of 81) receives the first solution.
   */
  function search(grid, limit, rnd, out) {
    var g = grid.slice(), rows = [], cols = [], boxes = [], c, count = 0;
    for (c = 0; c < 9; c++) { rows[c] = 0; cols[c] = 0; boxes[c] = 0; }
    for (c = 0; c < 81; c++) {
      if (!g[c]) continue;
      var bit = 1 << g[c];
      if ((rows[ROW[c]] & bit) || (cols[COL[c]] & bit) || (boxes[BOX[c]] & bit)) return 0;     // the givens already clash
      rows[ROW[c]] |= bit; cols[COL[c]] |= bit; boxes[BOX[c]] |= bit;
    }
    function go() {
      var best = -1, bestMask = 0, bestN = 10, cell, mask, n, v;
      for (cell = 0; cell < 81; cell++) {
        if (g[cell]) continue;
        mask = ~(rows[ROW[cell]] | cols[COL[cell]] | boxes[BOX[cell]]) & 0x3FE;
        n = 0; for (v = mask; v; v &= v - 1) n++;
        if (n < bestN) { bestN = n; best = cell; bestMask = mask; if (n <= 1) break; }
      }
      if (best < 0) { count++; if (out && count === 1) for (var k = 0; k < 81; k++) out[k] = g[k]; return count >= limit; }
      if (bestN === 0) return false;
      var cands = [];
      for (v = 1; v <= 9; v++) if (bestMask & (1 << v)) cands.push(v);
      if (rnd) shuffle(cands, rnd);
      for (var ci = 0; ci < cands.length; ci++) {
        v = cands[ci]; var b = 1 << v;
        g[best] = v; rows[ROW[best]] |= b; cols[COL[best]] |= b; boxes[BOX[best]] |= b;
        var stop = go();
        g[best] = 0; rows[ROW[best]] &= ~b; cols[COL[best]] &= ~b; boxes[BOX[best]] &= ~b;
        if (stop) return true;
      }
      return false;
    }
    go();
    return count;
  }

  /** How many solutions the puzzle has, counting no further than `limit` (default 2: "one" and "more than one" are what matters). */
  function countSolutions(grid, limit) { return search(grid, limit || 2, null, null); }
  /** The first solution, or null. */
  function solve(grid) { var out = new Array(81); return search(grid, 1, null, out) ? out : null; }

  /**
   * A puzzle with exactly one solution and 30 to 34 givens (medium). Fills a complete grid by randomised backtracking, then removes cells in random order,
   * keeping a removal only when the solution stays unique. Returns { puzzle, solution, givens }.
   */
  function generate(rnd) {
    rnd = rnd || Math.random;
    var solution = new Array(81), empty = [], k;
    for (k = 0; k < 81; k++) empty[k] = 0;
    search(empty, 1, rnd, solution);
    var target = 30 + Math.floor(rnd() * 5), puzzle = solution.slice(), order = [], givens = 81;
    for (k = 0; k < 81; k++) order.push(k);
    shuffle(order, rnd);
    for (k = 0; k < 81 && givens > target; k++) {
      var cell = order[k], keep = puzzle[cell];
      puzzle[cell] = 0;
      if (countSolutions(puzzle, 2) !== 1) puzzle[cell] = keep; else givens--;
    }
    return { puzzle: puzzle, solution: solution, givens: givens };
  }

  /** The cells that clash with a peer (same number in the same row, column or box). Empty cells never clash. */
  function conflicts(grid) {
    var bad = [];
    for (var c = 0; c < 81; c++) {
      if (!grid[c]) continue;
      for (var p = 0; p < PEERS[c].length; p++) if (grid[PEERS[c][p]] === grid[c]) { bad.push(c); break; }
    }
    return bad;
  }
  var full = function (grid) { for (var c = 0; c < 81; c++) if (!grid[c]) return false; return true; };
  /** Filled in, no conflicts, and the same as the solution. */
  function isSolved(grid, solution) {
    if (!full(grid) || conflicts(grid).length) return false;
    for (var c = 0; c < 81; c++) if (grid[c] !== solution[c]) return false;
    return true;
  }

  var api = { generate: generate, solve: solve, countSolutions: countSolutions, conflicts: conflicts, isSolved: isSolved, rng: rng, PEERS: PEERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sudoku = api;
}(typeof window !== 'undefined' ? window : globalThis));
