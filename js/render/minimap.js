// render/minimap.js — 小地图：实时显示玩家/AI/幽灵/蛇蜕在场上的坐标（浏览器专用）

import { CONFIG, wrapPos } from '../config.js';

export class Minimap {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.size = canvasEl.width; // 96
  }

  draw(world, player) {
    const ctx = this.ctx;
    const S = CONFIG.world.size;
    const k = this.size / S;
    const t = performance.now();

    ctx.clearRect(0, 0, this.size, this.size);

    // 蛇蜕（粉色小点）
    ctx.fillStyle = '#FF8FA3';
    for (const f of world.foods.foods) {
      if (!f.corpse) continue;
      ctx.fillRect(f.x * k - 1, f.y * k - 1, 2.5, 2.5);
    }

    // 蛇：AI 彩色 / 幽灵灰蓝 / 玩家白
    for (const s of world.snakes) {
      if (!s.alive) continue;
      const x = wrapPos(s.x) * k, y = wrapPos(s.y) * k;
      if (s.isPlayer) continue;
      if (s.isGhost) {
        ctx.fillStyle = 'rgba(180, 195, 220, 0.7)';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      } else {
        ctx.fillStyle = CONFIG.palette.snakes[s.colorIdx % CONFIG.palette.snakes.length];
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    // 玩家：白点 + 呼吸圈
    if (player && player.alive) {
      const x = wrapPos(player.x) * k, y = wrapPos(player.y) * k;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 4.5 + 1.5 * Math.sin(t * 0.005), 0, Math.PI * 2); ctx.stroke();
    }

    // 狂潮时红边脉冲
    if (world.surgeActive) {
      ctx.strokeStyle = `rgba(255, 107, 107, ${0.5 + 0.4 * Math.sin(t * 0.01)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, this.size - 3, this.size - 3);
    }
  }
}
