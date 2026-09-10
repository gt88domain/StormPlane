/**
 * audio.js —— WebAudio 程序化音效 + 随等级递进的自适应配乐
 * 不依赖任何音频文件（原版 res/raw 的音效仍保留在 Android 工程中）。
 * 所有音效由振荡器 / 噪声 / 滤波 / 混响实时合成，移动端首次手势后启动。
 */

import { clamp, rand } from './util.js';

const NOTE = (semi) => 440 * Math.pow(2, (semi - 9) / 12);

export class Audio {
  constructor() {
    this.ok = false;
    this.enabled = true;
    this.musicOn = true;
    this.sfxOn = true;
    this.level = 1;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this._timer = null;
    this._step = 0;
    this._nextT = 0;
    this.muted = false;
  }
  init() {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    const AC = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor
      ? c.createDynamicsCompressor()
      : null;
    if (comp) {
      comp.threshold.value = -14;
      comp.knee.value = 22;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      this.master.connect(comp);
      comp.connect(c.destination);
    } else this.master.connect(c.destination);

    // 总线：sfx / music
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.85;
    this.musicBus = c.createGain();
    this.musicBus.gain.value = 0.34;
    // 简易混响（噪声脉冲响应）
    if (c.createConvolver) {
      this.verb = c.createConvolver();
      const len = Math.floor(c.sampleRate * 1.5);
      const buf = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * 0.5;
        }
      }
      this.verb.buffer = buf;
      const vg = c.createGain();
      vg.gain.value = 0.28;
      this.verb.connect(vg);
      vg.connect(this.master);
    }
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);

    // 噪声源
    const nlen = Math.floor(c.sampleRate * 1.2);
    this.noiseBuf = c.createBuffer(1, nlen, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    this.ok = true;
  }
  async resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        /* ignore */
      }
    }
    if (this.ok && this.musicOn && !this._timer) this.startMusic();
  }
  setSfx(on) {
    this.sfxOn = on;
    if (this.sfxBus) this.sfxBus.gain.value = on ? 0.85 : 0;
  }
  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.value = on ? 0.34 : 0;
    if (on) this.startMusic();
    else this.stopMusic();
  }
  setLevel(lv) {
    this.level = clamp(lv, 1, 6);
  }
  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
  /* ---------------- 基础合成 ---------------- */
  tone({ type = 'sine', f0 = 440, f1 = null, t0 = 0, dur = 0.18, gain = 0.3, curve = 'exp', dest = null, detune = 0, filterQ = null, filterType = null, cutoff = null }) {
    if (!this.ok) return;
    const c = this.ctx;
    const t = c.currentTime + t0;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 != null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(Math.max(20, f1), t + dur);
    }
    if (detune) o.detune.value = detune;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filterType && c.createBiquadFilter) {
      const f = c.createBiquadFilter();
      f.type = filterType;
      f.frequency.setValueAtTime(cutoff || 1200, t);
      if (filterQ) f.Q.value = filterQ;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest || this.sfxBus);
    if (this.verb) {
      const s = c.createGain();
      s.gain.value = 0.18;
      g.connect(s);
      s.connect(this.verb);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  noise({ t0 = 0, dur = 0.3, gain = 0.3, type = 'lowpass', f0 = 1800, f1 = 200, q = 1, playbackRate = 1, dest = null }) {
    if (!this.ok) return;
    const c = this.ctx;
    const t = c.currentTime + t0;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = playbackRate;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxBus);
    if (this.verb) {
      const sv = c.createGain();
      sv.gain.value = 0.22;
      g.connect(sv);
      sv.connect(this.verb);
    }
    s.start(t);
    s.stop(t + dur + 0.05);
  }
  /* ---------------- 音效表 ---------------- */
  play(name, vol = 1) {
    if (!this.ok || !this.sfxOn) return;
    const v = clamp(vol, 0, 1);
    switch (name) {
      case 'shootBlue':
        this.tone({ type: 'square', f0: 1250, f1: 520, dur: 0.07, gain: 0.05 * v, filterType: 'highpass', cutoff: 700 });
        break;
      case 'shootPurple':
        this.tone({ type: 'sawtooth', f0: 760, f1: 280, dur: 0.11, gain: 0.055 * v, detune: 12 });
        this.tone({ type: 'sine', f0: 1560, f1: 700, dur: 0.09, gain: 0.03 * v });
        break;
      case 'shootRed':
        this.tone({ type: 'sawtooth', f0: 300, f1: 110, dur: 0.14, gain: 0.075 * v, filterType: 'lowpass', cutoff: 2600 });
        this.noise({ dur: 0.08, gain: 0.05 * v, type: 'bandpass', f0: 2200, f1: 800, q: 2 });
        break;
      case 'enemyShoot':
        this.tone({ type: 'triangle', f0: 420, f1: 160, dur: 0.1, gain: 0.05 * v });
        break;
      case 'bossShoot':
        this.tone({ type: 'sawtooth', f0: 180, f1: 70, dur: 0.2, gain: 0.075 * v, filterType: 'lowpass', cutoff: 1400 });
        this.noise({ dur: 0.16, gain: 0.05 * v, type: 'bandpass', f0: 900, f1: 240, q: 1.4 });
        break;
      case 'hellfire':
        this.noise({ dur: 0.5, gain: 0.07 * v, type: 'bandpass', f0: 500, f1: 1700, q: 1.1 });
        this.tone({ type: 'sine', f0: 70, f1: 150, dur: 0.4, gain: 0.07 * v });
        break;
      case 'boomSmall':
        this.noise({ dur: 0.22, gain: 0.16 * v, type: 'lowpass', f0: 2600, f1: 260, q: 0.8 });
        this.tone({ type: 'sine', f0: 220, f1: 60, dur: 0.16, gain: 0.09 * v });
        break;
      case 'boomMid':
        this.noise({ dur: 0.42, gain: 0.22 * v, type: 'lowpass', f0: 1900, f1: 130 });
        this.tone({ type: 'sine', f0: 150, f1: 42, dur: 0.34, gain: 0.14 * v });
        break;
      case 'boomBig':
        this.noise({ dur: 0.75, gain: 0.26 * v, type: 'lowpass', f0: 1400, f1: 70 });
        this.tone({ type: 'sine', f0: 110, f1: 30, dur: 0.6, gain: 0.18 * v });
        this.tone({ type: 'square', f0: 68, f1: 24, dur: 0.4, gain: 0.07 * v, filterType: 'lowpass', cutoff: 500 });
        break;
      case 'boomBoss':
        for (let i = 0; i < 4; i++) {
          this.noise({ t0: i * 0.11, dur: 1.1, gain: 0.2 * v, type: 'lowpass', f0: 1600 - i * 220, f1: 60 });
          this.tone({ t0: i * 0.08, type: 'sine', f0: 130 - i * 18, f1: 26, dur: 1.0, gain: 0.16 * v });
        }
        break;
      case 'playerBoom':
        this.noise({ dur: 0.9, gain: 0.24 * v, type: 'lowpass', f0: 2200, f1: 90 });
        this.tone({ type: 'sawtooth', f0: 420, f1: 40, dur: 0.7, gain: 0.1 * v, filterType: 'lowpass', cutoff: 900 });
        break;
      case 'missile':
        this.noise({ dur: 0.7, gain: 0.16 * v, type: 'highpass', f0: 400, f1: 4200, q: 0.7 });
        this.tone({ type: 'sine', f0: 90, f1: 420, dur: 0.5, gain: 0.1 * v });
        break;
      case 'pickup':
        [0, 4, 7, 12].forEach((s, i) => this.tone({ type: 'triangle', f0: NOTE(s - 12), dur: 0.22, gain: 0.06 * v, t0: i * 0.045 }));
        break;
      case 'diveWarn':
        this.tone({ type: 'square', f0: 900, f1: 1500, dur: 0.12, gain: 0.035 * v });
        break;
      case 'bossRoar':
        this.tone({ type: 'sawtooth', f0: 70, f1: 190, dur: 0.7, gain: 0.1 * v, filterType: 'lowpass', cutoff: 800 });
        this.noise({ dur: 0.8, gain: 0.1 * v, type: 'lowpass', f0: 700, f1: 180 });
        break;
      case 'bossWake':
        this.tone({ type: 'sine', f0: 40, f1: 120, dur: 1.2, gain: 0.12 * v });
        break;
      case 'levelup':
        [0, 7, 12, 19].forEach((s, i) => this.tone({ type: 'triangle', f0: NOTE(s), dur: 0.4, gain: 0.07 * v, t0: i * 0.06 }));
        break;
      case 'ui':
        this.tone({ type: 'triangle', f0: 620, f1: 880, dur: 0.08, gain: 0.05 * v });
        break;
      case 'gameover':
        [12, 7, 3, -2].forEach((s, i) => this.tone({ type: 'sawtooth', f0: NOTE(s), dur: 0.7, gain: 0.07 * v, t0: i * 0.16, filterType: 'lowpass', cutoff: 1200 }));
        break;
      case 'ready':
        [0, 5, 12].forEach((s, i) => this.tone({ type: 'triangle', f0: NOTE(s), dur: 0.3, gain: 0.06 * v, t0: i * 0.1 }));
        break;
      default:
        break;
    }
  }

  /* ---------------- 自适应配乐 ---------------- */
  startMusic() {
    if (!this.ok || this._timer || !this.musicOn) return;
    const SCALE = [0, 2, 3, 5, 7, 8, 10]; // 小调
    const ROOT = -7;
    const self = this;
    const stepDur = () => 60 / (100 + this.level * 8) / 4; // 16 分音符
    this._nextT = this.now() + 0.06;
    const sched = () => {
      if (!this.ctx) return;
      const ahead = this.now() + 0.22;
      while (this._nextT < ahead) {
        const s = this._step % 64;
        const bar = Math.floor(this._step / 16) % 4;
        const t = this._nextT - this.now();
        const lv = this.level;
        const dest = this.musicBus;
        // 贝斯 / 底鼓
        if (s % 4 === 0) {
          this.tone({ type: 'sine', f0: 58, f1: 32, dur: 0.24, gain: 0.22, t0: t, dest, curve: 'exp' });
          this.noise({ t0: t, dur: 0.05, gain: 0.1, type: 'highpass', f0: 2400, f1: 900, dest });
        }
        // 踩镲
        if (lv >= 3 && s % 2 === 1) {
          this.noise({ t0: t, dur: 0.035, gain: 0.035 + 0.01 * (s % 4 === 3), type: 'highpass', f0: 7000, f1: 5200, dest });
        }
        // 琶音
        if (lv >= 2) {
          const deg = [0, 2, 4, 2, 5, 4, 2, 0][s % 8];
          const oct = s % 16 >= 8 ? 12 : 0;
          this.tone({
            type: 'triangle',
            f0: NOTE(ROOT + SCALE[deg] + oct + (bar === 2 ? 3 : 0)),
            dur: stepDur() * 1.7,
            gain: 0.055,
            t0: t,
            dest,
            filterType: 'lowpass',
            cutoff: 2400 + lv * 420,
          });
        }
        // 主旋律垫底
        if (lv >= 4 && s % 16 === 0) {
          for (const [i, d] of [[0, 0], [4, 2], [7, 4]].entries()) {
            this.tone({
              type: 'sawtooth',
              f0: NOTE(ROOT + SCALE[d[1] % 7] - 12 + d[0]),
              dur: stepDur() * 14,
              gain: 0.028,
              t0: t,
              dest,
              detune: i * 6,
              filterType: 'lowpass',
              cutoff: 900,
            });
          }
        }
        // 高音层（最高等级）
        if (lv >= 5 && s % 8 === 4) {
          this.tone({ type: 'sine', f0: NOTE(ROOT + 24 + SCALE[(this._step >> 3) % 7]), dur: 0.5, gain: 0.04, t0: t, dest });
        }
        this._nextT += stepDur();
        this._step++;
      }
    };
    this._timer = setInterval(sched, 45);
    this._sched = sched;
  }
  stopMusic() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  /** 战斗激烈度：BOSS 在场时加点色彩 */
  setTense(on) {
    this.tense = !!on;
    if (this.musicBus) this.musicBus.gain.value = (on ? 0.42 : 0.34) * (this.musicOn ? 1 : 0);
  }
}

export default Audio;
