// tools/browser_visual2.js — 新版视觉验证：管状蛇身 / 加速狂潮 / 蛇蜕（CDP）
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

// 1. 管状蛇身：开始游戏 → 拉一条大蛇到 AI 旁边
await evalJs(`document.getElementById('btn-start').click()`);
await sleep(3000);
let st = await evalJs(`window.__game.state`);
if (st !== 'playing') { await evalJs(`document.getElementById('btn-retry').click()`); await sleep(1500); }

const tube = await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  if (!p.alive) return { dead: true };
  const ai = w.snakes.find(s => s.isAI && s.alive && s.length > 30);
  p.length = 200; // 胖蛇展示管状形态
  if (ai) {
    p.x = ai.x - Math.cos(ai.angle) * 200;
    p.y = ai.y - Math.sin(ai.angle) * 200;
    p.targetAngle = p.angle = ai.angle;
    return { ai: ai.nick, aiLen: Math.round(ai.length) };
  }
  return null;
})()`);
console.log('管状对比:', JSON.stringify(tube));
await sleep(1300);
await shot('/tmp/v2_tube.png');

// 2. 加速狂潮：强制立刻触发
await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  if (p.alive) { w.surge.t = 1; w.surge.level = 2; } // 直接 Lv.3 看递进色
})()`);
await sleep(1200);
const surge = await evalJs(`(() => {
  const w = window.__game.world;
  return {
    active: w.surgeActive, level: w.surge.level, mult: w.surgeMult,
    banner: !document.getElementById('surge-banner').classList.contains('hidden'),
    text: document.getElementById('surge-text').textContent,
  };
})()`);
console.log('狂潮状态:', JSON.stringify(surge));
await shot('/tmp/v2_surge.png');

// 3. 蛇蜕：杀死玩家 → 再来一局 → 传送到蛇蜕糖果处
await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  const ai = w.snakes.find(s => s.isAI && s.alive && s.segCount > 30);
  if (p.alive && ai) { const m = Math.floor(ai.segCount / 2); p.x = ai.segX[m]; p.y = ai.segY[m]; }
})()`);
await sleep(2500);
await evalJs(`document.getElementById('btn-retry').click()`);
await sleep(2000);
const relic = await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  const corpses = w.foods.foods.filter(f => f.corpse);
  if (p.alive && corpses.length) {
    const c = corpses[0];
    p.x = c.x - 120; p.y = c.y; p.targetAngle = p.angle = 0;
    return { corpseCount: corpses.length, value: c.value };
  }
  return { corpseCount: corpses.length };
})()`);
console.log('蛇蜕状态:', JSON.stringify(relic));
await sleep(1300);
await shot('/tmp/v2_relic.png');

console.log('异常:', exceptions.length ? exceptions.join(' | ') : '（无）');
ws.close();
process.exit(exceptions.length ? 1 : 0);
