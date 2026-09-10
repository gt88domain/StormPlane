/**
 * game.js —— 主循环 / 出怪编排 / 碰撞 / HUD（对应原版 view/MainView.java）
 *
 * 保留的原版机制：
 *   · initObject() 的「单帧出一架 + break 优先级」出怪节奏（小型机 → 中型机 → 大型机 → BOSS）
 *   · 各类敌机 / 道具的积分门槛（累进积分未清零，与原版一致）
 *   · 升级：sumScore >= speedTime * LEVELUP_SCORE 时提升 speedTime，最高 6 级
 *   · 撞击/中弹 → 损失 1 生命 → 2s 炸毁动画 → 5s 无敌；生命为 0 时结束并回到结算页
 *   · 导弹：对全屏可碰撞敌机造成 MISSILE_HARM，期间敌方停火 MISSILEBOOM_TIME
 */

import { GameConstant as GC, ConstantUtil as CU, DebugConstant as DC, FIELD, TUNING, MODES, HUD, TICK_MS } from './config.js';
import { clamp, aabb, now, fmt, rand, store, withAlpha } from './util.js';
import { buildArt } from './sprites.js';
import { FX, PostFX } from './fx.js';
import { Background } from './background.js';
import { MyPlane, SmallPlane, MiddlePlane, BigPlane, BossPlane, Goods } from './entities.js';

export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    // 音频对象缺失时（如离线渲染回归 / 系统不支持 WebAudio）退化为静音桩
    this.audio = opts.audio || NOOP_AUDIO;
    this.onState = opts.onState || (() => {});
    this.onFrame = opts.onFrame || null; // 每帧回调（供 UI 层同步数据、读取键盘）
    this.onGameOver = opts.onGameOver || (() => {});
    this.quality = opts.quality != null ? opts.quality : 1;
    this.mode = MODES.classic;
    this.agility = this.mode.playerAgility;
    this.hitboxScale = 1;
    this.showFps = false;
    this.allowShake = true;
    this.allowHitstop = true;

    this.art = buildArt(opts.ss);
    this.fx = new FX(this.quality);
    this.post = new PostFX(this.quality);
    this.bg = new Background(FIELD.W, FIELD.H);

    this.view = { scale: 1, dpr: 1, W: FIELD.W, H: FIELD.H, cssW: FIELD.W, cssH: FIELD.H };
    this.state = 'idle'; // idle | play | pause | dying | over
    this.t = 0;
    this.k = 1;
    this._raf = 0;
    this._last = 0;
    this._fpsAcc = [];

    this.world = {
      W: FIELD.W,
      H: FIELD.H,
      t: 0,
      k: 1,
      game: this,
      fx: this.fx,
      art: this.art,
      audio: this.audio,
      bg: this.bg,
      bullets: [], // 敌方子弹
      enemies: [],
      goods: [],
      player: null,
      pointer: { x: FIELD.W / 2, y: FIELD.H - 60, active: false },
      missileState: false,
      takeSpawnSlot: (kind) => this.takeSpawnSlot(kind),
      nearestEnemy: (x, y, maxD) => this.nearestEnemy(x, y, maxD),
      onBossHit: () => {},
    };
    this.initEntities();
    this.reset();
  }

  /* ---------------------------- 初始化 ---------------------------- */
  initEntities() {
    const w = this.world;
    w.player = new MyPlane(w);
    w.player.world = w;
    const list = [];
    for (let i = 0; i < GC.SMALLPLANE_COUNT; i++) list.push(new SmallPlane(w));
    for (let i = 0; i < GC.MIDDLEPLANE_COUNT; i++) list.push(new MiddlePlane(w));
    this.bigPlanes = [];
    for (let i = 0; i < GC.BIGPLANE_COUNT; i++) {
      const b = new BigPlane(w);
      list.push(b);
      this.bigPlanes.push(b);
    }
    this.boss = new BossPlane(w);
    list.push(this.boss);
    w.enemies = list;
    w.goods = [
      new Goods(w, 'Purple'),
      new Goods(w, 'Red'),
      new Goods(w, 'Missile'),
      new Goods(w, 'Life'),
    ];
  }
  takeSpawnSlot(kind) {
    const map = {
      small: GC.SMALLPLANE_COUNT,
      middle: GC.MIDDLEPLANE_COUNT,
      big: GC.BIGPLANE_COUNT,
      boss: GC.BOSSPLANE_COUNT,
    };
    this._slots = this._slots || {};
    const n = (this._slots[kind] || 0) % map[kind];
    this._slots[kind] = n + 1;
    return n;
  }
  nearestEnemy(x, y, maxD = 1e9) {
    let best = null;
    let bd = maxD * maxD;
    for (const e of this.world.enemies) {
      if (!e.canCollide) continue;
      const d = (e.cx - x) * (e.cx - x) + (e.cy - y) * (e.cy - y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /* ---------------------------- 尺寸 ---------------------------- */
  resize(cssW, cssH, dpr) {
    const scale = Math.min(cssW / FIELD.W, cssH / FIELD.H);
    const W = Math.round(FIELD.W * scale * dpr);
    const H = Math.round(FIELD.H * scale * dpr);
    this.canvas.width = W;
    this.canvas.height = H;
    if (this.canvas.style) {
      this.canvas.style.width = W / dpr + 'px';
      this.canvas.style.height = H / dpr + 'px';
    }
    this.view = { scale: scale * dpr, dpr, cssW: W / dpr, cssH: H / dpr, W: FIELD.W, H: FIELD.H };
    this.g.imageSmoothingEnabled = true;
    this.g.setTransform(this.view.scale, 0, 0, this.view.scale, 0, 0);
  }
  /** 输入坐标 → 逻辑战场坐标 */
  toField(clientX, clientY, rect) {
    const x = (clientX - rect.left) / this.view.scale * this.view.dpr;
    const y = (clientY - rect.top) / this.view.scale * this.view.dpr;
    return { x: clamp(x, 0, FIELD.W), y: clamp(y, 0, FIELD.H) };
  }

  /* ---------------------------- 开局 / 重置 ---------------------------- */
  setMode(id) {
    this.mode = MODES[id] || MODES.classic;
    this.agility = this.mode.playerAgility;
    if (this.mode.id !== 'classic') this.hitboxScale = 0.62;
    return this.mode;
  }
  reset() {
    // 原版 MainView 构造时的初始值
    this.speedTime = GC.GAMESPEED;
    this.mLifeAmount = GC.LIFEAMOUNT;
    this.missileCount = GC.MISSILECOUNT;
    this.sumScore = 0;
    this.middlePlaneScore = 0;
    this.bigPlaneScore = 0;
    this.bossPlaneScore = 0;
    this.missileScore = 0;
    this.lifeScore = 0;
    this.bulletScore = 0;
    this.bulletScore2 = 0;
    this.kills = { small: 0, middle: 0, big: 0, boss: 0 };
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.startedAt = now();
    this.elapsed = 0;
    this.world.bullets.length = 0;
    this.world.t = 0;
    this.t = 0;
    this._slots = {};
    for (const e of this.world.enemies) {
      e.alive = false;
      e.isExplosion = false;
      e.blood = 0;
    }
    for (const gd of this.world.goods) gd.alive = false;
    const p = this.world.player;
    p.bulletType = CU.MYBULLET;
    p.isChangeBullet = false;
    p.startTime = 0;
    p.isInvincible = false;
    p.isDamaged = false;
    p.missileState = false;
    p.buildPools();
    p.resetPos();
    this.world.pointer.x = p.cx;
    this.world.pointer.y = p.cy;
    this.fx.reset();
    this.bg.y1 = this.bg.y2 = this.bg.y3 = 0;
    this.boss.setupBorders();
    this.state = 'play';
    this.onState(this.state, this.stats());
    this.audio?.play('ready', 0.8);
  }
  stats() {
    return {
      score: this.sumScore,
      level: this.speedTime,
      life: this.mLifeAmount,
      missiles: this.missileCount,
      kills: { ...this.kills },
      total: this.kills.small + this.kills.middle + this.kills.big + this.kills.boss,
      combo: this.maxCombo,
      time: Math.round(this.elapsed / 1000),
      mode: this.mode.id,
      best: store.get('stormplane.best', 0) || 0,
      prevBest: this._prevBest || 0,
      isRecord: this.sumScore > (this._prevBest || 0),
    };
  }

  /* ---------------------------- 循环 ---------------------------- */
  start() {
    if (this._raf) return;
    this._last = now();
    const step = () => {
      this._raf = requestAnimationFrame(step);
      const t = now();
      let dt = t - this._last;
      this._last = t;
      if (dt > TUNING.MAX_DT) dt = TUNING.MAX_DT;
      if (this.showFps) {
        this._fpsAcc.push(dt);
        if (this._fpsAcc.length > 40) this._fpsAcc.shift();
      }
      if (this.onFrame) this.onFrame(dt);
      this.tick(dt);
      this.render();
    };
    this._raf = requestAnimationFrame(step);
  }
  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
  pause() {
    if (this.state === 'play') {
      this.state = 'pause';
      this.onState(this.state, this.stats());
    }
  }
  resume() {
    if (this.state === 'pause') {
      this.state = 'play';
      this._last = now();
      this.onState(this.state, this.stats());
    }
  }
  togglePause() {
    if (this.state === 'play') this.pause();
    else if (this.state === 'pause') this.resume();
  }

  tick(dt) {
    if (this.state === 'idle') {
      this.idleTick(dt);
      return;
    }
    const playable = this.state === 'play' || this.state === 'dying';
    if (!playable) return;
    // 顿帧（hit-stop）：击碎/BOSS 变阶段的瞬时慢放
    let sim = dt;
    if (this.fx.hitstopMs > 0) {
      this.fx.hitstopMs = Math.max(0, this.fx.hitstopMs - dt);
      sim = dt * 0.28;
    }
    this.elapsed += sim;
    this.t += sim;
    this.world.t = this.t;
    const k = sim / TICK_MS;
    this.k = this.world.k = k;
    const w = this.world;

    this.initObject();
    if (this.state === 'play') w.player.update(sim);
    for (const e of w.enemies) {
      if (!e.alive) continue;
      if (e.isExplosion) e.explosionStep(sim);
      else if (w.player) e.logic(sim);
      if (e.hitFlashT > 0) {
        e.hitFlashT -= sim;
        e.flash = clamp(e.hitFlashT / 90, 0, 1);
      }
    }
    for (const b of w.bullets) if (b.alive) b.logic();
    w.missileState = w.player.missileState;

    if (this.state === 'play') this.collide();

    this.bg.update(sim, this.speedTime);
    this.fx.update(sim, k);
    for (let i = w.bullets.length - 1; i >= 0; i--) if (!w.bullets[i].alive) w.bullets.splice(i, 1);

    if (this.comboT > 0) {
      this.comboT -= sim;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (this.state === 'dying') {
      this.dyingT -= sim;
      if (this.dyingT <= 0) this.finish();
    }
    // 升级判定（原版逻辑）
    if (this.sumScore >= this.speedTime * GC.LEVELUP_SCORE && this.speedTime < GC.MAXGRADE) {
      this.speedTime++;
      this.onLevelUp();
    }
  }

  /** 标题页 attract：只跑背景与一小队游荡的敌机，不结算、不判定 */
  idleTick(dt) {
    this.t += dt;
    this.world.t = this.t;
    this.k = this.world.k = dt / TICK_MS;
    this._attractT = (this._attractT || 0) + dt;
    if (this._attractT > 520) {
      this._attractT = 0;
      for (const e of this.world.enemies) {
        if ((e instanceof SmallPlane || e instanceof MiddlePlane) && !e.alive && !e.isExplosion) {
          e.speedTime = 2;
          e.initial(2);
          break;
        }
      }
    }
    for (const e of this.world.enemies) {
      if (!e.alive) continue;
      if (e.isExplosion) e.explosionStep(dt);
      else e.logic(dt);
    }
    this.bg.update(dt, 2);
    this.fx.update(dt, this.k);
  }

  /* ---------------- 原版 initObject()：单帧出一架，按列表顺序 break ---------------- */
  initObject() {
    const spawns = this.mode.waveScale > 1 ? 2 : 1;
    for (let s = 0; s < spawns; s++) {
      for (const e of this.world.enemies) {
        if (e instanceof SmallPlane) {
          if (!e.alive && !e.isExplosion) {
            e.initial(this.speedTime);
            break;
          }
        } else if (e instanceof MiddlePlane) {
          if (this.middlePlaneScore >= GC.MIDDLEPLANE_APPEARSCORE && !e.alive && !e.isExplosion) {
            e.initial(this.speedTime);
            break;
          }
        } else if (e instanceof BigPlane) {
          if (this.bigPlaneScore >= GC.BIGPLANE_APPEARSCORE && !e.alive && !e.isExplosion) {
            e.initial(this.speedTime);
            break;
          }
        } else if (e instanceof BossPlane) {
          if (this.bossPlaneScore >= GC.BOSSPLANE_APPEARSCORE && !e.alive && !e.isExplosion) {
            e.initial(this.speedTime);
            this.bossPlaneScore = 0; // 原版：BOSS 出场后重新累计
            break;
          }
        }
      }
      // [加强] 风暴模式：大型机带小队护卫
      if (this.mode.bigEscort && Math.random() < 0.008) {
        for (let i = 0; i < this.mode.bigEscort; i++) {
          for (const e of this.world.enemies) {
            if (e instanceof SmallPlane && !e.alive) {
              e.initial(this.speedTime);
              break;
            }
          }
        }
      }
    }
    // 道具出场门槛（原版积分累计值）
    const g = this.world.goods;
    const tryGoods = (i, score, setScore, flag) => {
      if (score >= setScore && !g[i].alive && flag) {
        this[setKey[i]] = 0;
        g[i].initial();
        this.fx.popText(FIELD.W / 2, 120, g[i].kind === 'Missile' ? '导弹补给!' : g[i].kind === 'Life' ? '生命+1' : '特殊弹夹!', g[i].tint, 18, -0.6, 1500);
      }
    };
    tryGoods(2, this.missileScore, GC.MISSILE_APPEARSCORE, DC.MISSILEGOODS_APPEAR);
    tryGoods(3, this.lifeScore, GC.LIFE_APPEARSCORE, DC.LIFEGOODS_APPEAR);
    tryGoods(0, this.bulletScore, GC.BULLET1_APPEARSCORE, DC.BULLETGOODS1_APPEAR);
    tryGoods(1, this.bulletScore2, GC.BULLET2_APPEARSCORE, DC.BULLETGOODS2_APPEAR);
  }

  collide() {
    const w = this.world;
    const p = w.player;
    // 1) 我方子弹 → 敌机
    for (const b of p.bullets) {
      if (!b.alive) continue;
      for (const e of w.enemies) {
        if (!e.canCollide) continue;
        if (b.hits ? b.hits(e) : false) {
          const harm = b.hitCount ? b.harm * b.hitCount : b.harm;
          const died = e.attacked(harm);
          w.fx.hit(b.cx, b.cy, died ? '#ffd08a' : this.bulletTint(b), died ? 2 : 1);
          if (b.alive && !died) b.alive = false;
          break;
        }
      }
    }
    // 2) 敌机本体 → 我方
    const hb = p.hitbox;
    for (const e of w.enemies) {
      if (!e.canCollide) continue;
      if (aabb(hb.x, hb.y, hb.w, hb.h, e.x, e.y, e.w, e.h)) {
        // 原版行为：撞击不摧毁敌机，我方直接判定坠毁（无敌/导弹引爆期间除外）
        if (!p.invincible) {
          this.killPlayer();
          break;
        }
      }
    }
    // 3) 敌方子弹 → 我方
    for (const b of w.bullets) {
      if (!b.alive) continue;
      if (aabb(hb.x, hb.y, hb.w, hb.h, b.x, b.y, b.w, b.h)) {
        b.alive = false;
        if (!p.invincible) {
          w.fx.hit(p.cx, p.cy, '#ff8a5c', 2);
          this.killPlayer();
          break;
        }
      }
    }
    // 4) 道具 → 我方（原版：命中即生效并回收）
    for (const gd of w.goods) {
      if (!gd.alive) continue;
      if (aabb(p.x, p.y, p.w, p.h, gd.x, gd.y, gd.w, gd.h)) {
        gd.alive = false;
        this.pickGoods(gd);
      }
    }
  }
  bulletTint(b) {
    return { blue: '#8fe9ff', purple: '#e6b3ff', red: '#ffb08a' }[b.kind] || '#ffffff';
  }
  pickGoods(gd) {
    const w = this.world;
    w.fx.pickup(gd.cx, gd.cy, gd.tint);
    this.audio?.play('pickup', 0.8);
    if (gd.kind === 'Missile') {
      if (this.missileCount < GC.MISSILE_MAXCOUNT) this.missileCount++;
    } else if (gd.kind === 'Life') {
      if (this.mLifeAmount < GC.LIFE_MAXCOUNT) this.mLifeAmount++;
    } else {
      const type = gd.kind === 'Purple' ? CU.MYBULLET1 : CU.MYBULLET2;
      w.player.setChangeBullet(true);
      w.player.changeBullet(type);
      w.player.startTime = w.t;
      w.fx.ring(w.player.cx, w.player.cy, 20, 220, gd.tint, 520, 0.9);
    }
    this.fx.popText(gd.cx, gd.cy - 20, gd.kind === 'Missile' ? '导弹 +1' : gd.kind === 'Life' ? '生命 +1' : gd.kind === 'Purple' ? '双螺旋粒子炮!' : '追踪战斧!', gd.tint, 17, -0.7, 1200);
  }
  hitstop(ms) {
    if (this.allowHitstop === false) return;
    this.fx.hitstop(ms);
  }

  /* ---------------- 玩家死亡 / 结算 ---------------- */
  killPlayer() {
    const p = this.world.player;
    if (!p.alive || p.invincible) return;
    p.onBoom();
    if (this.mLifeAmount > 0) {
      this.mLifeAmount--;
      p.alive = true;
      this.hitstop(120);
      this.audio?.setTense(false);
    } else if (DC.ETERNAL) {
      p.alive = true;
    } else {
      this.state = 'dying';
      this.dyingT = 1250;
      this.fx.shake(22);
      this.fx.flashScreen('#ffd6b0', 0.7, 0.05);
      this.fx.zoomPunch(0.14);
      this.hitstop(260);
      this.audio?.play('gameover', 0.9);
      this.audio?.setTense(false);
      p.alive = false;
      this.onState('dying', this.stats());
    }
  }
  finish() {
    this.state = 'over';
    const prevBest = store.get('stormplane.best', 0) || 0;
    this._prevBest = prevBest;
    if (this.sumScore > prevBest) store.set('stormplane.best', this.sumScore);
    const s = this.stats();
    this.onGameOver(s);
    this.onState(this.state, s);
  }
  onKill(e) {
    this.kills[e.kind]++;
    this.combo++;
    this.comboT = TUNING.COMBO_WINDOW_MS;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (e.kind !== 'boss') {
      this.fx.hitstop(TUNING.HITSTOP_KILL_MS * (e.kind === 'big' ? 2.2 : e.kind === 'middle' ? 1.2 : 0.6));
      if (e.kind === 'big') this.fx.flashScreen('#ffb03a', 0.12, 0.09);
    }
  }
  onBossAppear() {
    this.fx.flashScreen('#8ee6ff', 0.25, 0.06);
    this.fx.shake(10);
    this.fx.popText(FIELD.W / 2, FIELD.H * 0.36, '警 报 · BOSS 接近', '#ff5a4a', 30, -0.25, 2400);
    this.audio?.play('bossWake', 0.9);
    this.audio?.setTense(true);
  }
  onBossKilled() {
    this.fx.flashScreen('#ffe9b0', 0.8, 0.04);
    this.fx.shake(26);
    this.fx.hitstop(420);
    this.fx.popText(FIELD.W / 2, FIELD.H * 0.42, 'BOSS 击沉!', '#ffd06a', 34, -0.3, 2600);
  }
  onLevelUp() {
    this.audio?.play('levelup', 0.8);
    this.audio?.setLevel(this.speedTime);
    this.fx.popText(FIELD.W / 2, FIELD.H * 0.3, `等级 ${this.speedTime}`, '#8fe9ff', 26, -0.4, 1600);
    this.fx.ring(this.world.player.cx, this.world.player.cy, 10, 260, '#8fe9ff', 620, 0.8);
    this.boss.speedTime = this.speedTime;
    for (const e of this.world.enemies) e.speedTime = this.speedTime;
  }
  addGameScore(score) {
    // 原版：所有累计器同步增加
    this.middlePlaneScore += score;
    this.bigPlaneScore += score;
    this.bossPlaneScore += score;
    this.missileScore += score;
    this.lifeScore += score;
    this.bulletScore += score;
    this.bulletScore2 += score;
    this.sumScore += score;
  }

  /* ---------------- 导弹 ---------------- */
  useMissile() {
    if (this.state !== 'play') return false;
    if (this.missileCount <= 0) {
      this.audio?.play('ui', 0.4);
      return false;
    }
    const p = this.world.player;
    if (!p.useMissile()) return false;
    this.missileCount--;
    this.audio?.play('missile', 0.95);
    const fx = this.fx;
    // 导弹是全屏清场技，闪光必须让位于「看清敌机」：低 alpha + 快衰减
    fx.flashScreen('#ffe8c0', 0.17, 0.19);
    fx.shake(14);
    this.hitstop(70);
    fx.ring(p.cx, p.cy, 20, FIELD.W * 1.15, '#ffd06a', 620, 0.3);
    for (let i = 0; i < 8; i++) {
      fx.streak(rand(16, FIELD.W - 16), FIELD.H * rand(0.5, 1), FIELD.H * rand(0.14, 0.3), '#ffb03a', 300, -5 - rand(0, 3));
    }
    // 原版：对所有可碰撞敌机造成 MISSILE_HARM
    for (const e of this.world.enemies) {
      if (!e.canCollide) continue;
      const died = e.attacked(GC.MISSILE_HARM); // 原版：MISSILE_HARM = 80
      if (died) fx.explode(e.cx, e.cy, e.kind === 'boss' ? 1.1 : 1.35, '#ffb347');
      else fx.ring(e.cx, e.cy, 4, 30, '#ffd06a', 260, 0.3);
    }
    return true;
  }

  /* ---------------------------- 渲染 ---------------------------- */
  render() {
    const g = this.g;
    const { W, H } = FIELD;
    const fx = this.fx;
    g.setTransform(this.view.scale, 0, 0, this.view.scale, 0, 0);
    g.save();
    // 屏震
    if (fx.shakeMag > 0.05 && this.allowShake !== false) {
      g.translate(fx.shakeX, fx.shakeY);
      g.rotate(fx.rot);
    }
    g.clearRect(-40, -40, W + 80, H + 80);
    this.bg.draw(g);
    const w = this.world;
    for (const gd of w.goods) if (gd.alive) gd.draw(g);
    for (const e of w.enemies) if (e.alive) e.draw(g);
    const idle = this.state === 'idle';
    if (!idle) {
      if (w.player.alive || w.player.isDamaged) w.player.draw(g);
      for (const b of w.bullets) if (b.alive) b.draw(g);
    }
    fx.draw(g);
    this.bg.drawOverlay(g, fx.shakeMag);
    g.restore();

    // 全屏闪光 / 危险边框
    fx.drawFlash(g, W, H);
    if (idle) {
      this.post.apply(this.canvas, W, H, this.view.dpr);
      return;
    }
    const low = this.mLifeAmount <= 1 ? 1 : 0;
    fx.drawDanger(g, W, H, low && this.state === 'play' ? 0.85 : 0, this.t);

    this.drawHud(g);
    this.post.apply(this.canvas, W, H, this.view.dpr);

    // [加强] 死亡瞬间的放射拉伸
    if (fx.zoom > 0.002) {
      const c = this.canvas;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(fx.zoom * 1.4, 0, 0.4);
      for (let i = 1; i <= 3; i++) {
        const s = 1 + fx.zoom * i * 0.5;
        g.drawImage(c, (c.width - c.width * s) / 2, (c.height - c.height * s) / 2, c.width * s, c.height * s);
      }
      g.restore();
      g.setTransform(this.view.scale, 0, 0, this.view.scale, 0, 0);
    }
    if (this.showFps) this.drawFps(g);
  }

  /* ---------------- HUD（布局锚点沿用原版 MainView.drawSelf） ---------------- */
  drawHud(g) {
    const { W, H } = FIELD;
    const p = this.world.player;
    g.save();
    // 顶部渐隐蒙版，保证文字可读
    const veil = g.createLinearGradient ? g.createLinearGradient(0, 0, 0, 92) : null;
    if (veil) {
      veil.addColorStop(0, withAlpha('#0a0705', 0.55));
      veil.addColorStop(1, withAlpha('#0a0705', 0));
      g.fillStyle = veil;
      g.fillRect(0, 0, W, 92);
    }
    // 暂停按钮
    const b = HUD.pauseBtn;
    g.save();
    g.globalAlpha = 0.9;
    roundRectPath(g, b.x, b.y, b.w, b.h, 8);
    g.fillStyle = withAlpha('#120d09', 0.55);
    g.fill();
    g.strokeStyle = withAlpha('#e9a101', 0.5);
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = '#f4c463';
    if (this.state === 'pause') {
      g.beginPath();
      g.moveTo(b.x + 11, b.y + 8);
      g.lineTo(b.x + 23, b.y + 15);
      g.lineTo(b.x + 11, b.y + 22);
      g.closePath();
      g.fill();
    } else {
      g.fillRect(b.x + 10, b.y + 9, 3.4, 12);
      g.fillRect(b.x + 17, b.y + 9, 3.4, 12);
    }
    g.restore();

    // 积分（原版 #eb a101 40px）
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = '700 13px "Rajdhani","Noto Sans SC",system-ui,sans-serif';
    g.fillStyle = withAlpha('#e9a101', 0.75);
    g.fillText('积分 SCORE', HUD.scoreText.x, b.y + 9);
    g.font = '700 27px "Rajdhani",system-ui,sans-serif';
    g.fillStyle = '#ffd88c';
    g.shadowColor = withAlpha('#e9a101', 0.9);
    g.shadowBlur = 12;
    g.fillText(fmt(this.sumScore), HUD.scoreText.x, b.y + 26);
    g.shadowBlur = 0;

    // 等级（原版右上角「等级 X n」）
    g.textAlign = 'right';
    g.font = '700 13px "Rajdhani","Noto Sans SC",system-ui,sans-serif';
    g.fillStyle = withAlpha('#e9a101', 0.75);
    g.fillText('等级 LEVEL', W - 14, b.y + 9);
    g.font = '700 24px "Rajdhani",system-ui,sans-serif';
    g.fillStyle = '#ffd88c';
    g.fillText('X ' + this.speedTime, W - 14, b.y + 27);
    // 升级进度条
    const prev = (this.speedTime - 1) * GC.LEVELUP_SCORE;
    const nf = this.speedTime >= GC.MAXGRADE ? 1 : clamp((this.sumScore - prev) / GC.LEVELUP_SCORE, 0, 1);
    g.fillStyle = withAlpha('#000000', 0.5);
    g.fillRect(W - 96, b.y + 40, 82, 3);
    g.fillStyle = withAlpha('#ffd88c', 0.9);
    g.fillRect(W - 96, b.y + 40, 82 * nf, 3);
    g.restore();

    // 连击
    if (this.combo > 2) {
      g.save();
      g.textAlign = 'right';
      g.globalAlpha = clamp(this.comboT / TUNING.COMBO_WINDOW_MS, 0, 1);
      g.font = '800 20px "Rajdhani",system-ui,sans-serif';
      g.fillStyle = '#ff8a5c';
      g.fillText(`×${this.combo} COMBO`, W - 14, 104);
      g.restore();
    }

    // BOSS 血条
    if (this.boss.alive && this.boss.y >= 0) this.drawBossBar(g);

    // 底部：生命 / 导弹（原版用 life_amount、missile_bt 图标 + 「X n」）
    g.save();
    const vfade = g.createLinearGradient ? g.createLinearGradient(0, H - 86, 0, H) : null;
    if (vfade) {
      vfade.addColorStop(0, withAlpha('#0a0705', 0));
      vfade.addColorStop(1, withAlpha('#0a0705', 0.6));
      g.fillStyle = vfade;
      g.fillRect(0, H - 86, W, 86);
    }
    const lx = W - 150;
    const ly = H - 52;
    g.globalAlpha = this.mLifeAmount > 0 ? 1 : 0.35;
    // HUD 用矢量心形（原版 life_amount.png 40x40 的等价图形化）
    g.save();
    g.translate(lx + 17, ly + 17);
    g.scale(1.55, 1.55);
    g.beginPath();
    g.moveTo(0, 8);
    g.bezierCurveTo(-12, -1, -6.5, -10, 0, -4.4);
    g.bezierCurveTo(6.5, -10, 12, -1, 0, 8);
    g.closePath();
    g.fillStyle = withAlpha('#46e6a0', 0.95);
    g.shadowColor = withAlpha('#46e6a0', 0.9);
    g.shadowBlur = 10;
    g.fill();
    g.restore();
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '800 21px "Rajdhani",system-ui,sans-serif';
    g.fillStyle = '#bff7dd';
    g.fillText('X ' + Math.max(0, this.mLifeAmount), lx + 38, ly + 17);
    g.globalAlpha = 1;

    // 导弹按钮
    const mb = HUD.missileBtn;
    const ready = this.missileCount > 0;
    roundRectPath(g, mb.x, mb.y, mb.w + 44, mb.h + 4, 10);
    g.fillStyle = withAlpha('#120d09', 0.55);
    g.fill();
    g.strokeStyle = withAlpha(ready ? '#ffb03a' : '#5a4a34', 0.75);
    g.lineWidth = 1.3;
    g.stroke();
    g.globalAlpha = ready ? 1 : 0.4;
    g.drawImage(this.art.goodsMissile.c, mb.x + 4, mb.y + 1, 38, 38);
    g.globalAlpha = 1;
    g.font = '800 22px "Rajdhani",system-ui,sans-serif';
    g.fillStyle = ready ? '#ffd88c' : '#7a6a55';
    g.fillText('X ' + this.missileCount, mb.x + 48, mb.y + 20);
    // 导弹引爆冷却环
    if (p.missileState) {
      const f = 1 - p.missileT / GC.MISSILEBOOM_TIME;
      g.strokeStyle = withAlpha('#fff2c8', 0.9);
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(mb.x + 23, mb.y + 20, 24, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      g.stroke();
    }
    // 武器状态
    const wt = { 100: '蓝色激光', 101: '双螺旋粒子炮', 102: '追踪战斧' }[p.bulletType];
    const wc = { 100: '#8fe9ff', 101: '#e6b3ff', 102: '#ff9a7a' }[p.bulletType];
    g.font = '700 13px "Rajdhani","Noto Sans SC",system-ui,sans-serif';
    g.fillStyle = withAlpha(wc, 0.95);
    g.fillText(wt, mb.x + 4, mb.y - 14);
    if (p.specialLeft > 0) {
      g.fillStyle = withAlpha('#000000', 0.5);
      g.fillRect(mb.x + 4, mb.y - 6, 92, 3);
      g.fillStyle = wc;
      g.fillRect(mb.x + 4, mb.y - 6, 92 * p.specialLeft, 3);
    }
    g.restore();

    // 状态提示（暂停 / 准备）
    if (this.state === 'pause') {
      g.save();
      g.fillStyle = withAlpha('#05070c', 0.62);
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#ffe6b8';
      g.font = '800 34px "Rajdhani","Noto Sans SC",system-ui,sans-serif';
      g.fillText('已暂停', W / 2, H / 2 - 8);
      g.font = '500 15px "Noto Sans SC",system-ui,sans-serif';
      g.fillStyle = withAlpha('#ffe6b8', 0.7);
      g.fillText('点击左上角按钮或按 P 继续', W / 2, H / 2 + 24);
      g.restore();
    }
  }
  drawBossBar(g) {
    const { W } = FIELD;
    const b = this.boss;
    const bw = W - 68;
    const x = 34;
    const y = 58;
    const f = clamp(b.blood / b.bloodVolume, 0, 1);
    g.save();
    g.textAlign = 'center';
    g.font = '700 12px "Rajdhani","Noto Sans SC",system-ui,sans-serif';
    g.fillStyle = withAlpha(b.stateColor, 0.95);
    g.fillText(`要塞 BOSS · ${b.stateName}`, W / 2, y - 5);
    g.fillStyle = withAlpha('#0b0806', 0.72);
    roundRectPath(g, x - 2, y, bw + 4, 12, 5);
    g.fill();
    const gr = g.createLinearGradient ? g.createLinearGradient(x, y, x + bw * f, y) : null;
    if (gr) {
      gr.addColorStop(0, withAlpha('#ff6a2a', 0.85));
      gr.addColorStop(1, '#ffd88c');
      g.fillStyle = gr;
    } else g.fillStyle = '#ffb03a';
    g.fillRect(x, y + 2, bw * f, 8);
    g.fillStyle = withAlpha('#fff6d8', 0.5);
    g.fillRect(x, y + 2, bw * f, 1.6);
    // 阶段刻度（愤怒/疯狂/极限阈值）
    for (const t of [GC.BOSSPLANE_ANGER_BLOOD, GC.BOSSPLANE_CRAZY_BLOOD, GC.BOSSPLANE_LIMIT_BLOOD]) {
      const px = x + bw * (t / b.bloodVolume);
      g.fillStyle = withAlpha('#0b0806', 0.9);
      g.fillRect(px - 1, y, 2, 12);
    }
    g.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(this.t * 0.006));
    g.strokeStyle = withAlpha(b.stateColor, 0.8);
    g.lineWidth = 1;
    roundRectPath(g, x - 2, y, bw + 4, 12, 5);
    g.stroke();
    g.restore();
  }
  drawFps(g) {
    const a = this._fpsAcc;
    if (!a.length) return;
    const avg = a.reduce((s, v) => s + v, 0) / a.length;
    g.save();
    g.font = '600 11px monospace';
    g.fillStyle = '#8fe9ff';
    g.textAlign = 'left';
    g.fillText(`${(1000 / avg).toFixed(0)} fps · 粒子 ${this.fx.p.count} · 弹 ${this.world.bullets.length}`, 12, FIELD.H - 74);
    g.restore();
  }
  get hitboxes() {
    const b = HUD.pauseBtn;
    const mb = HUD.missileBtn;
    return {
      pause: { x: b.x, y: b.y, w: b.w + 8, h: b.h + 8 },
      missile: { x: mb.x, y: mb.y - 8, w: mb.w + 44, h: mb.h + 20 },
    };
  }
}

const NOOP_AUDIO = {
  play() {},
  setLevel() {},
  setTense() {},
  resume() {},
  startMusic() {},
  stopMusic() {},
};

/* 道具积分门槛的字段映射（原版各自独立累加器，这里保持一致） */
const setKey = { 0: 'bulletScore', 1: 'bulletScore2', 2: 'missileScore', 3: 'lifeScore' };

function roundRectPath(g, x, y, w, h, r) {
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

const TAU = Math.PI * 2;

export default Game;
