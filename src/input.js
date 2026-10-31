// Pointer input -> force sources. Every active pointer (a mouse, each finger
// on a touchscreen, a pen) becomes its own source, so local multitouch
// co-op already works: two people on one tablet are two sources.

import { MAP_W, MAP_H } from './config.js';

export class PointerSources {
  constructor(canvas) {
    this.canvas = canvas;
    this.byId = new Map();   // pointerId -> source
    this.touchButton = 1;    // touch has no right button; a toggle picks 1 or 3
    this.enabled = false;
    this.player = 0;         // 0 = solo, 1 = host (orange), 2 = guest (violet)
    this.listeners = [];     // UI click handlers when not in play

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('lostpointercapture', (e) => this.onUp(e));
  }

  // Canvas CSS pixels -> map pixels (the canvas is scaled to fit the window).
  toMap(e) {
    const r = this.canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * MAP_W,
      ((e.clientY - r.top) / r.height) * MAP_H,
    ];
  }

  onDown(e) {
    e.preventDefault();
    const [x, y] = this.toMap(e);
    for (const fn of this.listeners) if (fn(x, y, e) === true) return;
    if (!this.enabled) return;
    let button;
    if (e.pointerType === 'mouse') {
      if (e.button === 0) button = 1;
      else if (e.button === 2) button = 3;
      else return;
    } else {
      button = this.touchButton;
    }
    // A mouse pressing a second button mid-drag keeps its first button,
    // matching the single drag_button of the original.
    if (this.byId.has(e.pointerId)) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    this.byId.set(e.pointerId, {
      id: e.pointerId,
      player: this.player,
      kind: e.pointerType,
      x, y,
      button,
      held: true,
      tap: true, // guarantees at least one impulse even for a sub-tick click
    });
  }

  onMove(e) {
    const s = this.byId.get(e.pointerId);
    const [x, y] = this.toMap(e);
    this.hoverX = x;
    this.hoverY = y;
    if (!s) return;
    s.x = x;
    s.y = y;
  }

  onUp(e) {
    const s = this.byId.get(e.pointerId);
    if (!s) return;
    if (e.pointerType === 'mouse' && e.type === 'pointerup') {
      // Release only when the button that started the drag is released.
      const still = s.button === 1 ? (e.buttons & 1) : (e.buttons & 2);
      if (still) return;
    }
    s.held = false;
    // Keep it for this tick if it was a quick tap that hasn't fired yet.
    if (!s.tap) this.byId.delete(e.pointerId);
  }

  // Sources for the simulation this tick. Released-but-unfired taps are
  // returned once, then dropped.
  list() {
    const out = [];
    for (const [id, s] of this.byId) {
      out.push(s);
      if (!s.held && !s.tap) this.byId.delete(id);
    }
    return out;
  }

  // Called after the tick consumed taps.
  prune() {
    for (const [id, s] of this.byId) if (!s.held && !s.tap) this.byId.delete(id);
  }

  clear() {
    this.byId.clear();
  }

  // Touch has no right button, so the pad (or the T key) picks what a finger
  // does. Switching applies live to fingers already on the field, so you can
  // flip push to pull mid-drag without lifting.
  setTouchButton(b) {
    this.touchButton = b === 3 ? 3 : 1;
    for (const s of this.byId.values()) if (s.kind !== 'mouse') s.button = this.touchButton;
  }

  onClick(fn) {
    this.listeners.push(fn);
  }
}
