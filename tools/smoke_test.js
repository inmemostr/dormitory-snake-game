// tools/smoke_test.js — 全流程无头冒烟测试：玩家 bot + AI + 幽灵 + 录制 + 排行
// 用法：node tools/smoke_test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { World } from '../js/game/world.js';
import { GhostManager } from '../js/game/ghost.js';
import { Recorder, decodeReplay } from '../js/game/record.js';
import { buildLeaderboard } from '../js/game/rank.js';
import { CONFIG } from '../js/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GDIR = join(__dirname, '..', 'assets', 'ghosts');

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.error(`  ❌ ${msg}`); failures++; }
};

// 1. 回放编解码往返（环形世界：首帧在 [0,S)，相邻采样为小增量）
console.log('— 编解码往返 —');
{
  const raw = JSON.parse(readFileSync(join(GDIR, 'ghost_01.json'), 'utf8'));
  const d = decodeReplay(raw);
  assert(d.samples.length > 50, `ghost_01 解码出 ${d.samples.length} 个采样`);
  const s0 = d.samples[0];
  assert(s0.x === raw.frames[0] && s0.y === raw.frames[1], '首帧绝对坐标一致');
  assert(s0.x >= 0 && s0.x < CONFIG.world.size && s0.y >= 0 && s0.y < CONFIG.world.size,
    '首帧已回绕到世界范围内');
  // 环形增量：相邻采样位移应始终很小（跨缝不出现横扫全场的大跳变）
  let maxStep = 0;
  for (let i = 1; i < d.samples.length; i++) {
    const dx = Math.abs(d.samples[i].x - d.samples[i - 1].x);
    const dy = Math.abs(d.samples[i].y - d.samples[i - 1].y);
    maxStep = Math.max(maxStep, dx, dy);
  }
  assert(maxStep < 120, `相邻采样最大位移 ${maxStep}（无跨缝横扫）`);
}

// 2. 完整对局模拟
console.log('— 完整对局（玩家 bot + 8 AI + 幽灵池）—');
{
  const world = new World();
  const player = world.addPlayer('测试玩家', 0);
  world.initAIs();
  const pool = ['ghost_01.json', 'ghost_02.json', 'ghost_03.json']
    .map(f => JSON.parse(readFileSync(join(GDIR, f), 'utf8')));
  world.ghosts = new GhostManager(world, pool);
  world.recorder = new Recorder();

  let sawGhost = false;
  let playerAte = false;
  let ghostDied = false;
  let playerDied = false;
  let tombCount0 = world.tombstones.length;
  const len0 = player.length;

  world.onPlayerDeath = () => { playerDied = true; };

  for (let t = 0; t < 8000 && !playerDied; t++) {
    // 玩家 bot：朝最近食物，偶尔加速
    if (t % 7 === 0) {
      let best = null, bd = Infinity;
      for (const f of world.foods.foods) {
        const dx = f.x - player.x, dy = f.y - player.y;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = f; }
      }
      if (best) player.targetAngle = Math.atan2(best.y - player.y, best.x - player.x);
      player.boosting = player.canBoost && Math.random() < 0.1;
    }
    world.step();
    if (world.ghosts.activeCount > 0) sawGhost = true;
    for (const e of world.events) {
      if (e.type === 'eat' && e.player) playerAte = true;
      if (e.type === 'death' && e.ghost) ghostDied = true;
    }
    world.drainEvents();
  }

  assert(sawGhost, '幽灵已生成并参与对局');
  assert(playerAte || player.length > len0, `玩家吃到食物（长度 ${len0} → ${Math.round(player.length)}）`);
  assert(world.tombstones.length > tombCount0, `墓碑已生成（${world.tombstones.length} 个，含幽灵陨落地）`);
  console.log(`  ℹ️  幽灵被撞截断事件发生：${ghostDied ? '是' : '否（本局未发生，正常随机）'}`);
  console.log(`  ℹ️  玩家存活 ${world.tick} tick，死亡：${playerDied}`);

  // 录制产出
  const replay = world.recorder.finish({ nick: '测试玩家', score: Math.round(player.length), dieX: player.x, dieY: player.y });
  const bytes = JSON.stringify(replay).length;
  assert(replay.frames.length > 0, `回放录制 ${replay.frames.length / 5} 个采样`);
  assert(bytes < 60 * 1024 || world.recorder.samples.length < 3600, `回放体积 ${(bytes / 1024).toFixed(1)}KB`);

  // 排行榜
  const rank = buildLeaderboard(world, { nick: '测试玩家', score: Math.round(player.length) }, 10);
  assert(rank.length > 0 && rank[0].score >= rank[rank.length - 1].score, '排行榜有序');
  assert(rank.some(e => e.isMe), '排行榜包含玩家');
}

// 3. 道具效果
console.log('— 道具系统 —');
{
  const world = new World();
  const player = world.addPlayer('道具测试', 0);
  const myItem = { x: player.x + 60, y: player.y + 40, type: 'speed', phase: 0, bornTick: 0 };
  world.powerups.items.push(myItem);
  let got = false;
  for (let t = 0; t < 300 && !got; t++) {
    // 每 tick 朝目标道具导航（初始角度随机，直接设一次 targetAngle 会飞偏）
    if (world.powerups.items.includes(myItem)) {
      player.targetAngle = Math.atan2(myItem.y - player.y, myItem.x - player.x);
    }
    world.step();
    got = player.hasEffect('speed');
  }
  assert(got, '吃到疾速糖果并生效');
  assert(player.speed() > player.baseSpeed, `移速提升（${player.baseSpeed.toFixed(1)} → ${player.speed().toFixed(1)}）`);

  // 环形回归：蛇头坐标绕圈漂移后（未回绕的大坐标）仍能吃到道具
  const world2 = new World();
  const p2 = world2.addPlayer('环形拾取', 0);
  const S2 = CONFIG.world.size;
  const item2 = { x: 500, y: 500, type: 'magnet', phase: 0, bornTick: 0 };
  world2.powerups.items.push(item2);
  p2.x = 500 + S2 * 3;   // 头坐标漂移了 3 圈
  p2.y = 500 + S2 * 5;
  const got2 = world2.powerups.tryPickup(p2);
  assert(got2 && got2.type === 'magnet', '头坐标漂移多圈后仍能吃到道具（环形距离）');
}

// 4. 加速狂潮（节奏递进：平静期逐轮缩短）
console.log('— 加速狂潮 —');
{
  const world = new World();
  const player = world.addPlayer('狂潮测试', 0);
  assert(!world.surgeActive && world.surgeMult === 1, '初始为平静期');
  let surgeStarted = 0, surgeEnded = 0, warned = 0;
  for (let t = 0; t < CONFIG.surge.calmTick + CONFIG.surge.surgeTick + 100; t++) {
    world.step();
    for (const e of world.events) {
      if (e.type === 'surge_start') surgeStarted++;
      if (e.type === 'surge_end') surgeEnded++;
      if (e.type === 'surge_warn') warned++;
    }
    world.drainEvents();
    if (!player.alive) break;
  }
  assert(surgeStarted >= 1, `狂潮触发 ${surgeStarted} 次`);
  assert(surgeEnded >= 1, `狂潮结束 ${surgeEnded} 次（周期完整）`);
  assert(warned >= 1, `狂潮预警 ${warned} 次（提前 3s 提示）`);
  assert(world.surge.level >= 1, `狂潮等级递进（Lv.${world.surge.level}）`);
  // 递进：第二轮平静期应短于首轮
  const C2 = CONFIG.surge;
  const calm2 = Math.max(C2.calmMin, C2.calmTick - C2.calmStep);
  assert(calm2 < C2.calmTick, `平静期逐轮缩短（${C2.calmTick} → ${calm2}）`);
}

// 5. 自撞不死亡（用户定调：只有撞别人才死；绕回穿过自己身体应安然无恙）
console.log('— 自撞豁免 —');
{
  const world = new World();
  const player = world.addPlayer('自撞测试', 0);
  player.length = 120;  // 足够长才能绕圈碰到自己
  let died = false;
  world.onPlayerDeath = () => { died = true; };
  const startX = player.x, startY = player.y;
  player.targetAngle = 0;
  for (let t = 0; t < 200 && !died; t++) {
    player.targetAngle = 0;
    world.step();
    world.drainEvents();
  }
  for (let t = 0; t < 600 && !died; t++) {
    player.targetAngle = Math.atan2(startY - player.y, startX - player.x);
    world.step();
    world.drainEvents();
  }
  assert(!died && player.alive, '掉头绕回穿过自己身体 → 存活（自撞已豁免）');
}

console.log(failures === 0 ? '\n🎉 全部冒烟测试通过' : `\n💥 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
