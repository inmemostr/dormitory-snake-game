// core/pool.js — 简单对象池（环境无关），杜绝 tick 内 GC

export class Pool {
  /**
   * @param {function():object} factory 新建对象
   * @param {function(object):void} reset 回收时重置
   * @param {number} max 池上限（超出直接丢弃给 GC）
   */
  constructor(factory, reset, max = 500) {
    this.factory = factory;
    this.reset = reset;
    this.max = max;
    this.free = [];
  }

  obtain() {
    return this.free.length ? this.free.pop() : this.factory();
  }

  release(obj) {
    if (this.free.length >= this.max) return;
    this.reset(obj);
    this.free.push(obj);
  }
}
