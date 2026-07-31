// core/camera.js — 摄像机：平滑跟随 + 缩放 + 9:16 核心盒锚定（环境无关）

import { CONFIG, clamp } from '../config.js';

export class Camera {
  constructor() {
    this.x = CONFIG.world.size / 2;
    this.y = CONFIG.world.size / 2;
    this.zoom = 1.4;
    this.targetZoom = 1.4;
    this.initialized = false;
  }

  // 每逻辑步调用：朝目标平滑（boosting 时镜头轻微后拉，FOV punch）
  follow(tx, ty, radius, boosting = false) {
    if (!this.initialized) {
      this.x = tx; this.y = ty;
      this.zoom = this.targetZoom = this._zoomFor(radius);
      this.initialized = true;
      return;
    }
    const s = CONFIG.camera.smooth;
    this.x += (tx - this.x) * s;
    this.y += (ty - this.y) * s;
    this.targetZoom = this._zoomFor(radius) * (boosting ? CONFIG.camera.boostZoomOut : 1);
    this.zoom += (this.targetZoom - this.zoom) * CONFIG.camera.zoomSmooth;
  }

  _zoomFor(radius) {
    return clamp(
      CONFIG.camera.zoomBase - radius * CONFIG.camera.zoomRadiusFactor,
      CONFIG.camera.zoomMin,
      CONFIG.camera.zoomMax
    );
  }

  /**
   * 世界坐标 → 屏幕坐标。
   * @param view {x,y,w,h} 渲染视口（CSS px，通常=画布可视区或 letterbox 区）
   * @param anchorYRatio 蛇头在视口中的纵向位置（0.5=正中；<0.5 偏上）
   */
  toScreenX(wx, view) { return (wx - this.x) * this.zoom + view.x + view.w / 2; }
  toScreenY(wy, view, anchorYRatio = 0.5) { return (wy - this.y) * this.zoom + view.y + view.h * anchorYRatio; }

  // 屏幕可见的世界范围（含 margin），用于视口裁剪
  visibleWorldRect(view, anchorYRatio = 0.5, margin = 60) {
    const halfW = view.w / 2 / this.zoom;
    const upH = view.h * anchorYRatio / this.zoom;
    const downH = view.h * (1 - anchorYRatio) / this.zoom;
    return {
      x0: this.x - halfW - margin,
      x1: this.x + halfW + margin,
      y0: this.y - upH - margin,
      y1: this.y + downH + margin,
    };
  }
}
