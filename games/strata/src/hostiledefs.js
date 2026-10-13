// The overworld hostiles (STRATA_PART2_SPEC.md 5.3) as data, merged into MOBS by mobdefs.js: Shambler (slow melee zombie), Rattler (a skeleton that keeps its distance and
// shoots), Creepcrawler (a fast wall-climbing spider, neutral by day), Pop-up (an original flying ad window). All designs, names and palettes are our own.
// ai: the behaviour key read by hostile.js; the numbers are in blocks, seconds and HP.

const q = (x, y, z, w, h, d, tex, extra = {}) => ({ size: [w, h, d], at: [x, y, z], tex, ...extra });
const limb = (n, x, y, z, w, h, d, tex, swing, amp, phase, extra = {}) => ({ n, size: [w, h, d], at: [x, y, z], tex, limb: { pivot: 'top', swing, amp, phase }, ...extra });

/** A person built from boxes: 8 cube head, 8 x 12 x 4 body, 4 x 12 x 4 arms and legs (a technician: jumpsuit colours are set by the textures). */
const humanoid = (arms) => [
  q(0, 18, 0, 8, 12, 4, 'body'), q(0, 28, 0, 8, 8, 8, 'head', { head: true }),
  limb('armL', -6, 24, 0, 4, 12, 4, 'arm', 'x', arms.amp, 0, { chase: arms.chase }), limb('armR', 6, 24, 0, 4, 12, 4, 'arm', 'x', -arms.amp, 0, { chase: arms.chase }),
  limb('legL', -2, 12, 0, 4, 12, 4, 'leg', 'x', 0.8, 0), limb('legR', 2, 12, 0, 4, 12, 4, 'leg', 'x', 0.8, 1),
];

export const HOSTILE = {
  shambler: {
    name: 'Shambler', kind: 'hostile', w: 0.6, h: 1.95, hp: 20, speed: 2.1, eyeH: 1.62, voice: 'shambler', ai: 'melee', surface: true,
    melee: { damage: 3, reach: 1.35, everyS: 1.0, windupS: 0.3, knockback: 4 }, sight: 24, group: [2, 4], nausea: false,
    drops: [['rotten_flesh', 0, 2]],
    model: {
      anim: 'biped',
      tex: {
        body: { base: '#5a7a4a', alt: '#465f3a', pattern: 'plates' }, head: { base: '#8aa376', alt: '#6c8359', pattern: 'solid', face: 'zombie' },
        arm: { base: '#8aa376', alt: '#6c8359', pattern: 'solid' }, leg: { base: '#3d4f6b', alt: '#2f3d55', pattern: 'plates' },
      },
      parts: humanoid({ amp: 0.6, chase: -1.35 }),
    },
  },
  rattler: {
    name: 'Rattler', kind: 'hostile', w: 0.6, h: 1.95, hp: 20, speed: 2.4, eyeH: 1.62, voice: 'rattler', ai: 'archer', surface: true,
    archer: { min: 8, max: 12, damage: [2, 4], everyS: 2.2, drawS: 0.9, speed: 16, strafeS: 1.4 }, sight: 28, group: [1, 2],
    drops: [['bone', 0, 2], ['arrow', 0, 2]],
    model: {
      anim: 'biped',
      tex: {
        body: { base: '#d8d2bf', alt: '#9d977f', pattern: 'stripes' }, head: { base: '#e6e0cc', alt: '#b5af98', pattern: 'solid', face: 'skull' },
        arm: { base: '#dcd6c3', alt: '#a39d86', pattern: 'stripes' }, leg: { base: '#dcd6c3', alt: '#a39d86', pattern: 'stripes' },
      },
      parts: [
        q(0, 18, 0, 6, 12, 3, 'body'), q(0, 28, 0, 8, 8, 8, 'head', { head: true }),
        limb('armL', -4.5, 24, 0, 2, 12, 2, 'arm', 'x', 0.5, 0, { aim: -1.5 }), limb('armR', 4.5, 24, 0, 2, 12, 2, 'arm', 'x', -0.5, 0, { aim: -1.5 }),
        limb('legL', -1.5, 12, 0, 2, 12, 2, 'leg', 'x', 0.8, 0), limb('legR', 1.5, 12, 0, 2, 12, 2, 'leg', 'x', 0.8, 1),
      ],
    },
  },
  creepcrawler: {
    name: 'Creepcrawler', kind: 'hostile', w: 1.1, h: 0.75, hp: 16, speed: 3.7, eyeH: 0.5, voice: 'crawler', ai: 'spider', surface: true, neutralByDay: true, climbs: true,
    melee: { damage: 2, reach: 1.4, everyS: 0.9, windupS: 0.15, knockback: 2 }, pounce: { range: 4.5, minRange: 2.0, speed: 9, up: 5.5, damage: 3, everyS: 3.0 }, sight: 20, group: [1, 3],
    drops: [['string', 0, 2]],
    model: {
      anim: 'spider',
      tex: { body: { base: '#3b2e44', alt: '#27202f', pattern: 'plates' }, head: { base: '#2d2336', alt: '#1b1621', pattern: 'solid', face: 'spider' }, leg: { base: '#4a3a56', alt: '#2f2539', pattern: 'stripes' } },
      parts: [
        q(0, 7, 2, 10, 7, 12, 'body'), q(0, 8, -8, 8, 7, 7, 'head', { head: true }),
        ...[-1, 1].flatMap((s, i) => [0, 1, 2, 3].map((k) => limb(`leg${i}${k}`, s * 9, 8, -5 + k * 3.2, 12, 2, 2, 'leg', 'z', s * 0.6, k % 2, { splay: s * (0.5 + k * 0.08) }))),
      ],
    },
  },
  popup: {
    name: 'Pop-up', kind: 'hostile', w: 0.8, h: 0.8, hp: 6, speed: 1.5, eyeH: 0.4, voice: 'popup', ai: 'popup', flying: true, surface: true, cap: 2,
    contact: { range: 0.95, everyS: 8, overlayS: 4 }, sight: 30, group: [1, 1],
    drops: [['popup', 1, 1]],
    model: {
      anim: 'flyer',
      tex: { win: { base: '#cfd3dc', alt: '#8a90a0', pattern: 'solid', face: 'ad' }, back: { base: '#9aa0b0', alt: '#7a8090', pattern: 'grid' }, leg: { base: '#2a2f3a', pattern: 'solid' } },
      parts: [
        q(0, 8, 0, 12, 12, 2, 'win', { head: true }),
        limb('legL', -2.5, 3, 0, 2, 5, 2, 'leg', 'x', 0.9, 0), limb('legR', 2.5, 3, 0, 2, 5, 2, 'leg', 'x', 0.9, 1),
      ],
    },
  },
};

// ---- the Underlayer (STRATA_PART2_SPEC 5.4): they ignore light and never crumble
HOSTILE.daemon = {
  name: 'Daemon', kind: 'hostile', w: 0.6, h: 1.3, hp: 24, speed: 4.4, eyeH: 1.0, voice: 'daemon', ai: 'daemon', underlayer: true,
  dash: { range: 9, speed: 11, everyS: 2.6, durS: 0.4 }, fire: { range: 14, damage: 4, burnS: 2, everyS: 3.2, speed: 13, drawS: 0.5 }, sight: 30, group: [2, 3],
  drops: [['ash_dust', 0, 2], ['cobalt_nugget', 1, 1, 0.15]],
  model: {
    anim: 'biped',
    tex: {
      body: { base: '#7a2a1c', alt: '#4d1810', pattern: 'plates' }, head: { base: '#a53a22', alt: '#6c2314', pattern: 'solid', face: 'imp' },
      arm: { base: '#a53a22', alt: '#6c2314', pattern: 'solid' }, leg: { base: '#3a1a14', alt: '#24100c', pattern: 'stripes' }, horn: { base: '#e8d9b0', pattern: 'solid' },
    },
    parts: [
      q(0, 13, 0, 7, 9, 4, 'body'), q(0, 21, 0, 8, 7, 7, 'head', { head: true }), q(-3, 26, 0, 2, 4, 2, 'horn', { head: true }), q(3, 26, 0, 2, 4, 2, 'horn', { head: true }),
      limb('armL', -5, 17, 0, 3, 9, 3, 'arm', 'x', 0.7, 0, { chase: -1.3 }), limb('armR', 5, 17, 0, 3, 9, 3, 'arm', 'x', -0.7, 0, { chase: -1.3 }),
      limb('legL', -2, 8.5, 0, 3, 8, 3, 'leg', 'x', 0.9, 0), limb('legR', 2, 8.5, 0, 3, 8, 3, 'leg', 'x', 0.9, 1),
    ],
  },
};
HOSTILE.glitch = {
  name: 'Glitch', kind: 'hostile', w: 0.9, h: 1.2, hp: 30, speed: 2.8, eyeH: 0.8, voice: 'glitch', ai: 'glitch', underlayer: true, flicker: true,
  melee: { damage: 5, reach: 1.5, everyS: 1.1, windupS: 0.25, knockback: 5 }, teleport: { everyS: 4, swaps: 3, radius: 2 }, sight: 30, group: [1, 1],
  drops: [['glitch_dust', 1, 2]],
  model: {
    anim: 'biped',
    tex: { cube: { base: '#222', alt: '#ff3cdc', pattern: 'grid', face: 'glitch' }, shard: { base: '#3cfff0', alt: '#ff3cdc', pattern: 'stripes' } },
    parts: [q(0, 8, 0, 11, 11, 11, 'cube', { head: true }), q(7, 14, 3, 3, 3, 3, 'shard'), q(-7, 4, -3, 3, 3, 3, 'shard')],
  },
};

export const HOSTILE_KINDS = Object.keys(HOSTILE);
