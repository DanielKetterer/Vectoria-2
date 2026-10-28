// Level maps: each PNG pixel color is a rule. We classify every pixel once at
// load into a zone id, so gameplay queries are a single array lookup instead
// of the per-query tolerance comparisons the Python version did.

import { MAP_W, MAP_H, TOLERANCE, Z, ZONE_COLORS } from './config.js';

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

export async function loadTextures() {
  if (textureCache) return textureCache;
  const entries = await Promise.all(
    ZONE_COLORS.map(async ([zone, , file]) => {
      const img = await loadImage(`assets/textures/${file}`);
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

export class LevelMap {
  constructor(zones, textured) {
    this.w = MAP_W;
    this.h = MAP_H;
    this.zones = zones;       // Uint8Array(w*h)
    this.textured = textured; // canvas with the textured map
  }

  static async load(path) {
    const [img, textures] = await Promise.all([loadImage(path), loadTextures()]);
    if (img.width !== MAP_W || img.height !== MAP_H) {
      console.warn(`${path} is ${img.width}x${img.height}; scaling to ${MAP_W}x${MAP_H}`);
    }
    const src = imageData(img, MAP_W, MAP_H).data;
    const zones = new Uint8Array(MAP_W * MAP_H);
    for (let i = 0, p = 0; i < zones.length; i++, p += 4) {
      zones[i] = classify(src[p], src[p + 1], src[p + 2]);
    }

    // Textured render: each zone shows its texture, tiled at native size, or
    // scaled to the map if the texture is bigger (same rule as the Python
    // ImageMap.finalize). Unmatched pixels keep their raw map color.
    const texData = new Map();
    for (const [zone, timg] of textures) {
      const big = timg.width > MAP_W || timg.height > MAP_H;
      const w = big ? MAP_W : timg.width;
      const h = big ? MAP_H : timg.height;
      texData.set(zone, { w, h, data: imageData(timg, w, h).data });
    }

    const out = new ImageData(MAP_W, MAP_H);
    const o = out.data;
    for (let y = 0, i = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++, i++) {
        const p = i * 4;
        const t = texData.get(zones[i]);
        if (t) {
          const q = ((y % t.h) * t.w + (x % t.w)) * 4;
          o[p] = t.data[q];
          o[p + 1] = t.data[q + 1];
          o[p + 2] = t.data[q + 2];
          o[p + 3] = 255;
        } else {
          o[p] = src[p];
          o[p + 1] = src[p + 1];
          o[p + 2] = src[p + 2];
          o[p + 3] = 255;
        }
      }
    }
    const textured = document.createElement('canvas');
    textured.width = MAP_W;
    textured.height = MAP_H;
    textured.getContext('2d').putImageData(out, 0, 0);

    return new LevelMap(zones, textured);
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
    return z === Z.MAGENTA || z === Z.BLUE || z === Z.GREEN || z === Z.TEAL || z === Z.YELLOW;
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
