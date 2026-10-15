/*
 * System32 Game SDK: a thin wrapper over the Game Protocol (DESKTOP_SPEC §9).
 * Classic script on purpose: module scripts need CORS, and sandboxed frames have an opaque origin.
 *
 *   <script src="../_shared/sdk.js" data-game="dom-ination"></script>
 *   System32.onInit(function (init) { ... });   // { bestTimeMs, best, beaten, soundOn, highScore, save, completed }  (save: the last saved string or null, bonus games with `saves` only; completed: the stored completion or null)
 *   System32.ready();                           // after your game is loaded
 *   System32.won({ timeMs: 41200, score: 3 });
 *   System32.lost('reason');
 *   System32.progress('wave', '2/3');
 *   System32.complete({ timeMs, deaths, difficulty });        // BONUS games with `completes: true` only (Strata): difficulty 'peaceful'|'normal'|'hard'; the shell keeps the best time per difficulty
 *   System32.runOver({ score, distance, pickups, timeMs });   // BONUS games only (they end runs, they never win): the shell keeps the best score
 *   System32.onPause(fn); System32.onResume(fn);

 *   System32.save(data);                         // BONUS games with `saves: true` only (Strata): data is a string, at most the game's `saveCap` (Strata: 2.5 MB)
 *   System32.onSaved(function (r) { ... });      // { ok, bytes, error? } error: 'too-large' | 'quota' | 'invalid'
 *   System32.fullscreen();                       // BONUS games: toggle fullscreen (the game window fills the whole screen, no desktop around it); the shell does it, so call this from a click or key press
 *   System32.onFullscreen(function (p) { ... }); // { on }: the window entered or left fullscreen (also when the user pressed Esc)
 *   System32.onSound(function (p) { ... });      // { soundOn }: the taskbar speaker was toggled while the game is open
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var gameId = (script && script.getAttribute('data-game')) || 'unknown';
  var handlers = { INIT: [], PAUSE: [], RESUME: [], SOUND: [], SAVED: [], FULLSCREEN: [] };

  function send(type, extra) {
    var msg = { source: 'system32-game', gameId: gameId, type: type };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
    // Origins are opaque inside the sandbox, so '*' is the only possible target. The shell verifies event.source.
    window.parent.postMessage(msg, '*');
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.source !== 'system32-shell' || !handlers[d.type]) return;
    handlers[d.type].forEach(function (fn) { try { fn(d.payload); } catch (err) { console.error(err); } });
  });

  window.System32 = {
    gameId: gameId,
    ready: function () { send('GAME_READY'); },
    complete: function (payload) { send('GAME_COMPLETE', { payload: payload || {} }); },
    runOver: function (payload) { send('RUN_OVER', { payload: payload || {} }); },
    won: function (payload) { send('GAME_WON', { payload: payload || {} }); },
    lost: function (reason) { send('GAME_LOST', { payload: { reason: reason || '' } }); },
    progress: function (label, value) { send('GAME_PROGRESS', { payload: { label: label, value: value } }); },
    navigate: function (route, query) { send('NAVIGATE', { route: route, query: query || '' }); },
    effect: function (effect, opts) { send('SHELL_EFFECT', Object.assign({ effect: effect }, opts || {})); },
    onInit: function (fn) { handlers.INIT.push(fn); },
    onPause: function (fn) { handlers.PAUSE.push(fn); },
    onResume: function (fn) { handlers.RESUME.push(fn); },
    onSound: function (fn) { handlers.SOUND.push(fn); },
    save: function (data) { send('SAVE', { payload: { data: data } }); },
    onSaved: function (fn) { handlers.SAVED.push(fn); },
    fullscreen: function () { send('FULLSCREEN'); },
    onFullscreen: function (fn) { handlers.FULLSCREEN.push(fn); },
  };
})();
