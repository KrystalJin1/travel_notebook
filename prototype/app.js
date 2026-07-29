/* 手帐本外壳：路由 + 封面 / 书架 / 详情 / 编辑（§4.8）。

   分工：卡片长什么样归 trip.js，手绘线归 sketch.js，数据归 store.js。
   这里只做三件事 —— 把 hash 解析成一页、把那一页塞进 #main、把表单里填的数字写回仓库。

   导航是栈不是幻灯片：后退键 / Esc / 右滑都走 history.back()，回到来处。 */
(function (root) {
  'use strict';

  const K = root.Kernel, T = root.TripView, ST = root.Store, SK = root.Sketch;
  const $ = id => document.getElementById(id);
  const wide = () => !!(root.matchMedia && matchMedia('(min-width:900px)').matches);

  /* ================= 一、DOM 小工具 ================= */

  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'on') for (const ev in attrs[k]) el.addEventListener(ev, attrs[k][ev]);
      else el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    for (const kid of kids || []) if (kid) el.appendChild(kid);
    return el;
  }

  const money = n => '¥' + T.fmtMoney(n);

  // 点了就走，键盘也能走 —— 时间轴上的每一趟都是一个按钮
  function tappable(el, fn) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.addEventListener('click', fn);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
    return el;
  }

  /* ================= 二、路由 ================= */

  function parse() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const p = raw.split('/').filter(Boolean);
    if (p[0] === 'debug') { document.body.classList.add('debug'); return { name: 'shelf' }; }
    if (p[0] === 'shelf') return { name: 'shelf' };
    if (p[0] === 'map') return { name: 'map' };
    if (p[0] === 'about') return { name: 'about' };
    if (p[0] === 'trip' && p[1]) return { name: 'trip', id: p[1], edit: p[2] === 'edit' };
    return { name: 'cover' };
  }

  const go = hash => { location.hash = hash; };
  const back = () => { if (history.length > 1) history.back(); else go('#/shelf'); };

  /* ================= 三、封面 ================= */

  function coverView() {
    const trips = ST.data.trips || [];
    const sum = trips.reduce((a, t) => {
      const v = T.derive(t, ST.ctx());
      return { d: a.d + v.days, km: a.km + v.km };
    }, { d: 0, km: 0 });

    const open = tappable(h('div', { class: 'btn open', 'data-frame': 'rect',
      'data-seed': 11, 'data-fill': '#a8c8b4', text: '翻开 →' }), () => go('#/shelf'));

    return h('div', { class: 'view cover' }, [
      h('div', { class: 'book', 'data-frame': 'rect', 'data-seed': 7 }, [
        h('div', { class: 'stamp', 'data-art': 'stamp', 'aria-hidden': 'true' }),
        h('h1', { 'data-hand': true, text: '旅行手帐' }),
        h('div', { class: 'by', text: 'TRAVEL NOTEBOOK · 手绘' }),
        open,
        h('div', { class: 'hint', text: trips.length + ' 趟 · ' + sum.d + ' 天 · '
          + T.fmtMoney(sum.km) + ' 公里' })
      ])
    ]);
  }

  /* ================= 四、书架：竖向时间轴 ================= */

  /* 书架上一行 = 一趟。这里故意不给每个数字套手绘框：一屏十几个抖动的小方框
     会把版面搅花，手绘留给外框那一个，数字排成一行小字（§4.8 规整优先）。 */
  function strip(t) {
    const v = T.derive(t, ST.ctx()), plan = t.status === 'planned';
    const facts = plan
      ? [v.countdown > 0 ? '距出发 ' + v.countdown + ' 天' : '就要走了',
         '预算 ' + money(v.budget), '想去 ' + v.wishlist.length + ' 个']
      : [v.days + ' 天', v.cities.length + ' 城市',
         v.media.length + ' 照片', money(v.spendTotal)];

    const item = h('div', { class: 'tl-item' + (plan ? ' plan' : '') }, [
      h('div', { class: 'strip', 'data-frame': 'rect', 'data-seed': t.seed }, [
        h('div', { class: 'when', text: v.dateLabel }),
        h('div', { class: 'name' + (plan ? ' plan' : ''), 'data-hand': true, text: t.title }),
        h('div', { class: 'facts', text: facts.join('　·　') }),
        h('span', { class: 'go', text: '→' })
      ])
    ]);
    return tappable(item, () => go('#/trip/' + t.id));
  }

  function shelfView() {
    const trips = ST.ordered();
    const done = trips.filter(t => t.status !== 'planned');
    const plan = trips.filter(t => t.status === 'planned');
    const group = (label, list, empty) => [
      h('div', { class: 'sec-label', text: label }),
      list.length ? h('div', { class: 'tl' }, list.map(strip))
                  : h('div', { class: 'empty', text: empty })
    ];

    const add = tappable(h('div', { class: 'add', 'data-frame': 'rect', 'data-seed': 44,
      text: '＋ 记一趟新的' }), () => {
      const id = ST.newTrip();
      go('#/trip/' + id + '/edit');    // 新建完直接进编辑，不用再找入口
    });

    return h('div', { class: 'view shelf' }, [
      ...group('已旅行 · PAST', done, '还没有记完的旅行。'),
      ...group('待出行 · PLANNED', plan, '还没有计划。点下面新建一趟。'),
      add
    ]);
  }

  /* ================= 五、详情 ================= */

  function topbar(title, actLabel, onAct) {
    const h2 = h('h2', { text: title });
    const bar = h('div', { class: 'topbar' }, [
      tappable(h('span', { class: 'back', text: '← 书架' }), back),
      h2,
      onAct ? tappable(h('span', { class: 'act', text: actLabel }), onAct) : null
    ]);
    bar.titleNode = h2;            // 改标题时就地更新，不必重画整页
    return bar;
  }

  // 花费明细按类目（§4.1 的数字条给总额，这里给构成）
  // 列表行用普通细线，不用手绘线：连着十几行抖动的横线只会显得花
  function moneyBlock(v) {
    if (!v.byCat.length) return null;
    return h('div', { class: 'editor' }, [
      h('h3', { text: '钱花在哪儿了' }),
      ...v.byCat.map(c => h('div', { class: 'money-cat' }, [
        h('span', { text: c.category }),
        h('b', { text: money(c.amount) + ' · ' + Math.round(c.amount / v.spendTotal * 100) + '%' })
      ])),
      h('div', { class: 'echo', text: '合计 ' + money(v.spendTotal) + ' ／ 预算 '
        + money(v.budget) + '（' + v.pct + '%）' })
    ]);
  }

  function tripView(r) {
    const t = ST.trip(r.id);
    if (!t) return h('div', { class: 'view detail' }, [
      topbar('找不到这一趟'),
      h('div', { class: 'empty', text: '这趟旅行不在本机数据里。可能是清过缓存。' })
    ]);

    const cardHost = h('div'), moneyHost = h('div'), editHost = h('div');
    const paint = () => { SK.repaint(); if (root.handtype) root.handtype(); };
    const bar = topbar(t.title, r.edit ? '完成 ✓' : '编辑 ✎',
      () => go('#/trip/' + t.id + (r.edit ? '' : '/edit')));

    // 卡片和编辑器是两个独立容器：填一个数字只重画卡片，输入框不会失焦（§4.8）
    function drawCard() {
      T.mount(cardHost, Object.assign({}, ST.data, { trips: [t] }));
      moneyHost.textContent = '';
      const mb = r.edit ? null : moneyBlock(T.derive(t, ST.ctx()));
      if (mb) moneyHost.appendChild(mb);
    }
    function drawEditor() {
      editHost.textContent = '';
      if (r.edit) editHost.appendChild(editor(t, {
        card: () => { drawCard(); paint(); },
        all: () => { drawCard(); drawEditor(); paint(); },
        title: s => { bar.titleNode.textContent = s; }
      }));
    }
    drawCard();
    drawEditor();

    return h('div', { class: 'view detail' }, [bar, cardHost, moneyHost, editHost]);
  }

  /* ================= 六、表单控件 ================= */

  /* 一律 change 时才写回，不用 input —— 边打字边重渲染会让光标乱跳。 */

  const field = (label, el, cls) =>
    h('label', { class: cls || null }, [document.createTextNode(label), el]);

  function commit(el, fn) { el.addEventListener('change', fn); return el; }

  function txt(label, val, fn, cls) {
    const el = h('input', { type: 'text', value: val == null ? '' : val });
    commit(el, () => fn(el.value));
    return field(label, el, cls);
  }

  function num(label, val, fn) {
    const el = h('input', { type: 'number', class: 'num', inputmode: 'decimal',
      value: val == null ? '' : val });
    commit(el, () => fn(Number(el.value) || 0));
    return field(label, el, 'n');
  }

  function dateIn(label, val, fn) {
    const el = h('input', { type: 'date', value: val || '' });
    commit(el, () => fn(el.value));
    return field(label, el);
  }

  function sel(label, val, list, fn, cls) {
    const el = h('select', null, list.map(o => {
      const pair = Array.isArray(o) ? o : [o, o];
      return h('option', { value: pair[0], text: pair[1],
        selected: pair[0] === val ? true : null });
    }));
    el.value = val;
    commit(el, () => fn(el.value));
    return field(label, el, cls);
  }

  function chk(label, val, fn) {
    const el = h('input', { type: 'checkbox', checked: val ? true : null });
    commit(el, () => fn(el.checked));
    return h('label', { class: 'n' }, [el, document.createTextNode(label)]);
  }

  const row = kids => h('div', { class: 'f' }, kids);

  /* ================= 七、编辑：填数字的地方 ================= */

  function editor(t, redraw) {
    const v = T.derive(t, ST.ctx());
    const ofType = ty => (t.entries || []).filter(e => e.type === ty);
    const pt = fn => { ST.patchTrip(t.id, fn); redraw.card(); };
    const pe = (e, fn) => { ST.patchEntry(t.id, e.id, fn); redraw.card(); };
    const grow = (type, patch) => { ST.addEntry(t.id, type, patch); redraw.all(); };
    const cut = e => { ST.removeEntry(t.id, e.id); redraw.all(); };
    const mini = (label, fn) => tappable(h('div', { class: 'mini', 'data-frame': 'rect',
      'data-seed': K.seedOf(t.seed, label), text: label }), fn);
    const del = fn => tappable(h('span', { class: 'del', text: '删除' }), fn);

    /* --- 这一趟 --- */
    const basic = [
      h('h3', { text: '这一趟' }),
      row([
        txt('标题', t.title, x => { pt(tr => { tr.title = x || '未命名'; }); redraw.title(t.title); }, 'wide'),
        sel('状态', t.status === 'planned' ? 'planned' : 'done',
          [['done', '已旅行'], ['planned', '待出行']], x => pt(tr => { tr.status = x; })),
        txt('编号', (t.data || {}).no, x => pt(tr => { tr.data.no = x; })),
        dateIn('开始', t.time.start, x => pt(tr => { tr.time.start = x; })),
        dateIn('结束', t.time.end, x => pt(tr => { tr.time.end = x; })),
        num('预算', v.budget, x => pt(tr => { tr.data.budget = x; }))
      ])
    ];

    /* --- 航段：航线只认这里填的三字码，不从别处猜（§3.2） --- */
    const legs = [
      h('h3', { text: '航段' }),
      h('div', { class: 'tip', text: '填机场或城市的三字码：SHA / HND / KIX。'
        + '查不到坐标的会在下面列出来 —— 要补就改 data/places.json 再重新构建。' }),
      ...v.legs.map(l => row([
        txt('从', l.from, x => pe(l.entry, e => { e.data.from = x.toUpperCase(); })),
        txt('到', l.to, x => pe(l.entry, e => { e.data.to = x.toUpperCase(); })),
        txt('航班号', l.code, x => pe(l.entry, e => { e.data.code = x; })),
        dateIn('日期', l.entry.time && l.entry.time.start,
          x => pe(l.entry, e => { e.time.start = x; })),
        chk('已飞', l.flown, x => pe(l.entry, e => { e.data.flown = x; })),
        del(() => cut(l.entry))
      ])),
      v.unknownPlaces.length
        ? h('div', { class: 'echo danger',
            text: '查不到坐标：' + v.unknownPlaces.join('、') + '，这几段的航线画不出来' })
        : null,
      mini('＋ 加一段', () => grow('leg'))
    ];

    /* --- 花销：外币照原样填，折算交给 Kernel --- */
    const spends = [
      h('h3', { text: '花销' }),
      ...v.spends.map(s => row([
        txt('名目', s.title, x => pe(s.entry, e => { e.title = x; })),
        sel('类目', s.category, T.CAT_ORDER, x => pe(s.entry, e => { e.data.category = x; })),
        num('金额', s.raw, x => pe(s.entry, e => { e.data.amount = x; })),
        sel('币种', s.currency, ST.currencies(),
          x => pe(s.entry, e => { e.data.currency = x; }), 'n'),
        del(() => cut(s.entry))
      ])),
      mini('＋ 加一笔', () => grow('spend')),
      h('div', { class: 'echo', text: '折算成 ' + v.base + ' 合计 ' + money(v.spendTotal)
        + '，预算 ' + money(v.budget) })
    ];

    /* --- 地点：排了第几天就进日程，没排就留在想去清单 --- */
    const spots = [
      h('h3', { text: '地点' }),
      h('div', { class: 'tip', text: '「第几天」填 0 就是还没排进日程，只是想去。' }),
      ...ofType('place').map(e => row([
        num('第几天', (e.data && e.data.day) || 0,
          x => pe(e, ee => { ee.data.day = x || null; })),
        txt('名字', e.place && e.place.name || e.title, x => pe(e, ee => {
          ee.place = ee.place || {}; ee.place.name = x; ee.title = x;
        })),
        txt('城市', e.place && e.place.city,
          x => pe(e, ee => { ee.place = ee.place || {}; ee.place.city = x; })),
        del(() => cut(e))
      ])),
      mini('＋ 加一个', () => grow('place'))
    ];

    /* --- 随手写 --- */
    const n0 = ofType('note')[0];
    const ta = h('textarea', { text: n0 ? (n0.body || '') : '' });
    commit(ta, () => {
      if (n0) pe(n0, e => { e.body = ta.value; });
      else grow('note', { body: ta.value });
    });
    const notes = [
      h('h3', { text: '随手写' }),
      h('div', { class: 'tip', text: '**两个星号**中间的字会变成重点。' }),
      row([field('正文', ta, 'wide')])
    ];

    /* --- 数据出口：没有后端，导出 JSON 就是「把改动带回仓库」的唯一办法 --- */
    function download() {
      const url = URL.createObjectURL(new Blob([ST.exportJSON()], { type: 'application/json' }));
      const a = h('a', { href: url, download: 'trips.json' });
      document.body.appendChild(a);
      a.click();
      a.parentNode.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const footer = [
      h('h3', { text: '数据' }),
      h('div', { class: 'tip', text: '改动只存在这台机器的浏览器里（localStorage），换个浏览器就看不见。'
        + '导出的 JSON 形状同 data/trips.json，可以直接覆盖回仓库再 python3 build.py。' }),
      row([
        mini('导出 JSON', download),
        mini('恢复示例数据', () => {
          if (confirm('丢掉本机所有改动，回到仓库里的示例数据？')) { ST.reset(); redraw.all(); }
        }),
        mini('删掉这趟', () => {
          if (confirm('删掉「' + t.title + '」？')) { ST.removeTrip(t.id); go('#/shelf'); }
        })
      ])
    ];

    return h('div', { class: 'editor' },
      [].concat(basic, legs, spends, spots, notes, footer));
  }

  /* ================= 八、地图 / 关于 ================= */

  function mapView() {
    const rows = [];
    let km = 0;
    for (const t of ST.ordered()) {
      const v = T.derive(t, ST.ctx());
      for (const l of v.legs) {
        km += l.km;
        rows.push(h('div', { class: 'money-cat' }, [
          h('span', { text: l.from + ' → ' + l.to + '　' + l.fromName + ' – ' + l.toName }),
          h('b', { text: l.km ? T.fmtMoney(l.km) + ' km' : (l.unknown ? '查不到坐标' : '—') })
        ]));
      }
    }
    return h('div', { class: 'view' }, [
      topbar('地图'),
      h('div', { class: 'editor' }, [
        h('h3', { text: '航线一览' }),
        h('div', { class: 'tip', text: '手绘世界地图还单独放在 map.html 里，M3 会并进这一页。'
          + '坐标全部来自 data/places.json，查不到就在这儿标出来，不猜。' }),
        ...rows,
        rows.length ? null : h('div', { class: 'empty', text: '还没有航段。' }),
        h('div', { class: 'echo', text: '合计 ' + T.fmtMoney(km) + ' 公里' }),
        h('a', { class: 'mini', href: 'map.html', 'data-frame': 'rect', 'data-seed': 91,
          style: 'text-decoration:none;color:inherit', text: '先看那张手绘地图 →' })
      ])
    ]);
  }

  function aboutView() {
    const p = s => h('p', { style: 'font-size:14.5px;line-height:1.9;margin:8px 0', text: s });
    return h('div', { class: 'view' }, [
      topbar('关于这本手帐'),
      h('div', { class: 'editor' }, [
        h('h3', { text: '怎么做的' }),
        p('没有框架、没有打包器，一个 index.html 加几个 js。'
          + '手绘线是 rough.js 现画的 SVG：同一个 seed 画出来的笔迹永远一样，'
          + '所以导出、快照、回归测试都对得上。'),
        p('分三层：kernel.js 只管时间、汇率、汇总，不认识「旅行」两个字；'
          + 'trip.js 认识 leg / spend / place，负责算出卡片上的数字；'
          + 'sketch.js 只管把 data-frame 变成手绘框。换成小程序 canvas 时前两层不用动。'),
        p('数据存在浏览器里，导出 JSON 覆盖回仓库就成了新的示例数据。'),
        h('div', { class: 'echo',
          text: ST.dirty() ? '本机有未导出的改动。' : '当前显示的是仓库里的示例数据。' }),
        tappable(h('div', { class: 'mini', 'data-frame': 'rect', 'data-seed': 77,
          text: '恢复示例数据' }), () => {
          if (confirm('丢掉本机所有改动？')) { ST.reset(); render(); }
        })
      ])
    ]);
  }

  /* ================= 九、渲染 ================= */

  const scrolls = {};                 // hash -> scrollY，回来时放回去（§4.8 第 4 条）
  let atHash = null, lastName = null;

  function viewOf(r) {
    if (r.name === 'cover') return coverView();
    if (r.name === 'map') return mapView();
    if (r.name === 'about') return aboutView();
    if (r.name === 'trip') return tripView(r);
    // 宽屏时书架常驻左侧，主列就不必再来一份
    return wide()
      ? h('div', { class: 'view' }, [
          h('div', { class: 'sec-label', text: '书架' }),
          h('div', { class: 'empty', text: '左边挑一趟点进去。要记新的一趟，也在左边。' })
        ])
      : shelfView();
  }

  function render() {
    if (atHash !== null) scrolls[atHash] = root.scrollY || 0;
    const r = parse();
    const el = viewOf(r);
    if (lastName === 'cover' && r.name !== 'cover') el.classList.add('flip');
    lastName = r.name;
    atHash = location.hash;

    document.body.classList.toggle('at-cover', r.name === 'cover');
    const main = $('main');
    main.textContent = '';
    main.appendChild(el);

    const rail = $('rail-shelf');
    if (rail) {
      rail.textContent = '';
      if (r.name !== 'cover' && wide()) rail.appendChild(shelfView());
    }

    const on = r.name === 'trip' ? '#/shelf' : '#/' + r.name;
    for (const a of Array.prototype.slice.call($('tabs').getElementsByTagName('a')))
      a.classList.toggle('on', a.getAttribute('href') === on);

    SK.repaint();
    if (root.handtype) root.handtype();
    // 等一帧再滚，不然刚换的内容还没排版，滚到底部会被夹回去
    const y = scrolls[atHash] || 0;
    const scroll = () => { if (root.scrollTo) root.scrollTo(0, y); };
    if (root.requestAnimationFrame) root.requestAnimationFrame(scroll); else scroll();
  }

  /* ================= 十、启动与手势 ================= */

  const typing = e => {
    const tn = e.target && e.target.tagName;
    return tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT';
  };

  function bindKeys() {
    document.addEventListener('keydown', e => {
      if (typing(e)) return;
      if (e.key === 'd') document.body.classList.toggle('debug');
      else if (e.key === 'Escape' || e.key === 'ArrowLeft') back();
    });
  }

  // 右滑返回：只认横向为主的一划，纵向滚动不误触
  function bindSwipe() {
    let x0 = 0, y0 = 0, t0 = 0;
    document.addEventListener('touchstart', e => {
      const p = e.touches[0];
      x0 = p.clientX; y0 = p.clientY; t0 = Date.now();
    }, { passive: true });
    document.addEventListener('touchend', e => {
      const p = e.changedTouches[0];
      const dx = p.clientX - x0, dy = p.clientY - y0;
      if (dx > 60 && Math.abs(dy) < 40 && Date.now() - t0 < 600) back();
    }, { passive: true });
  }

  function boot() {
    ST.load(root.DATA);
    SK.bindPanel();
    render();
    addEventListener('hashchange', render);
    bindKeys();
    bindSwipe();

    let w = wide(), rt;
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (wide() !== w) { w = wide(); render(); }      // 断点换了，列数也得换
        else { SK.repaint(); if (root.handtype) root.handtype(); }
      }, 150);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(SK.repaint);
  }

  root.App = { parse, render, go, boot, viewOf };

  if (typeof rough === 'undefined') SK.say('rough.js 没加载成功 —— 手绘线全都画不出来');
  else if (!root.DATA) SK.say('data/bundle.js 没加载 —— 没有数据可显示');
  else try { boot(); } catch (e) { SK.say('启动失败：' + e.message); console.error(e); }
})(typeof window !== 'undefined' ? window : globalThis);


