/**
 * render-check.mjs —— 离线渲染回归工具（开发用，不参与游戏运行）
 * 用法：node web/tools/render-check.mjs [输出目录]
 * 需要 @napi-rs/canvas（临时安装即可，未纳入项目依赖）。
 */
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadCanvas, OUT_DEFAULT } from './_boot.mjs';

const createCanvas = await loadCanvas();
const { loadImage } = await import('@napi-rs/canvas');
const outDir = process.argv[2] || OUT_DEFAULT;
mkdirSync(outDir, { recursive: true });

const src = path.resolve(import.meta.dirname, '../src');
const setCanvasFactory = (await import(path.join(src, 'util.js'))).setCanvasFactory;
setCanvasFactory((w, h) => createCanvas(Math.max(1, w | 0), Math.max(1, h | 0)));

const { buildArt, drawThruster } = await import(path.join(src, 'sprites.js'));
const art = buildArt(2);

const order = [
  'player100', 'player101', 'player102', 'small', 'middle', 'big', 'bigRage',
  'bulletBlue', 'bulletPurple', 'bulletRed', 'flake', 'bossFlame', 'bossSun', 'bossTri',
  'thunderG', 'thunderR', 'hellfireY', 'hellfireR',
  'goodsPurple', 'goodsRed', 'goodsMissile', 'goodsLife', 'shield',
];
const bosses = ['boss_normal', 'boss_anger', 'boss_crazy', 'boss_limit'];

// ---- 精灵总览图 ----
const cell = 230, pad = 12, cols = 6;
const rows = Math.ceil(order.length / cols);
const sheet = createCanvas(cols * cell + pad, rows * (cell + 26) + pad * 2 + 480);
const g = sheet.getContext('2d');
g.fillStyle = '#1a1410';
g.fillRect(0, 0, sheet.width, sheet.height);
g.font = '14px sans-serif';
let i = 0;
for (const key of order) {
  const s = art[key];
  const cx = (i % cols) * cell + pad;
  const cy = Math.floor(i / cols) * (cell + 26) + pad;
  // 棋盘底以检查透明边缘
  for (let y = 0; y < cell; y += 16) for (let x = 0; x < cell; x += 16) {
    g.fillStyle = ((x + y) / 16) % 2 ? '#221b16' : '#191411';
    g.fillRect(cx + x, cy + y, 16, 16);
  }
  const sc = Math.min((cell - 24) / s.w, (cell - 24) / s.h);
  g.drawImage(s.c, cx + cell / 2 - (s.w * sc) / 2, cy + cell / 2 - (s.h * sc) / 2, s.w * sc, s.h * sc);
  g.fillStyle = '#ffd08a';
  g.fillText(`${key}  ${s.w}x${s.h}  @${sc.toFixed(2)}x`, cx + 4, cy + cell + 16);
  i++;
}
// 机体大图（含推进器）+ boss 四状态
let y = rows * (cell + 26) + pad * 2;
g.fillStyle = '#0d1420';
g.fillRect(pad, y, sheet.width - pad * 2, 470);
const ship = art.player100;
g.drawImage(ship.c, pad + 40, y + 60, ship.w * 4, ship.h * 4);
drawThruster(g, pad + 40 + ship.w * 2, y + 60 + ship.h * 4, 18, 70, '#57e0ff', 400, 1);
g.fillStyle = '#9ec9ff';
g.fillText('player + thruster 4x', pad + 40, y + 30);
let bx = pad + 300;
for (const b of bosses) {
  const s = art[b];
  g.drawImage(s.c, bx, y + 20, s.w * 2, s.h * 2);
  g.fillStyle = '#9ec9ff';
  g.fillText(b, bx, y + 16);
  bx += s.w * 2 + 30;
}
await Promise.all([
  writeFile(path.join(outDir, 'sprites.png'), sheet.toBuffer('image/png')),
]);
console.log('sprites ->', path.join(outDir, 'sprites.png'));

// ---- 标题 attract / 战斗场景快照 ----
{
  const { Game } = await import(path.join(src, 'game.js'));
  const c = createCanvas(480, 800);
  const g = new Game(c, { audio: null, ss: 2, quality: 1 });
  g.resize(480, 800, 1);
  g.state = 'idle';
  for (let i = 0; i < 160; i++) { g.tick(16.7); g.render(); }
  await writeFile(path.join(outDir, 'title-attract.png'), c.toBuffer('image/png'));
  console.log('title-attract ->', path.join(outDir, 'title-attract.png'));
}

// ---- 背景层 ----
const bg = (await import(path.join(src, 'background.js')));
const bgc = createCanvas(480, 800);
bgc.getContext('2d');
await bg.buildBackground?.();
const bgView = createCanvas(480, 800);
const bgCtx = bgView.getContext('2d');
if (bg.Background) {
  const b = new bg.Background(480, 800);
  b.build?.();
  b.update?.(100, 1);
  b.draw?.(bgCtx, 0, 400);
  await writeFile(path.join(outDir, 'background.png'), bgView.toBuffer('image/png'));
  console.log('background ->', path.join(outDir, 'background.png'));
}
