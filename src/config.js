// Gameplay constants, ported from vectoria/config.py.

export const MAP_W = 800;
export const MAP_H = 600;

export const LEVEL_COUNT = 5;
export const TUTORIAL_COUNT = 2;

// Simulation runs at a fixed rate regardless of monitor refresh rate.
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const MAX_TICKS_PER_FRAME = 5; // avoid a spiral after a stalled tab

export const STEP_SIZE = 0.5;   // impulse per tick per held source
export const SAMPLE_STEP = 32;  // dot grid spacing and overlay sample spacing
export const TOLERANCE = 50;    // per-channel color match tolerance
export const FRICTION = 0.94;
export const RESTITUTION = 0.8;
export const DOT_RADIUS = 6;

export const WIN_FRACTION = 0.75;   // fraction of dots in goal to complete
export const FAIL_FRACTION = 0.25;  // fraction of dots trapped (strictly above) to fail

// Zone ids. Order matters only for readability; colors are far apart so at
// most one ever matches within TOLERANCE.
export const Z = {
  NONE: 0,     // unmatched pixel (e.g. white): passable, no actions, no dots spawn
  MAGENTA: 1,  // movement only
  YELLOW: 2,   // push/pull and spin
  TEAL: 3,     // push/pull only
  BLUE: 4,     // spin only
  GREEN: 5,    // goal: dots stop here
  BLACK: 6,    // wall
  RED: 7,      // trap: dots stop here
};

export const ZONE_COLORS = [
  [Z.MAGENTA, [255, 0, 255], 'magenta.png'],
  [Z.YELLOW, [255, 255, 0], 'yellow.png'],
  [Z.TEAL, [0, 255, 255], 'teal.png'],
  [Z.BLUE, [0, 0, 255], 'blue.png'],
  [Z.GREEN, [0, 255, 0], 'green.png'],
  [Z.BLACK, [0, 0, 0], 'black.png'],
  [Z.RED, [255, 0, 0], 'red.png'],
];

// Star thresholds per level: [3-star under, 2-star under, 1-star under] seconds.
// The Python game read these from stars.csv, which isn't in the repo, so every
// level fell back to [2, 5, 10]. Same default here; edit per level as needed.
export const STAR_THRESHOLDS = [
  [2, 5, 10],
  [2, 5, 10],
  [2, 5, 10],
  [2, 5, 10],
  [2, 5, 10],
];

export const COLORS = {
  dot: '#ffffff',
  hudText: '#000000',
  overlay: 'rgb(200,200,200)',
  curl: 'rgb(255,255,0)',
  panelBg: 'rgba(0,0,0,0.7)',
};

export const CONFETTI_COUNT = 50;
export const CONFETTI_COLORS = ['rgb(255,99,71)', 'rgb(255,215,0)', 'rgb(135,206,250)', 'rgb(144,238,144)', 'rgb(255,182,193)'];
export const FIREWORK_SPAWN_INTERVAL_MS = 800;
export const EXPLOSION_PARTICLES = 100;
export const EXPLOSION_SPEED = 5.0;
export const EXPLOSION_GRAVITY = 0.1;
export const PARTICLE_LIFETIME = 60;

export function computeStars(elapsedS, level) {
  const thr = STAR_THRESHOLDS[level - 1] || STAR_THRESHOLDS[0];
  const [t3, t2, t1] = thr;
  if (elapsedS < t3) return 3;
  if (elapsedS < t2) return 2;
  if (elapsedS < t1) return 1;
  return 0;
}
