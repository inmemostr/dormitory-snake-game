// tools/browser_visual.js — 幽灵蛇/墓碑近景视觉验证（CDP）
import { writeFileSync } from 'node:fs';

const CDP_HTTP = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://127.0.0.1:8765/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const target = await (await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const exceptions = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
};
await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');
await send('Page.enable');
await sleep(3000);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.value;
};
const shot = async (path) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  console.log(`📸 ${path}`);
};

// 开始游戏，把玩家传送到幽灵旁边，镜头跟过去
await evalJs(`document.getElementById('btn-start').click()`);
await sleep(3500);

// 若玩家已意外死亡，先重开
const st = await evalJs(`window.__game.state`);
if (st !== 'playing') {
  await evalJs(`document.getElementById('btn-retry').click()`);
  await sleep(2000);
}

const info = await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  if (!p.alive) return { dead: true };
  const g = w.snakes.find(s => s.isGhost && s.alive);
  if (g) {
    // 放到幽灵后方平行跟随，避免立刻撞死
    p.x = g.x - Math.cos(g.angle) * 260;
    p.y = g.y - Math.sin(g.angle) * 260;
    p.targetAngle = g.angle;
    p.angle = g.angle;
    p.length = 80; // 稍微长大些，身体形态更明显
    return { ghost: g.nick, gx: Math.round(g.x), gy: Math.round(g.y) };
  }
  return null;
})()`);
console.log('幽灵目标:', JSON.stringify(info));
await sleep(1500);
await shot('/tmp/snake_ghost.png');

// 传送到墓碑旁（取世界内部的墓碑）
const tomb = await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  if (!p.alive) return { dead: true };
  const S = w.grid.size;
  const t = w.tombstones.find(t => t.x > 400 && t.x < S - 400 && t.y > 400 && t.y < S - 400);
  if (t) { p.x = t.x - 150; p.y = t.y; p.targetAngle = 0; p.angle = 0; return t; }
  return null;
})()`);
console.log('墓碑目标:', JSON.stringify(tomb));
await sleep(1200);
await shot('/tmp/snake_tomb.png');

console.log('异常:', exceptions.length ? exceptions.join(' | ') : '（无）');
ws.close();
process.exit(exceptions.length ? 1 : 0);
