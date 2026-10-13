// First-person controller: AABB 0.6 x 1.8 x 0.6, eye 1.62, swept per axis (no tunnelling at terminal speed), swimming, sprint and sneak (no walking off edges).
// Pure: it only needs `world.getBlock(x, y, z)`, so Node tests drive it on a hand-built world. No automatic step-up: jumping is part of the feel.
import { CONFIG } from './config.js';
import { B, BLOCKS } from './blocks.js';
import { collidesAt, moveAxis } from './physics.js';

const EPS = 1e-4;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

export class Player {
  constructor(world, cfg = CONFIG.player) {
    this.world = world; this.cfg = cfg;
    this.pos = { x: 0, y: 0, z: 0 };                 // feet, centre of the box
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;                    // yaw 0 looks toward -z
    this.onGround = false; this.inWater = false; this.headInWater = false;
    this.sneaking = false; this.sprinting = false;
    this.eyeH = cfg.eye;
    this.hitX = false; this.hitZ = false;
    this.lastLanded = 0;                             // downward speed at the last landing (for the sound)
    this.stepDist = 0;                               // distance walked on the ground since the last footstep
    this.inLava = false; this.headInSolid = false;   // survival: lava burns, a head inside an opaque block suffocates
    this.peakY = 0; this.lastFall = 0;               // highest feet position of the current fall, and how far the last fall was (read and cleared by takeFall)
    this.flying = false;                              // Creative: no gravity, Space up, C down
    this.jumped = false;                             // set when a jump starts (hunger), cleared by the caller
  }
  /** The distance of the fall that just ended (0 = none), cleared on read. Landing in water or lava ends a fall at once. */
  takeFall() { const f = this.lastFall; this.lastFall = 0; return f; }

  teleport(x, y, z) { this.pos.x = x; this.pos.y = y; this.pos.z = z; this.vel.x = this.vel.y = this.vel.z = 0; }
  eye() { return { x: this.pos.x, y: this.pos.y + this.eyeH, z: this.pos.z }; }
  /** Look direction (unit vector). */
  dir() { const cp = Math.cos(this.pitch); return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp }; }
  look(dx, dy, sens = 1, invertY = false) {
    this.yaw -= dx * this.cfg.sensitivity * sens;
    this.pitch = clamp(this.pitch - dy * this.cfg.sensitivity * sens * (invertY ? -1 : 1), -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }
  box(x = this.pos.x, y = this.pos.y, z = this.pos.z) { const hw = this.cfg.width / 2; return { x0: x - hw, x1: x + hw, y0: y, y1: y + this.cfg.height, z0: z - hw, z1: z + hw }; }

  /** Does the box at (x, y, z) overlap a solid block (a partial block collides with its own box: a bed is 9/16 high)? */
  collides(x, y, z) { return collidesAt((a, b, c) => this.world.getBlock(a, b, c), { x, y, z }, this.cfg.width, this.cfg.height); }
  #water(x, y, z) { return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.water; }
  #lava(x, y, z) { return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.lava; }

  /** Move along one axis in sub-steps of at most cfg.maxStep; on contact snap to the block face. Returns true if it hit something. */
  #move(axis, d) { return moveAxis((a, b, c) => this.world.getBlock(a, b, c), this.pos, this.cfg.width, this.cfg.height, axis, d, this.cfg.maxStep); }

  /** Is there ground within `depth` below the box at (x, z) (used to stop a sneaking player at an edge)? */
  #supported(x, z, depth) { return this.collides(x, this.pos.y - depth, z); }

  /**
   * One physics step. inp: { x: strafe -1..1 (right +), z: forward -1..1, jump, sneak, sprint }
   * (z > 0 = forward). dt is clamped; fast frames are fine because each axis is swept.
   */
  update(dt, inp) {
    dt = Math.min(dt, 0.05);
    const c = this.cfg, p = this.pos, v = this.vel;
    this.inWater = this.#water(p.x, p.y + 0.4, p.z);
    this.inLava = this.#lava(p.x, p.y + 0.1, p.z) || this.#lava(p.x, p.y + 0.9, p.z);
    this.headInWater = this.#water(p.x, p.y + this.eyeH, p.z);
    const eyeBlock = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + this.eyeH), Math.floor(p.z));
    this.headInSolid = BLOCKS[eyeBlock]?.opaque ?? false;
    const fluid = this.inWater || this.inLava;                                                  // both are swum in
    if (this.onGround || fluid) this.peakY = p.y; else this.peakY = Math.max(this.peakY, p.y);
    this.sneaking = !!inp.sneak && !fluid;
    this.sprinting = !!inp.sprint && inp.z > 0 && !this.sneaking && !fluid && inp.canSprint !== false;
    this.eyeH = approach(this.eyeH, this.sneaking ? c.sneakEye : c.eye, 4 * dt);

    // wanted horizontal velocity
    let wx = 0, wz = 0;
    const len = Math.hypot(inp.x, inp.z);
    if (len > 0) {
      const f = inp.z / Math.max(1, len), s = inp.x / Math.max(1, len);
      wx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s;
      wz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s;
    }
    const speed = fluid ? c.swim * (this.inLava && !this.inWater ? 0.5 : 1) : this.sneaking ? c.sneak : this.sprinting ? c.sprint : c.walk;
    const acc = (this.onGround || fluid ? c.accel : c.airAccel) * dt;
    v.x = approach(v.x, wx * speed, acc); v.z = approach(v.z, wz * speed, acc);

    if (this.flying) {
      const fs = (inp.sprint ? 14 : 9);
      v.x = approach(v.x, wx * fs, 80 * dt); v.z = approach(v.z, wz * fs, 80 * dt);
      v.y = approach(v.y, (inp.jump ? 1 : 0) * fs - (inp.sneak ? fs : 0), 60 * dt);
      const hx = this.#move('x', v.x * dt), hz = this.#move('z', v.z * dt), hy = this.#move('y', v.y * dt);
      if (hx) v.x = 0; if (hz) v.z = 0; if (hy) { if (v.y < 0) this.flying = false; v.y = 0; }               // landing ends the flight
      this.onGround = hy && !this.flying; this.peakY = p.y; this.lastFall = 0; this.hitX = hx; this.hitZ = hz;
      return this;
    }
    // vertical (the position uses the average of the old and new velocity, so a jump is an exact parabola: peak = jump^2 / 2g)
    let vy0;
    if (fluid) {
      vy0 = v.y;
      v.y = approach(v.y, inp.jump ? c.swimUp : -c.swimSink, 24 * dt);
      if (inp.jump && (this.hitX || this.hitZ)) v.y = Math.max(v.y, 5.5);            // climb out onto a ledge
    } else {
      if (inp.jump && this.onGround) { v.y = c.jump; this.onGround = false; this.jumped = true; }
      vy0 = v.y;
      v.y = Math.max(-c.terminal, v.y - c.gravity * dt);
    }

    // move: x, z, y, each swept
    const wasGround = this.onGround;
    let dx = v.x * dt, dz = v.z * dt;
    if (this.sneaking && wasGround) {                                                // never step off an edge while sneaking
      while (dx !== 0 && !this.#supported(p.x + dx, p.z, 0.6)) dx = Math.abs(dx) < 0.05 ? 0 : dx - Math.sign(dx) * 0.05;
      while (dz !== 0 && !this.#supported(p.x + dx, p.z + dz, 0.6)) dz = Math.abs(dz) < 0.05 ? 0 : dz - Math.sign(dz) * 0.05;
    }
    const ox = p.x, oz = p.z;
    this.hitX = this.#move('x', dx); if (this.hitX) v.x = 0;
    this.hitZ = this.#move('z', dz); if (this.hitZ) v.z = 0;
    const fall = v.y;
    const hitY = this.#move('y', (vy0 + v.y) / 2 * dt);
    if (hitY) {
      if (v.y < 0) { this.onGround = true; if (!wasGround) { this.lastLanded = -fall; this.lastFall = fluid ? 0 : Math.max(0, this.peakY - p.y); } this.peakY = p.y; } else this.onGround = false;
      v.y = 0;
    } else this.onGround = false;
    if (this.onGround && !fluid) this.stepDist += Math.hypot(p.x - ox, p.z - oz); else this.stepDist = 0;
    return this;
  }
}
