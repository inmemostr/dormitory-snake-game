// core/input.js — 落点式隐形摇杆 + 加速按钮 + 桌面鼠标键盘（浏览器专用）
//
// 交互语义（严格按需求实现，摇杆完全隐形、无任何可视图层）：
//  - 落下即激活：屏幕上除加速按钮热区外任意位置 touchstart → 该落点为隐形摇杆中心
//  - 相对偏移操控：手指当前位置 − 最初落点 = 偏移向量，向量角 → 目标角度（>8pt 死区生效）
//  - 抬起重置：touchend 摇杆失效，保持最后方向；再次落下以新落点为中心
//  - 多点触控用 touch.identifier 区分摇杆指与加速指

export class InputController {
  /**
   * @param {HTMLElement} boostEl 加速按钮 DOM（由 HUD 提供，触摸事件直接绑在它上面）
   */
  constructor() {
    this.targetAngle = 0;       // 输出：目标角度
    this.hasDirection = false;  // 是否已有过一次有效方向输入
    this.boosting = false;      // 输出：是否加速
    this.enabled = false;       // 游戏进行中才响应

    // 摇杆触点状态
    this._stickId = null;       // 当前摇杆手指 identifier
    this._stickOX = 0;          // 落点（中心）
    this._stickOY = 0;
    this._deadZone = 8;         // pt

    // 加速触点状态
    this._boostId = null;
    this._boostEl = null;

    // 桌面状态
    this._mouseDown = false;

    this._bind();
  }

  setBoostElement(el) { this._boostEl = el; }

  _bind() {
    const opts = { passive: false };

    document.addEventListener('touchstart', (e) => this._onTouchStart(e), opts);
    document.addEventListener('touchmove', (e) => this._onTouchMove(e), opts);
    document.addEventListener('touchend', (e) => this._onTouchEnd(e), opts);
    document.addEventListener('touchcancel', (e) => this._onTouchEnd(e), opts);

    // 阻止 iOS 双击缩放/长按放大镜
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });

    // 桌面兼容
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      if (dx * dx + dy * dy > this._deadZone * this._deadZone) {
        this.targetAngle = Math.atan2(dy, dx);
        this.hasDirection = true;
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.target.closest?.('button,input')) return;
      this._mouseDown = true; this.boosting = true;
    });
    document.addEventListener('mouseup', () => {
      if (this._mouseDown) { this._mouseDown = false; this.boosting = this._boostId !== null; }
    });
    document.addEventListener('keydown', (e) => {
      if (this.enabled && e.code === 'Space') { this.boosting = true; e.preventDefault(); }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.boosting = this._boostId !== null || this._mouseDown;
    });
  }

  _isBoostTouch(t) {
    return this._boostEl && this._boostEl.contains(t.target);
  }

  _onTouchStart(e) {
    if (!this.enabled) return;
    let onUi = false;
    for (const t of e.changedTouches) {
      // 按钮/输入框上的触摸不拦截（保留 click 合成，如静音按钮）
      if (t.target.closest?.('button, input')) { onUi = true; continue; }
      if (this._isBoostTouch(t)) {
        if (this._boostId === null) {
          this._boostId = t.identifier;
          this.boosting = true;
          if (navigator.vibrate) navigator.vibrate(10);
        }
      } else if (this._stickId === null) {
        // 落下即激活：落点 = 隐形摇杆中心
        this._stickId = t.identifier;
        this._stickOX = t.clientX;
        this._stickOY = t.clientY;
      }
    }
    if (!onUi && e.cancelable) e.preventDefault();
  }

  _onTouchMove(e) {
    if (!this.enabled) return;
    for (const t of e.changedTouches) {
      if (t.identifier === this._stickId) {
        const dx = t.clientX - this._stickOX;
        const dy = t.clientY - this._stickOY;
        if (dx * dx + dy * dy > this._deadZone * this._deadZone) {
          this.targetAngle = Math.atan2(dy, dx); // 相对偏移向量角 → 目标角度
          this.hasDirection = true;
        }
      }
    }
    if (e.cancelable) e.preventDefault();
  }

  _onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this._stickId) {
        this._stickId = null; // 抬起重置：下次落下以新落点为中心
      }
      if (t.identifier === this._boostId) {
        this._boostId = null;
        this.boosting = this._mouseDown;
      }
    }
  }

  // 游戏结束/菜单时调用
  reset() {
    this._stickId = null;
    this._boostId = null;
    this.boosting = false;
  }
}
