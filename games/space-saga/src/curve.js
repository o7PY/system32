// Round-planet look: every vertex drops by (view-space distance)^2 / (2R), so the track, the ground and everything on them
// bend away over the horizon (obstacles rise into view from below it). Pure visual: collision and spawning stay flat.
// Patches the shared Material prototype once, so pooled kit models, decals and pickups all get it without being touched.
import * as THREE from 'three';

export const curve = { k: { value: 0 } };          // 1 / (2R); 0 = flat

export function setPlanetRadius(r) { curve.k.value = r > 0 ? 1 / (2 * r) : 0; }

const SKIP = ['MeshDepthMaterial', 'MeshDistanceMaterial'];    // shadow passes stay flat, like the sun they come from

const original = THREE.Material.prototype.onBeforeCompile;
THREE.Material.prototype.onBeforeCompile = function (shader, renderer) {
  original?.call(this, shader, renderer);
  if (this.isPointsMaterial || this.isSpriteMaterial || this.userData.noBend || SKIP.includes(this.type)) return;
  shader.uniforms.uCurve = curve.k;
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'uniform float uCurve;\nvoid main() {')
    .replace('#include <project_vertex>', `#include <project_vertex>
  mvPosition.y -= (mvPosition.x * mvPosition.x + mvPosition.z * mvPosition.z) * uCurve;
  gl_Position = projectionMatrix * mvPosition;`);
};
const key = THREE.Material.prototype.customProgramCacheKey;
THREE.Material.prototype.customProgramCacheKey = function () { return (key?.call(this) ?? '') + (this.userData.noBend ? 'f' : 'c'); };
