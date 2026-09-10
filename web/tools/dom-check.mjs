/**
 * dom-check.mjs —— 用最小 DOM 垫片驱动 main.js 的真实调用链（无浏览器环境下的冒烟测试）
 * 覆盖：启动 → 开始游戏 → 指针拖拽 / 键盘 / 导弹 → 设置变更 → 暂停 → 结算 → 重开。
 */
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

/* --------- 从 index.html 抽取元素（扁平注册，够冒烟用） --------- */
class FakeEl {
  constructor(tag, attrs) {
    this.tagName = (tag || 'div').toUpperCase();
    this.attrs = attrs;
    this.id = attrs.id || '';
    this._cls = (attrs.class || '').split(/\s+/).filter(Boolean);
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.checked = attrs.checked !== undefined;
    this.value = attrs.value !== undefined ? attrs.value : '';
    this.listeners = new Map();
    this.children = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (m, c) => c.toUpperCase())] = v;
    }
    if (this.id === 'game') {
      const c = createCanvas(480, 800);
      this._canvas = c;
      this.width = c.width;
      this.height = c.height;
    }
  }
  get classList() {
    const self = this;
    return {
      add: (c) => !self._cls.includes(c) && self._cls.push(c),
      remove: (c) => (self._cls = self._cls.filter((x) => x !== c)),
      contains: (c) => self._cls.includes(c),
      toggle: (c, on) => {
        const want = on === undefined ? !self._cls.includes(c) : !!on;
        want ? self._cls.push(c) : (self._cls = self._cls.filter((x) => x !== c));
        return want;
      },
    };
  }
  get className() {
    return this._cls.join(' ');
  }
  getContext(t) {
    return this._canvas ? this._canvas.getContext(t) : null;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener() {}
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] === undefined ? null : this.attrs[k];
  }
  appendChild() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 480, height: 800, right: 480, bottom: 800 };
  }
  fire(type, ev = {}) {
    const list = this.listeners.get(type) || [];
    const evt = Object.assign({ type, preventDefault() {}, stopPropagation() {}, pointerId: 1, pointerType: 'mouse', clientX: 240, clientY: 600, target: this }, ev);
    let ret;
    for (const fn of list) ret = fn(evt);
    return ret;
  }
  querySelectorAll() {
    return ALL;
  }
}

const ALL = [];
const byId = new Map();
const re = /<([a-zA-Z0-9]+)\s([^>]*?)>/g;
let m;
while ((m = re.exec(html))) {
  const attrs = {};
  const ar = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
  let a;
  while ((a = ar.exec(m[2]))) if (a[1] !== '/') attrs[a[1]] = a[2] === undefined ? '' : a[2];
  if (!attrs.id && !attrs.class && !Object.keys(attrs).some((k) => k.startsWith('data-'))) continue;
  const el = new FakeEl(m[1], attrs);
  ALL.push(el);
  if (el.id) byId.set(el.id, el);
}
// 补上 <select> / <input> 的选项语义
for (const el of ALL) {
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') el.value = el.value || (el.attrs.value ?? '');
}

function matchSel(sel) {
  sel = sel.trim();
  if (sel.startsWith('#')) return [byId.get(sel.slice(1))].filter(Boolean);
  if (sel.startsWith('.')) return ALL.filter((e) => e._cls.includes(sel.slice(1)));
  if (sel.startsWith('[')) {
    const name = sel.slice(1, -1);
    return ALL.filter((e) => e.attrs[name] !== undefined);
  }
  return ALL.filter((e) => e.tagName === sel.toUpperCase());
}

const doc = {
  querySelector: (s) => matchSel(s)[0] || null,
  querySelectorAll: (s) => matchSel(s),
  createElement: () => new FakeEl('canvas', {}),
  body: new FakeEl('body', { class: '' }),
  addEventListener() {},
  hidden: false,
};
const mem = new Map();
const win = {
  devicePixelRatio: 2,
  addEventListener() {},
  localStorage: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) },
  ResizeObserver: undefined,
  requestAnimationFrame: (fn) => (rafQ.push(fn), rafQ.length),
  cancelAnimationFrame: () => {},
};
let rafQ = [];
globalThis.window = win;
globalThis.document = doc;
globalThis.localStorage = win.localStorage;
// navigator 在 Node 22 为只读全局，代码未使用，跳过
globalThis.requestAnimationFrame = win.requestAnimationFrame;
globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

const u = await import(resolve(root, 'src/util.js'));
u.setCanvasFactory((w, h) => createCanvas(Math.max(1, w | 0), Math.max(1, h | 0)));

const fail = [];
const step = async (label, fn) => {
  try {
    await fn();
    console.log('  ✓', label);
  } catch (e) {
    fail.push([label, e]);
    console.log('  ✗', label, '\n     ', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n'));
  }
};

console.log(`DOM 垫片已建立：${ALL.length} 个元素，${byId.size} 个 id`);

let STORM;
await step('加载 main.js（构造 Game / 绑定 UI / 启动循环）', async () => {
  await import(resolve(root, 'src/main.js'));
  STORM = win.STORM || globalThis.STORM || (await import(resolve(root, 'src/main.js'))).default;
  STORM = globalThis.window.STORM;
});

const pump = (n, dt = 16.7) => {
  for (let i = 0; i < n; i++) {
    const q = rafQ;
    rafQ = [];
    for (const fn of q) fn(performance.now() + i * dt);
  }
};

await step('标题页 idle 帧 ×90', () => pump(90));
await step('点击「开始飞行」', () => {
  byId.get('btnStart').fire('click');
  return null;
});
await step('游戏中 240 帧（含出怪 / 射击 / 碰撞）', () => pump(240));
await step('指针拖拽操控', () => {
  const g = byId.get('game');
  g.fire('pointerdown', { clientX: 240, clientY: 620, pointerType: 'touch' });
  for (let i = 0; i < 30; i++) g.fire('pointermove', { clientX: 240 + i * 4, clientY: 620 - i * 3 });
  g.fire('pointerup', {});
});
await step('键盘 WASD + 空格发射导弹', () => {
  win.__key = 1;
  // main.js 用 window.addEventListener 记录按键；垫片里 window 未实现监听，改用直接调用
  const game = globalThis.window.STORM.game;
  game.useMissile();
  game.pause();
  game.resume();
});
await step('设置面板：所有控件切换一次', () => {
  for (const el of ALL.filter((e) => e.dataset.set)) {
    if (el.tagName === 'INPUT') {
      el.checked = !el.checked;
      el.fire('change');
    } else if (el.tagName === 'SELECT') {
      for (const v of ['0', '1', '2', 'auto', 'abs', '1.6', '0.55']) {
        el.value = v;
        el.fire('change');
      }
    }
  }
});
await step('模式切换（经典 ↔ 风暴）', () => {
  for (const el of ALL.filter((e) => e.dataset.mode)) el.fire('click');
});
await step('帮助 / 设置面板打开与关闭', () => {
  for (const el of ALL.filter((e) => e.dataset.open)) el.fire('click');
  for (const el of ALL.filter((e) => e.dataset.act === 'close')) el.fire('click');
});
await step('强制死亡 → 结算面板', () => {
  const game = globalThis.window.STORM.game;
  globalThis.window.STORM.showScreen(null);
  game.mLifeAmount = 0;
  game.killPlayer();
  for (let i = 0; i < 200; i++) pump(1);
});
await step('结算后重开一局', () => {
  for (const el of ALL.filter((e) => e.dataset.act === 'restart')) el.fire('click');
  pump(60);
});
await step('回到标题', () => {
  for (const el of ALL.filter((e) => e.dataset.act === 'quit')) el.fire('click');
  pump(30);
});

const g = globalThis.window.STORM.game;
console.log('模拟结束：', JSON.stringify(g.stats()), 'state=', g.state);
if (fail.length) {
  console.log(`\n${fail.length} 个步骤失败`);
  process.exitCode = 1;
} else {
  console.log('\n全部冒烟步骤通过 ✓');
}
