// Entry point: canvas setup, fixed-timestep loop, and the screen state machine
// (menu, tutorial intro, play, level select, high scores, win screen, and
// the multiplayer lobby/join screens).
//
// Multiplayer (co-op or versus) is host-authoritative: the host runs the only
// World and feeds it both players' force sources; the guest sends its
// pointer input and draws the snapshots the host streams back.

import {
  MAP_W, MAP_H, LEVEL_COUNT, TUTORIAL_COUNT, TICK_HZ, TICK_MS, MAX_TICKS_PER_FRAME,
  computeStars, PLAYER_NAMES, VERSUS_MAP_COUNT, VERSUS_MAP_NAMES, Z,
  COUNTDOWN_TICKS, GO_FLASH_MS, BASE_W, BASE_H, setViewSize,
} from './config.js';
import { LevelMap } from './map.js';
import { World } from './physics.js';
import { PointerSources } from './input.js';
import { wantsPad, setupPad } from './pad.js';
import { Celebration } from './effects.js';
import * as store from './storage.js';
import {
  text, button, hit, drawWorld, drawSources, drawOverlays, panel, pill, PLAYER_COLORS, FONT,
} from './render.js';
import { createTransport } from './net/transport.js';
import { encodeSnapshot, decodeSnapshot, GuestView } from './net/snapshot.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const padEl = document.getElementById('pad');

const input = new PointerSources(canvas);
const params = new URLSearchParams(location.search);
const touchPad = wantsPad(params);

// Screen area the field can use: the whole window, or the part beside the
// touch pad (a column in landscape, a row in portrait).
function availableArea() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!touchPad) return { w: vw, h: vh };
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  return landscape ? { w: vw - padEl.offsetWidth, h: vh } : { w: vw, h: vh - padEl.offsetHeight };
}

// Backing store at device resolution, and the largest box with the
// current field's shape that fits the available area.
function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(MAP_W * dpr);
  canvas.height = Math.round(MAP_H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const a = availableArea();
  const s = Math.min(a.w / MAP_W, a.h / MAP_H);
  canvas.style.width = `${Math.floor(MAP_W * s)}px`;
  canvas.style.height = `${Math.floor(MAP_H * s)}px`;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

// ---- view rotation ------------------------------------------------------------
//
// In Versus the host's screen sets the field's shape, but each player sees
// it rotated to fit their own screen: if the field's long axis doesn't
// match the screen's, it's turned 90 degrees. A rotation (not a mirror), so
// clockwise spin still looks clockwise. Turned so your own goal ends up at
// the bottom (on a tall screen) or the left (on a wide one).
//
// rot: 0 = none, 1 = clockwise, -1 = counterclockwise. World coords are the
// map's; screen coords are the canvas's logical coords (MAP_W x MAP_H).
const VIEW = { rot: 0, mw: BASE_W, mh: BASE_H };

function worldToScreen(x, y) {
  if (VIEW.rot === 1) return [VIEW.mh - y, x];
  if (VIEW.rot === -1) return [y, VIEW.mw - x];
  return [x, y];
}
function screenToWorld(x, y) {
  if (VIEW.rot === 1) return [y, VIEW.mh - x];
  if (VIEW.rot === -1) return [VIEW.mw - y, x];
  return [x, y];
}
input.toWorld = screenToWorld;

function applyWorldTransform() {
  if (VIEW.rot === 1) { ctx.translate(VIEW.mh, 0); ctx.rotate(Math.PI / 2); }
  else if (VIEW.rot === -1) { ctx.translate(0, VIEW.mw); ctx.rotate(-Math.PI / 2); }
}

// Should this screen show the field turned? Only when turning makes it
// clearly bigger.
function chooseRotation(map, versus) {
  if (!versus) return 0;
  const a = availableArea();
  const straight = Math.min(a.w / map.w, a.h / map.h);
  const turned = Math.min(a.w / map.h, a.h / map.w);
  if (turned <= straight * 1.05) return 0;
  return myPlayer() === 2 ? -1 : 1;
}

// Switch the canvas's logical size (a screen-shaped Versus field, or back
// to 800x600 for levels and menus).
function setView(w, h) {
  if (w === MAP_W && h === MAP_H) return;
  setViewSize(w, h);
  resize();
}

// Mobile Versus: Open Field is generated in the shape of the host's screen,
// so it fills the screen. The short side stays 600 (same scale as the
// levels, so text and dots look the same); the long side stretches.
function fieldShape() {
  const a = availableArea();
  const r = Math.min(2.4, Math.max(1 / 2.4, a.w / Math.max(1, a.h)));
  return r >= 1 ? { w: Math.round(BASE_H * r), h: BASE_H } : { w: BASE_H, h: Math.round(BASE_H / r) };
}
// Versus maps that are generated rather than loaded from a PNG, so they can
// take any shape: 1 Open Field (generated on phones; versus1.png on desktop)
// and 2 Maze (always generated, a fresh seed every match).
const SHAPED_VERSUS = new Set([1, 2]);
const MAZE_LEVEL = 2;
// Identifies this page to the other player. The same tab can be reachable
// over two paths (same-browser channel and P2P); this keeps it one player.
const SESSION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

const NET_EVERY = 2;               // send snapshots / inputs every 2 ticks (30 Hz)
const CONNECT_TIMEOUT_MS = 30000;  // guest gives up finding the host after this
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

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
    'On touch screens, the + / - pad stands in for the mouse buttons',
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
  // menu | intro | loading | play | select | scores | won | error
  // mp | hostLobby | join | connecting | guestLobby | notice
  screen: 'menu',
  mode: 'level',           // level | tutorial | versus (while playing)
  level: 1,
  world: null,             // the simulation (solo and host)
  view: null,              // what the guest draws (GuestView)
  overlays: { vectors: false, divergence: false, curl: false },
  result: null,            // { time, stars, newBest } once a level completes
  introPage: 0,
  selectIndex: 1,
  celebration: null,
  buttons: {},             // clickable rects for the current frame
  loadToken: 0,
  sessionToken: 0,
  net: null,              // multiplayer session, see below
  notice: '',
  error: '',
  mapSize: null,           // {w, h} of a generated, screen-shaped Versus field, else null
  countdown: 0,            // multiplayer: ticks left before play starts (host is authoritative)
  goAt: -1e9,              // when the countdown reached zero (for the GO! flash)
};

const mapCache = new Map();

async function getMap(mode, level, size, seed) {
  if (mode === 'versus' && level === MAZE_LEVEL) {
    // Not cached: every match has its own seed.
    const s = size || { w: BASE_W, h: BASE_H };
    return LevelMap.maze(s.w, s.h, seed);
  }
  if (mode === 'versus' && size && SHAPED_VERSUS.has(level)) {
    const key = `openField@${size.w}x${size.h}`;
    let map = mapCache.get(key);
    if (!map) {
      map = await LevelMap.openField(size.w, size.h);
      mapCache.set(key, map);
    }
    return map;
  }
  const prefix = mode === 'tutorial' ? 'tutorial' : mode === 'versus' ? 'versus' : 'level';
  const path = `assets/levels/${prefix}${level}.png`;
  let map = mapCache.get(path);
  if (!map) {
    map = await LevelMap.load(path);
    mapCache.set(path, map);
  }
  return map;
}

function levelLabel(mode, level) {
  if (mode === 'versus') return `Versus: ${VERSUS_MAP_NAMES[level - 1] || `Map ${level}`}`;
  return mode === 'tutorial' ? `Tutorial ${level}/${TUTORIAL_COUNT}` : `Level ${level}/${LEVEL_COUNT}`;
}

// Which player this screen is: 0 solo, 1 host (orange), 2 guest (violet).
const myPlayer = () => (S.net ? (S.net.role === 'host' ? 1 : 2) : 0);

const isHost = () => S.net && S.net.role === 'host';
const isGuest = () => S.net && S.net.role === 'guest';

// ---- solo / host level flow ------------------------------------------------

async function loadLevel(mode, level) {
  const token = ++S.loadToken;
  S.screen = 'loading';
  input.enabled = false;
  input.clear();
  // A phone hosting Versus gets the field in its own screen's shape.
  const size = mode === 'versus' && touchPad && SHAPED_VERSUS.has(level) ? fieldShape() : null;
  const seed = mode === 'versus' && level === MAZE_LEVEL ? crypto.getRandomValues(new Uint32Array(1))[0] : 0;
  try {
    const map = await getMap(mode, level, size, seed);
    if (token !== S.loadToken) return; // superseded by another load
    S.mapSize = size;
    S.mapSeed = seed;
    S.mode = mode;
    S.level = level;
    S.world = new World(map, { versus: mode === 'versus' });
    S.result = null;
    // Every multiplayer start (co-op or versus, including restarts and
    // rematches) opens with 3-2-1 so both players start together.
    S.countdown = S.net ? COUNTDOWN_TICKS : 0;
    S.goAt = -1e9;
    S.screen = 'play';
    input.enabled = true;
    document.title = `Vectoria - ${levelLabel(mode, level)}`;
    if (isHost()) {
      S.net.gen++;
      S.net.remote.clear();
      sendLoad();
    }
  } catch (err) {
    console.error(err);
    S.screen = 'error';
    S.error = String(err.message || err);
  }
}

function goMenu() {
  S.sessionToken++; // cancels any connect still in flight
  S.countdown = 0;
  if (S.net) leaveSession();
  hideJoinForm();
  S.screen = 'menu';
  S.world = null;
  S.view = null;
  input.enabled = false;
  input.clear();
  document.title = 'Vectoria';
}

function startPlay() { loadLevel('level', 1); }
function startTutorial() { S.introPage = 0; S.screen = 'intro'; }

function nextLevel() {
  if (isGuest()) { S.net.t.sendCtl({ t: 'cmd', c: 'next' }); return; }
  const next = S.level + 1;
  if (S.mode === 'versus') {
    // Next map, wrapping around (a rematch while there's only one).
    loadLevel('versus', next > VERSUS_MAP_COUNT ? 1 : next);
  } else if (S.mode === 'level') {
    if (next > LEVEL_COUNT) {
      if (!S.net) store.unlockLevelSelect();
      showWon();
      if (isHost()) S.net.t.sendCtl({ t: 'won' });
    } else {
      loadLevel('level', next);
    }
  } else if (next > TUTORIAL_COUNT) {
    if (isHost()) hostToLobby(); else goMenu();
  } else {
    loadLevel('tutorial', next);
  }
}

function restartLevel() {
  // In a networked versus match, restart means rematch: only once it's over,
  // so nobody can wipe a match they're losing.
  const w = S.world || S.view;
  if (S.net && S.mode === 'versus' && w && !w.completed) return;
  if (isGuest()) { S.net.t.sendCtl({ t: 'cmd', c: 'restart' }); return; }
  loadLevel(S.mode, S.level);
}

function showWon() {
  S.celebration = new Celebration();
  S.screen = 'won';
  input.enabled = false;
  input.clear();
}

function leaveWon() {
  if (isHost()) hostToLobby();
  else if (isGuest()) S.screen = 'guestLobby';
  else goMenu();
}

function menuOptions() {
  const opts = [
    ['1', 'Play', startPlay],
    ['2', 'Tutorial', startTutorial],
    ['3', 'Multiplayer', () => { S.screen = 'mp'; }],
    ['4', 'High Scores', () => { S.screen = 'scores'; }],
  ];
  if (store.isLevelSelectUnlocked()) {
    opts.push(['5', 'Level Select', () => { S.selectIndex = 1; S.screen = 'select'; }]);
  }
  return opts;
}

// ---- multiplayer session ------------------------------------------------------
//
// S.net = {
//   role: 'host' | 'guest', t: transport, room: 'ABCD',
//   partner: peerId | null,   // the one other player
//   gen: number,              // host: bumps on every level load; snapshots carry it
//   remote: Map,              // host: the guest's sources by id
//   pendingSnap,              // guest: newest snapshot that arrived before its map
//   copied: bool, sentEmpty: bool, timer
// }

function makeRoomCode() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  return [...a].map((n) => ROOM_ALPHABET[n % ROOM_ALPHABET.length]).join('');
}

function shareLink(room) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('join', room);
  return u.toString();
}

function failSession(msg) {
  if (S.net) leaveSession();
  S.notice = msg;
  S.screen = 'notice';
  input.enabled = false;
  input.clear();
}

function leaveSession() {
  const n = S.net;
  S.net = null;
  input.player = 0;
  if (!n) return;
  clearTimeout(n.timer);
  try { n.t.leave(); } catch (_) { /* ignore */ }
}

function hostStart() {
  const room = makeRoomCode();
  ++S.sessionToken;
  const t = createTransport(room);
  S.net = {
    role: 'host', t, room, partner: null, partnerSid: null, gen: 0, remote: new Map(),
    copied: false, matchMode: 'coop',
  };
  input.player = 1;

  // Guests announce themselves with a hello carrying their session id. The
  // first one becomes the partner; the same guest arriving over the other
  // path is ignored; anyone else is told the room is full.
  t.onCtl = (m, from) => {
    const n = S.net;
    if (!n || n.t !== t || !m) return;
    if (m.t === 'hello') {
      if (!n.partner) {
        n.partner = from;
        n.partnerSid = m.sid;
        n.partnerLeft = false;
        t.sendCtl({ t: 'welcome', room }, from);
        // Late join: bring the guest straight into whatever is happening.
        if (S.screen === 'play' || S.screen === 'loading') sendLoad();
        else if (S.screen === 'won') t.sendCtl({ t: 'won' }, from);
      } else if (m.sid !== n.partnerSid) {
        t.sendCtl({ t: 'full' }, from);
      }
      return;
    }
    if (from !== n.partner) return;
    if (m.t === 'input') applyRemoteInput(m.s);
    else if (m.t === 'cmd' && S.screen === 'play' && S.world) {
      if (m.c === 'next' && S.world.completed) nextLevel();
      else if (m.c === 'restart') restartLevel();
    }
  };
  t.onLeave = (peer) => {
    const n = S.net;
    if (!n || n.t !== t || peer !== n.partner) return;
    n.partner = null;
    n.partnerSid = null;
    n.remote.clear();
    n.partnerLeft = true;
    if (S.screen === 'play' || S.screen === 'won' || S.screen === 'loading') hostToLobby();
  };
  hostToLobby();
}

function hostToLobby() {
  S.screen = 'hostLobby';
  S.countdown = 0;
  S.world = null;
  input.enabled = false;
  input.clear();
  document.title = 'Vectoria - Multiplayer';
  if (S.net) {
    S.net.remote.clear();
    if (S.net.partner) S.net.t.sendCtl({ t: 'lobby' }, S.net.partner);
  }
}

function sendLoad() {
  const n = S.net;
  if (!n || !n.partner) return;
  const sz = S.mapSize;
  n.t.sendCtl({
    t: 'load', gen: n.gen, mode: S.mode, level: S.level, countdown: S.countdown,
    w: sz ? sz.w : 0, h: sz ? sz.h : 0, seed: S.mapSeed || 0,
  }, n.partner);
}

// The guest sends its full source list; mirror it into the host's remote map.
function applyRemoteInput(list) {
  const n = S.net;
  if (!n || !Array.isArray(list) || S.screen !== 'play') return;
  const seen = new Set();
  for (const e of list) {
    if (!Array.isArray(e) || e.length < 6) continue;
    const [id, x, y, btn, held, tap] = e;
    if (![x, y].every(Number.isFinite)) continue;
    seen.add(id);
    let s = n.remote.get(id);
    if (!s) {
      s = { id, player: 2, x, y, button: btn === 3 ? 3 : 1, held: false, tap: false };
      n.remote.set(id, s);
    }
    s.x = x;
    s.y = y;
    s.button = btn === 3 ? 3 : 1;
    s.held = !!held;
    s.tap = s.tap || !!tap;
  }
  for (const [id, s] of n.remote) if (!seen.has(id)) s.held = false;
}

function guestJoin(rawRoom) {
  const room = String(rawRoom || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (room.length !== 4) {
    S.joinError = 'Room codes are 4 characters.';
    return;
  }
  hideJoinForm();
  ++S.sessionToken;
  S.screen = 'connecting';
  S.connectingMsg = `Looking for room ${room}...`;
  const t = createTransport(room);
  S.net = { role: 'guest', t, room, partner: null, pendingSnap: null, sentEmpty: true, startedAt: performance.now() };
  input.player = 2;
  S.net.timer = setTimeout(() => {
    if (S.net && S.net.t === t && !S.net.partner) failSession(connectFailMessage(room, t.status()));
  }, CONNECT_TIMEOUT_MS);

  // Say hello to every peer we can see (over either path); the host replies
  // with welcome (or full).
  t.onJoin = (peer) => {
    if (S.net && S.net.t === t && !S.net.partner) t.sendCtl({ t: 'hello', sid: SESSION_ID }, peer);
  };
  t.onCtl = (m, from) => {
    const n = S.net;
    if (!n || n.t !== t || !m) return;
    if (m.t === 'welcome' && !n.partner) {
      n.partner = from;
      clearTimeout(n.timer);
      S.screen = 'guestLobby';
      return;
    }
    if (m.t === 'full' && !n.partner) {
      failSession(`Room ${room} already has two players.`);
      return;
    }
    if (from !== n.partner) return;
    if (m.t === 'load') guestLoad(m);
    else if (m.t === 'lobby') { S.view = null; S.screen = 'guestLobby'; input.enabled = false; input.clear(); }
    else if (m.t === 'won') showWon();
  };
  t.onSnap = (buf, from) => {
    const n = S.net;
    if (!n || n.t !== t || from !== n.partner) return;
    let snap;
    try { snap = decodeSnapshot(buf); } catch (_) { return; }
    if (S.view && snap.gen === S.view.gen) S.view.push(snap, performance.now());
    else n.pendingSnap = snap;
  };
  t.onLeave = (peer) => {
    const n = S.net;
    if (!n || n.t !== t || peer !== n.partner) return;
    failSession('The host left the game.');
  };
}

// Explain a failed join in terms of what actually went wrong.
function connectFailMessage(room, st) {
  if (st.p2p === 'error') {
    return `Couldn't load the online-play library (${st.error}). Check this device's internet connection.`;
  }
  if (st.relaysOpen === 0) {
    return `Couldn't reach any of the matchmaking relays from this device, so it can't find room ${room}. The network may be blocking them; try another network.`;
  }
  if (st.directFailures > 0) {
    const turn = st.turn === 'on' ? ' even through the TURN relay' : '';
    return `Found room ${room}, but the two devices couldn't open a direct connection${turn}. `
      + (st.turn === 'on'
        ? 'Check the TURN settings in src/config.js.'
        : 'Some networks block this (cellular, and Wi-Fi that isolates devices). A TURN relay fixes it: see TURN_CREDENTIALS_URL in src/config.js.');
  }
  return `Never heard from room ${room} on the relays. Check the code, that the host is still in the lobby, `
    + 'and that both devices have the latest version of the page (refresh both).';
}

// One line of connection health for the lobby and connecting screens.
function netStatusLine(t) {
  if (!t) return '';
  const st = t.status();
  if (st.p2p === 'loading') return 'Starting online play...';
  if (st.p2p === 'error') return `Online play unavailable: ${st.error}`;
  if (!st.relaysTotal) return 'Online: starting relays...';
  const turn = st.turn === 'on' ? ', TURN relay on' : st.turn === 'fetch failed' ? ', TURN fetch failed' : '';
  const fails = st.directFailures ? `  |  ${st.directFailures} direct connection attempt(s) failed` : '';
  return `Online: ${st.relaysOpen}/${st.relaysTotal} matchmaking relays connected${turn}${fails}`;
}

async function guestLoad(m) {
  const token = ++S.loadToken;
  S.screen = 'loading';
  input.enabled = false;
  input.clear();
  // The host's field shape, if it sent one (a phone host in Versus). The
  // guest builds the same map; if its own screen is a different shape, the
  // field is letterboxed rather than reshaped, so both play the same board.
  const ok = (v) => Number.isInteger(v) && v >= 200 && v <= 2000;
  const size = m.mode === 'versus' && ok(m.w) && ok(m.h) ? { w: m.w, h: m.h } : null;
  try {
    const seed = Number.isInteger(m.seed) && m.seed >= 0 ? m.seed : 0;
    const map = await getMap(m.mode, m.level, size, seed);
    if (token !== S.loadToken || !isGuest()) return;
    S.mode = m.mode;
    S.level = m.level;
    S.view = new GuestView(map, m.gen);
    S.view.countdown = Number(m.countdown) || 0;
    S.world = null;
    S.result = null;
    const p = S.net.pendingSnap;
    if (p && p.gen === m.gen) S.view.push(p, performance.now());
    S.net.pendingSnap = null;
    S.screen = 'play';
    input.enabled = true;
    document.title = `Vectoria - ${levelLabel(m.mode, m.level)}`;
  } catch (err) {
    console.error(err);
    failSession(`Couldn't load the level (${err.message || err}).`);
  }
}

// ---- join form (a real <input> so phone keyboards work) ------------------------

const joinForm = document.getElementById('joinForm');
const joinCode = document.getElementById('joinCode');

function showJoinForm() {
  S.screen = 'join';
  S.joinError = '';
  joinForm.hidden = false;
  joinCode.value = '';
  setTimeout(() => joinCode.focus(), 0);
}

function hideJoinForm() {
  joinForm.hidden = true;
  joinCode.blur();
}

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  guestJoin(joinCode.value);
});
document.getElementById('joinBack').addEventListener('click', () => {
  hideJoinForm();
  S.screen = 'mp';
});

// ---- keyboard ------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (S.screen === 'join') {
    if (e.key === 'Escape') { hideJoinForm(); S.screen = 'mp'; }
    return; // typing goes to the input
  }
  const k = e.key.toLowerCase();
  switch (S.screen) {
    case 'menu': {
      const opt = menuOptions().find(([key]) => key === k);
      if (opt) opt[2]();
      break;
    }
    case 'mp':
      if (k === 'h') hostStart();
      else if (k === 'j') showJoinForm();
      else if (k === 'escape') goMenu();
      break;
    case 'hostLobby': {
      const lv = Number(k);
      const versus = S.net && S.net.matchMode === 'versus';
      if (k === 'm' && S.net) S.net.matchMode = versus ? 'coop' : 'versus';
      else if (versus && lv >= 1 && lv <= VERSUS_MAP_COUNT) loadLevel('versus', lv);
      else if (!versus && lv >= 1 && lv <= LEVEL_COUNT) loadLevel('level', lv);
      else if (!versus && k === 't') loadLevel('tutorial', 1);
      else if (k === 'escape') goMenu();
      break;
    }
    case 'guestLobby':
    case 'connecting':
      if (k === 'escape') goMenu();
      break;
    case 'notice':
      goMenu();
      break;
    case 'intro':
      advanceIntro();
      break;
    case 'play': {
      const w = S.world || S.view;
      if (!w) break;
      const open = !w.completed && !w.failed;
      if (k === 'v' && open) S.overlays.vectors = !S.overlays.vectors;
      else if (k === 'h' && open) S.overlays.divergence = !S.overlays.divergence;
      else if (k === 'c' && open) S.overlays.curl = !S.overlays.curl;
      else if (k === 'n' && w.completed) nextLevel();
      else if (k === 'r') restartLevel();
      else if (k === 't') input.setTouchButton(input.touchButton === 1 ? 3 : 1);
      else if (k === 'q' || k === 'escape') {
        if (isHost()) hostToLobby(); else goMenu();
      }
      break;
    }
    case 'select':
      if (e.key === 'ArrowUp') S.selectIndex = S.selectIndex > 1 ? S.selectIndex - 1 : LEVEL_COUNT;
      else if (e.key === 'ArrowDown') S.selectIndex = S.selectIndex < LEVEL_COUNT ? S.selectIndex + 1 : 1;
      else if (e.key === 'Enter') loadLevel('level', S.selectIndex);
      else if (e.key === 'Escape') goMenu();
      break;
    case 'won':
      if (k === 'escape' || k === 'q') leaveWon();
      break;
    case 'scores':
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

async function copyLink() {
  if (!S.net) return;
  const link = shareLink(S.net.room);
  try {
    await navigator.clipboard.writeText(link);
    S.net.copied = true;
  } catch (_) {
    S.net.copied = false;
    window.prompt('Copy this link and send it to your partner:', link);
  }
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
    case 'mp':
      if (hit(b.host, x, y)) hostStart();
      else if (hit(b.join, x, y)) showJoinForm();
      else if (hit(b.back, x, y)) goMenu();
      return true;
    case 'hostLobby':
      if (hit(b.coop, x, y)) { S.net.matchMode = 'coop'; return true; }
      if (hit(b.versus, x, y)) { S.net.matchMode = 'versus'; return true; }
      for (let i = 1; i <= LEVEL_COUNT; i++) {
        if (hit(b[`lv${i}`], x, y)) { loadLevel('level', i); return true; }
      }
      for (let i = 1; i <= VERSUS_MAP_COUNT; i++) {
        if (hit(b[`vs${i}`], x, y)) { loadLevel('versus', i); return true; }
      }
      if (hit(b.tut, x, y)) loadLevel('tutorial', 1);
      else if (hit(b.copy, x, y)) copyLink();
      else if (hit(b.back, x, y)) goMenu();
      return true;
    case 'guestLobby':
    case 'connecting':
      if (hit(b.back, x, y)) goMenu();
      return true;
    case 'notice':
      goMenu();
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
    case 'won':
      leaveWon();
      return true;
    case 'scores':
    case 'error':
      goMenu();
      return true;
    case 'play':
      if (hit(b.next, x, y)) { nextLevel(); return true; }
      if (hit(b.rematch, x, y)) { restartLevel(); return true; }
      if (hit(b.restart, x, y)) { restartLevel(); return true; }
      if (hit(b.menu, x, y)) { if (isHost()) hostToLobby(); else goMenu(); return true; }
      return false; // let it become a force source
    default:
      return true;
  }
});

// ---- per-tick logic ------------------------------------------------------

let tickCount = 0;

function tick(nowMs) {
  tickCount++;
  if (S.screen === 'play' && S.world && S.countdown > 0) {
    // Host during the countdown: nothing moves and the clock doesn't run.
    // Fingers already down stay down (so you can be ready at GO), but taps
    // made before GO are dropped. The guest still gets snapshots, which
    // carry the countdown, so both screens count together.
    S.countdown--;
    if (S.countdown === 0) S.goAt = performance.now();
    for (const s of input.list()) s.tap = false;
    input.prune();
    if (isHost()) {
      for (const [id, s] of S.net.remote) {
        s.tap = false;
        if (!s.held) S.net.remote.delete(id);
      }
      if (S.net.partner && tickCount % NET_EVERY === 0) {
        const held = [...input.byId.values(), ...S.net.remote.values()].filter((s) => s.held);
        S.net.t.sendSnap(encodeSnapshot(S.net.gen, S.world, held, S.countdown), S.net.partner);
      }
    }
  } else if (S.screen === 'play' && S.world) {
    // Solo or host: the authoritative simulation.
    const w = S.world;
    const wasDone = w.completed;
    const local = input.list();
    const remote = isHost() ? [...S.net.remote.values()] : [];
    w.step(remote.length ? local.concat(remote) : local);
    input.prune();
    if (isHost()) {
      for (const [id, s] of S.net.remote) if (!s.held && !s.tap) S.net.remote.delete(id);
      if (S.net.partner && tickCount % NET_EVERY === 0) {
        const held = local.concat([...S.net.remote.values()]).filter((s) => s.held);
        S.net.t.sendSnap(encodeSnapshot(S.net.gen, w, held, 0), S.net.partner);
      }
    }
    if (w.completed && !wasDone) onComplete();
  } else if (S.screen === 'play' && isGuest() && S.view) {
    // Guest: no simulation, just ship input to the host.
    const n = S.net;
    if (tickCount % NET_EVERY === 0 && n.partner) {
      const list = input.list();
      if (list.length || !n.sentEmpty) {
        n.t.sendCtl({ t: 'input', s: list.map((s) => [s.id, s.x, s.y, s.button, s.held ? 1 : 0, s.tap ? 1 : 0]) }, n.partner);
        n.sentEmpty = list.length === 0;
        for (const s of list) s.tap = false;
        input.prune();
      }
    }
  } else if (S.screen === 'won' && S.celebration) {
    S.celebration.step(nowMs);
  }
}

function onComplete() {
  // Simulated time, not wall-clock: fair across frame rates and immune to a
  // backgrounded tab.
  const time = S.world.clock / TICK_HZ;
  if (S.mode === 'level' && !S.net) {
    const newBest = store.isNewBest(S.level, time);
    const stars = computeStars(time, S.level);
    store.saveStats(S.level, time, stars);
    S.result = { time, stars, newBest };
  } else {
    // Co-op runs and tutorials don't touch the solo high scores.
    S.result = { time, stars: S.mode === 'level' ? computeStars(time, S.level) : null, newBest: false };
  }
}

// ---- drawing -------------------------------------------------------------

function starStr(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }

function blank() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MAP_W, MAP_H);
}

function draw(now) {
  // The canvas takes the shape of whatever is on screen.
  const live = S.screen === 'play' ? (S.world || S.view) : null;
  if (live) {
    const rot = chooseRotation(live.map, live.versus);
    if (rot !== VIEW.rot) input.clear(); // fingers down mid-turn would jump
    VIEW.rot = rot;
    VIEW.mw = live.map.w;
    VIEW.mh = live.map.h;
    if (rot) setView(live.map.h, live.map.w);
    else setView(live.map.w, live.map.h);
  } else {
    VIEW.rot = 0;
    setView(BASE_W, BASE_H);
  }
  S.buttons = {};
  const b = S.buttons;
  ctx.clearRect(0, 0, MAP_W, MAP_H);

  switch (S.screen) {
    case 'menu': {
      blank();
      text(ctx, 'Vectoria', MAP_W / 2, 130, { size: 72, color: 'rgb(60,110,255)', weight: 700 });
      menuOptions().forEach(([key, label], i) => {
        b[`menu${i}`] = button(ctx, `${key}. ${label}`, MAP_W / 2, 240 + i * 62, { w: 280 });
      });
      break;
    }
    case 'mp': {
      blank();
      text(ctx, 'Multiplayer', MAP_W / 2, 110, { size: 52, weight: 700 });
      text(ctx, 'Two players push, pull and spin the same dots at the same time.', MAP_W / 2, 165, { size: 18, color: '#ccc' });
      text(ctx, 'Co-op: share the goal.   Versus: race to fill your own goal.', MAP_W / 2, 192, { size: 18, color: '#ccc' });
      b.host = button(ctx, 'H.  Host a game', MAP_W / 2, 260, { w: 300 });
      b.join = button(ctx, 'J.  Join a game', MAP_W / 2, 325, { w: 300 });
      b.back = button(ctx, 'Back', 80, MAP_H - 40, { w: 120, h: 38, size: 18 });
      break;
    }
    case 'join':
      blank();
      text(ctx, 'Join a game', MAP_W / 2, 110, { size: 52, weight: 700 });
      text(ctx, 'Enter the 4-character room code from the host.', MAP_W / 2, 175, { size: 18, color: '#ccc' });
      if (S.joinError) text(ctx, S.joinError, MAP_W / 2, 400, { size: 18, color: 'rgb(255,120,120)' });
      break;
    case 'connecting':
      blank();
      text(ctx, S.connectingMsg || 'Connecting...', MAP_W / 2, MAP_H / 2 - 30, { size: 28 });
      text(ctx, 'This can take a few seconds.', MAP_W / 2, MAP_H / 2 + 8, { size: 16, color: '#aaa' });
      if (S.net) {
        const secs = Math.floor((performance.now() - S.net.startedAt) / 1000);
        text(ctx, `${netStatusLine(S.net.t)}   (${secs}s)`, MAP_W / 2, MAP_H / 2 + 36, { size: 14, color: '#888' });
      }
      b.back = button(ctx, 'Cancel', MAP_W / 2, MAP_H / 2 + 90, { w: 160, h: 40, size: 18 });
      break;
    case 'hostLobby':
      drawHostLobby();
      break;
    case 'guestLobby':
      blank();
      text(ctx, `Connected to room ${S.net ? S.net.room : ''}`, MAP_W / 2, MAP_H / 2 - 50, { size: 30, weight: 700 });
      text(ctx, 'Waiting for the host to pick a level...', MAP_W / 2, MAP_H / 2, { size: 20, color: '#ccc' });
      text(ctx, 'You play as Violet.', MAP_W / 2, MAP_H / 2 + 36, { size: 18, color: PLAYER_COLORS[2] });
      b.back = button(ctx, 'Leave', MAP_W / 2, MAP_H / 2 + 110, { w: 160, h: 40, size: 18 });
      break;
    case 'notice': {
      blank();
      const lines = wrap(S.notice, 60);
      lines.forEach((l, i) => text(ctx, l, MAP_W / 2, MAP_H / 2 - 30 + i * 30, { size: 22 }));
      text(ctx, 'Press any key or tap to return to the menu', MAP_W / 2, MAP_H / 2 + 40 + lines.length * 30, { size: 16, color: '#aaa' });
      break;
    }
    case 'intro': {
      blank();
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
      blank();
      text(ctx, 'Loading...', MAP_W / 2, MAP_H / 2, { size: 28 });
      break;
    case 'error':
      blank();
      text(ctx, 'Could not load the level', MAP_W / 2, MAP_H / 2 - 30, { size: 28 });
      text(ctx, S.error || '', MAP_W / 2, MAP_H / 2 + 10, { size: 16, color: '#aaa' });
      text(ctx, 'If you opened index.html directly, serve the folder over http instead (see README).', MAP_W / 2, MAP_H / 2 + 40, { size: 14, color: '#aaa' });
      break;
    case 'play':
      drawPlay(now);
      break;
    case 'select': {
      blank();
      text(ctx, 'Select Level', MAP_W / 2, 70, { size: 44, weight: 700 });
      for (let i = 1; i <= LEVEL_COUNT; i++) {
        b[`sel${i}`] = button(ctx, `Level ${i}`, MAP_W / 2, 140 + i * 60, { active: i === S.selectIndex });
      }
      b.back = button(ctx, 'Back', 80, MAP_H - 40, { w: 120, h: 38, size: 18 });
      break;
    }
    case 'scores': {
      blank();
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
    case 'won': {
      S.celebration.draw(ctx);
      text(ctx, S.net ? 'YOU WON TOGETHER!!!' : 'YOU WON!!!', MAP_W / 2, MAP_H / 2 - 40, { size: 52, color: 'rgb(255,215,0)', weight: 800 });
      const sub = S.net ? 'Press Q or tap to return to the lobby' : 'Level Select unlocked. Press Q or tap to return to the menu';
      text(ctx, sub, MAP_W / 2, MAP_H / 2 + 40, { size: 20 });
      break;
    }
    default:
      break;
  }
}

function wrap(str, width) {
  const words = String(str).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; } else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function drawHostLobby() {
  const b = S.buttons;
  const n = S.net;
  blank();
  text(ctx, 'Host a game', MAP_W / 2, 60, { size: 40, weight: 700 });
  text(ctx, 'Room code', MAP_W / 2, 112, { size: 16, color: '#aaa' });
  text(ctx, n ? n.room : '----', MAP_W / 2, 158, { size: 64, weight: 800, color: 'rgb(255,215,0)' });
  b.copy = button(ctx, n && n.copied ? 'Link copied!' : 'Copy invite link', MAP_W / 2, 222, { w: 240, h: 38, size: 17 });
  if (n) text(ctx, shareLink(n.room), MAP_W / 2, 256, { size: 12, color: '#888' });

  let status;
  let color;
  if (n && n.partner) { status = 'Partner connected! You are Orange, they are Violet.'; color = PLAYER_COLORS[2]; }
  else if (n && n.partnerLeft) { status = 'Your partner left. Waiting for someone to join...'; color = 'rgb(255,140,140)'; }
  else { status = 'Waiting for a partner to join... (you can start without them)'; color = '#ccc'; }
  text(ctx, status, MAP_W / 2, 282, { size: 18, color });
  if (n) text(ctx, netStatusLine(n.t), MAP_W / 2, 303, { size: 12, color: '#888' });

  const versus = n && n.matchMode === 'versus';
  b.coop = button(ctx, 'Co-op', MAP_W / 2 - 75, 340, { w: 140, h: 40, size: 18, active: !versus });
  b.versus = button(ctx, 'Versus', MAP_W / 2 + 75, 340, { w: 140, h: 40, size: 18, active: versus });
  text(ctx, 'M switches mode', MAP_W / 2, 372, { size: 12, color: '#777' });

  if (versus) {
    text(ctx, 'Push dots into your own goal. A majority wins outright; otherwise most dots at time wins.', MAP_W / 2, 400, { size: 14, color: '#ccc' });
    for (let i = 1; i <= VERSUS_MAP_COUNT; i++) {
      b[`vs${i}`] = button(ctx, `${i}. ${VERSUS_MAP_NAMES[i - 1]}`, MAP_W / 2, 400 + i * 48, { w: 240, h: 42, size: 18 });
    }
  } else {
    text(ctx, 'Pick a level:', MAP_W / 2, 400, { size: 14, color: '#ccc' });
    for (let i = 1; i <= LEVEL_COUNT; i++) {
      b[`lv${i}`] = button(ctx, `${i}`, MAP_W / 2 + (i - 3) * 76, 445, { w: 64, h: 50, size: 24 });
    }
    b.tut = button(ctx, 'T.  Tutorial', MAP_W / 2, 510, { w: 200, h: 38, size: 17 });
  }
  b.back = button(ctx, 'Leave', 80, MAP_H - 40, { w: 120, h: 38, size: 18 });
}

function drawPlay(now) {
  const guest = isGuest();
  const w = guest ? S.view : S.world;
  const b = S.buttons;
  if (!w) return;
  if (guest) w.update(now);
  ctx.save();
  applyWorldTransform();
  drawWorld(ctx, w);
  drawOverlays(ctx, w.lastResolved, S.overlays, w.map.w, w.map.h);
  ctx.restore();

  // Source rings: your own come straight from the pointer (no lag); the
  // partner's come from the network.
  const mine = [...input.byId.values()];
  let theirs = [];
  if (isHost()) theirs = [...S.net.remote.values()];
  else if (guest) theirs = w.sources.filter((s) => s.player !== 2);
  // Rings are drawn upright at their on-screen spot (a rotated "-" would
  // read as "|").
  drawSources(ctx, theirs.concat(mine).map((s) => {
    const [x, y] = worldToScreen(s.x, s.y);
    return { ...s, x, y };
  }));

  // A tall (portrait) Versus field has its goals at the top and bottom, so
  // the HUD moves to the left edge, midway down.
  const tall = MAP_H > MAP_W;
  if (w.versus) {
    drawGoalLabels(w);
    const left = Math.max(0, (w.timeLimitTicks - w.clock) / TICK_HZ);
    const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    drawScoreboard(w, clock, tall);
  } else {
    const time = (w.clock / TICK_HZ).toFixed(1);
    pill(ctx, `${levelLabel(S.mode, S.level)}   ${time}s   goal ${Math.round(w.goalFraction() * 100)}%`, 10, 10);
  }
  if (!touchPad) {
    // Keyboard hints; on touch devices the pad has these as buttons.
    const on = (f) => (f ? 'on' : 'off');
    const esc = isHost() ? 'Esc lobby' : guest ? 'Esc leave' : 'Esc menu';
    const r = S.net && S.mode === 'versus' ? '' : '  R restart';
    pill(ctx, `V vectors ${on(S.overlays.vectors)}  H div ${on(S.overlays.divergence)}  C curl ${on(S.overlays.curl)}${r}  ${esc}`,
      10, MAP_H - 40, { size: 13 });
  }
  if (S.net) {
    const kind = S.mode === 'versus' ? 'Versus' : 'Co-op';
    const who = S.net.partner ? `${kind}: you are ${PLAYER_NAMES[myPlayer()]}` : 'Waiting for partner';
    if (tall) pill(ctx, `${who}  |  room ${S.net.room}`, 10, MAP_H / 2 + 40, { size: 13 });
    else pill(ctx, `${who}  |  room ${S.net.room}`, MAP_W - 10, MAP_H - 40, { size: 13, align: 'right' });
  }
  const cd = guest ? w.countdown : S.countdown;
  const goAt = guest ? w.goAt : S.goAt;
  if (cd > 0 || now - goAt < GO_FLASH_MS) drawCountdown(cd, now - goAt);

  if (w.completed && w.versus) {
    drawVersusResult(w);
  } else if (w.completed) {
    panel(ctx);
    const title = S.mode === 'level' ? `Level ${S.level} Complete!` : `Tutorial level ${S.level} Complete!`;
    text(ctx, title, MAP_W / 2, MAP_H / 2 - 70, { size: 44, weight: 700 });
    const t = w.clock / TICK_HZ;
    if (S.mode === 'level') {
      const r = S.result;
      if (r && r.newBest) text(ctx, 'New High Score!', MAP_W / 2, MAP_H / 2 - 20, { size: 30, color: 'rgb(255,215,0)' });
      text(ctx, `Time: ${t.toFixed(2)} s`, MAP_W / 2, MAP_H / 2 + 20, { size: 30 });
      text(ctx, `Rating: ${starStr(computeStars(t, S.level))}`, MAP_W / 2, MAP_H / 2 + 60, { size: 30 });
    }
    b.next = button(ctx, 'N  Next level', MAP_W / 2, MAP_H / 2 + 120);
  } else if (w.failed) {
    panel(ctx);
    text(ctx, `Level ${S.level} Failed`, MAP_W / 2, MAP_H / 2 - 30, { size: 44, weight: 700 });
    b.restart = button(ctx, 'R  Restart', MAP_W / 2, MAP_H / 2 + 40);
    b.menu = button(ctx, isHost() ? 'Esc  Lobby' : guest ? 'Esc  Leave' : 'Esc  Menu', MAP_W / 2, MAP_H / 2 + 100);
  }
}

// 3, 2, 1, GO! Each number swells in and fades over its second.
function drawCountdown(ticksLeft, sinceGo) {
  let label;
  let frac; // 0 at the start of this number's second, 1 at its end
  let color = '#fff';
  if (ticksLeft > 0) {
    label = String(Math.ceil(ticksLeft / TICK_HZ));
    frac = 1 - ((ticksLeft - 1) % TICK_HZ + 1) / TICK_HZ;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, MAP_W, MAP_H);
  } else {
    label = 'GO!';
    frac = Math.min(1, sinceGo / GO_FLASH_MS);
    color = 'rgb(255,215,0)';
  }
  const size = Math.round(150 * (1.25 - 0.35 * Math.min(1, frac * 2.5)));
  ctx.save();
  ctx.globalAlpha = 1 - 0.75 * frac * frac;
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(label, MAP_W / 2, MAP_H / 2);
  ctx.fillStyle = color;
  ctx.fillText(label, MAP_W / 2, MAP_H / 2);
  ctx.restore();
  if (ticksLeft > 0 && S.net && !S.net.partner && isHost()) {
    text(ctx, 'Starting without your partner; they can still join', MAP_W / 2, MAP_H / 2 + 110, { size: 16, color: '#ddd' });
  }
}

// Labels over each versus goal so nobody has to guess which is theirs.
function drawGoalLabels(w) {
  for (const [z, p] of [[Z.GOAL_P1, 1], [Z.GOAL_P2, 2]]) {
    const wc = w.map.goalCenters[z];
    if (!wc) continue;
    const c = worldToScreen(wc[0], wc[1]);
    const me = myPlayer() === p ? ' (you)' : '';
    const label = `${PLAYER_NAMES[p]} goal${me}`;
    ctx.font = `700 16px ${FONT}`;
    const tw = ctx.measureText(label).width + 22;
    // Goals at the left/right ends are narrower than the label; keep it on screen.
    const x = Math.min(Math.max(c[0], tw / 2 + 4), MAP_W - tw / 2 - 4);
    const y = Math.min(Math.max(c[1], 18), MAP_H - 18);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(x - tw / 2, y - 14, tw, 28, 14);
    ctx.fill();
    text(ctx, label, x, y + 1, { size: 16, weight: 700, color: PLAYER_COLORS[p] });
  }
}

// Versus HUD, tucked into the top-left corner so it stays clear of the
// goals: Orange count | Violet count, then the clock and majority target.
function drawScoreboard(w, clock, tall) {
  const x = 10;
  const y = tall ? MAP_H / 2 - 68 : 10;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(x, y, 176, 58, 12);
  ctx.fill();
  text(ctx, `${w.score[1]}`, x + 14, y + 18, { size: 22, weight: 800, color: PLAYER_COLORS[1], align: 'left' });
  text(ctx, 'vs', x + 88, y + 18, { size: 13, color: '#aaa' });
  text(ctx, `${w.score[2]}`, x + 162, y + 18, { size: 22, weight: 800, color: PLAYER_COLORS[2], align: 'right' });
  text(ctx, `${clock}   first to ${w.majority()}`, x + 88, y + 44, { size: 13, color: '#eee' });
}

function drawVersusResult(w) {
  const b = S.buttons;
  panel(ctx);
  const me = myPlayer();
  let title;
  let color;
  if (w.winner === 3) { title = 'Draw!'; color = '#fff'; }
  else { title = `${PLAYER_NAMES[w.winner]} wins!`; color = PLAYER_COLORS[w.winner]; }
  text(ctx, title, MAP_W / 2, MAP_H / 2 - 90, { size: 52, weight: 800, color });
  if (me && w.winner !== 3) {
    text(ctx, w.winner === me ? 'You win!' : 'You lose', MAP_W / 2, MAP_H / 2 - 42, { size: 26 });
  }
  text(ctx, `${w.score[1]}`, MAP_W / 2 - 60, MAP_H / 2 + 5, { size: 34, weight: 800, color: PLAYER_COLORS[1] });
  text(ctx, '-', MAP_W / 2, MAP_H / 2 + 5, { size: 34 });
  text(ctx, `${w.score[2]}`, MAP_W / 2 + 60, MAP_H / 2 + 5, { size: 34, weight: 800, color: PLAYER_COLORS[2] });
  if (w.winner !== 3) {
    const how = w.score[w.winner] * 2 > w.n ? 'by majority' : 'on time';
    text(ctx, how, MAP_W / 2, MAP_H / 2 + 40, { size: 16, color: '#ccc' });
  }
  b.rematch = button(ctx, 'R  Rematch', MAP_W / 2, MAP_H / 2 + 95);
  b.menu = button(ctx, isHost() ? 'Esc  Lobby' : isGuest() ? 'Esc  Leave' : 'Esc  Menu', MAP_W / 2, MAP_H / 2 + 150);
}

// ---- loop ----------------------------------------------------------------

// Simulation and drawing run on separate clocks. Browsers stop
// requestAnimationFrame in background tabs and throttle main-thread timers
// there to once a second or slower. If the simulation rode on either, a host
// whose tab is hidden (e.g. you switched to the guest tab to play Violet, or
// to a chat app to send the invite link) would freeze the game for both
// players. A dedicated worker's timer keeps running in a hidden tab, and its
// messages wake the main thread, so the worker is the simulation clock;
// animation frames only draw (and also advance the clock when visible, which
// keeps motion smooth).

let last = performance.now();
let acc = 0;

function advance() {
  const now = performance.now();
  acc += Math.max(0, now - last);
  last = now;
  if (acc > TICK_MS * MAX_TICKS_PER_FRAME) acc = TICK_MS * MAX_TICKS_PER_FRAME;
  while (acc >= TICK_MS) {
    tick(now);
    acc -= TICK_MS;
  }
}

// Touch pad tools route to the same actions as the keys.
const syncPad = touchPad ? setupPad(input, (tool) => {
  if (S.screen !== 'play') return;
  const w = S.world || S.view;
  const open = w && !w.completed && !w.failed;
  if (tool === 'restart') restartLevel();
  else if (tool === 'exit') { if (isHost()) hostToLobby(); else goMenu(); }
  else if (open && tool in S.overlays) S.overlays[tool] = !S.overlays[tool];
}) : null;

resize(); // after the pad (if any) is in the layout

function padState() {
  const w = S.world || S.view;
  const versusLocked = S.net && S.mode === 'versus' && w && !w.completed;
  return {
    playing: S.screen === 'play',
    overlays: S.overlays,
    canRestart: S.screen === 'play' && !versusLocked,
    exitLabel: isHost() ? 'Lobby' : isGuest() ? 'Leave' : 'Menu',
  };
}

function frame() {
  advance();
  draw(performance.now());
  if (syncPad) syncPad(padState());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function startClock() {
  try {
    const src = `setInterval(() => postMessage(0), ${TICK_MS.toFixed(3)});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = advance;
    return worker;
  } catch (err) {
    // No workers (unusual): fall back to a main-thread timer, which still
    // ticks in a hidden tab, just throttled.
    console.warn('Worker clock unavailable, using setInterval', err);
    return setInterval(advance, TICK_MS);
  }
}
startClock();

// ?net=local is retired (every session now covers same-browser tabs too);
// drop it from old links so nobody gets a confusing URL.
if (params.has('net')) {
  const u = new URL(location.href);
  u.searchParams.delete('net');
  history.replaceState(null, '', u.toString());
}

// An invite link (?join=ABCD) drops straight into the room.
const inviteRoom = params.get('join');
if (inviteRoom) {
  const u = new URL(location.href);
  u.searchParams.delete('join');
  history.replaceState(null, '', u.toString());
  guestJoin(inviteRoom);
}

// Debug/test hook.
window.__vectoria = { S, input, loadLevel, store, touchPad, VIEW, screenToWorld, worldToScreen };
