// Simulation: dots, flow fields, and force sources. No DOM access here, so
// this module can later run identically on a networked host or peer.

import {
  MAP_W, MAP_H, SAMPLE_STEP, STEP_SIZE, FRICTION, RESTITUTION,
  WIN_FRACTION, FAIL_FRACTION, Z,
} from './config.js';

// Unit flow direction at `offset` from a source. Same fields as
// utils/flow.py: "div" is radial, "curl" is tangential.
export function flowDir(mode, ox, oy) {
  const r = Math.hypot(ox, oy);
  if (r === 0) return [0, 0];
  if (mode === 'div') return [ox / r, oy / r];
  if (mode === 'curl') return [oy / r, -ox / r];
  return [0, 0];
}

// Decide what a held source does at its current position. Returns null if
// the zone under it allows no action. Button 1 = left/primary, 3 = right.
// Rules match the Python game: a single-action zone uses that action for
// either button; a both-action (yellow) zone maps left to div, right to curl;
// right always flips the sign.
export function resolveSource(map, src) {
  const canDiv = map.allowsDiv(src.x, src.y);
  const canCurl = map.allowsCurl(src.x, src.y);
  if (!canDiv && !canCurl) return null;
  let mode;
  if (canDiv && !canCurl) mode = 'div';
  else if (canCurl && !canDiv) mode = 'curl';
  else mode = src.button === 1 ? 'div' : 'curl';
  return { x: src.x, y: src.y, mode, sign: src.button === 3 ? -1 : 1 };
}

// Superposed field of several resolved sources at (x, y).
export function fieldAt(resolved, x, y) {
  let fx = 0;
  let fy = 0;
  for (const s of resolved) {
    const [dx, dy] = flowDir(s.mode, x - s.x, y - s.y);
    fx += s.sign * dx;
    fy += s.sign * dy;
  }
  return [fx, fy];
}

export class World {
  constructor(map) {
    this.map = map;
    const xs = [];
    const ys = [];
    for (let x = SAMPLE_STEP / 2; x < MAP_W; x += SAMPLE_STEP) {
      for (let y = SAMPLE_STEP / 2; y < MAP_H; y += SAMPLE_STEP) {
        if (map.allowsMove(x, y)) {
          xs.push(x);
          ys.push(y);
        }
      }
    }
    const n = xs.length;
    this.n = n;
    this.px = Float64Array.from(xs);
    this.py = Float64Array.from(ys);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);

    this.tick = 0;            // simulated ticks since level start
    this.hasActed = false;    // win/lose checks start after the first action
    this.lastResolved = [];   // most recent sources that applied force (for overlays)
    this.completed = false;
    this.failed = false;
  }

  // Is dot i frozen (in a goal or a trap)?
  frozen(i) {
    const z = this.map.zoneAt(this.px[i], this.py[i]);
    return z === Z.GREEN || z === Z.RED;
  }

  // One fixed-rate step. `sources` is the list of player sources; each held
  // (or just-tapped) source applies exactly one impulse per tick, no matter
  // how often its pointer moved. Forces from multiple sources add.
  step(sources) {
    const map = this.map;
    const inputOpen = !this.completed && !this.failed;

    const resolved = [];
    if (inputOpen) {
      for (const s of sources) {
        if (!(s.held || s.tap)) continue;
        s.tap = false;
        const r = resolveSource(map, s);
        if (r) resolved.push(r);
      }
    }

    if (resolved.length) {
      this.hasActed = true;
      this.lastResolved = resolved;
      for (let i = 0; i < this.n; i++) {
        if (this.frozen(i)) continue;
        const x = this.px[i];
        const y = this.py[i];
        // Each source's impulse is checked against walls on its own, as in
        // the original (a push that would land in a wall is dropped).
        for (const s of resolved) {
          const [dx, dy] = flowDir(s.mode, x - s.x, y - s.y);
          const ix = dx * STEP_SIZE * s.sign;
          const iy = dy * STEP_SIZE * s.sign;
          if (!map.isWall(x + ix, y + iy)) {
            this.vx[i] += ix;
            this.vy[i] += iy;
          }
        }
      }
    }

    // Integrate (Dot.update).
    for (let i = 0; i < this.n; i++) {
      if (this.frozen(i)) continue;
      const x = this.px[i];
      const y = this.py[i];
      const nx = x + this.vx[i];
      const ny = y + this.vy[i];
      if (nx < 0 || nx >= MAP_W || map.isWall(nx, y)) this.vx[i] *= -RESTITUTION;
      if (ny < 0 || ny >= MAP_H || map.isWall(x, ny)) this.vy[i] *= -RESTITUTION;
      this.px[i] += this.vx[i];
      this.py[i] += this.vy[i];
      this.vx[i] *= FRICTION;
      this.vy[i] *= FRICTION;
    }

    this.tick++;

    if (this.hasActed && !this.completed && !this.failed && this.n > 0) {
      let inGoal = 0;
      let trapped = 0;
      for (let i = 0; i < this.n; i++) {
        const z = map.zoneAt(this.px[i], this.py[i]);
        if (z === Z.GREEN) inGoal++;
        else if (z === Z.RED) trapped++;
      }
      if (inGoal / this.n >= WIN_FRACTION) this.completed = true;
      else if (trapped / this.n > FAIL_FRACTION) this.failed = true;
    }
  }

  goalFraction() {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.map.isTarget(this.px[i], this.py[i])) k++;
    return this.n ? k / this.n : 0;
  }
}
