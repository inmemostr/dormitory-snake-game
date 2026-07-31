// tools/browser_visual4.js — v1.3 视觉验证：死亡爆炸 / 加速特效（速度线+风压锥+狂奔脸）
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

await evalJs(`document.getElementById('btn-start').click()`);
await sleep(2500);
let st = await evalJs(`window.__game.state`);
if (st !== 'playing') { await evalJs(`document.getElementById('btn-retry').click()`); await sleep(1500); }

// 1. 加速特效：合成鼠标事件按住加速 + 定向，等 FOV 稳定后拍
await evalJs(`(() => {
  const p = window.__game.player;
  p.length = 60;
  document.dispatchEvent(new MouseEvent('mousemove', {clientX: 320, clientY: 300, bubbles: true}));
  document.dispatchEvent(new MouseEvent('mousedown', {clientX: 320, clientY: 300, bubbles: true}));
})()`);
await sleep(1200);
await shot('/tmp/v4_boost.png');
await evalJs(`document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))`);

// 2. 死亡爆炸：传送到 AI 身体 → 轮询死亡瞬间立刻抓拍
await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  const ai = w.snakes.find(s => s.isAI && s.alive && s.segCount > 40);
  if (ai) { const m = Math.floor(ai.segCount / 2); p.x = ai.segX[m]; p.y = ai.segY[m]; }
})()`);
let dead = false;
for (let i = 0; i < 40; i++) {
  await sleep(80);
  const s = await evalJs(`window.__game.state`);
  if (s === 'dying' || s === 'gameover') { dead = true; break; }
}
console.log('死亡触发:', dead);
await shot('/tmp/v4_explode1.png');
await sleep(280);
await shot('/tmp/v4_explode2.png');

console.log('异常:', exceptions.length ? exceptions.join(' | ') : '（无）');
ws.close();
process.exit(exceptions.length ? 1 : 0);
