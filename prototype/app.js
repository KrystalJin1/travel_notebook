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
  // 标题可以是空的（新建的一趟就是空的，占位提示在编辑器里），显示时再兜底
  const named = t => t.title || '未命名';

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
    if (p[0] === 'map') return { name: 'map', pick: p[1] || null };  // #/map/HKG = 点图补坐标
    if (p[0] === 'stats') return { name: 'stats' };
    if (p[0] === 'about') return { name: 'about' };
    if (p[0] === 'trip' && p[1]) {
      if (p[2] === 'photo' && p[3] != null) return { name: 'photo', id: p[1], n: +p[3] || 0 };
      if (p[2] === 'card') return { name: 'card', id: p[1] };
      return { name: 'trip', id: p[1], edit: p[2] === 'edit' };
    }
    return { name: 'cover' };
  }

  const go = hash => { location.hash = hash; };
  const back = () => { if (history.length > 1) history.back(); else go('#/shelf'); };

  /* ================= 三、封面 ================= */

  /* 封面 = 一张贴满东西的书皮，不是一张启动页。
     手绘框只有最外面 .book 这一个（§4.8 规整优先），里面的层次靠胶带、相纸、
     贴纸和一条细线拉开，不再往里套第二层抖动的方框。

     上面每个数字、城市名、年份跨度都出自 TripView.summary()，跟足迹总览页同一个函数
     （§3.1 页面不许自己再算一遍）：清空示例数据，封面立刻变成一本空本子。 */
  function coverView() {
    const s = T.summary(ST.data.trips || [], ST.ctx());
    const at = s.atlas;
    const cities = at.cities.filter(c => c.flown);

    // 年份跨度只看走过的那些（byYear 里日期没填的记成「未知」，跳过）
    const ys = s.byYear.map(r => r.year).filter(y => typeof y === 'number');
    const span = ys.length
      ? (ys[0] === ys[ys.length - 1] ? String(ys[0]) : ys[0] + ' – ' + ys[ys.length - 1])
      : null;

    /* 封面那张相纸：直接拿最近一趟真填的第一张照片（T.order 已经把最近的排在前面），
       所以换一趟数据封面就换一张图，不是挑一张好看的写死在这。
       art: / img: / 图片路径这三种怎么画，交给 T.mediaNode —— 跟照片墙同一套规则。 */
    const shot = () => {
      const hit = s.views.map(v => ({ v: v, e: T.wallPhotos(v)[0] })).filter(x => x.e)[0];
      const e = hit && hit.e, m = e && e.media[0];
      const inner = T.mediaNode(hit && hit.v, m, e && e.title);
      return h('div', { class: 'shot' }, [
        h('div', { class: 'tape', style: 'top:-13px;left:50%;margin-left:-56px;'
          + 'transform:rotate(-2.5deg)', 'data-tape': '#e9bdb0', 'data-seed': 31 }),
        h('div', { class: 'ph', 'data-frame': 'rect', 'data-seed': 29 }, [
          inner,
          h('div', { class: 'cap',
            text: e ? (e.place && e.place.name || e.title || '') : '还没有照片' })
        ])
      ]);
    };

    const cell = (n, l) => h('div', { class: 'cvc' }, [
      h('div', { class: 'cvn', text: n }), h('div', { class: 'cvl', text: l })
    ]);

    // 一句现在的话：下一趟还有几天 / 有计划但没填日期 / 空本子
    const hint = s.next
      ? '下一趟 · ' + named(s.next.trip)
        + (s.next.countdown != null && s.next.countdown >= 0
          ? '，还有 ' + s.next.countdown + ' 天' : '')
      : s.plan.length ? '还有 ' + s.plan.length + ' 趟在计划里'
        : '本子还是空的 —— 翻开，记第一趟';

    const open = tappable(h('div', { class: 'btn open', 'data-frame': 'rect',
      'data-seed': 11, 'data-fill': '#a8c8b4', text: '翻开 →' }), () => go('#/shelf'));

    // 三枚贴纸摆一排，各歪一点：手贴上去的不会齐
    const stick = (name, deg) => h('div', { class: 'st', 'aria-hidden': 'true',
      'data-art': name, style: 'transform:rotate(' + deg + 'deg)' });

    return h('div', { class: 'view cover' }, [
      h('div', { class: 'book', 'data-frame': 'rect', 'data-seed': 7 }, [
        // 书皮贴在台面上：左上、右下各一条 washi 胶带，压出纸边
        h('div', { class: 'tape', style: 'top:-14px;left:20px;transform:rotate(-5deg)',
          'data-tape': '#a8c8b4', 'data-seed': 17 }),
        h('div', { class: 'tape', style: 'bottom:-13px;right:18px;transform:rotate(3.5deg)',
          'data-tape': '#f0cd7f', 'data-seed': 19 }),
        h('div', { class: 'stamp', 'data-art': 'stamp', 'aria-hidden': 'true' }),
        h('h1', { 'data-hand': true, text: '旅行手帐' }),
        h('div', { class: 'by', text: 'TRAVEL NOTEBOOK · 手绘' }),
        span ? h('div', { class: 'span', text: span }) : null,
        shot(),
        cities.length
          ? h('div', { class: 'cities', text: cities.slice(0, 4).map(c => c.name).join(' · ')
              + (cities.length > 4 ? ' 等 ' + cities.length + ' 座' : '') })
          : null,
        h('div', { class: 'nums', 'data-frame': 'hr', 'data-seed': 13 }, [
          cell(s.done.length, '趟'),
          cell(s.days, '天'),
          cell(T.fmtMoney(at.kmFlown), '公里'),
          cell(cities.length, '座城市')
        ]),
        open,
        h('div', { class: 'sts' }, [stick('plane', -8), stick('camera', 4), stick('ticket', -3)]),
        h('div', { class: 'hint', text: hint })
      ])
    ]);
  }

  /* ================= 四、书架：竖向时间轴 ================= */

  /* 扉页贴纸：书架最顶上一张手写说明卡（§4.8）。第一次进来是展开的，点「折起」收掉，
     localStorage 记住不再展开 —— 右上角那个「?」能叫回来。
     为什么不做成封面和书架中间的一页：那就是一张可跳过的启动页，PPT 味。 */
  const NOTE = 'travel-notebook/intro';
  const noteOff = () => {
    try { return localStorage.getItem(NOTE) === 'off'; } catch (e) { return false; }
  };
  const setNote = off => {
    try { off ? localStorage.setItem(NOTE, 'off') : localStorage.removeItem(NOTE); }
    catch (e) { /* 隐私模式下会抛，那就这一次有效 */ }
    render();
  };

  function introCard() {
    const line = (k, v) => h('div', { class: 'intro-line' }, [
      h('b', { text: k }), h('span', { text: v })
    ]);
    return h('div', { class: 'intro', 'data-frame': 'rect', 'data-seed': 23 }, [
      tappable(h('span', { class: 'fold', text: '折起 ×' }), () => setNote(true)),
      h('div', { class: 'intro-title', 'data-hand': true, text: '这本子怎么用' }),
      line('记什么', '一趟走完，照片、去过哪几座城市、花了多少钱，拼成一页能看的东西。'),
      line('怎么加', '拉到底点「＋ 记一趟新的」，进去右上角「编辑 ✎」填日期、航段、花销 —— '
        + '每填一个数字，卡片、地图、足迹立刻跟着变。'),
      line('数字哪来', '全是打开这页时现算的：卡片读 derive()，地图读 atlas()，足迹读 summary()，'
        + '没有一处是写死的。'),
      h('div', { class: 'intro-foot',
        text: '书架上这几趟是示例。想从空本子开始记自己的，拉到底点「清空」。' })
    ]);
  }

  const askBtn = () => tappable(h('span', { class: 'ask', title: '这本子怎么用', text: '?' }),
    () => setNote(false));

  /* 示例数据的开关。跟 #/about 那个「恢复示例数据」不是一回事：
     那个是撤回本机改动、回到出厂的四趟；这个是一趟都不留，从空本子开始记。
     示例跟着 bundle 一起发（data/samples.json），所以离线单文件里也点得动。 */
  function sampleSwitch() {
    const left = ST.pending().length;
    const btn = (label, seed, fn) => tappable(
      h('div', { class: 'mini', 'data-frame': 'rect', 'data-seed': seed, text: label }), fn);
    return h('div', { class: 'switch' }, [
      left ? btn('载入示例 · 另 ' + left + ' 趟', 55, () => { ST.addSamples(); render(); }) : null,
      (ST.data.trips || []).length
        ? btn('清空', 66, () => {
            if (confirm('把书架清空，从空本子开始记？示例还能再载入回来。')) { ST.clearTrips(); render(); }
          })
        : null
    ]);
  }

  /* 出厂数据换了版，而这台机器上存着旧的一份（Store.stale()）—— 书架顶上说一句。
     为什么非说不可：来过一次就会往 localStorage 存一份，从那以后打开永远是那一份，
     新加的行程、换的图一辈子看不到，而页面上没有任何迹象 —— 会以为「刷新了没差别」。
     不自动覆盖：存着的那份可能是人家自己记的东西。所以给两个出口，都是一下点完。 */
  function staleCard() {
    if (!ST.stale()) return null;
    const btn = (label, seed, fn) => tappable(
      h('div', { class: 'mini', 'data-frame': 'rect', 'data-seed': seed, text: label }), fn);
    return h('div', { class: 'intro', 'data-frame': 'rect', 'data-seed': 31 }, [
      h('div', { class: 'intro-title', text: '出厂那几趟更新了' }),
      h('div', { class: 'intro-line' }, [
        h('b', { text: '为什么' }),
        h('span', { text: '你之前在这台机器上改过，书架读的就一直是本机那一份 —— '
          + '所以新的示例行程和插画都还没进来。' })
      ]),
      h('div', { class: 'switch' }, [
        btn('取新的 · 丢掉本机改动', 32, () => {
          if (confirm('用新的出厂数据覆盖本机这一份？你在这台机器上改过的都会没了。')) {
            ST.reset(); render();
          }
        }),
        btn('不用了 · 留着我的', 33, () => { ST.keepMine(); render(); })
      ])
    ]);
  }

  /* 书架上一行 = 一趟。这里故意不给每个数字套手绘框：一屏十几个抖动的小方框
     会把版面搅花，手绘留给外框那一个，数字排成一行小字（§4.8 规整优先）。 */
  function strip(t) {
    const v = T.derive(t, ST.ctx()), plan = T.isPlan(v.status);
    const facts = v.status === 'cancelled'
      ? ['已取消', '预算 ' + money(v.budget)]
      : v.status === 'planned'
        ? [v.countdown > 0 ? '距出发 ' + v.countdown + ' 天' : '就要走了',
           '预算 ' + money(v.budget), '想去 ' + v.wishlist.length + ' 个']
        : [v.status === 'ongoing' ? '第 ' + v.dayNow + ' 天' : null,
           v.days + ' 天', v.cities.length + ' 城市',
           v.media.length + ' 照片', money(v.spendTotal)].filter(Boolean);

    const item = h('div', { class: 'tl-item' + (plan ? ' plan' : '') }, [
      h('div', { class: 'strip', 'data-frame': 'rect', 'data-seed': t.seed }, [
        h('div', { class: 'when', text: v.dateLabel }),
        h('div', { class: 'name' + (plan ? ' plan' : ''), 'data-hand': true, text: named(t) }),
        h('div', { class: 'facts', text: facts.join('　·　') }),
        h('span', { class: 'go', text: '→' })
      ])
    ]);
    return tappable(item, () => go('#/trip/' + t.id));
  }

  /* 分栏按算出来的状态（§3.2）：日期一过，那趟自己从「待出行」挪到「已旅行」，
     用户不用去改下拉框。「旅行中」只在真有一趟正在走的时候才出现。
     plain = 宽屏左侧书脊上那一份：只要时间轴，扉页和开关归主列（同一份 routes，
     区别只在「一屏显示几层」§4.8）。 */
  function shelfView(plain) {
    const trips = ST.ordered();
    const statusOf = t => T.derive(t, ST.ctx()).status;
    const pick = fn => trips.filter(t => fn(statusOf(t)));
    const group = (label, list, empty) => (!list.length && !empty) ? [] : [
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
      plain ? null : staleCard(),
      plain ? null : (noteOff() ? h('div', { class: 'shelf-head' }, [askBtn()]) : introCard()),
      ...group('旅行中 · NOW', pick(s => s === 'ongoing'), null),
      ...group('已旅行 · PAST', pick(s => s === 'done'), '还没有记完的旅行。'),
      ...group('待出行 · PLANNED', pick(T.isPlan), '还没有计划。点下面新建一趟。'),
      add,
      plain ? null : sampleSwitch()
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
    const bar = topbar(named(t), r.edit ? '完成 ✓' : '编辑 ✎',
      () => go('#/trip/' + t.id + (r.edit ? '' : '/edit')));

    // 卡片和编辑器是两个独立容器：填一个数字只重画卡片，输入框不会失焦（§4.8）
    function drawCard() {
      T.mount(cardHost, Object.assign({}, ST.data, { trips: [t] }));
      // 照片墙上的每一张都能点开看大图。序号由 trip.js 打在 data-ph 上，
      // 路由留在这一层，卡片那边照旧不认识 hash（§6.1）
      for (const el of cardHost.querySelectorAll('[data-ph]'))
        tappable(el, () => {
          flipFrom = el.getBoundingClientRect();
          go('#/trip/' + t.id + '/photo/' + (el.getAttribute('data-ph') || 0));
        });
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

    // 明信片是另一层，不是这一页的一段：详情页竖着滚多长都行，明信片是固定的一张纸（§4.7）
    const toCard = r.edit ? null : h('div', { class: 'seg pc-acts' }, [
      tappable(h('span', { class: 'mini', 'data-frame': 'rect',
        'data-seed': K.seedOf(t.seed, 'pcbtn'), text: '做张明信片 →' }),
        () => go('#/trip/' + t.id + '/card'))
    ]);

    return h('div', { class: 'view detail' }, [bar, cardHost, toCard, moneyHost, editHost]);
  }

  /* ================= 五点五、明信片（§4.4 / §4.7） =================

     详情页是一条竖着滚的流，没有「一页」可言，所以也没法发给别人。
     明信片才是那张纸：版面由 layout.js 算，画由 postcard.js 出，存盘归 bake.js。
     这一层只负责路由、三个按钮，和把 audit 的四个数摊给调试条。 */

  function cardView(r) {
    const t = ST.trip(r.id);
    if (!t) return h('div', { class: 'view detail' }, [
      topbar('找不到这一趟'),
      h('div', { class: 'empty', text: '这趟旅行不在本机数据里。可能是清过缓存。' })
    ]);
    if (!root.Postcard || !root.Bake) return h('div', { class: 'view detail' }, [
      topbar(named(t)),
      h('div', { class: 'empty', text: 'postcard.js / bake.js 没加载 —— 明信片画不出来。' })
    ]);

    const card = root.Postcard.build(T.derive(t, ST.ctx()));
    const name = named(t) + ' 明信片';
    const echo = h('div', { class: 'echo', text: '存 SVG 不需要 canvas，任何环境都存得出来。' });

    // 每个按钮都可能失败（file:// 下读不到字体、无头环境没有 canvas），失败就把原因写在下面
    const btn = (label, fn) => tappable(h('span', { class: 'mini', text: label }), () => {
      echo.textContent = label + '…';
      let job;
      try { job = fn(); } catch (e) { job = Promise.reject(e); }
      Promise.resolve(job).then(res => {
        echo.textContent = '已存 ' + res.name + '（' + Math.max(1, Math.round(res.size / 1024)) + ' KB）'
          + (res.font === false ? '　字体没内联进去，图上的正文换了一支字：从 http 打开就正常。' : '');
      }, e => { echo.textContent = '存不出来：' + e.message; });
    });

    const B = root.Bake, a = card.audit;
    return h('div', { class: 'view detail' }, [
      topbar(named(t) + ' · 明信片', '回详情 ↩', () => go('#/trip/' + t.id)),
      h('div', { class: 'pc' }, [card.node]),
      h('div', { class: 'seg pc-acts' }, [
        btn('存 PNG', () => B.png(card.node, name)),
        btn('存 PDF', () => B.pdf(card.node, name)),
        btn('存 SVG', () => B.svg(card.node, name))
      ]),
      echo,
      h('div', { class: 'echo pc-audit', text: '§7.2　压字 ' + a.textHits + '　出界 ' + a.outside
        + '　照片重叠 ' + (a.overlap * 100).toFixed(1) + '%　留白 ' + (a.white * 100).toFixed(1) + '%'
        + '　贴片 ' + a.tiles + ' 片 / ' + card.layout.rows + ' 行　seed ' + card.layout.seed })
    ]);
  }

  /* ================= 六、表单控件 ================= */

  /* 一律 change 时才写回，不用 input —— 边打字边重渲染会让光标乱跳。 */

  const field = (label, el, cls) =>
    h('label', { class: cls || null }, [document.createTextNode(label), el]);

  function commit(el, fn) { el.addEventListener('change', fn); return el; }

  // ph = 占位提示。默认文案一律走 placeholder，不写成 value ——
  // 写成 value 用户点开第一件事是全选删掉（用户反馈）。
  function txt(label, val, fn, cls, ph) {
    const el = h('input', { type: 'text', value: val == null ? '' : val, placeholder: ph || null });
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

  // 经纬度不能用 num()：num() 把空框读成 0，而 0 是条真经线（本影子午线）。
  // 空 → null，让「还没填」和「填了 0」分得开。
  const numOr = s => {
    s = (s == null ? '' : String(s)).trim();
    return s === '' || isNaN(Number(s)) ? null : Number(s);
  };

  /* ================= 七、编辑：填数字的地方 ================= */

  /* 状态那一格写回仓库的规则：'auto' = 不锁，存一笔当下算出来的值（导出的 JSON 里不留旧状态）；
     选了具体一档就打上 lockStatus，状态机不再动它。取消本身就是终点，不用再锁。 */
  function setStatus(tr, x) {
    tr.data = tr.data || {};
    if (x === 'auto') {
      delete tr.data.lockStatus;
      tr.status = T.statusOf(tr, ST.ctx().now);
    } else {
      tr.status = x;
      if (x === 'cancelled') delete tr.data.lockStatus;
      else tr.data.lockStatus = true;
    }
  }

  /* 选图墙摊开在哪一条 photo 上（null = 都收起）。为什么放在 editor() 外面：
     换一张图会 redraw.all() 重画整个编辑器，状态存在闭包里的话选完一张墙就自己合上了，
     而人通常要连着挑两三张。同时只摊开一个 —— 一趟三张照片、每张一墙就是 57 个
     缩略图，每个都要 rough.js 描一遍。 */
  let openPick = null;

  /* 待确认区的状态（同 openPick，得放在 editor() 外面：确认 / 丢弃都会 redraw.all()）。
     text 是粘进来的原文，out 是 Providers.parse() 的产出，off 记哪几条被人取消了勾。
     **这一份不进 Store** —— 没点确认之前，读出来的东西只活在内存里（§4.6）。 */
  let pend = { text: '', out: null, off: {} };

  const PEND_TYPE = { leg: '航段', stay: '住宿', spend: '花销', place: '地点',
    note: '随手写', photo: '照片' };
  // source.low 是字段路径，给人看得说人话 —— 不能把 data.checkIn 直接甩到界面上
  const PEND_LOW = { 'time.start': '日期', 'data.from': '从哪', 'data.to': '到哪',
    'data.mode': '怎么去', 'data.code': '航班号 / 车次', 'data.flown': '飞没飞',
    'data.checkIn': '入住', 'data.checkOut': '退房', 'data.booked': '订没订',
    'data.category': '类目', 'data.currency': '币种', 'data.day': '第几天',
    'place.name': '地名', 'media': '图' };

  // 一条待确认的 entry 摊成一行字。只是把 entry 里已经有的值排一排，不在这儿算任何数
  function pendLine(e) {
    const d = e.data || {}, bits = [];
    if (e.time && e.time.start) bits.push(String(e.time.start).replace('T', ' '));
    else if (e.time && e.time.end) bits.push('～' + e.time.end);
    if (e.type === 'leg') bits.push((d.from || '？') + ' → ' + (d.to || '？')
      + (d.code ? ' ' + d.code : '') + (d.mode ? '' : '（不知道坐什么）'));
    if (e.type === 'stay') bits.push((d.checkIn || '？') + ' 到 ' + (d.checkOut || '？')
      + (d.price ? '　' + d.currency + ' ' + d.price : '') + (d.booked ? '　已订' : ''));
    if (e.type === 'spend') bits.push((d.category || '') + '　' + (d.currency || '')
      + ' ' + (d.amount == null ? '' : d.amount));
    if (e.type === 'place') bits.push(((e.place || {}).name || e.title || '')
      + (d.day ? '　第 ' + d.day + ' 天' : ''));
    if (e.type === 'photo') bits.push(String((((e.media || [])[0] || {}).name
      || ((e.media || [])[0] || {}).path || '一张照片')).slice(0, 40));
    if (e.type === 'note') bits.push(e.body || e.title || '');
    return bits.filter(Boolean).join('　');
  }

  function editor(t, redraw) {
    const v = T.derive(t, ST.ctx());
    const ofType = ty => (t.entries || []).filter(e => e.type === ty);
    const pt = fn => { ST.patchTrip(t.id, fn); redraw.card(); };
    const pe = (e, fn) => { ST.patchEntry(t.id, e.id, fn); redraw.card(); };
    const peAll = (e, fn) => { ST.patchEntry(t.id, e.id, fn); redraw.all(); };
    const grow = (type, patch) => { ST.addEntry(t.id, type, patch); redraw.all(); };
    const cut = e => { ST.removeEntry(t.id, e.id); redraw.all(); };
    const mini = (label, fn) => tappable(h('div', { class: 'mini', 'data-frame': 'rect',
      'data-seed': K.seedOf(t.seed, label), text: label }), fn);
    const del = fn => tappable(h('span', { class: 'del', text: '删除' }), fn);

    /* --- 这一趟 ---
       状态默认「跟着日期走」（§3.2 状态机）：出发日到了自己变旅行中，结束日过了自己变已旅行。
       选具体某一档就是锁住不再自动推进 —— 行程取消、日期没定的时候用得上。
       日期一改状态可能就翻了，所以这三个控件改完重画整个编辑器（回声也得跟着变）。 */
    const relock = tr => { if (!v.statusLocked) tr.status = T.statusOf(tr, ST.ctx().now); };
    const basic = [
      h('h3', { text: '这一趟' }),
      row([
        txt('标题', t.title, x => { pt(tr => { tr.title = x.trim(); }); redraw.title(named(t)); },
          'wide', '这趟叫什么，比如「东京」'),
        sel('状态', v.statusLocked ? v.status : 'auto',
          [['auto', '跟着日期走'], ['planned', '锁定 · 待出行'], ['ongoing', '锁定 · 旅行中'],
           ['done', '锁定 · 已旅行'], ['cancelled', '取消了']],
          x => { ST.patchTrip(t.id, tr => setStatus(tr, x)); redraw.all(); }),
        txt('编号', (t.data || {}).no, x => pt(tr => { tr.data.no = x; })),
        dateIn('开始', t.time.start,
          x => { ST.patchTrip(t.id, tr => { tr.time.start = x; relock(tr); }); redraw.all(); }),
        dateIn('结束', t.time.end,
          x => { ST.patchTrip(t.id, tr => { tr.time.end = x; relock(tr); }); redraw.all(); }),
        num('预算', v.budget, x => pt(tr => { tr.data.budget = x; }))
      ]),
      h('div', { class: 'echo', text: '现在算「' + v.statusLabel + '」'
        + (v.statusLocked ? '：锁住了，日期到了也不动。' : '：按日期自动推进。') })
    ];

    /* --- 粘一段，自动认（§4.6 / §7.1）---
       手工填 20 个格子没人愿意干，全自动又一定会读错，而**错了用户不一定发现**。
       所以读出来的东西先停在这一段里：每条前面一个勾，「这一格是猜的」当场标出来，
       点「确认」才落库。看不懂的行原样列出来让人自己看，不硬塞成随手写。
       provider 自己不认识 Store，ctx 是这里喂的：年份和「第一天是哪天」都来自这一趟。 */
    const sctx = ST.ctx();
    const pctx = Object.assign({}, sctx, {
      year: +String(t.time.start || '').slice(0, 4) || sctx.now.getFullYear(),
      tripStart: t.time.start || ''
    });
    const runParse = (input, id) => {
      pend.out = root.Providers.parse(input, pctx, id);
      pend.off = {};
      redraw.all();
    };
    const pta = h('textarea', { class: 'pend-in', text: pend.text,
      placeholder: '一行一条，直接粘订单里那几行：\n'
        + '3月14日 09:20 SHA MU523 → HND\n'
        + '入住 THE HOTEL 京都四条 已订 JPY 98,000，3月17日 退房\n'
        + '3月15日 午餐 一乐拉面 JPY 1,200\n第 3 天 清水寺、二年坂' });
    commit(pta, () => { pend.text = pta.value; });

    /* 读文件是浏览器的事，解析是纯函数的事（§4.6）：这里只把 File 变成 {name, bytes},
       读完了才交给 provider —— provider 不认识 File，所以它才测得动。
       图本身也得存下来才画得出来，但 localStorage 只有几 MB，所以大图只取时间和坐标，
       画面退回默认那张插画，并且明说了这件事，而不是留一个画不出来的空框。 */
    const INLINE_MAX = 300 * 1024;
    const filesIn = h('input', { type: 'file', multiple: true, accept: 'image/*' });
    commit(filesIn, () => {
      const list = Array.prototype.slice.call(filesIn.files || []);
      if (!list.length) return;
      let left = list.length * 2;
      const got = [];
      const done2 = () => {
        if (--left) return;
        // 名字 → 那份字节和 data URL，dress() 按 media[0].path（provider 填的就是文件名）回查
        pend.files = {};
        got.forEach(g => { pend.files[g.name] = g; });
        runParse(got, 'exif');
      };
      list.forEach((f, i) => {
        got[i] = { name: f.name, bytes: [], url: '' };
        const rb = new root.FileReader();
        rb.onloadend = () => {
          got[i].bytes = new Uint8Array(rb.result || new ArrayBuffer(0));
          done2();
        };
        rb.readAsArrayBuffer(f);
        if (f.size > INLINE_MAX) { done2(); return; }
        const ru = new root.FileReader();
        ru.onloadend = () => { got[i].url = String(ru.result || ''); done2(); };
        ru.readAsDataURL(f);
      });
    });

    // 照片那一路：把「原图」接到 entry 上（或者说清为什么接不上）。
    // provider 只知道字节，图存哪儿是页面的事，所以这一步在这里做，不在 provider 里做
    const dress = e => {
      if (e.type !== 'photo') return e;
      const m = (e.media || [])[0] || {};
      const f = (pend.files || {})[m.path] || {};
      m.name = m.path;
      if (f.url) { m.path = f.url; m.kind = 'image'; }
      else {
        m.path = '';                                   // 留空 = 用默认那张插画，不是空框
        e.source.low = (e.source.low || []).concat('media');
      }
      return e;
    };

    const out = pend.out;
    const pendRows = !out ? [] : (out.entries || []).map((e, i) => {
      const low = (e.source || {}).low || [];
      return h('div', { class: 'fix' }, [
        row([
          chk('要这条', !pend.off[i], x => { pend.off[i] = !x; }),
          h('b', { class: 'code', text: PEND_TYPE[e.type] || e.type }),
          h('span', { class: 'pend-t', text: (e.title ? e.title + '　' : '') + pendLine(e) })
        ]),
        h('div', { class: 'echo' + (low.length ? ' danger' : ''),
          text: (low.length ? '这几格是猜的，过一眼：' + low.map(f => PEND_LOW[f] || f).join('、')
            : '这条读得挺全')
            + '　·　把握 ' + Math.round(((e.source || {}).confidence || 0) * 100) + '%' })
      ]);
    });

    const keepPend = () => {
      (out.entries || []).forEach((e, i) => {
        if (pend.off[i]) return;
        const patch = Object.assign({}, dress(e));
        delete patch.type;                             // id 由 Store.addEntry() 发
        ST.addEntry(t.id, e.type, patch);
      });
      pend = { text: '', out: null, off: {} };
      redraw.all();
    };

    const paste = [
      h('h3', { text: '粘一段，自动认' }),
      h('div', { class: 'tip', text: '粘一段文字或者选几张照片，下面会列出读到的东西 —— '
        + '**点「确认」才算填进去**。读错的地方直接取消勾，落库之后也照样能改。' }),
      row([field('粘在这儿', pta, 'wide')]),
      row([
        mini('认一下 →', () => { pend.text = pta.value; runParse(pta.value, 'text'); }),
        root.FileReader ? field('或者选几张照片（读拍摄时间和坐标）', filesIn, 'wide') : null
      ]),
      !out ? null : h('div', { class: 'echo',
        text: '「' + (root.Providers.byId(out.provider) || {}).label + '」读出 '
          + (out.entries || []).length + ' 条，' + (out.misses || []).length + ' 行没看懂。' }),
      ...pendRows,
      !out || !(out.misses || []).length ? null : h('div', { class: 'echo danger',
        text: '这几行没看懂，自己看一眼：' + out.misses.map(m => '「' + m.line + '」（'
          + m.why + '）').join('　') }),
      !out || !(out.entries || []).length ? null : row([
        mini('确认 ✓ 加进这一趟', keepPend),
        mini('都不要 ×', () => { pend = { text: pend.text, out: null, off: {} }; redraw.all(); })
      ])
    ];

    /* --- 航段：航线只认这里填的三字码，不从别处猜（§3.2） ---
       查不到坐标的码，一个码给一行：手填经纬度，或者去地图上点一下。
       填进去的存在本机（Store.myPlaces），不动 data/places.json —— 那是构建产物，
       用户在浏览器里改不了它。查表里以后补上了，查表那份自然接管。 */
    const fixRow = code => {
      const d = { name: '', lon: null, lat: null };
      const warn = h('div', { class: 'echo danger' });        // 空的时候 CSS 收掉
      const put = () => {
        if (d.lon == null || d.lat == null) return;           // 还没填完，先不吵
        if (!ST.setPlace(code, { name: d.name || code, ll: [d.lon, d.lat] })) {
          warn.textContent = '这个点不在地球上：经度要在 −180~180，纬度要在 −90~90';
          return;
        }
        redraw.all();
      };
      return h('div', { class: 'fix' }, [
        row([
          h('b', { class: 'code', text: code }),
          txt('叫什么', '', x => { d.name = x.trim(); put(); }, null, '比如「香港」'),
          txt('经度 E', '', x => { d.lon = numOr(x); put(); }, 'n', '114.17'),
          txt('纬度 N', '', x => { d.lat = numOr(x); put(); }, 'n', '22.32'),
          mini('在地图上点一下', () => go('#/map/' + encodeURIComponent(code)))
        ]),
        warn
      ]);
    };

    const legs = [
      h('h3', { text: '航段' }),
      h('div', { class: 'tip', text: '填机场或城市的三字码：SHA / HND / KIX。'
        + '查不到坐标的会在下面单独列出来，补一次就记住了。' }),
      ...v.legs.map(l => row([
        // 起降码改了，「查不到坐标」那几行得当场跟着变，所以这两格重画整个编辑器
        txt('从', l.from, x => peAll(l.entry, e => { e.data.from = x.toUpperCase(); })),
        txt('到', l.to, x => peAll(l.entry, e => { e.data.to = x.toUpperCase(); })),
        txt('航班号', l.code, x => pe(l.entry, e => { e.data.code = x; }), null, '选填'),
        dateIn('日期', l.entry.time && l.entry.time.start,
          x => pe(l.entry, e => { e.time.start = x; })),
        chk('已飞', l.flown, x => pe(l.entry, e => { e.data.flown = x; })),
        del(() => cut(l.entry))
      ])),
      v.unknownCodes.length
        ? h('div', { class: 'echo danger',
            text: '这几个码查不到坐标：' + v.unknownCodes.join('、')
              + '，航线先画不出来。补上坐标就有了：' })
        : null,
      ...v.unknownCodes.map(fixRow),
      mini('＋ 加一段', () => grow('leg'))
    ];

    /* --- 花销：外币照原样填，折算交给 Kernel --- */
    const spends = [
      h('h3', { text: '花销' }),
      ...v.spends.map(s => row([
        txt('名目', s.title, x => pe(s.entry, e => { e.title = x; }), null, '花在什么上'),
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
        }), null, '想去哪儿'),
        txt('城市', e.place && e.place.city,
          x => pe(e, ee => { ee.place = ee.place || {}; ee.place.city = x; }), null, '在哪座城市'),
        del(() => cut(e))
      ])),
      mini('＋ 加一个', () => grow('place'))
    ];

  /* --- 照片：三种写法都能填（§3.1）---
       选图是**看图选**，不是从下拉里认名字：点行内那张缩略图，下面摊开这本子里
       现成的图（11 张矢量插画 art: + 构建时内联进 bundle 的位图 img:），点中哪张就换哪张。
       为什么不做成常开的一排：一趟三张照片就是 57 个缩略图，每张都要 rough.js 描一遍，
       又慢又花。所以同时只摊开一张的（openPick 记的是哪条 entry）。
       自己的图走「贴地址」那一栏 —— http 地址和 data:image/… 都认。
       只在这里改 media[0].path，怎么画仍然是 Kernel.mediaRef() 一处说了算。
       顺序就是上墙顺序（前 5 张上墙、第一张还兼当封面相纸），所以给一个「上移」。 */
    const mediaOpts = [].concat(
      (root.Sketch.SCENES || []).map(p => ['art:' + p[0], p[1]]),
      Object.keys(ST.data.images || {}).sort().map(k => ['img:' + k, k])
    );
    const known = p => mediaOpts.some(o => o[0] === p);

    // 选图墙：每格就是这张图本身，走 T.mediaNode() —— 跟照片墙同一个渲染入口，
    // 所以格子里看到的就是选完之后卡片上的样子，不是另画一套预览图
    function pickWall(e, cur, put) {
      return h('div', { class: 'pick' }, mediaOpts.map(o => {
        const cell = h('div', { class: 'pick-i' + (o[0] === cur ? ' on' : '') }, [
          T.mediaNode(v, { path: o[0], w: 150, h: 105 }, o[1]),
          h('span', { class: 'pick-t', text: o[1] })
        ]);
        return tappable(cell, () => { openPick = null; put(o[0]); });
      }));
    }

    function photoRow(e, i, all) {
      const m = (e.media && e.media[0]) || {};
      const p = m.path || '';
      const put = x => peAll(e, ee => {
        if (!(ee.media || []).length) ee.media = [{ id: ee.id + '-m', w: 150, h: 105 }];
        ee.media[0].path = x;
        ee.media[0].kind = /^art:/.test(x) ? 'drawing' : 'image';
      });
      const ref = K.mediaRef(p, ST.data.images);
      const lost = ref.art && !root.Sketch.ART[ref.art];
      const okDraw = !!p && !ref.missing && !lost;
      const open = openPick === e.id;
      const why = !p ? '还没选图，先按默认那张画。点上面那张缩略图挑一张。'
        : ref.missing ? '缺图「' + ref.missing + '」：bundle 里没有这个名字，'
            + '把 jpg 放进 prototype/media/ 再 python3 build.py data，或者换成下面的地址。'
        : lost ? '插画库里没有「' + ref.art + '」这张。'
        : '画得出来。';
      return h('div', { class: 'fix' }, [
        row([
          tappable(h('div', { class: 'thumb' + (open ? ' on' : ''), title: '点一下换图' },
            [T.mediaNode(v, m, e.title)]),
            () => { openPick = open ? null : e.id; redraw.all(); }),
          txt('说明', e.title, x => pe(e, ee => { ee.title = x; }), null, '这张是什么'),
          mini(open ? '收起 ×' : '换图 ⇄', () => { openPick = open ? null : e.id; redraw.all(); }),
          i > 0 ? mini('↑ 上移', () => swap(e, all[i - 1])) : null,
          del(() => cut(e))
        ]),
        open ? pickWall(e, known(p) ? p : '', put) : null,
        open ? row([txt('贴地址', known(p) ? '' : p, x => put(x.trim()), 'wide',
          '自己的图：https://… 或 data:image/jpeg;base64,…')]) : null,
        h('div', { class: 'echo' + (okDraw ? '' : ' danger'), text: why })
      ]);
    }
    // 换顺序就是换 entries 里的位置：上墙顺序、封面挑第一张，都读的是这个数组
    const swap = (a, b) => {
      ST.patchTrip(t.id, tr => {
        const i = tr.entries.indexOf(a), j = tr.entries.indexOf(b);
        if (i < 0 || j < 0) return;
        tr.entries[i] = b; tr.entries[j] = a;
      });
      redraw.all();
    };
    const photos = [
      h('h3', { text: '照片' }),
      h('div', { class: 'tip', text: '点缩略图换图。前 5 张上照片墙，第一张还兼当封面那张相纸。'
        + '待出行的这一栏是「想去的样子」，一样会显示。' }),
      ...(() => { const all = ofType('photo'); return all.map((e, i) => photoRow(e, i, all)); })(),
      // 加一张就直接摊开选图墙：默认塞一张再让人自己去找，就成了「随机加了一张」
      mini('＋ 加一张', () => {
        const e = ST.addEntry(t.id, 'photo');
        openPick = e && e.id;
        redraw.all();
      })
    ];

    /* --- 随手写 --- */
    const n0 = ofType('note')[0];
    const ta = h('textarea', { text: n0 ? (n0.body || '') : '',
      placeholder: '当时发生了什么、天气怎么样、下次还来不来。' });
    commit(ta, () => {
      if (n0) pe(n0, e => { e.body = ta.value; });
      else grow('note', { body: ta.value });
    });
    const notes = [
      h('h3', { text: '随手写' }),
      h('div', { class: 'tip', text: '**两个星号**中间的字会变成重点。' }),
      row([field('正文', ta, 'wide')])
    ];

    /* --- 确定：改动是即时存的，但用户需要一个「填完了」的出口。
           顶栏那个「完成 ✓」太小，新建完一趟找不到（用户反馈），所以这里再给一个大的。 --- */
    const done = [
      tappable(h('div', { class: 'btn done-edit', 'data-frame': 'rect',
        'data-seed': K.seedOf(t.seed, 'done'), 'data-fill': '#a8c8b4',
        text: '完成 ✓ 看这一趟' }), () => go('#/trip/' + t.id)),
      h('div', { class: 'tip', text: '填的东西是随填随存的，这个按钮只是收起编辑器。' })
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
          if (confirm('删掉「' + named(t) + '」？')) { ST.removeTrip(t.id); go('#/shelf'); }
        })
      ])
    ];

    return h('div', { class: 'editor' },
      [].concat(basic, paste, legs, spends, spots, photos, notes, done, footer));
  }

  /* ================= 八、地图 ================= */

  /* 地图上每一段都对应用户真填的一条 leg（TripView.atlas 算好），
     点航线或城市就跳去那一趟。坐标查不到的段不画，名单在下面列出来，不猜。

     #/map/HKG 是「点图补坐标」模式（§3.2）：从编辑器过来，点画布任意一处，
     把那一点反投影成经纬度存进本机，然后退回编辑器。地球视角下反投影可能落在
     背面（invert 给不出点），那次点击就当没点。 */
  function mapView(r) {
    const at = T.atlas(ST.data.trips || [], ST.ctx());
    const pick = r && r.pick;
    const bar = pick
      ? topbar('给 ' + pick + ' 点个位置', '取消 ×', back)
      : topbar('地图');
    const box = h('div', { class: 'map-stage' });
    const capt = h('div', { class: 'echo', text: '正在画…' });
    const lgDone = h('i'), lgPlan = h('i');

    const facts = () => ['已飞 ' + at.flownCount + ' 段', '计划 ' + at.planCount + ' 段',
      at.cities.length + ' 座城市', T.fmtMoney(at.km) + ' 公里（已飞 '
      + T.fmtMoney(at.kmFlown) + '）', ST.data.trips.length + ' 趟'].join('　·　');

    const legend = h('div', { class: 'legend' }, [
      h('span', null, [lgDone, h('span', { text: '已旅行' })]),
      h('span', null, [lgPlan, h('span', { text: '待出行' })]),
      h('span', { class: 'facts', text: facts() })
    ]);

    const miss = root.MapView ? root.MapView.missing() : 'map.js';
    if (miss) {
      box.appendChild(h('div', { class: 'empty', text: '地图画不出来：' + miss + ' 没加载。' }));
      capt.textContent = '';
    } else if (!at.routes.length && !pick) {
      box.appendChild(h('div', { class: 'empty',
        text: '还没有航段。去某一趟的编辑页「＋ 加一段」，这里就有线了。' }));
      capt.textContent = '';
    } else {
      const ctrl = root.MapView.mount(box, at, {
        onStatus: s => { capt.textContent = s; },
        // 补坐标的时候，点线/点城市不再跳走 —— 那一下也是在选位置
        onPick: pick ? function () {} : x => go('#/trip/' + (x.tripId || x.trips[0])),
        onPickLL: pick ? (ll => {
          if (ST.setPlace(pick, { name: pick, ll: ll })) back();
        }) : null
      });
      const seg = h('div', { class: 'seg' });
      [['flat', '摊平'], ['globe', '地球']].forEach(([v, label]) => {
        const b = tappable(h('div', { class: 'mini' + (v === 'flat' ? ' on' : ''),
          'data-frame': 'rect', 'data-seed': K.seedOf(9, v), text: label }), () => {
          ctrl.setView(v);
          for (const n of Array.prototype.slice.call(seg.children))
            n.classList.toggle('on', n === b);
          SK.repaint();
        });
        seg.appendChild(b);
      });
      bar.appendChild(seg);
      // 挂上去之后再画：svg 要先进 DOM 才量得到尺寸
      setTimeout(() => {
        ctrl.repaint();
        root.MapView.legendLine(lgDone, 'done');
        root.MapView.legendLine(lgPlan, 'plan');
      }, 0);
    }

    const rows = at.routes.map(r => tappable(h('div', { class: 'money-cat' }, [
      h('span', { text: r.from + ' → ' + r.to + '　' + r.fromName + ' – ' + r.toName
        + (r.flown ? '' : '（计划）') }),
      h('b', { text: r.km ? T.fmtMoney(r.km) + ' km' : '—' })
    ]), () => go('#/trip/' + r.tripId)));

    return h('div', { class: 'view' }, [
      bar,
      pick ? h('div', { class: 'editor' }, [
        h('div', { class: 'tip', text: '「' + pick + '」查不到坐标。在地图上点它大概的位置就行 ——'
          + ' 世界地图这个尺度上差几十公里看不出来，回去还能改。'
          + '摊平视图点起来准一些；地球背面点不到，先拖一下转过来。' })
      ]) : null,
      h('div', { class: 'editor' }, [box, capt, legend]),
      h('div', { class: 'editor' }, [
        h('h3', { text: '航线一览' }),
        h('div', { class: 'tip', text: '点地图上的线或城市，也点这里的任意一行，都能跳到那一趟。'
          + '坐标先查 data/places.json，再叠上你自己补过的那些（存在这台机器上）。' }),
        ...rows,
        rows.length ? null : h('div', { class: 'empty', text: '还没有航段。' }),
        at.unknown.length
          ? h('div', { class: 'echo danger', text: '这些码还查不到坐标，所以画不出来：'
              + at.unknown.join('、') + '。去那一趟的编辑页「航段」那一段补一下。' })
          : null,
        h('div', { class: 'echo', text: facts() })
      ])
    ]);
  }

  /* ================= 八点五、照片大图 ================= */

  /* 点缩略图时记下它当时的位置，大图就从那儿长出来（FLIP：先把大图缩回小图的
     位置和尺寸，下一帧再放开，浏览器补中间的过程）。翻页时不用它。 */
  let flipFrom = null;

  const wallOf = t => T.wallPhotos(T.derive(t, ST.ctx()));

  function photoStep(r, d) {
    const t = ST.trip(r.id);
    if (!t) return;
    const n = wallOf(t).length;
    if (n < 2) return;
    flipFrom = null;
    go('#/trip/' + t.id + '/photo/' + (((r.n + d) % n + n) % n));
  }

  function photoView(r) {
    const t = ST.trip(r.id);
    const v = t ? ST.view(r.id) : null;
    const list = v ? T.wallPhotos(v) : [];
    if (!list.length) return h('div', { class: 'view' }, [
      topbar('看照片'),
      h('div', { class: 'empty', text: '这一趟还没有照片。' })
    ]);

    const n = ((r.n % list.length) + list.length) % list.length;
    const e = list[n], m = e.media[0];
    const inner = T.mediaNode(v, m, e.title);

    const cap = [e.place && e.place.name || e.title, e.data && e.data.day ? 'D' + e.data.day : null]
      .filter(Boolean).join(' · ');
    const fig = h('div', { class: 'lb-fig', 'data-frame': 'rect',
      'data-seed': K.seedOf(t.seed, 'lb' + e.id) }, [inner]);

    const arrow = (label, d) => tappable(h('div',
      { class: 'lb-arrow' + (list.length < 2 ? ' off' : ''), text: label }),
      () => photoStep({ id: t.id, n: n }, d));

    return h('div', { class: 'view photo' }, [
      h('div', { class: 'lb-bar' }, [
        tappable(h('span', { class: 'lb-x', text: '✕' }), () => go('#/trip/' + t.id)),
        h('span', { class: 'lb-t', text: named(t) }),
        h('span', { class: 'lb-n', text: (n + 1) + ' / ' + list.length })
      ]),
      h('div', { class: 'lb-stage' }, [arrow('‹', -1), fig, arrow('›', 1)]),
      h('div', { class: 'lb-cap' }, [
        h('div', { class: 'lb-cap-t', text: cap || '还没写说明' }),
        h('div', { class: 'lb-cap-s',
          text: e.body || (list.length > 1 ? '左右滑动或按 ← → 翻页　·　Esc 关掉' : 'Esc 关掉') })
      ])
    ]);
  }

  /* 从缩略图长成大图。要等这一页真进了 DOM 才量得到位置，所以 render() 末尾才调 */
  function playFlip(view) {
    const from = flipFrom;
    flipFrom = null;
    const fig = view.querySelector && view.querySelector('.lb-fig');
    if (!from || !fig || !root.requestAnimationFrame) return;
    const to = fig.getBoundingClientRect();
    if (!to.width || !to.height) return;
    fig.style.transformOrigin = 'top left';
    fig.style.transform = 'translate(' + (from.left - to.left).toFixed(1) + 'px,'
      + (from.top - to.top).toFixed(1) + 'px) scale('
      + (from.width / to.width).toFixed(4) + ',' + (from.height / to.height).toFixed(4) + ')';
    fig.style.opacity = '.55';
    requestAnimationFrame(() => {
      fig.style.transition = 'transform .34s cubic-bezier(.2,.72,.24,1),opacity .22s ease-out';
      fig.style.transform = 'none';
      fig.style.opacity = '1';
    });
  }

  /* ================= 八点六、足迹总览 ================= */

  function statsView() {
    const s = T.summary(ST.data.trips || [], ST.ctx());
    const big = (n, label) => h('div', { class: 'big' }, [
      h('div', { class: 'big-n', text: n }), h('div', { class: 'big-l', text: label })
    ]);
    // 一行 = 一个条：宽度按占比现算，条本身是手绘的
    const barRow = (label, val, max, note, seed) => h('div', { class: 'bar-row' }, [
      h('span', { class: 'bar-k', text: label }),
      h('div', { class: 'bar', 'data-frame': 'bar',
        'data-pct': max ? Math.max(3, Math.round(val / max * 100)) : 0, 'data-seed': seed }),
      h('span', { class: 'bar-v', text: note })
    ]);

    const yMax = Math.max.apply(null, s.byYear.map(y => y.spend).concat([1]));
    const cMax = s.byCat.length ? s.byCat[0].amount : 1;

    return h('div', { class: 'view' }, [
      topbar('足迹总览'),
      h('div', { class: 'editor' }, [
        h('h3', { text: '一共走了多少' }),
        h('div', { class: 'bigs' }, [
          big(s.done.length, '趟已旅行'),
          big(s.plan.length, '趟待出行'),
          big(s.days, '天在路上'),
          big(s.atlas.cities.length, '座城市'),
          big(T.fmtMoney(s.atlas.kmFlown), '公里已飞'),
          big(s.photos, '张照片')
        ]),
        h('div', { class: 'echo', text: (s.ongoing.length ? '正在路上 ' + s.ongoing.length + ' 趟　·　' : '')
          + '已花 ' + money(s.spend) + '　·　待出行预算 '
          + money(s.budgetPlanned) + '　·　计划中还有 ' + T.fmtMoney(s.atlas.km - s.atlas.kmFlown)
          + ' 公里要飞' })
      ]),
      s.next ? h('div', { class: 'editor' }, [
        h('h3', { text: '下一趟' }),
        tappable(h('div', { class: 'money-cat' }, [
          h('span', { text: (s.next.trip.title || '未命名') + '　' + s.next.view.dateLabel }),
          h('b', { text: s.next.countdown > 0 ? '还有 ' + s.next.countdown + ' 天' : '就要走了' })
        ]), () => go('#/trip/' + s.next.trip.id))
      ]) : null,
      s.byYear.length ? h('div', { class: 'editor' }, [
        h('h3', { text: '按年份' }),
        ...s.byYear.map(y => barRow(String(y.year), y.spend, yMax,
          y.trips + ' 趟 · ' + y.days + ' 天 · ' + money(y.spend), K.seedOf(31, String(y.year))))
      ]) : null,
      s.byCat.length ? h('div', { class: 'editor' }, [
        h('h3', { text: '钱花在哪儿了（全部旅行合计）' }),
        ...s.byCat.map(c => barRow(c.category, c.amount, cMax,
          money(c.amount) + ' · ' + Math.round(c.amount / s.spend * 100) + '%',
          K.seedOf(37, c.category)))
      ]) : null
    ]);
  }

  /* ================= 八点六、案例页（§4.8 about）=================
     这一页讲技术不讲行程（M6）。上面那些数字一律现算 —— 一页专门用来说
     「数字只有一处出处」的页面，自己再抄一份就说不过去了。 */

  function aboutView() {
    const trips = ST.data.trips || [];
    const s = T.summary(trips, ST.ctx());
    const entries = trips.reduce((n, t) => n + (t.entries || []).length, 0);
    const glyphs = Object.keys(root.HANDTYPE_GLYPH || {}).length;
    const places = Object.keys(ST.data.places || {}).length;

    const p = txt => h('p', { class: 'about-p', text: txt });
    const big = (n, label) => h('div', { class: 'big' }, [
      h('div', { class: 'big-n', text: n }), h('div', { class: 'big-l', text: label })
    ]);
    // 一条 = 一件事：左边说做了什么，右边是这件事此刻的实际数字
    const line = (k, v) => h('div', { class: 'money-cat' }, [
      h('span', { text: k }), h('b', { text: v })
    ]);
    const point = (no, title, txt) => h('div', { class: 'about-pt' }, [
      h('div', { class: 'about-no', text: no }),
      h('div', {}, [h('div', { class: 'about-t', text: title }), p(txt)])
    ]);

    return h('div', { class: 'view about' }, [
      topbar('这本手帐怎么做的'),
      h('div', { class: 'editor' }, [
        h('h3', { text: '一句话' }),
        p('一个手帐式的旅行记录本：原生 HTML/CSS/JS，没有框架、没有打包器、没有后端，'
          + '双击 index.html 就能用。纸、墨、胶带负责「像手帐」，栈式路由和可滚动的长页面'
          + '负责「像 app」。'),
        h('div', { class: 'bigs' }, [
          big(trips.length, '趟旅行'),
          big(entries, '条记录'),
          big(s.atlas.routes.length, '段航线'),
          big(s.atlas.cities.length, '座城市'),
          big(glyphs, '个字形轮廓'),
          big(places, '条坐标表')
        ]),
        h('div', { class: 'echo', text: '这六个数字都是打开这一页时现算的。' })
      ]),
      h('div', { class: 'editor' }, [
        h('h3', { text: '三处有技术含量的地方' }),
        point('1', '手绘渲染管线',
          '构建时用 fontTools 抽出字形轮廓（handtype.js），运行时交给 rough.js 描边 —— '
          + '标题的笔画本身在抖，不是把整个字当一块砖随机旋转。'
          + '同一支笔画地图海岸线、插图、卡片框和标题，换一支笔（reseed）整页笔迹一起换。'
          + '字库里没有轮廓的字自动退回普通文字渲染，加新文案不会缺字。'),
        point('2', '确定性渲染',
          '手绘要「看着随机」但必须「每次一样」，否则没法导出也没法测。'
          + 'seed 存在数据里，seedOf(base, key) 派生每个元素的子种子，随机数是 mulberry32 —— '
          + '同数据同 seed 得到逐字节相同的 SVG。测试里就是渲染两遍比对序列化结果。'),
        point('3', '分层：内核不认识「旅行」',
          'kernel.js 只管时间、汇率、汇总、seed；trip.js 是旅行皮肤，认识 leg / place / '
          + 'spend / stay / note / photo，只决定「算什么、放哪个盒子」，不吐一行 SVG；'
          + 'sketch.js 把 data-frame / data-art 变成手绘线。'
          + '所以换成小程序 canvas 2d 时，前两层白拿。')
      ]),
      h('div', { class: 'editor' }, [
        h('h3', { text: '数字只有一处出处' }),
        h('div', { class: 'tip', text: '页面自己不许算 —— 三处数字对不上，一眼就知道是哪层错了。' }),
        line('卡片 / 书架 ← derive()', s.done.length + ' 趟已旅行 · ' + s.plan.length + ' 趟待出行'),
        line('地图 #/map ← atlas()', s.atlas.flownCount + ' 段已飞 · ' + s.atlas.planCount + ' 段计划'),
        line('足迹 #/stats ← summary()', T.fmtMoney(s.atlas.kmFlown) + ' 公里 · ' + money(s.spend)),
        line('状态 ← statusOf(trip, now)',
          s.ongoing.length ? '正在路上 ' + s.ongoing.length + ' 趟' : '按日期自动推进'),
        h('div', { class: 'echo', text: '改一笔花销、加一段航线，这四行立刻跟着变。' })
      ]),
      h('div', { class: 'editor' }, [
        h('h3', { text: '约束逼出来的选择' }),
        p('要能双击打开、要能发一个文件给别人，所以：pushState 在 file:// 下直接抛异常 → '
          + 'hash 路由；字体 base64 内联；数据靠一个普通 script 标签挂成 window.DATA，不走 fetch。'
          + '用 SVG 不用 canvas，是因为要能导出、能选中文字、能用 CSS 换色。'),
        p('测试不开浏览器：手写一个 stub DOM，用 vm 依次执行页面里的每个 script，'
          + '然后真的去点、真的去填 —— 填一个预算就断言仓库和卡片上的数字都跟着变。'),
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
    if (r.name === 'map') return mapView(r);
    if (r.name === 'stats') return statsView();
    if (r.name === 'about') return aboutView();
    if (r.name === 'photo') return photoView(r);
    if (r.name === 'card') return cardView(r);
    if (r.name === 'trip') return tripView(r);
    // 宽屏时书架常驻左侧，主列不必再来一份时间轴 —— 但扉页和示例开关放这儿更宽敞
    return wide()
      ? h('div', { class: 'view' }, [
          staleCard(),
          noteOff() ? h('div', { class: 'shelf-head' }, [askBtn()]) : introCard(),
          h('div', { class: 'sec-label', text: '书架' }),
          h('div', { class: 'empty', text: '左边挑一趟点进去。要记新的一趟，也在左边。' }),
          sampleSwitch()
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
    document.body.classList.toggle('at-photo', r.name === 'photo');
    const main = $('main');
    main.textContent = '';
    main.appendChild(el);

    const rail = $('rail-shelf');
    if (rail) {
      rail.textContent = '';
      if (r.name !== 'cover' && wide()) rail.appendChild(shelfView(true));
    }

    // 照片大图和明信片都算「某一趟」的一层，tab 还是停在书架上
    const on = (r.name === 'trip' || r.name === 'photo' || r.name === 'card')
      ? '#/shelf' : '#/' + r.name;
    for (const a of Array.prototype.slice.call($('tabs').getElementsByTagName('a')))
      a.classList.toggle('on', a.getAttribute('href') === on);

    SK.repaint();
    if (root.handtype) root.handtype();
    if (r.name === 'photo') playFlip(el);
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
      if (e.key === 'd') { document.body.classList.toggle('debug'); return; }
      // 看大图时左右键是翻页，不是返回
      const r = parse();
      if (r.name === 'photo' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        photoStep(r, e.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (e.key === 'Escape' || e.key === 'ArrowLeft') back();
    });
  }

  // 右滑返回：只认横向为主的一划，纵向滚动不误触。看大图时左右都是翻页
  function bindSwipe() {
    let x0 = 0, y0 = 0, t0 = 0;
    document.addEventListener('touchstart', e => {
      const p = e.touches[0];
      x0 = p.clientX; y0 = p.clientY; t0 = Date.now();
    }, { passive: true });
    document.addEventListener('touchend', e => {
      const p = e.changedTouches[0];
      const dx = p.clientX - x0, dy = p.clientY - y0;
      if (Math.abs(dx) < 60 || Math.abs(dy) > 40 || Date.now() - t0 >= 600) return;
      const r = parse();
      if (r.name === 'photo') photoStep(r, dx < 0 ? 1 : -1);
      else if (dx > 0) back();
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


