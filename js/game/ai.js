// game/ai.js — AI 蛇状态机（环境无关，环形世界）
// WANDER / SEEK_FOOD / FLEE / CHASE（仅 hard）。每 decideInterval tick 决策一次。
// 环形世界无边界规避；离玩家远时漫游方向向玩家偏置（提升遭遇率）。

import { CONFIG, randRange, wrapDelta, wrapDist2 } from '../config.js';

const ST = { WANDER: 0, SEEK: 1, FLEE: 2, CHASE: 3 };

export class AIController {
  constructor(snake, difficulty = 'easy') {
    this.snake = snake;
    this.difficulty = difficulty;
    this.state = ST.WANDER;
    this.cooldown = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this._queryOut = [];
  }

  decide(world, grid) {
    const s = this.snake;
    if (!s.alive) return;
    if (--this.cooldown > 0) return;
    this.cooldown = CONFIG.ai.decideInterval;

    // 1. FLEE：头部 fleeDist 内有蛇身（含自己身体中后段——学会不自杀）
    const threat = this._nearestThreat(world, grid);
    if (threat) {
      this.state = ST.FLEE;
      const away = Math.atan2(wrapDelta(s.y - threat.y), wrapDelta(s.x - threat.x));
      s.targetAngle = away + randRange(-0.4, 0.4);
      s.boosting = threat.d2 < (CONFIG.ai.fleeDist * 0.5) ** 2 && s.canBoost && Math.random() < 0.5;
      return;
    }

    // 2. CHASE（仅 hard 且长度有优势）：绕向最近活蛇头前方截击
    if (this.difficulty === 'hard' && Math.random() < 0.35) {
      const prey = this._nearestSnake(world);
      if (prey && prey.length < s.length * 0.8) {
        this.state = ST.CHASE;
        const lead = 30;
        const px = prey.x + Math.cos(prey.angle) * lead;
        const py = prey.y + Math.sin(prey.angle) * lead;
        s.targetAngle = Math.atan2(wrapDelta(py - s.y), wrapDelta(px - s.x));
        s.boosting = s.canBoost && Math.random() < 0.3;
        return;
      }
    }

    // 3. SEEK：优先道具，其次最近食物
    const target = this._nearestFoodOrPowerup(world);
    if (target) {
      this.state = ST.SEEK;
      s.targetAngle = Math.atan2(wrapDelta(target.y - s.y), wrapDelta(target.x - s.x));
      s.boosting = s.canBoost && Math.random() < 0.12; // 偶尔冲刺，更像真人
      return;
    }

    // 4. WANDER：缓变漫游；离玩家远时向玩家方向偏置（提升世界活力）
    this.state = ST.WANDER;
    const player = world.player;
    if (player && player.alive && Math.random() < CONFIG.ai.gravityProb
        && wrapDist2(s.x, s.y, player.x, player.y) > CONFIG.ai.gravityDist ** 2) {
      const toPlayer = Math.atan2(wrapDelta(player.y - s.y), wrapDelta(player.x - s.x));
      this.wanderAngle = toPlayer + randRange(-0.6, 0.6);
    } else {
      this.wanderAngle += randRange(-0.35, 0.35);
    }
    s.targetAngle = this.wanderAngle;
    s.boosting = false;
  }

  _nearestThreat(world, grid) {
    const s = this.snake;
    const out = this._queryOut;
    grid.query(s.x, s.y, CONFIG.ai.fleeDist, out);
    let best = null, bestD2 = Infinity;
    for (const item of out) {
      if (item.owner === s) continue;                    // 自己身体不算威胁
      const dx = wrapDelta(item.x - s.x), dy = wrapDelta(item.y - s.y);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = item; }
    }
    if (best) best.d2 = bestD2;
    return best;
  }

  _nearestSnake(world) {
    const s = this.snake;
    let best = null, bestD2 = Infinity;
    for (const o of world.snakes) {
      if (o === s || !o.alive || o.isGhost) continue;
      const d2 = wrapDist2(o.x, o.y, s.x, s.y);
      if (d2 < bestD2 && d2 < 900 * 900) { bestD2 = d2; best = o; }
    }
    return best;
  }

  _nearestFoodOrPowerup(world) {
    const s = this.snake;
    const vd = CONFIG.ai.viewDist;
    const vd2 = vd * vd;

    let bestP = null, bestPD2 = Infinity;
    for (const it of world.powerups.items) {
      const d2 = wrapDist2(it.x, it.y, s.x, s.y);
      if (d2 < bestPD2 && d2 < vd2 * 0.7) { bestPD2 = d2; bestP = it; }
    }
    if (bestP) return bestP;

    let best = null, bestD2 = Infinity;
    const foods = world.foods.foods;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      const d2 = wrapDist2(f.x, f.y, s.x, s.y);
      if (d2 < bestD2 && d2 < vd2) { bestD2 = d2; best = f; }
    }
    return best;
  }
}
