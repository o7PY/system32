// Every mob as data (STRATA_PART2_SPEC.md section 5): size, health, speed, behaviour, drops, sounds and the box model. No DOM, no three.js: Node tests import it.
// Models are built in code from boxes (mobmodel.js) and their faces are painted procedurally into a small mob atlas, so no model or texture is downloaded.
// Units: blocks for sizes and speeds, pixels (1/16 block) inside `model`. Entities face -z at yaw 0; z < 0 in a model is the front.
//
// model.parts: { n: name, size: [w, h, d] px, at: [x, y, z] px (the centre of the part, or of its pivot for a limb), tex: key into model.tex,
//   limb?: { pivot: 'top'|'centre', swing: axis, amp: radians, phase: 0|1 }, head?: true (looks at the target), flap?: true (a wing) }
// model.tex[key]: { base, alt?, pattern: 'solid'|'spots'|'stripes'|'wool'|'plates'|'grid', face?: 'pig'|'cow'|'sheep'|'chicken'|'zombie'|'skull'|'spider'|'ad'|'imp'|'glitch'|'bin'|'core' }

const q = (x, y, z, w, h, d, tex, extra = {}) => ({ size: [w, h, d], at: [x, y, z], tex, ...extra });
const leg = (n, x, z, tex, phase, h = 6, w = 3, y = h) => ({ n, size: [w, h, w], at: [x, y, z], tex, limb: { pivot: 'top', swing: 'x', amp: 0.7, phase } });

export const MOBS = {
  // ------------------------------------------------------------------ passive animals (overworld grass)
  pig: {
    name: 'Pig', kind: 'passive', w: 0.9, h: 0.95, hp: 10, speed: 1.3, flee: 3.4, eyeH: 0.7, voice: 'pig',
    drops: [['raw_pork', 1, 3]], spawn: { biomes: ['plains', 'forest'], group: [1, 3] },
    model: {
      anim: 'quadruped',
      tex: {
        body: { base: '#e9a0ae', alt: '#d4808f', pattern: 'spots' }, head: { base: '#efaab6', alt: '#d4808f', pattern: 'solid', face: 'pig' },
        snout: { base: '#f4bcc4', pattern: 'solid' }, leg: { base: '#d98a99', pattern: 'solid' }, ear: { base: '#c7707f', pattern: 'solid' }, tail: { base: '#c7707f', pattern: 'solid' },
      },
      parts: [
        q(0, 11, 0, 10, 9, 16, 'body'), q(0, 12, -11, 8, 8, 8, 'head', { head: true }), q(0, 10, -15.5, 4, 3, 1, 'snout', { head: true }),
        q(-3, 17, -9, 2, 3, 1, 'ear', { head: true }), q(3, 17, -9, 2, 3, 1, 'ear', { head: true }), q(0, 14, 9, 2, 2, 2, 'tail'),
        leg('legFL', -3, -5, 'leg', 0), leg('legFR', 3, -5, 'leg', 1), leg('legBL', -3, 5, 'leg', 1), leg('legBR', 3, 5, 'leg', 0),
      ],
    },
  },
  cow: {
    name: 'Cow', kind: 'passive', w: 0.95, h: 1.45, hp: 10, speed: 1.2, flee: 3.2, eyeH: 1.2, voice: 'cow',
    drops: [['raw_beef', 1, 3], ['leather', 0, 2]], spawn: { biomes: ['plains', 'forest'], group: [1, 3] },
    model: {
      anim: 'quadruped',
      tex: {
        body: { base: '#f1e6d2', alt: '#6b4a32', pattern: 'spots' }, head: { base: '#6b4a32', alt: '#f1e6d2', pattern: 'solid', face: 'cow' }, snout: { base: '#d9b39a', pattern: 'solid' },
        leg: { base: '#4f3826', pattern: 'solid' }, horn: { base: '#f4efe0', pattern: 'solid' }, udder: { base: '#e9a9b0', pattern: 'solid' }, tail: { base: '#4f3826', pattern: 'solid' },
      },
      parts: [
        q(0, 17, 0, 12, 10, 18, 'body'), q(0, 21, -12, 8, 8, 7, 'head', { head: true }), q(0, 19, -16, 6, 4, 1, 'snout', { head: true }),
        q(-5, 26, -12, 2, 3, 2, 'horn', { head: true }), q(5, 26, -12, 2, 3, 2, 'horn', { head: true }), q(0, 12, 6, 5, 2, 4, 'udder'), q(0, 18, 10, 2, 8, 1, 'tail'),
        leg('legFL', -4, -6, 'leg', 0, 12, 4), leg('legFR', 4, -6, 'leg', 1, 12, 4), leg('legBL', -4, 6, 'leg', 1, 12, 4), leg('legBR', 4, 6, 'leg', 0, 12, 4),
      ],
    },
  },
  sheep: {
    name: 'Sheep', kind: 'passive', w: 0.9, h: 1.25, hp: 8, speed: 1.2, flee: 3.2, eyeH: 1.0, voice: 'sheep', shearable: true, woolRegrowS: 120,
    drops: [['raw_mutton', 1, 2], ['wool', 1, 2]], spawn: { biomes: ['plains', 'forest'], group: [2, 4] },
    model: {
      anim: 'quadruped',
      tex: {
        wool: { base: '#f3efe6', alt: '#dcd5c6', pattern: 'wool' }, woolBare: { base: '#e8bfa8', pattern: 'solid' }, head: { base: '#4a4440', pattern: 'solid', face: 'sheep' },
        leg: { base: '#4a4440', pattern: 'solid' },
      },
      parts: [
        q(0, 15, 0, 11, 10, 16, 'wool', { wool: true }), q(0, 18, -10, 6, 6, 6, 'head', { head: true }),
        q(0, 17, -4, 9, 8, 8, 'wool', { wool: true }),
        leg('legFL', -3, -5, 'leg', 0, 10, 3), leg('legFR', 3, -5, 'leg', 1, 10, 3), leg('legBL', -3, 5, 'leg', 1, 10, 3), leg('legBR', 3, 5, 'leg', 0, 10, 3),
      ],
    },
  },
  chicken: {
    name: 'Chicken', kind: 'passive', w: 0.45, h: 0.7, hp: 4, speed: 1.0, flee: 2.8, eyeH: 0.55, voice: 'chicken', flutter: true,
    drops: [['raw_chicken', 1, 1], ['feather', 0, 2]], spawn: { biomes: ['plains', 'forest'], group: [2, 4] },
    model: {
      anim: 'bird',
      tex: {
        body: { base: '#f7f4ec', alt: '#e2dccb', pattern: 'wool' }, head: { base: '#f7f4ec', pattern: 'solid', face: 'chicken' }, beak: { base: '#f0b13a', pattern: 'solid' },
        comb: { base: '#d8362f', pattern: 'solid' }, leg: { base: '#f0b13a', pattern: 'solid' }, wing: { base: '#e9e3d2', alt: '#d6cdb6', pattern: 'stripes' }, tail: { base: '#efe9da', pattern: 'solid' },
      },
      parts: [
        q(0, 8, 0, 6, 6, 8, 'body'), q(0, 14, -4, 4, 5, 4, 'head', { head: true }), q(0, 13, -7, 2, 2, 2, 'beak', { head: true }), q(0, 17.5, -4, 1, 3, 3, 'comb', { head: true }),
        q(0, 11, 5, 3, 4, 2, 'tail'),
        { n: 'wingL', size: [1, 4, 5], at: [-3.5, 10, 0], tex: 'wing', limb: { pivot: 'top', swing: 'z', amp: 1.0, phase: 0 }, flap: true },
        { n: 'wingR', size: [1, 4, 5], at: [3.5, 10, 0], tex: 'wing', limb: { pivot: 'top', swing: 'z', amp: -1.0, phase: 0 }, flap: true },
        leg('legL', -1.5, 0, 'leg', 0, 5, 1), leg('legR', 1.5, 0, 'leg', 1, 5, 1),
      ],
    },
  },
};

export const PASSIVE = Object.keys(MOBS).filter((k) => MOBS[k].kind === 'passive');
export const mobDef = (type) => MOBS[type] ?? null;
