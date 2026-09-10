/**
 * util.js —— 平台适配 + 数学工具
 * 通过 setCanvasFactory 注入画布实现：浏览器用 document.createElement，
 * Node 下可用 @napi-rs/canvas 做离线渲染回归测试（见 web/tools/render-check.mjs）。
 */

export const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

let canvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function setCanvasFactory(fn) {
  canvasFactory = fn;
}

export function makeCanvas(w, h) {
  const c = canvasFactory(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(canvas) {
  const g = canvas.getContext('2d');
  if (g && typeof g.setTransform === 'function') g.imageSmoothingEnabled = true;
  return g;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!IS_BROWSER) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load image failed: ' + src));
    img.src = src;
  });
}

/* ---------------- 数学 ---------------- */
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const approach = (cur, target, maxStep) => {
  const d = target - cur;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
};
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
export const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/* 确定性哈希噪声（用于背景/纹理，避免每帧随机抖动） */
export function hash01(x, y = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
export function valueNoise(x, y = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  const a = lerp(hash01(xi, yi), hash01(xi + 1, yi), u);
  const b = lerp(hash01(xi, yi + 1), hash01(xi + 1, yi + 1), u);
  return lerp(a, b, v);
}
export function fbm(x, y = 0, oct = 3) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += valueNoise(x * f, y * f) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

/* ---------------- 颜色 ---------------- */
export function withAlpha(hex, a) {
  if (hex.startsWith('rgba') || hex.startsWith('hsla')) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
export function mix(hexA, hexB, t) {
  const p = (s) => {
    let h = s.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const A = p(hexA);
  const B = p(hexB);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], t)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/* ---------------- 路径辅助（兼容不支持 roundRect/ellipse 的实现） ---------------- */
export function roundRectPath(g, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}
export function ellipsePath(g, cx, cy, rx, ry, rot = 0) {
  g.beginPath();
  if (typeof g.ellipse === 'function') {
    g.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot, 0, TAU);
    return;
  }
  // 退化实现：arc + 非等比缩放
  g.save();
  g.translate(cx, cy);
  if (rot) g.rotate(rot);
  const sx = Math.abs(rx) || 0.0001;
  g.scale(sx, (Math.abs(ry) || 0.0001));
  g.arc(0, 0, 1, 0, TAU);
  g.restore();
}
export function polyPath(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}
export function starPath(g, cx, cy, spikes, rOut, rIn, rot = 0) {
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = rot + (i * Math.PI) / spikes;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/* 简单的 AABB 相交与扫掠相交（替代原版 Bullet.isCollide，修正高速穿透问题） */
export function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return !(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay);
}
export function sweptAabb(ax, ay, aw, ah, dx, dy, bx, by, bw, bh) {
  // 把「子弹上一帧到当前帧」视为竖/横线段，做一次保守的扫掠检测
  const x0 = Math.min(ax, ax + dx);
  const y0 = Math.min(ay, ay + dy);
  const w = aw + Math.abs(dx);
  const h = ah + Math.abs(dy);
  return aabb(x0, y0, w, h, bx, by, bw, bh);
}

/* 本地存储（无 localStorage 时静默降级） */
export const store = {
  get(key, dflt = null) {
    try {
      if (IS_BROWSER && window.localStorage) {
        const v = window.localStorage.getItem(key);
        return v == null ? dflt : JSON.parse(v);
      }
    } catch (e) {
      /* ignore */
    }
    return dflt;
  },
  set(key, val) {
    try {
      if (IS_BROWSER && window.localStorage) window.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* ignore */
    }
  },
};

/* 对象池（粒子/子弹等，避免 GC 抖动） */
export class Pool {
  constructor(factory, reset) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    this.used = [];
  }
  spawn() {
    const o = this.free.pop() || this.factory();
    if (this.reset) this.reset(o);
    o.dead = false;
    this.used.push(o);
    return o;
  }
  sweep() {
    for (let i = this.used.length - 1; i >= 0; i--) {
      if (this.used[i].dead) {
        const o = this.used.splice(i, 1)[0];
        if (this.used.length < 4096) this.free.push(o);
      }
    }
  }
  forEach(fn) {
    for (let i = 0; i < this.used.length; i++) {
      const o = this.used[i];
      if (!o.dead) fn(o, i);
    }
  }
  clear() {
    while (this.used.length) this.free.push(this.used.pop());
  }
  get count() {
    return this.used.length;
  }
}

export const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
