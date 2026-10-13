# Credits

## Assets

- **Ultimate Space Kit** by Quaternius (quaternius.com), CC0 1.0 (public domain dedication,
  https://creativecommons.org/publicdomain/zero/1.0/). The raw pack lives in `assets/source/` and is not committed;
  only processed models inside a game's own folder are. Used by SpaceSaga: 25 models processed by `tools/build-assets.mjs`
  into `games/space-saga/models/` (scaled, meshopt-compressed, textures resized to WebP).
- **Voxel Pack** by Kenney (kenney.nl), CC0 1.0. Used by Strata: 24 block-face tiles and 14 item icons, downscaled to 32x32 and packed into
  `games/strata/assets/atlas.png` and `items.png` by `tools/strata/build-assets.mjs` (bedrock, the crafting table's side and front, the Ad Block
  ore, the stick, the iron ingot and the pop-up icon are drawn in code, not from the pack).
- **Impact Sounds**, **RPG Audio**, **Interface Sounds**, **UI Audio** and **Music Jingles** by Kenney (kenney.nl), CC0 1.0. Used by Strata: 62 short
  sounds (mining, footsteps, placing, pickups, UI, furnace, the first-iron-tool jingle), converted to mono Ogg Vorbis, trimmed and normalised into
  `games/strata/assets/sounds/`.
- **Kenney Pixel** font from **Kenney Fonts** by Kenney (kenney.nl), CC0 1.0. Used by Strata (`games/strata/assets/font.ttf`).
- The raw Kenney packs live in `assets/source/` (gitignored); only the processed outputs inside `games/strata/assets/` are committed.

## Libraries

- **three.js** v0.186.1 (MIT, https://threejs.org), vendored in `games/_shared/vendor/three/`: `three.module.min.js` and
  `three.core.min.js` (minified once from the release's `build/` files by `tools/vendor-three.mjs`, because that release ships no
  `.min` build), plus the addons `GLTFLoader`, `SkeletonUtils`, `BufferGeometryUtils` and the meshopt decoder, copied unmodified.
  Used by SpaceSaga and Strata. Bump with `node tools/vendor-three.mjs <version>`.
- Dev-only, never shipped: glTF-Transform (MIT), meshoptimizer (MIT), sharp (Apache-2.0), esbuild (MIT), used by the tools in `tools/`.

## Sound

- SpaceSaga, the shell and Strata's ambient music are synthesized at runtime with the WebAudio API. The only audio files in the project are
  Strata's Kenney samples listed above.

<!-- Add new entries above this line, one bullet per asset or library: name, author, license, where it is used. -->
