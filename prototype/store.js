/* 数据仓库：示例数据（data/bundle.js，构建产物）+ 本机改动（localStorage）。
   没有后端，所以「填进去的数字」存在这台机器上；导出 JSON 可以把改动带回仓库。

   坐标分两层（§3.2「查不到就提示用户手选，不静默猜」）：
     · data.places   —— 查表，来自 data/places.json，只读，改它要重新构建
     · data.myPlaces —— 用户自己补的，存在本机，查表里没有的码靠它救
   ctx().places 是两层合并后的结果，用户那层优先。查不到还是查不到，一律不猜。 */
(function (root) {
  'use strict';

  const KEY = 'travel-notebook/v1';
  const clone = o => JSON.parse(JSON.stringify(o));

  let base = null, data = null, seen = '';
  const listeners = [];

  /* ---------- 读写 ---------- */

  function load(seed) {
    base = clone(seed || { trips: [] });
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* 隐私模式下会抛 */ }
    data = clone(base);
    data.myPlaces = {};
    seen = base.stamp || '';
    if (saved) {
      const s = JSON.parse(saved);
      if (s.trips) data.trips = s.trips;
      if (s.rates) data.rates = s.rates;
      if (s.myPlaces) data.myPlaces = s.myPlaces;
      // 存过的那一份是照着哪版出厂数据存的。老版本没这一项，当成「不知道」——
      // 不知道就当过期，宁可多问一次，也别让人对着半年前的书架以为这就是全部
      seen = s.stamp || '';
    }
    return data;
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        stamp: seen, trips: data.trips, rates: data.rates, myPlaces: data.myPlaces
      }));
    } catch (e) { console.warn('存不下来（localStorage 不可用）：', e.message); }
  }

  /* 出厂数据换了版，而这台机器上存着旧的一份 —— 书架上说一句（§4.8）。
     为什么要说：load() 里存过的 trips 会盖掉出厂那份，所以来过一次的人
     以后再打开永远是老数据，新加的行程、换的图他一辈子看不到，而页面上
     不会有任何迹象。这不是 bug 是设计（本机改动优先），但得让人知道。
     不自动覆盖：那一份可能是人家自己记的东西。 */
  const stale = () => dirty() && !!base.stamp && seen !== base.stamp;
  // 「不用了」：记下现在这一版，下次不再问。数据一字不改，只是把话咽回去
  const keepMine = () => { seen = base.stamp || ''; save(); emit(); };

  const dirty = () => {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  };

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* 同上 */ }
    data = clone(base);
    data.myPlaces = {};
    seen = base.stamp || '';
    emit();
  }

  /* ---------- 示例数据 ---------- */

  /* 默认只装 2 趟已旅行 + 2 趟待出行（data/trips.json）。剩下几趟搁在 data/samples.json，
     跟着 bundle 一起发但不进仓库 —— 所以单文件离线也点得动，不用再发一次请求。
     「清空」和 reset() 是两件事：reset 是「把我的改动撤回到出厂那 4 趟」，
     clear 是「一趟都不要，从空本子开始记」。 */
  const samples = () => clone((base && base.samples) || []);
  const has = id => (data.trips || []).some(t => t.id === id);
  const pending = () => samples().filter(t => !has(t.id));

  const addSamples = () => change(() => {
    const add = pending();
    data.trips = (data.trips || []).concat(add);
    return add.length;
  });

  const clearTrips = () => change(() => { data.trips = []; });

  const on = fn => listeners.push(fn);
  const emit = () => listeners.slice().forEach(fn => fn(data));
  function change(fn) { const r = fn(data); save(); emit(); return r; }

  /* ---------- 查 ---------- */

  const trip = id => (data.trips || []).filter(t => t.id === id)[0] || null;
  // 排序要看算出来的状态（§3.2 状态机），所以 now 得跟 ctx() 用同一个
  const ordered = () => root.TripView.order(data.trips || [], ctx().now);
  const currencies = () => Object.keys(data.rates || { CNY: 1 });

  // 两层合并，用户补的那层压在查表上面
  const places = () => Object.assign({}, data.places || {}, data.myPlaces || {});
  const isMine = key => !!(data.myPlaces || {})[key];

  // ll = [经度, 纬度]。越界的值直接不收 —— 投影会把它算到画布外面去
  function setPlace(key, rec) {
    const k = String(key || '').trim();
    const ll = rec && rec.ll;
    if (!k || !ll || Math.abs(ll[0]) > 180 || Math.abs(ll[1]) > 90) return false;
    change(() => {
      data.myPlaces[k] = {
        name: rec.name || k, sub: rec.sub || '',
        ll: [Math.round(ll[0] * 100) / 100, Math.round(ll[1] * 100) / 100]
      };
    });
    return true;
  }
  const dropPlace = key => change(() => { delete data.myPlaces[key]; });

  const ctx = () => ({
    places: places(),
    rates: data.rates || { CNY: 1 },
    baseCurrency: data.baseCurrency || 'CNY',
    // 位图场景插画表（img:xxx -> data: URI），构建时内联进 bundle，只读
    images: data.images || {},
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

  // 导出成 data/trips.json 那个形状，可以直接覆盖回仓库。
  // 自己补的坐标单独一段：为空时不写，导出的形状就跟仓库里那份一致
  const exportJSON = () => {
    const out = {
      version: data.version || 1,
      baseCurrency: data.baseCurrency || 'CNY',
      rates: data.rates,
      trips: data.trips
    };
    if (Object.keys(data.myPlaces || {}).length) out.myPlaces = data.myPlaces;
    return JSON.stringify(out, null, 2);
  };

  root.Store = {
    load, save, reset, dirty, stale, keepMine, on, change, today, blank,
    get data() { return data; },
    trip, entry, view, ordered, ctx, currencies,
    places, isMine, setPlace, dropPlace,
    samples, pending, addSamples, clearTrips,
    newTrip, addEntry, patchEntry, patchTrip, removeEntry, removeTrip, exportJSON
  };
})(typeof window !== 'undefined' ? window : globalThis);
