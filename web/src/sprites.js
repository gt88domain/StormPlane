/**
 * sprites.js —— 「优化美术」层：全程序化矢量精灵
 *
 * 设计目标：
 *  1. 保留原版精灵的碰撞盒尺寸（SHEETS 中的 box / frames），仅升级画面表现；
 *  2. 所有贴图在启动时一次性烘焙到离屏画布（超采样），运行时只做 drawImage，
 *     因此比原版逐帧 clipRect+drawBitmap 的方案更省、也永远不会因缩放发糊；
 *  3. 统一美术语言：黄昏沙漠 + 军用装甲 + 霓虹能量体，
 *     机体由「装甲渐变 + 蒙皮刻线 + 高光边缘 + 发光条 + 指示灯」构成。
 */

import { makeCanvas, ctx2d, polyPath, roundRectPath, ellipsePath, starPath, withAlpha, mix, hash01, TAU, clamp } from './util.js';

export const SS = 2; // 烘焙超采样倍数

const P = {
  player: {
    100: { hull: '#233449', hull2: '#43648a', accent: '#57e0ff', trim: '#0e1a28', glass: '#bff3ff' }, // 蓝
    101: { hull: '#2e2247', hull2: '#5b3d8f', accent: '#c77bff', trim: '#160e26', glass: '#f0dcff' }, // 紫
    102: { hull: '#3c1f1f', hull2: '#8a3b32', accent: '#ff6a48', trim: '#1d0d0d', glass: '#ffe0cf' }, // 红
  },
  small: { hull: '#5a4632', hull2: '#8a6b47', accent: '#ffb347', trim: '#241a10', glass: '#ffe0a0' },
  middle: { hull: '#39424f', hull2: '#6b7889', accent: '#ff8a4d', trim: '#171c23', glass: '#ffd9b0' },
  big: { hull: '#33333a', hull2: '#5f6069', accent: '#ffb04d', trim: '#141419', glass: '#ffe9c0' },
  bigRage: { hull: '#43201c', hull2: '#8a4034', accent: '#ff5a3c', trim: '#1c0a08', glass: '#ffd0b0' },
  boss: {
    normal: { hull: '#26374f', hull2: '#4f7099', accent: '#6fd0ff', trim: '#101a26', glow: '#8ee6ff' },
    anger: { hull: '#4c3a1e', hull2: '#8f6f38', accent: '#ffb648', trim: '#211706', glow: '#ffd894' },
    crazy: { hull: '#54180f', hull2: '#9c3520', accent: '#ff5a35', trim: '#240804', glow: '#ffab7a' },
    limit: { hull: '#5c0d0d', hull2: '#b32a1e', accent: '#ff8a4d', trim: '#2b0404', glow: '#ffc48a' },
  },
};

/* ------------------------------------------------------------------ *
 * 通用绘制小工具
 * ------------------------------------------------------------------ */
function gradient(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  return gr;
}
function radial(g, cx, cy, r0, r1, stops) {
  const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  return gr;
}

/** 装甲多边形：底色渐变 + 顶部亮带 + 暗色描边 + 阳光侧边缘光 */
function armor(g, pts, pal, opts = {}) {
  const { rim = true, line = 1.1, soft = 0.18 } = opts;
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const [x, y] of pts) {
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  polyPath(g, pts);
  g.fillStyle = gradient(g, minX, minY, maxX, maxY, [
    [0, pal.hull2],
    [soft, mix(pal.hull2, pal.hull, 0.55)],
    [0.62, pal.hull],
    [1, mix(pal.hull, '#000000', 0.35)],
  ]);
  g.fill();
  g.lineWidth = line;
  g.strokeStyle = withAlpha(pal.trim, 0.95);
  g.stroke();
  if (rim) {
    // 内侧高光
    g.save();
    g.clip();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 2.2;
    g.strokeStyle = withAlpha(mix(pal.hull2, '#ffffff', 0.5), 0.35);
    polyPath(g, pts.map(([x, y]) => [x + 0.6, y + 1.2]));
    g.stroke();
    g.restore();
  }
}

/** 蒙皮刻线 + 铆钉，让平面装甲有细节 */
function panelLines(g, lines, pal, w = 0.6) {
  g.save();
  g.lineWidth = w;
  for (const seg of lines) {
    g.beginPath();
    g.moveTo(seg[0], seg[1]);
    if (seg.length > 4) g.quadraticCurveTo(seg[4], seg[5], seg[2], seg[3]);
    else g.lineTo(seg[2], seg[3]);
    g.strokeStyle = withAlpha(pal.trim, 0.5);
    g.stroke();
    g.beginPath();
    g.moveTo(seg[0], seg[1] + 0.8);
    if (seg.length > 4) g.quadraticCurveTo(seg[4], seg[5] + 0.8, seg[2], seg[3] + 0.8);
    else g.lineTo(seg[2], seg[3] + 0.8);
    g.strokeStyle = withAlpha('#ffffff', 0.06);
    g.stroke();
  }
  g.restore();
}

function rivets(g, pts, pal, r = 0.9) {
  for (const [x, y] of pts) {
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fillStyle = withAlpha('#ffffff', 0.16);
    g.fill();
    g.beginPath();
    g.arc(x, y + 0.4, r * 0.7, 0, TAU);
    g.fillStyle = withAlpha(pal.trim, 0.55);
    g.fill();
  }
}

/** 发光条：宽半透明 + 窄高亮，模拟 neon 光带 */
function neon(g, drawPath, color, w = 2, glow = 8) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = w * 3.2;
  g.strokeStyle = withAlpha(color, 0.1);
  drawPath();
  g.stroke();
  g.lineWidth = w * 1.9;
  g.strokeStyle = withAlpha(color, 0.25);
  g.stroke();
  g.lineWidth = w;
  g.strokeStyle = withAlpha(mix(color, '#ffffff', 0.55), 0.95);
  g.stroke();
  g.restore();
}

function blob(g, x, y, r, color, a = 0.5) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = radial(g, x, y, 0, r, [
    [0, withAlpha(color, a)],
    [0.45, withAlpha(color, a * 0.38)],
    [1, withAlpha(color, 0)],
  ]);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.restore();
}

function lamp(g, x, y, r, color, on = 1) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = withAlpha(mix(color, '#000000', 0.45 * (1 - on)), 1);
  g.fill();
  g.beginPath();
  g.arc(x - r * 0.25, y - r * 0.3, r * 0.45, 0, TAU);
  g.fillStyle = withAlpha(mix(color, '#ffffff', 0.7), 0.9 * on);
  g.fill();
  blob(g, x, y, r * 3.4, color, 0.28 * on);
}

/** 座舱玻璃 */
function canopy(g, x, y, rx, ry, pal) {
  g.save();
  ellipsePath(g, x, y, rx, ry);
  g.fillStyle = gradient(g, x - rx, y - ry, x + rx, y + ry, [
    [0, withAlpha(pal.glass, 0.95)],
    [0.5, withAlpha(mix(pal.accent, '#0b1a25', 0.4), 0.9)],
    [1, withAlpha('#08131c', 0.95)],
  ]);
  g.fill();
  g.lineWidth = 0.9;
  g.strokeStyle = withAlpha(mix(pal.accent, '#ffffff', 0.3), 0.75);
  g.stroke();
  // 反光
  g.globalCompositeOperation = 'lighter';
  g.beginPath();
  g.moveTo(x - rx * 0.55, y + ry * 0.25);
  g.lineTo(x - rx * 0.1, y - ry * 0.75);
  g.lineTo(x + rx * 0.15, y - ry * 0.6);
  g.lineTo(x - rx * 0.35, y + ry * 0.45);
  g.closePath();
  g.fillStyle = withAlpha('#ffffff', 0.3);
  g.fill();
  g.restore();
  blob(g, x, y, rx * 3, pal.accent, 0.16);
}

/** 推进喷口 */
function nozzle(g, x, y, w, h, pal, color = null) {
  const c = color || pal.accent;
  roundRectPath(g, x - w / 2, y, w, h, w * 0.3);
  g.fillStyle = gradient(g, x - w / 2, y, x + w / 2, y, [
    [0, mix(pal.hull, '#000000', 0.5)],
    [0.5, mix(pal.hull2, '#ffffff', 0.2)],
    [1, mix(pal.hull, '#000000', 0.55)],
  ]);
  g.fill();
  g.strokeStyle = withAlpha(pal.trim, 0.9);
  g.lineWidth = 0.7;
  g.stroke();
  roundRectPath(g, x - w * 0.3, y + h * 0.35, w * 0.6, h * 0.7, w * 0.2);
  g.fillStyle = withAlpha('#000000', 0.85);
  g.fill();
  blob(g, x, y + h, w * 1.1, c, 0.3);
}

function grain(g, w, h, n = 90, a = 0.05) {
  g.save();
  for (let i = 0; i < n; i++) {
    const x = hash01(i * 3 + 1, w) * w;
    const y = hash01(i * 7 + 5, h) * h;
    const s = 0.5 + hash01(i, 9) * 1.1;
    g.fillStyle = hash01(i, 21) > 0.5 ? withAlpha('#ffffff', a) : withAlpha('#000000', a * 2);
    g.fillRect(x, y, s, s);
  }
  g.restore();
}

function mk(w, h, draw, ss = SS) {
  const c = makeCanvas(w * ss, h * ss);
  const g = ctx2d(c);
  g.setTransform(ss, 0, 0, ss, 0, 0);
  draw(g, w, h);
  return { c, w, h, ss };
}

/* ------------------------------------------------------------------ *
 * 我方战机（三形态共用骨架，50x50 碰撞盒；机翼视觉外扩 8px 更霸气）
 * ------------------------------------------------------------------ */
function paintPlayer(g, pal) {
  const cx = 25;
  // 主翼
  armor(g, [[cx, 15], [46, 34], [42, 42], [cx, 33], [8, 42], [4, 34]], pal, { soft: 0.25 });
  // 前翼
  armor(g, [[cx, 8], [35, 18], [cx, 16], [15, 18]], pal, { soft: 0.1 });
  // 机身
  armor(g, [[cx, 1], [31, 14], [32, 34], [29, 45], [21, 45], [18, 34], [19, 14]], pal, { soft: 0.05 });
  // 垂尾
  armor(g, [[30, 33], [37, 47], [30, 45]], pal, { soft: 0.4, rim: false });
  armor(g, [[20, 33], [13, 47], [20, 45]], pal, { soft: 0.4, rim: false });

  panelLines(g, [
    [cx, 3, cx, 30],
    [22, 20, 12, 34],
    [28, 20, 38, 34],
    [4, 34, 12, 37, 8, 36],
    [46, 34, 38, 37, 42, 36],
  ], pal, 0.6);
  rivets(g, [[23, 30], [27, 30], [16, 38], [34, 38]], pal);

  // 机翼能量条
  neon(g, () => {
    g.beginPath();
    g.moveTo(6, 34.5);
    g.lineTo(cx - 3, 19);
    g.lineTo(cx + 3, 19);
    g.lineTo(44, 34.5);
  }, pal.accent, 1.5, 6);
  neon(g, () => {
    g.beginPath();
    g.moveTo(21, 43);
    g.lineTo(21, 36);
    g.moveTo(29, 43);
    g.lineTo(29, 36);
  }, pal.accent, 1.1);

  canopy(g, cx, 19, 4.4, 6.6, pal);
  nozzle(g, 22, 44, 4.6, 4.6, pal);
  nozzle(g, 28, 44, 4.6, 4.6, pal);

  // 机头灯
  lamp(g, cx, 5.5, 1.3, pal.accent, 1);
  grain(g, 50, 50, 70, 0.04);
}

/* ------------------------------------------------------------------ *
 * 小型机 40x41：沙尘掠行者，箭镞外形 + 双进气道
 * ------------------------------------------------------------------ */
function paintSmall(g, pal) {
  const cx = 20;
  armor(g, [[cx, 40], [36, 22], [34, 10], [cx, 16], [6, 10], [4, 22]], pal, { soft: 0.2 });
  armor(g, [[cx, 6], [27, 2], [30, 12], [cx, 15], [10, 12], [13, 2]], pal, { soft: 0.1 });
  panelLines(g, [[cx, 14, cx, 36], [8, 16, 14, 30], [32, 16, 26, 30]], pal, 0.6);
  neon(g, () => {
    g.beginPath();
    g.moveTo(9, 15);
    g.lineTo(cx, 33);
    g.lineTo(31, 15);
  }, pal.accent, 1.2);
  // 背部进气槽（含沙尘滤网）+ 双矢量喷口
  for (const x of [12, 28]) {
    roundRectPath(g, x - 3.4, 8, 6.8, 6.4, 2.2);
    g.fillStyle = withAlpha('#000000', 0.6);
    g.fill();
    g.lineWidth = 0.7;
    g.strokeStyle = withAlpha('#e8c48a', 0.25);
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(x - 3, 9.4 + i * 1.8);
      g.lineTo(x + 3, 9.4 + i * 1.8);
      g.stroke();
    }
    blob(g, x, 11, 6, '#e8c48a', 0.16);
  }
  nozzle(g, 12, 2, 6.4, 6, pal, '#ff8a3c');
  nozzle(g, 28, 2, 6.4, 6, pal, '#ff8a3c');
  canopy(g, cx, 24, 3.2, 4.2, { accent: pal.accent, glass: pal.glass });
  lamp(g, cx, 36.5, 1.4, '#ff5a3c', 1);
  grain(g, 40, 41, 60, 0.05);
}

/* ------------------------------------------------------------------ *
 * 中型机 65x86：俯冲突击机（机头朝下，后掠翼 + 双装机炮 + 顶部双发）
 * ------------------------------------------------------------------ */
function paintMiddle(g, pal) {
  const cx = 32.5;
  // 后掠主翼（向后/向上展开）
  armor(g, [[41, 50], [65, 16], [56, 6], [40, 26]], pal, { soft: 0.3 });
  armor(g, [[24, 50], [0, 16], [9, 6], [25, 26]], pal, { soft: 0.3 });
  // 机身（箭头形，尖端朝下）
  armor(g, [[cx, 85], [41, 60], [42, 20], [cx, 5], [23, 20], [24, 60]], pal, { soft: 0.06 });
  // 垂尾
  armor(g, [[41, 12], [48, 2], [44, 18]], pal, { soft: 0.3, rim: false });
  armor(g, [[24, 12], [17, 2], [21, 18]], pal, { soft: 0.3, rim: false });
  // 引擎短舱（尾部朝上喷）
  for (const x of [16, 49]) {
    roundRectPath(g, x - 5, 16, 10, 26, 4);
    g.fillStyle = gradient(g, x - 5, 16, x + 5, 42, [
      [0, mix(pal.hull2, '#ffffff', 0.2)],
      [0.5, pal.hull],
      [1, mix(pal.hull, '#000000', 0.5)],
    ]);
    g.fill();
    g.strokeStyle = withAlpha(pal.trim, 0.85);
    g.lineWidth = 0.9;
    g.stroke();
    nozzle(g, x, 8, 7.5, 8, pal);
  }
  // 机炮（沿机身两侧向下）
  for (const x of [22, 43]) {
    g.fillStyle = gradient(g, x - 2, 0, x + 2, 0, [[0, '#0f1319'], [0.5, '#8d98a8'], [1, '#0f1319']]);
    g.fillRect(x - 1.7, 34, 3.4, 34);
    g.fillStyle = withAlpha('#000000', 0.6);
    g.fillRect(x - 0.9, 34, 1.8, 32);
    blob(g, x, 68, 6, pal.accent, 0.3);
  }
  panelLines(g, [
    [cx, 10, cx, 78],
    [26, 40, 39, 40],
    [27, 52, 38, 52],
    [44, 22, 58, 14],
    [21, 22, 7, 14],
  ], pal, 0.7);
  // 装甲能量条（机头方向）
  neon(g, () => {
    g.beginPath();
    g.moveTo(26, 62);
    g.lineTo(cx, 80);
    g.lineTo(39, 62);
  }, pal.accent, 1.5);
  canopy(g, cx, 68, 4.2, 6, pal);
  lamp(g, 6, 16, 1.6, '#5cff9d', 1);
  lamp(g, 59, 16, 1.6, '#ff5a3c', 1);
  grain(g, 65, 86, 110, 0.05);
}

/* ------------------------------------------------------------------ *
 * 大型机 120x137：要塞炮艇（含普通/暴走两套装甲）
 * ------------------------------------------------------------------ */
function paintBig(g, pal, rage) {
  const cx = 60;
  // 侧舷浮舱（撑出宽阔轮廓，形成「肉墙」）
  armor(g, [[104, 54], [118, 68], [114, 96], [100, 90]], pal, { soft: 0.34 });
  armor(g, [[16, 54], [2, 68], [6, 96], [20, 90]], pal, { soft: 0.34 });
  // 主装甲甲板（八角重舰体，舰艏朝下）
  armor(g, [[cx, 133], [92, 116], [100, 76], [92, 30], [cx, 9], [28, 30], [20, 76], [28, 116]], pal, { soft: 0.16, line: 1.3 });
  // 上层甲板
  armor(g, [[cx, 118], [84, 106], [92, 76], [84, 48], [cx, 36], [36, 48], [28, 76], [36, 106]], pal, { soft: 0.05, line: 1.1 });
  // 舰桥
  armor(g, [[cx, 66], [74, 56], [70, 36], [cx, 28], [50, 36], [46, 56]], pal, { soft: 0.02 });
  // 引擎短舱（尾部朝上，四联喷）
  for (const x of [24, 46, 74, 96]) nozzle(g, x, 2, 13, 12, pal, rage ? '#ff6a3d' : pal.accent);

  // 三联装炮塔（朝下）
  for (const [tx, ty, spread] of [[26, 104, 0.3], [cx, 120, 0], [94, 104, -0.3]]) {
    g.save();
    g.translate(tx, ty);
    g.beginPath();
    g.arc(0, 0, 10, 0, TAU);
    g.fillStyle = gradient(g, -10, -10, 10, 10, [
      [0, mix(pal.hull2, '#ffffff', 0.28)],
      [1, mix(pal.hull, '#000000', 0.55)],
    ]);
    g.fill();
    g.strokeStyle = withAlpha(pal.trim, 0.92);
    g.lineWidth = 1.1;
    g.stroke();
    for (const off of [-spread, 0, spread]) {
      g.save();
      g.rotate(Math.PI / 2 + off);
      roundRectPath(g, 3, -2, 17, 4, 1.5);
      g.fillStyle = withAlpha('#0a0d11', 0.95);
      g.fill();
      g.fillStyle = withAlpha(mix(pal.hull2, '#ffffff', 0.45), 0.55);
      g.fillRect(3, -2, 17, 1);
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, 3.4, 0, TAU);
    g.fillStyle = withAlpha(rage ? '#ff4a2a' : pal.accent, 0.9);
    g.fill();
    g.restore();
    blob(g, tx, ty + 20, 9, rage ? '#ff4a2a' : pal.accent, 0.3);
  }

  panelLines(g, [
    [cx, 30, cx, 128],
    [36, 52, 84, 52],
    [30, 78, 90, 78],
    [34, 100, 86, 100],
    [104, 62, 118, 74],
    [16, 62, 2, 74],
  ], pal, 0.9);
  rivets(g, [[38, 60], [82, 60], [32, 86], [88, 86], [44, 112], [76, 112]], pal, 1.2);

  // 舰艏危险条纹
  g.save();
  polyPath(g, [[cx - 26, 122], [cx + 26, 122], [cx + 18, 133], [cx - 18, 133]]);
  g.clip();
  for (let i = -3; i < 14; i++) {
    g.fillStyle = i % 2 ? withAlpha(rage ? '#ff4a2a' : pal.accent, 0.55) : withAlpha('#0d0b09', 0.92);
    g.save();
    g.translate(cx - 30 + i * 5.4, 118);
    g.rotate(0.44);
    g.fillRect(0, 0, 4.2, 24);
    g.restore();
  }
  g.restore();
  neon(g, () => {
    g.beginPath();
    g.moveTo(cx - 26, 122);
    g.lineTo(cx + 26, 122);
  }, rage ? '#ff4a2a' : pal.accent, 1.5);

  // 雷达天线
  g.save();
  g.translate(cx, 46);
  g.beginPath();
  g.arc(0, 0, 9, Math.PI, TAU);
  g.strokeStyle = withAlpha(mix(pal.hull2, '#ffffff', 0.4), 0.8);
  g.lineWidth = 1.8;
  g.stroke();
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 7);
  g.stroke();
  lamp(g, 0, -7, 2, rage ? '#ff4a2a' : '#5cff9d', 1);
  g.restore();

  if (rage) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1.4;
    g.strokeStyle = withAlpha('#ff7a3c', 0.7);
    for (let i = 0; i < 12; i++) {
      const x0 = 26 + hash01(i, 3) * 68;
      const y0 = 34 + hash01(i, 7) * 84;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + (hash01(i, 11) - 0.5) * 20, y0 + (hash01(i, 13) - 0.5) * 22);
      g.lineTo(x0 + (hash01(i, 17) - 0.5) * 26, y0 + (hash01(i, 19) - 0.5) * 30);
      g.stroke();
    }
    g.restore();
  }
  canopy(g, cx, 58, 6, 5, pal);
  for (const x of [16, 104, 40, 80]) lamp(g, x, 92, 1.8, rage ? '#ff4a2a' : pal.accent, 1);
  grain(g, 120, 137, 260, 0.05);
}

/* ------------------------------------------------------------------ *
 * BOSS 200x200：四状态共用骨架 + 各自配色 / 装甲细节
 * ------------------------------------------------------------------ */
function paintBoss(g, pal, state) {
  const cx = 100;
  const accent = pal.accent;
  // 外层装甲裙
  armor(g, [[cx, 196], [150, 168], [178, 120], [168, 62], [cx, 22], [32, 62], [22, 120], [50, 168]], pal, { soft: 0.16, line: 1.4 });
  // 侧翼平台
  armor(g, [[198, 108], [168, 86], [168, 138], [190, 148]], pal, { soft: 0.3 });
  armor(g, [[2, 108], [32, 86], [32, 138], [10, 148]], pal, { soft: 0.3 });
  // 上层舰桥
  armor(g, [[cx, 40], [140, 74], [134, 126], [cx, 150], [66, 126], [60, 74]], pal, { soft: 0.05, line: 1.2 });

  panelLines(g, [
    [cx, 30, cx, 190],
    [66, 78, 134, 78],
    [60, 120, 140, 120],
    [36, 96, 20, 110],
    [164, 96, 180, 110],
    [52, 166, 148, 166],
  ], pal, 1);
  rivets(g, [[70, 84], [130, 84], [70, 132], [130, 132], [40, 150], [160, 150]], pal, 1.4);

  // 中央反应堆核心（受伤越重越亮，由运行时叠加辉光）
  const coreR = 26;
  const coreY = 104;
  // 约束环外壳
  g.save();
  g.beginPath();
  g.arc(cx, coreY, coreR + 9, 0, TAU);
  g.fillStyle = gradient(g, cx - 34, coreY - 34, cx + 34, coreY + 34, [
    [0, mix(pal.hull2, '#ffffff', 0.18)],
    [0.55, pal.hull],
    [1, mix(pal.hull, '#000000', 0.6)],
  ]);
  g.fill();
  g.lineWidth = 1.3;
  g.strokeStyle = withAlpha(pal.trim, 0.9);
  g.stroke();
  // 环上的约束爪
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    g.save();
    g.translate(cx + Math.cos(a) * (coreR + 6), coreY + Math.sin(a) * (coreR + 6));
    g.rotate(a);
    g.fillStyle = withAlpha(mix(pal.trim, '#ffffff', 0.25), 0.9);
    g.fillRect(-2.4, -4, 8, 8);
    g.restore();
  }
  g.restore();
  // 反应堆火焰
  g.save();
  g.beginPath();
  g.arc(cx, coreY, coreR, 0, TAU);
  g.fillStyle = radial(g, cx, coreY, 0, coreR, [
    [0, withAlpha('#ffffff', 0.98)],
    [0.32, withAlpha(mix(accent, '#ffffff', 0.5), 0.95)],
    [0.72, withAlpha(accent, 0.8)],
    [1, withAlpha(mix(accent, '#000000', 0.75), 0.95)],
  ]);
  g.fill();
  // 辐射叶片
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = withAlpha(mix(accent, '#ffffff', 0.7), 0.5);
  g.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 6, coreY + Math.sin(a) * 6);
    g.lineTo(cx + Math.cos(a + 0.5) * coreR, coreY + Math.sin(a + 0.5) * coreR);
    g.stroke();
  }
  g.restore();
  // 内圈刻度
  neon(g, () => {
    g.beginPath();
    g.arc(cx, coreY, coreR + 4, 0, TAU);
  }, accent, 1.6, 10);
  neon(g, () => {
    g.beginPath();
    g.arc(cx, coreY, coreR + 14, -0.6, 2.3);
    g.moveTo(cx + (coreR + 14) * Math.cos(3.0), coreY + (coreR + 14) * Math.sin(3.0));
    g.arc(cx, coreY, coreR + 14, 3.0, 5.3);
  }, mix(accent, '#ffffff', 0.35), 1.3, 10);
  blob(g, cx, coreY, 70, accent, state === 'limit' ? 0.42 : 0.24);

  // 四联装副炮
  for (const [tx, ty, dir] of [[36, 148, 1], [164, 148, -1], [24, 96, 1], [176, 96, -1]]) {
    g.save();
    g.translate(tx, ty);
    g.rotate(dir * 0.35);
    roundRectPath(g, -8, -8, 16, 26, 4);
    g.fillStyle = gradient(g, -8, -8, 8, 18, [
      [0, mix(pal.hull2, '#ffffff', 0.2)],
      [1, mix(pal.hull, '#000000', 0.55)],
    ]);
    g.fill();
    g.strokeStyle = withAlpha(pal.trim, 0.9);
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = withAlpha('#000000', 0.8);
    g.fillRect(-4.6, 6, 3.2, 12);
    g.fillRect(1.4, 6, 3.2, 12);
    blob(g, 0, 20, 8, accent, 0.3);
    g.restore();
  }

  // 装甲散热格栅（愤怒/疯狂状态下喷火）
  if (state !== 'normal') {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {
      const x = 60 + i * 8.2;
      const a = state === 'limit' ? 0.55 : 0.34;
      g.fillStyle = withAlpha(mix(accent, '#ffffff', 0.3), a);
      roundRectPath(g, x, 156, 4.4, 16, 2);
      g.fill();
      roundRectPath(g, x, 58, 4.4, 12, 2);
      g.fill();
    }
    g.restore();
  }
  if (state === 'crazy' || state === 'limit') {
    // 熔岩裂纹
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1.6;
    g.strokeStyle = withAlpha(mix(accent, '#fff2c0', 0.5), 0.6);
    for (let i = 0; i < 14; i++) {
      const x0 = 34 + hash01(i, 3) * 132;
      const y0 = 40 + hash01(i, 7) * 140;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + (hash01(i, 11) - 0.5) * 34, y0 + (hash01(i, 13) - 0.5) * 34);
      g.lineTo(x0 + (hash01(i, 17) - 0.5) * 44, y0 + (hash01(i, 19) - 0.5) * 46);
      g.stroke();
    }
    g.restore();
  }

  // 引擎舱（与舰体一体的舱段 + 三联喷口）
  g.save();
  roundRectPath(g, cx - 44, 8, 88, 26, 9);
  g.fillStyle = gradient(g, cx - 44, 8, cx + 44, 34, [
    [0, mix(pal.hull2, '#ffffff', 0.16)],
    [0.55, pal.hull],
    [1, mix(pal.hull, '#000000', 0.5)],
  ]);
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = withAlpha(pal.trim, 0.9);
  g.stroke();
  for (const x of [cx - 26, cx, cx + 26]) nozzle(g, x, 12, 17, 13, { hull: pal.hull, hull2: pal.hull2, trim: pal.trim, accent }, accent);
  g.restore();
  canopy(g, cx, 52, 12, 8, { accent, glass: pal.glow });
  for (const x of [56, 88, 112, 144]) lamp(g, x, 44, 2.4, accent, 1);
  grain(g, 200, 200, 520, 0.045);
}

/* ------------------------------------------------------------------ *
 * 子弹美术
 * ------------------------------------------------------------------ */
function paintBulletBlue(g) {
  // 20x63 激光粒子弹
  const cx = 10;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gr = gradient(g, 0, 0, 0, 63, [
    [0, withAlpha('#ffffff', 0.0)],
    [0.12, withAlpha('#8fe9ff', 0.85)],
    [0.5, withAlpha('#3fb9ff', 0.95)],
    [0.9, withAlpha('#1f6fff', 0.5)],
    [1, withAlpha('#1f6fff', 0)],
  ]);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(cx, 0);
  g.quadraticCurveTo(cx + 6, 16, cx + 4.4, 58);
  g.quadraticCurveTo(cx, 63, cx - 4.4, 58);
  g.quadraticCurveTo(cx - 6, 16, cx, 0);
  g.fill();
  // 高亮核心
  g.fillStyle = withAlpha('#ffffff', 0.95);
  g.beginPath();
  g.moveTo(cx, 3);
  g.quadraticCurveTo(cx + 2.6, 18, cx + 1.8, 52);
  g.quadraticCurveTo(cx, 56, cx - 1.8, 52);
  g.quadraticCurveTo(cx - 2.6, 18, cx, 3);
  g.fill();
  // 电场刻度
  g.strokeStyle = withAlpha('#cdf3ff', 0.5);
  g.lineWidth = 1;
  for (let y = 12; y < 58; y += 9) {
    g.beginPath();
    g.moveTo(cx - 5.5, y);
    g.lineTo(cx + 5.5, y);
    g.stroke();
  }
  g.restore();
  blob(g, cx, 30, 22, '#3fb9ff', 0.3);
}

function paintBulletPurple(g) {
  // 40x80 双螺旋粒子炮
  const cx = 20;
  g.save();
  g.globalCompositeOperation = 'lighter';
  // 拖尾
  const gr = gradient(g, 0, 0, 0, 80, [
    [0, withAlpha('#f0c8ff', 0.9)],
    [0.35, withAlpha('#b14cff', 0.7)],
    [1, withAlpha('#5a1a9c', 0)],
  ]);
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(cx - 5, 8);
  g.lineTo(cx + 5, 8);
  g.lineTo(cx + 2.5, 78);
  g.lineTo(cx - 2.5, 78);
  g.closePath();
  g.fill();
  // 两条螺旋丝带
  for (const side of [1, -1]) {
    g.beginPath();
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      const y = 10 + t * 68;
      const x = cx + side * (2 + 14 * (1 - t)) * Math.sin(t * 7.2);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.lineWidth = 2.6 - 0;
    g.strokeStyle = withAlpha(side > 0 ? '#e6b3ff' : '#9a4cff', 0.85);
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = withAlpha('#ffffff', 0.7);
    g.stroke();
  }
  // 弹头
  g.fillStyle = radial(g, cx, 8, 0, 10, [
    [0, '#ffffff'],
    [0.35, '#e6b3ff'],
    [1, withAlpha('#7a1fd0', 0)],
  ]);
  g.beginPath();
  g.arc(cx, 8, 9, 0, TAU);
  g.fill();
  g.restore();
  blob(g, cx, 10, 26, '#b14cff', 0.34);
}

function paintBulletRed(g) {
  // 64x64 追踪战斧冲击波：钢刃 + 灼热切割边
  const c = 32;
  blob(g, c, c, 30, '#ff4a2a', 0.4);
  g.save();
  g.translate(c, c);
  for (let i = 0; i < 3; i++) {
    g.save();
    g.rotate((i * TAU) / 3);
    g.beginPath();
    g.moveTo(1, -7);
    g.quadraticCurveTo(16, -15, 26, -3);
    g.quadraticCurveTo(20, 8, 1, 7);
    g.closePath();
    const gr = g.createLinearGradient ? g.createLinearGradient(0, -12, 24, 8) : null;
    if (gr) {
      gr.addColorStop(0, '#3a1512');
      gr.addColorStop(0.45, '#93a2b4');
      gr.addColorStop(0.8, '#e8f0f8');
      gr.addColorStop(1, '#ffd9a0');
      g.fillStyle = gr;
    } else g.fillStyle = '#b8c4d0';
    g.fill();
    g.lineWidth = 1.2;
    g.strokeStyle = withAlpha('#ff8a4d', 0.95);
    g.stroke();
    g.restore();
  }
  g.restore();
  // 中心毂
  g.save();
  g.beginPath();
  g.arc(c, c, 9.5, 0, TAU);
  const cr = g.createRadialGradient ? g.createRadialGradient(c - 3, c - 3, 0, c, c, 11) : null;
  if (cr) {
    cr.addColorStop(0, '#ffffff');
    cr.addColorStop(0.45, '#ff7a3c');
    cr.addColorStop(1, '#3a0f08');
    g.fillStyle = cr;
  } else g.fillStyle = '#ff7a3c';
  g.fill();
  g.lineWidth = 1.4;
  g.strokeStyle = withAlpha('#ffd9a0', 0.9);
  g.stroke();
  g.restore();
  neon(g, () => {
    g.beginPath();
    g.arc(c, c, 14, 0, TAU);
  }, '#ff5a2a', 1.1);
}

function paintBulletFlake(g) {
  // 48x44 大型机「烈焰飘雪」：敌弹统一用深猩红 + 暗色描边（威胁 = 红，收益 = 金）
  const cx = 24, cy = 22;
  blob(g, cx, cy, 21, '#ff2a3a', 0.42);
  g.save();
  starPath(g, cx, cy, 4, 21, 7, Math.PI / 4);
  g.fillStyle = gradient(g, cx - 16, cy - 16, cx + 16, cy + 16, [
    [0, '#5c0410'],
    [0.42, '#c81f28'],
    [1, '#ff6a5a'],
  ]);
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = withAlpha('#2a0208', 0.95);
  g.stroke();
  g.globalCompositeOperation = 'lighter';
  starPath(g, cx, cy, 4, 11, 3.6, Math.PI / 4);
  g.fillStyle = withAlpha('#ffd8cf', 0.92);
  g.fill();
  g.restore();
  // 火星
  for (let i = 0; i < 7; i++) {
    const a = hash01(i, 5) * TAU;
    const r = 10 + hash01(i, 9) * 12;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.7, 0.8 + hash01(i, 3), 0, TAU);
    g.fillStyle = withAlpha('#ff9a8a', 0.85);
    g.fill();
  }
}

function paintBulletFlame(g) {
  // 50x100 BOSS 火焰弹 / 火焰阵
  const cx = 25;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = gradient(g, 0, 0, 0, 100, [
    [0, withAlpha('#fff3c0', 0.95)],
    [0.3, withAlpha('#ffb03a', 0.9)],
    [0.62, withAlpha('#ff5a1d', 0.75)],
    [1, withAlpha('#7a1400', 0)],
  ]);
  g.beginPath();
  g.moveTo(cx, 100);
  g.quadraticCurveTo(cx + 22, 66, cx + 12, 30);
  g.quadraticCurveTo(cx + 6, 8, cx, 0);
  g.quadraticCurveTo(cx - 6, 8, cx - 12, 30);
  g.quadraticCurveTo(cx - 22, 66, cx, 100);
  g.fill();
  g.fillStyle = withAlpha('#fffbe8', 0.8);
  g.beginPath();
  g.moveTo(cx, 84);
  g.quadraticCurveTo(cx + 8, 52, cx + 4, 24);
  g.quadraticCurveTo(cx, 8, cx - 4, 24);
  g.quadraticCurveTo(cx - 8, 52, cx, 84);
  g.fill();
  g.restore();
  blob(g, cx, 40, 34, '#ff7a1d', 0.28);
}

function paintBulletSun(g) {
  // 40x40 闪光粒子球
  const c = 20;
  blob(g, c, c, 20, '#ffd54a', 0.45);
  g.save();
  g.globalCompositeOperation = 'lighter';
  starPath(g, c, c, 8, 19, 8, 0);
  g.fillStyle = withAlpha('#ffe98a', 0.5);
  g.fill();
  g.beginPath();
  g.arc(c, c, 10.5, 0, TAU);
  g.fillStyle = radial(g, c - 3, c - 3, 0, 12, [
    [0, '#ffffff'],
    [0.4, '#ffe98a'],
    [1, '#f0a020'],
  ]);
  g.fill();
  g.lineWidth = 1.2;
  g.strokeStyle = withAlpha('#fff8d0', 0.9);
  g.beginPath();
  g.arc(c, c, 13, 0.4, 2.6);
  g.stroke();
  g.restore();
}

function paintBulletTri(g) {
  // 35x35 悬浮三角颗粒
  const c = 17.5;
  blob(g, c, c, 17, '#c8e06a', 0.3);
  g.save();
  g.translate(c, c);
  g.beginPath();
  g.moveTo(0, -13);
  g.lineTo(12, 8);
  g.lineTo(-12, 8);
  g.closePath();
  g.fillStyle = gradient(g, -12, -13, 12, 8, [
    [0, '#f2ffc8'],
    [0.45, '#b6d24a'],
    [1, '#3d5210'],
  ]);
  g.fill();
  g.lineWidth = 1.3;
  g.strokeStyle = withAlpha('#eaffa8', 0.9);
  g.stroke();
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(5, 4);
  g.lineTo(-5, 4);
  g.closePath();
  g.fillStyle = withAlpha('#1d2a06', 0.65);
  g.fill();
  g.restore();
  // 悬浮底环
  neon(g, () => {
    g.beginPath();
    g.ellipse ? g.ellipse(c, c + 11, 10, 3, 0, 0, TAU) : (g.moveTo(c - 10, c + 11), g.arc(c, c + 11, 10, 0, TAU));
  }, '#c8e06a', 1.1);
}

function paintThunder(g, color) {
  // 48x44 双生闪电球
  const cx = 24, cy = 22;
  blob(g, cx, cy, 24, color, 0.45);
  g.save();
  g.beginPath();
  g.arc(cx, cy, 12, 0, TAU);
  g.fillStyle = radial(g, cx - 4, cy - 5, 0, 14, [
    [0, '#ffffff'],
    [0.35, mix(color, '#ffffff', 0.45)],
    [0.8, color],
    [1, mix(color, '#000000', 0.6)],
  ]);
  g.fill();
  g.restore();
  // 电弧
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineWidth = 1.3;
  g.strokeStyle = withAlpha(mix(color, '#ffffff', 0.65), 0.95);
  for (let i = 0; i < 5; i++) {
    const a0 = hash01(i, 31) * TAU;
    g.beginPath();
    let x = cx + Math.cos(a0) * 11;
    let y = cy + Math.sin(a0) * 11;
    g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      const a = a0 + (hash01(i, s + 40) - 0.5) * 1.6;
      const r = 14 + s * 4.5;
      x = cx + Math.cos(a) * r;
      y = cy + Math.sin(a) * r;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
  neon(g, () => {
    g.beginPath();
    g.arc(cx, cy, 16, 0, TAU);
  }, color, 1.1);
}

function paintHellfire(g, color, hot) {
  // 44x133 恶魔地狱火：弹头朝上，火尾向下拖曳
  const cx = 22;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const gr = g.createLinearGradient ? g.createLinearGradient(0, 133, 0, 0) : null;
  if (gr) {
    gr.addColorStop(0, withAlpha(mix(color, '#000000', 0.7), 0));
    gr.addColorStop(0.45, withAlpha(color, 0.5));
    gr.addColorStop(0.82, withAlpha(mix(color, '#ffffff', 0.45), 0.92));
    gr.addColorStop(1, withAlpha('#fffbe8', 0.1));
    g.fillStyle = gr;
  } else g.fillStyle = withAlpha(color, 0.8);
  g.beginPath();
  g.moveTo(cx, 2);
  g.bezierCurveTo(cx + 9, 26, cx + 20, 62, cx + 13, 112);
  g.quadraticCurveTo(cx, 132, cx - 13, 112);
  g.bezierCurveTo(cx - 20, 62, cx - 9, 26, cx, 2);
  g.fill();
  // 炽热内芯
  g.beginPath();
  g.moveTo(cx, 6);
  g.bezierCurveTo(cx + 5, 30, cx + 9, 64, cx + 5, 100);
  g.quadraticCurveTo(cx, 112, cx - 5, 100);
  g.bezierCurveTo(cx - 9, 64, cx - 5, 30, cx, 6);
  g.fillStyle = withAlpha(hot ? '#fffbe8' : '#ffe9b0', 0.85);
  g.fill();
  g.restore();
  blob(g, cx, 22, 24, color, 0.5);
  // 剥落的火星
  for (let i = 0; i < 9; i++) {
    const t = hash01(i, 3);
    g.beginPath();
    g.arc(cx + (hash01(i, 9) - 0.5) * 30, 118 - t * 96, 0.8 + t * 1.6, 0, TAU);
    g.fillStyle = withAlpha(mix(color, '#ffffff', 0.55), 0.85);
    g.fill();
  }
}

/* ------------------------------------------------------------------ *
 * 道具 / 特效贴图
 * ------------------------------------------------------------------ */
function paintGoods(g, kind) {
  const c = 25;
  const map = {
    purple: { col: '#b14cff', label: 'Ⅰ' },
    red: { col: '#ff4a2a', label: 'Ⅱ' },
    missile: { col: '#ffb03a', label: 'M' },
    life: { col: '#46e6a0', label: '+' },
  };
  const { col } = map[kind];
  blob(g, c, c, 25, col, 0.4);
  // 集装箱外壳
  roundRectPath(g, 5, 5, 40, 40, 8);
  g.fillStyle = gradient(g, 5, 5, 45, 45, [
    [0, '#dfe7f0'],
    [0.4, '#8b97a8'],
    [1, '#2b333d'],
  ]);
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = withAlpha(col, 0.95);
  g.stroke();
  roundRectPath(g, 9, 9, 32, 32, 6);
  g.fillStyle = withAlpha('#101821', 0.86);
  g.fill();
  g.save();
  g.globalCompositeOperation = 'lighter';
  // 内部图标
  if (kind === 'purple') {
    g.lineWidth = 2.4;
    g.strokeStyle = withAlpha('#e6b3ff', 0.95);
    for (const s of [1, -1]) {
      g.beginPath();
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const y = 14 + t * 22;
        const x = c + s * 8 * Math.sin(t * 6 + 1.2);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  } else if (kind === 'red') {
    g.save();
    g.translate(c, c);
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate((i * TAU) / 3);
      g.beginPath();
      g.moveTo(0, -3);
      g.quadraticCurveTo(8, -6, 11, 0);
      g.quadraticCurveTo(8, 6, 0, 3);
      g.closePath();
      g.fillStyle = withAlpha('#ffb08a', 0.95);
      g.fill();
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, 3.4, 0, TAU);
    g.fillStyle = '#fff4d8';
    g.fill();
    g.restore();
  } else if (kind === 'missile') {
    g.save();
    g.translate(c, c + 1);
    g.beginPath();
    g.moveTo(0, -12);
    g.quadraticCurveTo(6, -4, 5, 8);
    g.lineTo(-5, 8);
    g.quadraticCurveTo(-6, -4, 0, -12);
    g.closePath();
    g.fillStyle = withAlpha('#ffffff', 0.9);
    g.fill();
    g.fillStyle = withAlpha('#ffb03a', 0.95);
    g.beginPath();
    g.moveTo(-5, 8);
    g.lineTo(0, 14);
    g.lineTo(5, 8);
    g.closePath();
    g.fill();
    g.restore();
  } else {
    // 生命
    g.beginPath();
    g.moveTo(c, c + 9);
    g.bezierCurveTo(c - 13, c - 1, c - 6, c - 11, c, c - 4);
    g.bezierCurveTo(c + 6, c - 11, c + 13, c - 1, c, c + 9);
    g.fillStyle = withAlpha('#7dffc4', 0.95);
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = withAlpha('#ffffff', 0.8);
    g.stroke();
  }
  g.restore();
  // 边缘流转光
  neon(g, () => {
    roundRectPath(g, 5, 5, 40, 40, 8);
  }, col, 1.2);
}

function paintShield(g) {
  // 150x128 无敌防护盾
  const cx = 75, cy = 64;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = radial(g, cx, cy, 20, 74, [
    [0, withAlpha('#9fe8ff', 0.02)],
    [0.62, withAlpha('#4fbaff', 0.14)],
    [0.9, withAlpha('#9fe8ff', 0.32)],
    [1, withAlpha('#4fbaff', 0)],
  ]);
  g.beginPath();
  g.arc(cx, cy, 72, 0, TAU);
  g.fill();
  // 六边形网格
  g.strokeStyle = withAlpha('#a7ecff', 0.28);
  g.lineWidth = 1;
  for (let ring = 0; ring < 3; ring++) {
    const r = 26 + ring * 17;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + ring * 0.3;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.86);
      g.lineTo(cx + Math.cos(a + TAU / 6) * r, cy + Math.sin(a + TAU / 6) * r * 0.86);
      g.stroke();
    }
  }
  g.restore();
  neon(g, () => {
    g.beginPath();
    g.ellipse ? g.ellipse(cx, cy, 66, 58, 0, 0, TAU) : g.arc(cx, cy, 62, 0, TAU);
  }, '#8fe4ff', 2, 16);
  neon(g, () => {
    g.beginPath();
    g.ellipse ? g.ellipse(cx, cy, 52, 45, 0, 1.0, 4.6) : g.arc(cx, cy, 50, 1, 4.6);
  }, '#ffffff', 1.4);
}

function paintBoom(g) {
  // 304x304 导弹引爆（一次性贴图，运行时用缩放+透明度播放）
  const c = 152;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = radial(g, c, c, 0, c, [
    [0, withAlpha('#ffffff', 0.95)],
    [0.16, withAlpha('#ffe9a8', 0.85)],
    [0.34, withAlpha('#ff9d3c', 0.6)],
    [0.6, withAlpha('#ff4a1e', 0.28)],
    [0.85, withAlpha('#7a1400', 0.12)],
    [1, withAlpha('#000000', 0)],
  ]);
  g.beginPath();
  g.arc(c, c, c, 0, TAU);
  g.fill();
  // 冲击环
  for (const [r, a, w] of [[0.46, 0.75, 7], [0.62, 0.45, 12], [0.8, 0.22, 16]]) {
    g.beginPath();
    g.arc(c, c, c * r, 0, TAU);
    g.lineWidth = w;
    g.strokeStyle = withAlpha('#fff2c8', a);
    g.stroke();
  }
  // 放射火舌
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + hash01(i, 2) * 0.2;
    const len = c * (0.55 + hash01(i, 6) * 0.42);
    g.beginPath();
    g.moveTo(c + Math.cos(a) * c * 0.2, c + Math.sin(a) * c * 0.2);
    g.lineTo(c + Math.cos(a + 0.05) * len, c + Math.sin(a + 0.05) * len);
    g.lineTo(c + Math.cos(a - 0.05) * len, c + Math.sin(a - 0.05) * len);
    g.closePath();
    g.fillStyle = withAlpha(i % 3 ? '#ffb03a' : '#fff4d0', 0.22);
    g.fill();
  }
  g.restore();
}

/* ------------------------------------------------------------------ *
 * 构建全部贴图（启动时一次）
 * ------------------------------------------------------------------ */
let ART = null;

export function buildArt(ss = SS) {
  if (ART) return ART;
  const A = {};
  // 我方三形态
  for (const key of [100, 101, 102]) A['player' + key] = mk(50, 50, (g) => paintPlayer(g, P.player[key]), ss);
  A.small = mk(40, 41, (g) => paintSmall(g, P.small), ss);
  A.middle = mk(65, 86, (g) => paintMiddle(g, P.middle), ss);
  A.big = mk(120, 137, (g) => paintBig(g, P.big, false), ss);
  A.bigRage = mk(120, 137, (g) => paintBig(g, P.bigRage, true), ss);
  for (const st of ['normal', 'anger', 'crazy', 'limit']) {
    A['boss_' + st] = mk(200, 200, (g) => paintBoss(g, P.boss[st], st), ss);
  }
  A.bulletBlue = mk(20, 63, paintBulletBlue, ss);
  A.bulletPurple = mk(40, 80, paintBulletPurple, ss);
  A.bulletRed = mk(64, 64, paintBulletRed, ss);
  A.flake = mk(48, 44, paintBulletFlake, ss);
  A.bossFlame = mk(50, 100, paintBulletFlame, ss);
  A.bossSun = mk(40, 40, paintBulletSun, ss);
  A.bossTri = mk(35, 35, paintBulletTri, ss);
  A.thunderG = mk(48, 44, (g) => paintThunder(g, '#5cff8f'), ss);
  A.thunderR = mk(48, 44, (g) => paintThunder(g, '#ff4a3c'), ss);
  A.hellfireY = mk(44, 133, (g) => paintHellfire(g, '#ffd24a', true), ss);
  A.hellfireR = mk(44, 133, (g) => paintHellfire(g, '#ff3a1e', false), ss);
  A.goodsPurple = mk(50, 50, (g) => paintGoods(g, 'purple'), ss);
  A.goodsRed = mk(50, 50, (g) => paintGoods(g, 'red'), ss);
  A.goodsMissile = mk(50, 50, (g) => paintGoods(g, 'missile'), ss);
  A.goodsLife = mk(50, 50, (g) => paintGoods(g, 'life'), ss);
  A.shield = mk(150, 128, paintShield, ss);
  A.boom = mk(304, 304, paintBoom, Math.max(1, ss * 0.5));
  A.pal = P;
  ART = A;
  return A;
}

/* 运行时程序化效果（不吃烘焙，直接用矢量画） */
export function drawThruster(g, x, y, w, len, color, t, intensity = 1) {
  // 双层锥焰 + 激波环，纯运行时程序化绘制（无需烘焙贴图）
  g.save();
  g.globalCompositeOperation = 'lighter';
  const flick = 0.78 + Math.sin(t * 0.05) * 0.12 + Math.sin(t * 0.127) * 0.1;
  const L = len * flick * clamp(intensity, 0, 2);
  for (const ox of [-w / 2, w / 2]) {
    const gr = g.createRadialGradient ? g.createRadialGradient(x + ox, y, 0, x + ox, y, Math.max(2, L)) : null;
    if (gr) {
      gr.addColorStop(0, withAlpha('#ffffff', 0.95));
      gr.addColorStop(0.22, withAlpha(mix(color, '#ffffff', 0.6), 0.85));
      gr.addColorStop(0.55, withAlpha(color, 0.42));
      gr.addColorStop(1, withAlpha(color, 0));
      g.fillStyle = gr;
    } else g.fillStyle = withAlpha(color, 0.55);
    g.beginPath();
    g.moveTo(x + ox - w * 0.34, y);
    g.quadraticCurveTo(x + ox, y + L * 0.72, x + ox, y + L);
    g.quadraticCurveTo(x + ox, y + L * 0.72, x + ox + w * 0.34, y);
    g.closePath();
    g.fill();
    // 激波环
    g.beginPath();
    g.arc(x + ox, y + L * 0.34, w * 0.2, 0, TAU);
    g.fillStyle = withAlpha('#fff6d8', 0.32);
    g.fill();
  }
  g.restore();
}

export function drawEngineSmoke(g, x, y, w, color, t) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    const p = ((t * 0.004 + i / 3) % 1);
    const r = w * (0.4 + p * 1.4);
    g.globalAlpha = (1 - p) * 0.16;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y + p * 26, r, 0, TAU);
    g.fill();
  }
  g.restore();
}

export { P as PALETTES, blob, neon };
