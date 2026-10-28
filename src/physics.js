// Simulation: dots, flow fields, and force sources. No DOM access here, so
// this module can later run identically on a networked host or peer.

import {
  MAP_W, MAP_H, SAMPLE_STEP, STEP_SIZE, FRICTION, RESTITUTION,
  WIN_FRACTION, FAIL_FRACTION, Z, TICK_HZ, VERSUS_TIME_LIMIT_S,
} from './config.js';

const FROZEN = new Set([Z.GREEN, Z.RED, Z.GOAL_P1, Z.GOAL_P2]);

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
  // opts.versus: competitive rules (per-player goals, majority or timeout,
  // no trap-failure). Defaults to whether the map has both player goals.
  constructor(map, opts = {}) {
    this.map = map;
    this.versus = opts.versus ?? map.isVersus;
    const xs = [];
    const ys = [];
    for (let x = SAMPLE_STEP / 2; x < MAP_W; x += SAMPLE_STEP) {
      for (let y = SAMPLE_STEP / 2; y < MAP_H; y += SAMPLE_STEP) {
        if (map.allowsSpawn(x, y)) {
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
    this.score = [0, 0, 0];   // versus: dots in [unused, P1 goal, P2 goal]
    this.winner = 0;          // versus: 0 = playing, 1 / 2 = that player, 3 = draw
    this.timeLimitTicks = VERSUS_TIME_LIMIT_S * TICK_HZ;
  }

  // Is dot i frozen (in a goal or a trap)?
  frozen(i) {
    return FROZEN.has(this.map.zoneAt(this.px[i], this.py[i]));
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

    if (this.versus) {
      this.checkVersus();
      return;
    }

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

  // Versus: a strict majority of all dots ends it at once; otherwise the
  // larger count wins at the time limit (equal = draw). Traps just remove
  // dots from play; there's no failure state.
  checkVersus() {
    if (this.completed) return;
    let a = 0;
    let b = 0;
    for (let i = 0; i < this.n; i++) {
      const z = this.map.zoneAt(this.px[i], this.py[i]);
      if (z === Z.GOAL_P1) a++;
      else if (z === Z.GOAL_P2) b++;
    }
    this.score = [0, a, b];
    if (a * 2 > this.n) this.winner = 1;
    else if (b * 2 > this.n) this.winner = 2;
    else if (this.tick >= this.timeLimitTicks) this.winner = a > b ? 1 : b > a ? 2 : 3;
    if (this.winner) this.completed = true;
  }

  // Dots a player needs to win outright.
  majority() {
    return Math.floor(this.n / 2) + 1;
  }

  goalFraction() {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.map.isTarget(this.px[i], this.py[i])) k++;
    return this.n ? k / this.n : 0;
  }
}
