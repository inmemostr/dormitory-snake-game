// core/spatial.js — 环面均匀网格空间哈希（环境无关）
// 世界是环形的：网格在 X/Y 方向都按模回绕，跨缝查询自动处理。
// 每 tick 重建：蛇身采样点插入；头部碰撞只查 3×3 邻域。

import { CONFIG } from '../config.js';

export class SpatialGrid {
  constructor(worldSize = CONFIG.world.size, cell = CONFIG.grid.cell) {
    this.size = worldSize;
    this.dim = Math.max(1, Math.round(worldSize / cell));
    this.cellW = worldSize / this.dim; // 实际格宽（整除成环）
    this.buckets = new Map(); // key -> array（数组复用，clear 仅 length=0）
  }

  clear() {
    for (const arr of this.buckets.values()) arr.length = 0;
  }

  _wrap(v) {
    const S = this.size;
    return ((v % S) + S) % S;
  }

  _key(cx, cy) { return cy * this.dim + cx; }

  insert(item) {
    // item: {x, y, ...payload}（坐标可为任意实数，内部回绕）
    const cx = Math.floor(this._wrap(item.x) / this.cellW) % this.dim;
    const cy = Math.floor(this._wrap(item.y) / this.cellW) % this.dim;
    const k = this._key(cx, cy);
    let arr = this.buckets.get(k);
    if (!arr) { arr = []; this.buckets.set(k, arr); }
    arr.push(item);
  }

  /**
   * 查询以 (x,y) 为中心、半径 r 覆盖的网格内全部 item（环面回绕）。
   * @param out 复用数组（函数内清空）
   */
  query(x, y, r, out) {
    out.length = 0;
    const cw = this.cellW, dim = this.dim;
    x = this._wrap(x); y = this._wrap(y);
    const cx0 = Math.floor((x - r) / cw);
    const cy0 = Math.floor((y - r) / cw);
    const cx1 = Math.floor((x + r) / cw);
    const cy1 = Math.floor((y + r) / cw);
    for (let cy = cy0; cy <= cy1; cy++) {
      const wy = ((cy % dim) + dim) % dim;
      for (let cx = cx0; cx <= cx1; cx++) {
        const wx = ((cx % dim) + dim) % dim;
        const arr = this.buckets.get(this._key(wx, wy));
        if (arr) for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}
