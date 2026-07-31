// render/hud.js — HUD（DOM 实现）：统计卡（长度/击杀/今日最佳/历史最高/冠军）、
// 实时排行榜（皇冠）、道具倒计时环、护盾按钮三态、浮动文字、加速狂潮横幅

import { CONFIG } from '../config.js';

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      score: document.getElementById('score-val'),
      kills: document.getElementById('kills-val'),
      todayBest: document.getElementById('today-best'),
      historyBest: document.getElementById('history-best'),
      champion: document.getElementById('champion-text'),
      rankList: document.getElementById('rank-list'),
      power: document.getElementById('powerup-indicator'),
      powerIcon: document.getElementById('powerup-icon'),
      powerRing: document.getElementById('powerup-ring'),
      surge: document.getElementById('surge-banner'),
      surgeText: document.getElementById('surge-text'),
      surgeSub: document.getElementById('surge-sub'),
      floatLayer: document.getElementById('float-layer'),
      btnShield: document.getElementById('btn-shield'),
      shieldSweep: document.getElementById('shield-sweep'),
      boost: document.getElementById('btn-boost'),
      mute: document.getElementById('btn-mute'),
    };
    this._lastScore = -1;
    this._lastKills = -1;
    this._lastTodayBest = -1;
    this._rankTimer = 0;
    this._champTimer = 0;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  /** 开局时初始化静态数据 */
  setBests(todayBest, historyBest) {
    this.el.todayBest.textContent = `今日最佳 ${todayBest}`;
    this.el.historyBest.textContent = `历史最高 ${historyBest}`;
    this._lastTodayBest = todayBest;
  }

  /** 每帧调用（内部按需节流）；todayBestNow = 实时的今日最佳（主循环负责写存储） */
  update(world, player, rankEntries, todayBestNow) {
    const score = Math.round(player.length);
    if (score !== this._lastScore) {
      this.el.score.textContent = score;
      this._lastScore = score;
    }
    if (player.kills !== this._lastKills) {
      this.el.kills.textContent = `击杀 ${player.kills}`;
      this._lastKills = player.kills;
    }
    if (todayBestNow !== this._lastTodayBest) {
      this.el.todayBest.textContent = `今日最佳 ${todayBestNow}`;
      this._lastTodayBest = todayBestNow;
    }

    // 排行榜节流刷新（每 30 帧 ≈ 0.5s）
    if (++this._rankTimer >= 30 && rankEntries) {
      this._rankTimer = 0;
      this._renderRank(rankEntries);
    }

    // 冠军（场上最高分者，节流 60 帧）
    if (++this._champTimer >= 60) {
      this._champTimer = 0;
      let champ = null;
      for (const s of world.snakes) {
        if (!s.alive) continue;
        if (!champ || s.length > champ.length) champ = s;
      }
      if (champ) {
        this.el.champion.textContent = `${champ.nick} · ${Math.round(champ.length)}`;
      }
    }

    // 道具指示（护盾技能有自己的按钮，不在这里显示）
    const effect = Object.keys(player.effects).find(k => k !== 'invuln' && k !== 'shield' && player.effects[k] > 0);
    if (effect) {
      const def = CONFIG.powerup.types[effect];
      const remain = player.effects[effect] / def.duration;
      this.el.power.classList.remove('hidden');
      this.el.powerIcon.textContent = def.icon;
      this.el.powerRing.style.setProperty('--p', `${Math.round(remain * 100)}%`);
      this.el.powerRing.style.setProperty('--c', def.color);
    } else {
      this.el.power.classList.add('hidden');
    }
  }

  /** 护盾按钮三态：active 生效中 / cooldown 冷却中 / ready 就绪 */
  updateShield(mode, ratio) {
    const btn = this.el.btnShield;
    if (mode === 'active') {
      btn.classList.add('active');
      btn.classList.remove('on-cooldown');
      this.el.shieldSweep.style.setProperty('--cd', '0%');
    } else if (mode === 'cooldown') {
      btn.classList.remove('active');
      btn.classList.add('on-cooldown');
      this.el.shieldSweep.style.setProperty('--cd', `${Math.round((1 - ratio) * 100)}%`);
    } else {
      btn.classList.remove('active', 'on-cooldown');
      this.el.shieldSweep.style.setProperty('--cd', '0%');
    }
  }

  /** 浮动文字（拾取道具/里程碑），x,y 为屏幕百分比 */
  floatText(text, color = '#FF8FA3', x = 50, y = 38) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.color = color;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    this.el.floatLayer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  _renderRank(entries) {
    const top = entries.slice(0, 6); // 前 5 + 可能的「我」追加行
    let html = '';
    top.forEach((e) => {
      const cls = e.isMe ? ' class="me"' : '';
      const crown = e.rank === 1 ? '👑 ' : '';
      const tag = e.ghost ? ' 👻' : '';
      html += `<li${cls}><span>${crown}${e.rank}. ${escapeHtml(e.nick)}${tag}</span><b>${e.score}</b></li>`;
    });
    this.el.rankList.innerHTML = html;
  }

  setMuted(m) {
    this.el.mute.textContent = m ? '🔇' : '🔊';
  }

  /** 加速狂潮横幅 */
  showSurge(level, mult) {
    const colors = CONFIG.surge.colors;
    const c = colors[(level - 1) % colors.length];
    this.el.surge.classList.remove('hidden');
    this.el.surge.style.setProperty('--surge-c', c);
    this.el.surgeText.style.color = c;
    this.el.surgeText.style.textShadow = `0 2px 12px rgba(0,0,0,0.18), 0 0 22px ${c}`;
    this.el.surgeText.textContent = `⚡ 加速狂潮 Lv.${level} ⚡`;
    this.el.surgeSub.textContent = `全员加速 ×${mult.toFixed(2)}，免费不耗长度！`;
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  }

  hideSurge() {
    this.el.surge.classList.add('hidden');
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
