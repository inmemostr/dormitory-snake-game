// game/food.js — 食物生成与管理（环境无关，环形世界）

import { CONFIG, randRange, randInt, wrapPos, wrapDelta } from '../config.js';
import { Pool } from '../core/pool.js';

export class FoodManager {
  constructor() {
    this.foods = []; // 活跃食物（含常驻 + 临时掉落）
    this.pool = new Pool(
      () => ({ x: 0, y: 0, r: 4, value: 1, colorIdx: 0, phase: 0, temp: false, corpse: false, kind: 0, magnetized: false }),
      (f) => { f.magnetized = false; f.temp = false; f.corpse = false; },
      CONFIG.food.count + CONFIG.food.dropPoolMax
    );
  }

  count() { return this.foods.length; }

  spawnRandom(n, temp = false) {
    for (let i = 0; i < n; i++) {
      const m = CONFIG.world.margin;
      this.spawnAt(
        randRange(m, CONFIG.world.size - m),
        randRange(m, CONFIG.world.size - m),
        randInt(CONFIG.food.valueMin, CONFIG.food.valueMax),
        randRange(CONFIG.food.minR, CONFIG.food.maxR),
        temp
      );
    }
  }

  spawnAt(x, y, value = 1, r = null, temp = true, opts = {}) {
    if (temp && this._tempCount() >= CONFIG.food.dropPoolMax) return null;
    const f = this.pool.obtain();
    f.x = wrapPos(x); f.y = wrapPos(y);
    f.value = value;
    f.r = r ?? randRange(CONFIG.food.minR, CONFIG.food.maxR);
    f.colorIdx = opts.colorIdx ?? randInt(0, CONFIG.palette.foods.length - 1);
    f.phase = Math.random() * Math.PI * 2;
    f.temp = temp;
    f.corpse = !!opts.corpse;  // 蛇蜕糖果（高价值留存）
    f.kind = opts.kind ?? this._pickKind(); // 造型（0~3 普通，10~13 遗产）
    f.magnetized = false;
    this.foods.push(f);
    return f;
  }

  _pickKind() {
    const w = CONFIG.food.kindWeights;
    let total = 0;
    for (const x of w) total += x;
    let roll = Math.random() * total;
    for (let i = 0; i < w.length; i++) {
      roll -= w[i];
      if (roll <= 0) return i;
    }
    return 0;
  }

  _tempCount() {
    let c = 0;
    for (const f of this.foods) if (f.temp) c++;
    return c;
  }

  // 维持常驻数量（只补非临时食物）
  maintain() {
    let normal = 0;
    for (const f of this.foods) if (!f.temp) normal++;
    const need = CONFIG.food.count - normal;
    if (need > 0) this.spawnRandom(Math.min(need, 5), false);
  }

  /** 磁吸：让 radius 内食物朝 (tx,ty) 移动（环形距离） */
  applyMagnet(tx, ty, radius) {
    const r2 = radius * radius;
    const sp = CONFIG.food.magnetSpeed;
    for (const f of this.foods) {
      const dx = wrapDelta(tx - f.x), dy = wrapDelta(ty - f.y);
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 1) {
        const d = Math.sqrt(d2);
        f.x = wrapPos(f.x + (dx / d) * sp);
        f.y = wrapPos(f.y + (dy / d) * sp);
        f.magnetized = true;
      }
    }
  }

  remove(f) {
    const i = this.foods.indexOf(f);
    if (i >= 0) {
      const last = this.foods.length - 1;
      this.foods[i] = this.foods[last];
      this.foods.pop();
      this.pool.release(f);
    }
  }

  clear() {
    while (this.foods.length) this.pool.release(this.foods.pop());
  }
}
