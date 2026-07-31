// game/collision.js — 碰撞检测与死亡裁决（环境无关，环形世界）
// 网格只插身体节（每 2 节 1 个采样点）；头-头单独成对判定。
// 无墙壁：世界是环形的。自撞死亡：颈部 selfSkipSegs 节豁免。

import { CONFIG, wrapDelta } from '../config.js';

const MAX_BODY_R = CONFIG.snake.baseRadius + CONFIG.snake.maxRadiusBonus;

function toroidalHit(ax, ay, bx, by, rr) {
  const dx = wrapDelta(bx - ax);
  const dy = wrapDelta(by - ay);
  return dx * dx + dy * dy < rr * rr;
}

/** 把所有活蛇（含幽灵）的身体节插入网格 */
export function buildBodyGrid(world) {
  const grid = world.grid;
  grid.clear();
  for (const s of world.snakes) {
    if (!s.alive) continue;
    const r = s.radius;
    const n = s.segCount;
    for (let i = 0; i < n; i += 2) {
      grid.insert({ x: s.segX[i], y: s.segY[i], r, owner: s, segIdx: i });
    }
  }
  return grid;
}

/**
 * 全部碰撞裁决：撞身体（含自撞、玩家↔幽灵双向）、头碰头。
 * 返回死亡列表 [{snake, killer, self}]（本 tick 统一结算，由 world 应用）。
 */
export function resolveCollisions(world) {
  const deaths = [];
  const out = world._queryOut;
  const selfOn = CONFIG.snake.selfCollision;
  const selfSkip = CONFIG.snake.selfSkipSegs;

  // 1. 头撞身体（含自撞）
  for (const s of world.snakes) {
    if (!s.alive) continue;
    if (s.hasEffect('invuln')) continue;

    const headR = s.radius;
    world.grid.query(s.x, s.y, headR + MAX_BODY_R + 8, out);

    let killer = null, isSelf = false;
    for (const item of out) {
      const owner = item.owner;
      if (!owner.alive) continue;
      if (owner === s) {
        // 自撞：非幽灵、颈部豁免
        if (!selfOn || s.isGhost || item.segIdx < selfSkip) continue;
        const rr = headR * 0.5 + item.r * 0.5; // 自撞判定稍宽松（更宽容）
        if (toroidalHit(s.x, s.y, item.x, item.y, rr)) { isSelf = true; break; }
        continue;
      }
      if (s.isGhost && owner.isGhost) continue;      // 幽灵之间不互撞
      const rr = headR * 0.65 + item.r * 0.65;
      if (toroidalHit(s.x, s.y, item.x, item.y, rr)) { killer = owner; break; }
    }
    if (killer || isSelf) deaths.push({ snake: s, killer, self: isSelf });
  }

  // 2. 头碰头（仅玩家/AI 之间；短者死，长度接近同归于尽）
  const actives = world.snakes.filter(s => s.alive && !s.isGhost);
  for (let i = 0; i < actives.length; i++) {
    const a = actives[i];
    if (deaths.some(d => d.snake === a)) continue;
    if (a.hasEffect('invuln')) continue;
    for (let j = i + 1; j < actives.length; j++) {
      const b = actives[j];
      if (deaths.some(d => d.snake === b)) continue;
      if (b.hasEffect('invuln')) continue;
      const rr = (a.radius + b.radius) * 0.6;
      if (!toroidalHit(a.x, a.y, b.x, b.y, rr)) continue;
      const ratio = a.length > b.length ? a.length / b.length : b.length / a.length;
      if (ratio < 1.1) {
        deaths.push({ snake: a, killer: b }, { snake: b, killer: a });
      } else if (a.length > b.length) {
        deaths.push({ snake: b, killer: a });
      } else {
        deaths.push({ snake: a, killer: b });
      }
    }
  }

  return deaths;
}
