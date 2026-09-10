/**
 * config.js —— 《沙漠风暴 StormPlane》HTML5 版 数据层
 *
 * 本文件是 Android 原版三个常量接口的 1:1 移植，数值未做任何修改：
 *   app/src/main/java/com/hurteng/stormplane/constant/GameConstant.java
 *   app/src/main/java/com/hurteng/stormplane/constant/ConstantUtil.java
 *   app/src/main/java/com/hurteng/stormplane/constant/DebugConstant.java
 *
 * 「美术优化 + 手感加强」相关的可调项集中在 TUNING / MODES 中，
 * 经典模式 (classic) 下所有倍率均为 1，等价于原版数据。
 */

/* ------------------------------------------------------------------ *
 * GameConstant —— 游戏数据常量（原样保留）
 * ------------------------------------------------------------------ */
export const GameConstant = {
  // 初始相关
  LIFEAMOUNT: 5, // 初始生命值
  MISSILECOUNT: 5, // 初始导弹数
  LIFE_MAXCOUNT: 9, // 生命最大值
  MISSILE_MAXCOUNT: 9, // 导弹最大存有量
  GAMESPEED: 1, // 游戏初始速度倍率
  MAXGRADE: 6, // 游戏最高等级/速度倍率
  LEVELUP_SCORE: 50000, // 升级所需的积分

  // 敌机总数量
  SMALLPLANE_COUNT: 10, // 小型机
  MIDDLEPLANE_COUNT: 8, // 中型机
  BIGPLANE_COUNT: 10, // 大型机
  BOSSPLANE_COUNT: 1, // Boss

  // 敌机血量
  SMALLPLANE_BLOOD: 1,
  MIDDLEPLANE_BLOOD: 40,
  BIGPLANE_BLOOD: 120,
  BOSSPLANE_BLOOD: 1000,
  BOSSPLANE_ANGER_BLOOD: 700, // 愤怒状态阈值
  BOSSPLANE_CRAZY_BLOOD: 500, // 疯狂状态阈值
  BOSSPLANE_LIMIT_BLOOD: 150, // 极限状态阈值

  // 敌机分数
  SMALLPLANE_SCORE: 100,
  MIDDLEPLANE_SCORE: 300,
  BIGPLANE_SCORE: 800,
  BOSSPLANE_SCORE: 2000,

  // 物品/敌机出现所需的积分值
  MIDDLEPLANE_APPEARSCORE: 2000,
  BIGPLANE_APPEARSCORE: 8000,
  BOSSPLANE_APPEARSCORE: 30000,
  MISSILE_APPEARSCORE: 5000,
  LIFE_APPEARSCORE: 10000,
  BULLET1_APPEARSCORE: 3000,
  BULLET2_APPEARSCORE: 7000,

  // 伤害值
  MISSILE_HARM: 80,
  MYBULLET_HARM: 1, // 我方初始子弹
  MYBULLET1_HARM: 4, // 紫色双螺旋
  MYBULLET2_HARM: 5, // 红色追踪战斧

  // 我军速度（单位：像素 / 逻辑帧）
  MYBULLET_SPEED: 80,
  MYBULLET1_SPEED: 100,
  MYBULLET2_SPEED: 120,
  MYPLANE_SPEED: 30,

  // 敌机速度
  BIGPLANE_SPEED: 3,

  // 持续显示时间（毫秒）
  BOOM_TIME: 2000, // 我方飞机炸毁
  INVINCIBLE_TIME: 5000, // 我方飞机无敌模式
  MISSILEBOOM_TIME: 500, // 我方导弹爆炸
  MYSPECIALBULLET_DURATION: 15000, // 我方特殊子弹持续时间
};

/* ------------------------------------------------------------------ *
 * ConstantUtil —— 方向 / 子弹类型常量
 * ------------------------------------------------------------------ */
export const ConstantUtil = {
  DIR_LEFT_UP: 1,
  DIR_RIGHT_UP: 2,
  DIR_LEFT_DOWN: 3,
  DIR_RIGHT_DOWN: 4,
  DIR_LEFT: 5,
  DIR_RIGHT: 6,
  TO_MAIN_VIEW: 7,
  TO_END_VIEW: 8,
  END_GAME: 9,

  DIR_UP: 10,
  DIR_DOWN: 11,
  DIR_TEMP: 12,

  // 我方子弹类型
  MYBULLET: 100,
  MYBULLET1: 101,
  MYBULLET2: 102,

  // boss 子弹类型
  BOSSBULLET_DEFAULT: 110,
  BOSSBULLET_ANGER: 111,
  BOSSBULLET_CRAZY: 112,
  BOSSBULLET_LIMIT: 113,
};

/* ------------------------------------------------------------------ *
 * DebugConstant —— 调试开关（保持原版默认值）
 * ------------------------------------------------------------------ */
export const DebugConstant = {
  ETERNAL: false, // 不死之身
  DOUBLECLICK_EXIT: true, // 双击退出
  INVINCIBLE: true, // 无敌模式（受伤后短暂无敌）
  MISSILEGOODS_APPEAR: true,
  LIFEGOODS_APPEAR: true,
  BULLETGOODS1_APPEAR: true,
  BULLETGOODS2_APPEAR: true,
};

/* ------------------------------------------------------------------ *
 * 逻辑帧：原版主循环每 100ms 一帧（MainView.run 中 Thread.sleep(100-…)）
 * 所有 speed / interval 数值均以「像素每逻辑帧」为单位。
 * ------------------------------------------------------------------ */
export const TICK_MS = 100;

/* 逻辑战场尺寸（原版素材为 mdpi，机型约 480x800；boss 宽 200 占比与原版一致） */
export const FIELD = { W: 480, H: 800 };

/* ------------------------------------------------------------------ *
 * 原版美术尺寸表 —— 来自 app/src/main/res/drawable-mdpi/
 * frames / collisionBox 的规则与各 *Plane.initBitmap() 完全一致，
 * 例如 SmallPlane: width=sheet[0], height=sheet[1]/3
 * ------------------------------------------------------------------ */
export const SHEETS = {
  myplane: { sheet: [150, 50], frames: 3, box: [50, 50], note: 'MyPlane: w=sheet.w/3, h=sheet.h' },
  small: { sheet: [40, 123], frames: 3, box: [40, 41], note: 'SmallPlane: h=sheet.h/3' },
  middle: { sheet: [65, 345], frames: 4, box: [65, 86], note: 'MiddlePlane: h=sheet.h/4' },
  big: { sheet: [120, 685], frames: 5, box: [120, 137], note: 'BigPlane: h=sheet.h/5' },
  boss: { sheet: [200, 400], frames: 2, box: [200, 200], note: 'BossPlane: h=sheet.h/2' },
  bossCrazy: { sheet: [200, 400], frames: 2, box: [200, 200] },
  bossBomb: { sheet: [200, 1000], frames: 5, box: [200, 200] },
  bullets: {
    myBulletBlue: [20, 63],
    myBulletPurple: [40, 80],
    myBulletRed: [64, 64],
    bigplaneBullet: [48, 44],
    bossBulletDefault: [50, 100],
    bossSunParticle: [40, 40],
    bossTriangle: [35, 35],
    bossThunder: [48, 44],
    bossHellfire: [44, 133],
    goods: [50, 50],
    lifeIcon: [40, 40],
    missileIcon: [40, 40],
    shield: [150, 128],
    boom: [304, 304],
  },
};

/* 敌机出生点错开用的队距（原版 -object_height * (currentCount * 2 + 1)） */
export const SPAWN_DEPTH_STEP = 2;

/* ------------------------------------------------------------------ *
 * MODES —— 经典 = 原版数据；风暴 = 在原版数据之上的「加强」编排
 * 说明：两种模式的血量/分数/伤害/阈值全部沿用 GameConstant，
 * 风暴模式只改变「出怪编排」与「弹幕密度」，不改变单次伤害数值。
 * ------------------------------------------------------------------ */
export const MODES = {
  classic: {
    id: 'classic',
    name: '经典',
    desc: '完全沿用原版数值与出怪节奏',
    waveScale: 1.0, // 出生队列密度
    bigEscort: 0, // 大型机护卫机数
    bossBulletBonus: 0, // Boss 弹夹额外数
    itemBias: 1.0, // 道具出现后的停留倾向
    playerAgility: 1.0, // 机体机动性倍率（MYPLANE_SPEED 的倍率）
    rankUp: 0,
  },
  storm: {
    id: 'storm',
    name: '风暴',
    desc: '敌群更密、弹幕更华丽（数值仍取自原版常量）',
    waveScale: 1.5,
    bigEscort: 2,
    bossBulletBonus: 2,
    itemBias: 1.25,
    playerAgility: 2.0,
    rankUp: 0,
  },
};

/* ------------------------------------------------------------------ *
 * TUNING —— 表现层参数（不影响任何战斗数值）
 * ------------------------------------------------------------------ */
export const TUNING = {
  // 背景滚动：原版 viewLogic 每帧 +10 像素
  BG_SPEED: 10,
  // 画面
  SUPERSAMPLE: 2, // 精灵图超采样倍数（2=平衡 3=精细）
  BLOOM_SCALE: 0.5, // 辉光缓冲相对倍率
  MAX_DT: 50, // 单帧最大推进毫秒，防止切后台后瞬移
  // 手感加强（纯表现）
  HITSTOP_BOSS_MS: 90,
  HITSTOP_KILL_MS: 35,
  SHAKE_DECAY: 0.88,
  // 计分板：原版击落分数不变，这里只是展示用的连击统计
  COMBO_WINDOW_MS: 1400,
};

/* HUD 锚点：尽量沿用原版 MainView.drawSelf 的布局位置 */
export const HUD = {
  pauseBtn: { x: 10, y: 10, w: 30, h: 30 }, // 原版 play.png 30x60(两帧) 裁剪
  scoreText: { x: 52, y: 50 }, // 原版 30 + play_bt_w
  levelText: { x: FIELD.W - 160, y: 50 },
  lifeIcon: { x: FIELD.W - 150, y: FIELD.H - 50 },
  missileBtn: { x: 10, y: FIELD.H - 10 - 40, w: 40, h: 40 },
  color: '#e9a101', // 原版 Color.rgb(235,161,1)
};

export default { GameConstant, ConstantUtil, DebugConstant, TICK_MS, FIELD, SHEETS, MODES, TUNING, HUD };
