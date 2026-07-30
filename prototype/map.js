/* 手绘世界地图（§4.6）—— 手帐本里的 #/map 用这一份。

   跟 map.html 的关系：那页是调笔的样张（自带国界、简化两个滑块和一份写死的示例航线），
   这份是从它抽出来的正式版，只认调用方传进来的航线。改地图外观改这里，样张不用跟。

   规矩：这一层只画，不知道「旅行」是什么。航线一律由调用方算好后传进来
   （TripView.atlas 干这件事），所以地图上的每一段都对应用户真填的一条 leg，
   查不到坐标的段在这里根本不会出现 —— 名单交给页面去提示，不静默猜。

   笔迹参数直接借 Sketch.S：换一支笔（reseed）时整本手帐连地图一起换。 */
(function (root) {
  'use strict';

  const SK = root.Sketch, S = SK.S, C = SK.C, mk = SK.mk;
  const W = 1040, H = 560;                 // viewBox，实际宽度由 CSS 撑

  function missing() {
    if (!root.rough) return 'vendor/rough.js';
    if (!root.d3 || !root.d3.geoPath) return 'vendor/d3-geo.min.js';
    if (!root.topojson) return 'vendor/topojson-client.min.js';
    if (!root.WORLD_TOPO) return 'data/world-110m.js';
    return null;
  }

  // 地理数据只解一次：topojson.feature 在 110m 上要几十毫秒，别每次重绘都来
  let geo = null;
  function prep() {
    if (geo) return geo;
    const t = root.WORLD_TOPO, tj = root.topojson;
    geo = {
      land: tj.feature(t, t.objects.land),
      borders: tj.mesh(t, t.objects.countries, (a, b) => a !== b),   // 只要内部线
      grat: root.d3.geoGraticule().step([30, 30])()
    };
    return geo;
  }

  /* ---------- 投影结果收成点列，顺便抽稀 ----------
     d3.geoPath 出来的路径点太密（110m 海岸线上万个点），直接丢给 rough.js
     抖动会被平均掉、还慢。所以自己当一次 d3 的 path context，边收边按像素抽稀。 */
  function collector(tol) {
    const rings = [];
    let cur = null, last = null;
    return {
      rings,
      beginPath() {},
      moveTo(x, y) { cur = [[x, y]]; rings.push(cur); last = [x, y]; },
      lineTo(x, y) {
        if (!cur) return;
        if (Math.abs(x - last[0]) + Math.abs(y - last[1]) >= tol) { cur.push([x, y]); last = [x, y]; }
      },
      closePath() { if (cur && cur.length > 2) cur.closed = true; },
      arc() {}
    };
  }

  // 点列 -> path 字符串；顺手丢掉太小的岛，不然全是碎点
  function ringsToPath(rings, minPts, minSpan) {
    let d = '';
    for (const r of rings) {
      if (r.length < (minPts || 3)) continue;
      if (minSpan) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const p of r) {
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1];
          if (p[1] > y1) y1 = p[1];
        }
        if (Math.max(x1 - x0, y1 - y0) < minSpan) continue;
      }
      d += 'M' + r.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L');
      if (r.closed) d += 'Z';
    }
    return d;
  }

  function geoToPath(proj, json, tol, minPts, minSpan) {
    const col = collector(tol);
    root.d3.geoPath(proj, col)(json);
    return ringsToPath(col.rings, minPts, minSpan);
  }

  /* ---------- 投影 ---------- */
  function projection(view, rot) {
    const d3 = root.d3;
    if (view === 'globe') {
      return d3.geoOrthographic().rotate(rot)
        .fitExtent([[46, 26], [W - 46, H - 26]], { type: 'Sphere' });
    }
    // 中心放 160°E：分割线落在 20°W 的大西洋上，不切断任何大陆
    return d3.geoEquirectangular().rotate([-160, 0])
      .fitExtent([[14, 14], [W - 14, H - 14]], { type: 'Sphere' });
  }

  /* 摊平视图的航线：向上拱的二次贝塞尔，航空公司地图的经典画法，比真大圆好看 */
  function arcFlat(p0, p1) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    const k = 0.22 * len;                                     // 拱高
    const cx = mx - dy / len * k, cy = my + dx / len * k;
    return {
      d: 'M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1)
         + 'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1)
         + ' ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1),
      mid: [0.25 * p0[0] + 0.5 * cx + 0.25 * p1[0], 0.25 * p0[1] + 0.5 * cy + 0.25 * p1[1]]
    };
  }

  // 地球视图用真正的大圆
  function arcGlobe(proj, a, b, rot) {
    const interp = root.d3.geoInterpolate(a, b), pts = [];
    for (let i = 0; i <= 40; i++) pts.push(interp(i / 40));
    const col = collector(1);
    root.d3.geoPath(proj, col)({ type: 'LineString', coordinates: pts });
    return {
      d: ringsToPath(col.rings, 2, 0),
      mid: visible(a, rot) && visible(b, rot) ? proj(interp(0.5)) : null
    };
  }

  // 地球视图：这个经纬点在正面还是背面
  function visible(ll, rot) {
    return root.d3.geoDistance(ll, [-rot[0], -rot[1]]) < Math.PI / 2 - 0.02;
  }

  /* 地名不抖 —— 抖过的字反而糊 */
  function label(x, y, str, size, fill, font) {
    const t = mk('text');
    t.setAttribute('x', x.toFixed(1));
    t.setAttribute('y', y.toFixed(1));
    t.setAttribute('font-family', (font || 'MarkerGothic') + ', sans-serif');
    t.setAttribute('font-size', size);
    t.setAttribute('fill', fill || C.ink);
    t.textContent = str;
    return t;
  }

  // 小飞机：三笔，按航线方向转
  function planeAt(rc, x, y, deg, color) {
    const g = mk('g');
    g.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1)
      + ') rotate(' + deg.toFixed(1) + ')');
    const o = SK.opts({ fill: 'none', stroke: color, strokeWidth: S.sw * 1.05,
      roughness: S.rough * 0.7, bowing: S.bow * 0.5 }, 4242);
    g.appendChild(rc.path('M-7 0 L7 0', o));
    g.appendChild(rc.path('M-1 0 L-6 -6 M-1 0 L-6 6', o));
    g.appendChild(rc.path('M5 0 L2.5 -2.6 M5 0 L2.5 2.6', o));
    return g;
  }
  /* ---------- 主绘制 ---------- */
  /* st = { view, rot, tol, drag, atlas, onPick }。返回自检用的数字。 */
  function draw(svg, st) {
    const rc = root.rough.svg(svg);
    const g = prep();
    const globe = st.view === 'globe';
    const proj = projection(st.view, st.rot);
    const frag = document.createDocumentFragment();
    const add = n => { if (n) frag.appendChild(n); };
    // 拖着转的时候先要跟手：粗化一档抽稀，松手再画细的
    const tol = st.drag ? Math.max(st.tol, 4.5) : st.tol;

    /* 1. 海 */
    if (globe) {
      const c = proj.translate(), r = proj.scale();
      if (S.color) add(rc.circle(c[0], c[1], r * 2, SK.opts({ fill: '#eef3f4',
        fillStyle: 'solid', stroke: 'none', roughness: S.rough * 1.3 }, 3)));
      add(rc.circle(c[0], c[1], r * 2, SK.opts({ fill: 'none', strokeWidth: S.sw * 1.5 }, 3)));
    } else {
      const b = root.d3.geoPath(proj).bounds({ type: 'Sphere' });
      const w = b[1][0] - b[0][0], h = b[1][1] - b[0][1];
      if (S.color) add(rc.rectangle(b[0][0], b[0][1], w, h, SK.opts({ fill: '#eef3f4',
        fillStyle: 'solid', stroke: 'none', roughness: S.rough * 1.3 }, 3)));
      add(rc.rectangle(b[0][0], b[0][1], w, h,
        SK.opts({ fill: 'none', strokeWidth: S.sw * 1.5 }, 3)));
    }

    /* 2. 经纬线 */
    const gd = geoToPath(proj, g.grat, Math.max(tol, 3), 2, 0);
    if (gd) add(rc.path(gd, SK.opts({ fill: 'none', stroke: '#cddbe0',
      strokeWidth: S.sw * 0.7, roughness: S.rough * 0.8 }, 7)));

    /* 3. 陆地：先平涂（故意画歪、压不住线稿），再描海岸线 */
    const landPath = geoToPath(proj, g.land, tol, 4, 2.5);
    if (S.color && landPath) {
      const n = rc.path(landPath, SK.opts({ fill: C.sand, fillStyle: 'solid',
        stroke: 'none', roughness: S.rough * 1.4 }, 11));
      n.setAttribute('transform', 'translate(1.2,1.4)');
      add(n);
    }
    if (landPath) add(rc.path(landPath, SK.opts({ fill: 'none', strokeWidth: S.sw * 1.15 }, 11)));

    /* 4. 航线：已飞实线、计划虚线。每一段都能点，点了跳去那一趟 */
    let seed = 100, drawn = 0;
    st.atlas.routes.forEach(r => {
      if (!r.fromLL || !r.toLL) return;
      let d, mid, deg = 0;
      if (globe) {
        const a = arcGlobe(proj, r.fromLL, r.toLL, st.rot);
        d = a.d; mid = a.mid;
        if (mid) {
          const it = root.d3.geoInterpolate(r.fromLL, r.toLL);
          const p0 = proj(it(0.46)), p1 = proj(it(0.54));
          deg = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
        }
      } else {
        const p0 = proj(r.fromLL), p1 = proj(r.toLL), a = arcFlat(p0, p1);
        d = a.d; mid = a.mid;
        deg = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
      }
      if (!d) return;
      drawn++;
      const col = r.flown ? C.red : C.ink3;
      add(rc.path(d, SK.opts({ fill: 'none', stroke: col, strokeWidth: S.sw * (r.flown ? 1.25 : 1),
        roughness: S.rough * 0.85, bowing: S.bow * 0.6,
        strokeLineDash: r.flown ? undefined : [6, 5] }, seed += 7)));
      if (mid) add(planeAt(rc, mid[0], mid[1], deg, col));
      add(hit(mk('path'), { d: d, fill: 'none', stroke: '#000', 'stroke-width': 16 },
        r.tripTitle + '　' + r.from + ' → ' + r.to, () => st.onPick(r)));
    });

    /* 5. 城市：圈 + 中文名 + 三字码，也能点。
       东亚这种一堆城市挤在一起的地方，名字会叠成一团糊掉 —— 所以离已经写过名字的
       城市太近就只画圈，名字留给鼠标悬停的 title（热区照旧，点得到）。 */
    const named = [];
    for (const c of st.atlas.cities) {
      if (!c.ll || (globe && !visible(c.ll, st.rot))) continue;
      const p = proj(c.ll);
      if (!p || !isFinite(p[0])) continue;
      const sd = 200 + (c.code.charCodeAt(0) || 0) + c.code.length;
      if (S.color) add(rc.circle(p[0], p[1], 8, SK.opts({ fill: C.yellow,
        fillStyle: 'solid', stroke: 'none', roughness: S.rough * 1.2 }, sd)));
      add(rc.circle(p[0], p[1], 8, SK.opts({ fill: 'none', strokeWidth: S.sw * 1.1,
        roughness: S.rough * 0.9 }, sd)));
      // 名字块大约 52×26 px（中文名一行 + 三字码一行），重叠就让后来的那个只留圈
      if (!named.some(q => Math.abs(q[0] - p[0]) < 52 && Math.abs(q[1] - p[1]) < 26)) {
        named.push(p);
        add(label(p[0] + 8, p[1] - 5, c.name, 13, C.ink));
        const t = label(p[0] + 8, p[1] + 8, c.code, 10, C.ink2, 'SmileySans');
        t.setAttribute('letter-spacing', '.06em');
        add(t);
      }
      add(hit(mk('circle'), { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 15, fill: '#000' },
        c.name + '　去过 ' + c.trips.length + ' 次', () => st.onPick(c)));
    }

    svg.setAttribute('class', 'map' + (globe ? ' globe' : ''));
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.appendChild(frag);
    return { land: (landPath.match(/M/g) || []).length, routes: drawn };
  }

  /* 描边太细点不准，所以每条航线/每座城市再叠一个看不见的粗热区 */
  function hit(el, attrs, title, fn) {
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    el.setAttribute('opacity', '0');
    el.setAttribute('cursor', 'pointer');
    el.addEventListener('click', fn);
    const t = mk('title');
    t.textContent = title;
    el.appendChild(t);
    return el;
  }
  /* ---------- 挂载 ----------
     host 里放一个 <svg>，返回一个手柄：repaint / setView / stats。
     opt = { view, onPick(route|city), onStatus(text) } */
  function mount(host, atlas, opt) {
    const o = opt || {};
    const svg = mk('svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'map');
    host.appendChild(svg);

    const st = {
      view: o.view === 'globe' ? 'globe' : 'flat',
      rot: [-150, -10],            // 地球视图当前旋转；摊平视图用固定投影
      tol: 2, drag: null, atlas: atlas,
      onPick: o.onPick || function () {}
    };

    function repaint() {
      const info = draw(svg, st);
      if (o.onStatus) o.onStatus(status(st, info));
      return info;
    }

    /* 拖着转地球：像素 -> 经纬增量，按当前半径换算 */
    svg.addEventListener('pointerdown', e => {
      if (st.view !== 'globe') return;
      st.drag = { x: e.clientX, y: e.clientY, rot: st.rot.slice() };
      if (svg.setPointerCapture && e.pointerId != null) svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (!st.drag) return;
      const k = 260 / projection(st.view, st.rot).scale() * 0.9;
      st.rot = [st.drag.rot[0] + (e.clientX - st.drag.x) * k,
        Math.max(-85, Math.min(85, st.drag.rot[1] - (e.clientY - st.drag.y) * k))];
      repaint();
    });
    const up = () => { if (st.drag) { st.drag = null; repaint(); } };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);

    return {
      svg, repaint,
      get view() { return st.view; },
      setView(v) { st.view = v === 'globe' ? 'globe' : 'flat'; return repaint(); },
      setAtlas(a) { st.atlas = a; return repaint(); }
    };
  }

  function status(st, info) {
    return (st.view === 'globe'
      ? '正交投影 · 地球（拖动旋转，中心 ' + (-st.rot[0]).toFixed(0) + '°E / '
        + (-st.rot[1]).toFixed(0) + '°N）'
      : '等距圆柱投影 · 世界摊平（分割线在 20°W 的大西洋上，没切开任何大陆）')
      + ' · 陆块 ' + info.land + ' 块';
  }

  /* 图例那两根线也是画的，不是 CSS 边框 */
  function legendLine(host, kind) {
    const svg = mk('svg');
    svg.setAttribute('viewBox', '0 0 34 8');
    svg.setAttribute('class', 'lg-line');
    const rc = root.rough.svg(svg);
    svg.appendChild(rc.path('M1 5 Q17 -1 33 4', SK.opts({ fill: 'none',
      stroke: kind === 'plan' ? C.ink3 : C.red, strokeWidth: S.sw * 1.2,
      roughness: S.rough * 0.8, bowing: S.bow * 0.6,
      strokeLineDash: kind === 'plan' ? [6, 5] : undefined }, 55)));
    while (host.firstChild) host.removeChild(host.firstChild);
    host.appendChild(svg);
    return svg;
  }

  root.MapView = { missing, mount, legendLine, W, H };
})(typeof window !== 'undefined' ? window : globalThis);
