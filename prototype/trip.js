/* 旅行皮肤层：认识 leg / place / spend / stay / note / photo 这几个 type，
   把 Entry[] 折算成卡片要显示的数字，再拼成 DOM。
   字段定义见 docs/需求文档.md §3.2，卡片内容见 §4.1 / §4.2。

   规矩：这里只负责「算什么、放哪个盒子」，手绘线一律交给 data-frame / data-art
   由渲染引擎接手 —— 所以换成小程序 canvas 后端时这个文件不用动（§6.1）。 */
(function (root) {
  'use strict';

  const K = root.Kernel;
  const MODE_ART = { air: 'plane' };
  const CAT_ORDER = ['交通', '住', '吃', '门票', '购物', '其他'];

  /* ================= 一、折算 ================= */

  const fmtMoney = n => Math.round(n).toLocaleString('en-US');
  const pad = n => (n < 10 ? '0' : '') + n;

  function fmtDate(s, withYear) {
    const d = K.parseTime(s);
    if (!d) return '';
    const md = pad(d.getMonth() + 1) + '.' + pad(d.getDate());
    return withYear === false ? md : d.getFullYear() + '.' + md;
  }

  // 城市名 -> 坐标。先按 key（IATA 或地名）查，再按 name 查；查不到返回 null，不猜
  function lookup(places, key) {
    if (!key || !places) return null;
    if (places[key]) return places[key];
    for (const k in places) if (places[k] && places[k].name === key) return places[k];
    return null;
  }

  // 大圆距离（km）
  function greatCircle(a, b) {
    if (!a || !b) return 0;
    const R = 6371, rad = Math.PI / 180;
    const p1 = a.ll[1] * rad, p2 = b.ll[1] * rad;
    const dp = p2 - p1, dl = (b.ll[0] - a.ll[0]) * rad;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* ---------- 状态机（§3.2）：planned → ongoing → done ----------
     数据里的 status 只是用户手写的那一笔，卡片用哪一套版式由日期算出来 ——
     否则去年出发的那趟今天还挂在「待出行」下面，得靠人一个个去改。
     两种情况不推进：
       · cancelled —— 行程取消了，停在原地（需求文档说的「手动锁定」）
       · data.lockStatus —— 用户明确说「就按我填的算」
     没填开始日期的按存的算：猜不出来就不猜。 */
  const STATUS_LABEL = { planned: '待出行', ongoing: '旅行中', done: '已旅行', cancelled: '已取消' };
  // 「待出行」那一栏收哪些：还没走的，和取消了的
  const isPlan = s => s === 'planned' || s === 'cancelled';

  function statusOf(trip, now) {
    const raw = STATUS_LABEL[trip.status] ? trip.status : 'planned';
    if (raw === 'cancelled' || (trip.data && trip.data.lockStatus)) return raw;
    const a = K.parseTime(trip.time && trip.time.start);
    if (!a) return raw;
    const b = K.parseTime(trip.time && trip.time.end) || a;
    const t = K.midnight(now || new Date());
    if (t < K.midnight(a)) return 'planned';
    return t <= K.midnight(b) ? 'ongoing' : 'done';
  }

  function derive(trip, ctx) {
    const es = K.sorted(trip.entries || []);
    const rates = ctx.rates, base = ctx.baseCurrency, places = ctx.places;
    const now = ctx.now || new Date();

    const legs = K.byType(es, 'leg').map(e => {
      const d = e.data || {};
      const from = lookup(places, d.from), to = lookup(places, d.to);
      return {
        entry: e, from: d.from, to: d.to, mode: d.mode, code: d.code, flown: !!d.flown,
        fromName: from ? from.name : d.from, toName: to ? to.name : d.to,
        fromSub: from && from.sub, toSub: to && to.sub,
        fromLL: from && from.ll, toLL: to && to.ll,       // 地图要的就是这两个坐标
        unknown: !from || !to,                       // 查不到坐标：提示用户手选
        km: d.mode === 'air' ? greatCircle(from, to) : 0,
        date: fmtDate(e.time && e.time.start)
      };
    });

    const spends = K.byType(es, 'spend').map(e => ({
      entry: e, title: e.title,
      amount: K.convert(e.data.amount, e.data.currency, rates, base),
      raw: e.data.amount, currency: e.data.currency,
      category: e.data.category || '其他'
    }));
    const spendTotal = K.sumBy(spends, s => s.amount);
    const byCat = CAT_ORDER
      .map(c => ({ category: c, amount: K.sumBy(spends.filter(s => s.category === c), s => s.amount) }))
      .filter(x => x.amount > 0);

    const placed = K.byType(es, 'place');
    const scheduled = placed.filter(e => e.data && e.data.day);
    const wishlist = placed.filter(e => !e.data || !e.data.day);
    const days = K.spanDays(trip.time);

    // 逐日行程：只列排了地点的那些天
    const itinerary = [...K.groupBy(scheduled, e => e.data.day)].sort((a, b) => a[0] - b[0])
      .map(([day, list]) => ({ day, names: list.map(e => e.place && e.place.name || e.title || '还没写') }));

    const stays = K.byType(es, 'stay').map(e => ({
      entry: e, title: e.title, booked: !!(e.data && e.data.booked),
      nights: Math.max(0, K.spanDays({ start: e.data.checkIn, end: e.data.checkOut }) - 1)
    }));
    const nightsTotal = Math.max(0, days - 1);
    const nightsBooked = K.sumBy(stays.filter(s => s.booked), s => s.nights);

    const media = K.allMedia(es);
    const budget = trip.data && trip.data.budget || 0;
    const status = statusOf(trip, now);
    const untilStart = K.daysUntil(trip.time && trip.time.start, now);

    return {
      trip, entries: es, legs, spends, spendTotal, byCat, itinerary, wishlist, stays,
      days, media, base,
      status, statusLabel: STATUS_LABEL[status],
      statusLocked: status === 'cancelled' || !!(trip.data && trip.data.lockStatus),
      // 旅行中的那趟：今天是第几天（卡片副标题用）
      dayNow: status === 'ongoing' && untilStart != null ? 1 - untilStart : null,
      photoEntries: K.byType(es, 'photo').filter(e => (e.media || []).length),
      notes: K.byType(es, 'note'),
      cities: K.distinct(es.map(e => e.place && e.place.city)),
      km: K.sumBy(legs, l => l.km),
      scheduledDays: K.distinct(scheduled.map(e => e.data.day)).length,
      located: wishlist.filter(e => e.place && e.place.lat != null).length,
      nightsTotal, nightsBooked,
      budget,
      paid: spendTotal,
      pct: budget ? Math.min(100, Math.round(spendTotal / budget * 100)) : 0,
      countdown: untilStart,
      dateLabel: fmtDate(trip.time.start) + ' – ' + fmtDate(trip.time.end, false),
      unknownPlaces: legs.filter(l => l.unknown).map(l => l.unknown && (l.from + '→' + l.to))
    };
  }

  /* ================= 二、DOM 小工具 ================= */

  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      if (attrs[k] == null) continue;
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'style') el.setAttribute('style', attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    for (const kid of kids || []) if (kid) el.appendChild(kid);
    return el;
  }

  // **强调** -> <em>，换行 -> <br>。不走 innerHTML，数据里的尖括号进不来
  function richText(el, src) {
    for (const [i, line] of String(src).split('\n').entries()) {
      if (i) el.appendChild(document.createElement('br'));
      for (const [j, part] of line.split('**').entries())
        el.appendChild(j % 2 ? h('em', { text: part }) : document.createTextNode(part));
    }
    return el;
  }

  const art = (name, cls) => h('div', { class: cls || 'art', 'data-art': name, 'aria-hidden': 'true' });
  const stat = (n, label) => h('div', null, [
    h('div', { class: 'stat-n', text: n }), h('div', { class: 'stat-l', text: label })
  ]);

  /* ================= 三、卡片 ================= */

  // 照片墙：2~5 张，超出的不上墙（媒体总数仍然进数字条）
  // data-ph = 在墙上的第几张。看大图那一页要用同一份名单同一个序号，
  // 所以名单只在 wallPhotos() 里算一次，app.js 也用它。
  const WALL = 5;
  const wallPhotos = v => v.photoEntries.slice(0, WALL);

  function photoWall(v, sd) {
    const list = wallPhotos(v);
    if (list.length < 1) return null;
    return h('div', { class: 'photos' }, list.map((e, i) => {
      const m = e.media[0], day = e.data && e.data.day;
      const inner = /^art:/.test(m.path)
        ? art(m.path.slice(4))
        : h('img', { class: 'art', src: m.path, alt: e.title || '' });
      const cap = [e.place && e.place.name || e.title, day ? 'D' + day : null]
        .filter(Boolean).join(' · ');
      return h('div', { class: 'ph', 'data-frame': 'rect', 'data-seed': sd('ph' + e.id),
        'data-ph': i }, [inner, h('div', { class: 'cap', text: cap })]);
    }));
  }

  // 逐日行程：超过 5 天折起来（§4.1）
  function dayList(v) {
    if (!v.itinerary.length) return null;
    const FOLD = 5, box = h('div', { class: 'days' });
    v.itinerary.forEach((d, i) => {
      box.appendChild(h('div', { class: 'day-row' + (i >= FOLD ? ' folded' : '') }, [
        h('span', { class: 'day-badge', text: 'D' + d.day }),
        h('span', { text: d.names.join(' · ') })
      ]));
    });
    if (v.itinerary.length > FOLD) {
      const more = v.itinerary.length - FOLD;
      const btn = h('span', { class: 'fold-toggle', role: 'button', tabindex: '0',
        text: '还有 ' + more + ' 天 ↓' });
      const toggle = () => {
        const open = box.classList.toggle('open');
        btn.textContent = open ? '收起 ↑' : '还有 ' + more + ' 天 ↓';
      };
      btn.addEventListener('click', toggle);
      btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggle(); });
      box.appendChild(btn);
    }
    return box;
  }

  // 航段条：SHA → HND + 日期 + 交通图标（§4.1）
  function legStrip(v, sd) {
    if (!v.legs.length) return null;
    return h('div', { class: 'legs' }, v.legs.map(l => h('div',
      { class: 'leg-row' + (l.flown ? '' : ' plan'), 'data-frame': 'hr-b', 'data-seed': sd('leg' + l.entry.id) }, [
      MODE_ART[l.mode] ? art(MODE_ART[l.mode], 'art leg-ico') : null,
      h('span', { class: 'leg-code', text: l.from + ' → ' + l.to }),
      h('span', { class: 'leg-city', text: l.fromName + ' – ' + l.toName + (l.code ? ' · ' + l.code : '') }),
      h('span', { class: 'leg-date', text: l.date })
    ])));
  }

  function head(v) {
    const t = v.trip, d = t.data || {}, plan = isPlan(v.status);
    const sub = [v.dateLabel, v.days + ' 天', d.companions].filter(Boolean).join(' · ');
    return [
      h('div', { class: 'eyebrow', text: [v.statusLabel, d.no].filter(Boolean).join(' · ') }),
      h('div', { class: 'title' + (plan ? ' plan' : ''), 'data-hand': '', text: t.title || '未命名' }),
      h('div', { class: 'subtitle',
        text: plan ? '预计 ' + fmtDate(t.time.start) + ' 出发 · ' + v.days + ' 天'
          : v.status === 'ongoing'
            ? '第 ' + v.dayNow + ' 天 / 共 ' + v.days + ' 天 · ' + v.dateLabel
            : sub })
    ];
  }

  function renderDone(v) {
    const t = v.trip, sd = key => K.seedOf(t.seed, key);
    const money = (t.data && t.data.currency) === 'CNY' ? '¥' : '';
    const chips = [
      v.legs.length ? v.legs[0].fromName + ' → ' + v.legs[0].toName : null,
      v.media.length + ' 张照片',
      v.cities.length + ' 个城市'
    ].filter(Boolean).map(txt => h('span',
      { class: 'chip', 'data-frame': 'rect', 'data-seed': sd('chip' + txt), text: txt }));
    chips.push(h('span', { class: 'chip', 'data-frame': 'rect', 'data-seed': sd('chipmoney'),
      'data-fill': '#f6dfa4', text: money + fmtMoney(v.spendTotal) }));

    const note = v.notes[0] && richText(
      h('div', { class: 'note', 'data-frame': 'rules', 'data-seed': sd('note') }),
      v.notes[0].body || '');

    return h('div', { class: 'card', 'data-frame': 'rect', 'data-seed': t.seed }, [
      h('div', { class: 'tape', style: 'top:-14px;left:28px;transform:rotate(-4deg)',
        'data-tape': '#a8c8b4', 'data-seed': sd('tape') }),
      ...head(v),
      h('div', { class: 'meta-row' }, chips),
      photoWall(v, sd),
      dayList(v),
      note,
      legStrip(v, sd),
      h('div', { class: 'stats', 'data-frame': 'hr', 'data-seed': sd('stats') }, [
        stat(v.days, '天数'),
        stat(v.media.length, '照片'),
        stat(fmtMoney(v.km), '飞行公里'),
        stat(fmtMoney(v.spendTotal), '花费 ' + v.base)
      ])
    ]);
  }

  // 大航段条：待出行卡片顶上那条 SHA ⌒ KIX
  function routeStrip(v) {
    const l = v.legs[0];
    if (!l) return null;
    const side = (code, name, sub, right) => h('div', { style: right ? 'text-align:right' : null }, [
      h('div', { class: 'route-code', text: code }),
      h('div', { class: 'route-city', text: [name, sub].filter(Boolean).join(' · ') })
    ]);
    return h('div', { class: 'route' }, [
      side(l.from, l.fromName, l.fromSub, false),
      h('div', { class: 'route-arc' }, [art('arc')]),
      side(l.to, l.toName, l.toSub, true)
    ]);
  }

  function renderPlan(v) {
    const t = v.trip, sd = key => K.seedOf(t.seed, key);
    const left = v.nightsTotal - v.nightsBooked;
    const rows = [
      ['ico-hotel', v.stays.length
        ? (v.stays[0].title || '住的地方') + ' · 已订 ' + v.nightsBooked + ' 晚'
          + (left > 0 ? '，剩 ' + left + ' 晚待定' : '，住宿已齐')
        : '还没订住的地方'],
      ['ico-cal', '日程 ' + v.scheduledDays + ' / ' + v.days + ' 天已排'
        + (v.itinerary.length ? ' · ' + v.itinerary.flatMap(d => d.names).join('、') : '')],
      ['ico-pin', '想去清单 ' + v.wishlist.length + ' 个 · 已定位 ' + v.located + ' 个']
    ].map(([ico, txt], i) => h('div',
      { class: 'plan-item', 'data-frame': 'hr-b', 'data-seed': sd('row' + i) },
      [art(ico, 'ico'), h('div', { text: txt })]));

    const cd = v.status === 'cancelled' ? null : v.countdown;   // 取消了就不倒计时了
    return h('div', { class: 'card', 'data-frame': 'rect', 'data-seed': t.seed }, [
      ...head(v),
      cd != null && cd > 0
        ? h('div', { class: 'countdown', 'data-frame': 'rect', 'data-seed': sd('cd'),
            text: '距出发还有 ' + cd + ' 天' })
        : null,
      routeStrip(v),
      ...rows,
      h('div', { class: 'plan-item' }, [
        art('ico-wallet', 'ico'),
        h('div', { style: 'flex:1' }, [
          h('div', { style: 'display:flex;justify-content:space-between;font-size:14px' }, [
            h('span', { text: '预算 ¥' + fmtMoney(v.budget) }),
            h('span', { style: 'color:var(--ink2)', text: '已支出 ¥' + fmtMoney(v.paid) })
          ]),
          h('div', { class: 'bar', 'data-frame': 'bar', 'data-pct': v.pct, 'data-seed': sd('bar') })
        ])
      ]),
      h('div', { class: 'btn', 'data-frame': 'rect', 'data-seed': sd('btn'),
        'data-fill': '#a8c8b4',
        text: v.status === 'cancelled' ? '这趟取消了 · 想去了再改回来' : '继续完善计划 →' })
    ]);
  }

  /* ================= 四、挂载 ================= */

  const RENDER = { done: renderDone, ongoing: renderDone,
    planned: renderPlan, cancelled: renderPlan };

  // 已旅行（含旅行中）按开始时间倒序，待出行按出发时间正序（快的排前面）。
  // 分栏看的是算出来的状态，不是存的那一笔 —— 日期一过就自己挪到上面去
  function order(trips, now) {
    const key = t => +(K.parseTime(t.time && t.time.start) || 0);
    const done = [], plan = [];
    for (const t of trips) (isPlan(statusOf(t, now)) ? plan : done).push(t);
    return done.sort((a, b) => key(b) - key(a)).concat(plan.sort((a, b) => key(a) - key(b)));
  }

  /* ================= 三点五、跨行程的汇总 =================
     地图和足迹总览都只吃这两个函数，页面上不许再自己算一遍 —— 数字对不上就是这么来的。 */

  /* 所有航段摊成一张图：只认 leg 里填的码，坐标查 places，查不到进 unknown 让页面标出来。
     城市按名字去重（SHA / PVG 都是上海，算一座），代号取第一次出现的那个。 */
  function atlas(trips, ctx) {
    const routes = [], cities = new Map(), unknown = [];
    for (const t of order(trips || [], ctx.now)) {
      for (const l of derive(t, ctx).legs) {
        if (l.unknown) {
          for (const code of [l.from, l.to])
            if (code && !lookup(ctx.places, code) && unknown.indexOf(code) < 0) unknown.push(code);
          continue;
        }
        routes.push({
          from: l.from, to: l.to, fromLL: l.fromLL, toLL: l.toLL,
          fromName: l.fromName, toName: l.toName, flown: l.flown, mode: l.mode,
          km: l.km, date: l.date, tripId: t.id, tripTitle: t.title || '未命名'
        });
        for (const end of [[l.from, l.fromName, l.fromLL], [l.to, l.toName, l.toLL]]) {
          const c = cities.get(end[1])
            || { code: end[0], name: end[1], ll: end[2], flown: false, trips: [] };
          if (l.flown) c.flown = true;
          if (c.trips.indexOf(t.id) < 0) c.trips.push(t.id);
          cities.set(end[1], c);
        }
      }
    }
    const flown = routes.filter(r => r.flown);
    return {
      routes, unknown, cities: [...cities.values()],
      flownCount: flown.length, planCount: routes.length - flown.length,
      km: K.sumBy(routes, r => r.km), kmFlown: K.sumBy(flown, r => r.km)
    };
  }

  /* 足迹总览页要的数字，一样是现算：改一笔花销，这里立刻跟着变 */
  function summary(trips, ctx) {
    const list = order(trips || [], ctx.now);
    const views = list.map(t => derive(t, ctx));
    const done = views.filter(v => !isPlan(v.status));      // 旅行中的也算在「走过」里
    const plan = views.filter(v => isPlan(v.status));
    const years = new Map();
    for (const v of done) {
      const d = K.parseTime(v.trip.time && v.trip.time.start);
      const y = d ? d.getFullYear() : '未知';
      const row = years.get(y) || { year: y, trips: 0, days: 0, km: 0, spend: 0 };
      row.trips++; row.days += v.days; row.km += v.km; row.spend += v.spendTotal;
      years.set(y, row);
    }
    const byCat = CAT_ORDER.map(c => ({
      category: c,
      amount: K.sumBy(done, v => K.sumBy(v.spends.filter(s => s.category === c), s => s.amount))
    })).filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
    // 「下一趟」只看还没走的，取消了的不算
    const waiting = plan.filter(v => v.status === 'planned');
    const next = waiting.filter(v => v.countdown != null && v.countdown >= 0)[0] || waiting[0] || null;
    return {
      views, done, plan,
      ongoing: views.filter(v => v.status === 'ongoing'),
      atlas: atlas(trips, ctx),
      days: K.sumBy(done, v => v.days),
      photos: K.sumBy(done, v => v.media.length),
      spend: K.sumBy(done, v => v.spendTotal),
      budgetPlanned: K.sumBy(plan, v => v.budget),
      byCat, byYear: [...years.values()].sort((a, b) => a.year - b.year),
      next: next && { trip: next.trip, countdown: next.countdown, view: next },
      base: ctx.baseCurrency || 'CNY'
    };
  }

  function mount(host, data, opts) {
    if (!host) throw new Error('挂载点不存在');
    const ctx = {
      places: (data.places || {}), rates: data.rates || { CNY: 1 },
      baseCurrency: data.baseCurrency || 'CNY', now: (opts && opts.now) || new Date()
    };
    host.textContent = '';
    const views = [];
    for (const t of order(data.trips || [], ctx.now)) {
      const v = derive(t, ctx);
      const render = RENDER[v.status] || renderDone;
      host.appendChild(render(v));
      views.push(v);
    }
    return views;
  }

  root.TripView = { derive, atlas, summary, mount, order, greatCircle, lookup,
    fmtDate, fmtMoney, wallPhotos, statusOf, isPlan, STATUS_LABEL, CAT_ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
