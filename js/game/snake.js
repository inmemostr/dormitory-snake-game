// game/snake.js — 蛇实体（玩家/AI/幽灵共用模型，环境无关）
//
// 身体跟随：头部路径点弧长采样（非链式物理）。
// 每 tick 记录头位置到路径队列；第 i 节身体 = 路径上距头 i*spacing 弧长处插值取点。

import { CONFIG, normAngle, clamp } from '../config.js';

let nextId = 1;

export class Snake {
  /**
   * @param {object} opts {nick, colorIdx, isPlayer, isGhost, isAI, difficulty}
   */
  constructor(opts = {}) {
    this.id = nextId++;
    this.nick = opts.nick || '蛇蛇';
    this.colorIdx = opts.colorIdx ?? 0;
    this.isPlayer = !!opts.isPlayer;
    this.isGhost = !!opts.isGhost;
    this.isAI = !!opts.isAI;
    this.difficulty = opts.difficulty || 'easy';

    // 运动状态
    this.x = 0; this.y = 0;
    this.angle = 0;            // 当前角度
    this.targetAngle = 0;      // 目标角度
    this.length = CONFIG.snake.initLength; // 长度=分数（浮点，吃食可 +1~3）
    this.boosting = false;
    this.alive = true;

    // 路径（旧→新），每 tick push 头位置；定期从头部方向截断
    this.pathX = [];
    this.pathY = [];

    // 身体采样缓存（渲染/碰撞共用）：索引 0 = 第 1 节（头后面第一节）
    this.segX = new Float32Array(CONFIG.snake.maxSegments);
    this.segY = new Float32Array(CONFIG.snake.maxSegments);
    this.segCount = 0;

    // 道具效果 {type: remainingTicks}
    this.effects = {};

    // 加速消耗计时
    this._boostCostTimer = 0;

    // 击杀数（仅统计用）
    this.kills = 0;

    // 发育系数（AI 随机 0.75~1.35，模拟真人水平差异；玩家恒 1）
    this.growthMult = 1;
  }

  reset(x, y, angle) {
    this.x = x; this.y = y;
    this.angle = this.targetAngle = angle;
    this.length = CONFIG.snake.initLength;
    this.boosting = false;
    this.alive = true;
    this.effects = {};
    this.kills = 0;
    this._boostCostTimer = 0;
    this.pathX.length = 0;
    this.pathY.length = 0;
    // 预铺一段直线路径，让初始身体立刻成形
    const r = this.radius;
    const spacing = r * CONFIG.snake.spacingFactor;
    const n = Math.ceil(this.length);
    for (let i = n; i >= 0; i--) {
      this.pathX.push(x - Math.cos(angle) * spacing * i);
      this.pathY.push(y - Math.sin(angle) * spacing * i);
    }
    this.computeSegments();
  }

  get radius() {
    const s = CONFIG.snake;
    return s.baseRadius + Math.min(s.maxRadiusBonus, this.length * s.radiusGrowth);
  }

  get spacing() {
    return this.radius * CONFIG.snake.spacingFactor;
  }

  get baseSpeed() {
    const s = CONFIG.snake;
    return Math.max(s.minSpeed, s.baseSpeed - this.radius * s.speedRadiusPenalty);
  }

  hasEffect(type) { return (this.effects[type] || 0) > 0; }

  addEffect(type, duration) {
    this.effects[type] = duration;
  }

  clearEffectsExcept(type) {
    for (const k of Object.keys(this.effects)) if (k !== type) delete this.effects[k];
  }

  /**
   * 实际速度（含加速与道具修饰）。
   * @param {number} slimeMult 外部黏液场修饰（1 或 <1），由 world 计算传入
   */
  speed(slimeMult = 1) {
    let v = this.baseSpeed;
    if (this.hasEffect('speed')) v *= CONFIG.powerup.types.speed.mult;
    if (this.boosting) v *= CONFIG.snake.boostMultiplier;
    return v * slimeMult;
  }

  /**
   * 每 tick 移动（玩家/AI 用；幽灵由 ghost.js 直接驱动位置）。
   * @param {number} slimeMult
   */
  step(slimeMult = 1) {
    if (!this.alive) return;

    // 1. 朝目标角度旋转（限制角速度 → 圆弧转向手感）
    const s = CONFIG.snake;
    let rate = s.turnRate * (this.boosting ? s.boostTurnFactor : 1);
    const diff = normAngle(this.targetAngle - this.angle);
    this.angle += clamp(diff, -rate, rate);
    this.angle = normAngle(this.angle);

    // 2. 前进
    const v = this.speed(slimeMult);
    this.x += Math.cos(this.angle) * v;
    this.y += Math.sin(this.angle) * v;

    // 3. 记录路径 & 重算身体
    this.pushPath(this.x, this.y);
    this.computeSegments();

    // 4. 道具倒计时
    for (const k of Object.keys(this.effects)) {
      if (--this.effects[k] <= 0) delete this.effects[k];
    }
  }

  pushPath(x, y) {
    this.pathX.push(x);
    this.pathY.push(y);
    // 截断：路径弧长只需覆盖 segCount*spacing + 余量
    const need = Math.ceil(this.length) * this.spacing + this.radius * 4 + 40;
    // 估算：每 tick 最多走 ~8u，点数上限换算后直接按点数粗截，精修在 computeSegments 里
    const maxPts = Math.ceil(need / 2) + 100;
    if (this.pathX.length > maxPts) {
      const excess = this.pathX.length - maxPts;
      this.pathX.splice(0, excess);
      this.pathY.splice(0, excess);
    }
  }

  // 沿路径从头向后按弧长采样，填满 segX/segY，设置 segCount
  computeSegments() {
    const n = Math.min(Math.ceil(this.length), CONFIG.snake.maxSegments - 1);
    const xs = this.pathX, ys = this.pathY;
    const len = xs.length;
    if (len < 2) { this.segCount = 0; return; }

    const spacing = this.spacing;
    let segIdx = 0;
    let target = spacing;
    let acc = 0;
    let i = len - 1;
    let x1 = xs[i], y1 = ys[i];

    while (i > 0 && segIdx < n) {
      const x0 = xs[i - 1], y0 = ys[i - 1];
      const dx = x1 - x0, dy = y1 - y0;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-6) {
        while (acc + d >= target && segIdx < n) {
          const t = (target - acc) / d;
          this.segX[segIdx] = x1 - dx * t;
          this.segY[segIdx] = y1 - dy * t;
          segIdx++;
          target += spacing;
        }
        acc += d;
      }
      x1 = x0; y1 = y0;
      i--;
    }
    // 路径不够长时，末尾沿用最后一个点（初始短蛇的兜底）
    while (segIdx < n) {
      this.segX[segIdx] = x1;
      this.segY[segIdx] = y1;
      segIdx++;
    }
    this.segCount = segIdx;
  }

  grow(v) {
    this.length = Math.min(this.length + v, CONFIG.snake.maxSegments - 1);
  }

  // 加速消耗结算（由 world 每 tick 调用）；返回 true 表示本 tick 掉了一节
  applyBoostCost() {
    if (!this.boosting || !this.alive) { this._boostCostTimer = 0; return false; }
    if (this.hasEffect('speed')) return false; // 疾速糖果期间加速免耗
    if (this.length <= CONFIG.snake.minBoostLength) return false;
    if (++this._boostCostTimer >= CONFIG.snake.boostCostInterval) {
      this._boostCostTimer = 0;
      this.length -= 1;
      return true;
    }
    return false;
  }

  get canBoost() {
    return this.length > CONFIG.snake.minBoostLength || this.hasEffect('speed');
  }

  // 蛇尾位置（加速掉落用）
  tailPos() {
    if (this.segCount > 0) {
      return { x: this.segX[this.segCount - 1], y: this.segY[this.segCount - 1] };
    }
    return { x: this.x, y: this.y };
  }
}
