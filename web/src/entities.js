/**
 * entities.js —— 游戏实体：我方战机 / 三类敌机 / BOSS / 子弹 / 道具
 *
 * 逐一对应 Java 原版：
 *   plane/MyPlane.java        → MyPlane
 *   plane/SmallPlane.java     → SmallPlane
 *   plane/MiddlePlane.java    → MiddlePlane
 *   plane/BigPlane.java       → BigPlane
 *   plane/BossPlane.java      → BossPlane
 *   bullet/*.java             → Bullet 子类
 *   object/*Goods.java        → Goods
 *
 * 时间基准：原版主循环 100ms / 逻辑帧，因此所有 speed、interval 都以
 * 「像素每逻辑帧」为单位；本文件统一乘以 k = dt / 100 推进，数值与原版一致。
 * 每处偏离原版代码写法的地方都标了 [修正] 或 [加强]。
 */

import { GameConstant as GC, ConstantUtil as CU, DebugConstant as DC, SPAWN_DEPTH_STEP } from './config.js';
import { clamp, approach, rand, randInt, aabb, sweptAabb, TAU, withAlpha, mix, smoothstep } from './util.js';
import { drawThruster } from './sprites.js';

let UID = 1;

/* ================================================================== *
 * 基类
 * ================================================================== */
export class Entity {
  constructor(world) {
    this.world = world;
    this.id = UID++;
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.speed = 0;
    this.alive = false;
    this.rot = 0;
    this.flash = 0;
  }
  get cx() {
    return this.x + this.w / 2;
  }
  get cy() {
    return this.y + this.h / 2;
  }
  get W() {
    return this.world.W;
  }
  get H() {
    return this.world.H;
  }
  get k() {
    return this.world.k;
  }
  get t() {
    return this.world.t;
  }
  drawArt(g, art, rot = 0, ox = 0, oy = 0, alpha = 1, glow = 0) {
    const w = this.w, h = this.h;
    g.save();
    g.globalAlpha = alpha;
    if (rot || ox || oy) {
      g.translate(this.x + w / 2 + ox, this.y + h / 2 + oy);
      if (rot) g.rotate(rot);
      g.drawImage(art.c, -w / 2, -h / 2, w, h);
    } else {
      g.drawImage(art.c, this.x + ox, this.y + oy, w, h);
    }
    if (glow > 0.01) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(glow, 0, 1) * 0.75;
      g.drawImage(art.c, this.x + ox - w * 0.05, this.y + oy - h * 0.05, w * 1.1, h * 1.1);
    }
    g.restore();
  }
}

/** 受击泛白（受伤瞬间提亮，用叠加再绘一次实现） */
function damageGlow(e) {
  return e.flash > 0 ? e.flash : 0;
}

/* ================================================================== *
 * 敌机基类
 * ================================================================== */
export class EnemyPlane extends Entity {
  constructor(world, kind) {
    super(world);
    this.kind = kind; // 'small' | 'middle' | 'big' | 'boss'
    this.blood = 1;
    this.bloodVolume = 1;
    this.score = 0;
    this.isExplosion = false;
    this.isVisible = false;
    this.explosionT = 0;
    this.speedTime = GC.GAMESPEED;
    this.hitFlashT = 0;
  }
  initial(speedTime, x, y) {
    this.speedTime = speedTime;
    this.alive = true;
    this.isExplosion = false;
    this.explosionT = 0;
    this.isVisible = false;
    this.rot = 0;
    this.flash = 0;
  }
  get canCollide() {
    return this.alive && !this.isExplosion && this.isVisible;
  }
  /** 与原版 EnemyPlane.logic() 一致：出屏即回收 */
  baseLogic() {
    if (this.y < this.H) this.y += this.speed * this.k;
    else this.alive = false;
    this.isVisible = this.y + this.h > 0;
  }
  attacked(harm) {
    if (this.isExplosion || !this.alive) return false;
    this.blood -= harm;
    this.hitFlashT = 90;
    if (this.blood <= 0) {
      this.blood = 0;
      this.isExplosion = true;
      this.explosionT = 0;
      this.onExplodeStart();
      return true;
    }
    return false;
  }
  onExplodeStart() {
    const fx = this.world.fx;
    const w = this.world;
    const cx = this.cx, cy = this.cy;
    const cfg = {
      small: { s: 0.75, tint: '#ffb85c', score: GC.SMALLPLANE_SCORE, snd: 'boomSmall' },
      middle: { s: 1.3, tint: '#ff9a3c', score: GC.MIDDLEPLANE_SCORE, snd: 'boomMid' },
      big: { s: 2.1, tint: '#ff6a2a', score: GC.BIGPLANE_SCORE, snd: 'boomBig' },
      boss: { s: 4.2, tint: '#ffd06a', score: GC.BOSSPLANE_SCORE, snd: 'boomBoss' },
    }[this.kind];
    fx.explode(cx, cy, cfg.s, cfg.tint, { ring: 100 * cfg.s, shake: this.kind === 'boss' ? 20 : 2 });
    if (this.kind === 'small') fx.debris(cx, cy, 6, '#9a8670');
    else fx.debris(cx, cy, 10 + cfg.s * 6, mix(this.kind === 'big' ? '#7d735a' : '#6b7889', '#c79a55', 0.3));
    w.game.addGameScore(cfg.score);
    w.audio.play(cfg.snd, this.kind === 'boss' ? 1 : 0.7);
    w.game.onKill(this);
  }
  /** 爆炸动画：原版是逐帧贴图，这里用粒子 + 残骸下坠 + 淡出（视觉更丰富） */
  explosionStep(dt) {
    this.explosionT += dt;
    const dur = this.kind === 'boss' ? 1400 : this.kind === 'big' ? 700 : this.kind === 'middle' ? 480 : 300;
    if (this.explosionT < dur) {
      this.y += this.speed * 0.35 * this.k;
      const fx = this.world.fx;
      const p = this.explosionT / dur;
      if (Math.random() < (this.kind === 'boss' ? 0.9 : 0.55) * (1 - p)) {
        fx.embers(
          this.cx + (Math.random() - 0.5) * this.w * (1 - p),
          this.cy + (Math.random() - 0.5) * this.h * (1 - p),
          this.kind === 'boss' ? 5 : 2,
          this.kind === 'boss' ? '#ffd06a' : '#ff9a3c',
          { speed: 1.6, ttl: 520, r: this.kind === 'boss' ? 6 : 3.4 }
        );
        if (this.kind === 'boss' || this.kind === 'big') {
          fx.smoke(this.cx, this.cy, 2, '#2f2620', { speed: 1.2, ttl: 900, r: 16 });
        }
      }
      if (this.kind === 'boss' && this.explosionT % 220 < 40) {
        fx.explode(this.cx + (Math.random() - 0.5) * this.w, this.cy + (Math.random() - 0.5) * this.h, 1.4, '#ffb347');
        this.world.audio.play('boomMid', 0.5);
      }
      this.flash = Math.max(0, 1 - p);
    } else {
      this.isExplosion = false;
      this.alive = false;
    }
  }
  drawHpBar(g) {
    if (this.bloodVolume <= 1 || this.isExplosion) return;
    const w = this.w * 0.7;
    const x = this.cx - w / 2;
    const y = this.y - 6;
    const f = clamp(this.blood / this.bloodVolume, 0, 1);
    if (f >= 0.999) return; // 满血不显示，减少画面噪音
    const col = f > 0.6 ? '#9dffc6' : f > 0.3 ? '#ffce6a' : '#ff6a4d';
    g.save();
    g.fillStyle = withAlpha('#0b0806', 0.7);
    g.fillRect(x - 1.5, y - 1.5, w + 3, 5);
    g.fillStyle = withAlpha(col, 0.95);
    g.fillRect(x, y, w * f, 2.4);
    g.fillStyle = withAlpha('#ffffff', 0.35);
    g.fillRect(x, y, w * f, 0.8);
    g.restore();
  }
}

/* ================================================================== *
 * 小型机（飘动移动）
 * ================================================================== */
export class SmallPlane extends EnemyPlane {
  constructor(world) {
    super(world, 'small');
    this.score = GC.SMALLPLANE_SCORE;
    this.art = world.art.small;
    this.w = this.art.w;
    this.h = this.art.h;
  }
  initial(speedTime) {
    super.initial(speedTime);
    this.bloodVolume = GC.SMALLPLANE_BLOOD;
    this.blood = this.bloodVolume;
    // 原版: speed = 6 * ran.nextInt(3) + 19
    this.speed = 6 * randInt(0, 2) + 19;
    this.x = rand(0, this.W - this.w);
    // 原版：按 currentCount 排队，制造纵深层叠的机群
    const c = this.world.takeSpawnSlot('small');
    this.y = -this.h * (c * SPAWN_DEPTH_STEP + 1);
    this.baseY = this.y;
    this.sway = rand(0, TAU);
  }
  logic() {
    const k = this.k;
    if (this.y < this.H) {
      this.y += this.speed * k;
      // 原版: object_x += 20 * speedTime * sin(object_y)
      this.x += 20 * this.speedTime * Math.sin(this.y * 0.12 + this.sway) * k * 0.35;
      this.x = clamp(this.x, -this.w * 0.3, this.W - this.w * 0.7);
      this.rot = clamp(Math.sin(this.y * 0.12 + this.sway) * 0.25, -0.3, 0.3);
    } else this.alive = false;
    this.isVisible = this.y + this.h > 0;
  }
  draw(g) {
    if (!this.alive) return;
    if (this.isExplosion) {
      this.drawArt(g, this.art, this.rot, 0, 0, 0.35, 1);
      return;
    }
    if (!this.isVisible) return;
    this.flash = damageGlow(this);
    // 敌方掠沙机：尾部扬尘
    drawThruster(g, this.cx, this.y + 2, this.w * 0.34, 12, '#e8c48a', this.t + this.id * 30, 0.55);
    this.drawArt(g, this.art, this.rot, 0, 0, 1, this.flash);
  }
}

/* ================================================================== *
 * 中型机（悬停减速 → 俯冲撞击）
 * ================================================================== */
export class MiddlePlane extends EnemyPlane {
  constructor(world) {
    super(world, 'middle');
    this.score = GC.MIDDLEPLANE_SCORE;
    this.art = world.art.middle;
    this.w = this.art.w;
    this.h = this.art.h;
    this.dive = 0;
  }
  initial(speedTime) {
    super.initial(speedTime);
    this.bloodVolume = GC.MIDDLEPLANE_BLOOD;
    this.blood = this.bloodVolume;
    this.speed = 19; // 原版初速
    this.x = rand(0, this.W - this.w);
    const c = this.world.takeSpawnSlot('middle');
    this.y = -this.h * (c * SPAWN_DEPTH_STEP + 1);
    this.dive = 0;
  }
  logic() {
    const k = this.k;
    if (this.y < this.H) {
      // 原版：每帧 speed -= 1，减速到 0 后重新加速（speedTime>=3 时直接俯冲）
      this.speed -= 1 * k;
      this.y += this.speed * k;
      if (this.speed <= 0) {
        if (this.speedTime >= 3) this.speed = 20 * this.speedTime;
        else this.speed = randInt(0, 39);
        if (this.speed > 20) {
          this.dive = 1;
          this.world.fx.popText(this.cx, this.y, '俯冲!', '#ff8a5c', 13, -0.4, 700);
          this.world.audio.play('diveWarn', 0.35);
        }
      }
      if (this.dive > 0) {
        this.world.fx.streak(this.cx, this.y + 6, 26, '#ff7a3c', 200, this.speed * 0.6);
        if (Math.random() < 0.4) this.world.fx.smoke(this.cx, this.y + 8, 1, '#6a5a4a', { speed: 0.5, ttl: 420, r: 7 });
      }
    } else this.alive = false;
    this.isVisible = this.y + this.h > 0;
  }
  draw(g) {
    if (!this.alive) return;
    if (this.isExplosion) {
      this.drawArt(g, this.art, 0, 0, 0, 0.4, 1);
      this.drawHpBar(g);
      return;
    }
    if (!this.isVisible) return;
    this.flash = damageGlow(this);
    const boost = clamp(this.speed / 24, 0.2, 4);
    drawThruster(g, this.cx - 16, this.y + 12, 12, 20 * boost, '#ff8a3c', this.t + this.id * 20, 0.8);
    drawThruster(g, this.cx + 16, this.y + 12, 12, 20 * boost, '#ff8a3c', this.t + this.id * 20 + 90, 0.8);
    this.drawArt(g, this.art, 0, 0, 0, 1, this.flash * 0.9);
    this.drawHpBar(g);
    // [加强] 俯冲预警：机头下方红色锁定环
    if (this.dive > 0) {
      const p = (this.t % 420) / 420;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = withAlpha('#ff3a1e', 0.75 * (1 - p));
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.cx, this.y + this.h + 10, 10 + p * 14, 0, TAU);
      g.stroke();
      g.restore();
    }
  }
}

/* ================================================================== *
 * 大型机（成群推进 + 烈焰飘雪弹；4 级起变身红色暴走）
 * ================================================================== */
export class BigPlane extends EnemyPlane {
  constructor(world) {
    super(world, 'big');
    this.score = GC.BIGPLANE_SCORE;
    this.interval = 1; // 原版射击间隔计数
    this.isFire = false;
    // 原版弹夹 3 发
    this.bullets = [];
    for (let i = 0; i < 3; i++) this.bullets.push(new BigPlaneBullet(world));
  }
  get art() {
    return this.speedTime > 3 ? this.world.art.bigRage : this.world.art.big;
  }
  get artW() {
    return this.world.art.big.w;
  }
  get artH() {
    return this.world.art.big.h;
  }
  initial(speedTime) {
    super.initial(speedTime);
    this.w = this.artW;
    this.h = this.artH;
    this.speed = GC.BIGPLANE_SPEED;
    this.bloodVolume = GC.BIGPLANE_BLOOD;
    this.blood = this.bloodVolume;
    this.isFire = false;
    this.interval = 1;
    this.x = rand(0, this.W - this.w);
    this.y = -this.h;
    for (const b of this.bullets) b.alive = false;
  }
  /** 原版 BigPlane.initBullet() */
  initBullet() {
    if (!this.isFire) return;
    if (this.interval <= 1) {
      if (!this.world.missileState) {
        for (const b of this.bullets) {
          if (!b.alive) {
            b.initial(this.cx, this.y + (this.h * 2) / 3);
            this.world.audio.play('enemyShoot', 0.25);
            break;
          }
        }
      }
      this.interval = 1 + 1e-6;
    }
    this.interval += this.k;
    // 原版: if (interval >= 72 / speedTime) interval = 1
    if (this.interval >= 72 / Math.max(1, this.speedTime)) this.interval = 1;
  }
  logic() {
    const k = this.k;
    if (!this.isFire) this.isFire = true;
    if (this.y < this.H) {
      if (this.speedTime < 4) {
        this.y += this.speed * k;
        this.x += Math.tan(this.y) * k; // 原版
      } else {
        this.speed = 11; // 原版：4 级起提速并反向摆动
        this.y += this.speed * k;
        this.x -= Math.tan(this.y) * k;
      }
      this.x = clamp(this.x, -this.w * 0.12, this.W - this.w * 0.88);
    } else this.alive = false;
    this.isVisible = this.y + this.h > 0;
    this.initBullet();
    for (const b of this.bullets) if (b.alive) b.logic();
  }
  draw(g) {
    if (!this.alive) return;
    const art = this.art;
    if (this.isExplosion) {
      this.drawArt(g, art, 0, 0, 0, 0.5, 1);
      this.drawHpBar(g);
      return;
    }
    if (!this.isVisible) return;
    this.flash = damageGlow(this);
    const rage = this.speedTime > 3;
    const boost = rage ? 1.6 : 0.9;
    for (const ox of [-36, -14, 14, 36]) {
      drawThruster(g, this.cx + ox, this.y + 12, 11, 26 * boost, rage ? '#ff5a2a' : '#ffb03a', this.t + this.id * 11 + ox, 0.85);
    }
    this.drawArt(g, art, 0, 0, 0, 1, this.flash);
    this.drawHpBar(g);
    for (const b of this.bullets) if (b.alive) b.draw(g);
  }
}

/* ================================================================== *
 * 子弹
 * ================================================================== */
export class Bullet extends Entity {
  constructor(world, kind) {
    super(world);
    this.kind = kind;
    this.harm = 1;
    this.owner = 'my'; // 'my' | 'enemy'
    this.life = 0;
  }
  out() {
    return this.y < -this.h - 40 || this.y > this.H + 40 || this.x < -this.w - 60 || this.x > this.W + 60;
  }
  /** [加强] 扫掠检测，修正原版高速子弹穿模（Bullet.isCollide 的矩形判定） */
  hits(e) {
    return sweptAabb(this.x, this.y, this.w, this.h, this.dx || 0, this.dy || 0, e.x, e.y, e.w, e.h);
  }
}

/** 蓝色激光粒子弹（原版：4 发弹夹，speed 80，直线） */
export class MyBlueBullet extends Bullet {
  constructor(world) {
    super(world, 'blue');
    this.harm = GC.MYBULLET_HARM;
    const a = world.art.bulletBlue;
    this.w = a.w;
    this.h = a.h;
  }
  initial(x, y) {
    this.alive = true;
    this.speed = GC.MYBULLET_SPEED;
    this.x = x - this.w / 2;
    this.y = y - this.h;
    this.dx = 0;
    this.dy = -this.speed;
    this.life = 0;
  }
  logic() {
    this.dy = -this.speed * this.k;
    this.y += this.dy;
    if (this.y + this.h < 0) this.alive = false;
  }
  draw(g) {
    this.drawArt(g, this.world.art.bulletBlue, 0);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5;
    g.drawImage(this.world.art.bulletBlue.c, this.x + this.w * 0.14, this.y + 4, this.w * 0.72, this.h * 0.9);
    g.restore();
  }
}

/** 紫色双螺旋粒子炮（原版：6 发弹夹，每发含左右两枚，speed 100，横向 30*sin(y)） */
export class MyPurpleBullet extends Bullet {
  constructor(world) {
    super(world, 'purple');
    this.harm = GC.MYBULLET1_HARM;
    const a = world.art.bulletPurple;
    this.w = a.w;
    this.h = a.h;
    this.x2 = 0;
    this.y2 = 0;
    this.alive2 = false;
  }
  initial(x, y) {
    this.alive = true;
    this.alive2 = true;
    this.speed = GC.MYBULLET1_SPEED;
    // 原版: object_x = arg1 - 2*w ; object_x2 = arg1 + w
    this.x = x - 2 * this.w;
    this.y = y - this.h;
    this.x2 = x + this.w;
    this.y2 = this.y;
    this.life = 0;
  }
  logic() {
    const k = this.k;
    const move = -this.speed * k;
    this.dy = move;
    if (this.y + this.h >= 0) {
      this.dx = 30 * Math.sin(this.y * 0.05) * k;
      this.y += move;
      this.x += this.dx;
    } else this.alive = false;
    if (this.y2 + this.h >= 0) {
      this.dx2 = -30 * Math.sin(this.y2 * 0.3) * k;
      this.y2 += move;
      this.x2 += this.dx2;
    } else this.alive2 = false;
    if (!this.alive && !this.alive2) this.alive = false;
  }
  get isAlive() {
    return this.alive || this.alive2;
  }
  hits(e) {
    const a = this.alive && sweptAabb(this.x, this.y, this.w, this.h, this.dx, this.dy, e.x, e.y, e.w, e.h);
    const b = this.alive2 && sweptAabb(this.x2, this.y2, this.w, this.h, this.dx2, this.dy, e.x, e.y, e.w, e.h);
    if (a) this.alive = false;
    if (b) this.alive2 = false;
    // [修正] 原版在两枚都命中时把 harm 降为 2（反而变弱），这里改为双发叠加
    if (a && b) this.hitCount = 2;
    else this.hitCount = 1;
    return a || b;
  }
  draw(g) {
    const art = this.world.art.bulletPurple;
    // [加强] 判定盒沿用原版 40x80，视觉尺寸收紧，避免满屏光污染看不清战场
    const f = 0.7;
    const dw = art.w * f;
    const dh = art.h * f;
    for (const [bx, by, live] of [[this.x, this.y, this.alive], [this.x2, this.y2, this.alive2]]) {
      if (!live) continue;
      const ox = bx + (this.w - dw) / 2;
      const oy = by + (this.h - dh) / 2;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.3;
      g.drawImage(art.c, ox - 3, oy + 4, dw + 6, dh);
      g.restore();
      g.drawImage(art.c, ox, oy, dw, dh);
    }
  }
}

/** 红色追踪战斧（原版：4 发弹夹，speed 120，横向乱摆；[修正] 改为真正的全屏追踪） */
export class MyRedBullet extends Bullet {
  constructor(world) {
    super(world, 'red');
    this.harm = GC.MYBULLET2_HARM;
    const a = world.art.bulletRed;
    this.w = a.w;
    this.h = a.h;
    this.spin = 0;
    this.vx = 0;
  }
  initial(x, y) {
    this.alive = true;
    this.speed = GC.MYBULLET2_SPEED;
    this.x = x - this.w / 2;
    this.y = y - this.h;
    this.vx = rand(-1.4, 1.4);
    this.spin = rand(0, TAU);
    this.life = 0;
  }
  logic() {
    const k = this.k;
    // [修正/加强] 原版 object_x += 100*sin(currentTimeMillis()) 只是抖动，
    // README 描述的却是「全屏追击」；这里实现真正的最近目标追踪，速度上限不变。
    const tgt = this.world.nearestEnemy(this.cx, this.cy, 260);
    let ax = 0;
    if (tgt) {
      const dx = tgt.cx - this.cx;
      ax = clamp(dx / 90, -1, 1) * 3.2;
    } else {
      ax = 1.6 * Math.sin(this.t * 0.02 + this.id); // 无目标时保留原版蛇形
    }
    this.vx = clamp(this.vx + ax * k, -this.speed * 0.85, this.speed * 0.85);
    this.dx = this.vx * k;
    this.dy = -this.speed * k;
    this.x += this.dx;
    this.y += this.dy;
    this.spin += 0.5 * k;
    if (this.x < 0) {
      this.x = 0;
      this.vx = Math.abs(this.vx) * 0.7;
    }
    if (this.x + this.w > this.W) {
      this.x = this.W - this.w;
      this.vx = -Math.abs(this.vx) * 0.7;
    }
    if (this.y + this.h < 0) this.alive = false;
    if (Math.random() < 0.3) this.world.fx.trail(this.cx, this.cy, 5, '#ff6a3c', 200);
  }
  draw(g) {
    const art = this.world.art.bulletRed;
    g.save();
    g.translate(this.cx, this.cy);
    g.rotate(this.spin);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.6;
    const f = 0.8;
    g.globalAlpha = 0.4;
    g.drawImage(art.c, -art.w * f * 0.7, -art.h * f * 0.7, art.w * f * 1.4, art.h * f * 1.4);
    g.globalAlpha = 1;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(art.c, (-art.w * f) / 2, (-art.h * f) / 2, art.w * f, art.h * f);
    g.restore();
  }
}

/** 大型机「烈焰飘雪」弹（原版 speed 50，整体 x += 30*sin(now/1000)） */
export class BigPlaneBullet extends Bullet {
  constructor(world) {
    super(world, 'flake');
    this.owner = 'enemy';
    this.harm = 1; // EnemyBullet: harm = 1
    const a = world.art.flake;
    this.w = a.w;
    this.h = a.h;
  }
  initial(x, y) {
    this.alive = true;
    this.speed = 50; // 原版 BigPlaneBullet speed
    this.x = x - this.w / 2;
    this.y = y - this.h;
    this.phase = rand(0, TAU);
    this.life = 0;
  }
  logic() {
    const k = this.k;
    this.dy = this.speed * k;
    // 原版用全局时间，导致所有弹同相位；[加强] 加入每发相位差，飘雪更自然
    this.dx = 30 * Math.cos(this.t * 0.0016 + this.phase) * k;
    this.y += this.dy;
    this.x += this.dx;
    if (this.y > this.H + this.h) this.alive = false;
    if (Math.random() < 0.4) this.world.fx.trail(this.cx, this.cy - 4, 5.5, '#ff3a2a', 240);
  }
  draw(g) {
    const art = this.world.art.flake;
    g.save();
    g.translate(this.cx, this.cy);
    g.rotate(Math.sin(this.t * 0.004 + this.phase) * 0.5);
    g.drawImage(art.c, -art.w / 2, -art.h / 2, art.w, art.h);
    g.restore();
  }
}

/**
 * BOSS 弹幕通用类：一个 spec 描述一种弹道（速度取原版随机区间）
 * 原版各弹种逻辑：
 *   BossFlame     speed=20+rand(20)   向下
 *   BossSun       speed= 5+rand(5)    向上 + 80*sin(now/1000)
 *   BossTriangle  speed=10+rand(5)    向上 + 3*tan(now)
 *   BossThunder   speed= 5+rand(8)    向上 + 20*sin(y)
 *   BossHellfireY speed= 5+rand(5)    向上 + tan(now/1000)
 *   BossHellfireR speed= 5+rand(10)   向上 + 8*tan(y)
 *   BossDefault   speed=10            左右各一发 + 10*sin(y)
 *   [加强] 当 BOSS 位于屏幕上半部时，所有「向上」弹道改为朝我方战机方向飞行，
 *          弹速与摆幅保持原值，只是发射朝向修正 —— 避免原版疯狂/极限状态下打不到人。
 */
export class BossBullet extends Bullet {
  constructor(world, spec) {
    super(world, spec.id);
    this.owner = 'enemy';
    this.spec = spec;
    this.harm = 1;
    const a = world.art[spec.art];
    this.w = a.w;
    this.h = a.h;
  }
  static fire(world, spec, x, y, angleHint) {
    const b = new BossBullet(world, spec);
    b.spawn(x, y, angleHint);
    return b;
  }
  spawn(x, y, angleHint) {
    const s = this.spec;
    this.alive = true;
    this.speed = s.speed();
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.angle = angleHint != null ? angleHint : s.angle;
    const v = this.speed;
    this.vx = Math.cos(this.angle) * v;
    this.vy = Math.sin(this.angle) * v;
    this.phase = rand(0, TAU);
    this.life = 0;
    this.spin = 0;
    this.world.bullets.push(this);
  }
  logic() {
    const k = this.k;
    const s = this.spec;
    let vx = this.vx,
      vy = this.vy;
    // 沿弹道法线方向施加原版摆动量
    const nx = -vy,
      ny = vx;
    const nl = Math.hypot(nx, ny) || 1;
    let sway = 0;
    switch (s.sway) {
      case 'sinY':
        sway = s.amp * Math.sin(this.y * 0.05 + this.phase);
        break;
      case 'sinT':
        sway = s.amp * Math.sin(this.t * 0.0016 + this.phase);
        break;
      case 'tanT':
        sway = s.amp * Math.tan(this.t * 0.001 + this.phase);
        break;
      case 'tanY':
        sway = s.amp * Math.tan(this.y * 0.05 + this.phase);
        break;
      case 'rise':
        sway = s.amp * Math.sin(this.t * 0.003 + this.phase);
        break;
      default:
        sway = 0;
    }
    sway = clamp(sway, -60, 60);
    this.dx = (vx + (nx / nl) * sway * 0.06) * k;
    this.dy = (vy + (ny / nl) * sway * 0.06) * k;
    this.x += this.dx;
    this.y += this.dy;
    this.spin += (s.spin || 0) * k;
    if (this.out()) this.alive = false;
    if (s.trail && Math.random() < s.trail) {
      this.world.fx.trail(this.cx, this.cy, s.trailR || 5, s.trailColor || '#ffb03a', 260);
    }
  }
  draw(g) {
    const art = this.world.art[this.spec.art];
    const rot = this.spec.rotToVel ? Math.atan2(this.dy, this.dx) + Math.PI / 2 : this.spin;
    g.save();
    g.translate(this.cx, this.cy);
    if (rot) g.rotate(rot);
    if (this.spec.glow) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.5;
      g.drawImage(art.c, -art.w * 0.7, -art.h * 0.7, art.w * 1.4, art.h * 1.4);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    g.drawImage(art.c, -art.w / 2, -art.h / 2, art.w, art.h);
    g.restore();
  }
}

/** BOSS 默认弹（原版：左右双生火焰，speed 10，10*sin(y) 摆动；[修正] 改为朝玩家方向双生） */
export class BossDefaultPair extends Bullet {
  constructor(world) {
    super(world, 'bossFlamePair');
    this.owner = 'enemy';
    this.harm = 1;
    const a = world.art.bossFlame;
    this.w = a.w;
    this.h = a.h;
  }
  spawn(x, y, angle, side) {
    this.alive = true;
    this.speed = 10; // 原版固定 10
    this.angle = angle + side * 0.16;
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;
    this.phase = rand(0, TAU);
    this.life = 0;
    this.world.bullets.push(this);
  }
  logic() {
    const k = this.k;
    const vx = Math.cos(this.angle) * this.speed;
    const vy = Math.sin(this.angle) * this.speed;
    this.dx = vx * k + 10 * Math.sin(this.y * 0.05 + this.phase) * 0.35 * k;
    this.dy = vy * k;
    this.x += this.dx;
    this.y += this.dy;
    if (this.out()) this.alive = false;
    if (Math.random() < 0.5) this.world.fx.trail(this.cx, this.cy, 6, '#ff7a1d', 260);
  }
  draw(g) {
    const art = this.world.art.bossFlame;
    g.save();
    g.translate(this.cx, this.cy);
    g.rotate(this.angle - Math.PI / 2);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.45;
    g.drawImage(art.c, -art.w * 0.7, -art.h * 0.7, art.w * 1.4, art.h * 1.4);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(art.c, -art.w / 2, -art.h / 2, art.w, art.h);
    g.restore();
  }
}

/* ================================================================== *
 * BOSS
 * ================================================================== */
const BOSS_SPEC = {
  sun: {
    id: 'sun',
    art: 'bossSun',
    speed: () => randInt(0, 4) + 5,
    sway: 'sinT',
    amp: 80,
    angle: -Math.PI / 2,
    glow: 1,
    trail: 0.4,
    trailColor: '#ffd54a',
    trailR: 5,
    spin: 0.06,
  },
  tri: {
    id: 'tri',
    art: 'bossTri',
    speed: () => randInt(0, 4) + 10,
    sway: 'tanT',
    amp: 3,
    angle: -Math.PI / 2,
    glow: 1,
    trail: 0.18,
    trailColor: '#c8e06a',
    trailR: 4,
    spin: 0.05,
  },
  thunder: {
    id: 'thunder',
    art: 'thunderG',
    speed: () => randInt(0, 7) + 5,
    sway: 'sinY',
    amp: 20,
    angle: -Math.PI / 2,
    glow: 1,
    trail: 0.3,
    trailColor: '#7dff8f',
    trailR: 5,
  },
  thunderR: {
    id: 'thunderR',
    art: 'thunderR',
    speed: () => randInt(0, 7) + 5,
    sway: 'sinY',
    amp: 20,
    angle: -Math.PI / 2,
    glow: 1,
    trail: 0.3,
    trailColor: '#ff4a3c',
    trailR: 5,
  },
  hellY: {
    id: 'hellY',
    art: 'hellfireY',
    speed: () => randInt(0, 4) + 5,
    sway: 'sinT',
    amp: 4,
    angle: -Math.PI / 2,
    glow: 1,
    rotToVel: true,
    trail: 0.5,
    trailColor: '#ffd24a',
    trailR: 6,
  },
  hellR: {
    id: 'hellR',
    art: 'hellfireR',
    speed: () => randInt(0, 9) + 5,
    sway: 'tanY',
    amp: 8,
    angle: -Math.PI / 2,
    glow: 1,
    rotToVel: true,
    trail: 0.5,
    trailColor: '#ff3a1e',
    trailR: 6,
  },
};

export class BossPlane extends EnemyPlane {
  constructor(world) {
    super(world, 'boss');
    this.score = GC.BOSSPLANE_SCORE;
    const a = world.art.boss_normal;
    this.w = a.w;
    this.h = a.h;
    this.interval = 1;
    this.isFire = false;
    this.direction = CU.DIR_RIGHT;
    this.bulletType = CU.BOSSBULLET_DEFAULT;
    this.state = 'normal';
    this.isAnger = false;
    this.isCrazy = false;
    this.isLimit = false;
    this.stateT = 0;
    this.leftBorder = 0;
    this.rightBorder = 0;
    this.upBorder = 0;
    this.downBorder = 0;
    this.beam = 0; // 普通状态火焰阵的能量表现
    this.warn = 0;
    this.dying = false;
  }
  setupBorders() {
    // 原版 setScreenWH
    this.leftBorder = -this.w / 2;
    this.rightBorder = this.W - this.w / 2;
    this.upBorder = 0;
    this.downBorder = this.H * (2 / 3);
  }
  initial(speedTime) {
    super.initial(speedTime);
    this.setupBorders();
    this.isVisible = true;
    this.isAnger = false;
    this.isCrazy = false;
    this.isLimit = false;
    this.isFire = false;
    this.state = 'normal';
    this.bulletType = CU.BOSSBULLET_DEFAULT;
    this.interval = 1;
    this.beam = 0;
    this.speed = 15; // 原版
    this.bloodVolume = GC.BOSSPLANE_BLOOD;
    this.blood = this.bloodVolume;
    this.direction = CU.DIR_RIGHT;
    this.x = rand(0, this.W - this.w);
    this.y = -this.h * (speedTime * 2 + 1);
    this.warn = 1600;
    this.world.game.onBossAppear?.();
  }
  get canCollide() {
    return this.alive && !this.isExplosion && this.isVisible;
  }
  attacked(harm) {
    const died = super.attacked(harm);
    if (!died) {
      // 阶段切换判定（原版 BossPlane.logic 中的血量阈值）
      this.checkState();
      this.world.onBossHit?.(this);
    }
    return died;
  }
  checkState() {
    const prev = this.state;
    if (this.blood <= GC.BOSSPLANE_ANGER_BLOOD && this.blood > GC.BOSSPLANE_CRAZY_BLOOD) {
      if (!this.isAnger) {
        this.isAnger = true;
        this.isCrazy = false;
        this.isLimit = false;
        this.state = 'anger';
        this.changeBullet(CU.BOSSBULLET_ANGER);
      }
    }
    if (this.blood <= GC.BOSSPLANE_CRAZY_BLOOD && this.blood > GC.BOSSPLANE_LIMIT_BLOOD) {
      if (!this.isCrazy) {
        this.isAnger = false;
        this.isCrazy = true;
        this.isLimit = false;
        this.speed = 20 + 3 * this.speedTime; // 原版
        this.state = 'crazy';
        this.changeBullet(CU.BOSSBULLET_CRAZY);
      }
    }
    if (this.blood <= GC.BOSSPLANE_LIMIT_BLOOD) {
      if (!this.isLimit) {
        this.isAnger = false;
        this.isCrazy = false;
        this.isLimit = true;
        this.speed = 30 + 5 * this.speedTime; // 原版
        this.state = 'limit';
        this.changeBullet(CU.BOSSBULLET_LIMIT);
      }
    }
    if (prev !== this.state) {
      this.stateT = 0;
      const fx = this.world.fx;
      fx.ring(this.cx, this.cy, 20, this.w * 1.5, this.stateColor, 700, 0.5);
      fx.flashScreen(this.stateColor, 0.35, 0.08);
      fx.shake(14);
      fx.popText(this.cx, this.y - 16, this.stateName, this.stateColor, 26, -0.5, 1500);
      this.world.audio.play('bossRoar', 0.9);
      this.world.game.hitstop(90);
    }
  }
  get stateName() {
    return { normal: '普通状态', anger: '愤怒状态', crazy: '疯狂状态', limit: '极限状态' }[this.state];
  }
  get stateColor() {
    return { normal: '#8ee6ff', anger: '#ffd894', crazy: '#ffab7a', limit: '#ff7a5c' }[this.state];
  }
  changeBullet(type) {
    // 原版按 speedTime 组装不同弹夹；这里记录弹夹组合，发射时按组合轮换
    this.bulletType = type;
    const lv = this.speedTime;
    const L = this.world.game.mode.bossBulletBonus || 0;
    let kinds = [];
    if (type === CU.BOSSBULLET_DEFAULT) {
      // 原版 normalShooting：100 个默认弹夹；lv>=3 追加黄/红地狱火
      kinds = ['default'];
      if (lv >= 3) kinds = lv === 3 ? ['default', 'hellY'] : lv === 4 ? ['default', 'hellR'] : ['default', 'hellY', 'hellR'];
      this.clip = 100;
    } else if (type === CU.BOSSBULLET_ANGER) {
      // 原版 angerShooting：8 组，按等级替换
      kinds = lv <= 2 ? ['sun', 'tri'] : lv <= 4 ? ['sun', 'thunder'] : ['sun', 'tri', 'thunder'];
      this.clip = 8 * 2 + L;
    } else if (type === CU.BOSSBULLET_CRAZY) {
      // 原版 crazyShooting：clip = speedTime + 4
      this.clip = lv + 4 + L;
      kinds = lv === 1 ? ['hellY'] : lv === 2 ? ['hellR'] : lv === 3 ? ['hellY', 'hellR'] : ['thunder', 'hellY', 'hellR'];
    } else {
      // 原版 limitShooting：clip = speedTime + 5
      this.clip = lv + 5 + L;
      kinds =
        lv === 1
          ? ['hellR']
          : lv === 2
          ? ['hellY', 'hellR']
          : lv === 3
          ? ['sun', 'hellY', 'hellR']
          : lv === 4
          ? ['sun', 'thunder', 'hellR']
          : ['sun', 'hellR', 'default'];
    }
    this.kinds = kinds;
    this.kindIdx = 0;
  }
  /** 原版 BossPlane.initBullet()：interval 门控发射 */
  initBullet() {
    if (!this.isFire) return;
    if (this.world.missileState) return; // 我方导弹引爆期间敌方停火
    if (this.interval <= 1) {
      this.fireVolley();
      this.interval = 1 + 1e-6;
    }
    this.interval += this.k;
    if (this.bulletType === CU.BOSSBULLET_DEFAULT) {
      if (this.interval >= 2) this.interval = 1; // 原版：普通状态几乎连发
    } else if (this.interval >= 30 / Math.max(1, this.speedTime) + 5) {
      this.interval = 1;
      if (this.isCrazy || this.isLimit) this.sandErupt();
    }
  }
  fireVolley() {
    const n = this.bulletType === CU.BOSSBULLET_DEFAULT ? 1 : 2 + Math.floor(this.speedTime / 3);
    for (let i = 0; i < n; i++) {
      const kind = this.kinds[this.kindIdx % this.kinds.length];
      this.kindIdx++;
      this.fireKind(kind, i, n);
    }
    this.world.audio.play('bossShoot', 0.4);
    this.world.fx.flash(this.cx, this.muzzleY, 40, this.stateColor, 160);
  }
  /** [加强] 沙地地狱火：疯狂/极限状态下从屏幕底部沙暴中喷发（README 的「由沙漠中冒出」） */
  sandErupt() {
    const n = 1 + (this.speedTime >= 4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const x = rand(this.w * 0.3, this.W - this.w * 0.3);
      const y = this.H + 60 + i * 10;
      const spec = { ...(Math.random() < 0.5 ? BOSS_SPEC.hellY : BOSS_SPEC.hellR), angle: -Math.PI / 2 };
      BossBullet.fire(this.world, spec, x, y, -Math.PI / 2);
      this.world.fx.ring(x, this.H - 4, 4, 60, '#ffb03a', 420, 0.7);
      this.world.fx.embers(x, this.H - 6, 10, '#ff8a3c', { speed: 2.2, ttl: 620, r: 4, vy0: -1.4 });
    }
    this.world.audio.play('hellfire', 0.5);
  }
  fireKind(kind, i, n) {
    const spec = BOSS_SPEC[kind];
    const mx = this.cx;
    const my = this.muzzleY;
    // [修正] 原版弹道恒定向屏幕上方飞；当 BOSS 在上半屏时改为朝我方战机方向
    const aimUp = this.y > this.H * 0.45;
    let angle;
    if (kind === 'default') angle = Math.atan2(this.world.player.cy - my, this.world.player.cx - mx);
    else angle = aimUp ? -Math.PI / 2 : Math.atan2(this.world.player.cy - my, this.world.player.cx - mx);
    const spread = (i - (n - 1) / 2) * 0.24;
    if (kind === 'default') {
      const p = new BossDefaultPair(this.world);
      p.spawn(mx, my, angle, 1);
      const p2 = new BossDefaultPair(this.world);
      p2.spawn(mx, my, angle, -1);
      return;
    }
    const s = { ...spec, angle: angle + spread };
    const x = mx + spread * 60;
    const b = BossBullet.fire(this.world, s, clamp(x, 8, this.W - 8), my, angle + spread);
    b.spec = s;
    if (kind === 'thunder') b.spec.art = Math.random() < 0.5 ? 'thunderG' : 'thunderR';
  }
  get muzzleY() {
    return this.y + (this.isAnger ? this.h * 0.15 : this.h * 0.86);
  }
  /** 原版 BossPlane.logic + moveLogic */
  logic(dt) {
    this.stateT += dt;
    if (this.warn > 0) this.warn -= dt;
    if (this.y < 0) {
      this.y += this.speed * this.k;
      return;
    }
    if (!this.isFire) {
      this.isFire = true;
      this.world.audio.play('bossWake', 0.8);
    }
    this.checkState();
    const k = this.k;
    const sp = this.speed * k;
    if (this.isCrazy || this.isLimit) {
      // 原版 BossPlane.moveLogic：右下方 → 左 → 右上方 → 左 → 右下方 循环
      if (this.direction === CU.DIR_RIGHT) this.direction = CU.DIR_LEFT;
      const d = this.direction;
      if (this.x < this.rightBorder && this.y < this.downBorder && d === CU.DIR_RIGHT_DOWN) {
        this.x += sp;
        this.y += sp;
        if (this.x >= this.rightBorder || this.y >= this.downBorder) this.direction = CU.DIR_LEFT;
      }
      if (this.x > this.leftBorder && this.direction === CU.DIR_LEFT) {
        this.x -= sp;
        if (this.x <= this.leftBorder) this.direction = CU.DIR_RIGHT_UP;
      }
      if (this.x < this.rightBorder && this.y > this.upBorder && this.direction === CU.DIR_RIGHT_UP) {
        this.x += sp;
        this.y -= sp;
        if (this.x >= this.rightBorder || this.y <= this.upBorder) this.direction = CU.DIR_TEMP;
      }
      if (this.x > this.leftBorder && this.direction === CU.DIR_TEMP) {
        this.x -= sp;
        if (this.x <= this.leftBorder) this.direction = CU.DIR_RIGHT_DOWN;
      }
      this.x = clamp(this.x, -this.w * 0.42, this.W - this.w * 0.58);
      this.y = clamp(this.y, 0, this.downBorder);
    } else if (this.isAnger) {
      // 原版：下潜到 2/3 屏高，然后左右移动
      if (this.y < this.downBorder) {
        this.y += this.speed * k;
        if (this.y >= this.downBorder) this.direction = CU.DIR_RIGHT;
      }
      if (this.x < this.rightBorder && this.direction === CU.DIR_RIGHT) {
        this.x += sp;
        if (this.x >= this.rightBorder) this.direction = CU.DIR_LEFT;
      }
      if (this.x > this.leftBorder && this.direction === CU.DIR_LEFT) {
        this.x -= sp;
        if (this.x <= this.leftBorder) this.direction = CU.DIR_RIGHT;
      }
    } else {
      if (this.x < this.rightBorder && this.direction === CU.DIR_RIGHT) {
        this.x += sp;
        if (this.x >= this.rightBorder) this.direction = CU.DIR_LEFT;
      }
      if (this.x > this.leftBorder && this.direction === CU.DIR_LEFT) {
        this.x -= sp;
        if (this.x <= this.leftBorder) this.direction = CU.DIR_RIGHT;
      }
    }
    this.initBullet();
  }
  onExplodeStart() {
    super.onExplodeStart();
    this.world.game.onBossKilled?.();
  }
  explosionStep(dt) {
    this.explosionT += dt;
    const fx = this.world.fx;
    // BOSS 谢幕：核心过载 + 连续爆炸 + 冲击环
    if (this.explosionT < 1500) {
      if (Math.random() < 0.85) {
        fx.embers(this.cx + (Math.random() - 0.5) * this.w, this.cy + (Math.random() - 0.5) * this.h, 6, '#ffd06a', { speed: 2.4, ttl: 700, r: 7 });
        fx.smoke(this.cx, this.cy, 2, '#332a22', { speed: 1.4, ttl: 1100, r: 22 });
      }
      if (this.explosionT % 260 < 20) {
        fx.explode(this.cx + (Math.random() - 0.5) * this.w * 1.1, this.cy + (Math.random() - 0.5) * this.h * 0.8, 1.6, '#ffb347');
        this.world.audio.play('boomMid', 0.5);
      }
      this.flash = Math.max(0, Math.sin(this.explosionT * 0.05));
      this.beam = 1 - this.explosionT / 1500;
    } else {
      fx.flashScreen('#fff2c8', 0.55, 0.06);
      fx.ring(this.cx, this.cy, 10, this.W * 1.4, '#ffd06a', 900, 1);
      for (let i = 0; i < 4; i++) fx.explode(this.cx + (Math.random() - 0.5) * this.w, this.cy + (Math.random() - 0.5) * this.h, 2.4, '#ff8a3c');
      fx.debris(this.cx, this.cy, 30, '#8a7a68', { speed: 6, ttl: 1400, size: 7 });
      this.isExplosion = false;
      this.alive = false;
    }
  }
  draw(g) {
    if (!this.alive) return;
    const artMap = { normal: 'boss_normal', anger: 'boss_anger', crazy: 'boss_crazy', limit: 'boss_limit' };
    let art = this.world.art[artMap[this.state]];
    const dying = this.isExplosion;
    // 极限状态闪烁（原版是 2 帧动画）
    if (this.isLimit && !dying && Math.floor(this.t / 90) % 2 === 0) art = this.world.art.boss_crazy;
    const alpha = dying ? 0.75 : 1;
    const glow = damageGlow(this) * 0.8 + (this.isLimit ? 0.35 + Math.sin(this.t * 0.02) * 0.2 : 0);
    // 状态光环
    g.save();
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient ? g.createRadialGradient(this.cx, this.cy, this.w * 0.2, this.cx, this.cy, this.w * 0.95) : null;
    if (halo) {
      halo.addColorStop(0, withAlpha(this.stateColor, 0.08 + 0.05 * Math.sin(this.t * 0.004)));
      halo.addColorStop(1, withAlpha(this.stateColor, 0));
      g.fillStyle = halo;
      g.fillRect(this.x - this.w * 0.6, this.y - this.h * 0.5, this.w * 2.2, this.h * 2);
    }
    g.restore();
    // 引擎
    for (const ox of [-26, 0, 26]) {
      drawThruster(g, this.cx + ox, this.y + 20, 16, 42, this.stateColor, this.t + ox * 3, 1.1);
    }
    this.drawArt(g, art, 0, 0, 0, alpha, glow);
    // 受伤冒烟
    if (this.blood / this.bloodVolume < 0.45 && Math.random() < 0.25) {
      this.world.fx.smoke(this.cx + (Math.random() - 0.5) * this.w * 0.7, this.y + this.h * 0.3, 1, '#2f2822', { speed: 0.9, ttl: 1000, r: 14 });
    }
    if (dying) {
      // 核心过载辉光
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(this.beam, 0, 1) * 0.8;
      const r = this.w * (0.3 + (1 - this.beam) * 0.9);
      this.world.fx.flash(this.cx, this.cy, r, '#fff2c8', 200);
      g.restore();
    }
  }
}

/* ================================================================== *
 * 道具（原版 GameGoods：从中央出生，四向反弹，速度 10+rand(5)）
 * ================================================================== */
export class Goods extends Entity {
  constructor(world, kind) {
    super(world);
    this.kind = kind;
    this.speed = 10;
    const a = world.art['goods' + kind];
    this.w = a.w;
    this.h = a.h;
    this.direction = randInt(0, 1) + 3; // 原版 DIR_LEFT_DOWN / DIR_RIGHT_DOWN
    this.pulse = rand(0, TAU);
    this.age = 0;
  }
  initial() {
    this.alive = true;
    this.x = this.W / 2 - this.w / 2;
    this.y = -this.h;
    this.age = 0;
    this.speed = 10;
    this.direction = randInt(0, 1) + 3;
  }
  logic() {
    const k = this.k;
    this.age += this.t;
    let dx = 0,
      dy = 0;
    const step = (this.speed + randInt(0, 2)) * k; // 原版 ran.nextInt(3) + speed
    if (this.direction === CU.DIR_LEFT_UP) (dx = -step), (dy = -step);
    else if (this.direction === CU.DIR_RIGHT_UP) (dx = step), (dy = -step);
    else if (this.direction === CU.DIR_LEFT_DOWN) (dx = -step), (dy = step);
    else (dx = step), (dy = step);
    this.x += dx;
    this.y += dy;
    // 触壁反弹换向（原版逻辑）
    let hit = false;
    if (this.x <= 0) ((this.x = 0), (hit = true));
    else if (this.x >= this.W - this.w) ((this.x = this.W - this.w), (hit = true));
    if (this.y <= 0) ((this.y = 0), (hit = true));
    else if (this.y >= this.H - this.h) ((this.y = this.H - this.h), (hit = true));
    if (hit) {
      let d = 0;
      do {
        d = randInt(1, 4);
      } while (d === this.direction);
      this.direction = d;
      this.speed = 10 + randInt(0, 4);
      this.world.fx.ring(this.cx, this.cy, 12, 40, '#ffe6a8', 320, 0.5);
    }
    // [加强] 风暴模式：靠近时轻微吸附，避免道具永远飞不走
    if (this.world.game.mode.itemBias > 1) {
      const p = this.world.player;
      const d = Math.hypot(p.cx - this.cx, p.cy - this.cy);
      if (d < 120) {
        this.x += ((p.cx - this.cx) / d) * 1.6 * k * this.world.game.mode.itemBias;
        this.y += ((p.cy - this.cy) / d) * 1.6 * k * this.world.game.mode.itemBias;
      }
    }
    if (Math.random() < 0.5) this.world.fx.trail(this.cx, this.cy, 10, this.tint, 300);
  }
  get tint() {
    return { Purple: '#b14cff', Red: '#ff4a2a', Missile: '#ffb03a', Life: '#46e6a0' }[this.kind];
  }
  draw(g) {
    if (!this.alive) return;
    const art = this.world.art['goods' + this.kind];
    const p = 0.5 + Math.sin(this.t * 0.006 + this.pulse) * 0.5;
    // 引导光环（让玩家在混战里也能看见道具）
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.22 + p * 0.22;
    g.strokeStyle = withAlpha(this.tint, 0.9);
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(this.cx, this.cy, this.w * (0.75 + p * 0.35), 0, TAU);
    g.stroke();
    g.restore();
    g.save();
    g.translate(this.cx, this.cy + Math.sin(this.t * 0.004 + this.pulse) * 2.2);
    g.rotate(Math.sin(this.t * 0.002 + this.pulse) * 0.12);
    g.drawImage(art.c, -art.w / 2, -art.h / 2, art.w, art.h);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.4 + p * 0.3;
    g.drawImage(art.c, -art.w * 0.6, -art.h * 0.6, art.w * 1.2, art.h * 1.2);
    g.restore();
  }
}

/* ================================================================== *
 * 我方战机
 * ================================================================== */
export class MyPlane extends Entity {
  constructor(world) {
    super(world);
    const a = world.art.player100;
    this.w = a.w;
    this.h = a.h;
    this.speed = GC.MYPLANE_SPEED;
    this.bulletType = CU.MYBULLET;
    this.isChangeBullet = false;
    this.startTime = 0;
    this.isInvincible = false;
    this.invincibleT = 0;
    this.isDamaged = false;
    this.damagedT = 0;
    this.missileState = false;
    this.missileT = 0;
    this.fireAcc = 1;
    this.bank = 0;
    this.trailT = 0;
    this.lastX = 0;
    this.thrust = 0;
    this.buildPools();
  }
  buildPools() {
    // 原版弹夹容量：蓝 4 / 紫 6（双发） / 红 4
    const w = this.world;
    this.bullets = [];
    if (this.bulletType === CU.MYBULLET1) {
      for (let i = 0; i < 6; i++) this.bullets.push(new MyPurpleBullet(w));
    } else if (this.bulletType === CU.MYBULLET2) {
      for (let i = 0; i < 4; i++) this.bullets.push(new MyRedBullet(w));
    } else {
      for (let i = 0; i < 4; i++) this.bullets.push(new MyBlueBullet(w));
    }
  }
  changeBullet(type) {
    // 原版 changeBullet：清空弹夹并按类型重建
    this.bulletType = type;
    this.bullets = [];
    this.buildPools();
  }
  resetPos() {
    this.x = this.W / 2 - this.w / 2;
    this.y = this.H - this.h - 12;
    this.alive = true;
  }
  get invincible() {
    return this.isInvincible || this.missileState;
  }
  setChangeBullet(v) {
    this.isChangeBullet = v;
  }
  /** [加强] 可缩小的受击判定盒（经典模式 = 原版全尺寸矩形） */
  get hitbox() {
    const f = this.world.game.hitboxScale;
    const w = this.w * f;
    const h = this.h * (0.45 + 0.55 * f);
    return { x: this.cx - w / 2, y: this.cy - h / 2, w, h };
  }
  /** 无敌期间的闪烁 + 护盾 */
  get flicker() {
    if (!this.isInvincible) return 1;
    return this.damagedT > 0 ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(this.t * 0.02));
  }
  update(dt) {
    const k = this.k;
    const w = this.world;
    // —— 移动：原版用 MYPLANE_SPEED(30px/帧) 步进追踪手指
    const agi = w.game.agility;
    const maxStep = this.speed * agi * k;
    const tx = w.pointer.x - this.w / 2;
    const ty = w.pointer.y - this.h / 2;
    const px = this.x;
    this.x = approach(this.x, tx, maxStep);
    this.y = approach(this.y, ty, maxStep);
    this.x = clamp(this.x, -this.w * 0.12, this.W - this.w * 0.88);
    this.y = clamp(this.y, this.H * 0.08, this.H - this.h * 1.02);
    const vx = this.x - px;
    this.bank = clamp(this.bank + (vx * 0.09 - this.bank) * 0.3, -0.42, 0.42);
    const moving = Math.hypot(vx, this.y - (this.lastY || this.y));
    this.thrust = clamp(0.65 + moving * 0.1, 0.65, 1.5);
    this.lastY = this.y;

    // —— 状态计时
    if (this.isInvincible) {
      this.invincibleT -= dt;
      if (this.invincibleT <= 0) this.isInvincible = false;
    }
    if (this.damagedT > 0) {
      this.damagedT -= dt;
      if (this.damagedT <= 0) {
        this.isDamaged = false;
        // 原版：受损动画后进入无敌 INVINCIBLE_TIME
        if (DC.INVINCIBLE) {
          this.isInvincible = true;
          this.invincibleT = GC.INVINCIBLE_TIME;
        }
      }
    }
    if (this.missileState) {
      this.missileT -= dt;
      if (this.missileT <= 0) this.missileState = false;
    }
    // —— 特殊子弹 15s 计时（原版 isBulletOverTime）
    if (this.isChangeBullet) {
      if (w.t - this.startTime > GC.MYSPECIALBULLET_DURATION) {
        this.isChangeBullet = false;
        this.startTime = 0;
        this.changeBullet(CU.MYBULLET);
        w.fx.popText(this.cx, this.y - 18, '弹药衰减', '#9fc6ff', 14, -0.5, 1100);
      }
    }
    // —— 引擎尾迹
    if (Math.random() < 0.6) w.fx.trail(this.cx, this.y + this.h * 0.92, 5, { 100: '#57e0ff', 101: '#c77bff', 102: '#ff6a48' }[this.bulletType], 240);
    // —— 射击
    this.fireAcc += k;
    while (this.fireAcc >= 1) {
      this.fireAcc -= 1;
      this.fireOne();
    }
    for (const b of this.bullets) if (b.alive) b.logic();
  }
  fireOne() {
    for (const b of this.bullets) {
      if (!b.alive) {
        b.initial(this.cx, this.cy);
        this.world.audio.play({ 100: 'shootBlue', 101: 'shootPurple', 102: 'shootRed' }[this.bulletType], 0.35);
        this.world.fx.muzzle(this.cx, this.y + 2, Math.PI / 2, { 100: '#8fe9ff', 101: '#e6b3ff', 102: '#ffb08a' }[this.bulletType], 0.9);
        return;
      }
    }
  }
  get specialLeft() {
    if (!this.isChangeBullet) return 0;
    return clamp(1 - (this.world.t - this.startTime) / GC.MYSPECIALBULLET_DURATION, 0, 1);
  }
  /** 使用导弹：原版对所有可碰撞敌机造成 MISSILE_HARM，并让敌方停火 MISSILEBOOM_TIME */
  useMissile() {
    if (this.missileState) return false;
    this.missileState = true;
    this.missileT = GC.MISSILEBOOM_TIME;
    return true;
  }
  onBoom() {
    const w = this.world;
    w.fx.explode(this.cx, this.cy, 2.6, '#7fd8ff', { ring: 240, shake: 16 });
    w.fx.flashScreen('#cfefff', 0.5, 0.07);
    w.fx.popText(this.cx, this.cy - 30, '-1', '#ff6a4d', 22, -0.7, 1000);
    w.audio.play('playerBoom', 0.9);
    this.isDamaged = true;
    this.damagedT = GC.BOOM_TIME; // 原版 BOOM_TIME 炸毁动画
    // 原版：受损期间清空敌方子弹？（不清空）这里保留原版行为，仅清除屏幕上的近身弹以便重生
    for (const b of w.bullets) {
      if (Math.hypot(b.cx - this.cx, b.cy - this.cy) < 120) b.alive = false;
    }
  }
  draw(g) {
    if (this.isDamaged) {
      // 受损：残骸 + 火光（原版是 myplaneexplosion 逐帧图）
      const p = 1 - this.damagedT / GC.BOOM_TIME;
      g.save();
      g.globalAlpha = 0.8;
      g.translate(this.cx, this.cy);
      g.rotate(p * 2.4);
      const art = this.world.art['player' + this.bulletType];
      g.drawImage(art.c, -art.w / 2, -art.h / 2, art.w, art.h);
      g.restore();
      return;
    }
    const art = this.world.art['player' + this.bulletType];
    const tint = { 100: '#57e0ff', 101: '#c77bff', 102: '#ff6a48' }[this.bulletType];
    // 引擎
    drawThruster(g, this.cx, this.y + this.h - 4, 16, 46, tint, this.t, this.thrust);
    // 机身（视觉尺寸可略大于碰撞盒）
    this.drawArt(g, art, this.bank, 0, 0, this.flicker, this.missileState ? 1 : 0.15);
    // 子弹
    for (const b of this.bullets) if (b.alive) b.draw(g);
    // 武器剩余时间环
    if (this.specialLeft > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = withAlpha(tint, 0.85);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.cx, this.cy, this.w * 0.78, -Math.PI / 2, -Math.PI / 2 + TAU * this.specialLeft);
      g.stroke();
      g.restore();
    }
    // 无敌护盾（原版 plane_shield）
    if (this.invincible) {
      const sh = this.world.art.shield;
      const s = 1 + Math.sin(this.t * 0.008) * 0.04;
      g.save();
      g.translate(this.cx, this.cy);
      g.rotate(Math.sin(this.t * 0.002) * 0.12);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.55 + 0.35 * Math.abs(Math.sin(this.t * 0.006));
      g.drawImage(sh.c, (-sh.w * s) / 2, (-sh.h * s) / 2, sh.w * s, sh.h * s);
      g.restore();
    }
    // 导弹引爆：全屏爆炸（原版 boom.png 绘制在机体位置）
    if (this.missileState) {
      // 原版在机体位置绘制 boom.png；这里按引爆进度做一次性扩散冲击
      const b = this.world.art.boom;
      const p = 1 - this.missileT / GC.MISSILEBOOM_TIME;
      const r = (0.22 + p * 1.5) * this.W * 1.35;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = Math.pow(1 - p, 1.8) * 0.4;
      g.drawImage(b.c, this.cx - r / 2, this.cy - r / 2, r, r);
      g.globalAlpha = Math.pow(1 - p, 2.2) * 0.3;
      g.drawImage(b.c, this.cx - r * 0.3, this.cy - r * 0.3, r * 0.6, r * 0.6);
      g.restore();
    }
    // 判定核心（[加强] 缩小判定时给出可见红点）
    if (this.world.game.hitboxScale < 0.95) {
      const r = 3.2;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = withAlpha('#ff5a4a', 0.95);
      g.beginPath();
      g.arc(this.cx, this.cy, r, 0, TAU);
      g.fill();
      g.globalAlpha = 0.35;
      g.strokeStyle = '#ffd0c0';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(this.cx, this.cy, r + 3 + Math.sin(this.t * 0.01) * 1.4, 0, TAU);
      g.stroke();
      g.restore();
    }
  }
}

export { BOSS_SPEC };
