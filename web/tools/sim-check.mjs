/**
 * sim-check.mjs —— 无浏览器环境下的整帧回归：跑模拟 + 出图，验证渲染管线与逻辑
 */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] || '/home/user/preview';
mkdirSync(out, { recursive: true });
const u = await import('/home/user/StormPlane/web/src/util.js');
u.setCanvasFactory((w, h) => createCanvas(Math.max(1, w | 0), Math.max(1, h | 0)));

const { Game } = await import('/home/user/StormPlane/web/src/game.js');
const canvas = createCanvas(480, 800);
const game = new Game(canvas, { audio: null, ss: 2, quality: 1 });
game.resize(480, 800, 1);
game.state = 'play';

function run(steps, hook) {
  for (let i = 0; i < steps; i++) {
    if (hook) hook(i, game);
    game.tick(100 / 6);
    game.render();
  }
}
const save = (n) => writeFileSync(`${out}/${n}`, canvas.toBuffer('image/png'));

// 1) 开局（小型机群）
run(90);
save('sim-1-start.png');

// 2) 强行推进：中型机 + 大型机 + 紫色弹夹 + 导弹
game.sumScore = game.middlePlaneScore = game.bigPlaneScore = game.bossPlaneScore = 9000;
game.speedTime = 3;
for (const e of game.world.enemies) e.speedTime = 3;
game.missileCount = 5;
game.world.player.setChangeBullet(true);
game.world.player.changeBullet(101);
game.world.player.startTime = game.world.t;
run(150);
save('sim-2-mid.png');

// 3) BOSS 出场（普通状态）+ 红弹
game.bossPlaneScore = 30000;
game.world.player.changeBullet(102);
run(160);
save('sim-3-boss.png');

// 4) BOSS 愤怒 / 疯狂 / 极限
for (const st of ['anger', 'crazy', 'limit']) {
  const blood = st === 'anger' ? 600 : st === 'crazy' ? 430 : 120;
  if (!game.boss.alive) game.boss.initial(game.speedTime), (game.boss.y = 40);
  game.boss.blood = blood;
  game.boss.checkState();
  run(120);
  save(`sim-4-boss-${st}.png`);
}

// 5) 导弹全屏引爆 + 玩家爆炸
game.useMissile();
run(3);
save('sim-5-missile.png');
game.world.player.onBoom();
game.mLifeAmount = 0;
run(30);
save('sim-6-death.png');

console.log('score', game.stats());
