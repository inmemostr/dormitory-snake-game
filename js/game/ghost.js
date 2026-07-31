// game/ghost.js — 幽灵蛇系统（环境无关）：插值重放、生命周期、双向碰撞截断
//
// 核心体验：别人的历史对局以半透明蛇实时重放在你的地图里，撞它身体会死；
// 它撞你的身体也会当场「死亡」化食物（重放截断）——仿佛实时在线。

import { CONFIG, normAngle, wrapDist2 } from '../config.js';
import { Snake } from './snake.js';
import { decodeReplay, lerpAngleQ, quantToRad } from './record.js';

const ST = { FADEIN: 0, PLAYING: 1, DYING: 2, GONE: 3 };

class GhostRunner {
  /**
   * @param {object} decoded decodeReplay 结果
   * @param {number} startSample 起始采样索引（错开起始帧，营造「正在游戏中」感）
   */
  constructor(decoded, startSample = 0) {
    this.meta = decoded;
    this.samples = decoded.samples;
    this.idx = startSample;      // 当前采样索引（浮点，按 tick/sampleEvery 推进）
    this.state = ST.FADEIN;
    this.fadeT = 0;

    this.snake = new Snake({
      nick: decoded.nick,
      colorIdx: decoded.colorIdx,
      isGhost: true,
    });
    this.snake.alpha = 0;

    const s0 = this.samples[this.idx | 0];
    this.snake.length = s0.l;
    this._placeAt(s0, true);
  }

  _placeAt(sm, backfill = false) {
    const s = this.snake;
    s.x = sm.x; s.y = sm.y;
    s.angle = normAngle(quantToRad(sm.a));
    s.boosting = !!sm.b;
    if (backfill) {
      // 用历史采样倒推铺路径，让身体立即成形
      s.pathX.length = 0; s.pathY.length = 0;
      const cur = this.idx | 0;
      const need = Math.ceil(s.length) + 4;
      for (let i = Math.max(0, cur - need); i <= cur; i++) {
        s.pathX.push(this.samples[i].x);
        s.pathY.push(this.samples[i].y);
      }
      s.computeSegments();
    } else {
      s.pushPath(s.x, s.y);
      s.computeSegments();
    }
  }

  /** 每逻辑 tick 推进 */
  update(world) {
    const s = this.snake;
    const G = CONFIG.ghost;

    if (this.state === ST.FADEIN) {
      if (++this.fadeT >= G.fadeTicks) { this.state = ST.PLAYING; this.fadeT = 0; }
      s.alpha = (this.fadeT / G.fadeTicks) * G.alpha;
    } else if (this.state === ST.DYING) {
      if (++this.fadeT >= G.fadeTicks) { this.state = ST.GONE; s.alpha = 0; s.alive = false; }
      else s.alpha = (1 - this.fadeT / G.fadeTicks) * G.alpha;
      return;
    } else {
      s.alpha = G.alpha;
    }

    // 推进重放：每 tick 走 1/sampleEvery 个采样
    this.idx += 1 / CONFIG.record.sampleEvery;
    const i0 = this.idx | 0;
    if (i0 + 1 >= this.samples.length) { this.beginFadeOut(world, false); return; }

    const t = this.idx - i0;
    const A = this.samples[i0], B = this.samples[i0 + 1];
    s.length = A.l + (B.l - A.l) * t;
    const sm = {
      x: A.x + (B.x - A.x) * t,
      y: A.y + (B.y - A.y) * t,
      a: lerpAngleQ(A.a, B.a, t),
      b: t < 0.5 ? A.b : B.b,
    };
    this._placeAt(sm, false);
  }

  /** 幽灵撞蛇身被截断 → 当场死亡化食物；或重放自然结束 → 悄悄淡出 */
  beginFadeOut(world, killed) {
    if (this.state === ST.DYING || this.state === ST.GONE) return;
    this.state = ST.DYING;
    this.fadeT = 0;
    this.snake.boosting = false;
    if (killed) {
      world.corpseToFood(this.snake);
      world.addTombstone(this.snake.x, this.snake.y, this.snake.nick, Math.round(this.snake.length));
      world.events.push({ type: 'death', snake: this.snake, ghost: true });
    }
  }

  get done() { return this.state === ST.GONE; }
  get headless() { return this.state === ST.DYING || this.state === ST.GONE; }
}

export class GhostManager {
  /**
   * @param {World} world
   * @param {object[]} replayPool 压缩回放 JSON 池
   */
  constructor(world, replayPool) {
    this.world = world;
    this.pool = replayPool.slice();
    this.runners = [];
    this.nextSpawnAt = 0;
    this._tombstonedReplays = new Set();
    this._decodeCache = new Map();
    // 打乱池
    for (let i = this.pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.pool[i], this.pool[j]] = [this.pool[j], this.pool[i]];
    }
  }

  _decode(json) {
    let d = this._decodeCache.get(json);
    if (!d) { d = decodeReplay(json); this._decodeCache.set(json, d); }
    return d;
  }

  /** 阶段 1：移动幽灵（在网格重建前调用） */
  update(tick) {
    const world = this.world;

    for (const r of this.runners) {
      if (!r.done) r.update(world);
    }

    // 清理完成的
    for (let i = this.runners.length - 1; i >= 0; i--) {
      if (this.runners[i].done) {
        const s = this.runners[i].snake;
        const si = world.snakes.indexOf(s);
        if (si >= 0) world.snakes.splice(si, 1);
        this.runners.splice(i, 1);
        this.nextSpawnAt = tick + CONFIG.ghost.spawnDelayTick;
      }
    }

    // 补充新幽灵
    if (this.runners.length < CONFIG.ghost.concurrent && this.pool.length && tick >= this.nextSpawnAt) {
      this._spawnNext(tick);
    }
  }

  /** 阶段 2：幽灵头撞活蛇身体检测（在网格重建后调用） */
  checkCollisions() {
    for (const r of this.runners) {
      if (r.headless || r.done || !r.snake.alive) continue;
      const killer = this.world.queryBodyHit(r.snake, true);
      if (killer) r.beginFadeOut(this.world, true);
    }
  }

  _spawnNext(tick) {
    const world = this.world;
    const G = CONFIG.ghost;
    // 轮换取回放（池用完后循环，在线感不断）
    const json = this.pool.shift();
    this.pool.push(json);
    const decoded = this._decode(json);

    // 选起始帧：位置需离玩家足够远（环形距离）；最多试 12 次
    const total = decoded.samples.length;
    let start = 0;
    const player = world.player;
    for (let tries = 0; tries < 12; tries++) {
      start = Math.floor(Math.random() * Math.max(1, total * 0.7));
      if (!player) break;
      const sm = decoded.samples[start];
      if (wrapDist2(sm.x, sm.y, player.x, player.y) > G.minSpawnDist * G.minSpawnDist) break;
    }

    const runner = new GhostRunner(decoded, start);
    this.runners.push(runner);
    world.snakes.push(runner.snake);

    // 这条回放的死亡点立碑（魂系核心：别人的陨落地）
    if (!this._tombstonedReplays.has(json)) {
      this._tombstonedReplays.add(json);
      world.addTombstone(decoded.dieX, decoded.dieY, decoded.nick, decoded.score);
    }
    this.nextSpawnAt = tick + CONFIG.ghost.spawnDelayTick;
  }

  get activeCount() { return this.runners.length; }
}
