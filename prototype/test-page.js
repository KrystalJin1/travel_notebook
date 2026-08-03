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
  for (const s of ['东京', '纽约 · 库斯科', '6 天', '3 个城市', '3 张照片', '8,640', '3,552',
                   'SHA → HND', 'MU523', '筑地场外市场',
                   '想去清单 5 个 · 已定位 4 个', '已订 6 晚，剩 8 晚待定',
                   '日程 3 / 15 天已排'])
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

  /* 封面是一张贴满东西的书皮，不是一张可跳过的启动页（§4.8）：
     两条胶带 + 一张贴着的相纸 + 三枚贴纸 + 四个数字。
     数字必须跟 summary() 一个来源 —— 封面自己再算一遍，早晚跟足迹总览页对不上。 */
  const cover = byClass(main, 'cover')[0];
  if (cover) {
    const s = TV.summary(ST.data.trips, ST.ctx());
    const cityN = s.atlas.cities.filter(c => c.flown).length;
    const tapes = byClass(cover, 'tape');
    ok(tapes.length >= 2 && tapes.every(t => svgOf(t)), '封面上的胶带没画出来');
    ok(byClass(cover, 'st').length === 3, '封面应该贴三枚贴纸');

    const shot = byClass(cover, 'shot')[0];
    if (ok(!!shot, '封面少了那张贴着的相纸')) {
      const img = all(shot).filter(n => n.attrs['data-art'] || n.nodeName === 'img')[0];
      ok(!!img, '封面相纸里没有图');
      // 封面那张图取最近一趟真填的第一张，不是挑一张写死在代码里
      const first = s.views.map(v => TV.wallPhotos(v)[0]).filter(Boolean)[0];
      const want = first && first.media[0] && first.media[0].path;
      if (img && /^art:/.test(want || '')) {
        ok(img.attrs['data-art'] === want.slice(4),
          '封面该用最近一趟的第一张图 ' + want + '，实际 ' + img.attrs['data-art']);
      }
      // 位图那类（img:kyoto）：贴的必须是 bundle 里内联好的 data: URI，
      // 留成 media/kyoto.jpg 这种相对路径的话单文件导出就裂图（build-data.py 开头那段）
      if (img && /^img:/.test(want || '')) {
        ok(img.nodeName === 'img' && /^data:image\//.test(img.attrs.src || ''),
          '封面那张位图该内联成 data: URI，实际 ' + String(img.attrs.src).slice(0, 40));
      }
      /* 出厂那四趟得让位图一进来就露脸（§4.8 空状态）：封面这张相纸取的是
         「最近一趟已旅行的第一张图」，所以那一趟必须带 img:。改 data/trips.json
         时把带位图的那趟挪走或往前塞一趟纯手绘的，一进来就又只剩矢量插画了 ——
         页面上看不出哪里不对，只会觉得「怎么跟截图不一样」。 */
      ok(/^img:/.test(want || ''), '出厂数据里封面那张该是位图（img:），实际 ' + want);
    }

    const cvn = byClass(cover, 'cvn').map(n => n.textContent);
    if (ok(cvn.length === 4, '封面那排数字应该是四格，实际 ' + cvn.length)) {
      ok(cvn[0] === String(s.done.length) && cvn[1] === String(s.days)
        && cvn[2] === TV.fmtMoney(s.atlas.kmFlown) && cvn[3] === String(cityN),
        '封面数字跟 summary() 对不上：' + cvn.join(' / '));
    }
    ok(!s.next || text().indexOf(s.next.trip.title) >= 0,
      '有待出行的一趟，封面就该报一句「下一趟」');
  }

  nav('#/shelf');
  ok(byClass(main, 'tl-item').length === ST.data.trips.length,
    '时间轴 ' + byClass(main, 'tl-item').length + ' 条 ≠ 旅行 ' + ST.data.trips.length + ' 趟');
  ok(text().indexOf('已旅行 · PAST') >= 0 && text().indexOf('待出行 · PLANNED') >= 0,
    '书架少了分区标题');
  ok(document.getElementById('tabs').getElementsByTagName('a')[0]
    .classList.contains('on'), '书架 tab 没点亮');

  /* 扉页贴纸（§4.8）：第一次进来是展开的，三行说明都在；点「折起」收掉并记住，
     只留右上角一个「?」能叫回来。做成可跳过的启动页就是 PPT 味，所以它必须长在书架上。 */
  if (ok(byClass(main, 'intro').length === 1, '书架顶上应该有一张扉页说明卡')) {
    ok(byClass(main, 'intro-line').length === 3, '扉页说明应该是三行');
    ok(text().indexOf('derive()') >= 0 && text().indexOf('atlas()') >= 0,
      '扉页得说清数字是现算的，不是写死的');
    const fold = tapped(main, '折起 ×');
    if (ok(!!fold, '扉页上找不到「折起」')) {
      fold._fire('click');
      ok(!byClass(main, 'intro').length, '点了折起，扉页还在');
      nav('#/shelf');
      ok(!byClass(main, 'intro').length, '折起来的扉页刷新之后又冒出来了（localStorage 没记住）');
      const ask = tapped(main, '?');
      if (ok(!!ask, '折起来之后书架右上角得留个「?」')) {
        ask._fire('click');
        ok(byClass(main, 'intro').length === 1, '点「?」没把扉页叫回来');
      }
    }
  }

  /* 载入示例 / 清空（§4.8 空状态）：默认只装 2+2，剩下几趟点了才叠进来。
     跟 #/about 那个「恢复示例数据」不是一回事 —— 那个撤回改动，这个是从空本子开始。 */
  const nBase = ST.data.trips.length;
  const nSample = ST.samples().length;
  const keep = JSON.parse(JSON.stringify(ST.data.trips));
  ok(nBase === 4, '默认应该只装 4 趟（2 已旅行 + 2 待出行），实际 ' + nBase);
  ok(nSample >= 1, 'data/samples.json 没打进 bundle');
  const loadBtn = tapped(main, '载入示例 · 另 ' + nSample + ' 趟');
  if (ok(!!loadBtn, '书架上找不到「载入示例」')) {
    loadBtn._fire('click');
    ok(ST.data.trips.length === nBase + nSample,
      '载入示例没叠上：' + nBase + ' → ' + ST.data.trips.length);
    ok(!ST.pending().length, '载完之后不该还剩待载入的示例');
    ok(!tapped(main, '载入示例 · 另 0 趟'), '示例全载完了，按钮该收起来');
    const clear = tapped(main, '清空');
    if (ok(!!clear, '书架上找不到「清空」')) {
      clear._fire('click');
      ok(!ST.data.trips.length, '清空之后仓库里还有行程');
      ok(!byClass(main, 'tl-item').length, '清空之后书架上还有行');
      ok(ST.pending().length === nSample, '清空之后示例应该能再载回来');
    }
  }
  // 后面的断言跑在出厂那四趟上（发出去的就是这一份），所以放回去
  ST.change(d => { d.trips = keep; });

  /* 每条 media 都得解析得出来：art: 要在 ART 库里，img: 要在 bundle 内联的位图表里。
     漏一个在浏览器上就是一个空框，而 build-data.py 只管把 media/*.jpg 扫进来，
     名字对不上它不会报错 —— 所以在这儿咬住（出厂 4 趟 + 示例 10 趟一起查）。 */
  {
    const K2 = ctx.Kernel, imgs = ST.data.images || {};
    const paths = K2.distinct(ST.data.trips.concat(ST.samples())
      .reduce((a, t) => a.concat(K2.allMedia(t.entries || [])), [])
      .map(m => m.path));
    ok(paths.some(p => /^img:/.test(p)), '数据里一条 img: 都没有 —— 位图插画没接上');
    const gone = paths.filter(p => {
      const r = K2.mediaRef(p, imgs);
      return r.missing || (r.art && !ctx.Sketch.ART[r.art]);
    });
    ok(!gone.length, '这些 media 路径解析不出来：' + gone.join('、'));
    // img: 必须是内联的 data: URI，留相对路径的话单文件导出会照旧报「外部依赖 none」却裂图
    const raw = paths.filter(p => /^img:/.test(p)
      && !/^data:image\//.test(K2.mediaRef(p, imgs).src || ''));
    ok(!raw.length, 'img: 没内联成 data: URI：' + raw.join('、'));
  }
  App.render();
  ok(ST.data.trips.length === nBase, '恢复出厂四趟失败');

  /* 出厂数据换了版，本机还存着旧的一份：书架顶上得说一句（§4.8）。
     不说的话，来过一次的人以后打开永远是老数据 —— 新加的行程、换的图一辈子看不到，
     页面上还一点迹象都没有（「刷新了怎么没差别」就是这么来的）。
     两个出口都得在：取新的（丢掉本机改动）/ 留着我的（记下这一版，不再问）。 */
  {
    const KEY = 'travel-notebook/v1';
    ok(!!ctx.DATA.stamp, 'bundle 里少了出厂数据的指纹（build-data.py 的 stamp）');
    nav('#/shelf');
    ok(text().indexOf('出厂那几趟更新了') < 0, '刚存过就说过期 —— 指纹没跟着存进 localStorage');

    // 假装这一份是上一版出厂数据存下来的
    const doctor = () => {
      const raw = JSON.parse(env.localStorage.getItem(KEY));
      raw.stamp = 'old000000000';
      env.localStorage.setItem(KEY, JSON.stringify(raw));
      ST.load(ctx.DATA);
      nav('#/shelf');
    };
    doctor();
    ok(ST.stale(), '指纹对不上，Store.stale() 该是 true');
    ok(text().indexOf('出厂那几趟更新了') >= 0, '出厂数据换了版，书架上没说一句');
    const keepMine = tapped(main, '不用了 · 留着我的');
    if (ok(!!keepMine, '缺「不用了 · 留着我的」这个出口')) {
      keepMine._fire('click');
      ok(!ST.stale(), '点了「不用了」还在报过期');
      ok(text().indexOf('出厂那几趟更新了') < 0, '点了「不用了」，那张卡还挂着');
      nav('#/shelf');
      ok(text().indexOf('出厂那几趟更新了') < 0, '「不用了」没记住 —— 换一页回来又问一遍');
    }
    // 取新的：本机那一份整个丢掉，回到出厂
    doctor();
    ST.change(d => { d.trips = d.trips.slice(0, 1); });   // 先弄成跟出厂不一样
    nav('#/shelf');
    const takeNew = tapped(main, '取新的 · 丢掉本机改动');
    if (ok(!!takeNew, '缺「取新的」这个出口')) {
      takeNew._fire('click');
      ok(ST.data.trips.length === nBase,
        '「取新的」没换回出厂那 ' + nBase + ' 趟，实际 ' + ST.data.trips.length);
      ok(!ST.dirty() && !ST.stale(), '「取新的」之后本机那一份该清掉了');
    }
  }

  const plan = ST.data.trips.filter(t =>
    TV.statusOf(t, ST.ctx().now) === 'planned')[0];
  nav('#/trip/' + plan.id);
  ok(byClass(main, 'card').length === 1, '详情页应该只画这一趟');
  ok(text().indexOf(plan.title) >= 0, '详情页没显示标题：' + plan.title);
  ok(!main.getElementsByTagName('input').length, '没点「编辑」就不该出现输入框');

  /* 待出行也上照片墙（§4.2「想去的样子」）：参考图不是回忆，所以整排淡一档。
     张数必须等于 wallPhotos() 那一份 —— 卡片自己再挑一遍，点开看大图的序号就错位了。 */
  {
    const wall = TV.wallPhotos(TV.derive(plan, ST.ctx()));
    if (ok(wall.length >= 1, '待出行那趟该有照片，否则验不了「想去的样子」')) {
      const wish = byClass(main, 'wish')[0];
      if (ok(!!wish, '待出行卡片少了「想去的样子」那一排')) {
        ok(text().indexOf('想去的样子') >= 0, '「想去的样子」那行小字没写出来');
        ok(byClass(wish, 'ph').length === wall.length,
          '想去的样子 ' + byClass(wish, 'ph').length + ' 张 ≠ wallPhotos ' + wall.length + ' 张');
        ok(byClass(wish, 'photos')[0].classList.contains('plan'),
          '待出行的照片墙该淡一档（.photos.plan）');
      }
    }
  }

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

  /* 照片那一栏（§4.8）：图片能在页面上换，不用去改 JSON。
     选图是**看图选** —— 点行内那张缩略图，摊开这本子里现成的图，点中哪张换哪张。
     文字下拉列 `art:fuji` 这种内部名字，等于让人靠猜（用户反馈：「照片咋都不能选」）。
     自己的图仍然走「贴地址」，三种写法都得填得进去（§3.1）。 */
  const photoEs = () => ST.trip(plan.id).entries.filter(e => e.type === 'photo');
  const path0 = photoEs()[0] && photoEs()[0].media[0].path;
  const nOpt = (ctx.Sketch.SCENES || []).length + Object.keys(ST.data.images || {}).length;
  const cells = () => byClass(main, 'pick-i');
  ok(!byClass(main, 'pick').length, '没点缩略图就不该摊开选图墙（一趟三张就是几十个缩略图）');
  const thumb = byClass(main, 'thumb')[0];
  if (ok(!!thumb, '编辑器少了「照片」那一栏：找不到行内那张缩略图')) {
    thumb._fire('click');
    ok(cells().length === nOpt,
      '选图墙该把 ' + nOpt + ' 张现成的图都摊出来，实际 ' + cells().length + ' 格');
    const arts = cells().filter(c => all(c).some(n => n.attrs['data-art']));
    const imgs = cells().filter(c => all(c).some(n => /^data:image\//.test(n.attrs.src || '')));
    ok(arts.length && imgs.length,
      '选图墙得矢量插画和位图都画出来（不是只列名字）：矢量 ' + arts.length + ' / 位图 ' + imgs.length);
    ok(cells().filter(c => c.classList.contains('on')).length <= 1, '当前那张最多只该高亮一格');

    // 点一格就换：写回 media[0].path，页面当场换，墙自己收起（选完就不该挡着）
    const one = all(arts[0]).filter(n => n.attrs['data-art'])[0].attrs['data-art'];
    ok(!!(arts[0]._on && arts[0]._on.click), '选图墙那几格得真能点');
    arts[0]._fire('click');
    ok(photoEs()[0].media[0].path === 'art:' + one,
      '点选图墙没写回 media[0].path：' + photoEs()[0].media[0].path);
    ok(all(main).some(n => n.attrs['data-art'] === one), '换完图，页面上没换成 ' + one);
    ok(!byClass(main, 'pick').length, '选完一张，选图墙该自己收起来');

    // 贴一个查不到的位图名字：明说缺哪张，不退回随便一张插画（§3.2 一律不猜）
    byClass(main, 'thumb')[0]._fire('click');
    const addr = fieldNamed(main, '贴地址');
    if (ok(!!addr, '照片那一栏少了「贴地址」')) {
      addr.value = 'img:根本没这张';
      addr._fire('change');
      ok(text().indexOf('缺图 根本没这张') >= 0, '查不到的位图名字该写「缺图 xxx」');
      ok(byClass(main, 'danger').some(n => n.textContent.indexOf('缺图') >= 0),
        '缺图那一行该给一句红字说清怎么补');
    }
  }

  /* 加一张 / 换顺序：顺序就是上墙顺序（第一张还兼当封面相纸），
     所以「上移」必须真的换 entries 里的位置，不是只换页面上的样子。 */
  const nPhoto = () => photoEs().length;
  const ids = () => photoEs().map(e => e.id);
  const wasN = nPhoto(), ids0 = ids();
  const addPhoto = labeled(main, '＋ 加一张');
  if (ok(!!addPhoto, '找不到「＋ 加一张」')) {
    addPhoto._fire('click');
    ok(nPhoto() === wasN + 1, '加一张没加上：' + wasN + ' → ' + nPhoto());
    const was = ids();
    const up = labeled(main, '↑ 上移');
    if (ok(!!up, '不止一张的时候该能「上移」')) {
      up._fire('click');
      ok(ids()[0] === was[1] && ids()[1] === was[0],
        '上移没换顺序：' + was.join(',') + ' → ' + ids().join(','));
    }
    // 后面的断言跑在出厂那一份上，所以把这一张和换掉的图收回去
    ST.removeEntry(plan.id, ids().filter(id => ids0.indexOf(id) < 0)[0]);
  }
  if (path0) ST.patchEntry(plan.id, photoEs()[0].id, e => {
    e.media[0].path = path0;
    e.media[0].kind = /^art:/.test(path0) ? 'drawing' : 'image';
  });
  App.render();

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

  /* 查不到坐标就让用户补（§3.2 不静默猜）：
     编辑器一个码给一行，填经纬度或者去 #/map/CODE 点一下，写进本机那层 myPlaces。
     这里连着验四件事：越界不收、补完立刻算出公里数、地图多一条线、刷新还在。 */
  const nRoutes = () => TV.atlas(ST.data.trips, ST.ctx()).routes.length;
  nav('#/trip/' + fresh.id + '/edit');
  const toField = fieldNamed(main, '到');
  if (ok(!!toField, '编辑器里找不到航段的「到」')) {
    toField.value = 'ZZZ';
    toField._fire('change');
    const broken = nRoutes();
    ok(TV.derive(ST.trip(fresh.id), ST.ctx()).unknownCodes.indexOf('ZZZ') >= 0,
      'ZZZ 查不到坐标，却没进 unknownCodes');
    const fix = byClass(main, 'fix')[0];
    if (ok(!!fix, '查不到坐标的码应该给一行补坐标的输入框')) {
      ok(fix.textContent.indexOf('ZZZ') >= 0, '补坐标那行没写是哪个码');
      ok(!!labeled(fix, '在地图上点一下'), '补坐标那行少了「在地图上点一下」');
      const lon = fieldNamed(fix, '经度 E'), lat = fieldNamed(fix, '纬度 N');
      if (ok(!!lon && !!lat, '补坐标那行少了经度 / 纬度')) {
        lat.value = '31.2'; lat._fire('change');
        ok(!ST.places().ZZZ, '只填了纬度就存进去了 —— 缺一半不该收');
        lon.value = '999'; lon._fire('change');
        ok(!ST.places().ZZZ, '经度 999 不在地球上，不该收');
        ok(byClass(main, 'danger').some(n => n.textContent.indexOf('不在地球上') >= 0),
          '填了越界的坐标得当场说一声，不能默默不动');
        lon.value = '121.47'; lon._fire('change');
        ok(!!ST.places().ZZZ && ST.isMine('ZZZ'), '补完的坐标没进 myPlaces');
        ok(!ST.data.places.ZZZ, '用户补的坐标不许写回 data/places.json 那一层');
        const v2 = TV.derive(ST.trip(fresh.id), ST.ctx());
        ok(!v2.unknownCodes.length, '补完坐标之后不该还有查不到的码');
        ok(v2.legs[0].km > 0, '补完坐标这一段就该算得出公里数，实际 ' + v2.legs[0].km);
        ok(nRoutes() === broken + 1, '补完坐标之后地图上该多一条航线');
        // 刷新还在：myPlaces 跟 trips 一起存 localStorage
        ST.load(ctx.DATA); App.render();
        ok(ST.isMine('ZZZ'), '刷新之后自己补的坐标丢了');
      }
    }
  }

  /* 「粘一段，自动认」那一栏（§4.6）：录入这层的产出**先停在待确认区**，
     点了确认才进仓库 —— 全自动一定会读错，而错了用户不一定发现（§7.1）。
     读得准不准由 eval/ 那套 F1 卡（下面三点七），这里卡的是这条契约本身：
     没点确认之前一条都不许落库、取消了勾的那条不许偷偷跟着进去。
     另开一趟干净的：这一段会往仓库里加东西，不该脏到出厂那四趟。 */
  {
    // 页面负责把 File 读成字节（provider 只认字节），所以这层得有个 FileReader
    ctx.FileReader = function () {
      const fire = () => { if (this.onloadend) this.onloadend({ target: this }); };
      this.readAsArrayBuffer = f => { this.result = f._bytes; fire(); };
      this.readAsDataURL = f => {
        this.result = 'data:image/jpeg;base64,' + Buffer.from(f._bytes).toString('base64');
        fire();
      };
    };

    const sid = ST.newTrip();
    ST.patchTrip(sid, tr => { tr.time.start = '2026-03-14'; tr.time.end = '2026-03-20'; });
    nav('#/trip/' + sid + '/edit');
    const ents = () => ST.trip(sid).entries || [];
    const base = ents().length;
    // 待确认的条数 = 「要这条」那几个勾。等一个 class 不如等这个标签，它就是契约本身
    const boxes = () => all(main)
      .filter(n => n.tagName === 'LABEL' && n.textContent.indexOf('要这条') === 0)
      .map(l => l.children.filter(c => c.tagName === 'INPUT')[0]);

    const ta = fieldNamed(main, '粘在这儿');
    if (ok(!!ta, '编辑器少了「粘一段，自动认」那一栏')) {
      ok(!boxes().length, '还没点「认一下」就摊出待确认的条目了');
      ta.value = '3月14日 09:20 SHA MU523 → HND\n'
        + '3月15日 午餐 一乐拉面 JPY 1,200\n'
        + '第 3 天 清水寺\n'
        + '哦对了';
      ta._fire('change');
      const run = tapped(main, '认一下 →');
      if (ok(!!run, '找不到「认一下 →」')) {
        run._fire('click');
        ok(ents().length === base,
          '还没点确认东西就落库了 —— 待确认区就白做了：' + base + ' → ' + ents().length);
        ok(boxes().length === 3, '这四行该读出 3 条，实际 ' + boxes().length);
        ok(text().indexOf('读出 3 条，1 行没看懂') >= 0,
          '待确认区没报「读出几条 · 几行没看懂」');
        ok(text().indexOf('哦对了') >= 0, '看不懂的那一行该原样列出来让人自己看');
        // source.low 是字段路径，摊到界面上必须翻成人话（不能甩 data.flown 给用户）
        ok(text().indexOf('这几格是猜的，过一眼：飞没飞') >= 0,
          'source.low 没翻成人话摊在那一条下面');

        // 取消中间那条（那笔花销）的勾，确认之后它不许跟着落库
        boxes()[1].checked = false;
        boxes()[1]._fire('change');
        const keep = tapped(main, '确认 ✓ 加进这一趟');
        if (ok(!!keep, '找不到「确认 ✓ 加进这一趟」')) {
          keep._fire('click');
          const got = ents().slice(base);
          ok(got.length === 2, '取消了一条，该只落 2 条，实际 ' + got.length);
          ok(!got.some(e => e.type === 'spend'), '取消了勾的那条还是落库了');
          ok(got.every(e => e.id && (e.source || {}).provider === 'text'),
            '落库的条目该带 id 和 source.provider：' + JSON.stringify(got.map(e => e.source)));
          ok(!boxes().length, '确认之后待确认区该清空');
        }
      }
    }

    // 「都不要 ×」：清掉待确认区，一条都不许落库
    const ta2 = fieldNamed(main, '粘在这儿');
    if (ta2) {
      ta2.value = '3月16日 晚餐 居酒屋 JPY 4,000';
      ta2._fire('change');
      tapped(main, '认一下 →')._fire('click');
      const n2 = ents().length;
      ok(boxes().length === 1, '这一行该读出 1 条，实际 ' + boxes().length);
      const drop = tapped(main, '都不要 ×');
      if (ok(!!drop, '找不到「都不要 ×」')) {
        drop._fire('click');
        ok(!boxes().length, '点了「都不要」待确认区还在');
        ok(ents().length === n2, '点了「都不要」反而落库了');
      }
    }

    /* 照片那一路：provider 只认字节，「图存哪儿」是页面的事（dress()）。
       localStorage 只有几 MB，所以超过 300KB 的只留时间和坐标，画面退回默认插画
       并把这一格标成要人看一眼 —— 留一个画不出来的空框才是最糟的那种「错」。 */
    const shots = [
      { name: 'IMG_1.jpg', size: 1000, _bytes: jpegExif('2026:03:15 10:24:00', 135.77, 35.01) },
      { name: 'IMG_2.jpg', size: 400 * 1024, _bytes: jpegExif('2026:03:15 16:02:00', 135.77, 35.01) }
    ];
    const fin = fieldNamed(main, '或者选几张照片（读拍摄时间和坐标）');
    if (ok(!!fin, '编辑器少了「选几张照片」那个入口')) {
      fin.files = shots;
      fin._fire('change');
      const n3 = ents().length;
      ok(boxes().length === 3,
        '同天同地的两张该读出 2 条照片 + 1 条地点（地点按天去重），实际 ' + boxes().length);
      ok(text().indexOf('2026-03-15 10:24') >= 0, '照片那条没把读出来的拍摄时间摊出来');
      ok(text().indexOf('京都') >= 0, 'GPS 135.77/35.01 该反查出京都');
      tapped(main, '确认 ✓ 加进这一趟')._fire('click');
      const ph = ents().filter(e => e.type === 'photo');
      ok(ents().length === n3 + 3, '照片这三条没全落库');
      const mediaOf = nm => (ph.filter(e => (e.media[0] || {}).name === nm)[0]
        || { media: [{}] }).media[0];
      const m1 = mediaOf('IMG_1.jpg'), m2 = mediaOf('IMG_2.jpg');
      ok(/^data:image\//.test(m1.path || '') && m1.kind === 'image',
        '小图该内联成 data: URI 存下来，实际 ' + String(m1.path).slice(0, 24));
      ok(m2.path === '', '超过 300KB 的图不该塞进 localStorage，实际 ' + String(m2.path).slice(0, 24));
      ok(ph.some(e => ((e.source || {}).low || []).indexOf('media') >= 0),
        '接不上原图的那条该标成要人看一眼（low 里得有 media）');
      ok(ents().some(e => e.type === 'place' && (e.source || {}).provider === 'exif'),
        'GPS 反查出来的那条地点没落库，或者 source.provider 盖错了');
    }

    // 这一趟只为验待确认区而开，验完收走 —— 后面的断言跑在出厂那几趟上
    ST.removeTrip(sid);
    App.render();
  }

  // #/map/CODE 是「点图补坐标」模式：顶栏换成取消，地图光标换十字
  nav('#/map/ZZZ');
  ok(text().indexOf('ZZZ') >= 0 && !!tapped(main, '取消 ×'),
    '#/map/CODE 应该进补坐标模式，顶栏给个「取消」');
  const pickSvg = svgOf(byClass(main, 'map-stage')[0] || new El('div'));
  ok(!!pickSvg && /picking/.test(pickSvg.attrs.class || ''),
    '补坐标模式下地图 svg 上应该有 picking（十字光标）');

  /* 点画布的那一下 → 反投影成经纬度。摊平视图中心是 160°E / 0°N（分割线在大西洋上），
     所以点正中央就该拿到这两个数；量不到画布尺寸的时候一律不猜。 */
  if (pickSvg) {
    const MV = ctx.MapView;
    pickSvg.offsetWidth = MV.W; pickSvg.offsetHeight = MV.H;
    ST.dropPlace('ZZZ');
    pickSvg._fire('click', { clientX: MV.W / 2, clientY: MV.H / 2 });
    const got = ST.places().ZZZ;
    if (ok(!!got, '在地图上点一下应该把坐标补上')) {
      ok(Math.abs(got.ll[0] - 160) < 2 && Math.abs(got.ll[1]) < 2,
        '点正中央应该反投影成 160°E / 0°N，实际 ' + got.ll.join(', '));
      ST.dropPlace('ZZZ');
      pickSvg._fire('click', { clientX: MV.W / 2 - 100, clientY: MV.H / 2 });
      ok(ST.places().ZZZ.ll[0] < got.ll[0], '往左点经度应该更小');
      ST.dropPlace('ZZZ');
      pickSvg.offsetWidth = 0;                       // 量不到尺寸（还没排版）
      pickSvg._fire('click', { clientX: 10, clientY: 10 });
      ok(!ST.places().ZZZ, '量不到画布尺寸就不该猜一个坐标出来');
      ST.dropPlace('ZZZ');
    }
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

/* ==================== 三点七、录入 provider（§4.6 / §7.1） ====================

   provider 是同步纯函数，所以不需要整页 —— 把 bundle + kernel + provider 三个脚本
   跑进一个**没有 document 的空 context** 就够了。这件事本身就是那条边界的证明：
   没有 DOM、没有 Store，它照样跑得起来；哪天有人在 provider 里伸手去问 Store，
   这一节当场就崩。 */
function providerCtx() {
  const c = vm.createContext({ console });
  c.window = c.self = c;
  ['data/bundle.js', 'kernel.js', 'provider.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(HERE, f), 'utf8'), c, { filename: f }));
  return c;
}

/* 手搓一个带 EXIF 的 JPEG。偏移量全按字节数写死在下面这几个常量里 ——
   EXIF 的规矩是「值超过 4 字节才存 offset，否则就地存」，这条搞错读出来全是垃圾，
   所以测试里必须真按这个规矩摆一遍，而不是喂一张真图了事（真图还得进仓库）。 */
function jpegExif(dt, lon, lat) {
  const IFD0 = 8, EXIF = 38, DT = 56, GPS = 76, LAT = 130, LON = 154, END = 178;
  const t = [];
  const u16 = v => t.push(v & 255, (v >> 8) & 255);
  const u32 = v => t.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
  const ent = (tag, type, cnt, val) => { u16(tag); u16(type); u32(cnt); u32(val); };
  // 度分秒，秒留两位小数（分母 100）—— 相机就是这么写的
  const dms = x => {
    const a = Math.abs(x), d = Math.floor(a), m = Math.floor((a - d) * 60);
    u32(d); u32(1); u32(m); u32(1); u32(Math.round(((a - d) * 60 - m) * 6000)); u32(100);
  };
  t.push(0x49, 0x49); u16(0x2A); u32(IFD0);            // 'II' 小端 + TIFF 魔数
  u16(2); ent(0x8769, 4, 1, EXIF); ent(0x8825, 4, 1, GPS); u32(0);
  u16(1); ent(0x9003, 2, 20, DT); u32(0);              // DateTimeOriginal
  for (let i = 0; i < 20; i++) t.push(i < dt.length ? dt.charCodeAt(i) : 0);
  u16(4);
  ent(0x0001, 2, 2, (lat < 0 ? 0x53 : 0x4E));          // 'S' / 'N'，两字节就地存
  ent(0x0002, 5, 3, LAT);
  ent(0x0003, 2, 2, (lon < 0 ? 0x57 : 0x45));          // 'W' / 'E'
  ent(0x0004, 5, 3, LON);
  u32(0);
  dms(lat); dms(lon);
  if (t.length !== END) throw new Error('EXIF 段长度算错了：' + t.length + ' ≠ ' + END);
  const len = 2 + 6 + END;
  return [0xFF, 0xD8, 0xFF, 0xE1, (len >> 8) & 255, len & 255,
    0x45, 0x78, 0x69, 0x66, 0, 0].concat(t, [0xFF, 0xD9]);
}

function checkProviders() {
  const c = providerCtx();
  const P = c.Providers, D = c.DATA;
  // 跟页面查同一张表：places / rates 直接用 data/bundle.js 里那一份，
  // 不在测试里另抄一份 —— 抄一份就等于测了一个页面上不存在的世界
  const cx = { places: D.places, rates: D.rates, baseCurrency: D.baseCurrency || 'CNY' };

  /* --- 边界：不碰 DOM、不碰 Store（§6.1）。用源码查，因为「这次没走到那行」
         不等于「没写那行」—— 加个 UI 提示时最容易顺手就把 Store 抓进来 --- */
  const src = fs.readFileSync(path.join(HERE, 'provider.js'), 'utf8')
    // 注释先去掉：里头写着「id 由 Store.addEntry() 发」，那是在说明边界，不是真去调它
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  ok(!/\bStore\b/.test(src), 'provider.js 里出现了 Store —— 它不该知道自己会落进哪一趟');
  ok(!/\bdocument\b/.test(src), 'provider.js 里出现了 document —— 解析层不许碰 DOM');
  ok(typeof c.document === 'undefined', '没有 document 也得跑得起来');

  /* --- 接口：三个 provider 同一套签名，pick() 挑得对 --- */
  const ids = P.list().map(p => p.id);
  ok(ids.join(',') === 'exif,text,manual', 'provider 名单不对：' + ids.join(','));
  ok(P.list().every(p => p.label && p.hint), '每个 provider 都得有给人看的名字和一句说明');
  ok(P.pick('3月14日 SHA → HND MU523').id === 'text', '一段文字该交给 text');
  ok(P.pick([{ name: 'a.jpg', bytes: [1, 2] }]).id === 'exif', '一批照片该交给 exif');
  ok(P.pick({ type: 'spend' }).id === 'manual', '明说了 type 的对象该交给 manual');
  ok(P.pick('') === null && P.pick(null) === null, '空输入不该有人认领');

  /* --- 产出契约：不带 id、一律带 source --- */
  const r1 = P.parse('3月14日 09:20 SHA MU523 → HND', cx);
  ok(r1.provider === 'text' && r1.entries.length === 1, 'text 该读出一条：' + r1.entries.length);
  const e1 = r1.entries[0];
  ok(!('id' in e1), 'provider 不许自己发 id —— id 由 Store.addEntry() 发');
  ok(e1.source.provider === 'text' && e1.source.confidence > 0 && e1.source.confidence <= 1,
    'source 没盖对：' + JSON.stringify(e1.source));
  ok(Array.isArray(e1.tags) && typeof e1.data === 'object', 'entry 的形状跟手填的那条得一样');
  // 同输入必须同输出，否则评测集当不了回归门槛
  ok(JSON.stringify(P.parse('3月14日 09:20 SHA MU523 → HND', cx)) === JSON.stringify(r1),
    'parse() 不是纯函数 —— 同一段文字两次读出不一样的东西');

  /* --- manual：confidence 恒为 1，说不清是哪一类就收进 misses --- */
  const m = P.parse({ type: 'spend', data: { amount: 12, currency: 'CNY', category: '吃' } }, cx);
  ok(m.entries[0].source.confidence === 1, '手填的那条不该带「要人看一眼」');
  ok(P.parse({ type: '随便' }, cx).misses.length === 1, '没说清哪一类的该收进 misses');
  ok(!('id' in P.parse({ type: 'note', id: 'x-1' }, cx).entries[0]),
    'manual 也不许把外面塞的 id 带进去');

  /* --- text：几条挑出来单看的。整体分数交给下面的评测集，这里只钉死几条
         「错了会很难看」的行为，出问题时能一眼看出坏在哪一步 --- */
  const one = (s, extra) => P.parse(s, Object.assign({ year: 2026 }, cx, extra || {})).entries;
  const leg = one('3月14日 09:20 SHA MU523 → HND 东京羽田')[0];
  ok(leg.type === 'leg' && leg.data.code === 'MU523' && leg.data.mode === 'air',
    '航班这条读错了：' + JSON.stringify(leg.data));
  ok(leg.time.start === '2026-03-14T09:20', '日期 + 钟点没拼上：' + leg.time.start);
  ok(leg.data.from === 'SHA' && leg.data.to === 'HND', '起降地读错了：' + JSON.stringify(leg.data));
  ok((leg.source.low || []).indexOf('data.flown') >= 0, '「飞没飞」是猜的，必须标出来');

  // 「浦东 T1」里的 T1 不是车次 —— 这条塌了就会凭空多出一趟火车
  const t1 = one('3月14日 07:00 浦东 T1 集合')[0];
  ok(t1.type === 'place', '航站楼 T1 被当成车次了：' + t1.type + '/' + (t1.data || {}).code);

  const stay = one('2026-03-14 入住 THE HOTEL 京都四条 已订 JPY 98,000，3月17日 退房')[0];
  ok(stay.type === 'stay' && stay.data.checkIn === '2026-03-14' && stay.data.checkOut === '2026-03-17',
    '住宿的进出日期读错了：' + JSON.stringify(stay.data));
  ok(stay.data.booked === true && stay.data.price === 98000 && stay.data.currency === 'JPY',
    '住宿的钱和「已订」读错了：' + JSON.stringify(stay.data));
  ok(!/98,000|JPY/.test(stay.title), '标题里还留着金额：' + stay.title);

  // 缺汇率不许静默当 1:1（§3.2）—— Kernel.convert() 会返回 NaN，所以这一格必须让人看见
  const chf = one('3月16日 纪念品 CHF 42')[0];
  ok(chf.data.currency === 'CHF' && (chf.source.low || []).indexOf('data.currency') >= 0,
    '缺汇率的币种没标成要人看一眼：' + JSON.stringify(chf.source));
  ok(!isFinite(c.Kernel.convert(42, 'CHF', D.rates, D.baseCurrency)),
    '这条测试的前提没了：CHF 现在有汇率了，换一个没汇率的币种');

  // 一行坏了不许牵连别行（§7.1）
  const many = P.parse('2026-03-14 09:20 SHA MU523 → HND\n随手记一句\n3月15日 午餐 JPY 1,200',
    Object.assign({ year: 2026 }, cx));
  ok(many.entries.length === 2 && many.misses.length === 1,
    '一行看不懂就该只丢那一行：读出 ' + many.entries.length + ' 条 / 看不懂 ' + many.misses.length + ' 行');
  ok(many.misses[0].why, '收进 misses 的行得说清为什么看不懂');

  /* --- exif：喂手搓的 JPEG 字节，不喂真图（真图得进仓库，而且坏了看不出坏在哪一位） --- */
  const shot = (dt, lon, lat, name) => ({ name: name || 'IMG_1.jpg', bytes: jpegExif(dt, lon, lat) });
  const px = P.parse([shot('2026:03:15 10:24:31', 135.77, 35.01)], cx);
  ok(px.provider === 'exif', 'exif 没接手：' + px.provider);
  const ph = px.entries.filter(e => e.type === 'photo');
  ok(ph.length === 1 && ph[0].time.start === '2026-03-15T10:24',
    '拍摄时间读错了：' + JSON.stringify(ph[0] && ph[0].time));
  ok(ph[0].media && ph[0].media[0].path === 'IMG_1.jpg', '照片没带上文件名');
  const gp = px.entries.filter(e => e.type === 'place');
  ok(gp.length === 1 && gp[0].place.name === '京都' && gp[0].time.start === '2026-03-15',
    'GPS 没反查到京都：' + JSON.stringify(gp.map(e => e.place)));
  // 反查出来的只是「最近的城市」，不是「去了哪个景点」，所以这一格一定要人看一眼
  ok((gp[0].source.low || []).indexOf('place.name') >= 0,
    'GPS 猜的地名没标成要人看一眼：' + JSON.stringify(gp[0].source));

  // 同一天同一个地方拍十张，也只该多出一条 place
  const px2 = P.parse([shot('2026:03:15 10:24:31', 135.77, 35.01, 'a.jpg'),
    shot('2026:03:15 18:02:00', 135.77, 35.01, 'b.jpg')], cx);
  ok(px2.entries.filter(e => e.type === 'photo').length === 2, '两张照片该出两条 photo');
  ok(px2.entries.filter(e => e.type === 'place').length === 1,
    '同一天同一个地方的 place 没去重');

  // 不是 JPEG：照样收这张图（图是真的），但时间标成不知道，并说清为什么
  const bad1 = P.parse([{ name: 'x.png', bytes: [0x89, 0x50, 0x4E, 0x47] }], cx);
  ok(bad1.entries.length === 1 && bad1.entries[0].type === 'photo' &&
    !bad1.entries[0].time.start, '读不出 EXIF 的照片该照收，但不许编个时间');
  ok((bad1.entries[0].source.low || []).indexOf('time.start') >= 0 && bad1.misses.length === 1,
    '读不出拍摄时间这件事得让人看见');

  // 太平洋中间：表里 60km 内没有已知地点，就别硬认成最近那座城市（§7.1）
  const far = P.parse([shot('2026:03:15 10:24:31', 160.0, 30.0)], cx);
  ok(!far.entries.some(e => e.type === 'place'), '离已知地点几百公里，还是硬认了一个地名');
  ok(far.misses.length === 1 && /km/.test(far.misses[0].why),
    '认不出坐标该说清是「表里附近没有」：' + JSON.stringify(far.misses));

  /* --- 评测集：字段级 P / R / F1，跟 baseline 比（§7.1）---
         规则一改就重算一遍分，降了就 FAIL 并把表打出来。
         想主动看表：node test-page.js --eval
         确认这次是「有意的取舍」而不是退步，再 node test-page.js --record 重录 baseline。
         第一次跑（还没有 baseline）就地录一份并把表打出来 —— 门槛从这一刻开始存在，
         但评测集条数一变就得显式重录，不让它悄悄失效。 */
  const SC = require('./eval/score.js');
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, 'eval/parse-cases.json'), 'utf8'));
  const res = SC.score(spec, (input, ectx) => P.parse(input, ectx, 'text'), cx);

  const bpath = path.join(HERE, 'eval/baseline.json');
  const first = !fs.existsSync(bpath);
  if (first || process.argv.includes('--record')) {
    fs.writeFileSync(bpath, JSON.stringify(SC.snapshot(res), null, 2) + '\n');
    console.log((first ? '第一次跑，录下 ' : '已重录 ') + 'eval/baseline.json：' + res.n
      + ' 条，整体 F1 ' + (res.overall.f1 * 100).toFixed(1) + '%');
  }
  const worse = SC.gate(res, JSON.parse(fs.readFileSync(bpath, 'utf8')));
  if (first || worse.length || process.argv.includes('--eval')) console.log(SC.table(res));
  // 门槛卡住了但确认要接受时：把这一行贴进 eval/baseline.json（或者 --record 让它自己写）
  if (worse.length) console.log('  这次的分：'
    + JSON.stringify(Object.assign(SC.snapshot(res), { _: undefined })));
  ok(!worse.length, '解析质量退了（上面是明细，确认要接受再 --record）：\n      ' + worse.join('\n      '));

  // 「哪几格是猜的」和「看不懂几行」是另外两条契约，不进 F1，一样不许坏
  const lowBad = res.cases.filter(x => x.lowMiss.length);
  ok(!lowBad.length, '这些 case 该标「要人看一眼」的格子没标：'
    + lowBad.map(x => x.id + '（' + x.lowMiss.join('、') + '）').join('；'));
  const missBad = res.cases.filter(x => x.missBad);
  ok(!missBad.length, '看不懂的行数不对：'
    + missBad.map(x => x.id + ' 要 ' + x.missWant + ' 条、实际 ' + x.missGot + ' 条').join('；'));

  return res;
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

/* 插画库全量自检：ART 里每一张都得画得出来，包括这一页没挂出来的那些 ——
   不然新加的场景要等到哪趟行程真用上了才暴雷。
   单独开一份页面来挂：check() 那份要跟「同 seed 出同一张图」比对，不能往里塞额外节点。
   返回的 document 给 --svg 用，这样导出的是「卡片 + 整个插画库」。 */
function checkArt() {
  const { document, ctx } = runPage('hand-drawn.html');
  const wall = document.createElement('div');
  document.body.appendChild(wall);
  const names = Object.keys(ctx.Sketch.ART);
  names.forEach(n => {
    const host = document.createElement('div');
    host.setAttribute('data-art', n);
    wall.appendChild(host);
  });
  ctx.Sketch.paintArt();
  // 场景图是一整幅画，节点少于 8 个基本等于没画完；图标/贴纸本来就是两三笔
  const thin = names.filter((n, i) => {
    const s = svgOf(wall.children[i]);
    return !s || s.children.length < (ctx.Sketch.ART[n].w === 150 ? 8 : 2);
  });
  ok(!thin.length, '这些插图画出来是空的或者太单薄：' + thin.join('、'));
  const scenes = names.filter(n => ctx.Sketch.ART[n].w === 150);
  ok(scenes.length >= 11, '场景插图太少，卡片之间会长得一样：' + scenes.length);
  return document;
}

const t0 = Date.now();
const doc = check();

// 同 seed 必须出同一张图，否则导出和排版快照都没法做（§4.4 规则 6 / §7.2）
const a = ser(doc.documentElement), b = ser(runPage('hand-drawn.html').document.documentElement);
ok(a === b, '两次渲染结果不一致 —— seed 没锁住');

const artDoc = checkArt();
checkShell();
const pc = checkPostcard();
checkProviders();

if (process.argv.includes('--svg')) dumpSvg(artDoc, pc);

// 导出是异步的（Image.onload / Promise），等微任务跑完再收尾
Promise.resolve().then(() => {
  later.forEach(f => f());
  console.log((nBad ? 'FAIL' : 'OK') + '  ' + nOk + ' 项通过'
    + (nBad ? ' / ' + nBad + ' 项失败' : '')
    + '  ·  ' + Math.round(a.length / 1024) + ' KB 输出  ·  ' + (Date.now() - t0) + ' ms');
  process.exit(nBad ? 1 : 0);
});
