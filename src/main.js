// Entry point: canvas setup, fixed-timestep loop, and the screen state machine
// (menu, tutorial intro, play, level select, high scores, win screen).

import {
  MAP_W, MAP_H, LEVEL_COUNT, TUTORIAL_COUNT, TICK_HZ, TICK_MS, MAX_TICKS_PER_FRAME,
  computeStars,
} from './config.js';
import { LevelMap } from './map.js';
import { World } from './physics.js';
import { PointerSources } from './input.js';
import { Celebration } from './effects.js';
import * as store from './storage.js';
import {
  text, button, hit, drawWorld, drawSources, drawOverlays, panel, pill,
} from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(MAP_W * dpr);
  canvas.height = Math.round(MAP_H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

const input = new PointerSources(canvas);
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

const TUTORIAL_PAGES = [
  [
    'Page 1/2',
    '',
    'Welcome to the Vectoria Tutorial!',
    '',
    'Left-click to PUSH (divergence) in Push-Pull zones',
    'Right-click to PULL (divergence) in Push-Pull zones',
    '',
    'Left-click to Counterclockwise SPIN (curl) in Spin zones',
    'Right-click to Clockwise SPIN (curl) in Spin zones',
    '',
    'On touch screens, the L/R toggle stands in for the mouse buttons',
    '',
    'Press any key or tap to go to page 2',
  ],
  [
    'Page 2/2',
    '',
    'Checkered Flag: Goal zones (move dots here to win)',
    'Spiky/Explosion: Push-Pull-only zones',
    'Swirl: Spin-only zones',
    'Magenta: No action, movement-only zones',
    'Yellow: Both actions in these zones',
    'Red: Trap zones (to be avoided)',
    'Black: Walls/obstacles',
    '',
    'Press any key or tap to begin',
  ],
];

// ---- state ---------------------------------------------------------------

const S = {
  screen: 'menu',          // menu | intro | loading | play | select | scores | won
  mode: 'level',           // level | tutorial (while playing)
  level: 1,
  world: null,
  overlays: { vectors: false, divergence: false, curl: false },
  result: null,            // { time, stars, newBest } once a level completes
  introPage: 0,
  selectIndex: 1,
  celebration: null,
  buttons: {},             // clickable rects for the current frame
  loadToken: 0,
};

const mapCache = new Map();

async function loadLevel(mode, level) {
  const token = ++S.loadToken;
  S.screen = 'loading';
  input.enabled = false;
  input.clear();
  const path = `assets/levels/${mode === 'tutorial' ? 'tutorial' : 'level'}${level}.png`;
  try {
    let map = mapCache.get(path);
    if (!map) {
      map = await LevelMap.load(path);
      mapCache.set(path, map);
    }
    if (token !== S.loadToken) return; // superseded by another load
    S.mode = mode;
    S.level = level;
    S.world = new World(map);
    S.result = null;
    S.screen = 'play';
    input.enabled = true;
    const label = mode === 'tutorial' ? `Tutorial ${level}/${TUTORIAL_COUNT}` : `Level ${level}/${LEVEL_COUNT}`;
    document.title = `Vectoria - ${label}`;
  } catch (err) {
    console.error(err);
    S.screen = 'error';
    S.error = String(err.message || err);
  }
}

function goMenu() {
  S.screen = 'menu';
  S.world = null;
  input.enabled = false;
  input.clear();
  document.title = 'Vectoria';
}

function startPlay() { loadLevel('level', 1); }
function startTutorial() { S.introPage = 0; S.screen = 'intro'; }

function nextLevel() {
  const next = S.level + 1;
  if (S.mode === 'level') {
    if (next > LEVEL_COUNT) {
      store.unlockLevelSelect();
      S.celebration = new Celebration();
      S.screen = 'won';
      input.enabled = false;
      input.clear();
    } else {
      loadLevel('level', next);
    }
  } else if (next > TUTORIAL_COUNT) {
    goMenu();
  } else {
    loadLevel('tutorial', next);
  }
}

function restartLevel() { loadLevel(S.mode, S.level); }

function menuOptions() {
  const opts = [
    ['1', 'Play', startPlay],
    ['2', 'Tutorial', startTutorial],
    ['3', 'High Scores', () => { S.screen = 'scores'; }],
  ];
  if (store.isLevelSelectUnlocked()) {
    opts.push(['4', 'Level Select', () => { S.selectIndex = 1; S.screen = 'select'; }]);
  }
  return opts;
}

// ---- keyboard ------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  switch (S.screen) {
    case 'menu': {
      const opt = menuOptions().find(([key]) => key === k);
      if (opt) opt[2]();
      break;
    }
    case 'intro':
      advanceIntro();
      break;
    case 'play': {
      const w = S.world;
      const open = !w.completed && !w.failed;
      if (k === 'v' && open) S.overlays.vectors = !S.overlays.vectors;
      else if (k === 'h' && open) S.overlays.divergence = !S.overlays.divergence;
      else if (k === 'c' && open) S.overlays.curl = !S.overlays.curl;
      else if (k === 'n' && w.completed) nextLevel();
      else if (k === 'r') restartLevel();
      else if (k === 't') input.touchButton = input.touchButton === 1 ? 3 : 1;
      else if (k === 'q' || k === 'escape') goMenu();
      break;
    }
    case 'select':
      if (e.key === 'ArrowUp') S.selectIndex = S.selectIndex > 1 ? S.selectIndex - 1 : LEVEL_COUNT;
      else if (e.key === 'ArrowDown') S.selectIndex = S.selectIndex < LEVEL_COUNT ? S.selectIndex + 1 : 1;
      else if (e.key === 'Enter') loadLevel('level', S.selectIndex);
      else if (e.key === 'Escape') goMenu();
      break;
    case 'scores':
    case 'won':
    case 'error':
      if (k === 'escape' || k === 'q') goMenu();
      break;
    default:
      break;
  }
  if (['ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
});

function advanceIntro() {
  S.introPage++;
  if (S.introPage >= TUTORIAL_PAGES.length) loadLevel('tutorial', 1);
}

// ---- clicks / taps on UI (play-field pointers become force sources) ----------

input.onClick((x, y) => {
  const b = S.buttons;
  switch (S.screen) {
    case 'menu':
      for (const [i, opt] of menuOptions().entries()) {
        if (hit(b[`menu${i}`], x, y)) { opt[2](); return true; }
      }
      return true;
    case 'intro':
      advanceIntro();
      return true;
    case 'select':
      for (let i = 1; i <= LEVEL_COUNT; i++) {
        if (hit(b[`sel${i}`], x, y)) { loadLevel('level', i); return true; }
      }
      if (hit(b.back, x, y)) goMenu();
      return true;
    case 'scores':
    case 'won':
    case 'error':
      goMenu();
      return true;
    case 'play':
      if (hit(b.next, x, y)) { nextLevel(); return true; }
      if (hit(b.restart, x, y)) { restartLevel(); return true; }
      if (hit(b.menu, x, y)) { goMenu(); return true; }
      if (hit(b.touch, x, y)) { input.touchButton = input.touchButton === 1 ? 3 : 1; return true; }
      return false; // let it become a force source
    default:
      return true;
  }
});

// ---- per-tick logic ------------------------------------------------------

function tick(nowMs) {
  if (S.screen === 'play' && S.world) {
    const w = S.world;
    const wasDone = w.completed;
    w.step(input.list());
    input.prune();
    if (w.completed && !wasDone) onComplete();
  } else if (S.screen === 'won' && S.celebration) {
    S.celebration.step(nowMs);
  }
}

function onComplete() {
  input.enabled = false;
  input.clear();
  // Simulated time, not wall-clock: fair across frame rates and immune to a
  // backgrounded tab.
  const time = S.world.tick / TICK_HZ;
  if (S.mode === 'level') {
    const newBest = store.isNewBest(S.level, time);
    const stars = computeStars(time, S.level);
    store.saveStats(S.level, time, stars);
    S.result = { time, stars, newBest };
  } else {
    S.result = { time, stars: null, newBest: false };
  }
}

// ---- drawing -------------------------------------------------------------

function starStr(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }

function draw() {
  S.buttons = {};
  const b = S.buttons;
  ctx.clearRect(0, 0, MAP_W, MAP_H);

  switch (S.screen) {
    case 'menu': {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      text(ctx, 'Vectoria', MAP_W / 2, 150, { size: 72, color: 'rgb(60,110,255)', weight: 700 });
      menuOptions().forEach(([key, label], i) => {
        b[`menu${i}`] = button(ctx, `${key}. ${label}`, MAP_W / 2, 260 + i * 62, { w: 280 });
      });
      break;
    }
    case 'intro': {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      const page = TUTORIAL_PAGES[S.introPage];
      const lh = 36;
      let y = MAP_H / 2 - (page.length * lh) / 2 + lh / 2;
      for (const line of page) {
        text(ctx, line, MAP_W / 2, y, { size: 20 });
        y += lh;
      }
      break;
    }
    case 'loading':
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      text(ctx, 'Loading...', MAP_W / 2, MAP_H / 2, { size: 28 });
      break;
    case 'error':
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      text(ctx, 'Could not load the level', MAP_W / 2, MAP_H / 2 - 30, { size: 28 });
      text(ctx, S.error || '', MAP_W / 2, MAP_H / 2 + 10, { size: 16, color: '#aaa' });
      text(ctx, 'If you opened index.html directly, serve the folder over http instead (see README).', MAP_W / 2, MAP_H / 2 + 40, { size: 14, color: '#aaa' });
      break;
    case 'play':
      drawPlay();
      break;
    case 'select': {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      text(ctx, 'Select Level', MAP_W / 2, 70, { size: 44, weight: 700 });
      for (let i = 1; i <= LEVEL_COUNT; i++) {
        b[`sel${i}`] = button(ctx, `Level ${i}`, MAP_W / 2, 140 + i * 60, { active: i === S.selectIndex });
      }
      b.back = button(ctx, 'Back', 80, MAP_H - 40, { w: 120, h: 38, size: 18 });
      break;
    }
    case 'scores': {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      text(ctx, 'High Scores', MAP_W / 2, 70, { size: 44, color: 'rgb(255,215,0)', weight: 700 });
      const scores = store.getScores();
      for (let lvl = 1; lvl <= LEVEL_COUNT; lvl++) {
        const s = scores[lvl];
        const t = s && s.time != null ? `${s.time.toFixed(2)}s` : '--:--';
        const st = s ? starStr(s.stars) : starStr(0);
        text(ctx, `Level ${lvl}:   ${t}   ${st}`, MAP_W / 2, 140 + (lvl - 1) * 56, { size: 26 });
      }
      text(ctx, 'Press Esc or tap to return', 16, MAP_H - 30, { size: 18, color: '#ccc', align: 'left' });
      break;
    }
    case 'won':
      S.celebration.draw(ctx);
      text(ctx, 'YOU WON!!!', MAP_W / 2, MAP_H / 2 - 40, { size: 52, color: 'rgb(255,215,0)', weight: 800 });
      text(ctx, 'Level Select unlocked. Press Q or tap to return to the menu', MAP_W / 2, MAP_H / 2 + 40, { size: 20 });
      break;
    default:
      break;
  }
}

function drawPlay() {
  const w = S.world;
  const b = S.buttons;
  drawWorld(ctx, w);
  drawOverlays(ctx, w.lastResolved, S.overlays);
  drawSources(ctx, [...input.byId.values()]);

  const label = S.mode === 'tutorial' ? `Tutorial ${S.level}/${TUTORIAL_COUNT}` : `Level ${S.level}/${LEVEL_COUNT}`;
  pill(ctx, `${label}   ${(w.tick / TICK_HZ).toFixed(1)}s   goal ${Math.round(w.goalFraction() * 100)}%`, 10, 10);
  const on = (f) => (f ? 'on' : 'off');
  pill(ctx, `V vectors ${on(S.overlays.vectors)}  H div ${on(S.overlays.divergence)}  C curl ${on(S.overlays.curl)}  R restart  Esc menu`,
    10, MAP_H - 40, { size: 13 });
  if (coarsePointer) {
    b.touch = pill(ctx, `Touch: ${input.touchButton === 1 ? 'L (push / CCW)' : 'R (pull / CW)'}`, MAP_W - 10, 10, { size: 16, align: 'right' });
  }

  if (w.completed) {
    panel(ctx);
    const title = S.mode === 'level' ? `Level ${S.level} Complete!` : `Tutorial level ${S.level} Complete!`;
    text(ctx, title, MAP_W / 2, MAP_H / 2 - 70, { size: 44, weight: 700 });
    const r = S.result;
    if (S.mode === 'level' && r) {
      if (r.newBest) text(ctx, 'New High Score!', MAP_W / 2, MAP_H / 2 - 20, { size: 30, color: 'rgb(255,215,0)' });
      text(ctx, `Time: ${r.time.toFixed(2)} s`, MAP_W / 2, MAP_H / 2 + 20, { size: 30 });
      text(ctx, `Rating: ${starStr(r.stars)}`, MAP_W / 2, MAP_H / 2 + 60, { size: 30 });
    }
    b.next = button(ctx, 'N  Next level', MAP_W / 2, MAP_H / 2 + 120);
  } else if (w.failed) {
    panel(ctx);
    text(ctx, `Level ${S.level} Failed`, MAP_W / 2, MAP_H / 2 - 30, { size: 44, weight: 700 });
    b.restart = button(ctx, 'R  Restart', MAP_W / 2, MAP_H / 2 + 40);
    b.menu = button(ctx, 'Esc  Menu', MAP_W / 2, MAP_H / 2 + 100);
  }
}

// ---- loop ----------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  acc += now - last;
  last = now;
  if (acc > TICK_MS * MAX_TICKS_PER_FRAME) acc = TICK_MS * MAX_TICKS_PER_FRAME;
  while (acc >= TICK_MS) {
    tick(now);
    acc -= TICK_MS;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/test hook (also the seam a future network layer will use).
window.__vectoria = { S, input, loadLevel, store };
