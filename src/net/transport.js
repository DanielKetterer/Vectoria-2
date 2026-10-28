// Transports: one interface, two implementations.
//
//   p2p   - WebRTC data channels via Trystero. Signaling (the one-time
//           handshake) goes through public Nostr relays; game traffic then
//           flows directly between the two browsers. No server of our own.
//   local - BroadcastChannel between tabs of the same browser. No network at
//           all; for testing the protocol on one machine (?net=local).
//
// Interface:
//   t.selfId
//   t.sendCtl(obj, to?)      JSON control messages
//   t.sendSnap(buffer, to?)  binary snapshots (ArrayBuffer)
//   t.onCtl = (obj, from) => {}
//   t.onSnap = (buffer, from) => {}
//   t.onJoin = (peerId) => {}
//   t.onLeave = (peerId) => {}
//   t.leave()

const APP_ID = 'vectoria-2.danielketterer.github.io';
const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';

const noop = () => {};

function base() {
  return { onCtl: noop, onSnap: noop, onJoin: noop, onLeave: noop };
}

export async function createTransport(kind, room) {
  return kind === 'local' ? localTransport(room) : p2pTransport(room);
}

async function p2pTransport(room) {
  // Loaded only when someone actually plays multiplayer, so single-player
  // never depends on the CDN.
  const trystero = await import(TRYSTERO_URL);
  const r = trystero.joinRoom({ appId: APP_ID }, `room-${room}`);
  const t = base();
  t.selfId = trystero.selfId;
  t.kind = 'p2p';

  const ctl = r.makeAction('ctl');
  const snap = r.makeAction('snap');
  t.sendCtl = (obj, to) => ctl.send(obj, to ? { target: to } : undefined);
  t.sendSnap = (buf, to) => snap.send(buf, to ? { target: to } : undefined);
  ctl.onMessage = (data, meta) => t.onCtl(data, peerOf(meta));
  snap.onMessage = (data, meta) => t.onSnap(toArrayBuffer(data), peerOf(meta));
  r.onPeerJoin = (id) => t.onJoin(id);
  r.onPeerLeave = (id) => t.onLeave(id);
  t.leave = () => { try { r.leave(); } catch (_) { /* ignore */ } };
  return t;
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

function localTransport(room) {
  const ch = new BroadcastChannel(`vectoria-${room}`);
  const t = base();
  t.kind = 'local';
  t.selfId = Math.random().toString(36).slice(2, 10);
  const known = new Set();

  const post = (msg) => ch.postMessage({ ...msg, from: t.selfId });
  ch.onmessage = (e) => {
    const m = e.data;
    if (!m || m.from === t.selfId) return;
    if (m.to && m.to !== t.selfId) return;
    if (m.k === 'hi' || m.k === 'hi-ack') {
      if (!known.has(m.from)) {
        known.add(m.from);
        if (m.k === 'hi') post({ k: 'hi-ack', to: m.from });
        t.onJoin(m.from);
      }
      return;
    }
    if (m.k === 'bye') {
      if (known.delete(m.from)) t.onLeave(m.from);
      return;
    }
    if (!known.has(m.from)) return;
    if (m.k === 'ctl') t.onCtl(m.d, m.from);
    else if (m.k === 'snap') t.onSnap(m.d, m.from);
  };

  t.sendCtl = (obj, to) => post({ k: 'ctl', d: obj, to });
  t.sendSnap = (buf, to) => post({ k: 'snap', d: buf, to });
  const bye = () => post({ k: 'bye' });
  window.addEventListener('pagehide', bye);
  t.leave = () => {
    bye();
    window.removeEventListener('pagehide', bye);
    ch.close();
  };
  // Announce after the caller has had a chance to attach handlers.
  setTimeout(() => post({ k: 'hi' }), 0);
  return t;
}
