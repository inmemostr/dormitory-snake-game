// tools/browser_e2e.js — 端到端验证：完整对局流程（CDP 驱动无头 Chrome）
// 验证：开始游戏 → 幽灵/AI 生态 → 玩家撞 AI 死亡 → 结算页 → 再来一局 → 自己的墓碑

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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};

const shot = async (path) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  console.log(`📸 ${path}`);
};

let pass = 0, fail = 0;
const check = (cond, msg) => {
  if (cond) { console.log(`  ✅ ${msg}`); pass++; }
  else { console.error(`  ❌ ${msg}`); fail++; }
};

// 1. 开始游戏
await evalJs(`document.getElementById('btn-start').click()`);
await sleep(3000);

// 2. 生态检查
const eco = await evalJs(`(() => {
  const w = window.__game.world;
  return {
    state: window.__game.state,
    total: w.snakes.length,
    ais: w.snakes.filter(s => s.isAI && s.alive).length,
    ghosts: w.snakes.filter(s => s.isGhost).length,
    tombs: w.tombstones.length,
    foods: w.foods.foods.length,
    powerups: w.powerups.items.length,
  };
})()`);
console.log('生态状态:', JSON.stringify(eco));
check(eco.state === 'playing', '游戏进行中');
check(eco.ais >= 6, `AI 蛇在场（${eco.ais} 条）`);
check(eco.ghosts >= 1, `幽灵蛇在场（${eco.ghosts} 条）`);
check(eco.foods > 400, `食物充足（${eco.foods}）`);
check(eco.powerups >= 3, `道具在场（${eco.powerups}）`);

// 3. 把玩家传送到 AI 身体正中间 → 应撞体死亡
await evalJs(`(() => {
  const w = window.__game.world;
  const p = window.__game.player;
  const ai = w.snakes.find(s => s.isAI && s.alive && s.segCount > 20);
  if (ai) {
    const mid = Math.floor(ai.segCount / 2);
    p.x = ai.segX[mid]; p.y = ai.segY[mid];
  }
})()`);
await sleep(2500); // 等死亡 + 1.4s 结算延迟

const over = await evalJs(`(() => ({
  state: window.__game.state,
  shown: !document.getElementById('gameover').classList.contains('hidden'),
  score: document.getElementById('final-score').textContent,
  cause: document.getElementById('death-cause').textContent,
  rankRows: document.querySelectorAll('#final-rank li').length,
}))()`);
console.log('结算状态:', JSON.stringify(over));
check(over.state === 'gameover', '进入结算状态');
check(over.shown, '结算页已显示');
check(over.rankRows >= 5, `结算排行榜（${over.rankRows} 行）`);
check(over.cause.length > 2, `死因文案：「${over.cause}」`);
await shot('/tmp/snake_gameover.png');

// 4. 再来一局 → 自己的墓碑应出现在新对局
await evalJs(`document.getElementById('btn-retry').click()`);
await sleep(2000);
const retry = await evalJs(`(() => {
  const w = window.__game.world;
  const me = document.getElementById('nick').value || '';
  return {
    state: window.__game.state,
    ownTombs: w.tombstones.filter(t => t.nick.startsWith('蛇蛇')).length,
    totalTombs: w.tombstones.length,
    ghosts: w.snakes.filter(s => s.isGhost).length,
  };
})()`);
console.log('再来一局:', JSON.stringify(retry));
check(retry.state === 'playing', '新对局已开始');
check(retry.ownTombs >= 1, `自己的墓碑已载入新对局（${retry.ownTombs} 个）——魂系闭环成立`);

console.log('— 未捕获异常 —');
console.log(exceptions.length ? exceptions.join('\n') : '（无）');

ws.close();
console.log(fail === 0 && exceptions.length === 0 ? `\n🎉 E2E 全部通过（${pass} 项）` : `\n💥 ${fail} 项失败，${exceptions.length} 个异常`);
process.exit(fail === 0 && exceptions.length === 0 ? 0 : 1);
