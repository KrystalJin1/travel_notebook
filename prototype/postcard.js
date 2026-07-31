/* 明信片：把一趟旅行拼成一张固定尺寸的纸 —— docs/需求文档.md §4.4 / §4.7。

   为什么不直接导出详情页：详情页按 app 做，内容多长就多长、竖着滚（§4.8 反 PPT 第一条），
   没有「一页」可言，也就没法算留白率、没法当明信片发出去。所以明信片是另一层：
   900×1200 的固定画布，版面全权交给 layout.js 算，这里只负责
     1. 把 derive() 的数字拆成「贴片」（每片声明占几列、天生多高）
     2. 拿到坐标后用 draw 后端画出来
   这两步之间没有反向依赖：排版引擎不知道自己排的是旅行，画笔不知道自己在排版。 */
(function (root) {
  'use strict';
  const K = root.Kernel, TV = root.TripView, D = root.Draw, L = root.Layout;
  const C = D.C, fx = D.fx;

  const SIZE = { w: 900, h: 1200, pad: 46, gap: 22, cols: 6 };
  /* 照片按张数分列，保证每行刚好填满 —— 不填满就得靠拉伸去救，那样比例会歪 */
  const PLAN = { 1: [6], 2: [3, 3], 3: [2, 2, 2], 4: [3, 3, 3, 3], 5: [3, 3, 2, 2, 2] };

  /* ---------- 一、贴片清单（纯数据，测试直接吃这个） ---------- */
  function tiles(v) {
    const out = [];
    const plan = TV.isPlan(v.status);
    const add = (id, kind, cols, ratio, data) => out.push({ id, kind, cols, ratio, data });

    add('title', 'text', 6, .17, { kind: 'title' });

    const wall = TV.wallPhotos(v);
    const cols = PLAN[Math.min(5, wall.length)] || [];
    wall.slice(0, 5).forEach((e, i) => add('photo/' + e.id, 'photo', cols[i], .74, { kind: 'photo', entry: e }));

    if (v.legs.length) add('route', 'text', 6, .15, { kind: 'route' });

    // 左右两栏：走过的看行程 + 花销，没走的看清单 + 预算。两片各 3 列，正好填满一行
    add('left', 'text', 3, .52, { kind: plan ? 'todo' : 'days' });
    add('right', 'text', 3, .52, { kind: plan ? 'budget' : 'money' });

    if (v.notes[0] && v.notes[0].body) add('note', 'text', 6, .17, { kind: 'note' });
    add('stats', 'text', 6, .12, { kind: 'stats' });

    // 手动覆写过的片子引擎不动（§4.4 规则 5）：数据里写了 layout.pin 就照它摆
    (v.entries || []).forEach(e => {
      if (e.layout && e.layout.pin) {
        const t = out.filter(x => x.data.entry === e)[0];
        if (t) { t.pin = true; t.layout = e.layout; }
      }
    });
    return out;
  }

  /* ---------- 二、画 ---------- */
  const tf = t => `translate(${fx(t.x)} ${fx(t.y)}) rotate(${fx(t.rot)} ${fx(t.w / 2)} ${fx(t.h / 2)})`;

  function build(v, opt) {
    const o = Object.assign({}, SIZE, opt || {});
    const seed = (v.trip && v.trip.seed) || 1;
    const list = tiles(v);
    const res = L.run(list, { w: o.w, h: o.h, pad: o.pad, gap: o.gap, cols: o.cols, seed });
    const d = D.svg({ w: o.w, h: o.h, px: true, ns: true, cls: 'postcard', id: 'pc' + seed });
    const sd = key => K.seedOf(seed, key);

    // 纸：底色 + 一圈毛边框。画在最底下，所有贴片都压在它上面
    d.rect(0, 0, o.w, o.h, { fill: C.paper, keep: true, stroke: 'none', seed: sd('paper') });
    d.rect(9, 9, o.w - 18, o.h - 18, { stroke: C.ink3, w: .9, seed: sd('edge') });

    res.items.forEach(t => {
      const fn = PAINT[t.data && t.data.kind];
      if (!fn) return;
      d.group(tf(t), g => fn(g, t, v, sd));
    });
    res.deco.forEach(t => d.group(tf(t), g => (t.kind === 'tape' ? tape : clip)(g, t, sd)));

    return { node: d.node, layout: res, audit: L.audit(res), canvas: { w: o.w, h: o.h } };
  }

  /* ---------- 三、每种贴片怎么画 ---------- */
  const txt = (g, s, x, y, size, color, anchor) =>
    g.text(s, { x, y, size, color: color || C.ink, anchor: anchor || 'start' });

  /* 贴片的纸：色块 + 描边。文字块用淡框，照片用实框 + 白边 */
  function sheet(g, t, sd, fill, w) {
    g.rect(0, 0, t.w, t.h, { fill, stroke: C.ink, w: w || .95, seed: sd('sheet/' + t.id) });
  }

  const PAINT = {
    title(g, t, v, sd) {
      const eb = [v.statusLabel, v.trip.data && v.trip.data.no].filter(Boolean).join(' · ');
      txt(g, eb, 2, 16, 14, C.ink3);
      // 标题走字形轮廓：笔画本身在抖，不是把字当一块砖（§4.5）
      const size = Math.min(58, Math.max(30, t.w / Math.max(4, (v.trip.title || '').length) * 1.05));
      g.hand(v.trip.title || '未命名', { x: 0, y: 24, size, color: TV.isPlan(v.status) ? C.ink2 : C.ink });
      const sub = v.status === 'ongoing'
        ? '第 ' + v.dayNow + ' 天 / 共 ' + v.days + ' 天 · ' + v.dateLabel
        : v.dateLabel + ' · ' + v.days + ' 天'
          + (v.cities.length ? ' · ' + v.cities.slice(0, 3).join(' / ') : '');
      txt(g, sub, 2, 32 + size * 1.12, 15, C.ink2);
      g.line(0, t.h - 4, t.w, t.h - 4, { stroke: C.ink3, w: .8, seed: sd('title/hr') });
    },

    photo(g, t, v, sd) {
      const e = t.data.entry, m = (e.media || [])[0] || {};
      const cap = [e.place && e.place.name || e.title, e.data && e.data.day ? 'D' + e.data.day : null]
        .filter(Boolean).join(' · ');
      sheet(g, t, sd, C.snow);
      const box = { x: 8, y: 8, w: t.w - 16, h: t.h - 34 };
      const ref = K.mediaRef(m.path, v.images);
      if (ref.art) {
        const spec = root.Sketch.ART[ref.art];
        if (spec) {
          // 等比放进框里（contain，不裁），scale 会把笔粗一起放大，所以 k 要除回去
          const s = Math.min(box.w / spec.w, box.h / spec.h);
          const x = box.x + (box.w - spec.w * s) / 2, y = box.y + (box.h - spec.h * s) / 2;
          g.group(`translate(${fx(x)} ${fx(y)}) scale(${fx(s)})`,
            gg => root.Sketch.artInto(gg, ref.art, root.Sketch.hash(ref.art), (spec.k || 1) / s));
        }
      } else if (ref.src) {
        // 位图一定是 data: URI（build-data.py 内联过），所以存 PNG/PDF 时读得到
        g.image(ref.src, box.x, box.y, box.w, box.h);
      } else if (ref.missing) {
        txt(g, '缺图 ' + ref.missing, box.x + 4, box.y + 18, 13, C.ink3);
      }
      g.line(box.x, box.y + box.h + 6, box.x + box.w, box.y + box.h + 6,
        { stroke: C.ink3, w: .7, seed: sd('cap/' + t.id) });
      txt(g, cap, box.x, t.h - 10, 13, C.ink2);
      g.title(cap);
    },

    route(g, t, v, sd) {
      const l = v.legs[0];
      txt(g, '航线', 2, 14, 13, C.ink3);
      txt(g, l.from + ' → ' + l.to, 2, t.h - 14, 30, C.ink);
      txt(g, l.fromName + ' – ' + l.toName + (l.code ? ' · ' + l.code : ''),
        t.w * .42, t.h - 16, 15, C.ink2);
      txt(g, v.legs.length + ' 段 · ' + TV.fmtMoney(v.km) + ' km',
        t.w, t.h - 16, 15, C.ink2, 'end');
      // 已飞实线、计划虚线（§3.2）
      g.path(`M${fx(t.w * .30)} ${fx(t.h - 32)} Q${fx(t.w * .5)} 2 ${fx(t.w * .70)} ${fx(t.h - 32)}`,
        { stroke: C.ink2, w: 1, dash: l.flown ? null : [5, 5], seed: sd('arc') });
      g.circle(t.w * .30, t.h - 32, 4, l.flown ? { fill: C.red, seed: sd('a1') } : { stroke: C.ink2, seed: sd('a1') });
      g.circle(t.w * .70, t.h - 32, 4, { stroke: C.ink2, seed: sd('a2') });
    },

    days(g, t, v, sd) {
      sheet(g, t, sd, C.paper, .85);
      txt(g, '逐日行程', 12, 22, 14, C.ink3);
      rows(g, t, v.itinerary.map(x => ['D' + x.day, x.names.join(' · ')]), sd, '还没排日程');
    },

    todo(g, t, v, sd) {
      sheet(g, t, sd, C.paper, .85);
      txt(g, '待办', 12, 22, 14, C.ink3);
      const left = v.nightsTotal - v.nightsBooked;
      rows(g, t, [
        ['住', '已订 ' + v.nightsBooked + ' 晚' + (left > 0 ? '，剩 ' + left + ' 晚' : '，已齐')],
        ['排', v.scheduledDays + ' / ' + v.days + ' 天已排'],
        ['想', '想去 ' + v.wishlist.length + ' 个 · 已定位 ' + v.located + ' 个']
      ].concat(v.wishlist.slice(0, 4).map(e => ['·', e.place && e.place.name || e.title || ''])), sd);
    },

    money(g, t, v, sd) {
      sheet(g, t, sd, C.paper, .85);
      txt(g, '花销 ' + v.base, 12, 22, 14, C.ink3);
      rows(g, t, v.byCat.map(c => [c.category, '¥' + TV.fmtMoney(c.amount)]), sd, '没记花销', true);
    },

    budget(g, t, v, sd) {
      sheet(g, t, sd, C.paper, .85);
      txt(g, '预算', 12, 22, 14, C.ink3);
      txt(g, '¥' + TV.fmtMoney(v.budget), 12, 56, 26, C.ink);
      txt(g, '已支出 ¥' + TV.fmtMoney(v.paid), t.w - 12, 56, 14, C.ink2, 'end');
      g.rect(12, 68, t.w - 24, 16, { stroke: C.ink3, w: .8, seed: sd('bud/box') });
      if (v.pct) g.rect(12, 68, (t.w - 24) * v.pct / 100, 16,
        { fill: C.green, stroke: 'none', seed: sd('bud/fill') });
      const cd = v.status === 'cancelled' ? null : v.countdown;
      txt(g, cd != null && cd > 0 ? '距出发还有 ' + cd + ' 天'
        : v.status === 'cancelled' ? '这趟取消了' : '出发在即', 12, 108, 16, C.ink2);
      rows2(g, t, v.stays.map(s => [s.booked ? '已订' : '待订', s.title || '住的地方']), sd, 124);
    },

    note(g, t, v, sd) {
      // 横格纸 + 手写体。**强调** 这类标记留给页面，明信片上不解释
      for (let y = 26; y < t.h - 6; y += 26)
        g.line(10, y, t.w - 10, y, { stroke: '#d9cdb4', w: .8, seed: sd('note/' + y) });
      const body = String(v.notes[0].body || '').replace(/\*\*/g, '').split('\n');
      body.slice(0, Math.floor((t.h - 10) / 26)).forEach((s, i) =>
        txt(g, s, 14, 20 + i * 26, 17, C.ink));
    },

    stats(g, t, v, sd) {
      g.line(0, 1, t.w, 1, { stroke: C.ink3, w: .9, seed: sd('stats/hr') });
      const cells = TV.isPlan(v.status)
        ? [[v.days, '天数'], [v.wishlist.length, '想去'], [TV.fmtMoney(v.km), '公里'],
           ['¥' + TV.fmtMoney(v.budget), '预算']]
        : [[v.days, '天数'], [v.media.length, '照片'], [TV.fmtMoney(v.km), '飞行公里'],
           ['¥' + TV.fmtMoney(v.spendTotal), '花费 ' + v.base]];
      cells.forEach(([n, lab], i) => {
        const x = t.w * (i + .5) / cells.length;
        txt(g, String(n), x, t.h - 22, 28, C.ink, 'middle');
        txt(g, lab, x, t.h - 5, 13, C.ink3, 'middle');
      });
    }
  };

  /* 列表行：左边一个小标签，右边一串字。放不下的截掉，不挤成两行（明信片是固定高的） */
  function rows(g, t, list, sd, empty, right) {
    if (!list.length) { txt(g, empty || '', 12, 48, 15, C.ink3); return; }
    rows2(g, t, list, sd, 44, right);
  }
  function rows2(g, t, list, sd, y0, right) {
    const step = 26, max = Math.floor((t.h - y0) / step);
    list.slice(0, max).forEach(([tag, s], i) => {
      const y = y0 + i * step;
      txt(g, tag, 12, y, 13, C.ink3);
      if (right) txt(g, s, t.w - 12, y, 15, C.ink, 'end');
      else txt(g, cut(s, t.w - 52), 40, y, 15, C.ink);
      g.line(12, y + 7, t.w - 12, y + 7, { stroke: '#e2d8c2', w: .6, seed: sd('r/' + t.id + i) });
    });
    if (list.length > max) txt(g, '还有 ' + (list.length - max) + ' 条', 12, y0 + max * step, 13, C.ink3);
  }
  // 15px 的字大约 15px 宽一个汉字、8px 一个西文字符，够用来决定截在哪
  function cut(s, w) {
    let acc = 0, out = '';
    for (const ch of String(s)) {
      acc += ch.charCodeAt(0) > 0x2e80 ? 15 : 8;
      if (acc > w) return out + '…';
      out += ch;
    }
    return out;
  }

  function tape(g, t, sd) {
    g.path(`M2 2 L${fx(t.w - 3)} 5 L${fx(t.w - 1)} ${fx(t.h - 4)} L4 ${fx(t.h - 2)} Z`,
      { fill: '#a8c8b4', stroke: 'none', seed: sd('t/' + t.id) });
    for (let x = 12; x < t.w - 10; x += 14)
      g.line(x, 4, x - 4, t.h - 3, { stroke: 'rgba(255,255,255,.4)', w: .6, seed: sd('t/' + t.id + x) });
  }
  function clip(g, t, sd) {
    g.path(`M4 ${fx(t.h - 6)} V8 q0-6 ${fx(t.w / 2)} 0 q${fx(t.w / 2)} 6 0 ${fx(t.h * .55)}`,
      { stroke: C.ink2, w: 1.1, seed: sd('c/' + t.id) });
  }

  root.Postcard = { tiles, build, SIZE, PLAN };
})(typeof window !== 'undefined' ? window : globalThis);
