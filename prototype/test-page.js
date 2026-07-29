#!/usr/bin/env node
/* 无浏览器跑整页 + 断言。docs/需求文档.md §7.3 说的「渲染回归」就是这条链。

     node test-page.js            # 跑断言
     node test-page.js --svg      # 顺便把每张插图导成 /tmp/art/*.svg，好转 png 肉眼看

   做法：手写一个够用的 stub DOM（真 jsdom 太重，而且这页只用到十几个 API），
   把 hand-drawn.html 里的 <script> 依次执行，然后检查画出来的东西。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HERE = __dirname;
const PAGE = path.join(HERE, 'hand-drawn.html');

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
      toggle(c) {
        if (this.contains(c)) { this.remove(c); return false; }
        this.add(c); return true;
      }
    };
  }
  get tagName() { return this.nodeName.toUpperCase(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
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
  addEventListener() {}
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

function makeDocument() {
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
  const cards = new El('div');
  cards.id = 'cards';
  cards.setAttribute('class', 'grid');
  ids.cards = cards;
  body.appendChild(cards);

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
function scriptsOf(html) {
  const out = [], re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const src = /\bsrc\s*=\s*"([^"]+)"/.exec(m[1]);
    out.push(src
      ? { name: src[1], code: fs.readFileSync(path.join(HERE, src[1]), 'utf8') }
      : { name: 'hand-drawn.html:inline@' + m.index, code: m[2] });
  }
  return out;
}

function runPage() {
  const document = makeDocument();
  const ctx = vm.createContext({
    document, console,
    // handtype 用它取字号/颜色；stub 量不出版式，给个固定值
    getComputedStyle: () => ({ fontSize: '32px', color: '#2f2c26', lineHeight: '' }),
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {}
  });
  ctx.window = ctx.self = ctx;      // rough.js / kernel.js / trip.js 都挂在 window 上
  for (const s of scriptsOf(fs.readFileSync(PAGE, 'utf8')))
    vm.runInContext(s.code, ctx, { filename: s.name });
  return { document, ctx };
}

/* ==================== 三、断言 ==================== */

let nOk = 0, nBad = 0;
function ok(cond, msg) {
  if (cond) { nOk++; return true; }
  nBad++; console.log('  FAIL  ' + msg);
  return false;
}

function check() {
  const { document } = runPage();
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
const a = ser(doc.documentElement), b = ser(runPage().document.documentElement);
ok(a === b, '两次渲染结果不一致 —— seed 没锁住');

if (process.argv.includes('--svg')) dumpSvg(doc);

console.log((nBad ? 'FAIL' : 'OK') + '  ' + nOk + ' 项通过'
  + (nBad ? ' / ' + nBad + ' 项失败' : '')
  + '  ·  ' + Math.round(a.length / 1024) + ' KB 输出  ·  ' + (Date.now() - t0) + ' ms');
process.exit(nBad ? 1 : 0);
