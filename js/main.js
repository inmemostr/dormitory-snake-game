// main.js — 启动、界面流转、主循环调度、DPR 自适应、音效（浏览器专用）

import { CONFIG, clamp, wrapPos } from './config.js';
import { GameLoop } from './core/loop.js';
import { Camera } from './core/camera.js';
import { InputController } from './core/input.js';
import { World } from './game/world.js';
import { GhostManager } from './game/ghost.js';
import { Recorder } from './game/record.js';
import { LocalProvider } from './game/provider.js';
import { buildLeaderboard } from './game/rank.js';
import { storage } from './game/storage.js';
import { Renderer } from './render/renderer.js';
import { HUD, escapeHtml } from './render/hud.js';
import { Minimap } from './render/minimap.js';

// ---------------- 音效（WebAudio 合成，零资源文件） ----------------
class AudioKit {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._lastEat = 0;
  }
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  _tone(freq0, freq1, dur, type = 'sine', gain = 0.12) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  eat() {
    const now = performance.now();
    if (now - this._lastEat < 50) return; // 节流
    this._lastEat = now;
    this._tone(520 + Math.random() * 120, 880, 0.07, 'square', 0.06);
  }
  powerup() { this._tone(660, 990, 0.16, 'sine', 0.1); }
  milestone() {
    this._tone(523, 784, 0.2, 'triangle', 0.1);
    setTimeout(() => this._tone(659, 1046, 0.22, 'triangle', 0.08), 90);
  }
  death() { this._tone(320, 70, 0.45, 'sawtooth', 0.12); }
  shield() { this._tone(980, 1240, 0.1, 'triangle', 0.09); }
}

// ---------------- 启动 ----------------
const canvas = document.getElementById('game');
const camera = new Camera();
const renderer = new Renderer(canvas, camera);
const input = new InputController();
const hud = new HUD();
const audio = new AudioKit();
const provider = new LocalProvider();
const minimap = new Minimap(document.getElementById('minimap'));

input.setBoostElement(document.getElementById('btn-boost'));

// DOM
const $ = (id) => document.getElementById(id);
const dom = {
  menu: $('menu'), gameover: $('gameover'),
  nick: $('nick'), btnStart: $('btn-start'), bestLine: $('best-line'),
  btnRetry: $('btn-retry'), btnHome: $('btn-home'),
  finalScore: $('final-score'), newRecord: $('new-record'),
  finalRank: $('final-rank'), deathCause: $('death-cause'),
  btnShield: $('btn-shield'),
};

// 状态
let state = 'menu'; // menu | playing | dying | gameover
let world = null;
let player = null;
let nick = '';
let lastFrameAt = performance.now();
let dprIdx = 0;
let dprCheckTimer = 0;
let todayBest = 0;
// 护盾技能
let shieldRequested = false;
let shieldCdUntil = 0;   // world.tick 冷却截止
let minimapTimer = 0;
// 死亡慢动作
let dyingT = 0;
let deathX = 0;
let deathY = 0;

// 安全区（CSS env → JS）
function readInsets() {
  const cs = getComputedStyle(document.documentElement);
  const px = (v) => parseFloat(v) || 0;
  return {
    top: px(cs.getPropertyValue('--sat')),
    bottom: px(cs.getPropertyValue('--sab')),
    left: px(cs.getPropertyValue('--sal')),
    right: px(cs.getPropertyValue('--sar')),
  };
}

function currentDpr() {
  const cap = Math.min(window.devicePixelRatio || 1, CONFIG.dpr.initial);
  const steps = CONFIG.dpr.steps.filter(s => s <= cap + 1e-6);
  return steps[clamp(dprIdx, 0, steps.length - 1)] ?? 1;
}

function applyResize() {
  renderer.resize(currentDpr(), readInsets());
}

// ---------------- 界面流转 ----------------
function randomNick() {
  return `蛇蛇#${Math.floor(1000 + Math.random() * 9000)}`;
}

function showMenu() {
  state = 'menu';
  input.enabled = false;
  input.reset();
  hud.hide();
  dom.gameover.classList.add('hidden');
  dom.menu.classList.remove('hidden');
  dom.nick.placeholder = randomNick();
  const best = provider.getBest();
  dom.bestLine.textContent = best > 0 ? `历史最高：${best}` : '历史最高：—';

  // 菜单背景：环境世界（AI 生态 + 镜头漫游）
  world = new World();
  world.initAIs();
  camera.initialized = false;
}

async function startGame() {
  audio.unlock();
  nick = dom.nick.value.trim() || dom.nick.placeholder || randomNick();
  dom.menu.classList.add('hidden');
  dom.gameover.classList.add('hidden');

  const ghostPool = await provider.fetchGhosts(12);

  world = new World();
  player = world.addPlayer(nick, 0);
  world.initAIs();
  if (ghostPool.length) world.ghosts = new GhostManager(world, ghostPool);
  world.recorder = new Recorder();
  for (const t of provider.getOwnTombstones()) {
    world.addTombstone(t.x, t.y, t.nick, t.score);
  }
  // 蛇蜕：上一局的尸体糖果串还在原地等你找回来
  world.spawnCorpseRelic(provider.getOwnCorpse());
  world.onPlayerDeath = onPlayerDeath;

  camera.initialized = false;
  camera.follow(player.x, player.y, player.radius);
  input.enabled = true;
  hud.show();
  todayBest = storage.getTodayBest();
  hud.setBests(todayBest, provider.getBest());
  shieldCdUntil = 0;
  shieldRequested = false;
  hud.updateShield('ready');
  state = 'playing';
}

function onPlayerDeath(s, killer, isSelf) {
  state = 'dying';
  dyingT = 0;
  deathX = s.x;
  deathY = s.y;
  input.enabled = false;
  audio.death();
  if (navigator.vibrate) navigator.vibrate([60, 50, 120]);

  // 结算数据
  const score = Math.round(s.length);
  const replay = world.recorder ? world.recorder.finish({
    nick, score, dieX: s.x, dieY: s.y, colorIdx: s.colorIdx,
  }) : null;
  const prevBest = provider.getBest();
  provider.uploadScore(score);
  if (replay && replay.frames.length > 30) provider.uploadReplay(replay);

  // 蛇蜕：按 25% 长度折算糖果串留在尸体路径上（只留最近一具）
  const C = CONFIG.corpse;
  const total = Math.min(C.maxPoints, Math.max(1, Math.floor(s.length * C.keepRatio / C.value)));
  const pts = [];
  if (s.segCount > 0) {
    const stepI = Math.max(1, Math.floor(s.segCount / total));
    for (let i = 0; i < s.segCount && pts.length < total; i += stepI) {
      pts.push({ x: Math.round(wrapPos(s.segX[i])), y: Math.round(wrapPos(s.segY[i])) });
    }
  } else {
    pts.push({ x: Math.round(wrapPos(s.x)), y: Math.round(wrapPos(s.y)) });
  }
  provider.saveCorpse({ points: pts, colorIdx: s.colorIdx, nick, score, ts: Date.now() });

  dom.deathCause.textContent = isSelf
    ? '撞到了自己的身体'
    : killer
      ? `撞上了「${killer.nick}」的身体`
      : '遗憾离场';

  // 慢动作 + 推近镜头，2.1s 后再出结算页（把遗憾演出来）
  setTimeout(() => showGameOver(score, prevBest), 2100);
}

function showGameOver(score, prevBest) {
  if (state !== 'dying') return;
  state = 'gameover';
  hud.hide();

  dom.finalScore.textContent = score;
  if (score > prevBest && prevBest > 0 || (prevBest === 0 && score > 0)) {
    dom.newRecord.classList.remove('hidden');
  } else {
    dom.newRecord.classList.add('hidden');
  }

  const entries = buildLeaderboard(world, { nick, score }, 8);
  dom.finalRank.innerHTML = entries.map((e) =>
    `<li class="${e.isMe ? 'me' : ''}"><span>${e.rank}. ${escapeHtml(e.nick)}${e.ghost ? ' 👻' : ''}</span><b>${e.score}</b></li>`
  ).join('');

  dom.gameover.classList.remove('hidden');
}

// ---------------- 事件 → 粒子/音效 ----------------
function handleEvents() {
  if (!world) return;
  for (const e of world.drainEvents()) {
    if (e.type === 'eat') {
      renderer.spawnBurst(e.x, e.y, CONFIG.palette.foods[e.colorIdx % CONFIG.palette.foods.length], 5, 'star');
      if (e.player) audio.eat();
    } else if (e.type === 'death') {
      const s = e.snake;
      const color = s.isGhost ? CONFIG.palette.ghost
        : CONFIG.palette.snakes[s.colorIdx % CONFIG.palette.snakes.length];
      renderer.explodeDeath(s, color, s.isPlayer);
    } else if (e.type === 'powerup') {
      renderer.spawnRing(e.x, e.y, CONFIG.powerup.types[e.ptype].color);
      if (e.player) {
        audio.powerup();
        const def = CONFIG.powerup.types[e.ptype];
        const names = { speed: '疾速！', magnet: '磁力！', slime: '黏液！', feast: '盛宴×2！' };
        hud.floatText(`${def.icon} ${names[e.ptype] || ''}`, def.color);
      }
    } else if (e.type === 'shield_block') {
      renderer.spawnRing(e.x, e.y, CONFIG.shieldSkill.color);
    } else if (e.type === 'milestone') {
      renderer.spawnBurst(e.x, e.y, '#FFD166', 14, 'star');
      renderer.spawnRing(e.x, e.y, '#FFD166');
      hud.floatText(`🎉 长度 ${e.value}！`, '#E8890C');
      audio.milestone();
    } else if (e.type === 'streak') {
      renderer.spawnBurst(e.x, e.y, '#FF6B6B', 10, 'star');
      hud.floatText(`🔥 ${e.count} 连杀！`, '#E85D5D');
      audio.milestone();
    } else if (e.type === 'surge_warn') {
      hud.floatText(`⚡ 狂潮将至 Lv.${e.level}…`, '#E8890C', 50, 30);
      if (navigator.vibrate) navigator.vibrate(30);
    } else if (e.type === 'surge_start') {
      hud.showSurge(e.level, e.mult);
      audio.powerup(); // 上扬音提示狂潮来临
    } else if (e.type === 'surge_end') {
      hud.hideSurge();
    }
  }
}

// ---------------- 主循环 ----------------
let menuDriftT = 0;

function stepFn() {
  if (!world) return;
  if (state === 'playing' || state === 'dying') {
    if (state === 'playing' && player && player.alive) {
      if (input.hasDirection) player.targetAngle = input.targetAngle;
      player.boosting = input.boosting && player.canBoost;
      // 护盾技能：点击按钮 + 冷却就绪 → 开启短时无敌
      if (shieldRequested) {
        shieldRequested = false;
        if (world.tick >= shieldCdUntil && !player.hasEffect('shield')) {
          const SS = CONFIG.shieldSkill;
          player.addEffect('shield', SS.duration);
          shieldCdUntil = world.tick + SS.cooldown;
          audio.shield();
          hud.floatText('🛡 护盾开启！', SS.color);
          if (navigator.vibrate) navigator.vibrate(15);
        }
      }
      world.step();
      camera.follow(player.x, player.y, player.radius, player.alive && player.boosting);
    } else {
      shieldRequested = false;
      // 死亡慢动作：世界 1/3 速度，镜头推近死亡点
      dyingT++;
      if (dyingT % 3 === 0) world.step();
      if (player) camera.follow(deathX, deathY, player.radius * 0.55);
    }
  } else if (state === 'menu') {
    // 菜单背景世界慢跑 + 镜头绕场
    menuDriftT += 1 / 60;
    if (menuDriftT % 0.5 < 1 / 60) world.step(); // 半速省点电
    const cx = CONFIG.world.size / 2;
    const r = CONFIG.world.size * 0.25;
    camera.follow(cx + Math.cos(menuDriftT * 0.08) * r, cx + Math.sin(menuDriftT * 0.08) * r, 14);
  }
}

function renderFn() {
  if (!world) return;
  const now = performance.now();
  const dtFrame = Math.min(0.1, (now - lastFrameAt) / 1000);
  lastFrameAt = now;

  // 死亡慢动作：粒子也放慢
  const slowK = state === 'dying' ? 0.33 : 1;
  renderer.render(world, dtFrame * slowK);
  handleEvents();

  if ((state === 'playing' || state === 'dying') && player) {
    // 今日最佳实时刷新
    if (player.length > todayBest) {
      todayBest = Math.round(player.length);
      storage.setTodayBest(todayBest);
    }
    hud.update(world, player, buildLeaderboard(world, { nick, score: Math.round(player.length) }, 5), todayBest);

    // 护盾按钮三态
    if (player.hasEffect('shield')) {
      hud.updateShield('active', player.effects.shield / CONFIG.shieldSkill.duration);
    } else if (world.tick < shieldCdUntil) {
      hud.updateShield('cooldown', (shieldCdUntil - world.tick) / CONFIG.shieldSkill.cooldown);
    } else {
      hud.updateShield('ready');
    }

    // 小地图（每 6 帧）
    if (++minimapTimer >= 6) {
      minimapTimer = 0;
      minimap.draw(world, player);
    }
  }

  // DPR 自适应：每 2s 检查一次滚动窗口 fps
  if (++dprCheckTimer >= 120) {
    dprCheckTimer = 0;
    const fps = loop.fps;
    const steps = CONFIG.dpr.steps;
    if (fps < CONFIG.dpr.degradeFps && dprIdx < steps.length - 1) {
      dprIdx++;
      applyResize();
    } else if (fps > 58.5 && dprIdx > 0) {
      dprIdx--;
      applyResize();
    }
  }
}

const loop = new GameLoop(stepFn, renderFn);

// ---------------- 事件绑定 ----------------
dom.btnStart.addEventListener('click', () => startGame());
dom.btnRetry.addEventListener('click', () => startGame());
dom.btnHome.addEventListener('click', () => showMenu());

dom.btnShield.addEventListener('click', () => { shieldRequested = true; });

hud.el.mute.addEventListener('click', () => {
  audio.muted = !audio.muted;
  hud.setMuted(audio.muted);
});

window.addEventListener('resize', applyResize);
window.addEventListener('orientationchange', () => setTimeout(applyResize, 100));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.suspend();
  } else {
    loop.resetClock();
    if (state !== 'menu') audio.unlock();
  }
});

// 阻止页面级滚动/橡皮筋（双保险）
document.addEventListener('touchmove', (e) => {
  if (e.target === document.body || e.target === canvas) e.preventDefault();
}, { passive: false });

// ---------------- 启动 ----------------
applyResize();
showMenu();
loop.start();

// 调试/测试钩子（不影响游戏逻辑）
window.__game = {
  get world() { return world; },
  get player() { return player; },
  get state() { return state; },
};
