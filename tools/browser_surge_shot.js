// tools/browser_surge_shot.js — 加速狂潮截图（护盾保命 + 强制触发）
import { writeFileSync } from 'node:fs';

const CDP_HTTP = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://127.0.0.1:8765/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const target = await (await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
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

// 无敌保命 + 强制 Lv.3 狂潮
await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  p.effects.invuln = 99999;
  w.surge.t = 1;
  w.surge.level = 2;
})()`);
await sleep(1000);
const surge = await evalJs(`(() => {
  const w = window.__game.world;
  return {
    active: w.surgeActive, level: w.surge.level, mult: w.surgeMult.toFixed(2),
    banner: !document.getElementById('surge-banner').classList.contains('hidden'),
    text: document.getElementById('surge-text').textContent,
    sub: document.getElementById('surge-sub').textContent,
  };
})()`);
console.log('狂潮状态:', JSON.stringify(surge));
await sleep(600);
await shot('/tmp/v2_surge.png');

ws.close();
process.exit(0);
