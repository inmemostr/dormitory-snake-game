// game/storage.js — localStorage 读写与配额管理（浏览器专用，全部静默容错）
//
// Key 规划：
//  snake.best          历史最高分
//  snake.runs.index    [{id, ts, score, nick, bytes}] 最近 N 局索引（LRU）
//  snake.run.<id>      单局回放 JSON
//  snake.tombs         自己的墓碑 [{x,y,nick,score}] 最近 10 个
//  snake.corpse        蛇蜕（上一局尸体留存糖果串，只留最近一具）
//  snake.tombs         自己的墓碑 [{x,y,nick,score}] 最近 10 个

import { CONFIG } from '../config.js';

const K = {
  best: 'snake.best',
  todayBest: 'snake.todayBest',
  index: 'snake.runs.index',
  run: (id) => `snake.run.${id}`,
  tombs: 'snake.tombs',
  corpse: 'snake.corpse',
};

function safeGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function safeSet(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch { return false; }
}

export const storage = {
  // ---- 最高分 ----
  getBest() {
    try { return parseInt(localStorage.getItem(K.best) || '0', 10) || 0; }
    catch { return 0; }
  },
  setBest(v) {
    try { localStorage.setItem(K.best, String(v)); } catch { /* 静默 */ }
  },

  // ---- 今日最佳（按自然日重置）----
  getTodayBest() {
    const v = safeGet(K.todayBest);
    if (!v || v.date !== new Date().toDateString()) return 0;
    return v.score || 0;
  },
  setTodayBest(score) {
    safeSet(K.todayBest, { date: new Date().toDateString(), score: Math.round(score) });
  },

  // ---- 回放 LRU ----
  _index() { return safeGet(K.index) || []; },
  _saveIndex(idx) { safeSet(K.index, idx); },

  /** 保存一局回放；超限按 LRU 淘汰最旧。返回是否成功。 */
  saveRun(replay) {
    const id = `r${replay.ts}_${Math.floor(Math.random() * 1e4)}`;
    const json = JSON.stringify(replay);
    const bytes = json.length;

    // 先清理：配额预估超 4MB 或条数超限则淘汰最旧
    let idx = this._index();
    const maxRuns = CONFIG.record.maxStoredRuns;
    const totalBytes = () => idx.reduce((s, r) => s + (r.bytes || 0), 0);
    while (idx.length >= maxRuns || totalBytes() + bytes > 4 * 1024 * 1024) {
      const oldest = idx.shift();
      if (!oldest) break;
      try { localStorage.removeItem(K.run(oldest.id)); } catch { /* 静默 */ }
    }

    try {
      localStorage.setItem(K.run(id), json);
    } catch {
      // 实在写不进：清掉一半再试一次，仍失败则放弃（不影响游戏）
      const half = idx.splice(0, Math.ceil(idx.length / 2));
      for (const o of half) { try { localStorage.removeItem(K.run(o.id)); } catch { /* 静默 */ } }
      try { localStorage.setItem(K.run(id), json); }
      catch { this._saveIndex(idx); return false; }
    }

    idx.push({ id, ts: replay.ts, score: replay.score, nick: replay.nick, bytes });
    this._saveIndex(idx);
    return true;
  },

  /** 读最近 n 局回放（新→旧） */
  loadRuns(n = CONFIG.record.ghostPoolRuns) {
    const idx = this._index().slice(-n).reverse();
    const out = [];
    for (const meta of idx) {
      const r = safeGet(K.run(meta.id));
      if (r) out.push(r);
    }
    return out;
  },

  // ---- 自己的墓碑 ----
  getTombstones() { return safeGet(K.tombs) || []; },
  addTombstone(t) {
    const arr = this.getTombstones();
    arr.push(t);
    while (arr.length > CONFIG.record.tombstonesPersist) arr.shift();
    safeSet(K.tombs, arr);
  },

  // ---- 蛇蜕（只留最近一具）----
  getCorpse() { return safeGet(K.corpse); },
  saveCorpse(c) { safeSet(K.corpse, c); },
};
