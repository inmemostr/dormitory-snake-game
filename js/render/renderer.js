// render/renderer.js — 场景渲染（浏览器专用，环形世界）
//
// 蛇身渲染：管状连续路径（白描边底层 + 主体色 + 顶部高光 + 尾部渐细 + 肤色花纹），
// 胖蛇呈光滑软糖质感。世界环形：所有屏幕坐标经 wrapDelta 变换，跨缝无断裂。

import { CONFIG, clamp, wrapDelta, shadeColor } from '../config.js';

const TAU = Math.PI * 2;

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.dpr = 1;
    this.cssW = 0;
    this.cssH = 0;
    this.view = { x: 0, y: 0, w: 0, h: 0 };
    this.anchorYRatio = 0.5;
    this.letterboxed = false;
    this._bgGradient = null;
    this._tick = 0;

    // 震屏（加速狂潮）
    this.shakeX = 0;
    this.shakeY = 0;

    this.particles = [];
  }

  resize(dpr, insets) {
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr;
    this.cssW = w; this.cssH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const safeW = w - insets.left - insets.right;
    const safeH = h - insets.top - insets.bottom;
    const coreW = Math.min(safeW, safeH * 9 / 16);
    const coreH = coreW * 16 / 9;
    const coreX = insets.left + (safeW - coreW) / 2;
    const coreY = insets.top + (safeH - coreH) / 2;
    this.coreBox = { x: coreX, y: coreY, w: coreW, h: coreH };

    const wideScreen = safeW / safeH > (9 / 16) * 1.15;
    if (wideScreen) {
      this.view = { x: coreX, y: coreY, w: coreW, h: coreH };
      this.letterboxed = true;
    } else {
      this.view = { x: 0, y: 0, w, h };
      this.letterboxed = false;
    }

    const anchorY = coreY + coreH * (0.5 - CONFIG.camera.anchorUpFactor);
    this.anchorYRatio = (anchorY - this.view.y) / this.view.h;

    // 抹平背景：极近的双色渐变，消除「深浅不一像边界」的错觉
    const g = this.ctx.createRadialGradient(
      w / 2, h * 0.4, 10, w / 2, h / 2, Math.max(w, h) * 0.75
    );
    g.addColorStop(0, CONFIG.palette.bgInner);
    g.addColorStop(1, CONFIG.palette.bgOuter);
    this._bgGradient = g;
  }

  // ---------------- 粒子 ----------------
  spawnBurst(x, y, color, n = 6, shape = 'star') {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= CONFIG.particles.max) return;
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 90;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
        life: 0, maxLife: 0.5 + Math.random() * 0.4,
        color, size: 3 + Math.random() * 4, shape,
      });
    }
  }

  spawnCorpseBurst(snake, color) {
    const step = Math.max(1, Math.floor(snake.segCount / 40));
    for (let i = 0; i < snake.segCount; i += step) {
      if (this.particles.length >= CONFIG.particles.max) return;
      this.particles.push({
        x: snake.segX[i], y: snake.segY[i],
        vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120 - 40,
        life: 0, maxLife: 0.6 + Math.random() * 0.5,
        color, size: 3 + Math.random() * 5, shape: 'dot',
      });
    }
  }

  /** 死亡爆炸：头部冲击波 + 星爆 + 身体崩坏飞散；玩家附加全屏闪光 */
  explodeDeath(snake, color, isPlayer) {
    // 头部爆炸
    this.particles.push({
      x: snake.x, y: snake.y, vx: 0, vy: 0,
      life: 0, maxLife: 0.45, color: '#FFFFFF', size: 8, shape: 'shock',
    });
    this.spawnBurst(snake.x, snake.y, '#FFFFFF', 8, 'star');
    this.spawnBurst(snake.x, snake.y, color, 7, 'star');
    // 身体崩坏：高能量四散 + 星点混合
    const step = Math.max(1, Math.floor(snake.segCount / 50));
    for (let i = 0; i < snake.segCount; i += step) {
      if (this.particles.length >= CONFIG.particles.max) break;
      const a = Math.random() * TAU;
      const sp = 60 + Math.random() * 170;
      this.particles.push({
        x: snake.segX[i], y: snake.segY[i],
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50,
        life: 0, maxLife: 0.5 + Math.random() * 0.5,
        color: Math.random() < 0.3 ? '#FFFFFF' : color,
        size: 3 + Math.random() * 5,
        shape: Math.random() < 0.4 ? 'star' : 'dot',
      });
    }
    if (isPlayer) this._flash = { color: '#FF8FA3', alpha: 0.32 };
  }

  spawnRing(x, y, color) {
    this.particles.push({
      x, y, vx: 0, vy: 0, life: 0, maxLife: 0.45,
      color, size: 6, shape: 'ring',
    });
  }

  _updateParticles(dt) {
    const arr = this.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life += dt;
      if (p.life >= p.maxLife) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 160 * dt;
    }
  }

  // ---------------- 主渲染 ----------------
  render(world, dtFrame) {
    this._tick++;
    const ctx = this.ctx;
    const cam = this.camera;
    const view = this.view;

    // 狂潮震屏
    if (world.surgeActive) {
      const intensity = Math.min(3, 1 + world.surge.level * 0.5);
      this.shakeX = (Math.random() - 0.5) * intensity;
      this.shakeY = (Math.random() - 0.5) * intensity;
    } else {
      this.shakeX = this.shakeY = 0;
    }

    ctx.fillStyle = this._bgGradient;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    if (this.letterboxed) {
      ctx.fillStyle = 'rgba(215, 178, 138, 0.35)';
      ctx.fillRect(0, 0, this.cssW, view.y);
      ctx.fillRect(0, view.y + view.h, this.cssW, this.cssH - view.y - view.h);
      ctx.fillRect(0, view.y, view.x, view.h);
      ctx.fillRect(view.x + view.w, view.y, this.cssW - view.x - view.w, view.h);
    }

    ctx.save();
    if (this.letterboxed) {
      ctx.beginPath();
      ctx.rect(view.x, view.y, view.w, view.h);
      ctx.clip();
    }

    // 环形变换：屏幕坐标 = 视口锚点 + 环形位移 × zoom（跨缝连续）
    const z = cam.zoom;
    const cx = view.x + view.w / 2 + this.shakeX;
    const cy = view.y + view.h * this.anchorYRatio + this.shakeY;
    const sx = (wx) => cx + wrapDelta(wx - cam.x) * z;
    const sy = (wy) => cy + wrapDelta(wy - cam.y) * z;
    // 可见范围（世界单位半宽/半高 + 余量），用于逐点环形裁剪
    const halfW = view.w / 2 / z + 60;
    const halfH = Math.max(view.h * this.anchorYRatio, view.h * (1 - this.anchorYRatio)) / z + 60;
    const vis = (wx, wy) =>
      Math.abs(wrapDelta(wx - cam.x)) < halfW && Math.abs(wrapDelta(wy - cam.y)) < halfH;

    this._drawDots(sx, sy);
    this._drawTombstones(world, sx, sy, vis);
    this._drawFoods(world, sx, sy, vis);
    this._drawPowerups(world, sx, sy, vis);

    const snakes = world.snakes.slice().sort((a, b) => a.length - b.length);
    for (const s of snakes) this._drawSnake(s, sx, sy, vis);

    this._updateParticles(dtFrame);
    this._drawParticles(sx, sy);

    // 加速狂潮：全屏泛光（等级递进色 + 呼吸脉动）
    if (world.surgeActive) {
      const colors = CONFIG.surge.colors;
      const color = colors[(world.surge.level - 1) % colors.length];
      const pulse = 0.10 + 0.06 * Math.sin(this._tick * 0.18);
      const vg = ctx.createRadialGradient(
        cx, cy, Math.min(view.w, view.h) * 0.35,
        cx, cy, Math.max(view.w, view.h) * 0.75
      );
      vg.addColorStop(0, 'rgba(255,255,255,0)');
      vg.addColorStop(1, hexA(color, Math.min(0.3, pulse + world.surge.level * 0.02)));
      ctx.fillStyle = vg;
      ctx.fillRect(view.x, view.y, view.w, view.h);
    }

    // 玩家加速中：屏幕边缘速度线（动漫冲刺感）
    const pl = world.player;
    if (pl && pl.alive && pl.boosting && (pl.isPlayer)) {
      this._drawSpeedLines(view);
    }

    // 死亡全屏闪光（衰减）
    if (this._flash) {
      ctx.globalAlpha = this._flash.alpha;
      ctx.fillStyle = this._flash.color;
      ctx.fillRect(view.x, view.y, view.w, view.h);
      ctx.globalAlpha = 1;
      this._flash.alpha -= dtFrame * 1.2;
      if (this._flash.alpha <= 0) this._flash = null;
    }

    ctx.restore();
  }

  // 速度线：边缘随机短线朝内疾驰（深暖色，奶油底上可读）
  _drawSpeedLines(view) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#8A6D4B';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const edge = (Math.random() * 4) | 0;
      let x, y, dx, dy;
      if (edge === 0) { x = Math.random() * view.w; y = 0; dx = 0; dy = 1; }
      else if (edge === 1) { x = Math.random() * view.w; y = view.h; dx = 0; dy = -1; }
      else if (edge === 2) { x = 0; y = Math.random() * view.h; dx = 1; dy = 0; }
      else { x = view.w; y = Math.random() * view.h; dx = -1; dy = 0; }
      const len = 28 + Math.random() * 55;
      ctx.globalAlpha = 0.14 + Math.random() * 0.22;
      ctx.beginPath();
      ctx.moveTo(view.x + x, view.y + y);
      ctx.lineTo(view.x + x + dx * len, view.y + y + dy * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawDots(sx, sy) {
    const ctx = this.ctx;
    const cam = this.camera;
    const gap = CONFIG.palette.dotGap;
    const z = cam.zoom;
    const r = Math.max(1.2, 2 * z * 0.7);
    ctx.fillStyle = CONFIG.palette.dot;
    // 点阵在环面上无限平铺：直接遍历镜头附近的未回绕坐标
    const halfW = this.view.w / 2 / z + gap;
    const halfH = this.view.h / z + gap;
    const x0 = Math.floor((cam.x - halfW) / gap) * gap;
    const x1 = cam.x + halfW;
    const y0 = Math.floor((cam.y - halfH) / gap) * gap;
    const y1 = cam.y + halfH;
    for (let y = y0; y <= y1; y += gap) {
      for (let x = x0; x <= x1; x += gap) {
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), r, 0, TAU);
        ctx.fill();
      }
    }
  }

  _drawFoods(world, sx, sy, vis) {
    const ctx = this.ctx;
    const z = this.camera.zoom;
    const P = CONFIG.palette.foods;
    const t = this._tick;
    for (const f of world.foods.foods) {
      if (!vis(f.x, f.y)) continue;
      const breathe = 1 + 0.12 * Math.sin(t * 0.08 + f.phase);
      const r = f.r * z * breathe;
      const X = sx(f.x), Y = sy(f.y);
      const color = P[f.colorIdx % P.length];

      if (f.corpse) {
        // 蛇蜕糖果：更大更亮 + 白色双环 + 呼吸脉动（魂系血渍感）
        const pr = r * (1.5 + 0.15 * Math.sin(t * 0.1 + f.phase));
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(X, Y, pr * 2.1, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(X, Y, pr, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X, Y, pr + 3, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(X - pr * 0.3, Y - pr * 0.35, pr * 0.3, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }

      if (f.kind >= 10) {
        // 美食遗产：汉堡/寿司/西瓜/披萨
        this._drawFeast(f.kind, X, Y, r * 1.7, f.phase);
        if (f.magnetized) this._foodStreak(world, f, X, Y, color);
        continue;
      }

      // 普通食物造型
      if (f.kind === 1) {          // 棒棒糖：双色螺旋 + 小棍
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(X, Y, r * 1.8, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#FFF8F0';
        ctx.lineWidth = Math.max(1, r * 0.28);
        ctx.beginPath();
        ctx.moveTo(X + r * 0.5, Y + r * 0.5);
        ctx.lineTo(X + r * 1.5, Y + r * 1.6);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.beginPath(); ctx.arc(X, Y, r * 0.55, f.phase, f.phase + Math.PI * 1.4); ctx.stroke();
      } else if (f.kind === 2) {   // 甜甜圈：环 + 糖针
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(X, Y, r * 1.8, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = CONFIG.palette.bgInner;
        ctx.beginPath(); ctx.arc(X, Y, r * 0.42, 0, TAU); ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        for (let i = 0; i < 3; i++) {
          const a = f.phase + (i / 3) * TAU;
          ctx.beginPath();
          ctx.arc(X + Math.cos(a) * r * 0.7, Y + Math.sin(a) * r * 0.7, Math.max(0.6, r * 0.1), 0, TAU);
          ctx.fill();
        }
      } else if (f.kind === 3) {   // 星星糖：四角星 + 光晕
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(X, Y, r * 1.9, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        this._star(X, Y, r * 1.25, color);
        ctx.globalAlpha = 0.85;
        this._star(X - r * 0.2, Y - r * 0.25, r * 0.5, '#FFFFFF');
        ctx.globalAlpha = 1;
      } else {                     // kind 0 糖果点：光晕 + 核 + 高光
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(X, Y, r * 1.9, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(X - r * 0.3, Y - r * 0.35, r * 0.32, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 磁吸飞行拖尾
      if (f.magnetized) this._foodStreak(world, f, X, Y, color);
    }
  }

  // 磁吸中食物的飞行拖尾（朝吸力源方向的短线）
  _foodStreak(world, f, X, Y, color) {
    const ctx = this.ctx;
    let tx = 0, ty = 0, found = false;
    for (const s of world.snakes) {
      if (s.alive && s.hasEffect('magnet')) { tx = s.x; ty = s.y; found = true; break; }
    }
    if (!found) return;
    const dx = wrapDelta(tx - f.x), dy = wrapDelta(ty - f.y);
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(X, Y);
    ctx.lineTo(X - (dx / d) * 14, Y - (dy / d) * 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 美食遗产矢量造型
  _drawFeast(kind, X, Y, R, phase) {
    const ctx = this.ctx;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#FFB37E';
    ctx.beginPath(); ctx.arc(X, Y, R * 1.5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (kind === 10) {
      // 汉堡：上胚（芝麻）+ 生菜 + 肉饼 + 下胚
      ctx.fillStyle = '#F0B264';
      ctx.beginPath(); ctx.arc(X, Y + R * 0.1, R, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#FFF3D6';
      for (const [ox, oy] of [[-0.4, -0.35], [0.1, -0.5], [0.45, -0.3]]) {
        ctx.beginPath(); ctx.arc(X + ox * R, Y + oy * R, R * 0.07, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#7FDBC0';
      ctx.beginPath(); ctx.ellipse(X, Y + R * 0.12, R * 0.95, R * 0.18, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#A8643C';
      ctx.beginPath(); ctx.ellipse(X, Y + R * 0.32, R * 0.9, R * 0.22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#E89B54';
      ctx.beginPath(); ctx.ellipse(X, Y + R * 0.55, R * 0.85, R * 0.2, 0, 0, TAU); ctx.fill();
    } else if (kind === 11) {
      // 寿司：米饭 + 三文鱼 + 海苔带
      ctx.fillStyle = '#FFF8F0';
      roundRect(ctx, X - R * 0.85, Y - R * 0.5, R * 1.7, R, R * 0.35); ctx.fill();
      ctx.fillStyle = '#FF9E7D';
      roundRect(ctx, X - R * 0.85, Y - R * 0.72, R * 1.7, R * 0.55, R * 0.25); ctx.fill();
      ctx.fillStyle = '#4A5D4E';
      ctx.fillRect(X - R * 0.16, Y - R * 0.72, R * 0.32, R * 1.22);
    } else if (kind === 12) {
      // 西瓜：绿皮 + 红瓤 + 籽
      ctx.fillStyle = '#5FBF7F';
      ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
      ctx.fillStyle = '#FF6B6B';
      ctx.beginPath(); ctx.arc(X, Y, R * 0.78, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3A2E22';
      for (let i = 0; i < 4; i++) {
        const a = phase + (i / 4) * TAU;
        ctx.beginPath();
        ctx.arc(X + Math.cos(a) * R * 0.42, Y + Math.sin(a) * R * 0.42, R * 0.08, 0, TAU);
        ctx.fill();
      }
    } else {
      // 披萨：饼边 + 芝士 + 腊肠
      ctx.fillStyle = '#E8B26A';
      ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.fill();
      ctx.fillStyle = '#FFD166';
      ctx.beginPath(); ctx.arc(X, Y, R * 0.8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#E85D5D';
      for (const [ox, oy] of [[-0.35, -0.2], [0.3, -0.35], [0.05, 0.3]]) {
        ctx.beginPath(); ctx.arc(X + ox * R, Y + oy * R, R * 0.16, 0, TAU); ctx.fill();
      }
    }
  }

  _drawPowerups(world, sx, sy, vis) {
    const ctx = this.ctx;
    const z = this.camera.zoom;
    const t = this._tick;
    for (const it of world.powerups.items) {
      if (!vis(it.x, it.y)) continue;
      const def = CONFIG.powerup.types[it.type];
      const bob = Math.sin(t * 0.06 + it.phase) * 3 * z;
      const X = sx(it.x), Y = sy(it.y) + bob;
      const baseR = 15 * z * (1 + 0.08 * Math.sin(t * 0.1 + it.phase));
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = def.color;
      ctx.beginPath(); ctx.arc(X, Y, baseR * 1.6, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(X, Y, baseR, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X, Y, baseR, 0, TAU); ctx.stroke();
      ctx.font = `${Math.round(baseR * 1.1)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, X, Y + baseR * 0.05);
    }
  }

  _drawTombstones(world, sx, sy, vis) {
    const ctx = this.ctx;
    const z = this.camera.zoom;
    for (const t of world.tombstones) {
      if (!vis(t.x, t.y)) continue;
      const X = sx(t.x), Y = sy(t.y);
      const w = 38 * z, h = 44 * z;
      ctx.globalAlpha = 0.92;

      // 地面阴影
      ctx.fillStyle = 'rgba(160, 120, 80, 0.25)';
      ctx.beginPath();
      ctx.ellipse(X, Y + h * 0.52, w * 0.75, h * 0.14, 0, 0, TAU);
      ctx.fill();

      // 碑座（两层台阶）
      ctx.fillStyle = '#D9C4A5';
      roundRect(ctx, X - w * 0.62, Y + h * 0.3, w * 1.24, h * 0.2, 3 * z); ctx.fill();
      ctx.fillStyle = '#C9B393';
      roundRect(ctx, X - w * 0.5, Y + h * 0.16, w, h * 0.18, 3 * z); ctx.fill();

      // 碑身：奶油石碑 + 拱顶
      ctx.fillStyle = '#F0E3CB';
      ctx.beginPath();
      ctx.moveTo(X - w / 2, Y + h * 0.16);
      ctx.lineTo(X - w / 2, Y - h * 0.22);
      ctx.arc(X, Y - h * 0.22, w / 2, Math.PI, 0);
      ctx.lineTo(X + w / 2, Y + h * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2 * z;
      ctx.stroke();

      // 雕花内板
      ctx.fillStyle = '#E4D3B4';
      ctx.beginPath();
      ctx.moveTo(X - w * 0.32, Y + h * 0.06);
      ctx.lineTo(X - w * 0.32, Y - h * 0.18);
      ctx.arc(X, Y - h * 0.18, w * 0.32, Math.PI, 0);
      ctx.lineTo(X + w * 0.32, Y + h * 0.06);
      ctx.closePath();
      ctx.fill();

      // 小蛇浮雕（Z 形曲线）
      ctx.strokeStyle = '#B89B72';
      ctx.lineWidth = Math.max(1.2, 1.8 * z);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(X - w * 0.18, Y - h * 0.28);
      ctx.quadraticCurveTo(X + w * 0.22, Y - h * 0.26, X + w * 0.12, Y - h * 0.12);
      ctx.quadraticCurveTo(X, Y + h * 0.02, X - w * 0.2, Y - h * 0.04);
      ctx.stroke();

      // 花环（两朵花 + 叶）
      for (const side of [-1, 1]) {
        const fx = X + side * w * 0.44, fy = Y + h * 0.14;
        ctx.fillStyle = '#8FCB9B';
        ctx.beginPath();
        ctx.ellipse(fx + side * 3 * z, fy + 4 * z, 4 * z, 2 * z, side * 0.7, 0, TAU);
        ctx.fill();
        ctx.fillStyle = side < 0 ? '#FF8FA3' : '#FFD166';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * 3.4 * z, fy + Math.sin(a) * 3.4 * z, 2 * z, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#FFF3D6';
        ctx.beginPath(); ctx.arc(fx, fy, 1.6 * z, 0, TAU); ctx.fill();
      }

      // 绶带签名：珊瑚粉底白字
      const label = `${t.nick} · ${t.score}`;
      ctx.font = `600 ${Math.max(9, 10 * z)}px -apple-system, sans-serif`;
      const tw = ctx.measureText(label).width + 12 * z;
      ctx.fillStyle = 'rgba(255, 143, 163, 0.95)';
      roundRect(ctx, X - tw / 2, Y + h * 0.06, tw, 14 * z, 7 * z); ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, X, Y + h * 0.06 + 7 * z);

      ctx.globalAlpha = 1;
    }
  }

  // ---------------- 蛇：逐节珠子（严格沿轨迹逐节跟进，不出直线 bug） ----------------
  _drawSnake(s, sx, sy, vis) {
    if (!s.alive && (s.alpha ?? 1) <= 0) return;
    const ctx = this.ctx;
    const z = this.camera.zoom;
    const isGhost = s.isGhost;
    const baseColor = isGhost
      ? CONFIG.palette.ghost
      : CONFIG.palette.snakes[s.colorIdx % CONFIG.palette.snakes.length];
    const alpha = s.alpha ?? 1;

    // 逐节绘制：每节独立裁剪（不连线，中段出屏也不会拉成直线）
    const n = s.segCount;
    const bodyR = s.radius * z;
    const outline = Math.max(1, 1.6 * z);
    const pattern = s.colorIdx % 4;
    const altColor = CONFIG.palette.snakes[(s.colorIdx + 3) % CONFIG.palette.snakes.length];

    ctx.globalAlpha = alpha;
    for (let i = n - 1; i >= 0; i--) {
      const wx = s.segX[i], wy = s.segY[i];
      if (!vis(wx, wy)) continue;
      const taper = 0.55 + 0.45 * (1 - i / Math.max(1, n - 1));
      const r = Math.max(1.5, bodyR * taper);
      const X = sx(wx), Y = sy(wy);

      // 白底描边层
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(X, Y, r + outline, 0, TAU); ctx.fill();

      // 主体（相间条纹皮肤：隔段换对比色）
      let c = baseColor;
      if (!isGhost && pattern === 2 && ((i / 3) | 0) % 2 === 1) c = altColor;
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();

      // 顶部高光（软糖感）
      if ((i & 1) === 0) {
        ctx.globalAlpha = alpha * 0.35;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(X, Y - r * 0.38, r * 0.42, 0, TAU); ctx.fill();
        ctx.globalAlpha = alpha;
      }

      // 花纹：斑纹圆点 / 深色条纹
      if (!isGhost && r > 3) {
        if (pattern === 0 && i % 5 === 3) {
          ctx.globalAlpha = alpha * 0.5;
          ctx.fillStyle = shadeColor(baseColor, 0.82);
          ctx.beginPath(); ctx.arc(X, Y, r * 0.4, 0, TAU); ctx.fill();
          ctx.globalAlpha = alpha;
        } else if (pattern === 1 && i % 7 === 4) {
          ctx.globalAlpha = alpha * 0.4;
          ctx.fillStyle = shadeColor(baseColor, 0.86);
          ctx.beginPath(); ctx.arc(X, Y, r * 0.85, 0, TAU); ctx.fill();
          ctx.globalAlpha = alpha;
        }
      }
    }

    // 头部
    if (vis(s.x, s.y)) {
      const HX = sx(s.x), HY = sy(s.y);
      const headR = s.radius * 1.15 * z;

      // 磁力漩涡力场：三层旋转收敛弧 + 脉冲底圈（磁吸开启时）
      if (s.hasEffect('magnet')) {
        const mR = CONFIG.powerup.types.magnet.radius * z;
        const mColor = CONFIG.powerup.types.magnet.color;
        ctx.globalAlpha = alpha * 0.14;
        ctx.fillStyle = mColor;
        ctx.beginPath(); ctx.arc(HX, HY, mR * (0.9 + 0.1 * Math.sin(this._tick * 0.1)), 0, TAU); ctx.fill();
        for (let ring = 0; ring < 3; ring++) {
          const phase = (this._tick * 0.06 + ring / 3) % 1;      // 0→1 循环
          const rr = mR * (1 - phase * 0.75);                     // 向头部收敛
          const a0 = this._tick * 0.12 + ring * (TAU / 3);
          ctx.globalAlpha = alpha * (0.25 + 0.45 * phase);
          ctx.strokeStyle = mColor;
          ctx.lineWidth = (1.5 + 2 * phase) * z;
          ctx.beginPath();
          ctx.arc(HX, HY, rr, a0, a0 + 1.5);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(HX, HY, rr, a0 + Math.PI, a0 + Math.PI + 1.5);
          ctx.stroke();
        }
        ctx.globalAlpha = alpha;
      }

      // 加速特效：风压锥（蛇色外锥 + 白色内锥，奶油底上可读）+ 加密尾迹
      if (s.boosting && s.alive) {
        const back = s.angle + Math.PI;
        const coneLen = headR * 3.4;
        ctx.globalAlpha = alpha * 0.4;
        ctx.fillStyle = shadeColor(baseColor, 1.1);
        ctx.beginPath();
        ctx.moveTo(HX + Math.cos(back + 0.6) * headR, HY + Math.sin(back + 0.6) * headR);
        ctx.lineTo(HX + Math.cos(back) * coneLen, HY + Math.sin(back) * coneLen);
        ctx.lineTo(HX + Math.cos(back - 0.6) * headR, HY + Math.sin(back - 0.6) * headR);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = alpha * 0.45;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(HX + Math.cos(back + 0.35) * headR, HY + Math.sin(back + 0.35) * headR);
        ctx.lineTo(HX + Math.cos(back) * coneLen * 0.62, HY + Math.sin(back) * coneLen * 0.62);
        ctx.lineTo(HX + Math.cos(back - 0.35) * headR, HY + Math.sin(back - 0.35) * headR);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = alpha;
        if (this.particles.length < CONFIG.particles.max) {
          const t = s.tailPos();
          this.particles.push({
            x: t.x, y: t.y,
            vx: (Math.random() - 0.5) * 46, vy: (Math.random() - 0.5) * 46,
            life: 0, maxLife: 0.3 + Math.random() * 0.2,
            color: baseColor, size: 3 + Math.random() * 3, shape: 'dot',
          });
        }
      }

      ctx.fillStyle = baseColor;
      ctx.beginPath(); ctx.arc(HX, HY, headR, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = Math.max(1.5, 2 * z);
      ctx.stroke();

      if (!isGhost) {
        const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
        const eyeOff = headR * 0.55;
        const eyeR = headR * 0.34;
        for (const side of [-1, 1]) {
          const ex = HX + cos * eyeOff * 0.4 - sin * eyeOff * side;
          const ey = HY + sin * eyeOff * 0.4 + cos * eyeOff * side;
          if (s.boosting) {
            // 狂奔脸：瞪大的眼睛 + 倒竖眉
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, TAU); ctx.fill();
            ctx.fillStyle = '#3A2E22';
            ctx.beginPath(); ctx.arc(ex + cos * eyeR * 0.45, ey + sin * eyeR * 0.45, eyeR * 0.62, 0, TAU); ctx.fill();
            // 倒竖眉（内低外高，怒气冲冲）
            const bw = eyeR * 1.7;
            const bx = ex - cos * eyeR * 0.15, by = ey - sin * eyeR * 0.15 - eyeR * 1.05;
            const browA = s.angle - side * 0.55;
            ctx.strokeStyle = '#3A2E22';
            ctx.lineWidth = Math.max(1.8, 2.6 * z);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(bx - Math.cos(browA) * bw / 2, by - Math.sin(browA) * bw / 2);
            ctx.lineTo(bx + Math.cos(browA) * bw / 2, by + Math.sin(browA) * bw / 2);
            ctx.stroke();
          } else {
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, TAU); ctx.fill();
            ctx.fillStyle = '#3A2E22';
            ctx.beginPath(); ctx.arc(ex + cos * eyeR * 0.35, ey + sin * eyeR * 0.35, eyeR * 0.5, 0, TAU); ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath(); ctx.arc(ex + cos * eyeR * 0.1 - eyeR * 0.15, ey + sin * eyeR * 0.1 - eyeR * 0.2, eyeR * 0.18, 0, TAU); ctx.fill();
          }
        }
        // 狂奔脸：咬牙张嘴（头前下方的深色椭圆嘴）
        if (s.boosting) {
          const mx = HX + cos * headR * 0.42, my = HY + sin * headR * 0.42;
          ctx.fillStyle = '#7A4A3A';
          ctx.beginPath();
          ctx.ellipse(mx, my, headR * 0.3, headR * 0.2, s.angle, 0, TAU);
          ctx.fill();
        }
        // 腮红
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = '#FF9EB0';
        for (const side of [-1, 1]) {
          const bx = HX - cos * headR * 0.25 - sin * headR * 0.75 * side;
          const by = HY - sin * headR * 0.25 + cos * headR * 0.75 * side;
          ctx.beginPath(); ctx.arc(bx, by, headR * 0.22, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = alpha;

        if (s.hasEffect('shield')) {
          // 护盾技能：时间制无敌环；剩余 <35% 开始闪烁 + 收缩预警
          const SS = CONFIG.shieldSkill;
          const remain = s.effects.shield / SS.duration; // 1 → 0
          const flicker = remain < SS.flickerAt;
          const ringR = headR * (1.6 * (flicker ? 0.75 + 0.25 * (remain / SS.flickerAt) : 1));
          let a = alpha * (0.55 + 0.25 * Math.sin(this._tick * 0.15));
          if (flicker) a = alpha * (0.25 + 0.55 * Math.abs(Math.sin(this._tick * 0.5)));
          ctx.globalAlpha = Math.max(0.08, a);
          ctx.strokeStyle = SS.color;
          ctx.lineWidth = 2.5 * z;
          ctx.beginPath(); ctx.arc(HX, HY, ringR, 0, TAU); ctx.stroke();
          // 内圈光晕
          ctx.globalAlpha = Math.max(0.05, a * 0.3);
          ctx.fillStyle = SS.color;
          ctx.beginPath(); ctx.arc(HX, HY, ringR, 0, TAU); ctx.fill();
          ctx.globalAlpha = alpha;
        }
      }

      // 昵称标签
      const tagAlpha = isGhost ? alpha * 1.6 : alpha * 0.85;
      ctx.globalAlpha = Math.min(1, tagAlpha);
      ctx.font = `600 ${Math.max(10, 11 * z)}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      const tagY = HY - headR - 5 * z;
      ctx.strokeText(s.nick, HX, tagY);
      ctx.fillStyle = isGhost ? '#6B7FA3' : '#6B5138';
      ctx.fillText(s.nick, HX, tagY);
      ctx.globalAlpha = 1;
    }
  }

  _drawParticles(sx, sy) {
    const ctx = this.ctx;
    const z = this.camera.zoom;
    for (const p of this.particles) {
      const k = 1 - p.life / p.maxLife;
      const X = sx(p.x), Y = sy(p.y);
      ctx.globalAlpha = k;
      if (p.shape === 'shock') {
        // 冲击波：急速扩张的白环
        const R = (1 - k) * 130 * z + 10;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 5 * k * z;
        ctx.beginPath(); ctx.arc(X, Y, R, 0, TAU); ctx.stroke();
      } else if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * k;
        ctx.beginPath();
        ctx.arc(X, Y, (1 - k) * 40 * z + 6, 0, TAU);
        ctx.stroke();
      } else if (p.shape === 'star') {
        this._star(X, Y, p.size * z * k + 1, p.color);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(X, Y, p.size * z * k + 0.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  _star(x, y, r, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      const a2 = a + TAU / 10;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      ctx.lineTo(x + Math.cos(a2) * r * 0.45, y + Math.sin(a2) * r * 0.45);
    }
    ctx.closePath();
    ctx.fill();
  }
}

// 画路径片段（chunk = path[i0..i1]）
function strokeChunk(ctx, path, i0, i1, width, style) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(path[i0][0], path[i0][1]);
  for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(path[i][0], path[i][1]);
  ctx.stroke();
}

// hex → rgba
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 圆角矩形路径
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
