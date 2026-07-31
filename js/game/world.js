// game/world.js — 世界状态、规则裁决、全局编排（环境无关，Node 可跑）
//
// 环形世界：无边界，位置可不回绕连续累积，距离一律用环形位移。
// 每 tick 顺序：
//  狂潮计时 → AI 决策 → 玩家/AI 移动 → 幽灵移动 → 建网格 → 幽灵头碰撞
//  → 其余碰撞裁决 → 结算死亡 → 吃食/道具 → 加速消耗 → 补货 → AI 重生 → 录制采样

import { CONFIG, randRange, randInt, pick, wrapPos, wrapDelta, wrapDist2 } from '../config.js';
import { Snake } from './snake.js';
import { AIController } from './ai.js';
import { FoodManager } from './food.js';
import { PowerupManager, slimeMultiplier } from './powerup.js';
import { SpatialGrid } from '../core/spatial.js';
import { buildBodyGrid, resolveCollisions } from './collision.js';

// AI 昵称池（社区感）
export const AI_NICKS = [
  '摸鱼小蛇', '卷王本王', '奶茶三分糖', '深夜食堂', '早八战神',
  '峡谷躺赢', '干饭第一名', '睡前再玩局', '代码无bug', '周五万岁',
  '冰美式续命', '图书馆幽灵', '摸鱼达人', '快乐星球', '暴走小葵',
];

export class World {
  constructor() {
    this.tick = 0;
    this.grid = new SpatialGrid();
    this.foods = new FoodManager();
    this.powerups = new PowerupManager();
    this.snakes = [];        // 全部活蛇（玩家 + AI + 幽灵）
    this.ais = [];           // {snake, ctrl, respawnAt}
    this.player = null;
    this.ghosts = null;      // GhostManager（浏览器注入；headless 可空）
    this.tombstones = [];    // {x, y, nick, score}
    this.events = [];        // 每帧由渲染/音效层排空
    this.recorder = null;    // 玩家录制器（可选）
    this._queryOut = [];
    this.onPlayerDeath = null; // 回调（main 注入）

    // 加速狂潮（cur 为平滑后的实际倍率，结束时渐缓回落不突兀）
    this.surge = { phase: 'calm', level: 0, t: CONFIG.surge.calmTick, cur: 1 };

    this.foods.spawnRandom(CONFIG.food.count);
  }

  get surgeActive() { return this.surge.phase === 'surge'; }

  /** 狂潮目标倍率（事件用） */
  get surgeMult() {
    if (!this.surgeActive) return 1;
    const c = CONFIG.surge;
    return Math.min(c.maxMult, c.baseMult + (this.surge.level - 1) * c.levelMult);
  }

  _stepSurge() {
    const s = this.surge;
    const C = CONFIG.surge;
    const calmFor = (lv) => Math.max(C.calmMin, C.calmTick - C.calmStep * (lv - 1));
    const surgeFor = (lv) => Math.min(C.surgeMax, C.surgeTick + C.surgeTickStep * (lv - 1));

    // 狂潮预警：平静期倒数 3s 时提示一次
    if (s.phase === 'calm' && s.t === C.warnTick) {
      this.events.push({ type: 'surge_warn', level: s.level + 1 });
    }

    if (--s.t <= 0) {
      if (s.phase === 'calm') {
        s.phase = 'surge';
        s.level++;
        s.t = surgeFor(s.level);
        this.events.push({ type: 'surge_start', level: s.level, mult: this.surgeMult });
      } else {
        s.phase = 'calm';
        s.t = calmFor(s.level + 1);
        this.events.push({ type: 'surge_end', level: s.level });
      }
    }
    // 平滑趋近目标倍率（狂潮结束渐缓回落，消除「突然变慢」的突兀感）
    s.cur += (this.surgeMult - s.cur) * 0.06;
  }

  /** 随机安全出生点（环形距离离其他蛇较远） */
  randomSpawn() {
    const S = CONFIG.world.size;
    const m = CONFIG.world.margin * 3;
    for (let tries = 0; tries < 20; tries++) {
      const x = randRange(m, S - m);
      const y = randRange(m, S - m);
      let ok = true;
      for (const s of this.snakes) {
        if (!s.alive) continue;
        if (wrapDist2(s.x, s.y, x, y) < 500 * 500) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: S / 2, y: S / 2 };
  }

  addPlayer(nick, colorIdx = 0) {
    const s = new Snake({ nick, colorIdx, isPlayer: true });
    const p = this.randomSpawn();
    s.reset(p.x, p.y, Math.random() * Math.PI * 2);
    this.player = s;
    this.snakes.push(s);
    return s;
  }

  spawnAI(difficulty = 'easy') {
    const used = new Set(this.ais.map(a => a.snake.nick));
    const avail = AI_NICKS.filter(n => !used.has(n));
    const nick = avail.length ? pick(avail) : `AI#${randInt(100, 999)}`;
    const s = new Snake({
      nick,
      colorIdx: randInt(1, CONFIG.palette.snakes.length - 1),
      isAI: true,
      difficulty,
    });
    const p = this.randomSpawn();
    s.reset(p.x, p.y, Math.random() * Math.PI * 2);
    // 与玩家同一起跑线出生；发育系数随机，模拟真人水平差异
    s.length = randInt(10, 20);
    s.growthMult = randRange(0.75, 1.35);
    this.snakes.push(s);
    this.ais.push({ snake: s, ctrl: new AIController(s, difficulty), respawnAt: 0 });
    return s;
  }

  initAIs() {
    for (let i = 0; i < CONFIG.ai.count; i++) {
      this.spawnAI(i < CONFIG.ai.hardCount ? 'hard' : 'easy');
    }
  }

  addTombstone(x, y, nick, score) {
    this.tombstones.push({ x: wrapPos(x), y: wrapPos(y), nick, score });
    if (this.tombstones.length > 50) this.tombstones.shift();
  }

  /** 蛇尸体 → 食物（美食遗产）：AI/幽灵 100% 全链路展示；玩家 50% 散落（防刷榜）。
   *  大小与价值按蛇的粗细缩放：大蛇爆大遗产，小蛇爆小遗产。 */
  corpseToFood(s) {
    const every = s.isPlayer ? CONFIG.food.corpseEveryNSeg : 1;
    const ck = CONFIG.food.corpseKinds;
    const F = CONFIG.food;
    const r = Math.max(4, Math.min(14, s.radius * F.corpseSizeByRadius));
    const v = Math.max(2, Math.min(8, Math.round(s.radius * F.corpseValueByRadius)));
    for (let i = 0; i < s.segCount; i += every) {
      this.foods.spawnAt(
        wrapPos(s.segX[i] + randRange(-4, 4)),
        wrapPos(s.segY[i] + randRange(-4, 4)),
        v,
        r + randRange(-1, 1),
        true,
        { kind: 10 + randInt(0, ck.length - 1) }
      );
    }
  }

  /** 蛇蜕：上一局玩家尸体的留存糖果串（魂系血渍） */
  spawnCorpseRelic(corpse) {
    if (!corpse || !corpse.points || !corpse.points.length) return;
    for (const p of corpse.points) {
      this.foods.spawnAt(p.x, p.y, CONFIG.corpse.value, CONFIG.corpse.r, true, {
        corpse: true,
        colorIdx: corpse.colorIdx ?? 0,
      });
    }
  }

  /**
   * 查询某条蛇头是否撞到其他蛇身体（幽灵截断用）。
   */
  queryBodyHit(s, ignoreGhosts = false) {
    const out = this._queryOut;
    this.grid.query(s.x, s.y, s.radius + 36, out);
    for (const item of out) {
      const owner = item.owner;
      if (owner === s || !owner.alive) continue;
      if (ignoreGhosts && owner.isGhost) continue;
      if (item.segIdx < 4) continue;
      const dx = wrapDelta(item.x - s.x), dy = wrapDelta(item.y - s.y);
      const rr = s.radius * 0.65 + item.r * 0.65;
      if (dx * dx + dy * dy < rr * rr) return owner;
    }
    return null;
  }

  step() {
    this.tick++;

    // 0. 加速狂潮计时（含倍率平滑）
    this._stepSurge();
    const surgeMult = this.surge.cur;

    // 1. AI 决策
    for (const a of this.ais) {
      if (a.snake.alive) a.ctrl.decide(this, this.grid);
    }

    // 2. 玩家/AI 移动（黏液场 × 狂潮加速）
    for (const s of this.snakes) {
      if (!s.alive || s.isGhost) continue;
      s.step(slimeMultiplier(s, this.snakes) * surgeMult);
    }

    // 3. 幽灵移动
    if (this.ghosts) this.ghosts.update(this.tick);

    // 4. 重建身体网格
    buildBodyGrid(this);

    // 5. 幽灵头撞活蛇身体 → 截断
    if (this.ghosts) this.ghosts.checkCollisions();

    // 6. 其余碰撞裁决（身体/自撞/头碰头）
    const deaths = resolveCollisions(this);
    for (const d of deaths) this._applyDeath(d.snake, d.killer, d.self);

    // 7. 吃食 + 道具（非幽灵）
    this._resolveEating();

    // 8. 加速消耗 → 尾部掉小食物（狂潮期间免费）
    for (const s of this.snakes) {
      if (!s.alive || s.isGhost) continue;
      if (!this.surgeActive && s.applyBoostCost()) {
        const t = s.tailPos();
        this.foods.spawnAt(wrapPos(t.x), wrapPos(t.y), 1, 3, true);
      }
      if (s.hasEffect('magnet')) {
        this.foods.applyMagnet(s.x, s.y, CONFIG.powerup.types.magnet.radius);
      }
    }

    // 9. 补货
    this.foods.maintain();
    this.powerups.maintain();

    // 10. AI 重生
    for (const a of this.ais) {
      if (!a.snake.alive && this.tick >= a.respawnAt) {
        const p = this.randomSpawn();
        a.snake.reset(p.x, p.y, Math.random() * Math.PI * 2);
        a.snake.length = randInt(10, 20);
        if (!this.snakes.includes(a.snake)) this.snakes.push(a.snake);
        a.respawnAt = Infinity;
      }
    }

    // 11. 录制玩家
    if (this.recorder && this.player && this.player.alive) {
      this.recorder.sample(this.player);
    }
  }

  _applyDeath(s, killer, isSelf = false) {
    if (!s.alive) return;

    // 护盾技能生效中：时间制无敌，直接免疫（轻微弹开避免卡在体内）
    if (s.hasEffect('shield')) {
      s.x -= Math.cos(s.angle) * 30;
      s.y -= Math.sin(s.angle) * 30;
      s.pushPath(s.x, s.y);
      this.events.push({ type: 'shield_block', x: s.x, y: s.y });
      return;
    }

    s.alive = false;
    if (killer && killer.alive) {
      killer.kills++;
      // 连杀：8s 窗口内连续击杀递增奖励
      if (this.tick - (killer.lastKillTick ?? -99999) <= CONFIG.streak.window) {
        killer.streak = (killer.streak || 0) + 1;
      } else {
        killer.streak = 1;
      }
      killer.lastKillTick = this.tick;
      if (killer.streak >= 2) {
        killer.grow(killer.streak * CONFIG.streak.bonus);
        if (killer.isPlayer) {
          this.events.push({ type: 'streak', count: killer.streak, x: s.x, y: s.y });
        }
      }
    }

    this.corpseToFood(s);
    this.addTombstone(s.x, s.y, s.nick, Math.round(s.length));
    this.events.push({ type: 'death', snake: s, killer, self: isSelf });

    if (s.isAI) {
      const a = this.ais.find(a => a.snake === s);
      if (a) a.respawnAt = this.tick + randInt(CONFIG.ai.respawnMinTick, CONFIG.ai.respawnMaxTick);
      const idx = this.snakes.indexOf(s);
      if (idx >= 0) this.snakes.splice(idx, 1);
    }

    if (s.isPlayer && this.onPlayerDeath) {
      this.onPlayerDeath(s, killer, isSelf);
    }
  }

  _resolveEating() {
    const foods = this.foods.foods;
    for (const s of this.snakes) {
      if (!s.alive || s.isGhost) continue;
      const eatR = s.radius + 6;
      const eatR2 = eatR * eatR;
      for (let i = foods.length - 1; i >= 0; i--) {
        const f = foods[i];
        const dx = wrapDelta(f.x - s.x), dy = wrapDelta(f.y - s.y);
        if (dx * dx + dy * dy < eatR2 + f.r * f.r) {
          const before = s.length;
          const feastMult = s.hasEffect('feast') ? CONFIG.powerup.types.feast.mult : 1;
          s.grow(f.value * feastMult * (s.growthMult || 1));
          this.foods.remove(f);
          this.events.push({ type: 'eat', x: f.x, y: f.y, colorIdx: f.colorIdx, player: s.isPlayer, corpse: !!f.corpse });
          // 变大里程碑：金色爆发
          if (s.isPlayer) {
            for (const m of CONFIG.snake.milestones) {
              if (before < m && s.length >= m) {
                this.events.push({ type: 'milestone', value: m, x: s.x, y: s.y });
                break;
              }
            }
          }
        }
      }
      const got = this.powerups.tryPickup(s);
      if (got) {
        this.events.push({ type: 'powerup', x: got.x, y: got.y, ptype: got.type, player: s.isPlayer });
      }
    }
  }

  /** 排空事件（渲染/音效层每帧调用） */
  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
