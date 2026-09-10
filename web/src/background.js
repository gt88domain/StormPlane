/**
 * background.js —— 黄昏沙漠俯瞰战场（程序化，分层视差滚动）
 *
 * 原版是 bg_01.jpg / bg_02.jpg 两张图纵向滚动（MainView.viewLogic 每逻辑帧 +10px）。
 * 这里保留同样的「向下滚动」节奏，但换成程序化矢量图层：
 *   沙丘脊线 / 风成波纹 / 岩层与残骸 / 干涸河床 / 要塞地基 / 坠机点
 *   + 云影层 + 沙尘层 + 闪电 + 暗角
 * 所有图元都按 tileH 做上下环绕绘制，因此无缝、且几乎不耗性能。
 */

import { makeCanvas, ctx2d, withAlpha, mix, hash01, fbm, TAU, rand, clamp } from './util.js';

const L = {
  sandTop: '#3a2a1c',
  sandMid: '#553a24',
  sandLit: '#7d5836',
  duneHi: '#c79a55',
  shadow: '#150f0c',
  rock: '#241a14',
  ruin: '#2b2620',
  ruinLit: '#6b5f4d',
  fire: '#ff8a3c',
  haze: '#2a1c14',
};

function paintGroundTile(W, H) {
  const c = makeCanvas(W, H);
  const g = ctx2d(c);
  // 底色
  const gr = g.createLinearGradient ? g.createLinearGradient(0, 0, W, H) : null;
  if (gr) {
    gr.addColorStop(0, '#4a3320');
    gr.addColorStop(0.5, '#3c2a1b');
    gr.addColorStop(1, '#2b1d13');
    g.fillStyle = gr;
  } else g.fillStyle = '#38281a';
  g.fillRect(0, 0, W, H);

  // 沙丘脊线：修长的顺风向沙脊（带上下环绕）
  const ridges = 34;
  for (let i = 0; i < ridges; i++) {
    const seed = i * 17;
    const y = hash01(seed, 1) * H;
    const x = hash01(seed, 2) * (W + 160) - 80;
    const w = 170 + hash01(seed, 3) * 260;
    const h = 9 + hash01(seed, 4) * 20;
    const tilt = -0.12 + hash01(seed, 5) * 0.24;
    for (const yy of [y - H, y, y + H]) {
      if (yy < -h * 3 || yy > H + h * 3) continue;
      g.save();
      g.translate(x, yy);
      g.rotate(tilt);
      // 单一体块的沙脊：上亮下暗 + 脊线高光（避免「花瓣」状的重影）
      g.beginPath();
      if (g.ellipse) g.ellipse(0, 0, w, h, 0, 0, TAU);
      else g.arc(0, 0, w, 0, TAU);
      const lg = g.createLinearGradient ? g.createLinearGradient(0, -h, 0, h) : null;
      if (lg) {
        lg.addColorStop(0, withAlpha(L.duneHi, 0.3));
        lg.addColorStop(0.42, withAlpha('#8a6033', 0.16));
        lg.addColorStop(0.62, withAlpha('#150d07', 0.3));
        lg.addColorStop(1, withAlpha('#150d07', 0.06));
        g.fillStyle = lg;
      } else g.fillStyle = withAlpha('#8a6033', 0.16);
      g.fill();
      // 脊线
      g.beginPath();
      g.moveTo(-w * 0.86, -h * 0.22);
      g.quadraticCurveTo(0, -h * 0.92, w * 0.86, -h * 0.18);
      g.lineWidth = 1.3;
      g.strokeStyle = withAlpha('#ffd9a0', 0.13);
      g.stroke();
      g.restore();
    }
  }

  // 风成波纹
  g.save();
  g.lineWidth = 0.8;
  for (let i = 0; i < 340; i++) {
    const x = hash01(i, 31) * W;
    const y = hash01(i, 37) * H;
    const len = 8 + hash01(i, 41) * 26;
    const a = -0.5 + hash01(i, 43) * 0.5;
    g.strokeStyle = hash01(i, 47) > 0.5 ? withAlpha('#ffcf90', 0.05) : withAlpha('#120c08', 0.13);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 3, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.restore();

  // 干涸河床（属于地形层，无重影问题）
  for (let i = 0; i < 3; i++) {
    const x0 = hash01(i, 51) * W;
    g.beginPath();
    g.moveTo(x0, -20);
    let x = x0;
    for (let y = 0; y < H + 40; y += 40) {
      x += (hash01(i, y) - 0.5) * 70;
      g.lineTo(x, y);
    }
    g.lineWidth = 14 + hash01(i, 55) * 22;
    g.strokeStyle = withAlpha('#26190f', 0.5);
    g.lineCap = 'round';
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = withAlpha('#c79a55', 0.05);
    g.stroke();
  }

  // 岩石与残骸
  for (let i = 0; i < 120; i++) {
    const x = hash01(i, 61) * W;
    const y = hash01(i, 67) * H;
    const r = 1.6 + hash01(i, 71) * 7;
    for (const yy of [y - H, y, y + H]) {
      if (yy < -20 || yy > H + 20) continue;
      g.beginPath();
      const n = 5 + ((hash01(i, 73) * 3) | 0);
      for (let k = 0; k <= n; k++) {
        const a = (k / n) * TAU;
        const rr = r * (0.65 + hash01(i * 13 + k, 7) * 0.7);
        const px = x + Math.cos(a) * rr;
        const py = yy + Math.sin(a) * rr * 0.8;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
      g.fillStyle = withAlpha('#1a1109', 0.75);
      g.fill();
      g.beginPath();
      g.arc(x - r * 0.25, yy - r * 0.3, r * 0.42, 0, TAU);
      g.fillStyle = withAlpha('#c79a55', 0.1);
      g.fill();
    }
  }

  // 顶部/底部压暗，制造纵深
  const vg = g.createLinearGradient ? g.createLinearGradient(0, 0, 0, H) : null;
  if (vg) {
    vg.addColorStop(0, withAlpha('#000000', 0.28));
    vg.addColorStop(0.5, withAlpha('#000000', 0));
    vg.addColorStop(1, withAlpha('#000000', 0.28));
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
  }
  return c;
}

function paintStructures(W, H) {
  // 要塞地基 / 坠机点：单独一层，只跟主地形层滚动，避免视差重影
  const c = makeCanvas(W, H);
  const g = ctx2d(c);
  g.clearRect(0, 0, W, H);
  // 要塞地基 / 坠机点（点缀，稀有）
  for (let i = 0; i < 5; i++) {
    const x = 40 + hash01(i, 81) * (W - 120);
    const y = hash01(i, 83) * H;
    const w = 60 + hash01(i, 87) * 70;
    const h = 44 + hash01(i, 89) * 46;
    for (const yy of [y - H, y, y + H]) {
      if (yy < -h - 30 || yy > H + h + 30) continue;
      g.save();
      g.translate(x, yy);
      g.rotate((hash01(i, 91) - 0.5) * 0.5);
      // 墙体投影
      g.fillStyle = withAlpha('#0d0906', 0.55);
      g.fillRect(-w / 2 + 5, -h / 2 + 6, w, h);
      g.fillStyle = withAlpha(L.ruin, 0.9);
      g.fillRect(-w / 2, -h / 2, w, h);
      g.strokeStyle = withAlpha(L.ruinLit, 0.35);
      g.lineWidth = 1.4;
      g.strokeRect(-w / 2, -h / 2, w, h);
      // 内部隔间
      g.strokeStyle = withAlpha('#000000', 0.5);
      g.lineWidth = 2;
      for (let k = 1; k < 3; k++) {
        g.beginPath();
        g.moveTo(-w / 2 + (w / 3) * k, -h / 2);
        g.lineTo(-w / 2 + (w / 3) * k, h / 2);
        g.stroke();
      }
      // 角楼
      for (const [cx, cy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
        g.beginPath();
        g.arc(cx, cy, 6, 0, TAU);
        g.fillStyle = withAlpha('#3a332a', 0.95);
        g.fill();
        g.strokeStyle = withAlpha('#c79a55', 0.25);
        g.lineWidth = 1;
        g.stroke();
      }
      // 探照灯余烬
      g.beginPath();
      g.arc(0, 0, 3, 0, TAU);
      g.fillStyle = withAlpha(L.fire, 0.35);
      g.fill();
      g.restore();
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = hash01(i, 101) * W;
    const y = hash01(i, 107) * H;
    const r = 16 + hash01(i, 109) * 26;
    for (const yy of [y - H, y, y + H]) {
      if (yy < -r || yy > H + r) continue;
      g.beginPath();
      g.arc(x, yy, r, 0, TAU);
      const rg = g.createRadialGradient ? g.createRadialGradient(x, yy, 0, x, yy, r) : null;
      if (rg) {
        rg.addColorStop(0, withAlpha('#0a0705', 0.75));
        rg.addColorStop(0.6, withAlpha('#2a1a10', 0.45));
        rg.addColorStop(1, withAlpha('#000000', 0));
        g.fillStyle = rg;
      } else g.fillStyle = withAlpha('#120c08', 0.5);
      g.fill();
      // 碎片
      for (let k = 0; k < 5; k++) {
        const a = hash01(i * 5 + k, 113) * TAU;
        const d = r * (0.4 + hash01(i, 127 + k) * 0.9);
        g.save();
        g.translate(x + Math.cos(a) * d, yy + Math.sin(a) * d);
        g.rotate(a * 2);
        g.fillStyle = withAlpha('#6d6051', 0.5);
        g.fillRect(-4, -1.4, 8, 2.8);
        g.restore();
      }
    }
  }

  return c;
}

function paintDust(W, H) {
  const c = makeCanvas(W, H);
  const g = ctx2d(c);
  g.clearRect(0, 0, W, H);
  for (let i = 0; i < 420; i++) {
    const x = hash01(i, 7) * W;
    const y = hash01(i, 11) * H;
    const len = 6 + hash01(i, 13) * 34;
    const a = 1.35 + (hash01(i, 17) - 0.5) * 0.5; // 大致向下
    const al = 0.05 + hash01(i, 19) * 0.3;
    g.strokeStyle = withAlpha(hash01(i, 23) > 0.75 ? '#ffe3b0' : '#c79a55', al);
    g.lineWidth = 0.6 + hash01(i, 29) * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len * 0.25, y + Math.sin(a) * len);
    g.stroke();
  }
  return c;
}

export class Background {
  constructor(W = 480, H = 800) {
    this.W = W;
    this.H = H;
    this.y1 = 0;
    this.y2 = 0;
    this.y3 = 0;
    this.t = 0;
    this.lightning = 0;
    this.lightningNext = 4000;
    this.bolt = null;
    this.build();
  }
  build() {
    this.ground = paintGroundTile(this.W, this.H);
    this.structures = paintStructures(this.W, this.H);
    this.dust = paintDust(this.W, this.H);
    // 云影（几个大柔光团，逐帧移动）
    this.clouds = [];
    for (let i = 0; i < 7; i++) {
      this.clouds.push({
        x: hash01(i, 201) * this.W,
        y: hash01(i, 211) * this.H,
        r: 120 + hash01(i, 221) * 220,
        v: 0.1 + hash01(i, 231) * 0.22,
        a: 0.1 + hash01(i, 241) * 0.16,
      });
    }
  }
  /** 原版：bg_y += 10（每逻辑帧），此处按 k 缩放 */
  update(dtms, speedTime) {
    const k = dtms / 100;
    this.t += dtms;
    this.y1 = (this.y1 + 10 * k * (0.55 + speedTime * 0.09)) % this.H;
    this.y2 = (this.y2 + 10 * k * (0.95 + speedTime * 0.1)) % this.H;
    this.y3 = (this.y3 + 10 * k * (2.1 + speedTime * 0.16)) % this.H;
    this.lightningNext -= dtms;
    if (this.lightningNext <= 0) {
      this.lightning = 1;
      this.lightningNext = 3500 + Math.random() * 9000;
      const cx = rand(60, this.W - 60);
      const pts = [[cx, -20]];
      let y = -20;
      while (y < this.H * 0.5) {
        y += 18 + Math.random() * 26;
        pts.push([pts[pts.length - 1][0] + (Math.random() - 0.5) * 60, y]);
      }
      this.bolt = { pts, born: this.t };
    }
    if (this.lightning > 0) this.lightning = Math.max(0, this.lightning - dtms / 420);
  }
  draw(g) {
    const { W, H } = this;
    // 底色（含暖色天光渗透）
    const bg = g.createLinearGradient ? g.createLinearGradient(0, 0, 0, H) : null;
    if (bg) {
      bg.addColorStop(0, '#241a14');
      bg.addColorStop(0.45, '#3a2718');
      bg.addColorStop(1, '#1d1510');
      g.fillStyle = bg;
    } else g.fillStyle = '#2b1f16';
    g.fillRect(0, 0, W, H);

    // 地面两层视差（环绕绘制）
    const drawTile = (tile, off, alpha) => {
      g.globalAlpha = alpha;
      g.drawImage(tile, 0, off - H);
      g.drawImage(tile, 0, off);
      g.globalAlpha = 1;
    };
    drawTile(this.ground, this.y1, 0.95);
    drawTile(this.ground, this.y2, 0.34);
    drawTile(this.structures, this.y1, 0.92);
    // 地平暖光：让俯瞰的沙漠不至于死黑
    const warm = g.createLinearGradient ? g.createLinearGradient(0, 0, 0, H * 0.5) : null;
    if (warm) {
      warm.addColorStop(0, withAlpha('#ffb060', 0.1));
      warm.addColorStop(1, withAlpha('#ffb060', 0));
      g.fillStyle = warm;
      g.fillRect(0, 0, W, H * 0.5);
    }

    // 云影
    g.save();
    for (const c of this.clouds) {
      const y = (c.y + this.y2 * c.v * 6) % (H + c.r * 2) - c.r;
      const rg = g.createRadialGradient ? g.createRadialGradient(c.x, y, 0, c.x, y, c.r) : null;
      if (rg) {
        rg.addColorStop(0, withAlpha('#000000', c.a));
        rg.addColorStop(1, withAlpha('#000000', 0));
        g.fillStyle = rg;
      } else g.fillStyle = withAlpha('#000000', c.a * 0.6);
      g.beginPath();
      g.arc(c.x, y, c.r, 0, TAU);
      g.fill();
    }
    g.restore();

    // 闪电
    if (this.lightning > 0.02 && this.bolt) {
      const a = this.lightning;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = withAlpha('#ffe9c0', 0.05 + a * 0.1);
      g.fillRect(0, 0, W, H);
      g.strokeStyle = withAlpha('#fff6d8', a * 0.9);
      g.lineWidth = 2.2;
      g.beginPath();
      this.bolt.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1] + this.y1) : g.moveTo(p[0], p[1] + this.y1)));
      g.stroke();
      g.lineWidth = 6;
      g.strokeStyle = withAlpha('#8fd8ff', a * 0.25);
      g.stroke();
      g.restore();
    }
  }
  /** 覆盖在地面之上的沙尘 + 暗角（在实体之后绘制） */
  drawOverlay(g, shakeMag = 0) {
    const { W, H } = this;
    const drawTile = (tile, off, alpha) => {
      g.globalAlpha = alpha;
      g.drawImage(tile, 0, off - H);
      g.drawImage(tile, 0, off);
      g.globalAlpha = 1;
    };
    drawTile(this.dust, this.y3, 0.3);

    // 暖色雾气
    const hz = g.createLinearGradient ? g.createLinearGradient(0, H * 0.55, 0, H) : null;
    if (hz) {
      hz.addColorStop(0, withAlpha('#e8a05a', 0.0));
      hz.addColorStop(1, withAlpha('#e8a05a', 0.07));
      g.fillStyle = hz;
      g.fillRect(0, H * 0.55, W, H * 0.45);
    }
    // 暗角
    const v = g.createRadialGradient ? g.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78) : null;
    if (v) {
      v.addColorStop(0, withAlpha('#000000', 0));
      v.addColorStop(1, withAlpha('#000000', 0.55 + Math.min(0.2, shakeMag * 0.01)));
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
    }
  }
}

export default Background;
