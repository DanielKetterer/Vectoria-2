// Level maps: each PNG pixel color is a rule. We classify every pixel once at
// load into a zone id, so gameplay queries are a single array lookup instead
// of the per-query tolerance comparisons the Python version did.

import { BASE_W, BASE_H, TOLERANCE, Z, ZONE_COLORS, PLAYER_COLORS } from './config.js';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function imageData(img, w = img.width, h = img.height) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

let textureCache = null;

// Versus goal texture: a checkered flag in the player's color, so the two
// goals read as "the same kind of thing" as the green goal but clearly owned.
function flagTexture(color, dark) {
  const c = document.createElement('canvas');
  const sq = 16;
  c.width = sq * 4;
  c.height = sq * 4;
  const g = c.getContext('2d');
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? dark : color;
      g.fillRect(x * sq, y * sq, sq, sq);
    }
  }
  return c;
}

const GENERATED = {
  [Z.GOAL_P1]: () => flagTexture(PLAYER_COLORS[1], 'rgb(70,35,0)'),
  [Z.GOAL_P2]: () => flagTexture(PLAYER_COLORS[2], 'rgb(40,20,80)'),
};

export async function loadTextures() {
  if (textureCache) return textureCache;
  const entries = await Promise.all(
    ZONE_COLORS.map(async ([zone, , file]) => {
      const img = file ? await loadImage(`assets/textures/${file}`) : GENERATED[zone]();
      return [zone, img];
    })
  );
  textureCache = new Map(entries);
  return textureCache;
}

function classify(r, g, b) {
  for (const [zone, [cr, cg, cb]] of ZONE_COLORS) {
    if (Math.abs(r - cr) <= TOLERANCE && Math.abs(g - cg) <= TOLERANCE && Math.abs(b - cb) <= TOLERANCE) {
      return zone;
    }
  }
  return Z.NONE;
}

// Textured render: each zone shows its texture, tiled at native size, or
// scaled to the map if the texture is bigger (same rule as the Python
// ImageMap.finalize). Unmatched pixels keep their raw map color (src), or
// black for a generated map.
function renderTextured(zones, W, H, textures, src) {
  const texData = new Map();
  for (const [zone, timg] of textures) {
    const big = timg.width > W || timg.height > H;
    const w = big ? W : timg.width;
    const h = big ? H : timg.height;
    texData.set(zone, { w, h, data: imageData(timg, w, h).data });
  }
  const out = new ImageData(W, H);
  const o = out.data;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const p = i * 4;
      const t = texData.get(zones[i]);
      if (t) {
        const q = ((y % t.h) * t.w + (x % t.w)) * 4;
        o[p] = t.data[q];
        o[p + 1] = t.data[q + 1];
        o[p + 2] = t.data[q + 2];
      } else if (src) {
        o[p] = src[p];
        o[p + 1] = src[p + 1];
        o[p + 2] = src[p + 2];
      }
      o[p + 3] = 255;
    }
  }
  const textured = document.createElement('canvas');
  textured.width = W;
  textured.height = H;
  textured.getContext('2d').putImageData(out, 0, 0);
  return textured;
}

// Open Field, built to any size: a teal (push/pull) field inside a wall,
// with the two goals at the ends of the long axis. Same proportions as
// versus1.png: 12 px walls, 60 px deep goals, a 400 px mouth (capped at
// two-thirds of the short side). Violet's goal is at the top / left,
// Orange's at the bottom / right.
export const WALL = 12;
const GOAL_DEPTH = 60;
const GOAL_MOUTH = 400;

function openFieldZones(W, H) {
  const zones = new Uint8Array(W * H);
  const wide = W >= H;
  const shortSide = wide ? H : W;
  const mouth = Math.min(GOAL_MOUTH, Math.round((shortSide * 2) / 3));
  const m0 = Math.round((shortSide - mouth) / 2);
  const m1 = m0 + mouth;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      let z = Z.TEAL;
      if (x < WALL || y < WALL || x >= W - WALL || y >= H - WALL) z = Z.BLACK;
      else {
        const along = wide ? x : y;       // position on the long axis
        const across = wide ? y : x;      // position on the short axis
        const len = wide ? W : H;
        if (across >= m0 && across < m1) {
          if (along < WALL + GOAL_DEPTH) z = Z.GOAL_P2;
          else if (along >= len - WALL - GOAL_DEPTH) z = Z.GOAL_P1;
        }
      }
      zones[i] = z;
    }
  }
  return zones;
}

export class LevelMap {
  constructor(zones, textured, w = BASE_W, h = BASE_H) {
    this.w = w;
    this.h = h;
    this.zones = zones;       // Uint8Array(w*h)
    this.textured = textured; // canvas with the textured map

    // Centroids of the two versus goals (for labels), and whether this map
    // has any, which is what makes it a versus map.
    const sum = { [Z.GOAL_P1]: [0, 0, 0], [Z.GOAL_P2]: [0, 0, 0] };
    for (let i = 0; i < zones.length; i++) {
      const s = sum[zones[i]];
      if (s) { s[0] += i % w; s[1] += Math.floor(i / w); s[2]++; }
    }
    this.goalCenters = {};
    for (const z of [Z.GOAL_P1, Z.GOAL_P2]) {
      const [x, y, n] = sum[z];
      if (n) this.goalCenters[z] = [x / n, y / n];
    }
    this.isVersus = Object.keys(this.goalCenters).length === 2;
  }

  static async load(path) {
    const W = BASE_W;
    const H = BASE_H;
    const [img, textures] = await Promise.all([loadImage(path), loadTextures()]);
    if (img.width !== W || img.height !== H) {
      console.warn(`${path} is ${img.width}x${img.height}; scaling to ${W}x${H}`);
    }
    const src = imageData(img, W, H).data;
    const zones = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < zones.length; i++, p += 4) {
      zones[i] = classify(src[p], src[p + 1], src[p + 2]);
    }
    return new LevelMap(zones, renderTextured(zones, W, H, textures, src), W, H);
  }

  // Open Field at a given size (see openFieldZones). Host and guest call
  // this with the same size and get the same map.
  static async openField(w, h) {
    const textures = await loadTextures();
    const zones = openFieldZones(w, h);
    return new LevelMap(zones, renderTextured(zones, w, h, textures, null), w, h);
  }

  // Coordinates are clamped to the map, matching ImageMap._color.
  zoneAt(x, y) {
    const xi = Math.min(Math.max(Math.trunc(x), 0), this.w - 1);
    const yi = Math.min(Math.max(Math.trunc(y), 0), this.h - 1);
    return this.zones[yi * this.w + xi];
  }

  allowsDiv(x, y) {
    const z = this.zoneAt(x, y);
    return z === Z.TEAL || z === Z.YELLOW;
  }

  allowsCurl(x, y) {
    const z = this.zoneAt(x, y);
    return z === Z.YELLOW || z === Z.BLUE;
  }

  allowsMove(x, y) {
    const z = this.zoneAt(x, y);
    return z === Z.MAGENTA || z === Z.BLUE || z === Z.GREEN || z === Z.TEAL || z === Z.YELLOW
      || z === Z.GOAL_P1 || z === Z.GOAL_P2;
  }

  // Where dots start. Same as allowsMove, except never inside a player goal
  // (that would be a free head start). Green keeps the original behavior.
  allowsSpawn(x, y) {
    const z = this.zoneAt(x, y);
    return this.allowsMove(x, y) && z !== Z.GOAL_P1 && z !== Z.GOAL_P2;
  }

  isWall(x, y) {
    return this.zoneAt(x, y) === Z.BLACK;
  }

  isTarget(x, y) {
    return this.zoneAt(x, y) === Z.GREEN;
  }

  isTrap(x, y) {
    return this.zoneAt(x, y) === Z.RED;
  }

  draw(ctx) {
    ctx.drawImage(this.textured, 0, 0);
  }
}
