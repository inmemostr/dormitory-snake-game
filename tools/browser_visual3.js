// tools/browser_visual3.js — v1.2 视觉验证：新HUD/护盾/美食遗产/磁力漩涡/新墓碑（CDP）
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

// 1. 开局：新 HUD 全貌（统计卡/冠军/排行榜/小地图/护盾按钮）
await evalJs(`document.getElementById('btn-start').click()`);
await sleep(3000);
let st = await evalJs(`window.__game.state`);
if (st !== 'playing') { await evalJs(`document.getElementById('btn-retry').click()`); await sleep(1500); }
await evalJs(`(() => {
  const p = window.__game.player;
  p.effects.invuln = 99999;  // 保命拍图
  p.length = 130;
})()`);
await sleep(1500);
await shot('/tmp/v3_hud.png');

// 2. 磁力漩涡 + 护盾环 + 美食遗产同框：给玩家磁力+护盾，旁边放一堆遗产食物
await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  p.addEffect('magnet', 9999);
  p.addEffect('shield', 100);
  // 周围撒美食遗产 + 普通食物
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    w.foods.spawnAt(p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120, 2, 5, true, { kind: 10 + (i % 4) });
  }
  // 旁边立个墓碑看新设计
  w.addTombstone(p.x + 150, p.y + 60, '测试墓碑', 888);
})()`);
await sleep(800);
await shot('/tmp/v3_effects.png');

// 3. 护盾即将消失（闪烁收缩预警）
await evalJs(`(() => { window.__game.player.effects.shield = 30; })()`); // 剩 0.5s，<35% 阈值
await sleep(400);
await shot('/tmp/v3_shield_flicker.png');

console.log('异常:', exceptions.length ? exceptions.join(' | ') : '（无）');
ws.close();
process.exit(exceptions.length ? 1 : 0);
