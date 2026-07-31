// game/provider.js — 数据提供者抽象（为接真后端预留）
//
// v1 用 LocalProvider（内置预置幽灵 + localStorage）；
// 未来后端按同一契约实现 4 个方法 → 换 HttpProvider，游戏逻辑零改动。
//
// 接口契约（后端 API 数据格式即此）：
//   GhostReplay = { v, nick, score, die:[x,y], dur, ts, colorIdx, frames:[...] }（见 record.js）
//   RankEntry   = { nick, score, ts }

import { storage } from './storage.js';
import { CONFIG } from '../config.js';

export class LocalProvider {
  /**
   * 拉取幽灵回放池：预置 assets/ghosts + 本机玩家最近 N 局
   * @param {number} count
   * @returns {Promise<object[]>} 压缩回放 JSON 数组
   */
  async fetchGhosts(count = 12) {
    const pool = [];

    // 1. 预置幽灵（离线生成）
    try {
      const idxRes = await fetch('assets/ghosts/index.json');
      if (idxRes.ok) {
        const idx = await idxRes.json(); // {files: [...]}
        const files = idx.files.slice(0, count);
        const jsons = await Promise.all(
          files.map(f => fetch(`assets/ghosts/${f}`).then(r => r.ok ? r.json() : null).catch(() => null))
        );
        for (const j of jsons) if (j && j.frames) pool.push(j);
      }
    } catch { /* 预置缺失不致命 */ }

    // 2. 本机历史局（最近 5 局）——「遇到昨天的自己」
    for (const r of storage.loadRuns(CONFIG.record.ghostPoolRuns)) {
      if (r && r.frames && r.frames.length > 100) pool.push(r); // 太短的不做幽灵
    }

    return pool;
  }

  /**
   * 拉取排行榜基线（静态模拟；实时部分由 rank.js 混入）
   */
  async fetchLeaderboard() {
    return [];
  }

  /** 上传本局回放 → 存 localStorage（含死亡点） */
  async uploadReplay(replay) {
    storage.saveRun(replay);
    if (replay.die) {
      storage.addTombstone({
        x: replay.die[0], y: replay.die[1],
        nick: replay.nick, score: replay.score,
      });
    }
  }

  /** 上传分数 → 更新本地最高 */
  async uploadScore(score) {
    if (score > storage.getBest()) storage.setBest(Math.round(score));
  }

  /** 蛇蜕：保存/读取上一局尸体留存（只留最近一具） */
  saveCorpse(c) { storage.saveCorpse(c); }
  getOwnCorpse() { return storage.getCorpse(); }

  /** 自己历史的墓碑（下次开局载入） */
  getOwnTombstones() {
    return storage.getTombstones();
  }

  getBest() {
    return storage.getBest();
  }
}

/**
 * 未来真后端实现（接口契约已定，后端同学照此实现即可）：
 *   GET  /api/ghosts?count=N     → GhostReplay[]
 *   GET  /api/leaderboard        → RankEntry[]
 *   POST /api/replays            body: GhostReplay
 *   POST /api/scores             body: {nick, score, ts}
 */
export class HttpProvider {
  constructor(baseUrl, getAuth = null) {
    this.baseUrl = baseUrl;
    this.getAuth = getAuth; // () => ({token} | null)，App JSBridge 注入登录态
    this._local = new LocalProvider(); // 网络失败兜底
  }

  async _req(path, opts = {}) {
    const auth = this.getAuth ? this.getAuth() : null;
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (auth && auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
    const res = await fetch(this.baseUrl + path, { ...opts, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async fetchGhosts(count = 12) {
    try { return await this._req(`/api/ghosts?count=${count}`); }
    catch { return this._local.fetchGhosts(count); }
  }

  async fetchLeaderboard() {
    try { return await this._req('/api/leaderboard'); }
    catch { return []; }
  }

  async uploadReplay(replay) {
    try { await this._req('/api/replays', { method: 'POST', body: JSON.stringify(replay) }); }
    catch { await this._local.uploadReplay(replay); }
  }

  async uploadScore(score, nick) {
    try { await this._req('/api/scores', { method: 'POST', body: JSON.stringify({ nick, score, ts: Date.now() }) }); }
    catch { await this._local.uploadScore(score); }
  }

  getOwnTombstones() { return this._local.getOwnTombstones(); }
  getBest() { return this._local.getBest(); }
  saveCorpse(c) { this._local.saveCorpse(c); }
  getOwnCorpse() { return this._local.getOwnCorpse(); }
}
