// tools/gen_ghosts.js — 离线生成预置幽灵回放数据（Node 运行，不进交付包）
//
// 用法：node tools/gen_ghosts.js
// 原理：复用游戏核心模块（world/ai/record 均为环境无关纯逻辑），
//       headless 模拟多场 AI 互搏，每条 AI 每条命挂 Recorder，死亡即产出回放。
//       兼作核心逻辑的无 DOM 冒烟测试。
//
// 提死亡率技巧：小世界高密度（2200 内 12 条 AI），产出后坐标整体平移散布到 3600 正式地图。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from '../js/config.js';

// —— headless 生成专用覆盖（World 每次构造时读 CONFIG，运行时动态读，先改即可）——
CONFIG.world.size = 2200;      // 小世界 → 高密度 → 高死亡率
CONFIG.ai.count = 12;
CONFIG.ai.hardCount = 6;
CONFIG.ai.fleeDist = 70;       // 生成时降低逃生敏感度（模拟普通玩家，不然 AI 全都不死）

const { World } = await import('../js/game/world.js');
const { Recorder } = await import('../js/game/record.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'ghosts');
mkdirSync(OUT_DIR, { recursive: true });

const REAL_SIZE = 3600;        // 正式地图尺寸（环形）
const TARGET_REPLAYS = 30;
const KEEP_REPLAYS = 15;
const MAX_TICKS = 40000;       // 每个世界最多跑 11 分钟游戏时间
const MIN_SAMPLES = 200;       // ≥10 秒
const MAX_SAMPLES = 3600;      // ≤3 分钟，控制体积
const PARALLEL_WORLDS = 4;

// 社区感昵称池（幽灵玩家）
const GHOST_NICKS = [
  '芝士就是力量', '熬夜冠军', '干饭王中王', '宿舍最速', '早八困困蛇',
  '奶茶去冰三分糖', '躺平协会会长', '图书馆卷王', '峡谷养蛇人', '周五不想动',
  '快乐水续命', '摸鱼界顶流', '蛇蛇冲鸭', '一口一个小朋友', '梦里啥都有',
  '考试周破防人', '夜宵搭子', '躺赢小能手', '蛇皮怪本怪', '今天也在划水',
  '可乐要加冰', '睡到自然醒', '咖啡因依赖', '实验报告杀手', '减肥明天开始',
];

const replays = [];
let nickCursor = 0;
const nextNick = () => GHOST_NICKS[(nickCursor++) % GHOST_NICKS.length];

class HeadlessWorld {
  constructor() {
    this.world = new World();
    this.world.initAIs();
    this.recs = new Map(); // snake -> {recorder, nick}（每条命一个，每条命换昵称）
  }

  step() {
    const w = this.world;
    w.step();
    for (const a of w.ais) {
      const s = a.snake;
      if (s.alive) {
        let rec = this.recs.get(s);
        if (!rec) {
          rec = { recorder: new Recorder(), nick: nextNick() };
          this.recs.set(s, rec);
        }
        rec.recorder.sample(s);
      } else {
        const rec = this.recs.get(s);
        if (rec) {
          this.recs.delete(s);
          if (rec.recorder.samples.length >= MIN_SAMPLES) {
            if (rec.recorder.samples.length > MAX_SAMPLES) {
              rec.recorder.samples = rec.recorder.samples.slice(-MAX_SAMPLES);
            }
            const replay = rec.recorder.finish({
              nick: rec.nick,
              score: Math.round(s.length),
              dieX: s.x,
              dieY: s.y,
              colorIdx: s.colorIdx,
            });
            replay.score = Math.round(s.length);
            this._translate(replay);
            replays.push(replay);
          }
        }
      }
    }
  }

  // 坐标整体平移：把 2600 小世界的回放散布到 6000 大地图
  _translate(replay) {
    const range = REAL_SIZE - CONFIG.world.size;
    const tx = Math.floor(Math.random() * range);
    const ty = Math.floor(Math.random() * range);
    replay.frames[0] += tx;   // 首帧绝对坐标
    replay.frames[1] += ty;   // 后续为增量，无需改
    replay.die[0] += tx;
    replay.die[1] += ty;
  }
}

// 并行世界轮转推进
const worlds = [];
for (let i = 0; i < PARALLEL_WORLDS; i++) worlds.push(new HeadlessWorld());

outer:
for (let t = 0; t < MAX_TICKS; t++) {
  for (const w of worlds) {
    w.step();
    if (replays.length >= TARGET_REPLAYS) break outer;
  }
}

if (replays.length === 0) {
  console.error('❌ 未产出任何回放，检查 world/ai 逻辑');
  process.exit(1);
}

// 挑选：按分数排序分层抽样，保证梯度；昵称去重（撞名换 unused 昵称）
replays.sort((a, b) => a.score - b.score);
const picked = [];
const usedNicks = new Set();
const spareNicks = GHOST_NICKS.filter(() => true);
const step = Math.max(1, Math.floor(replays.length / KEEP_REPLAYS));
for (let i = 0; i < replays.length && picked.length < KEEP_REPLAYS; i += step) {
  const r = replays[i];
  if (usedNicks.has(r.nick)) {
    const spare = spareNicks.find(n => !usedNicks.has(n));
    if (spare) r.nick = spare;
  }
  usedNicks.add(r.nick);
  picked.push(r);
}

// 写文件
const files = [];
let totalBytes = 0;
picked.forEach((r, i) => {
  const fname = `ghost_${String(i + 1).padStart(2, '0')}.json`;
  const json = JSON.stringify(r);
  writeFileSync(join(OUT_DIR, fname), json);
  files.push(fname);
  totalBytes += json.length;
  const durSec = Math.round((r.frames.length / 5) * CONFIG.record.sampleEvery / 60);
  console.log(
    `  ${fname}  ${r.nick.padEnd(8, '　')}  分数 ${String(r.score).padStart(5)}  时长 ${durSec}s  体积 ${(json.length / 1024).toFixed(1)}KB`
  );
});
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ files }));

console.log(`\n✅ 共产出 ${replays.length} 条候选，入库 ${files.length} 条，总体积 ${(totalBytes / 1024).toFixed(0)}KB`);
const maxBytes = Math.max(...picked.map(r => JSON.stringify(r).length));
console.log(maxBytes <= 60 * 1024
  ? `✅ 单条最大 ${(maxBytes / 1024).toFixed(1)}KB，符合 ≤60KB 预期`
  : `⚠️ 单条最大 ${(maxBytes / 1024).toFixed(1)}KB，超出 60KB 预期`);
