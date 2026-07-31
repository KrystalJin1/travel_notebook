/* 内核层：只认识 Collection / Entry / Media，不认识「旅行」。
   以后想做读书手帐、搬家手帐，这个文件一行都不用改。
   字段定义见 docs/需求文档.md §3.1。 */
(function (root) {
  'use strict';

  const DAY = 864e5;

  /* ---------- 时间 ---------- */
  // "2026-03-14" / "2026-03-14T09:20" -> Date（按本地时间解析，避免时区把日期挪一天）
  function parseTime(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }

  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // 含首尾的天数：3.14 – 3.19 是 6 天，不是 5 天
  function spanDays(time) {
    const a = parseTime(time && time.start);
    if (!a) return 0;
    const b = parseTime(time && time.end) || a;
    return Math.round((midnight(b) - midnight(a)) / DAY) + 1;
  }

  // entry 落在 collection 的第几天（从 1 起）。没时间的返回 null
  function dayIndex(entry, collection) {
    const base = parseTime(collection.time && collection.time.start);
    const t = parseTime(entry.time && entry.time.start);
    if (!base || !t) return null;
    return Math.round((midnight(t) - midnight(base)) / DAY) + 1;
  }

  function daysUntil(dateStr, now) {
    const t = parseTime(dateStr);
    if (!t) return null;
    return Math.round((midnight(t) - midnight(now || new Date())) / DAY);
  }

  /* ---------- 集合运算 ---------- */
  const byType = (entries, ...types) => entries.filter(e => types.indexOf(e.type) >= 0);
  const allMedia = entries => entries.reduce((a, e) => a.concat(e.media || []), []);
  const sumBy = (list, fn) => list.reduce((a, x) => a + (fn(x) || 0), 0);

  function distinct(list) {
    const out = [], seen = Object.create(null);
    for (const v of list) {
      if (v == null || v === '' || seen[v]) continue;
      seen[v] = 1; out.push(v);
    }
    return out;
  }

  function groupBy(list, fn) {
    const map = new Map();
    for (const x of list) {
      const k = fn(x);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    }
    return map;
  }

  // 时间升序，无时间的排最后；时间相同按 id 兜底 —— 保证顺序确定，快照测试才做得了
  function sorted(entries) {
    return entries.slice().sort((a, b) => {
      const ta = parseTime(a.time && a.time.start), tb = parseTime(b.time && b.time.start);
      if (ta && tb && +ta !== +tb) return ta - tb;
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  /* ---------- 媒体 ---------- */
  // 一条 media 该怎么画，只在这里判一次（§3.1）：
  //   art:fuji  -> 内置矢量插画，交给 sketch.js 的 ART 库
  //   img:kyoto -> 位图场景插画，查 bundle 里内联的 data: URI
  //   其它       -> 当成图片地址直接用
  // 查不到的 img: 返回 {missing}，页面不画也不猜 —— 跟 §3.2 坐标查不到同一条规矩。
  function mediaRef(path, images) {
    const p = String(path || '');
    if (/^art:/.test(p)) return { art: p.slice(4) };
    if (/^img:/.test(p)) {
      const key = p.slice(4), src = (images || {})[key];
      return src ? { src, key } : { missing: key };
    }
    return p ? { src: p } : {};
  }

  /* ---------- 确定性随机 ---------- */
  // 字符串 -> 稳定小整数。同一个 id 永远拿到同一个 seed，所以笔迹不会因为重排而变
  function hash(s) {
    let h = 7;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 99991;
    return h;
  }

  // 集合 seed + 局部 key -> 元素 seed
  const seedOf = (base, key) => ((base | 0) * 131 + hash(key)) % 9973;

  // mulberry32：给 M4 排版引擎用，同 seed 同序列
  function rng(seed) {
    let a = (seed | 0) + 0x6d2b79f5;
    return function () {
      a |= 0; a = a + 0x6d2b79f5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------- 数值 ---------- */
  // 折算到基准币种。rates 是「1 单位外币 = 多少基准币」，存在数据里，不实时查
  function convert(amount, currency, rates, base) {
    if (!amount) return 0;
    if (!currency || currency === base) return amount;
    const r = rates && rates[currency];
    if (r == null) return NaN;          // 缺汇率就让它显式坏掉，不静默当 1:1
    return amount * r;
  }

  const round = (n, d) => {
    const p = Math.pow(10, d || 0);
    return Math.round(n * p) / p;
  };

  root.Kernel = {
    DAY, parseTime, midnight, spanDays, dayIndex, daysUntil,
    byType, allMedia, sumBy, distinct, groupBy, sorted,
    mediaRef,
    hash, seedOf, rng, convert, round
  };
})(typeof window !== 'undefined' ? window : globalThis);
