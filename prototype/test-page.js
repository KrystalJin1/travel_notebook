#!/usr/bin/env node
/* 无浏览器跑整页 + 断言。docs/需求文档.md §7.3 说的「渲染回归」就是这条链。

     node test-page.js            # 跑断言
     node test-page.js --svg      # 顺便把每张插图导成 /tmp/art/*.svg，好转 png 肉眼看

   两页都跑：hand-drawn.html（风格样张）和 index.html（手帐本外壳 §4.8）。
   做法：手写一个够用的 stub DOM（真 jsdom 太重，而且这两页只用到十几个 API），
   把 <script> 依次执行，然后检查画出来的东西 —— 外壳那页还会点几下、填几个数字。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HERE = __dirname;

/* ==================== 一、够用的 stub DOM ==================== */

const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

class El {
  constructor(name) {
    this.nodeName = name;
    this.attrs = Object.create(null);
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this._text = '';
    this._on = Object.create(null);          // 记下监听器，好在断言里点一下
    this.value = '';
    this.checked = false;
    // 版式量不出来（没有排版引擎），给个固定尺寸，让 paintFrame 有东西可画
    this.offsetWidth = 320; this.offsetHeight = 40;
    this.clientWidth = 320; this.clientHeight = 40;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => self.attrs['data-' + kebab(String(k))],
      set: (_, k, v) => { self.attrs['data-' + kebab(String(k))] = String(v); return true; },
      has: (_, k) => ('data-' + kebab(String(k))) in self.attrs
    });
    this.classList = {
      _list: () => (self.attrs.class || '').split(/\s+/).filter(Boolean),
      _save(l) { self.attrs.class = l.join(' '); },
      contains(c) { return this._list().indexOf(c) >= 0; },
      add(c) { const l = this._list(); if (l.indexOf(c) < 0) l.push(c); this._save(l); },
      remove(c) { this._save(this._list().filter(x => x !== c)); },
      toggle(c, force) {
        const has = this.contains(c);
        const want = force === undefined ? !has : !!force;
        if (want) this.add(c); else this.remove(c);
        return want;
      }
    };
  }
  get tagName() { return this.nodeName.toUpperCase(); }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'value') this.value = String(v);
    if (k === 'checked') this.checked = true;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  get textContent() {
    return this._text + this.children.map(c => c.textContent).join('');
  }
  set textContent(v) { this.children.forEach(c => (c.parentNode = null)); this.children = []; this._text = String(v); }
  addEventListener(type, fn) { (this._on[type] = this._on[type] || []).push(fn); }
  _fire(type, ev) {
    for (const fn of this._on[type] || []) fn(Object.assign({ target: this }, ev));
    return this;
  }
  getElementsByTagName(name) {
    const up = String(name).toUpperCase(), out = [];
    (function w(n) { n.children.forEach(c => { if (c.tagName === up) out.push(c); w(c); }); })(this);
    return out;
  }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, width: this.offsetWidth, height: this.offsetHeight }; }
  closest() { return null; }
  // 只支持 [attr] 这一种选择器 —— 这页只用得到它
  querySelectorAll(sel) {
    const m = /^\[([\w-]+)\]$/.exec(sel);
    const out = [];
    const walk = n => {
      if (m && m[1] in n.attrs) out.push(n);
      n.children.forEach(walk);
    };
    this.children.forEach(walk);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

class TextNode {
  constructor(t) { this.nodeName = '#text'; this._text = String(t); this.children = []; this.attrs = Object.create(null); this.parentNode = null; }
  get textContent() { return this._text; }
  get tagName() { return undefined; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

function makeDocument(shell) {
  const root = new El('html');
  const body = new El('body');
  root.appendChild(body);
  const ids = Object.create(null);
  // 控制面板那几个控件不在 body 里也没关系，bind() 只要拿到对象
  for (const id of ['c-rough', 'c-bow', 'c-sw', 'c-color', 'c-hatch', 'c-seed',
                    'v-rough', 'v-bow', 'v-sw', 'dbg']) {
    const el = new El('input');
    el.id = id;
    el.type = /^c-(color|hatch)$/.test(id) ? 'checkbox' : 'range';
    el.checked = id === 'c-color';                // 跟 hand-drawn.html 的默认值一致
    el.value = { 'c-rough': 1.2, 'c-bow': 1.5, 'c-sw': 0.8 }[id] || 1;
    ids[id] = el;
  }

  // stub 不解析 HTML 静态标签，所以两页各自的挂载点在这里手工登记
  if (shell) {
    for (const id of ['main', 'rail-shelf']) {
      const el = new El(id === 'main' ? 'main' : 'div');
      el.id = id;
      ids[id] = el;
      body.appendChild(el);
    }
    const tabs = new El('nav');
    tabs.id = 'tabs';
    for (const href of ['#/shelf', '#/map', '#/about']) {
      const a = new El('a');
      a.setAttribute('href', href);
      tabs.appendChild(a);
    }
    ids.tabs = tabs;
    body.appendChild(tabs);
  } else {
    const cards = new El('div');
    cards.id = 'cards';
    cards.setAttribute('class', 'grid');
    ids.cards = cards;
    body.appendChild(cards);
  }

  return {
    documentElement: root, body,
    createElement: n => new El(n),
    createElementNS: (ns, n) => new El(n),
    createTextNode: t => new TextNode(t),
    createDocumentFragment: () => new El('#fragment'),
    getElementById: id => ids[id] || null,
    querySelectorAll: sel => root.querySelectorAll(sel),
    querySelector: sel => root.querySelector(sel),
    addEventListener() {},
    readyState: 'complete',
    fonts: null,
    _ids: ids
  };
}

/* ==================== 二、把 hand-drawn.html 跑起来 ==================== */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ser(n) {
  if (n.nodeName === '#text') return esc(n._text);
  const a = Object.keys(n.attrs).sort()
    .map(k => ' ' + k + '="' + esc(n.attrs[k]) + '"').join('');
  return '<' + n.nodeName + a + '>' + esc(n._text)
    + n.children.map(ser).join('') + '</' + n.nodeName + '>';
}

// 全部节点 / 按 class 找 —— stub 的 querySelectorAll 只认 [attr]，这里补两个够用的
const all = root => { const o = []; (function w(n) { o.push(n); n.children.forEach(w); })(root); return o; };
const byClass = (root, c) =>
  all(root).filter(n => (n.attrs.class || '').split(/\s+/).indexOf(c) >= 0);
const svgOf = el => el.children.filter(c => c.nodeName === 'svg')[0] || null;

// 按文档顺序取出 <script>：带 src 的读文件，内联的直接用
function scriptsOf(page) {
  const html = fs.readFileSync(path.join(HERE, page), 'utf8');
  const out = [], re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const src = /\bsrc\s*=\s*"([^"]+)"/.exec(m[1]);
    out.push(src
      ? { name: src[1], code: fs.readFileSync(path.join(HERE, src[1]), 'utf8') }
      : { name: page + ':inline@' + m.index, code: m[2] });
  }
  return out;
}

function runPage(page, extra) {
  const document = makeDocument(page === 'index.html');
  const ctx = vm.createContext(Object.assign({
    document, console,
    // handtype 用它取字号/颜色；stub 量不出版式，给个固定值
    getComputedStyle: () => ({ fontSize: '32px', color: '#2f2c26', lineHeight: '' }),
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {}
  }, extra || {}));
  ctx.window = ctx.self = ctx;      // rough.js / kernel.js / trip.js 都挂在 window 上
  for (const s of scriptsOf(page))
    vm.runInContext(s.code, ctx, { filename: s.name });
  return { document, ctx };
}

/* 外壳那页要的浏览器零件：hash、断点、本机存储。都给最小可用的版本 */
function shellEnv() {
  const store = Object.create(null);
  return {
    location: { hash: '' },
    history: { length: 1, back() {} },
    matchMedia: () => ({ matches: false }),          // 默认按手机窄屏跑
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    confirm: () => true,
    scrollTo() {},
    scrollY: 0
  };
}

/* ==================== 三、断言 ==================== */

let nOk = 0, nBad = 0;
function ok(cond, msg) {
  if (cond) { nOk++; return true; }
  nBad++; console.log('  FAIL  ' + msg);
  return false;
}

function check() {
  const { document } = runPage('hand-drawn.html');
  const body = document.body;
  // handtype 会把标题文字换成字形轮廓，原文留在 data-hand-raw 里（§5 可访问性）
  const text = body.textContent + ' '
    + all(body).map(n => n.attrs['data-hand-raw'] || '').join(' ');

  const dbg = document.getElementById('dbg').textContent;
  ok(dbg.indexOf('⚠') < 0, '自检面板报错：' + dbg);
  ok(/^rough=/.test(dbg), '#dbg 状态不对：' + dbg);

  const cards = document.getElementById('cards');
  ok(cards.children.length === 2, '应该有 2 张卡片，实际 ' + cards.children.length);

  // 插图：每个宿主都得拿到一张非空 svg
  const arts = document.querySelectorAll('[data-art]');
  ok(arts.length >= 10, '插图宿主太少：' + arts.length);
  const blank = arts.filter(a => { const s = svgOf(a); return !s || !s.children.length; });
  ok(!blank.length, '这些插图没画出东西：' + blank.map(a => a.attrs['data-art']).join('、'));
  const unknown = arts.filter(a => /^\?/.test(a.textContent));
  ok(!unknown.length, 'ART 里查不到：' + unknown.map(a => a.attrs['data-art']).join('、'));

  // 手绘描边：offsetWidth 量成 0 的话这里会空，正好挡住排版事故
  const frames = document.querySelectorAll('[data-frame]');
  ok(frames.length >= 15, '描边宿主太少：' + frames.length);
  const bare = frames.filter(f =>
    !f.children.some(c => c.nodeName === 'svg' && c.attrs.class === 'frame'));
  ok(!bare.length, '这些框没描上：' + bare.map(f => f.attrs['data-frame']).join('、'));
  ok(document.querySelectorAll('[data-tape]').every(t => svgOf(t)), '胶带没画出来');

  // 标题手写。注意 stub 不解析 HTML 里的静态标签，这里只能看到卡片渲染出来的部分
  const hands = document.querySelectorAll('[data-hand]');
  ok(hands.length === 2, '两张卡片的标题都该走手写，实际 ' + hands.length);
  ok(hands.every(el => el.attrs['data-hand-raw'] && svgOf(el) && svgOf(el).children.length),
    '有标题没渲染成字形');

  // 折算出来的数字（不是硬编码）—— 改了 data/trips.json 这里就该跟着改
  for (const s of ['东京', '京都', '6 天', '3 个城市', '3 张照片', '8,640', '3,552',
                   'SHA → HND', 'MU523', '筑地场外市场',
                   '想去清单 7 个 · 已定位 5 个', '已订 2 晚，剩 1 晚待定',
                   '日程 2 / 4 天已排'])
    ok(text.indexOf(s) >= 0, '页面上找不到「' + s + '」');
  ok(/距出发还有 \d+ 天/.test(text), '待出行卡片没有倒计时');
  ok(text.indexOf('这趟最喜欢的半小时') >= 0 && byClass(body, 'note')[0].children
      .some(c => c.nodeName === 'em'), '手写笔记的 **强调** 没变成 <em>');

  // 逐日行程 6 行，超过 5 行的折起来
  ok(byClass(body, 'day-row').length === 6, '逐日行程应该 6 行，实际 ' + byClass(body, 'day-row').length);
  ok(byClass(body, 'folded').length === 1, '第 6 行应该折起来');
  const tog = byClass(body, 'fold-toggle')[0];
  ok(tog && tog.textContent === '还有 1 天 ↓', '折叠按钮文案：' + (tog && tog.textContent));

  return document;
}

/* ==================== 三点五、外壳那页（§4.8） ==================== */

// 按标签文字找输入框：field() 生成的是 <label>文字 + 控件</label>
function fieldNamed(root, label) {
  for (const l of all(root)) {
    if (l.tagName !== 'LABEL' || l.textContent.indexOf(label) !== 0) continue;
    const el = l.children.filter(c => /^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName))[0];
    if (el) return el;
  }
  return null;
}

const labeled = (root, txt) => all(root).filter(n => n.textContent === txt)[0] || null;

function checkShell() {
  const env = shellEnv();
  const { document, ctx } = runPage('index.html', env);
  const App = ctx.App, ST = ctx.Store, TV = ctx.TripView;
  const main = document.getElementById('main');
  const nav = hash => { env.location.hash = hash; App.render(); };
  // handtype 把标题换成字形轮廓，原文在 data-hand-raw（同上面那页）
  const text = () => main.textContent + ' '
    + all(main).map(n => n.attrs['data-hand-raw'] || '').join(' ');

  ok(byClass(main, 'cover').length === 1, '默认应该停在封面');
  ok(text().indexOf('旅行手帐') >= 0, '封面上没有书名');

  nav('#/shelf');
  ok(byClass(main, 'tl-item').length === ST.data.trips.length,
    '时间轴 ' + byClass(main, 'tl-item').length + ' 条 ≠ 旅行 ' + ST.data.trips.length + ' 趟');
  ok(text().indexOf('已旅行 · PAST') >= 0 && text().indexOf('待出行 · PLANNED') >= 0,
    '书架少了分区标题');
  ok(document.getElementById('tabs').getElementsByTagName('a')[0]
    .classList.contains('on'), '书架 tab 没点亮');

  const plan = ST.data.trips.filter(t => t.status === 'planned')[0];
  nav('#/trip/' + plan.id);
  ok(byClass(main, 'card').length === 1, '详情页应该只画这一趟');
  ok(text().indexOf(plan.title) >= 0, '详情页没显示标题：' + plan.title);
  ok(!main.getElementsByTagName('input').length, '没点「编辑」就不该出现输入框');

  nav('#/trip/' + plan.id + '/edit');
  ok(byClass(main, 'editor').length === 1, '编辑页应该有表单');
  ok(main.getElementsByTagName('input').length >= 8,
    '表单控件太少：' + main.getElementsByTagName('input').length);

  // 填一个数字 —— 写回仓库，卡片上的数字跟着变，这就是「可交互填数字」那一条
  const budget = fieldNamed(main, '预算');
  if (ok(!!budget, '找不到「预算」输入框')) {
    budget.value = '12345';
    budget._fire('change');
    ok(ST.trip(plan.id).data.budget === 12345, '预算没写回仓库');
    ok(text().indexOf('12,345') >= 0, '卡片上的预算没跟着变');
  }

  // 加一笔花销：条数 +1，折算总额跟着重算
  const nSpend = () => ST.trip(plan.id).entries.filter(e => e.type === 'spend').length;
  const before = nSpend();
  const addSpend = labeled(main, '＋ 加一笔');
  if (ok(!!addSpend, '找不到「＋ 加一笔」')) {
    addSpend._fire('click');
    ok(nSpend() === before + 1, '加一笔没加上：' + before + ' → ' + nSpend());
    const amount = fieldNamed(main, '金额');
    if (ok(!!amount, '加完之后找不到「金额」输入框')) {
      amount.value = '1000';
      amount._fire('change');
      const v = TV.derive(ST.trip(plan.id), ST.ctx());
      ok(v.paid >= 1000, '花销没算进去：' + v.paid);
      ok(text().indexOf('已支出 ¥' + TV.fmtMoney(v.paid)) >= 0,
        '卡片上的已支出没跟着变，应该是 ' + TV.fmtMoney(v.paid));
    }
  }

  // 改状态就换一套卡片版式（待出行 -> 已旅行）
  const st = fieldNamed(main, '状态');
  if (ok(!!st, '找不到「状态」下拉框')) {
    st.value = 'done';
    st._fire('change');
    ok(byClass(main, 'stats').length === 1, '改成已旅行之后没换成数字条那套卡片');
    st.value = 'planned';
    st._fire('change');
  }

  // 本机改动落到 localStorage，刷新还在
  ok(ST.dirty(), '改完之后 Store.dirty() 应该是 true');

  // 新建一趟：直接进编辑页，不用再找入口
  nav('#/shelf');
  const nTrips = ST.data.trips.length;
  const addTrip = labeled(main, '＋ 记一趟新的');
  if (ok(!!addTrip, '书架上找不到「＋ 记一趟新的」')) {
    addTrip._fire('click');
    ok(ST.data.trips.length === nTrips + 1, '新建没加进仓库');
    ok(/^#\/trip\/.+\/edit$/.test(env.location.hash),
      '新建完应该直接进编辑页，实际 ' + env.location.hash);
  }

  // 剩下两个入口不许一点就白屏
  nav('#/map');
  ok(text().indexOf('航线一览') >= 0, '地图页没渲染');
  nav('#/about');
  ok(text().indexOf('怎么做的') >= 0, '关于页没渲染');
  nav('#/debug');
  ok(document.body.classList.contains('debug'), '#debug 没唤出调参条');

  // 路由解析
  ok(App.parse().name === 'shelf', '#debug 应该落在书架上');
  env.location.hash = '#/trip/x/edit';
  ok(App.parse().edit === true, '/edit 没解析成编辑态');
  env.location.hash = '';
  ok(App.parse().name === 'cover', '空 hash 应该是封面');

  // 手绘线：外壳这几页也得有描边和插图，别只有裸 div
  nav('#/shelf');
  const frames = document.querySelectorAll('[data-frame]');
  ok(frames.length >= 5, '书架上的描边宿主太少：' + frames.length);
  ok(!frames.filter(f => !f.children.some(c => c.nodeName === 'svg')).length,
    '书架上有框没描上');
}

/* ==================== 四、导 svg（--svg） ==================== */

function dumpSvg(document) {
  const dir = '/tmp/art';
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const host of document.querySelectorAll('[data-art]')) {
    const svg = svgOf(host);
    if (!svg) continue;
    const [, , w, h] = (svg.attrs.viewBox || '0 0 100 100').split(/\s+/);
    svg.attrs.xmlns = 'http://www.w3.org/2000/svg';
    svg.attrs.width = w; svg.attrs.height = h;
    fs.writeFileSync(path.join(dir, host.attrs['data-art'] + '.svg'), ser(svg) + '\n');
    n++;
  }
  console.log('导出 ' + n + ' 张到 ' + dir + '（转 png：for f in ' + dir
    + '/*.svg; do cairosvg "$f" -o "${f%.svg}.png"; done）');
}

/* ==================== 五、main ==================== */

const t0 = Date.now();
const doc = check();

// 同 seed 必须出同一张图，否则导出和排版快照都没法做（§4.4 规则 6 / §7.2）
const a = ser(doc.documentElement), b = ser(runPage('hand-drawn.html').document.documentElement);
ok(a === b, '两次渲染结果不一致 —— seed 没锁住');

checkShell();

if (process.argv.includes('--svg')) dumpSvg(doc);

console.log((nBad ? 'FAIL' : 'OK') + '  ' + nOk + ' 项通过'
  + (nBad ? ' / ' + nBad + ' 项失败' : '')
  + '  ·  ' + Math.round(a.length / 1024) + ' KB 输出  ·  ' + (Date.now() - t0) + ' ms');
process.exit(nBad ? 1 : 0);
