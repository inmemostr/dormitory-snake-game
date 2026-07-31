// core/loop.js — 固定时间步长循环 + 渲染插值（浏览器专用）
// 兼容 ProMotion 120Hz：rAF 高频触发，逻辑按 accumulator 补步，渲染永远插值。

export class GameLoop {
  /**
   * @param {function(number):void} stepFn  固定步长逻辑（dt 固定 1/60s）
   * @param {function(number):void} renderFn 渲染，参数 alpha = accumulator/dt
   */
  constructor(stepFn, renderFn) {
    this.stepFn = stepFn;
    this.renderFn = renderFn;
    this.dt = 1000 / 60;
    this.maxSteps = 5;       // 防 spiral of death
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this._raf = 0;
    this._tick = this._tick.bind(this);

    // fps 滚动窗口（供 DPR 自适应）
    this.fpsWindow = [];
    this.fps = 60;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.acc = 0;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  // 切后台后恢复：清 accumulator 防大补帧
  resetClock() {
    this.acc = 0;
    this.last = performance.now();
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);

    let frame = now - this.last;
    this.last = now;
    if (frame > 250) frame = 250; // 异常长帧直接丢弃多余时间

    // fps 统计（1s 窗口）
    this.fpsWindow.push(now);
    while (this.fpsWindow.length && this.fpsWindow[0] < now - 1000) this.fpsWindow.shift();
    this.fps = this.fpsWindow.length;

    this.acc += frame;
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxSteps) {
      this.stepFn(this.dt / 1000);
      this.acc -= this.dt;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = 0; // 补不完就放弃，防越补越慢

    this.renderFn(this.acc / this.dt);
  }
}
