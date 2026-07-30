/* 数据仓库：示例数据（data/bundle.js，构建产物）+ 本机改动（localStorage）。
   没有后端，所以「填进去的数字」存在这台机器上；导出 JSON 可以把改动带回仓库。

   规矩：places 不可编辑 —— 机场/城市坐标是查表，改要改 data/places.json 再重新构建，
   否则航线画不出来（§3.2「查不到就提示用户手选，不静默猜」）。 */
(function (root) {
  'use strict';

  const KEY = 'travel-notebook/v1';
  const clone = o => JSON.parse(JSON.stringify(o));

  let base = null, data = null;
  const listeners = [];

  /* ---------- 读写 ---------- */

  function load(seed) {
    base = clone(seed || { trips: [] });
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* 隐私模式下会抛 */ }
    data = clone(base);
    if (saved) {
      const s = JSON.parse(saved);
      if (s.trips) data.trips = s.trips;
      if (s.rates) data.rates = s.rates;
    }
    return data;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ trips: data.trips, rates: data.rates })); }
    catch (e) { console.warn('存不下来（localStorage 不可用）：', e.message); }
  }

  const dirty = () => {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  };

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* 同上 */ }
    data = clone(base);
    emit();
  }

  const on = fn => listeners.push(fn);
  const emit = () => listeners.slice().forEach(fn => fn(data));
  function change(fn) { const r = fn(data); save(); emit(); return r; }

  /* ---------- 查 ---------- */

  const trip = id => (data.trips || []).filter(t => t.id === id)[0] || null;
  // 排序要看算出来的状态（§3.2 状态机），所以 now 得跟 ctx() 用同一个
  const ordered = () => root.TripView.order(data.trips || [], ctx().now);
  const currencies = () => Object.keys(data.rates || { CNY: 1 });

  const ctx = () => ({
    places: data.places || {},
    rates: data.rates || { CNY: 1 },
    baseCurrency: data.baseCurrency || 'CNY',
    now: new Date()
  });

  const view = id => {
    const t = trip(id);
    return t ? root.TripView.derive(t, ctx()) : null;
  };

  /* ---------- 改 ---------- */

  let n = 0;
  const uid = p => p + '-' + Date.now().toString(36) + (n++).toString(36);

  function today(offset) {
    const d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    const p = x => (x < 10 ? '0' : '') + x;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // 每种 type 的默认值。
  // 规矩：需要用户自己写的文字一律留空（占位提示写在 app.js 的 placeholder 里），
  // 否则用户点开输入框第一件事是删掉「新的一笔」这种假文字。只有真正算得出来的
  // 默认值（航段的起降码、住宿的日期、示意插图）才填。
  function blank(type) {
    const cur = data.baseCurrency || 'CNY';
    return ({
      leg:   { title: '', data: { from: 'SHA', to: 'HND', mode: 'air', code: '', flown: false } },
      spend: { title: '', data: { amount: 0, currency: cur, category: '其他' } },
      place: { title: '', place: { name: '', city: '' }, data: {} },
      stay:  { title: '', data: { checkIn: today(), checkOut: today(1), booked: false } },
      note:  { title: '', body: '', data: {} },
      photo: { title: '', media: [{ id: 'm', path: 'art:fuji', kind: 'drawing', w: 150, h: 105 }], data: {} }
    })[type];
  }

  function addEntry(tripId, type, patch) {
    const t = trip(tripId);
    if (!t) return null;
    const e = Object.assign({
      id: uid(tripId + '-' + type), type, title: '', time: {}, tags: [],
      source: { provider: 'manual', confidence: 1 }, data: {}
    }, blank(type), patch || {});
    change(() => t.entries.push(e));
    return e;
  }

  const entry = (tripId, id) => (trip(tripId) || { entries: [] }).entries
    .filter(e => e.id === id)[0] || null;

  const patchEntry = (tripId, id, fn) => change(() => { const e = entry(tripId, id); if (e) fn(e); });
  const patchTrip = (tripId, fn) => change(() => { const t = trip(tripId); if (t) fn(t); });

  const removeEntry = (tripId, id) => change(() => {
    const t = trip(tripId);
    if (t) t.entries = t.entries.filter(e => e.id !== id);
  });

  const removeTrip = id => change(() => { data.trips = data.trips.filter(t => t.id !== id); });

  function newTrip() {
    const t = {
      id: uid('trip'), title: '', status: 'planned',   // 标题留空：占位提示在编辑器里，别让用户先删字
      seed: 100 + Math.floor(Math.random() * 800),   // 换 seed 就是换一次笔迹
      time: { start: today(30), end: today(34) },
      data: { no: '计划中', budget: 8000, currency: data.baseCurrency || 'CNY', cover: null },
      entries: []
    };
    change(() => data.trips.push(t));
    addEntry(t.id, 'leg', { data: { from: 'SHA', to: 'KIX', mode: 'air', code: '', flown: false } });
    return t.id;
  }

  // 导出成 data/trips.json 那个形状，可以直接覆盖回仓库
  const exportJSON = () => JSON.stringify({
    version: data.version || 1,
    baseCurrency: data.baseCurrency || 'CNY',
    rates: data.rates,
    trips: data.trips
  }, null, 2);

  root.Store = {
    load, save, reset, dirty, on, change, today, blank,
    get data() { return data; },
    trip, entry, view, ordered, ctx, currencies,
    newTrip, addEntry, patchEntry, patchTrip, removeEntry, removeTrip, exportJSON
  };
})(typeof window !== 'undefined' ? window : globalThis);
