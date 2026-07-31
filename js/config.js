// config.js — 全部数值常量，真机调参只改这一处（环境无关，Node 可导入）

export const CONFIG = {
  world: {
    size: 3600,            // 环形世界边长（世界单位 = 像素基准）；左右/上下贯通无边界
    margin: 80,            // 生成参考边距
  },

  snake: {
    initLength: 10,
    baseRadius: 8,
    radiusGrowth: 0.075,   // radius = base + min(maxBonus, length * growth)（粗壮度上调，更夸张）
    maxRadiusBonus: 26,
    baseSpeed: 3.8,        // 每 tick 移动距离（60Hz 逻辑）——初始手感放慢
    speedRadiusPenalty: 0.025, // 粗蛇减速惩罚减半
    minSpeed: 3.2,         // 粗蛇速度下限（不再慢得像爬）
    boostMultiplier: 1.7,
    turnRate: 0.18,        // rad/tick，朝目标角度的最大角速度
    boostTurnFactor: 0.8,  // 加速时转向变钝
    spacingFactor: 0.55,   // 身体节距 = radius * spacingFactor
    boostCostInterval: 8,  // 加速中每 N tick 长度 -1
    minBoostLength: 10,    // 低于此长度禁止加速
    maxSegments: 3000,     // 安全上限
    selfCollision: false,  // 撞自己不死亡（用户定调：只有撞别人才死）
    selfSkipSegs: 10,      // （保留配置，selfCollision 开启时才用）
    milestones: [100, 250, 500, 1000, 2000], // 变大里程碑（触发金色爆发）
  },

  // 护盾技能（手动按钮触发；时间制无敌，不再是一次性拾取）
  shieldSkill: {
    duration: 120,         // 无敌 2s（120 tick）——必须很短
    cooldown: 1500,        // 冷却 25s
    flickerAt: 0.35,       // 剩余时间低于此比例开始闪烁收缩预警
    color: '#7EC8FF',
  },

  food: {
    count: 650,            // 常驻光点数量
    minR: 3, maxR: 6,
    valueMin: 1, valueMax: 3,
    dropPoolMax: 800,      // 尸体/加速掉落的临时食物上限（大蛇全节掉落也够用）
    corpseEveryNSeg: 2,    // 玩家尸体每 N 节掉 1 个食物（AI/幽灵为 1，全链路）
    corpseValue: 2,
    corpseSizeByRadius: 0.45,  // 遗产大小 = 蛇半径 × 系数（大蛇爆大遗产）
    corpseValueByRadius: 0.25, // 遗产价值 = 蛇半径 × 系数（封顶 8）
    magnetSpeed: 6,        // 磁吸时食物飞向蛇头的速度（u/tick）
    // 普通食物造型（0~3）与权重；尸体遗产造型（10~13）
    kinds: ['dot', 'lolli', 'donut', 'star'],
    kindWeights: [40, 22, 22, 16],
    corpseKinds: ['burger', 'sushi', 'melon', 'pizza'],
  },

  powerup: {
    count: 14,             // 常驻道具数（密度提升）
    radius: 16,            // 道具碰撞半径
    respawnMinTick: 300,   // 被吃后补货延迟（tick）
    respawnMaxTick: 600,
    types: {
      speed:  { icon: '⚡', color: '#FFD166', duration: 300,  weight: 30, mult: 1.4 },          // 5s 移速+40%，期间加速免耗
      magnet: { icon: '🧲', color: '#FF8FA3', duration: 480,  weight: 30, radius: 150 },        // 8s 食物吸附
      slime:  { icon: '🐌', color: '#7FDBC0', duration: 360,  weight: 24, radius: 300, mult: 0.6 }, // 6s 周围他蛇 -40%
      feast:  { icon: '⭐', color: '#FFC93C', duration: 480,  weight: 16, mult: 2 },            // 8s 双倍得分
    },
  },

  ai: {
    count: 10,
    hardCount: 4,          // 前 N 条为高难度（带 CHASE）
    decideInterval: 5,     // 每 N tick 决策一次
    viewDist: 600,         // 寻食视野
    fleeDist: 250,         // 避障距离
    respawnMinTick: 180,   // 死后 3~5s 重生
    respawnMaxTick: 300,
    gravityDist: 1200,     // 离玩家超过此距离时漫游方向向玩家偏置
    gravityProb: 0.25,     // 偏置概率（每次决策）
  },

  ghost: {
    concurrent: 6,         // 并发幽灵数
    fadeTicks: 30,         // 淡入/淡出时长
    minSpawnDist: 700,     // 出生点离玩家最小距离（环形距离）
    spawnDelayTick: 60,    // 一条结束后换下一条的间隔
    alpha: 0.45,
  },

  // 加速狂潮：周期性全员免费加速事件（节奏递进：平静期逐轮缩短，狂潮逐轮拉长）
  surge: {
    calmTick: 2700,        // 首轮平静期 45s
    calmMin: 1200,         // 平静期下限 20s
    calmStep: 240,         // 每轮平静期 -4s
    surgeTick: 600,        // 首轮狂潮 10s
    surgeMax: 900,         // 狂潮上限 15s
    surgeTickStep: 45,     // 每轮狂潮 +0.75s
    warnTick: 180,         // 狂潮前 3s 预警
    baseMult: 1.45,        // 狂潮基础加速倍率
    levelMult: 0.07,       // 每级递增
    maxMult: 1.9,
    colors: ['#FFD166', '#FF9F43', '#FF6B6B', '#C3AEF0', '#FF8FA3'], // 等级递进色
  },

  // 连杀：8s 窗口内连续击杀递增奖励
  streak: {
    window: 480,           // 8s
    bonus: 3,              // 每连杀额外奖励长度 = streak × bonus
  },

  // 蛇蜕：死亡后留存的高价值糖果串（魂系血渍）
  corpse: {
    keepRatio: 0.25,       // 保留原长度比例
    value: 5,              // 每颗价值
    r: 7,
    maxPoints: 40,
  },

  camera: {
    smooth: 0.08,          // 指数平滑系数
    zoomBase: 1.6,
    zoomRadiusFactor: 0.012, // 变粗拉远幅度收敛（避免粗蛇「看起来」更慢）
    zoomMin: 0.85,
    zoomMax: 1.6,
    zoomSmooth: 0.06,
    boostZoomOut: 0.94,    // 加速时镜头轻微后拉（FOV punch）
    anchorUpFactor: 1 / 6, // 蛇头锚定核心盒中心偏上 1/6 盒高
  },

  record: {
    sampleEvery: 3,        // 每 N tick 采样一次
    maxStoredRuns: 30,     // localStorage 最多保留局数
    ghostPoolRuns: 5,      // 玩家最近 N 局优先进入幽灵池
    tombstonesPersist: 10, // 自己墓碑持久化数量
  },

  grid: { cell: 120 },     // 空间哈希格基准（3600/120=30 整除成环）

  particles: { max: 200 },

  dpr: {
    initial: 2.5,          // 初始上限 min(devicePixelRatio, initial)
    degradeFps: 55,        // 滚动窗口持续低于此 fps 降档
    steps: [2.5, 2, 1.5, 1.25, 1],
  },

  // 糖果世界配色（renderer 使用；索引化存储，Node 侧不关心）
  palette: {
    bgInner: '#FFF6EC',
    bgOuter: '#FFF1E2',    // 与内圈极接近，避免屏幕空间深浅错觉
    dot: '#F2DCC0',
    dotGap: 60,
    edge: '#F0C9A0',
    snakes: ['#FF8FA3', '#7FDBC0', '#7EC8FF', '#FFD166', '#C3AEF0', '#FFB37E'],
    foods: ['#FF8FA3', '#7FDBC0', '#7EC8FF', '#FFD166', '#C3AEF0', '#FFB37E', '#FF6B8A'],
    ghost: '#8FA3C7',
    tomb: '#E8D5B7',
  },
};

// 工具：角度归一化到 [-PI, PI]
export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function randRange(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

export function randInt(lo, hi) {
  return Math.floor(randRange(lo, hi + 1));
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- 环形世界工具 ----
// 位置归一化到 [0, S)
export function wrapPos(v) {
  const S = CONFIG.world.size;
  return ((v % S) + S) % S;
}

// 最短环形位移（带符号）：归一化到 [-S/2, S/2)
export function wrapDelta(d) {
  const S = CONFIG.world.size;
  return ((d + S / 2) % S + S) % S - S / 2;
}

// 环形距离平方
export function wrapDist2(x0, y0, x1, y1) {
  const dx = wrapDelta(x1 - x0);
  const dy = wrapDelta(y1 - y0);
  return dx * dx + dy * dy;
}

// 颜色明暗调整（factor<1 变深，>1 变亮），供蛇身花纹
export function shadeColor(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * factor), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * factor), 0, 255);
  const b = clamp(Math.round((n & 255) * factor), 0, 255);
  return `rgb(${r},${g},${b})`;
}
