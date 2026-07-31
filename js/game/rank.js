// game/rank.js — 排行榜（环境无关）
//
// 纯当局实时数据：玩家 + AI + 幽灵的当前长度。
// 不掺静态假人——所有人「仿佛同时加入」这场对局，起跑线一致，公平感拉满。

/**
 * @param {World|null} world 当前对局（可为空，如结算页已销毁）
 * @param {object} me {nick, score, isLocalBest}
 * @param {number} n 取前 N
 */
export function buildLeaderboard(world, me, n = 10) {
  const entries = [];

  if (world) {
    for (const s of world.snakes) {
      if (!s.alive) continue;
      entries.push({
        nick: s.nick,
        score: Math.round(s.length),
        live: true,
        ghost: s.isGhost,
        isMe: s.isPlayer,
      });
    }
  }

  if (me && me.score > 0) {
    entries.push({ nick: me.nick, score: Math.round(me.score), isMe: true, best: !!me.isLocalBest });
  }

  entries.sort((a, b) => b.score - a.score);

  // 去重：同 nick 只保留最高
  const seen = new Set();
  const deduped = [];
  for (const e of entries) {
    const key = e.nick + (e.isMe ? '#me' : '');
    if (seen.has(key)) continue;
    seen.add(key);
    e.rank = deduped.length + 1;
    deduped.push(e);
  }

  const out = deduped.slice(0, n);
  // 保证「我」可见：掉出前 N 时追加在末尾（带真实名次）
  if (me && me.score > 0 && !out.some(e => e.isMe)) {
    const mine = deduped.find(e => e.isMe);
    if (mine) out.push(mine);
  }
  return out;
}
