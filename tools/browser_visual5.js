// tools/browser_visual5.js — v1.4 验证：跨屏身体不拉直线 / 遗产大小区隔 / 排行榜公平感
import { writeFileSync } from 'node:fs';

const CDP_HTTP = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://127.0.0.1:8765/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const target = await (await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' })).json();
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
// 禁用缓存，防止吃到旧版 JS 模块
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: PAGE_URL });
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

await evalJs(`document.getElementById('btn-start').click()`);
await sleep(2500);
let st = await evalJs(`window.__game.state`);
if (st !== 'playing') { await evalJs(`document.getElementById('btn-retry').click()`); await sleep(1500); }

// 1. 排行榜公平感：开局 AI 长度应与玩家同量级（10~20），无静态假人
const fair = await evalJs(`(() => {
  const w = window.__game.world;
  const aiLens = w.snakes.filter(s => s.isAI && s.alive).map(s => Math.round(s.length));
  return { aiLens, growths: w.snakes.filter(s=>s.isAI).map(s=>+s.growthMult.toFixed(2)) };
})()`);
console.log('公平性:', JSON.stringify(fair));

// 2. 跨屏不拉直线：长蛇 + 让蛇绕圈使部分身体出屏
await evalJs(`(() => {
  const p = window.__game.player;
  p.length = 400; // 长蛇
  p.effects.invuln = 99999;
})()`);
await evalJs(`document.dispatchEvent(new MouseEvent('mousemove', {clientX: 200, clientY: 700, bubbles: true}))`);
await sleep(2500);
await shot('/tmp/v5_longsnake.png');

// 3. 遗产大小区隔：大蛇 vs 小蛇死亡
const sizes = await evalJs(`(() => {
  const w = window.__game.world;
  // 造一条大蛇一条小蛇并杀死
  const big = w.snakes.find(s => s.isAI && s.alive);
  if (big) { big.length = 500; }
  const small = w.snakes.filter(s => s.isAI && s.alive)[1];
  if (small) { small.length = 15; }
  return null;
})()`);
await sleep(500);
await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  const ais = w.snakes.filter(s => s.isAI && s.alive).slice(0, 2);
  for (const ai of ais) { ai.x = p.x + 40; ai.y = p.y + 40; ai.alive = false; w.corpseToFood(ai); }
  // 把玩家挪到尸体旁
  p.x += 100; p.y += 60;
})()`);
await sleep(900);
const feast = await evalJs(`(() => {
  const w = window.__game.world;
  const rs = w.foods.foods.filter(f => f.kind >= 10).map(f => Math.round(f.r));
  return { count: rs.length, min: Math.min(...rs), max: Math.max(...rs) };
})()`);
console.log('遗产尺寸:', JSON.stringify(feast));
await shot('/tmp/v5_feast.png');

console.log('异常:', exceptions.length ? exceptions.join(' | ') : '（无）');
ws.close();
process.exit(exceptions.length ? 1 : 0);
