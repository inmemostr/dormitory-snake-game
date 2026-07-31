// game/powerup.js — 道具系统（环境无关）
// 四种道具：⚡疾速 / 🧲磁力 / 🐌黏液 / 🛡️护盾。单槽位替换制，数值全在 config。

import { CONFIG, randRange, randInt, wrapDelta } from '../config.js';

export class PowerupManager {
  constructor() {
    this.items = [];       // {x, y, type, phase, bornTick}
    this.respawnQueue = []; // {atTick}
    this.tick = 0;
  }

  _pickType() {
    const types = CONFIG.powerup.types;
    let total = 0;
    for (const k in types) total += types[k].weight;
    let roll = Math.random() * total;
    for (const k in types) {
      roll -= types[k].weight;
      if (roll <= 0) return k;
    }
    return 'speed';
  }

  maintain() {
    this.tick++;
    while (this.items.length < CONFIG.powerup.count) {
      const m = CONFIG.world.margin * 2;
      this.items.push({
        x: randRange(m, CONFIG.world.size - m),
        y: randRange(m, CONFIG.world.size - m),
        type: this._pickType(),
        phase: Math.random() * Math.PI * 2,
        bornTick: this.tick,
      });
    }
  }

  /**
   * 检测某条蛇是否吃到道具；吃到则给蛇上效果（单槽位：不同类替换，同类刷新）。
   * @returns {object|null} 吃到的道具（用于事件/音效）
   */
  tryPickup(snake) {
    if (!snake.alive || snake.isGhost) return null;
    const pr = CONFIG.powerup.radius + snake.radius;
    const pr2 = pr * pr;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      // 环形距离：蛇头坐标不回绕，道具始终在 [0,S)，普通减法会让老玩家捡不到道具
      const dx = wrapDelta(it.x - snake.x), dy = wrapDelta(it.y - snake.y);
      if (dx * dx + dy * dy < pr2) {
        const type = it.type;
        const def = CONFIG.powerup.types[type];
        if (snake.effects[type] > 0) {
          snake.effects[type] = def.duration; // 同类刷新
        } else {
          snake.clearEffectsExcept(null);     // 单槽位：清掉其它
          snake.addEffect(type, def.duration);
        }
        this.items.splice(i, 1);
        return it;
      }
    }
    return null;
  }

  clear() {
    this.items.length = 0;
  }
}

/**
 * 计算某条蛇受到的黏液减速系数（其他蛇释放的 slime 场，环形距离）。
 */
export function slimeMultiplier(snake, allSnakes) {
  const def = CONFIG.powerup.types.slime;
  const r2 = def.radius * def.radius;
  for (const other of allSnakes) {
    if (other === snake || !other.alive) continue;
    if (!other.hasEffect('slime')) continue;
    const dx = wrapDelta(other.x - snake.x), dy = wrapDelta(other.y - snake.y);
    if (dx * dx + dy * dy < r2) return def.mult;
  }
  return 1;
}
