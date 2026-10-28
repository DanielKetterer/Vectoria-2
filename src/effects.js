// Win-screen fireworks and confetti. Cosmetic only, so they use Math.random
// and stay out of the simulation.

import {
  MAP_W, MAP_H, CONFETTI_COUNT, CONFETTI_COLORS, FIREWORK_SPAWN_INTERVAL_MS,
  EXPLOSION_PARTICLES, EXPLOSION_SPEED, EXPLOSION_GRAVITY, PARTICLE_LIFETIME,
} from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Celebration {
  constructor() {
    this.fireworks = [];
    this.lastLaunch = -Infinity;
    this.confetti = [];
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      this.confetti.push({
        x: rand(0, MAP_W), y: rand(-MAP_H, 0),
        vx: rand(-1, 1), vy: rand(2, 5),
        size: 2 + Math.floor(Math.random() * 9),
        color: pick(CONFETTI_COLORS),
      });
    }
  }

  step(nowMs) {
    if (nowMs - this.lastLaunch > FIREWORK_SPAWN_INTERVAL_MS) {
      this.lastLaunch = nowMs;
      this.fireworks.push({ x: rand(0, MAP_W), y: MAP_H, vx: 0, vy: rand(-12, -8), exploded: false, particles: [] });
    }
    for (const fw of this.fireworks) {
      if (!fw.exploded) {
        fw.x += fw.vx;
        fw.y += fw.vy;
        fw.vy += EXPLOSION_GRAVITY;
        if (fw.vy >= 0) {
          fw.exploded = true;
          for (let i = 0; i < EXPLOSION_PARTICLES; i++) {
            const ang = rand(0, Math.PI * 2);
            const sp = rand(1, EXPLOSION_SPEED);
            fw.particles.push({ x: fw.x, y: fw.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: PARTICLE_LIFETIME, color: pick(CONFETTI_COLORS) });
          }
        }
      } else {
        for (const p of fw.particles) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += EXPLOSION_GRAVITY;
          p.life--;
        }
        fw.particles = fw.particles.filter((p) => p.life > 0);
      }
    }
    this.fireworks = this.fireworks.filter((fw) => !fw.exploded || fw.particles.length);
    for (const c of this.confetti) {
      c.x += c.vx;
      c.y += c.vy;
      c.vy += 0.05;
      if (c.y > MAP_H + 10) {
        c.y = rand(-20, 0);
        c.x = rand(0, MAP_W);
        c.vx = rand(-1, 1);
        c.vy = rand(2, 5);
      }
    }
  }

  draw(ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    for (const fw of this.fireworks) {
      if (!fw.exploded) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(fw.x, fw.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const p of fw.particles) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const c of this.confetti) {
      ctx.fillStyle = c.color;
      ctx.fillRect(Math.trunc(c.x), Math.trunc(c.y), c.size, c.size);
    }
  }
}
