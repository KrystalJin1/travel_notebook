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
  // bake.js 导出前会先克隆一份再改 xmlns / 塞 <style>，不许动到屏幕上那棵树
  cloneNode(deep) {
    const c = new El(this.nodeName);
    Object.assign(c.attrs, this.attrs);
    c._text = this._text;
    if (deep) for (const k of this.children) c.appendChild(k.cloneNode(true));
    return c;
  }
}

class TextNode {
  constructor(t) { this.nodeName = '#text'; this._text = String(t); this.children = []; this.attrs = Object.create(null); this.parentNode = null; }
  get textContent() { return this._text; }
  get tagName() { return undefined; }
  cloneNode() { return new TextNode(this._text); }
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
    // 立刻执行：页面里的 setTimeout 都是「等排版好了再画一次」（地图的首帧就是），
    // 不跑的话地图这一层在断言里永远是空的
    setTimeout: fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {}, addEventListener() {},
    // 导出那条链要的浏览器零件：base64 编解码 + 序列化器。
    // 序列化直接接快照用的那个 ser()，导出的文本和快照就是同一份东西
    atob: global.atob, btoa: global.btoa,
    XMLSerializer: function () { this.serializeToString = ser; }
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
// 按钮：父容器的 textContent 常跟按钮一模一样，所以只认真的挂了 click 的那一个
const tapped = (root, txt) =>
  all(root).filter(n => n.textContent === txt && n._on && n._on.click)[0] || null;

// 点了以后才知道结果的断言（导出走 Promise）攒在这里，main 等微任务跑完再验
const later = [];

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

  const plan = ST.data.trips.filter(t =>
    TV.statusOf(t, ST.ctx().now) === 'planned')[0];
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

  /* 状态机（§3.2）：planned → ongoing → done 按日期自己走，锁住的不动 */
  const pastTime = { start: '2020-01-01', end: '2020-01-05' };
  ok(TV.statusOf({ status: 'planned', time: pastTime }, ST.ctx().now) === 'done',
    '出发和结束都过去了，应该自己变成已旅行');
  ok(TV.statusOf({ status: 'planned', time: { start: '2099-01-01' } }, ST.ctx().now) === 'planned',
    '还没到出发日就该留在待出行');
  ok(TV.statusOf({ status: 'planned', time: { start: ST.today(-1), end: ST.today(1) } },
    ST.ctx().now) === 'ongoing', '出发了还没回来，应该是旅行中');
  ok(TV.statusOf({ status: 'planned', data: { lockStatus: true }, time: pastTime },
    ST.ctx().now) === 'planned', '锁住的状态不许被日期推走');
  ok(TV.statusOf({ status: 'cancelled', time: pastTime }, ST.ctx().now) === 'cancelled',
    '取消了的行程不许被推成已旅行');

  /* 编辑器里只改日期：不碰状态框，卡片和书架分栏自己跟着换 */
  const statusOfPlan = () => TV.derive(ST.trip(plan.id), ST.ctx()).status;
  const setField = (label, val) => {
    const el = fieldNamed(main, label);
    if (!el) return false;
    el.value = val;
    el._fire('change');
    return true;
  };
  const keepTime = [ST.trip(plan.id).time.start, ST.trip(plan.id).time.end];
  if (ok(!!fieldNamed(main, '状态') && !!fieldNamed(main, '开始'), '编辑器里少了状态 / 开始')) {
    setField('开始', pastTime.start);
    setField('结束', pastTime.end);
    ok(statusOfPlan() === 'done', '日期改到过去，状态机没把它推成已旅行');
    ok(byClass(main, 'stats').length === 1, '推成已旅行之后卡片没换成数字条那一套');

    // 正在走的那趟单独一栏
    setField('开始', ST.today(-1));
    setField('结束', ST.today(1));
    ok(statusOfPlan() === 'ongoing', '出发了还没回来应该是旅行中，实际 ' + statusOfPlan());
    ok(text().indexOf('旅行中') >= 0 && text().indexOf('第 2 天') >= 0,
      '旅行中的卡片上应该写着「旅行中」和今天是第几天');
    nav('#/shelf');
    ok(text().indexOf('旅行中 · NOW') >= 0, '书架上没有「旅行中」这一栏');
    nav('#/trip/' + plan.id + '/edit');

    // 锁回待出行：日期还在今天，但用户说了算
    setField('状态', 'planned');
    ok(statusOfPlan() === 'planned', '锁定之后应该停在待出行');
    ok(!byClass(main, 'stats').length, '锁回待出行之后卡片没换回计划那一套');

    // 交还给日期，日期也放回去 —— 后面的断言还要用这一趟
    setField('状态', 'auto');
    ok(!(ST.trip(plan.id).data || {}).lockStatus, '选了「跟着日期走」就该把锁去掉');
    setField('开始', keepTime[0]);
    setField('结束', keepTime[1]);
    ok(statusOfPlan() === 'planned', '日期放回未来应该回到待出行');
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

  /* 新建的一趟：标题留空，提示走 placeholder。
     写成 value（以前是「新的一趟」）用户点开第一件事是删字 —— 这条断言就是防它回去。 */
  const fresh = ST.data.trips[ST.data.trips.length - 1];
  ok(fresh.title === '', '新建的一趟标题应该是空的，实际「' + fresh.title + '」');
  App.render();
  const ti = fieldNamed(main, '标题');
  if (ok(!!ti, '编辑器里找不到「标题」输入框')) {
    ok(ti.value === '', '新建的一趟，标题框里不该预填文字：「' + ti.value + '」');
    ok(!!ti.attrs.placeholder, '标题框得有占位提示告诉用户填什么');
  }
  ok(text().indexOf('未命名') >= 0, '标题空着的时候，页面上得有「未命名」兜底');
  // 顶栏那个「完成 ✓」太小，编辑器底下还得有个大的出口
  const bigDone = byClass(main, 'done-edit')[0];
  if (ok(!!bigDone, '编辑器底下缺一个明显的「完成」按钮')) {
    bigDone._fire('click');
    ok(env.location.hash === '#/trip/' + fresh.id,
      '点完成应该回这一趟的详情页，实际 ' + env.location.hash);
  }
  // 新填的东西一律留空，不给假默认值
  const bl = ST.blank('spend');
  ok(bl.title === '' && ST.blank('note').body === '' && ST.blank('place').place.name === '',
    'blank() 不该再给「新的一笔」这种假文字');

  // 剩下两个入口不许一点就白屏
  nav('#/map');
  ok(text().indexOf('航线一览') >= 0, '地图页没渲染');

  /* 地图上的线必须来自用户真填的 leg：条数和 atlas 对得上，
     统计数字（段数 / 城市 / 公里 / 趟数）也全是现算的 */
  const at = TV.atlas(ST.data.trips, ST.ctx());
  ok(at.routes.length > 0, 'atlas 一条航线都没算出来');
  ok(byClass(main, 'money-cat').length === at.routes.length,
    '航线一览 ' + byClass(main, 'money-cat').length + ' 行 ≠ atlas ' + at.routes.length + ' 段');
  ok(text().indexOf('已飞 ' + at.flownCount + ' 段') >= 0
    && text().indexOf(at.cities.length + ' 座城市') >= 0
    && text().indexOf(TV.fmtMoney(at.km) + ' 公里') >= 0
    && text().indexOf(ST.data.trips.length + ' 趟') >= 0, '地图页的统计数字不是现算的');
  ok(at.routes.every(r => r.fromLL && r.toLL), '画出来的航线里有查不到坐标的');
  ok(!at.unknown.length || text().indexOf(at.unknown[0]) >= 0,
    '查不到坐标的码应该在页面上列出来，不许静默丢掉');

  // 真地图真画出来了：陆地 + 每段航线 + 每座城市的热区都在 svg 里
  // （stub 的 fragment 不会摊平，所以数整棵子树而不是 svg.children）
  const mapSvg = svgOf(byClass(main, 'map-stage')[0] || new El('div'));
  if (ok(!!mapSvg && all(mapSvg).length > 20, '地图 svg 是空的（依赖没加载？）')) {
    const titles = all(mapSvg).filter(n => n.tagName === 'TITLE').map(n => n.textContent);
    ok(titles.length === at.routes.length + at.cities.length,
      '可点热区 ' + titles.length + ' 个 ≠ 航线 ' + at.routes.length
      + ' + 城市 ' + at.cities.length);
    ok(titles.some(s => s.indexOf(at.routes[0].from + ' → ' + at.routes[0].to) >= 0),
      '航线热区上没有起降码：' + titles.slice(0, 3).join(' / '));
  }

  /* 足迹总览：每个数字都能从 Store 现算出来 */
  nav('#/stats');
  const sm = TV.summary(ST.data.trips, ST.ctx());
  ok(byClass(main, 'big').length === 6, '足迹页应该有 6 个大数字，实际 ' + byClass(main, 'big').length);
  for (const s of [String(sm.done.length), String(sm.days), TV.fmtMoney(sm.atlas.kmFlown),
                   TV.fmtMoney(sm.spend)])
    ok(text().indexOf(s) >= 0, '足迹页上找不到现算出来的「' + s + '」');
  ok(byClass(main, 'bar-row').length === sm.byYear.length + sm.byCat.length,
    '足迹页的条数 ' + byClass(main, 'bar-row').length + ' ≠ 年份 ' + sm.byYear.length
    + ' + 类目 ' + sm.byCat.length);
  ok(byClass(main, 'bar-row').every(r =>
    r.children.some(c => c.attrs['data-pct'] != null)), '有条没算出宽度');

  /* 照片大图：从卡片上的缩略图点进去，左右能翻页，序号跟墙上一致 */
  const withPhoto = ST.data.trips.filter(t =>
    TV.wallPhotos(TV.derive(t, ST.ctx())).length > 1)[0];
  if (ok(!!withPhoto, '示例数据里应该有一趟不止一张照片')) {
    const wall = TV.wallPhotos(TV.derive(withPhoto, ST.ctx()));
    nav('#/trip/' + withPhoto.id);
    const thumbs = document.querySelectorAll('[data-ph]');
    ok(thumbs.length === wall.length,
      '照片墙 ' + thumbs.length + ' 张 ≠ wallPhotos ' + wall.length + ' 张');
    thumbs[1]._fire('click');
    ok(env.location.hash === '#/trip/' + withPhoto.id + '/photo/1',
      '点第二张应该开第 1 号大图，实际 ' + env.location.hash);
    App.render();
    ok(byClass(main, 'lb-fig').length === 1, '大图那一层没渲染出来');
    ok(text().indexOf('2 / ' + wall.length) >= 0, '大图上没显示第几张 / 共几张');
    // 翻页：每一号都得画得出来
    for (let i = 1; i < wall.length; i++) nav('#/trip/' + withPhoto.id + '/photo/' + i);
    ok(byClass(main, 'lb-fig').length === 1, '翻到最后一张大图空了');

    /* 明信片页（§4.7）：详情页有入口、页面画得出那张纸、三个存盘按钮点了不许抛。
       这个环境没有 canvas / Blob，所以「存不出来」是正确结果 ——
       要验的是它把原因写在页面上，而不是静默什么都不发生。 */
    nav('#/trip/' + withPhoto.id);
    const toCard = tapped(main, '做张明信片 →');
    if (ok(!!toCard, '详情页上没有明信片入口')) {
      toCard._fire('click');
      ok(env.location.hash === '#/trip/' + withPhoto.id + '/card',
        '明信片入口没跳对：' + env.location.hash);
    }
    nav('#/trip/' + withPhoto.id + '/card');
    const pc = byClass(main, 'pc')[0];
    if (ok(!!pc && !!svgOf(pc), '明信片页没画出 SVG')) {
      const svg = svgOf(pc);
      ok(svg.getAttribute('viewBox') === '0 0 900 1200',
        '明信片不是 900×1200：' + svg.getAttribute('viewBox'));
      ok(all(svg).length > 200, '明信片几乎是空的：' + all(svg).length + ' 个节点');
    }
    ok(/压字 0　出界 0/.test(text()), '明信片页没把 §7.2 的指标摊出来：' + text().slice(-120));

    // 拿住 echo 这个节点本身：后面还会 nav 去别的页，从 main 里再找就找不到了
    const echo = byClass(main, 'echo')[0];
    for (const label of ['存 SVG', '存 PNG', '存 PDF']) {
      const b = tapped(main, label);
      if (!ok(!!b, '明信片页少了「' + label + '」按钮')) continue;
      b._fire('click');                        // 抛出来就整个测试挂掉，这本身就是断言
      later.push(() => ok(/^存不出来：/.test(echo.textContent),
        label + ' 应该报出失败原因，实际「' + echo.textContent + '」'));
    }

    /* 导出的文本：xml 头 + 命名空间 + 显式尺寸，缺一个栅格器就读不出图。
       clone 一份再改，屏幕上那棵树不许被动过（不然按一次「存」页面就变了）。 */
    const B = ctx.Bake;
    const live = svgOf(byClass(main, 'pc')[0]);
    const before = all(live).length;
    const src = B.svgText(live);
    ok(/^<\?xml/.test(src.text) && src.text.indexOf('xmlns="http://www.w3.org/2000/svg"') > 0,
      '导出的 SVG 没有 xml 头 / 命名空间');
    ok(src.w === 900 && src.h === 1200 && /width="900"/.test(src.text),
      '导出的 SVG 尺寸不对：' + src.w + '×' + src.h);
    ok(src.font === false, '读不到样式表时 font 该报 false，好让页面提示字体换了');
    ok(src.text.length > 50000, '导出的 SVG 内容太少：' + src.text.length + ' 字');
    ok(all(live).length === before, '导出把屏幕上那棵 SVG 改了');

    /* PDF 骨架是手拼的，xref 里写的是字节偏移。JPEG 里必然有 >127 的字节，
       一旦哪天改成按字符数算，这里的偏移就会指不到 obj 上 —— 所以逐条验回去。 */
    const fake = { width: 200, height: 300,
      toDataURL: () => 'data:image/jpeg;base64,'
        + Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0xFF, 0xD9, 0x80, 0xC3]).toString('base64') };
    const bytes = B.pdfBytes(fake, { w: 900, h: 1200 });
    const raw = Buffer.from(bytes).toString('binary');
    ok(/^%PDF-1\.4/.test(raw), 'PDF 头不对：' + raw.slice(0, 12));
    ok(/%%EOF\n$/.test(raw), 'PDF 尾不对');
    ok(raw.indexOf('/MediaBox[0 0 450 600]') > 0, '页面尺寸不是 450×600pt（SVG 单位的一半）');
    ok(raw.indexOf('/Filter/DCTDecode') > 0, 'JPEG 没按 /DCTDecode 挂进去');
    const startxref = +/startxref\n(\d+)/.exec(raw)[1];
    ok(raw.slice(startxref, startxref + 4) === 'xref', 'startxref 指不到 xref 表');
    const offs = raw.slice(startxref).match(/^(\d{10}) 00000 n $/gm) || [];
    ok(offs.length === 5, 'xref 应该有 5 条记录，实际 ' + offs.length);
    offs.forEach((line, i) => {
      const at = +line.slice(0, 10);
      ok(raw.slice(at, at + 8).indexOf((i + 1) + ' 0 obj') === 0,
        '第 ' + (i + 1) + ' 个对象的偏移量指错了：' + JSON.stringify(raw.slice(at, at + 12)));
    });
    ok(B.safe('东京 · 明信片/2026') === '东京-·-明信片-2026', '文件名没清干净：' + B.safe('东京 · 明信片/2026'));
  }

  /* 案例页（M6）：讲技术不讲行程，而且它自己夸的「数字只有一处出处」得当真 ——
     上面那几个大号数字必须跟仓库现算的一致，不许写死在文案里 */
  nav('#/about');
  ok(byClass(main, 'about-pt').length === 3, '案例页应该写着三处技术重点');
  const bigs = byClass(main, 'big-n').map(e => e.textContent);
  const entryTotal = ST.data.trips.reduce((n, t) => n + (t.entries || []).length, 0);
  const sum = TV.summary(ST.data.trips, ST.ctx());
  ok(bigs.indexOf(String(ST.data.trips.length)) >= 0, '案例页上没写现在有几趟旅行');
  ok(bigs.indexOf(String(entryTotal)) >= 0,
    '案例页写的记录数跟仓库对不上，应该是 ' + entryTotal + '，实际 ' + bigs.join('/'));
  ok(bigs.indexOf(String(sum.atlas.routes.length)) >= 0, '案例页写的航线段数跟 atlas() 对不上');
  ok(bigs.indexOf(String(Object.keys(ctx.HANDTYPE_GLYPH || {}).length)) >= 0,
    '案例页写的字形数跟 handtype.js 对不上（handtype.js 得在 app.js 前面加载）');
  ok(text().indexOf('已飞') >= 0 && text().indexOf('公里') >= 0,
    '案例页应该把 atlas() / summary() 的数字摊出来');
  nav('#/debug');
  ok(document.body.classList.contains('debug'), '#debug 没唤出调参条');

  // 路由解析
  ok(App.parse().name === 'shelf', '#debug 应该落在书架上');
  env.location.hash = '#/trip/x/edit';
  ok(App.parse().edit === true, '/edit 没解析成编辑态');
  env.location.hash = '';
  ok(App.parse().name === 'cover', '空 hash 应该是封面');

  // 手绘线：外壳这几页也得有描边和插图，别只有裸 div。
  // 书架上的数字故意不再各自套框（一屏十几个抖动小方框会花），
  // 所以这里只剩「每趟一个外框 + 新建按钮」
  nav('#/shelf');
  const frames = document.querySelectorAll('[data-frame]');
  ok(frames.length >= 3, '书架上的描边宿主太少：' + frames.length);
  ok(!document.querySelectorAll('.strip .chip').length, '书架上的数字又套回手绘框了');
  ok(!frames.filter(f => !f.children.some(c => c.nodeName === 'svg')).length,
    '书架上有框没描上');

  // 新加的三页也一样：框都得描上，插图都得画出来（空 svg 就是渲染事故）
  for (const hash of ['#/map', '#/stats', '#/trip/' + withPhoto.id + '/photo/0']) {
    nav(hash);
    const fs2 = document.querySelectorAll('[data-frame]');
    ok(fs2.length >= 1, hash + ' 上一个手绘框都没有');
    ok(!fs2.filter(f => !f.children.some(c => c.nodeName === 'svg' && c.attrs.class === 'frame'))
      .length, hash + ' 上有框没描上');
    const arts = document.querySelectorAll('[data-art]')
      .filter(a => a.parentNode && a.parentNode !== document.body);
    ok(!arts.filter(a => { const s = svgOf(a); return !s || !s.children.length; }).length,
      hash + ' 上有插图没画出来');
  }
}

/* ==================== 三点六、明信片版面（§4.4 / §7.2） ====================

   四条硬指标逐趟验，不是抽一趟看看：排版引擎里「文字不被遮挡」是结构保证的
   （抖动量按外接框反推、照片长出去先跟文字对一遍），所以这里一旦报出 textHits
   就说明那条结构断了，而不是参数没调好。 */

function checkPostcard() {
  const { document, ctx } = runPage('index.html', shellEnv());
  const { Postcard: PC, Layout: L, TripView: TV, Store: ST } = ctx;
  if (!ok(!!PC && !!L, 'layout.js / postcard.js 没加载')) return;

  const trips = ST.data.trips;
  const cards = trips.map(t => PC.build(TV.derive(t, ST.ctx())));

  // node test-page.js --pc 把四条指标摊出来，调版面参数时看这张表
  if (process.argv.includes('--pc'))
    cards.forEach((c, i) => console.log(
      '  ' + (trips[i].title || trips[i].id).padEnd(16)
      + ' 片 ' + String(c.audit.tiles).padStart(2)
      + ' 照 ' + c.audit.photos
      + ' 行 ' + c.layout.rows
      + ' 压字 ' + c.audit.textHits
      + ' 出界 ' + c.audit.outside
      + ' 重叠 ' + (c.audit.overlap * 100).toFixed(1) + '%'
      + ' 留白 ' + (c.audit.white * 100).toFixed(1) + '%'
      + ' 节点 ' + all(c.node).length));

  cards.forEach((c, i) => {
    const a = c.audit, name = trips[i].title || trips[i].id;
    ok(a.textHits === 0, name + '：文字被压住了 ' + a.textHits + ' 处（§4.4 规则 3 的硬约束）');
    ok(a.outside === 0, name + '：有 ' + a.outside + ' 片掉出画布');
    ok(a.white >= .15 && a.white <= .35,
      name + '：留白 ' + (a.white * 100).toFixed(1) + '%，不在 15%~35% 内');
    // 只有一张照片时没有「照片之间」，这条不成立
    if (a.photos >= 2)
      ok(a.overlap >= .05 && a.overlap <= .20,
        name + '：照片重叠 ' + (a.overlap * 100).toFixed(1) + '%，不在 5%~20% 内');
    ok(all(c.node).length > 60, name + '：明信片画出来几乎是空的（' + all(c.node).length + ' 个节点）');
  });
  ok(cards.some(c => c.audit.photos >= 2), '示例数据里应该有一趟能验出照片重叠');

  // 每种贴片都得有人画：tiles() 声明了 kind，PAINT 里没有就会静默漏一块
  const v0 = TV.derive(trips[0], ST.ctx());
  const kinds = PC.tiles(v0).map(t => t.data.kind);
  ok(kinds.indexOf('title') === 0 && kinds.indexOf('stats') > 0, '贴片清单少了标题 / 数字条');
  ok(new Set(kinds).size >= 5, '贴片种类太少：' + [...new Set(kinds)].join('、'));

  // 同数据 + 同 seed → 同一份 SVG（§4.4 规则 6）。导出和快照都靠这一条
  ok(ser(PC.build(v0).node) === ser(cards[0].node), '同一趟画两次结果不一样 —— seed 没锁住');

  // 换 seed 必须换版面，否则 jitter 根本没接上
  const other = PC.build(v0, {});
  ok(ser(other.node) === ser(cards[0].node), 'opt 为空时不该改变版面');
  const v1 = Object.assign({}, v0, { trip: Object.assign({}, v0.trip, { seed: v0.trip.seed + 7 }) });
  ok(ser(PC.build(v1).node) !== ser(cards[0].node), '换了 seed 版面却一模一样 —— 抖动没生效');

  // 手动覆写（§4.4 规则 5）：写了 layout.pin 的片子引擎不许动
  const pinned = { id: 'p/x', kind: 'photo', cols: 3, ratio: .74, pin: true,
                   layout: { x: 40, y: 60, w: 200, h: 150, rot: 3, z: 999 }, data: {} };
  const res = L.run([pinned, { id: 't', kind: 'text', cols: 6, ratio: .2, data: {} }], { seed: 5 });
  const got = res.items.filter(t => t.id === 'p/x')[0];
  ok(got && got.x === 40 && got.y === 60 && got.w === 200 && got.rot === 3,
    'layout.pin 的坐标被引擎改掉了：' + JSON.stringify(got && { x: got.x, y: got.y, w: got.w }));

  // 空数据不许崩：一趟什么都没记，也得出一张纸
  const empty = PC.build(TV.derive({ id: 'e', title: '', status: 'planned', time: {}, entries: [] },
    ST.ctx()));
  ok(empty.node.children.length > 3, '空行程的明信片画不出来');  ok(empty.audit.textHits === 0, '空行程的明信片也不许压字');

  return { document, cards };
}

/* ==================== 四、导 svg（--svg） ==================== */

function dumpSvg(document, pc) {
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
  (pc && pc.cards || []).forEach((c, i) => {
    fs.writeFileSync(path.join(dir, 'postcard-' + i + '.svg'), ser(c.node) + '\n');
    n++;
  });
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
const pc = checkPostcard();

if (process.argv.includes('--svg')) dumpSvg(doc, pc);

// 导出是异步的（Image.onload / Promise），等微任务跑完再收尾
Promise.resolve().then(() => {
  later.forEach(f => f());
  console.log((nBad ? 'FAIL' : 'OK') + '  ' + nOk + ' 项通过'
    + (nBad ? ' / ' + nBad + ' 项失败' : '')
    + '  ·  ' + Math.round(a.length / 1024) + ' KB 输出  ·  ' + (Date.now() - t0) + ' ms');
  process.exit(nBad ? 1 : 0);
});
