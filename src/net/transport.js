// Transports. A session listens on two paths at once and uses whichever
// reaches the other player:
//
//   local - BroadcastChannel between tabs of the same browser. Instant, no
//           network. This is how one person plays both sides on one machine.
//   p2p   - WebRTC data channels via Trystero, for different devices. The
//           one-time handshake goes through public Nostr relays; game
//           traffic then flows directly between the two devices. No server
//           of our own.
//
// Interface (peer ids are prefixed with their path, e.g. "p2p:abc"):
//   t.sendCtl(obj, to?)      JSON control messages (no `to` = everyone)
//   t.sendSnap(buffer, to)   binary snapshots (ArrayBuffer)
//   t.onCtl = (obj, from) => {}
//   t.onSnap = (buffer, from) => {}
//   t.onJoin = (peerId) => {}
//   t.onLeave = (peerId) => {}
//   t.status() -> { p2p: 'loading'|'ready'|'error', relaysOpen, relaysTotal, error }
//   t.leave()
//
// The same other tab can be reachable on both paths; the session layer
// de-duplicates players by a per-page session id, not by peer id.

import { TURN_SERVERS } from '../config.js';

const APP_ID = 'vectoria-2.danielketterer.github.io';
const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
const RELAY_REDUNDANCY = 8; // relays both sides announce on; more = more robust

const noop = () => {};

export function createTransport(room) {
  const t = { onCtl: noop, onSnap: noop, onJoin: noop, onLeave: noop };
  const paths = {};
  const p2pState = { p2p: 'loading', error: '' };

  const attach = (name, path) => {
    paths[name] = path;
    path.onCtl = (d, from) => t.onCtl(d, `${name}:${from}`);
    path.onSnap = (d, from) => t.onSnap(d, `${name}:${from}`);
    path.onJoin = (id) => t.onJoin(`${name}:${id}`);
    path.onLeave = (id) => t.onLeave(`${name}:${id}`);
  };
  const route = (to) => {
    const i = to.indexOf(':');
    return [paths[to.slice(0, i)], to.slice(i + 1)];
  };

  t.sendCtl = (obj, to) => {
    if (!to) { for (const p of Object.values(paths)) p.sendCtl(obj); return; }
    const [p, id] = route(to);
    if (p) p.sendCtl(obj, id);
  };
  t.sendSnap = (buf, to) => {
    const [p, id] = route(to);
    if (p) p.sendSnap(buf, id);
  };
  t.status = () => {
    const s = { ...p2pState, relaysOpen: 0, relaysTotal: 0 };
    if (paths.p2p && paths.p2p.relays) {
      const socks = Object.values(paths.p2p.relays() || {});
      s.relaysTotal = socks.length;
      s.relaysOpen = socks.filter((ws) => ws && ws.readyState === 1).length;
    }
    return s;
  };
  let left = false;
  t.leave = () => {
    left = true;
    for (const p of Object.values(paths)) { try { p.leave(); } catch (_) { /* ignore */ } }
  };

  // Attach handlers first, announce on the next turn (callers set onJoin etc.
  // synchronously after this returns).
  attach('local', localPath(room));
  p2pPath(room).then((p) => {
    if (left) { p.leave(); return; }
    attach('p2p', p);
    p2pState.p2p = 'ready';
  }).catch((err) => {
    // Same-browser tabs still work without it.
    console.error('P2P unavailable:', err);
    p2pState.p2p = 'error';
    p2pState.error = String((err && err.message) || err);
  });
  return t;
}

async function p2pPath(room) {
  // Loaded only when someone actually opens multiplayer, so single-player
  // never depends on the CDN.
  const trystero = await import(TRYSTERO_URL);
  const config = { appId: APP_ID, relayConfig: { redundancy: RELAY_REDUNDANCY } };
  if (TURN_SERVERS.length) config.turnConfig = TURN_SERVERS;
  const r = trystero.joinRoom(config, `room-${room}`);
  const p = { onCtl: noop, onSnap: noop, onJoin: noop, onLeave: noop };
  const ctl = r.makeAction('ctl');
  const snap = r.makeAction('snap');
  p.sendCtl = (obj, to) => ctl.send(obj, to ? { target: to } : undefined);
  p.sendSnap = (buf, to) => snap.send(buf, to ? { target: to } : undefined);
  ctl.onMessage = (data, meta) => p.onCtl(data, peerOf(meta));
  snap.onMessage = (data, meta) => p.onSnap(toArrayBuffer(data), peerOf(meta));
  r.onPeerJoin = (id) => p.onJoin(id);
  r.onPeerLeave = (id) => p.onLeave(id);
  p.relays = () => (trystero.getRelaySockets ? trystero.getRelaySockets() : {});
  p.leave = () => r.leave();
  return p;
}

// Trystero passes the sender either as a string or as {peerId}, depending on
// version; accept both.
function peerOf(meta) {
  return typeof meta === 'string' ? meta : meta && meta.peerId;
}

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return data;
}

function localPath(room) {
  const ch = new BroadcastChannel(`vectoria-${room}`);
  const p = { onCtl: noop, onSnap: noop, onJoin: noop, onLeave: noop };
  const selfId = Math.random().toString(36).slice(2, 10);
  const known = new Set();

  const post = (msg) => ch.postMessage({ ...msg, from: selfId });
  ch.onmessage = (e) => {
    const m = e.data;
    if (!m || m.from === selfId) return;
    if (m.to && m.to !== selfId) return;
    if (m.k === 'hi' || m.k === 'hi-ack') {
      if (!known.has(m.from)) {
        known.add(m.from);
        if (m.k === 'hi') post({ k: 'hi-ack', to: m.from });
        p.onJoin(m.from);
      }
      return;
    }
    if (m.k === 'bye') {
      if (known.delete(m.from)) p.onLeave(m.from);
      return;
    }
    if (!known.has(m.from)) return;
    if (m.k === 'ctl') p.onCtl(m.d, m.from);
    else if (m.k === 'snap') p.onSnap(m.d, m.from);
  };

  p.sendCtl = (obj, to) => post({ k: 'ctl', d: obj, to });
  p.sendSnap = (buf, to) => post({ k: 'snap', d: buf, to });
  const bye = () => post({ k: 'bye' });
  window.addEventListener('pagehide', bye);
  p.leave = () => {
    bye();
    window.removeEventListener('pagehide', bye);
    ch.close();
  };
  setTimeout(() => post({ k: 'hi' }), 0);
  return p;
}
