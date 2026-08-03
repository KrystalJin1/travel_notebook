/* 字段级 P / R / F1 打分器（§7.1）。
   为什么要有它：录入这层的质量没法靠「看一眼觉得挺准」判断 —— 加一个词进词表，
   很可能修好三条、弄坏五条，而弄坏的那五条只有用户会看见。所以规则一改就重算一遍分，
   跟 eval/baseline.json 比，降了就 FAIL。门槛跟别的断言一起卡在 node test-page.js 里。

   计分口径（在 parse-cases.json 的 `_` 里也写了一遍）：
   · 只算 `scored` 里那些字段 —— 「错了不一定会被发现」的格子。标题不算。
   · 空值（'' / null / false / 缺字段）一律当「没有这一格」，两边都没有就跳过。
     于是 flown / booked 这种默认 false 的格子不必在每条 want 里都写一遍。
   · 漏一格 = FN，多填或填错 = FP（填错同时算 FN + FP，因为既没给对也给了错的）——
     这就是「漏解析比错解析可接受」（§7.1）在数字上的体现：错一格扣两分。

   浏览器不加载这个文件，只有测试用它，所以直接走 CommonJS。 */
'use strict';

const EMPTY = v => v == null || v === '' || v === false;
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

// 数字按数值比（128.50 和 128.5 是一回事），别的按字符串比
const same = (a, b) => (typeof a === 'number' || typeof b === 'number')
  ? Number(a) === Number(b) : String(a) === String(b);

/* 一对（gold, pred）在 scored 字段上的账。任一边可以是 null（漏了 / 多出来一条）。 */
function tally(gold, pred, scored) {
  const per = {};
  scored.forEach(f => {
    const g = gold ? get(gold, f) : undefined;
    const p = pred ? get(pred, f) : undefined;
    const ge = EMPTY(g), pe = EMPTY(p);
    if (ge && pe) return;                       // 两边都没有 —— 不是题，不计分
    const r = per[f] = { tp: 0, fp: 0, fn: 0, g, p };
    if (!ge && !pe && same(g, p)) { r.tp = 1; return; }
    if (!ge) r.fn = 1;                          // 该有的没给对
    if (!pe) r.fp = 1;                          // 给了不该给的 / 给错了
  });
  return per;
}

/* 把读出来的几条跟标准答案配对。同 type 里挑「对上的格子最多」的那条，
   贪心就够 —— 一条 case 最多三五条 entry，不值得上匈牙利算法。
   配不上的 gold 全算漏（FN），多出来的 pred 全算错（FP）。 */
function align(golds, preds, scored) {
  const used = [], pairs = [];
  golds.forEach(g => {
    let best = -1, bs = -1;
    preds.forEach((p, i) => {
      if (used[i] || p.type !== g.type) return;
      const per = tally(g, p, scored);
      const s = Object.keys(per).reduce((a, f) => a + per[f].tp, 0);
      if (s > bs) { bs = s; best = i; }
    });
    if (best >= 0) { used[best] = 1; pairs.push([g, preds[best]]); }
    else pairs.push([g, null]);
  });
  preds.forEach((p, i) => { if (!used[i]) pairs.push([null, p]); });
  return pairs;
}

const f1of = a => {
  const p = a.tp + a.fp ? a.tp / (a.tp + a.fp) : 0;
  const r = a.tp + a.fn ? a.tp / (a.tp + a.fn) : 0;
  return { tp: a.tp, fp: a.fp, fn: a.fn, p, r, f1: p + r ? 2 * p * r / (p + r) : 0 };
};

/* 跑一遍评测集。parse 是 (input, ctx) => {entries, misses} —— 传函数进来而不是
   直接 require provider.js：换成第四个 provider 也用这一套打分，不用改这个文件。 */
function score(spec, parse, ctx) {
  const scored = spec.scored;
  const F = {}, sum = { tp: 0, fp: 0, fn: 0 };
  const cases = [];

  spec.cases.forEach(c => {
    const r = parse(c.in, Object.assign({}, ctx, spec.ctx)) || {};
    const preds = r.entries || [], got = r.misses || [];
    const diffs = [];

    align(c.want || [], preds, scored).forEach(([g, p]) => {
      const per = tally(g, p, scored);
      Object.keys(per).forEach(f => {
        const a = F[f] || (F[f] = { tp: 0, fp: 0, fn: 0 });
        ['tp', 'fp', 'fn'].forEach(k => { a[k] += per[f][k]; sum[k] += per[f][k]; });
        if (per[f].tp) return;
        diffs.push(f + '：要 ' + JSON.stringify(per[f].g) + '，读到 ' + JSON.stringify(per[f].p));
      });
    });

    // 两条额外契约，不进 F1：看不懂的行数对不对、该标「要人看一眼」的格子标了没
    const lowGot = [];
    preds.forEach(e => ((e.source || {}).low || []).forEach(x => {
      if (lowGot.indexOf(x) < 0) lowGot.push(x);
    }));
    const lowMiss = (c.low || []).filter(x => lowGot.indexOf(x) < 0);
    const missBad = c.misses != null && got.length !== c.misses;

    cases.push({
      id: c.id, diffs, lowMiss, lowGot,
      missWant: c.misses, missGot: got.length, missBad,
      ok: !diffs.length && !lowMiss.length && !missBad
    });
  });

  const fields = {};
  Object.keys(F).sort().forEach(f => { fields[f] = f1of(F[f]); });
  return { n: spec.cases.length, fields, overall: f1of(sum), cases };
}

const pc = x => (x * 100).toFixed(1).padStart(5) + '%';

// --eval 打的那张表。字段一行，末尾整体一行，再把没对上的 case 摊开
function table(res) {
  const out = ['  字段              P      R     F1    (TP/FP/FN)'];
  const row = (k, a) => '  ' + k.padEnd(16) + pc(a.p) + ' ' + pc(a.r) + ' ' + pc(a.f1) +
    '   ' + a.tp + '/' + a.fp + '/' + a.fn;
  Object.keys(res.fields).forEach(f => out.push(row(f, res.fields[f])));
  out.push(row('—— 整体', res.overall));
  res.cases.filter(c => !c.ok).forEach(c => {
    out.push('  · ' + c.id);
    c.diffs.forEach(d => out.push('      ' + d));
    if (c.lowMiss.length) out.push('      没标成要人看一眼：' + c.lowMiss.join('、'));
    if (c.missBad) out.push('      misses 想要 ' + c.missWant + ' 条，实际 ' + c.missGot + ' 条');
  });
  return out.join('\n');
}

/* 回归门槛：跟 baseline.json 比，任何字段的 F1 降了就报出来。
   评测集本身加了 case 会改分母，所以 baseline 里记着 n —— 对不上时先说一句，
   逼人显式重录 baseline，而不是让门槛悄悄失效。 */
function gate(res, base) {
  const bad = [];
  if (!base) return ['没有 eval/baseline.json —— 门槛是空的，等于没卡'];
  if (base.n !== res.n)
    bad.push('评测集从 ' + base.n + ' 条变成 ' + res.n + ' 条，baseline 得重录（分母变了）');
  const drop = (k, now, was) => {
    if (was != null && now < was - 1e-6) bad.push(k + ' 的 F1 从 ' + pc(was).trim() + ' 降到 ' + pc(now).trim());
  };
  drop('整体', res.overall.f1, base.overall);
  Object.keys(res.fields).forEach(f => drop(f, res.fields[f].f1, (base.fields || {})[f]));
  return bad;
}

/* 存 baseline 用的形状：只记 F1，别把 TP/FP/FN 也钉死 —— 那样换一条 case 就得改一片。
   **往下取整**，不是四舍五入：baseline 是一条下限，记成比实测更高的数
   会让下一次一模一样的运行也报「降了」。 */
const floor4 = x => Math.floor(x * 1e4) / 1e4;

// `_` 也写进去：重录一次就把说明冲掉的话，下一个人看到的是一堆没头没尾的小数
const NOTE = 'eval/parse-cases.json 上量出来的分，node test-page.js 会重算一遍，'
  + '任何字段降了就 FAIL。只记 F1，往下取整。改词表 / 改规则之后确认是有意的取舍，'
  + '才 node test-page.js --record 重录。n 是评测集条数 —— 加了 case 分母就变了，'
  + '必须显式重录，不许让门槛悄悄失效。';

function snapshot(res) {
  const fields = {};
  Object.keys(res.fields).forEach(f => { fields[f] = floor4(res.fields[f].f1); });
  return { _: NOTE, n: res.n, overall: floor4(res.overall.f1), fields };
}

module.exports = { score, table, gate, snapshot, tally, align, get };
