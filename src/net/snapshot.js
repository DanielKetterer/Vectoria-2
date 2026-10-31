// Binary snapshot of the host's world, sent to the guest ~30 times a second.
// Float32 is plenty for rendering. Around 4 KB for a full level of dots.
//
// Layout (all float32):
//   gen, clock, flags(1=completed, 2=failed, 4=versus), goalFraction,
//   score1, score2, winner, timeLimitTicks, countdown (ticks before play starts),
//   nSources, [x, y, button, player, held] * nSources,
//   nResolved, [x, y, mode(0=div,1=curl), sign] * nResolved,
//   nDots, [x, y] * nDots

export function encodeSnapshot(gen, world, sources, countdown = 0) {
  const res = world.lastResolved;
  const len = 9 + 1 + sources.length * 5 + 1 + res.length * 4 + 1 + world.n * 2;
  const f = new Float32Array(len);
  let k = 0;
  f[k++] = gen;
  f[k++] = world.clock;
  f[k++] = (world.completed ? 1 : 0) | (world.failed ? 2 : 0) | (world.versus ? 4 : 0);
  f[k++] = world.goalFraction();
  f[k++] = world.score[1];
  f[k++] = world.score[2];
  f[k++] = world.winner;
  f[k++] = world.timeLimitTicks;
  f[k++] = countdown;
  f[k++] = sources.length;
  for (const s of sources) {
    f[k++] = s.x; f[k++] = s.y; f[k++] = s.button; f[k++] = s.player || 0; f[k++] = s.held ? 1 : 0;
  }
  f[k++] = res.length;
  for (const r of res) {
    f[k++] = r.x; f[k++] = r.y; f[k++] = r.mode === 'curl' ? 1 : 0; f[k++] = r.sign;
  }
  f[k++] = world.n;
  for (let i = 0; i < world.n; i++) {
    f[k++] = world.px[i]; f[k++] = world.py[i];
  }
  return f.buffer;
}

export function decodeSnapshot(buf) {
  const f = new Float32Array(buf);
  let k = 0;
  const gen = f[k++];
  const clock = f[k++];
  const flags = f[k++];
  const goal = f[k++];
  const score = [0, f[k++], f[k++]];
  const winner = f[k++];
  const timeLimitTicks = f[k++];
  const countdown = f[k++];
  const sources = [];
  const ns = f[k++];
  for (let i = 0; i < ns; i++) {
    sources.push({ x: f[k++], y: f[k++], button: f[k++], player: f[k++], held: f[k++] === 1 });
  }
  const resolved = [];
  const nr = f[k++];
  for (let i = 0; i < nr; i++) {
    resolved.push({ x: f[k++], y: f[k++], mode: f[k++] === 1 ? 'curl' : 'div', sign: f[k++] });
  }
  const n = f[k++];
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = f[k++]; py[i] = f[k++];
  }
  return {
    gen, clock, completed: (flags & 1) !== 0, failed: (flags & 2) !== 0, versus: (flags & 4) !== 0,
    goal, score, winner, timeLimitTicks, countdown, sources, resolved, n, px, py,
  };
}

// What the guest draws: same fields drawWorld/drawOverlays read from a World,
// filled from snapshots and interpolated between the last two.
export class GuestView {
  constructor(map, gen) {
    this.map = map;
    this.gen = gen;
    this.n = 0;
    this.px = new Float32Array(0);
    this.py = new Float32Array(0);
    this.clock = 0;
    this.completed = false;
    this.failed = false;
    this.goal = 0;
    this.versus = map.isVersus;
    this.score = [0, 0, 0];
    this.winner = 0;
    this.timeLimitTicks = 0;
    this.countdown = 0;       // ticks before play starts, from the host
    this.goAt = -1e9;         // when the countdown hit zero here (GO! flash)
    this.lastResolved = [];
    this.sources = [];
    this.prev = null;
    this.curr = null;
    this.currAt = 0;
    this.interval = 1000 / 30;
  }

  push(snap, now) {
    if (this.curr) {
      // Track the actual arrival interval so interpolation fits the network.
      const dt = now - this.currAt;
      if (dt > 5 && dt < 500) this.interval = this.interval * 0.8 + dt * 0.2;
    }
    this.prev = this.curr && this.curr.n === snap.n ? this.curr : snap;
    this.curr = snap;
    this.currAt = now;
    this.clock = snap.clock;
    this.completed = snap.completed;
    this.failed = snap.failed;
    this.goal = snap.goal;
    this.versus = snap.versus;
    this.score = snap.score;
    this.winner = snap.winner;
    this.timeLimitTicks = snap.timeLimitTicks;
    if (this.countdown > 0 && snap.countdown === 0) this.goAt = now;
    this.countdown = snap.countdown;
    this.lastResolved = snap.resolved;
    this.sources = snap.sources;
    if (this.n !== snap.n) {
      this.n = snap.n;
      this.px = new Float32Array(snap.n);
      this.py = new Float32Array(snap.n);
    }
  }

  // Render one snapshot interval behind, blending prev -> curr.
  update(now) {
    if (!this.curr) return;
    const a = Math.min(1, Math.max(0, (now - this.currAt) / this.interval));
    const p = this.prev;
    const c = this.curr;
    for (let i = 0; i < this.n; i++) {
      this.px[i] = p.px[i] + (c.px[i] - p.px[i]) * a;
      this.py[i] = p.py[i] + (c.py[i] - p.py[i]) * a;
    }
  }

  goalFraction() {
    return this.goal;
  }

  majority() {
    return Math.floor(this.n / 2) + 1;
  }
}
