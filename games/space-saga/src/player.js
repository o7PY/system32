// The runner: three lanes, a fixed-arc jump, a slide, a 120 ms input buffer, and animation states. The player stays at z = 0.
import { CONFIG } from './config.js';

const easeOut = (u) => 1 - (1 - u) * (1 - u);
export const laneX = (lane) => (lane - 1) * CONFIG.laneWidth;

export class Player {
  /** @param visual { root, anim } from Assets.character('player') */
  constructor(visual) {
    this.visual = visual;
    this.root = visual.root;
    this.anim = visual.anim;
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.reset();
  }

  reset() {
    this.lane = 1; this.prevLane = 1; this.fromX = 0; this.x = 0; this.y = 0;
    this.switchT = 1; this.queued = 0;                 // queued = direction of ONE queued switch (-1, 0, +1)
    this.jumpT = -1; this.jumpY = 0; this.fastFall = false;
    this.slideT = -1; this.pendingSlide = false;
    this.buffer = [];
    this.dead = false; this.sitting = false;
    this.sideClips = [];                               // times (game seconds) of side clips
    this.events = [];                                  // 'jump' | 'slide' | 'land' | 'left' | 'right' for sound
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.anim.base = { sy: 1, rx: 0 };
  }

  get switching() { return this.switchT < 1; }
  get jumping() { return this.jumpT >= 0; }
  get sliding() { return this.slideT >= 0 && this.slideT < CONFIG.slide.durS; }
  get grounded() { return this.jumpT < 0; }
  get targetX() { return laneX(this.lane); }

  /** Collision box in world space (x, y range, half sizes). */
  get box() {
    const p = CONFIG.player;
    return { x: this.x, y0: this.y, y1: this.y + (this.sliding ? p.slideHeight : p.height), halfW: p.halfW, halfD: p.halfD };
  }

  /** 'left' | 'right' | 'jump' | 'slide' */
  input(action) {
    if (this.dead || this.sitting) return;
    this.buffer.push({ action, age: 0 });
    if (this.buffer.length > 6) this.buffer.shift();
  }

  #startSwitch(dir) {
    this.prevLane = this.lane;
    this.lane += dir;
    this.fromX = this.x;
    this.switchT = 0;
    this.events.push(dir < 0 ? 'left' : 'right');
  }

  #tryAction({ action }) {
    switch (action) {
      case 'left': case 'right': {
        const dir = action === 'left' ? -1 : 1;
        if (!this.switching) {
          const target = this.lane + dir;
          if (target < 0 || target > 2) return true;       // wall: nothing to do, consume
          this.#startSwitch(dir);
          return true;
        }
        if (this.queued === 0 && this.lane + dir >= 0 && this.lane + dir <= 2) { this.queued = dir; return true; }
        return this.lane + dir < 0 || this.lane + dir > 2;
      }
      case 'jump':
        if (!this.grounded) return false;                  // stays buffered: a jump pressed just before landing still happens
        this.slideT = -1;
        this.pendingSlide = false;
        this.jumpT = 0; this.jumpY = 0; this.fastFall = false;
        this.anim.play('jump', { once: true, fitS: CONFIG.jump.durS });
        this.events.push('jump');
        return true;
      case 'slide':
        if (!this.grounded) { this.fastFall = true; this.pendingSlide = true; return true; }
        if (this.sliding) return true;
        this.#startSlide();
        return true;
    }
    return true;
  }

  #startSlide() {
    this.slideT = 0;
    this.pendingSlide = false;
    this.anim.play('slide', { once: true, fitS: CONFIG.slide.durS });
    this.events.push('slide');
  }

  /** A side clip against a blocker: go back to the previous lane. Returns true if this was the second clip inside the window (fatal). */
  sideClip(now) {
    this.sideClips = this.sideClips.filter((t) => now - t < CONFIG.sideClip.windowS);
    const fatal = this.sideClips.length >= 1;
    this.sideClips.push(now);
    if (!fatal) {
      const back = this.prevLane;
      this.lane = back;
      this.fromX = this.x;
      this.switchT = 0;
      this.queued = 0;
    }
    return fatal;
  }

  update(dt, speed) {
    if (this.dead) { this.anim.update(dt); return; }
    // buffered input
    for (const b of this.buffer) b.age += dt;
    this.buffer = this.buffer.filter((b) => b.age <= CONFIG.bufferS + 1e-9 || false);
    // (an action that could not run yet stays until it ages out)
    const pending = [];
    for (const b of this.buffer) if (!this.#tryAction(b)) pending.push(b);
    this.buffer = pending;

    // lane switch
    if (this.switching) {
      this.switchT = Math.min(1, this.switchT + dt / CONFIG.laneSwitchS);
      this.x = this.fromX + (this.targetX - this.fromX) * easeOut(this.switchT);
      if (this.switchT >= 1) {
        this.x = this.targetX;
        if (this.queued) { const d = this.queued; this.queued = 0; this.#startSwitch(d); }
      }
    }
    // jump arc (fixed) or fast fall
    if (this.jumping) {
      if (this.fastFall) {
        this.jumpY -= CONFIG.jump.fastFall * dt;
        this.y = Math.max(0, this.jumpY);
        if (this.jumpY <= 0) this.#land();
      } else {
        this.jumpT += dt;
        const u = this.jumpT / CONFIG.jump.durS;
        if (u >= 1) this.#land();
        else { this.y = 4 * CONFIG.jump.height * u * (1 - u); this.jumpY = this.y; }
      }
    }
    // slide timer
    if (this.slideT >= 0) {
      this.slideT += dt;
      if (this.slideT >= CONFIG.slide.durS) { this.slideT = -1; if (this.grounded) this.anim.play('run'); }
    }
    this.anim.setRate(Math.min(2, Math.max(0.9, speed / 13)));
    this.anim.update(dt);
    this.root.position.set(this.x, this.y, 0);
    this.root.rotation.z = (this.x - this.targetX) * 0.07;
  }

  #land() {
    this.jumpT = -1; this.y = 0; this.jumpY = 0; this.fastFall = false;
    this.events.push('land');
    if (this.pendingSlide) this.#startSlide();
    else if (!this.sliding) this.anim.play('run');
  }

  runPose() { this.anim.play('run'); }
  idlePose() { this.anim.play('idle'); }
  sitDown() { this.sitting = true; this.anim.play('slide', { once: true, fitS: 0.8 }); }
  die() { this.dead = true; this.y = Math.max(0, this.y); this.anim.play('death', { once: true }); }

  drainEvents() { const e = this.events; this.events = []; return e; }
}
