// tools/browser_check.js — 用 CDP 驱动无头 Chrome 验证游戏页面（零依赖，Node 内置 WebSocket）
// 用法：先启动 Chrome（--headless=new --remote-debugging-port=9222），再 node tools/browser_check.js

import { writeFileSync } from 'node:fs';

const CDP_HTTP = 'http://127.0.0.1:9222';
const PAGE_URL = 'http://127.0.0.1:8765/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 1. 创建目标页
const target = await (await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);

let msgId = 0;
const pending = new Map();
const consoleMsgs = [];
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
  } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    consoleMsgs.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
  } else if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  }
};

await new Promise(r => { ws.onopen = r; });
await send('Runtime.enable');
await send('Page.enable');

// 等页面加载
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

// 2. 菜单页状态
const menuState = await evalJs(`(() => ({
  title: document.title,
  menuVisible: !document.getElementById('menu').classList.contains('hidden'),
  hasCanvas: !!document.getElementById('game').getContext('2d'),
  w: innerWidth, h: innerHeight,
}))()`);
console.log('菜单页状态:', JSON.stringify(menuState));
await shot('/tmp/snake_menu.png');

// 3. 点击开始游戏
await evalJs(`document.getElementById('btn-start').click()`);
await sleep(2500);

const gameState = await evalJs(`(() => {
  const score = document.getElementById('score-val').textContent;
  const hudVisible = !document.getElementById('hud').classList.contains('hidden');
  const rankRows = document.querySelectorAll('#rank-list li').length;
  return { hudVisible, score, rankRows };
})()`);
console.log('游戏中状态:', JSON.stringify(gameState));
await shot('/tmp/snake_game.png');

// 4. 模拟鼠标操控（页面内合成事件，驱动桌面兼容模式）
await evalJs(`document.dispatchEvent(new MouseEvent('mousemove', {clientX: 300, clientY: 300, bubbles: true}))`);
await sleep(1500);
await evalJs(`document.dispatchEvent(new MouseEvent('mousemove', {clientX: 100, clientY: 500, bubbles: true}))`);
await evalJs(`document.dispatchEvent(new MouseEvent('mousedown', {clientX: 100, clientY: 500, bubbles: true}))`);
await sleep(1500);
await evalJs(`document.dispatchEvent(new MouseEvent('mouseup', {clientX: 100, clientY: 500, bubbles: true}))`);
await shot('/tmp/snake_game2.png');

const gameState2 = await evalJs(`(() => ({
  score: document.getElementById('score-val').textContent,
  gameoverShown: !document.getElementById('gameover').classList.contains('hidden'),
}))()`);
console.log('操控后状态:', JSON.stringify(gameState2));

// 5. 报错汇总
console.log('\n— 控制台错误/警告 —');
console.log(consoleMsgs.length ? consoleMsgs.join('\n') : '（无）');
console.log('— 未捕获异常 —');
console.log(exceptions.length ? exceptions.join('\n') : '（无）');

ws.close();
process.exit(exceptions.length ? 1 : 0);
