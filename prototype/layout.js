/* 拼贴排版引擎 —— docs/需求文档.md §4.4。纯计算：不碰 DOM、不吐一行 SVG。

   输入 Entry 拆好的「贴片」+ 画布尺寸 + seed，输出每片的 {x, y, w, h, rot, z}。
   两条不能破的规矩：
     1. 同数据 + 同 seed → 同版面（导出和快照测试的前提，§4.7 / §7.2）
     2. 文字区域永不被遮挡 —— 不是靠事后检查，是靠结构：抖动量先按外接框反推上限，
        照片只朝照片长，永远越不过半个间距去够文字。

   排法是「两端对齐的行」而不是占位网格：先按重要度分列宽，行高取该行最高的一片，
   再把所有行整体缩放去填满内容框。这样天生没有空洞，留白 ≈ 内边距 + 间距，
   落在 §7.2 要求的 15%~35% 里，不用靠调参去凑。 */
(function (root) {
  'use strict';
  const K = root.Kernel;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fx = v => Math.round(v * 100) / 100;

  const DEF = { w: 900, h: 1200, pad: 44, gap: 20, cols: 6, seed: 1, stretch: 1.7 };

  /* 手抖档位。照片可以歪得看得出来，文字块只给半度 —— 再多就不好读了。
     d = 平移 px，rot = 旋转度，sc = 缩放比例。全部由 seed 决定，没有 Math.random。 */
  const JIT = {
    photo: { d: 3,   rot: 2,  sc: .015 },
    text:  { d: 1.5, rot: .5, sc: 0 },
    tape:  { d: 4,   rot: 6,  sc: 0 },
    clip:  { d: 3,   rot: 8,  sc: 0 }
  };

  /* 旋转后的外接框。版面上所有的「够不够得着」都按这个算，不按原始矩形。 */
  function aabb(t) {
    const a = (t.rot || 0) * Math.PI / 180;
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const w = t.w * c + t.h * s, h = t.w * s + t.h * c;
    return { x: t.x + t.w / 2 - w / 2, y: t.y + t.h / 2 - h / 2, w, h };
  }

  const inter = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  /* 分行：按列预算贪心装，装满就换行。cols = 6 的一片自己占一行。 */
  function toRows(list, budget) {
    const out = [];
    let cur = [], sum = 0;
    for (const t of list) {
      cur.push(t);
      sum += clamp(t.cols || 2, 1, budget);
      if (sum >= budget) { out.push(cur); cur = []; sum = 0; }
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function run(tiles, opt) {
    const o = Object.assign({}, DEF, opt || {});
    const flow = [], pinned = [];
    (tiles || []).forEach(t => (t.pin ? pinned : flow).push(t));

    const contentW = o.w - o.pad * 2;
    const contentH = o.h - o.pad * 2;
    const rows = toRows(flow, o.cols);

    // 列宽：一行里按 cols 权重分，扣掉片间间距
    const rowH = rows.map(row => {
      const cs = row.map(t => clamp(t.cols || 2, 1, o.cols));
      const total = cs.reduce((a, b) => a + b, 0) || 1;
      const inner = contentW - o.gap * (row.length - 1);
      let h = 0;
      row.forEach((t, i) => {
        t._w = inner * cs[i] / total;
        h = Math.max(h, t._w * (t.ratio || .7));
      });
      return h;
    });

    // 整体缩放去填满内容框。只压不硬拉：拉过头会把照片抻变形，宁可底下多留一条白
    const gaps = o.gap * Math.max(0, rows.length - 1);
    const hSum = rowH.reduce((a, b) => a + b, 0) || 1;
    const f = clamp((contentH - gaps) / hSum, 0, o.stretch);
    const used = hSum * f + gaps;

    const items = [];
    let y = o.pad + Math.max(0, contentH - used) / 2;
    rows.forEach((row, ri) => {
      const h = rowH[ri] * f;
      let x = o.pad;
      row.forEach(t => {
        items.push(place(t, { x, y, w: t._w, h }, ri, items.length, o));
        x += t._w + o.gap;
      });
      y += h + o.gap;
    });

    // 手动覆写的片子引擎不动（§4.4 规则 5）。摆坏了 audit 会报出来，这里不替用户做决定
    pinned.forEach((t, i) => items.push(Object.assign({
      id: t.id, kind: t.kind, cols: t.cols, data: t.data, pin: true, row: -1,
      z: t.layout && t.layout.z != null ? t.layout.z : 900 + i,
      rot: 0, x: 0, y: 0, w: 0, h: 0
    }, t.layout)));

    const seams = spread(items, o);
    const deco = decorate(items, seams, o);
    items.sort((a, b) => a.z - b.z);
    items.forEach(t => { t.x = fx(t.x); t.y = fx(t.y); t.w = fx(t.w); t.h = fx(t.h); t.rot = fx(t.rot); });
    deco.forEach(t => { t.x = fx(t.x); t.y = fx(t.y); t.w = fx(t.w); t.rot = fx(t.rot); });
    return { canvas: { w: o.w, h: o.h, pad: o.pad, gap: o.gap }, seed: o.seed, items, deco, rows: rows.length };
  }

  /* 一片：在格子里抖一下。抖完的外接框必须还在「格子 + 半个间距」以内 ——
     所以先算抖动，再按外接框反推能留多大，而不是抖完了再去救。 */
  function place(t, box, ri, idx, o) {
    const r = K.rng(K.seedOf(o.seed, t.id));
    const j = JIT[t.kind] || JIT.text;
    const dx = (r() * 2 - 1) * j.d;
    const dy = (r() * 2 - 1) * j.d;
    const rot = (r() * 2 - 1) * j.rot;
    const sc = 1 + (r() * 2 - 1) * j.sc;

    let w = box.w * sc, h = box.h * sc;
    const roomW = box.w + o.gap - Math.abs(dx) * 2;
    const roomH = box.h + o.gap - Math.abs(dy) * 2;
    const a = Math.abs(rot) * Math.PI / 180;
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const k = Math.min(1, roomW / (w * c + h * s), roomH / (w * s + h * c));
    w *= k; h *= k;

    return {
      id: t.id, kind: t.kind, cols: t.cols, ratio: t.ratio, data: t.data,
      row: ri, box,
      x: box.x + (box.w - w) / 2 + dx,
      y: box.y + (box.h - h) / 2 + dy,
      w, h, rot,
      // 文字一律压在照片和胶带上面，任何时候都读得到
      z: (t.kind === 'text' ? 500 : 0) + idx
    };
  }

  /* 照片之间故意压一点边 —— 这是拼贴的灵魂（§4.4 规则 3）。
     压多少不是拍脑袋：§7.2 要求重叠率落在 5%~20%，而重叠率 ≈ 压边量 / 照片那条边，
     所以压边量定成「相邻那条边的 20%」，两张各朝对方长一半，再补上本来的间距。
     横向相邻按宽算、纵向相邻按高算 —— 用同一个数会让扁照片纵向压得过头。
     一张照片同时压两边时按邻居数摊薄，不然 2×2 的四张会两倍地叠、糊成一片。

     长出来的那条带子先跟所有文字块对一遍，碰到就整对放弃。
     所以「文字不被遮挡」不需要事后修，它长不过去。 */
  function spread(items, o) {
    const ph = items.filter(t => t.kind === 'photo');
    const txt = items.filter(t => t.kind === 'text').map(aabb);
    const near = o.gap * 1.8;

    // 一、先按原始位置找出「谁贴着谁」。挪动之后再找会跟处理顺序有关，不稳
    const pairs = [];
    const nb = new Map(ph.map(t => [t, 0]));
    for (let i = 0; i < ph.length; i++)
      for (let jj = i + 1; jj < ph.length; jj++) {
        const a = ph[i], b = ph[jj];
        const A = aabb(a), B = aabb(b);
        const gapY = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h);
        const gapX = Math.max(A.x, B.x) - Math.min(A.x + A.w, B.x + B.w);
        const overX = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        const overY = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        let axis = null;
        if (overX > 8 && gapY > -o.gap && gapY <= near) axis = 'y';
        else if (overY > 8 && gapX > -o.gap && gapX <= near) axis = 'x';
        if (!axis) continue;
        pairs.push({ a, b, axis });
        nb.set(a, nb.get(a) + 1);
        nb.set(b, nb.get(b) + 1);
      }

    // 二、逐对压边。挪一对就重算一次外接框，间距是当下的，不是一开始的。
    //     真压上了的记成一条「缝」交给 decorate —— 胶带只贴在缝上，不贴对角
    const seams = [];
    for (const p of pairs) {
      const a = p.a, b = p.b;
      const A = aabb(a), B = aabb(b);
      const share = 2 / (nb.get(a) + nb.get(b));
      if (p.axis === 'y') {
        const e = (clamp(.20 * Math.min(a.h, b.h) * share, 12, 72) + o.gap) / 2;
        const gapY = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h);
        const overX = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
        if (overX <= 8 || gapY <= -e) continue;
        const up = A.y < B.y ? a : b, dn = up === a ? b : a;
        const U = aabb(up);
        const band = { x: Math.max(A.x, B.x), y: U.y + U.h - e,
                       w: overX, h: e * 2 + Math.max(0, gapY) };
        if (txt.some(t => inter(band, t) > .5)) continue;
        up.h += e; dn.y -= e; dn.h += e;
        seams.push({ a, b, axis: 'y', x: band.x + band.w / 2, y: U.y + U.h + gapY / 2 });
      } else {
        const e = (clamp(.20 * Math.min(a.w, b.w) * share, 12, 72) + o.gap) / 2;
        const gapX = Math.max(A.x, B.x) - Math.min(A.x + A.w, B.x + B.w);
        const overY = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        if (overY <= 8 || gapX <= -e) continue;
        const lf = A.x < B.x ? a : b, rt = lf === a ? b : a;
        const F = aabb(lf);
        const band = { x: F.x + F.w - e, y: Math.max(A.y, B.y),
                       w: e * 2 + Math.max(0, gapX), h: overY };
        if (txt.some(t => inter(band, t) > .5)) continue;
        lf.w += e; rt.x -= e; rt.w += e;
        seams.push({ a, b, axis: 'x', x: F.x + F.w + gapX / 2, y: band.y + band.h / 2 });
      }
    }
    // 长出去别掉出画布
    items.forEach(t => {
      const b = aabb(t);
      if (b.x < 0) t.x -= b.x;
      if (b.y < 0) t.y -= b.y;
      if (b.x + b.w > o.w) t.x -= b.x + b.w - o.w;
      if (b.y + b.h > o.h) t.y -= b.y + b.h - o.h;
    });
    return seams;
  }

  /* 装饰自动落位（§4.4 规则 4）：胶带贴在照片压边的那条缝上，别针夹在纸角上。
     不手工摆，也不许压到文字 —— 算出来碰上文字就不贴那一条。 */
  function decorate(items, seams, o) {
    const out = [];
    const ph = items.filter(t => t.kind === 'photo');
    const txt = items.filter(t => t.kind === 'text').map(aabb);
    const zTop = 400;                      // 照片之上、文字之下
    const push = (kind, cx, cy, w, key) => {
      const r = K.rng(K.seedOf(o.seed, 'deco/' + key));
      const j = JIT[kind];
      const rot = (r() * 2 - 1) * j.rot;
      const h = kind === 'tape' ? 28 : 34;
      const t = { id: kind + '/' + key, kind, z: zTop + out.length,
                  x: cx - w / 2 + (r() * 2 - 1) * j.d, y: cy - h / 2 + (r() * 2 - 1) * j.d,
                  w, h, rot };
      const b = aabb(t);
      if (txt.some(q => inter(b, q) > .5)) return;
      if (b.x < 2 || b.y < 2 || b.x + b.w > o.w - 2 || b.y + b.h > o.h - 2) return;
      out.push(t);
    };

    /* 只贴 spread() 真压上的那些缝。按「所有相交的照片对」贴会把 2×2 的对角也算进去，
       四张照片能贴出六条胶带 —— 对角那两条压在谁身上都说不清。
       缝的中点按当下位置重算：spread() 末尾把出界的片子拽回来过，记下的旧坐标会偏。 */
    seams.forEach(s => {
      const A = aabb(s.a), B = aabb(s.b);
      if (inter(A, B) < 40) return;
      const x = (Math.max(A.x, B.x) + Math.min(A.x + A.w, B.x + B.w)) / 2;
      const y = (Math.max(A.y, B.y) + Math.min(A.y + A.h, B.y + B.h)) / 2;
      // 横缝上顺着贴长一点，竖缝上横跨过去短一点 —— 胶带只画成横条，不转 90°
      push('tape', x, y, s.axis === 'y' ? 110 : 96, s.a.id + '|' + s.b.id);
    });
    if (ph.length) {                       // 最上面那张照片的外沿也贴一条，像刚按上去
      const top = ph.slice().sort((a, b) => aabb(a).y - aabb(b).y)[0];
      const b = aabb(top);
      push('tape', b.x + b.w * .22, b.y, 104, 'edge/' + top.id);
    }
    push('clip', o.w - o.pad * .7, o.pad * 1.1, 26, 'corner');
    return out;
  }

  /* §7.2 的四条硬指标。留白用 6px 栅格求并集近似 ——
     旋转按外接框算，所以覆盖率略偏高、留白略偏低，宁可报得严一点。 */
  function audit(res) {
    const o = res.canvas;
    const all = res.items.concat(res.deco || []).map(t => ({ t, b: aabb(t) }));
    const txt = all.filter(x => x.t.kind === 'text');
    const ph = all.filter(x => x.t.kind === 'photo');
    let textHits = 0, outside = 0, ov = 0, area = 0;

    all.forEach(({ b }) => {
      if (b.x < -.5 || b.y < -.5 || b.x + b.w > o.w + .5 || b.y + b.h > o.h + .5) outside++;
    });
    all.forEach(x => {
      if (x.t.kind === 'text') return;
      txt.forEach(y => { if (inter(x.b, y.b) > .5) textHits++; });
    });
    ph.forEach((x, i) => {
      area += x.b.w * x.b.h;
      for (let j = i + 1; j < ph.length; j++) ov += inter(x.b, ph[j].b);
    });

    const cell = 6, nx = Math.ceil(o.w / cell), ny = Math.ceil(o.h / cell);
    const grid = new Uint8Array(nx * ny);
    all.forEach(({ b }) => {
      const x0 = Math.max(0, Math.floor(b.x / cell)), x1 = Math.min(nx - 1, Math.floor((b.x + b.w) / cell));
      const y0 = Math.max(0, Math.floor(b.y / cell)), y1 = Math.min(ny - 1, Math.floor((b.y + b.h) / cell));
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) grid[yy * nx + xx] = 1;
    });
    let filled = 0;
    for (let i = 0; i < grid.length; i++) filled += grid[i];

    return {
      textHits, outside, photos: ph.length, tiles: res.items.length,
      overlap: area ? ov / area : 0,
      white: 1 - filled / grid.length
    };
  }

  root.Layout = { run, audit, aabb, inter, DEF, JIT };
})(typeof window !== 'undefined' ? window : globalThis);
