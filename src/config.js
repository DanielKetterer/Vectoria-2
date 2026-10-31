// Gameplay constants, ported from vectoria/config.py.

// Level PNGs are 800x600. The canvas's logical size (MAP_W x MAP_H) follows
// whatever map is on screen: 800x600 for the levels and menus, or a
// screen-shaped size for the generated Versus field on phones. These are live
// bindings, so every module sees the current size.
export const BASE_W = 800;
export const BASE_H = 600;
export let MAP_W = BASE_W;
export let MAP_H = BASE_H;
export function setViewSize(w, h) {
  MAP_W = w;
  MAP_H = h;
}

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
  GOAL_P1: 8,  // versus: player 1 (host, orange) goal; dots stop here
  GOAL_P2: 9,  // versus: player 2 (guest, violet) goal; dots stop here
};

export const ZONE_COLORS = [
  [Z.MAGENTA, [255, 0, 255], 'magenta.png'],
  [Z.YELLOW, [255, 255, 0], 'yellow.png'],
  [Z.TEAL, [0, 255, 255], 'teal.png'],
  [Z.BLUE, [0, 0, 255], 'blue.png'],
  [Z.GREEN, [0, 255, 0], 'green.png'],
  [Z.BLACK, [0, 0, 0], 'black.png'],
  [Z.RED, [255, 0, 0], 'red.png'],
  // Versus goals. These encoding colors sit at least 127 away from every
  // other zone color in some channel, so they never collide at +/-50. Their
  // textures are generated (checkered flags in each player's color).
  [Z.GOAL_P1, [255, 128, 0], null],  // orange
  [Z.GOAL_P2, [128, 0, 255], null],  // purple
];

// Ring/goal colors per player: 0 = solo, 1 = host / player 1, 2 = guest / player 2.
export const PLAYER_COLORS = ['rgba(255,255,255,0.95)', 'rgb(255,150,40)', 'rgb(175,120,255)'];
export const PLAYER_NAMES = ['', 'Orange', 'Violet'];

// Versus: dots frozen in your goal are yours. A player wins the moment their
// goal holds a strict majority of all dots; otherwise the bigger count wins
// when time runs out.
export const VERSUS_MAP_COUNT = 1;
export const VERSUS_MAP_NAMES = ['Open Field'];
export const VERSUS_TIME_LIMIT_S = 120;

// Multiplayer start: 3, 2, 1, then a short GO! flash. The host counts and
// the count rides in every snapshot, so the guest's screen stays in step.
export const COUNTDOWN_S = 3;
export const COUNTDOWN_TICKS = COUNTDOWN_S * TICK_HZ;
export const GO_FLASH_MS = 700;

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

// TURN relays for online play. Without one, devices connect directly, which
// works on most home networks but fails on some: many cellular carriers, and
// routers that don't let two devices on the same Wi-Fi reach each other by
// their public address. A TURN server relays the traffic in those cases
// (it's only used when a direct connection fails, and stays encrypted).
//
// This uses Metered (free plan). The page fetches short-lived TURN
// credentials from this URL when a multiplayer session starts. The key is a
// per-credential key meant for front-end code, so it's fine in page source;
// the worst case is someone else using up the free quota. If that happens,
// delete the credential in the Metered dashboard (TURN Server > Credentials),
// create a new one, and put its key here.
export const TURN_CREDENTIALS_URL = 'https://vectoria.metered.live/api/v1/turn/credentials?apiKey=950c0fe2467e6ee2c9da4d24d5539e916281';

// Or list TURN servers directly, e.g.
//   { urls: 'turn:relay.example.com:3478', username: '...', credential: '...' }
export const TURN_SERVERS = [];
