/* 渲染后端抽象 —— docs/需求文档.md §6.1。

   规矩：插图库（ART）和拼贴排版引擎只准调这里的 path / circle / rect / line / text /
   hand / image / group，不许自己 rough.svg()、不许 setAttribute。小程序端没有 DOM 和
   SVG，但手绘算法本身跟渲染器无关（rough 只吐 move / lineTo / bcurveTo + 裸数字），
   所以换 canvas 2d 时只需要再写一份这个文件。

   笔和颜料也放在这一层：「笔多抖」是后端的事，不是版式的事。定稿参数见 §4.5。
   paintFrame / paintTape 留在 sketch.js 里继续用裸 rough —— 它们量的是 DOM 盒子，
   本来就只有 web 有，抽上来只是把耦合换个地方摆。 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const mk = n => document.createElementNS(NS, n);

  const C = {
    ink:'#2f2c26', ink2:'#7d7566', ink3:'#b3a894',
    blue:'#a9c6d6', lblue:'#cfe0e8', green:'#a3bd9a', red:'#e0917a',
    yellow:'#f0cd7f', pink:'#e9bdb0', snow:'#f7f8f6', sand:'#e6dcc6', paper:'#fdfbf5'
  };

  /* 已定稿的手绘参数：手抖 1.2 / 弯曲 1.5 / 笔粗 0.8。调参条改的就是这个对象，
     所以插图、UI 描边、地图、明信片同时换笔。 */
  const S = { rough:1.2, bow:1.5, sw:0.8, color:true, hatch:false, pen:0 };

  function opts(extra, seed, kScale){
    const k = kScale || 1;
    return Object.assign({
      roughness: S.rough,
      bowing: S.bow,
      strokeWidth: S.sw * k,
      stroke: C.ink,
      seed: (seed || 0) + S.pen * 977,
      fill: undefined,
      preserveVertices: false
    }, extra);
  }

  /* 墨线。w = 笔粗倍数（细节线细一点），stroke = 换笔色（远景/纹理用淡墨） */
  function inkOpts(st, k){
    const o = opts({ fill: 'none' }, st.seed, k);
    if (st.stroke) o.stroke = st.stroke;
    if (st.w) o.strokeWidth = S.sw * k * st.w;
    if (st.dash) o.strokeLineDash = st.dash;
    return o;
  }

  /* 色块的抖动要比墨线小得多：rough.js 的 solid 填充是沿「抖过的轮廓」铺色，
     用墨线那档参数会把细长矩形涂成一片叶子，看着像没画准而不是手绘。 */
  function washOpts(st, k){
    return opts({
      fill: st.fill,
      fillStyle: st.keep ? 'solid' : (S.hatch ? 'hachure' : 'solid'),
      fillWeight: S.sw * k * .9,
      hachureGap: 3.6,
      hachureAngle: -41,
      stroke: 'none',
      roughness: S.rough * (S.hatch ? .8 : .45),
      bowing: S.bow * .45
    }, st.seed, k);
  }

  /* 一块画布。opt = {w, h, k, cls, px, id}
       w/h  viewBox 尺寸（省略则不写 viewBox）
       px   额外写 width/height 属性（要序列化成 PNG 的画布得有）
       k    整块画布的笔粗倍数；单次调用还可以再传 st.k
       id   clip() 生成 id 的前缀，同 id 前缀 + 同调用顺序 = 同一份 SVG */
  function svg(opt){
    const o = opt || {};
    const k0 = o.k || 1;
    const node = mk('svg');
    if (o.w != null) node.setAttribute('viewBox', `0 0 ${o.w} ${o.h}`);
    if (o.cls) node.setAttribute('class', o.cls);
    if (o.px) { node.setAttribute('width', o.w); node.setAttribute('height', o.h); }
    if (o.ns) node.setAttribute('xmlns', NS);
    const rc = rough.svg(node);
    let host = node, nClip = 0;
    const put = n => { if (n) host.appendChild(n); return n; };
    const kk = st => (st.k || 1) * k0;

    /* 有 fill 就先铺色（故意错开一点，像蜡笔涂出格），再描边。
       ART 里的一条 item 只会走其中一支；明信片上的贴片两支都要。 */
    function both(st, make){
      const s = st || {};
      const k = kk(s);
      let last = null;
      if (s.fill && (S.color || s.keep)) {
        const n = make(washOpts(s, k));
        if (n && !s.keep) n.setAttribute('transform', 'translate(.6,.8)');
        last = put(n);
      }
      if (s.stroke !== 'none' && (s.stroke || !s.fill)) last = put(make(inkOpts(s, k)));
      return last;
    }

    function text(str, st){
      const s = st || {};
      const t = mk('text');
      t.setAttribute('x', s.x); t.setAttribute('y', s.y);
      t.setAttribute('text-anchor', s.anchor || 'middle');
      t.setAttribute('font-size', s.size);
      t.setAttribute('fill', s.color || C.ink);
      t.setAttribute('font-family', s.family || 'MarkerGothic, sans-serif');
      t.setAttribute('letter-spacing', s.ls == null ? '.5' : s.ls);
      t.textContent = str;
      return put(t);
    }

    /* 手写标题：字形轮廓交给 handtype 描边，不是把字当一块砖。
       handtype(root) 走的是 querySelectorAll，匹配不到 root 自己，所以要套一层壳。
       不折行 —— 折行由调用方按 Draw.handWidth 自己切好，那样才算得出版面。 */
    function hand(str, st){
      const s = st || {};
      const size = s.size || 32, color = s.color || C.ink;
      if (!root.handtype || !root.HANDTYPE_GLYPH)
        return text(str, { x: s.x, y: (s.y || 0) + size * .86, size, color, anchor: 'start' });
      const wrap = document.createElement('div');
      const el = document.createElement('div');
      el.setAttribute('data-hand', '');
      el.setAttribute('data-hand-raw', str);
      el.setAttribute('data-hand-size', size);
      el.setAttribute('data-hand-color', color);
      wrap.appendChild(el);
      root.handtype(wrap);
      const out = el.firstChild;
      if (!out) return null;
      const g = mk('g');
      g.setAttribute('transform', `translate(${fx(s.x || 0)} ${fx(s.y || 0)})`);
      g.appendChild(out);
      return put(g);
    }

    function image(href, x, y, w, h){
      const im = mk('image');
      im.setAttribute('x', x); im.setAttribute('y', y);
      im.setAttribute('width', w); im.setAttribute('height', h);
      im.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      im.setAttribute('href', href);
      if (im.setAttributeNS) im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
      return put(im);
    }

    function group(transform, fn){
      const g = mk('g');
      if (transform) g.setAttribute('transform', transform);
      host.appendChild(g);
      const prev = host;
      host = g;
      try { if (fn) fn(api); } finally { host = prev; }
      return g;
    }

    /* 无障碍/hover 用的文字，跟着当前 group 走 */
    function title(str){
      const t = mk('title');
      t.textContent = str;
      return put(t);
    }

    /* 矩形裁切。id 由调用顺序决定，所以同数据同 seed 仍然是同一份 SVG。 */
    function clip(x, y, w, h){
      const id = (o.id || 'd') + '-c' + (++nClip);
      const cp = mk('clipPath');
      cp.setAttribute('id', id);
      const r = mk('rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', w); r.setAttribute('height', h);
      cp.appendChild(r);
      node.appendChild(cp);
      return 'url(#' + id + ')';
    }

    const api = {
      node,
      path:   (d, st)             => both(st, o2 => rc.path(d, o2)),
      circle: (cx, cy, r, st)     => both(st, o2 => rc.circle(cx, cy, r * 2, o2)),
      rect:   (x, y, w, h, st)    => both(st, o2 => rc.rectangle(x, y, w, h, o2)),
      line:   (x1, y1, x2, y2, st) => put(rc.line(x1, y1, x2, y2, inkOpts(st || {}, kk(st || {})))),
      text, hand, image, group, title, clip,
      add: put
    };
    return api;
  }

  /* 版面算出来的数是浮点，序列化前统一截到 2 位 —— 不然同一份数据换台机器
     可能差在末位，「同 seed 同像素」就不成立了。 */
  function fx(v){ return Math.round(v * 100) / 100; }

  /* transform 字符串。旋转/缩放都以自己的中心为轴，排版引擎只需要给「抖多少」。 */
  function xf(t){
    const p = [];
    if (t.x || t.y) p.push(`translate(${fx(t.x || 0)} ${fx(t.y || 0)})`);
    if (t.rot) p.push(`rotate(${fx(t.rot)} ${fx(t.cx || 0)} ${fx(t.cy || 0)})`);
    if (t.sc && t.sc !== 1) {
      const cx = fx(t.cx || 0), cy = fx(t.cy || 0);
      p.push(`translate(${cx} ${cy}) scale(${fx(t.sc)}) translate(${fx(-cx)} ${fx(-cy)})`);
    }
    return p.join(' ');
  }

  /* 手写标题的宽度，不用真渲染 —— 排版引擎要先量后排。
     跟 handtype 里的推进逻辑必须一致：有轮廓走 g.a，没轮廓按整宽（空格 0.3）。 */
  function handWidth(str, size){
    const G = root.HANDTYPE_GLYPH, s = size || 32, k = s / 100;
    let x = 0;
    for (const ch of str) {
      const g = G && G[ch];
      x += g ? g.a * k : s * (ch === ' ' ? .30 : 1);
    }
    return x;
  }

  root.Draw = { NS, mk, C, S, opts, inkOpts, washOpts, svg, xf, fx, handWidth };
})(typeof window !== 'undefined' ? window : globalThis);
