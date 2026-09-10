/**
 * fx.js —— 特效系统：粒子 / 冲击环 / 飘字 / 震屏 / 顿帧 + 辉光后处理
 *
 * 「优化美术」的表现核心：
 *   · 全部粒子走对象池 + 预烘焙的柔光点贴图，避免每帧 createRadialGradient；
 *   · 加色混合（lighter）叠加在世界上，天然与夜空沙漠形成高对比；
 *   · 后处理用「亮部提取 + 模糊 + 加色回叠」实现 Bloom，
 *     在浏览器与 @napi-rs/canvas 上都可运行，不支持 filter 时自动降级为无辉光。
 */

import { makeCanvas, ctx2d, withAlpha, mix, Pool, rand, clamp, TAU, hash01 } from './util.js';
import { TUNING } from './config.js';

/* ---------------- 柔光点贴图 ---------------- */
const DOTS = new Map();
const DOT_SIZE = 48;
export function dot(color) {
  if (DOTS.has(color)) return DOTS.get(color);
  const c = makeCanvas(DOT_SIZE, DOT_SIZE);
  const g = ctx2d(c);
  const r = DOT_SIZE / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, withAlpha(mix(color, '#ffffff', 0.85), 1));
  gr.addColorStop(0.28, withAlpha(color, 0.9));
  gr.addColorStop(0.62, withAlpha(color, 0.28));
  gr.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, DOT_SIZE, DOT_SIZE);
  DOTS.set(color, c);
  return c;
}
const SOFT = (() => {
  // 环改用矢量描边 + 柔光环，缩放时线宽恒定（贴图放大会糊成一团白）
  const s = 96;
  const c = makeCanvas(s, s);
  const g = ctx2d(c);
  const r = g.createRadialGradient(s / 2, s / 2, s * 0.16, s / 2, s / 2, s / 2);
  r.addColorStop(0, withAlpha('#ffffff', 0));
  r.addColorStop(0.62, withAlpha('#ffffff', 0.28));
  r.addColorStop(0.88, withAlpha('#ffffff', 0.75));
  r.addColorStop(1, withAlpha('#ffffff', 0));
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
  return c;
})();
const SMOKE = (() => {
  const s = 64;
  const c = makeCanvas(s, s);
  const g = ctx2d(c);
  const r = s / 2;
  // 不规则烟团
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + hash01(i, 3) * 0.6;
    const d = r * 0.34;
    const rr = r * (0.3 + hash01(i, 7) * 0.26);
    const gr = g.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, rr);
    gr.addColorStop(0, withAlpha('#ffffff', 0.5));
    gr.addColorStop(1, withAlpha('#ffffff', 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, rr, 0, TAU);
    g.fill();
  }
  return c;
})();

/* ---------------- 粒子系统 ---------------- */
const TYPES = { SPARK: 0, EMBER: 1, SMOKE: 2, RING: 3, DEBRIS: 4, FLASH: 5, TRAIL: 6, STREAK: 7 };

function newParticle() {
  return {
    dead: true, type: 0, x: 0, y: 0, vx: 0, vy: 0, r: 4, r2: 8, rot: 0, vrot: 0,
    life: 0, ttl: 1, color: '#ffffff', alpha: 1, drag: 0.96, grav: 0, shrink: 1, fade: 1,
  };
}

export class FX {
  constructor(quality = 1) {
    this.p = new Pool(newParticle);
    this.texts = [];
    this.quality = quality; // 0=低 1=中 2=高
    this.shakeMag = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.rot = 0;
    this.flashColor = '#ffffff';
    this.flashAlpha = 0;
    this.flashDecay = 0.1;
    this.hitstopMs = 0;
    this.zoom = 0;
    this.t = 0;
    this.emberTimer = 0;
  }
  setQuality(q) {
    this.quality = q;
  }
  get scale() {
    return this.quality === 0 ? 0.4 : this.quality === 1 ? 0.75 : 1.15;
  }
  spawn(type, o) {
    if (this.p.count > (this.quality === 2 ? 1400 : 900)) return null;
    const p = this.p.spawn();
    p.type = type;
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx || 0;
    p.vy = o.vy || 0;
    p.r = o.r != null ? o.r : 4;
    p.r2 = o.r2 != null ? o.r2 : p.r;
    p.rot = o.rot || 0;
    p.vrot = o.vrot || 0;
    p.life = 0;
    p.ttl = o.ttl || 500;
    p.color = o.color || '#ffffff';
    p.alpha = o.alpha != null ? o.alpha : 1;
    p.drag = o.drag != null ? o.drag : 0.96;
    p.grav = o.grav || 0;
    p.shrink = o.shrink != null ? o.shrink : 1;
    p.fade = o.fade != null ? o.fade : 1;
    return p;
  }

  /* --- 发射器 --- */
  sparks(x, y, n, color, { speed = 3, ttl = 340, spread = TAU, dir = 0, r = 2.2 } = {}) {
    n = Math.max(1, Math.round(n * this.scale));
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const v = speed * (0.5 + Math.random());
      this.spawn(TYPES.SPARK, {
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: r * (0.6 + Math.random() * 0.9), color, ttl: ttl * (0.7 + Math.random() * 0.6),
        drag: 0.9,
      });
    }
  }
  embers(x, y, n, color, { speed = 1.4, ttl = 900, r = 3, vy0 = 0 } = {}) {
    n = Math.round(n * this.scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random());
      this.spawn(TYPES.EMBER, {
        x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v + vy0,
        r: r * (0.5 + Math.random()), color, ttl: ttl * (0.6 + Math.random() * 0.9), drag: 0.985, grav: -0.004,
      });
    }
  }
  smoke(x, y, n, color = '#4a3b33', { speed = 0.7, ttl = 700, r = 9 } = {}) {
    n = Math.round(n * this.scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.3 + Math.random());
      this.spawn(TYPES.SMOKE, {
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: r * (0.5 + Math.random()), r2: r * (2.4 + Math.random() * 2), color,
        ttl: ttl * (0.7 + Math.random() * 0.7), alpha: 0.32, drag: 0.98, shrink: 0,
      });
    }
  }
  ring(x, y, r0, r1, color = '#ffffff', ttl = 320, alpha = 0.9) {
    this.spawn(TYPES.RING, { x, y, r: r0, r2: r1, color, ttl, alpha });
  }
  debris(x, y, n, color, { speed = 3.4, ttl = 700, size = 4 } = {}) {
    n = Math.round(n * this.scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.4 + Math.random());
      this.spawn(TYPES.DEBRIS, {
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: size * (0.5 + Math.random()), color, ttl: ttl * (0.6 + Math.random()),
        rot: Math.random() * TAU, vrot: (Math.random() - 0.5) * 0.5, drag: 0.985, grav: 0.02,
      });
    }
  }
  flash(x, y, r, color, ttl = 200) {
    this.spawn(TYPES.FLASH, { x, y, r, r2: r * 1.5, color, ttl, alpha: 0.9 });
  }
  streak(x, y, len, color, ttl = 220, vy = 0) {
    this.spawn(TYPES.STREAK, { x, y, vx: 0, vy, r: len, color, ttl, alpha: 0.5 });
  }
  trail(x, y, r, color, ttl = 260) {
    this.spawn(TYPES.TRAIL, { x, y, r, r2: r * 0.2, color, ttl, alpha: 0.6 });
  }

  /** 通用爆炸：火球 + 冲击环 + 火星 + 碎片 + 烟 + 屏震 */
  explode(x, y, scale = 1, tint = '#ff9a3c', opts = {}) {
    const s = scale;
    this.flash(x, y, 40 * s, mix(tint, '#ffffff', 0.55), 180);
    this.ring(x, y, 6 * s, (opts.ring || 90) * s, mix(tint, '#ffffff', 0.35), 320 + 90 * s, 0.85);
    this.sparks(x, y, 18 * s, mix(tint, '#ffe6b0', 0.55), { speed: 3.6 * s, ttl: 420, r: 2.6 * s });
    this.embers(x, y, 16 * s, tint, { speed: 1.8 * s, ttl: 900, r: 4 * s });
    this.smoke(x, y, 9 * s, '#3d3128', { speed: 1.05 * s, ttl: 900, r: 12 * s });
    this.debris(x, y, 8 * s, opts.debris || '#8a7a68', { speed: 3.2 * s, size: 3.4 * s });
    this.shake(6 * s + (opts.shake || 0));
  }
  /** 弹着点火花（轻量） */
  hit(x, y, tint = '#bfefff', power = 1) {
    this.sparks(x, y, 4 * power, tint, { speed: 2.4 * power, ttl: 200, r: 1.7 * power });
    this.flash(x, y, 9 * power, mix(tint, '#ffffff', 0.6), 110);
  }
  muzzle(x, y, dir, tint, power = 1) {
    this.sparks(x, y, 3, mix(tint, '#ffffff', 0.5), { speed: 2.6, ttl: 160, spread: 0.7, dir, r: 1.6 });
    this.flash(x, y, 11 * power, tint, 110);
  }
  pickup(x, y, tint) {
    this.ring(x, y, 8, 70, tint, 420, 0.8);
    this.embers(x, y, 22, tint, { speed: 1.6, ttl: 800, r: 3.4, vy0: -0.6 });
    this.flash(x, y, 44, mix(tint, '#ffffff', 0.5), 240);
  }
  popText(x, y, text, color = '#ffe6a8', size = 16, vy = -0.9, ttl = 900) {
    this.texts.push({ x, y, text, color, size, vy, t: 0, ttl });
  }
  shake(mag) {
    this.shakeMag = Math.min(26, this.shakeMag + mag);
  }
  hitstop(ms) {
    this.hitstopMs = Math.max(this.hitstopMs, ms);
  }
  flashScreen(color = '#ffffff', a = 0.4, decay = 0.1) {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, a);
    this.flashDecay = decay;
  }
  zoomPunch(v = 0.06) {
    this.zoom = Math.max(this.zoom, v);
  }

  /* --- 推进 --- */
  update(dt, k) {
    this.t += dt;
    const s = this.p.used;
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      if (p.dead) continue;
      p.life += dt;
      if (p.life >= p.ttl) {
        p.dead = true;
        continue;
      }
      const f = p.life / p.ttl;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vy += p.grav * k * 10;
      p.vx *= Math.pow(p.drag, k);
      p.vy *= Math.pow(p.drag, k);
      p.rot += p.vrot * k;
      p.curAlpha = p.alpha * Math.pow(1 - f, p.fade === 0 ? 1 : 0.6 + p.fade);
      p.f = f;
      p.curR = p.shrink ? p.r + (p.r2 - p.r) * (p.type === TYPES.RING ? easeOut(f) : f) : p.r * (1 + f * 2.2);
    }
    this.p.sweep();
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      t.y += t.vy * k;
      t.vy *= Math.pow(0.985, k);
      if (t.t > t.ttl) this.texts.splice(i, 1);
    }
    // 屏震
    this.shakeMag *= Math.pow(TUNING.SHAKE_DECAY, k);
    if (this.shakeMag < 0.05) this.shakeMag = 0;
    const sm = this.shakeMag;
    this.shakeX = (Math.random() - 0.5) * sm * 2;
    this.shakeY = (Math.random() - 0.5) * sm * 2;
    this.rot = (Math.random() - 0.5) * sm * 0.0018;
    this.flashAlpha *= Math.pow(1 - this.flashDecay, k);
    if (this.flashAlpha < 0.004) this.flashAlpha = 0;
    this.zoom *= Math.pow(0.86, k);
    if (this.zoom < 0.001) this.zoom = 0;
    // 环境火星（高品质时沙漠热风扬尘）
    if (this.quality >= 2) {
      this.emberTimer -= dt;
      if (this.emberTimer <= 0) this.emberTimer = 260;
    }
  }
  draw(g) {
    const s = this.p.used;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      if (p.dead) continue;
      const a = p.curAlpha != null ? p.curAlpha : p.alpha;
      if (a <= 0.01) continue;
      switch (p.type) {
        case TYPES.SMOKE: {
          g.globalCompositeOperation = 'source-over';
          g.globalAlpha = a * 0.8;
          const r = p.curR;
          g.drawImage(SMOKE, p.x - r, p.y - r, r * 2, r * 2);
          g.globalCompositeOperation = 'lighter';
          break;
        }
        case TYPES.RING: {
          const r = Math.max(2, p.curR);
          const f = p.f != null ? p.f : 0;
          g.globalAlpha = a;
          // 主环（细、亮）+ 外扩散的柔光环
          g.lineWidth = Math.max(1, 3.6 * (1 - f));
          g.strokeStyle = withAlpha(mix(p.color, '#ffffff', 0.5), 0.9);
          g.beginPath();
          g.arc(p.x, p.y, r, 0, TAU);
          g.stroke();
          g.globalAlpha = a * 0.5;
          const hw = r * 1.32;
          g.drawImage(SOFT, p.x - hw, p.y - hw, hw * 2, hw * 2);
          break;
        }
        case TYPES.DEBRIS: {
          g.globalAlpha = Math.min(1, a * 1.4);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = withAlpha(p.color, 0.95);
          g.fillRect(-p.r * 0.6, -p.r * 0.22, p.r * 1.2, p.r * 0.44);
          g.restore();
          break;
        }
        case TYPES.STREAK: {
          g.globalAlpha = a;
          const gr = g.createLinearGradient ? g.createLinearGradient(p.x, p.y, p.x, p.y - p.r) : null;
          if (gr) {
            gr.addColorStop(0, withAlpha(p.color, 0.9));
            gr.addColorStop(1, withAlpha(p.color, 0));
            g.fillStyle = gr;
          } else g.fillStyle = withAlpha(p.color, 0.5);
          g.fillRect(p.x - 1.2, p.y - p.r, 2.4, p.r);
          break;
        }
        case TYPES.SPARK: {
          g.globalAlpha = a;
          const r = Math.max(0.6, p.curR);
          const d = dot(p.color);
          g.drawImage(d, p.x - r * 2, p.y - r * 2, r * 4, r * 4);
          // 拖尾亮线
          g.strokeStyle = withAlpha(mix(p.color, '#ffffff', 0.6), a * 0.8);
          g.lineWidth = Math.max(0.6, r * 0.6);
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
          g.stroke();
          break;
        }
        case TYPES.TRAIL: {
          g.globalAlpha = a * 0.8;
          const r = p.curR;
          g.drawImage(dot(p.color), p.x - r * 1.6, p.y - r * 1.6, r * 3.2, r * 3.2);
          break;
        }
        default: {
          const r = Math.max(0.6, p.curR);
          g.globalAlpha = a;
          g.drawImage(dot(p.color), p.x - r * 1.8, p.y - r * 1.8, r * 3.6, r * 3.6);
        }
      }
    }
    g.globalAlpha = 1;
    g.restore();
  }
  drawTexts(g) {
    if (!this.texts.length) return;
    g.save();
    g.textAlign = 'center';
    for (const t of this.texts) {
      const f = t.t / t.ttl;
      g.globalAlpha = 1 - f * f;
      const sz = t.size * (1 + (1 - Math.pow(1 - Math.min(1, f * 4), 3)) * 0.28);
      g.font = `700 ${sz.toFixed(1)}px "Rajdhani", "Noto Sans SC", system-ui, sans-serif`;
      g.lineWidth = 3;
      g.strokeStyle = withAlpha('#1a0f06', 0.7);
      g.strokeText(t.text, t.x, t.y);
      g.fillStyle = withAlpha(t.color, 1);
      g.fillText(t.text, t.x, t.y);
    }
    g.restore();
  }
  /** 全屏闪光（叠加在世界之后） */
  drawFlash(g, W, H) {
    if (this.flashAlpha > 0.004) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = withAlpha(this.flashColor, this.flashAlpha);
      g.fillRect(0, 0, W, H);
      g.restore();
    }
  }
  drawDanger(g, W, H, amount, t) {
    if (amount <= 0.01) return;
    const p = 0.55 + Math.sin(t * 0.006) * 0.45;
    const gr = g.createRadialGradient
      ? g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.62)
      : null;
    g.save();
    if (gr) {
      gr.addColorStop(0, withAlpha('#ff2a1a', 0));
      gr.addColorStop(1, withAlpha('#ff2a1a', 0.28 * amount * p));
      g.fillStyle = gr;
    } else {
      g.fillStyle = withAlpha('#ff2a1a', 0.2 * amount * p);
    }
    g.fillRect(0, 0, W, H);
    g.restore();
  }
  reset() {
    this.p.clear();
    this.texts.length = 0;
    this.shakeMag = 0;
    this.flashAlpha = 0;
    this.hitstopMs = 0;
  }
}

const easeOut = (f) => 1 - Math.pow(1 - f, 2.4);

/* ---------------- 后处理：Bloom ---------------- */
export class PostFX {
  constructor(quality = 1) {
    this.enabled = quality > 0;
    this.strength = quality >= 2 ? 0.5 : quality === 1 ? 0.34 : 0;
    this.bloom = null;
    this.bg = null;
    this.filterOK = null;
    this.W = 0;
    this.H = 0;
  }
  ensure(W, H, dpr) {
    const bw = Math.max(2, Math.round(W * TUNING.BLOOM_SCALE));
    const bh = Math.max(2, Math.round(H * TUNING.BLOOM_SCALE));
    if (!this.bloom || this.W !== W || this.H !== H) {
      this.bloom = makeCanvas(bw, bh);
      this.bg = ctx2d(this.bloom);
      this.W = W;
      this.H = H;
      // 探测 filter 支持
      if (this.filterOK === null) {
        this.bg.filter = 'blur(2px)';
        this.filterOK = typeof this.bg.filter === 'string' && this.bg.filter.indexOf('blur') >= 0;
        this.bg.filter = 'none';
      }
    }
  }
  /** 从已绘制完成的画面上取亮部做泛光，再加色回叠 */
  apply(srcCanvas, W, H, dpr) {
    if (!this.enabled) return;
    // 不支持 ctx.filter 的浏览器直接跳过泛光（否则整屏会被加色叠加而发灰）
    if (this.filterOK === false) return;
    this.ensure(W, H, dpr);
    const g = this.bg;
    const bw = this.bloom.width;
    const bh = this.bloom.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, bw, bh);
    if (this.filterOK) {
      // 亮度提升 + 对比度拉高 ≈ 亮部提取，再模糊
      g.filter = `brightness(1.55) contrast(3.4) saturate(1.25) blur(${this.strength > 0.6 ? 3 : 2}px)`;
      g.drawImage(srcCanvas, 0, 0, bw, bh);
      g.filter = 'none';
    } else {
      g.drawImage(srcCanvas, 0, 0, bw, bh);
    }
    const c = srcCanvas.getContext('2d');
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = this.strength;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.bloom, 0, 0, srcCanvas.width, srcCanvas.height);
    c.restore();
  }
}
