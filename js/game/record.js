// game/record.js — 对局录制 + 采样压缩编解码（环境无关，环形世界）
//
// 格式（体积优化：首帧回绕绝对值，后续环形最短增量，扁平数字数组）：
// { v, nick, score, die:[x,y], dur, ts, colorIdx,
//   frames: [x,y,a,b,l, dx,dy,da,b,l, ...] }
//   x,y 整数（首帧 [0,S)）；dx,dy 为环形最短增量；a=angle 量化为 0~255；b=0/1
// 单局 3 分钟 ≈ 3600 采样 × ~12B ≈ 40~60KB

import { CONFIG, normAngle, wrapPos, wrapDelta } from '../config.js';

const SE = () => CONFIG.record.sampleEvery;
const AQ = (a) => Math.round(normAngle(a) / (Math.PI * 2) * 255) & 255;   // angle→0..255
const DA = (q) => (q / 255) * Math.PI * 2;                                 // 0..255→rad（[-π,π]）

export class Recorder {
  constructor() {
    this.samples = []; // {x,y,a,b,l} 绝对值（连续坐标），finish 时环形压缩
    this.tick = 0;
  }

  sample(snake) {
    if (++this.tick % SE() !== 0) return;
    this.samples.push({
      x: Math.round(snake.x),
      y: Math.round(snake.y),
      a: AQ(snake.angle),
      b: snake.boosting ? 1 : 0,
      l: Math.round(snake.length),
    });
  }

  /** 生成压缩回放 JSON（首帧回绕到 [0,S)，增量取环形最短） */
  finish({ nick, score, dieX, dieY, colorIdx = 0 }) {
    const frames = [];
    let px = 0, py = 0, pa = 0;
    this.samples.forEach((s, i) => {
      if (i === 0) {
        const wx = Math.round(wrapPos(s.x));
        const wy = Math.round(wrapPos(s.y));
        frames.push(wx, wy, s.a, s.b, s.l);
        px = wx; py = wy; pa = s.a;
      } else {
        // 位置增量：相对上一帧「已编码」位置取环形最短（跨缝不产生横扫）
        let dx = wrapDelta(s.x - px);
        let dy = wrapDelta(s.y - py);
        // 角度增量按最短环绕
        let da = s.a - pa;
        if (da > 127) da -= 256;
        if (da < -128) da += 256;
        frames.push(dx, dy, da, s.b, s.l);
        px += dx; py += dy; pa = s.a;
      }
    });
    return {
      v: 1, nick, score: Math.round(score),
      die: [Math.round(wrapPos(dieX)), Math.round(wrapPos(dieY))],
      dur: this.samples.length * SE(),
      ts: Date.now(),
      colorIdx,
      frames,
    };
  }

  get sampleCount() { return this.samples.length; }
}

/**
 * 解码回放 → 绝对采样数组（幽灵重放用）
 * @returns {{nick,score,dieX,dieY,dur,ts,colorIdx,samples:{x,y,a,b,l}[]}}
 */
export function decodeReplay(json) {
  const out = [];
  const F = json.frames;
  let x = 0, y = 0, a = 0;
  for (let i = 0; i < F.length; i += 5) {
    if (i === 0) {
      x = F[i]; y = F[i + 1]; a = F[i + 2];
    } else {
      x += F[i]; y += F[i + 1];
      a += F[i + 2];
      // 归一化到 0..255
      a = ((a % 256) + 256) % 256;
    }
    out.push({ x, y, a, b: F[i + 3], l: F[i + 4] });
  }
  return {
    nick: json.nick,
    score: json.score,
    dieX: json.die[0],
    dieY: json.die[1],
    dur: json.dur,
    ts: json.ts || 0,
    colorIdx: json.colorIdx || 0,
    samples: out,
  };
}

// 角度（0..255 量化域）插值，处理环绕
export function lerpAngleQ(a0, a1, t) {
  let d = a1 - a0;
  if (d > 127) d -= 256;
  if (d < -128) d += 256;
  return a0 + d * t;
}

export function quantToRad(q) { return DA(q); }
