/**
 * main.js —— 引导层：屏幕切换、输入、设置持久化、性能自适应
 */

import { Game } from './game.js';
import { Audio } from './audio.js';
import { FIELD, MODES, GameConstant as GC } from './config.js';
import { store, clamp, fmt } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const canvas = $('#game');
const frame = $('#frame');
const bgArt = $('#bgArt');
const toastEl = $('#toast');
const audio = new Audio();

const SKEY = 'stormplane.settings.v1';
const DEFAULTS = {
  bloom: 1,
  quality: 1,
  shake: true,
  hitstop: true,
  hidpi: true,
  control: 'auto',
  agility: 1,
  hitbox: 1,
  sfx: true,
  music: true,
  fps: false,
  mode: 'classic',
};
let settings = Object.assign({}, DEFAULTS, store.get(SKEY, {}) || {});

// 注意：Game 构造期间会调用 reset() → onState，因此回调必须等本模块
// 里的 screen / showScreen 等声明完成后再挂，避免模块顶层的暂时性死区（TDZ）。
const game = new Game(canvas, {
  audio,
  quality: settings.quality,
  ss: settings.hidpi && window.devicePixelRatio > 1.5 ? 3 : 2,
});

/* ------------------------------------------------------------------ *
 * 布局
 * ------------------------------------------------------------------ */
function layout() {
  const r = frame.getBoundingClientRect();
  const dpr = settings.hidpi ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  game.resize(r.width, r.height, dpr);
}
let ro;
if (window.ResizeObserver) {
  ro = new ResizeObserver(() => layout());
  ro.observe(frame);
}
window.addEventListener('resize', layout, { passive: true });
window.addEventListener('orientationchange', () => setTimeout(layout, 240), { passive: true });

/* ------------------------------------------------------------------ *
 * 屏幕
 * ------------------------------------------------------------------ */
let screen = 'title';
let returnTo = 'title'; // 帮助/设置面板的返回目标
function showScreen(name) {
  screen = name;
  $$('.panel', frame).forEach((p) => p.classList.toggle('is-on', p.dataset.screen === name));
  document.body.classList.toggle('is-menu', !!name);
  bgArt.classList.toggle('is-on', name === 'title' || name === 'help' || name === 'settings');
  if (name === 'title') {
    game.state = 'idle';
    $('#bestScore').textContent = fmt(store.get('stormplane.best', 0) || 0);
    audio.stopMusic();
  } else if (name === null) {
    game.state = 'play';
    audio.resume().then(() => audio.startMusic());
  } else {
    game.pause();
  }
}
function applyState(s) {
  if (s === 'pause') showScreen('pause');
  else if (s === 'play' && screen !== null) showScreen(null);
}

/* ------------------------------------------------------------------ *
 * 设置
 * ------------------------------------------------------------------ */
function saveSettings() {
  store.set(SKEY, settings);
}
function applySettings() {
  game.post.enabled = settings.bloom > 0;
  game.post.strength = settings.bloom === 2 ? 0.62 : 0.42;
  game.fx.setQuality(settings.quality);
  game.allowShake = settings.shake;
  game.allowHitstop = settings.hitstop;
  game.showFps = settings.fps;
  game.hitboxScale = settings.hitbox;
  game.agility = settings.agility;
  audio.setSfx(settings.sfx);
  audio.setMusic(settings.music);
  if (screen === 'title') game.state = 'idle';
  layout();
}
function bindSettings() {
  $$('[data-set]', frame).forEach((el) => {
    const key = el.dataset.set;
    if (!(key in settings)) return;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = String(settings[key]);
    const onChange = () => {
      const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? (isNaN(+el.value) ? el.value : +el.value) : +el.value;
      settings[key] = v;
      saveSettings();
      applySettings();
      if (key === 'sfx' && v) audio.play('ui', 0.6);
      if (key === 'quality' || key === 'bloom') toast(`画质已切换：${['精简', '标准', '华丽'][v] ?? v}`);
    };
    el.addEventListener('change', onChange);
  });
}
bindSettings();
applySettings();

/* 模式选择 */
function setMode(id) {
  settings.mode = id;
  saveSettings();
  game.setMode(id);
  // 模式联动默认值：风暴模式给更宽松的判定与更高机动
  if (id === 'storm') {
    if (settings.hitbox === DEFAULTS.hitbox) game.hitboxScale = 0.75;
    if (settings.agility === DEFAULTS.agility) game.agility = 1.6;
  } else {
    game.hitboxScale = settings.hitbox;
    game.agility = settings.agility;
  }
  $$('.mode').forEach((b) => {
    const on = b.dataset.mode === id;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('#titleHint').textContent =
    id === 'storm' ? '风暴模式：敌群更密，判定 75%，机动 ×1.6 —— 数值仍取原版常量' : '经典模式：与 Android 原版完全一致的数据与节奏';
}
$$('.mode').forEach((b) => b.addEventListener('click', () => { audio.play('ui', 0.6); setMode(b.dataset.mode); }));
setMode(settings.mode in MODES ? settings.mode : 'classic');

/* ------------------------------------------------------------------ *
 * toast
 * ------------------------------------------------------------------ */
let toastT = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('is-on'), 1800);
}

/* ------------------------------------------------------------------ *
 * 输入
 * ------------------------------------------------------------------ */
const keys = new Set();
let drag = null;

function pointerToField(e) {
  const r = canvas.getBoundingClientRect();
  return game.toField(e.clientX, e.clientY, r);
}
function hitZone(p, zone) {
  return p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h;
}
canvas.addEventListener('pointerdown', (e) => {
  if (screen !== null) return;
  e.preventDefault();
  audio.resume();
  const p = pointerToField(e);
  const zones = game.hitboxes;
  if (hitZone(p, zones.pause)) {
    game.pause();
    return;
  }
  if (hitZone(p, zones.missile)) {
    if (!game.useMissile()) toast('没有导弹了，击落敌机或拾取导弹补给');
    return;
  }
  const rel = settings.control === 'rel' || (settings.control === 'auto' && e.pointerType === 'touch');
  const pl = game.world.player;
  drag = { id: e.pointerId, rel, x0: p.x, y0: p.y, cx: pl.cx, cy: pl.cy };
  if (!rel) {
    game.world.pointer.x = p.x;
    game.world.pointer.y = p.y;
  }
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (screen !== null) return;
  const p = pointerToField(e);
  if (drag && drag.id === e.pointerId) {
    if (drag.rel) {
      game.world.pointer.x = clamp(drag.cx + (p.x - drag.x0), 0, FIELD.W);
      game.world.pointer.y = clamp(drag.cy + (p.y - drag.y0), 0, FIELD.H);
    } else {
      game.world.pointer.x = p.x;
      game.world.pointer.y = p.y;
    }
  } else if (!drag) {
    // 鼠标悬停即跟随（更跟手的桌面手感）
    if (e.pointerType === 'mouse' && settings.control !== 'rel') {
      game.world.pointer.x = p.x;
      game.world.pointer.y = p.y;
    }
  }
}, { passive: true });

const endDrag = (e) => {
  if (drag && (!e || drag.id === e.pointerId)) drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', (e) => {
  endDrag(e);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener(
  'keydown',
  (e) => {
    const k = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (k === 'Enter') {
      if (screen === 'title') startGame();
      else if (screen === 'over') startGame();
      else if (screen === 'pause') game.resume();
      return;
    }
    if (k === 'Escape' || k === 'KeyP') {
      if (screen === null) game.pause();
      else if (screen === 'pause') game.resume();
      else if (screen === 'help' || screen === 'settings') closeOverlay();
      return;
    }
    if (k === 'Space' && screen === null) {
      if (!game.useMissile()) toast('没有导弹了，击落敌机或拾取导弹补给');
      return;
    }
    keys.add(k);
  },
  { passive: false }
);
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (screen === null) game.pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === null) game.pause();
});

// 键盘操控：每帧推动 pointer（受 MYPLANE_SPEED 上限约束）
const KEY_STEP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
function readKeys(dt) {
  let dx = 0;
  let dy = 0;
  for (const k of keys) {
    const v = KEY_STEP[k];
    if (v) {
      dx += v[0];
      dy += v[1];
    }
  }
  if (!dx && !dy) return;
  const step = GC.MYPLANE_SPEED * game.agility * (dt / 100) * 1.4;
  const n = Math.hypot(dx, dy) || 1;
  game.world.pointer.x = clamp(game.world.pointer.x + (dx / n) * step, 0, FIELD.W);
  game.world.pointer.y = clamp(game.world.pointer.y + (dy / n) * step, 0, FIELD.H);
}

/* ------------------------------------------------------------------ *
 * 按钮
 * ------------------------------------------------------------------ */
function startGame() {
  showScreen(null);
  game.reset();
  game.start();
  audio.resume().then(() => {
    audio.startMusic();
    audio.setLevel(game.speedTime);
  });
}
function closeOverlay() {
  if (returnTo === 'pause' || game.state === 'pause') showScreen('pause');
  else if (game.state === 'over') showScreen('over');
  else if (game.state === 'play' || game.state === 'dying') showScreen(null);
  else showScreen('title');
}
$('#btnStart').addEventListener('click', startGame);
$$('[data-open]').forEach((b) =>
  b.addEventListener('click', () => {
    audio.play('ui', 0.6);
    returnTo = screen === 'help' || screen === 'settings' ? returnTo : screen || 'title';
    showScreen(b.dataset.open);
  })
);
$$('[data-act]').forEach((b) =>
  b.addEventListener('click', () => {
    const a = b.dataset.act;
    audio.play('ui', 0.55);
    if (a === 'resume') game.resume();
    else if (a === 'restart') startGame();
    else if (a === 'quit') showScreen('title');
    else if (a === 'close') closeOverlay();
  })
);

/* ------------------------------------------------------------------ *
 * 结算
 * ------------------------------------------------------------------ */
const RANKS = [
  [0, '新兵 · 首次出击'],
  [5000, '列兵 · 已适应沙尘'],
  [15000, '王牌 · 沙漠巡航者'],
  [30000, '精英 · 要塞撕裂者'],
  [60000, '传奇 · 风暴之主'],
  [120000, '天空之王'],
];
function rankOf(score) {
  let r = RANKS[0][1];
  for (const [need, name] of RANKS) if (score >= need) r = name;
  return r;
}
function showOver(s) {
  $('#overScore').textContent = fmt(s.score);
  $('#overKicker').textContent = s.isRecord && s.score > 0 ? 'NEW RECORD' : 'MISSION FAILED';
  $('#overGrid').innerHTML = [
    ['等级', `X ${s.level}`],
    ['存活时长', `${s.time}s`],
    ['击落总数', fmt(s.total)],
    ['最高连击', `×${s.combo}`],
    ['小型机', `${s.kills.small} × ${GC.SMALLPLANE_SCORE}`],
    ['中型机', `${s.kills.middle} × ${GC.MIDDLEPLANE_SCORE}`],
    ['大型机', `${s.kills.big} × ${GC.BIGPLANE_SCORE}`],
    ['BOSS', `${s.kills.boss} × ${GC.BOSSPLANE_SCORE}`],
  ]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
    .join('');
  $('#overRank').innerHTML =
    `评定：<em>${rankOf(s.score)}</em>` +
    (s.isRecord && s.score > 0 ? `　新纪录！原最高 ${fmt(s.prevBest)}` : `　距最高分还差 ${fmt(Math.max(0, s.best - s.score))}`);
  audio.stopMusic();
  showScreen('over');
  $('#bestScore').textContent = fmt(store.get('stormplane.best', 0) || 0);
}

/* ------------------------------------------------------------------ *
 * 侧栏实时数据 + 性能自适应
 * ------------------------------------------------------------------ */
let uiT = 0;
let perfT = 0;
let perfAcc = 0;
let perfN = 0;
function syncUI(dt) {
  uiT -= dt;
  if (uiT <= 0) {
    uiT = 120;
    const s = game.stats();
    $('#liveScore').textContent = fmt(s.score);
    $('#liveLevel').textContent = s.level;
    $('#liveLife').textContent = Math.max(0, s.life);
    $('#liveMissile').textContent = s.missiles;
    $('#liveCombo').textContent = game.combo;
    $('#kSmall').textContent = s.kills.small;
    $('#kMiddle').textContent = s.kills.middle;
    $('#kBig').textContent = s.kills.big;
    $('#kBoss').textContent = s.kills.boss;
    $('#spLife').textContent = `${s.life} / ${GC.LIFE_MAXCOUNT}`;
    $('#spMissile').textContent = `${s.missiles} / ${GC.MISSILE_MAXCOUNT}`;
    const ps = $('#pauseStats');
    if (screen === 'pause' && ps) {
      ps.innerHTML = [
        ['积分', fmt(s.score)],
        ['等级', s.level],
        ['击落', s.total],
      ]
        .map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`)
        .join('');
    }
  }
  // 掉帧时自动降级（只降不升，避免来回抖动）
  if (settings.quality > 0 || settings.bloom > 0) {
    perfT += dt;
    perfAcc += dt;
    perfN++;
    if (perfT > 2400) {
      const avg = perfAcc / perfN;
      if (avg > 26) {
        if (settings.bloom > 0) {
          settings.bloom = 0;
          toast('检测到掉帧，已关闭泛光');
        } else if (settings.quality > 0) {
          settings.quality = settings.quality - 1;
          toast('检测到掉帧，已降低粒子密度');
        }
        saveSettings();
        bindSync();
        applySettings();
      }
      perfT = 0;
      perfAcc = 0;
      perfN = 0;
    }
  }
}
function bindSync() {
  $$('[data-set]', frame).forEach((el) => {
    const key = el.dataset.set;
    if (!(key in settings)) return;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = String(settings[key]);
  });
}

/* ------------------------------------------------------------------ *
 * 主循环：交给 Game 的单一 rAF，UI 层通过 onFrame 挂钩
 * ------------------------------------------------------------------ */
game.onFrame = (dt) => {
  if (screen === null) readKeys(dt);
  syncUI(dt);
};

/* 状态回调在模块末尾绑定（此时 showScreen / showOver 已初始化） */
game.onState = (s) => applyState(s);
game.onGameOver = (stats) => showOver(stats);

/* 启动：标题页先跑起来（背景 + 游战机群做动态展示） */
game.state = 'idle';
game.start();
layout();
showScreen('title');

// 调试出口
window.STORM = { game, audio, settings, showScreen, startGame, GC, MODES };
console.log(
  '%c沙漠风暴 · StormPlane HTML5%c\n数据层：GameConstant 全量移植（' + Object.keys(GC).length + ' 项常量）\n美术层：程序化矢量精灵 + 粒子 + 泛光',
  'color:#ffd88c;font:700 14px/1.6 sans-serif;background:#1a1206;padding:2px 8px;border-radius:6px',
  'color:#9a8f80'
);
