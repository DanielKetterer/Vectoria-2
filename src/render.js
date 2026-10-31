// Drawing: world, field overlays, HUD, panels, menus.

import { MAP_W, MAP_H, SAMPLE_STEP, COLORS, DOT_RADIUS, PLAYER_COLORS } from './config.js';
import { fieldAt } from './physics.js';

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function text(ctx, str, x, y, { size = 24, color = '#fff', align = 'center', weight = 400, baseline = 'middle' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

// A clickable rounded button; returns its rect so callers can hit-test.
export function button(ctx, label, cx, cy, { w = 220, h = 44, size = 22, active = false } = {}) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillStyle = active ? 'rgba(255,215,0,0.95)' : 'rgba(255,255,255,0.12)';
  ctx.strokeStyle = active ? 'rgb(255,215,0)' : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  text(ctx, label, cx, cy + 1, { size, color: active ? '#000' : '#fff', weight: 600 });
  return { x, y, w, h };
}

export const hit = (r, px, py) => r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

export function drawWorld(ctx, world) {
  world.map.draw(ctx);
  ctx.fillStyle = COLORS.dot;
  for (let i = 0; i < world.n; i++) {
    ctx.beginPath();
    ctx.arc(world.px[i], world.py[i], DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

export { PLAYER_COLORS };

// Markers for held sources so multiple fingers/players can see their own:
// ring color = player, + for left button, - for right.
export function drawSources(ctx, sources) {
  for (const s of sources) {
    if (!s.held) continue;
    const col = PLAYER_COLORS[s.player || 0] || PLAYER_COLORS[0];
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
    ctx.moveTo(s.x - 6, s.y);
    ctx.lineTo(s.x + 6, s.y);
    if (s.button !== 3) {
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x, s.y + 6);
    }
    ctx.stroke();
  }
}

// Overlay sample grid, rebuilt when the map size changes.
let samplePts = [];
let sampleKey = '';
function samplesFor(w, h) {
  const key = `${w}x${h}`;
  if (key !== sampleKey) {
    sampleKey = key;
    samplePts = [];
    for (let x = SAMPLE_STEP / 2; x < w; x += SAMPLE_STEP) {
      for (let y = SAMPLE_STEP / 2; y < h; y += SAMPLE_STEP) samplePts.push([x, y]);
    }
  }
  return samplePts;
}

// Overlays show the superposed field of the most recent sources that acted.
export function drawOverlays(ctx, resolved, { vectors, divergence, curl }) {
  if (!resolved.length) return;
  samplesFor(MAP_W, MAP_H);
  const h = SAMPLE_STEP * 0.5;

  if (divergence) {
    const divs = samplePts.map(([x, y]) => {
      const fx1 = fieldAt(resolved, x + h, y)[0];
      const fx0 = fieldAt(resolved, x - h, y)[0];
      const fy1 = fieldAt(resolved, x, y + h)[1];
      const fy0 = fieldAt(resolved, x, y - h)[1];
      return (fx1 - fx0) / (2 * h) + (fy1 - fy0) / (2 * h);
    });
    const vmax = Math.max(...divs.map(Math.abs));
    samplePts.forEach(([x, y], i) => {
      // A curl-only field has zero divergence; don't amplify rounding noise.
      const t = vmax > 1e-9 ? (divs[i] / vmax + 1) / 2 : 0.5;
      ctx.fillStyle = `rgba(${Math.round(255 * t)},0,${Math.round(255 * (1 - t))},0.4)`;
      ctx.fillRect(x - SAMPLE_STEP / 2, y - SAMPLE_STEP / 2, SAMPLE_STEP, SAMPLE_STEP);
    });
  }

  if (vectors) {
    ctx.strokeStyle = COLORS.overlay;
    ctx.fillStyle = COLORS.overlay;
    ctx.lineWidth = 1;
    for (const [x, y] of samplePts) {
      let [fx, fy] = fieldAt(resolved, x, y);
      const m = Math.hypot(fx, fy);
      if (m < 1e-9) continue;
      fx /= m;
      fy /= m;
      const ex = x + fx * SAMPLE_STEP * 0.4;
      const ey = y + fy * SAMPLE_STEP * 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const px = fy * 3;
      const py = -fx * 3;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - fx * 6 + px, ey - fy * 6 + py);
      ctx.lineTo(ex - fx * 6 - px, ey - fy * 6 - py);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (curl) {
    ctx.strokeStyle = COLORS.curl;
    ctx.lineWidth = 2;
    for (const [x, y] of samplePts) {
      const fy1 = fieldAt(resolved, x + h, y)[1];
      const fy0 = fieldAt(resolved, x - h, y)[1];
      const fx1 = fieldAt(resolved, x, y + h)[0];
      const fx0 = fieldAt(resolved, x, y - h)[0];
      const c = (fy1 - fy0) / (2 * h) - (fx1 - fx0) / (2 * h);
      const r = Math.min(Math.abs(c) * SAMPLE_STEP * 2, SAMPLE_STEP * 0.4);
      if (r < 0.5) continue;
      // pygame.draw.arc measures angles counterclockwise on screen; canvas
      // measures clockwise, so negate and draw anticlockwise.
      const start = c > 0 ? 0 : Math.PI;
      ctx.beginPath();
      ctx.arc(x, y, r, -start, -(start + Math.PI), true);
      ctx.stroke();
    }
  }
}

export function panel(ctx) {
  ctx.fillStyle = COLORS.panelBg;
  ctx.fillRect(0, 0, MAP_W, MAP_H);
}

export function pill(ctx, str, x, y, { size = 18, align = 'left' } = {}) {
  ctx.font = `600 ${size}px ${FONT}`;
  const w = ctx.measureText(str).width + 20;
  const h = size + 14;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(left, y, w, h, h / 2);
  ctx.fill();
  text(ctx, str, left + w / 2, y + h / 2 + 1, { size, weight: 600 });
  return { x: left, y, w, h };
}
