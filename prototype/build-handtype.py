#!/usr/bin/env python3
"""生成 handtype.js —— 把标题用 rough.js 描出来的运行时。

定稿参数（你在 glyph 对比页上调的）：
    手抖 0.4 / 弯曲 0.4 / 笔粗 0.6 / 转角 0.3° / 上下 0.2px
    字体 霞鹜漫黑 · 填充 实心

用法：给元素加 data-hand 即可，字号和颜色都跟着 CSS 走：
    <h1 data-hand>旅行手帐</h1>
    <div class="title" data-hand style="color:#b0483a">东京</div>
需要单独指定颜色时用 data-hand-color="#xxx"。

字库里没有轮廓的字会自动退回普通文字渲染，所以加新文案不会缺字，
只是那几个字不抖 —— 想让它们也抖就重跑这个脚本。

用法：python3 build-handtype.py
输出：handtype.js
"""
import json
import pathlib

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).parent
FACE = HERE / "fonts" / "LXGWMarkerGothic-Regular.ttf"
FAMILY = "MarkerGothic"
PAGES = ["hand-drawn.html", "map.html"]
TRIPS = "data/trips.json"

ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
PUNCT = "·—…、。，；：？！（）「」『』【】《》“”‘’～￥°※→←↑↓○●★☆"


def wanted_chars() -> list:
    """页面里出现过的字 + 常用符号 + 行程标题。标题文案改了重跑一次就行。

    只取 trips[].title：手写体只用在 data-hand 的标题上，把整个 json 塞进来
    会让 handtype.js 白胖一圈。"""
    s = set(ASCII + PUNCT)
    for p in PAGES:
        f = HERE / p
        if f.exists():
            s |= set(f.read_text(encoding="utf-8"))
    f = HERE / TRIPS
    if f.exists():
        for t in json.loads(f.read_text(encoding="utf-8")).get("trips", []):
            s |= set(t.get("title") or "")
    return sorted(c for c in s if c.isprintable() and c not in "\t\n\r")


def outlines() -> dict:
    """字形轮廓，缩放到 em=100、y 轴向下（SVG 坐标系）。"""
    font = TTFont(FACE)
    gs = font.getGlyphSet()
    cmap = {}
    for t in font["cmap"].tables:
        cmap.update(t.cmap)
    k = 100 / font["head"].unitsPerEm
    hmtx = font["hmtx"]
    out = {}
    for ch in wanted_chars():
        gn = cmap.get(ord(ch))
        if gn is None:
            continue
        try:
            pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}")
        except TypeError:
            pen = SVGPathPen(gs)
        gs[gn].draw(TransformPen(pen, (k, 0, 0, -k, 0, 0)))
        d = pen.getCommands()
        adv = round(hmtx[gn][0] * k, 1)
        if not d:                       # 空格这类没有轮廓、但有宽度的字
            out[ch] = {"a": adv}
        else:
            out[ch] = {"d": d, "a": adv}
    return out


RUNTIME = r"""
/* 标题手写渲染。定稿参数：手抖 0.4 / 弯曲 0.4 / 笔粗 0.6 / 转角 0.3° / 上下 0.2px */
(function(){
  var NS = 'http://www.w3.org/2000/svg';
  var P = { rough:0.4, bow:0.4, sw:0.6, rot:0.3, dy:0.2, pen:0 };
  var G = window.HANDTYPE_GLYPH, FAM = '__FAMILY__';
  var mk = function(n){ return document.createElementNS(NS, n); };

  function h32(s){ var h = 2166136261;
    for (var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0; }
  function rnd(seed){ var a = seed >>> 0; return function(){
    a = (a + 0x6D2B79F5) >>> 0; var t = Math.imul(a ^ a>>>15, 1|a);
    t = (t + Math.imul(t ^ t>>>7, 61|t)) ^ t; return ((t ^ t>>>14) >>> 0) / 4294967296; }; }

  /* 轮廓坐标在 em=100 空间，整体 scale(k) 到字号；
     rough.js 的抖动量和线宽按输入坐标算，所以要除以 k 补偿，否则小字号抖不出来。 */
  function render(el){
    if (typeof rough === 'undefined' || !G) return;
    var text = el.getAttribute('data-hand-raw');
    if (text === null){ text = el.textContent; el.setAttribute('data-hand-raw', text); }
    var cs = window.getComputedStyle ? getComputedStyle(el) : null;
    var size = parseFloat(el.getAttribute('data-hand-size')
                          || (cs && cs.fontSize) || 32) || 32;
    var color = el.getAttribute('data-hand-color') || (cs && cs.color) || '#2f2c26';
    var lh = parseFloat((cs && cs.lineHeight) || '') || size * 1.25;
    var maxW = el.clientWidth || 0;
    var k = size / 100, base = size * 0.86;

    var svg = mk('svg'), rc = rough.svg(svg);
    var x = 0, y = 0, wide = 0;
    for (var i=0;i<text.length;i++){
      var ch = text[i], g = G[ch];
      var adv = g ? g.a * k : size * (ch === ' ' ? 0.30 : 1);
      if (maxW && x > 0 && x + adv > maxW){ x = 0; y += lh; }   // 简单折行
      var r = rnd(h32(ch) + Math.imul(i+1, 2654435761) + P.pen*1013904223);
      var rot = (r()*2-1)*P.rot, dy = (r()*2-1)*P.dy, sc = 1 + (r()*2-1)*0.02;
      if (g && g.d){
        var grp = mk('g');
        grp.setAttribute('transform', 'translate(' + x.toFixed(1) + ' '
          + (y + base + dy).toFixed(1) + ') rotate(' + rot.toFixed(2) + ') scale('
          + (k*sc).toFixed(4) + ')');
        var f = mk('path');                 // 填充走普通 path，保留字形内部镂空
        f.setAttribute('d', g.d); f.setAttribute('fill', color);
        grp.appendChild(f);
        grp.appendChild(rc.path(g.d, { roughness:P.rough/k, bowing:P.bow,
          strokeWidth:P.sw/k, stroke:color, fill:'none', preserveVertices:false,
          seed:(h32(ch) % 9000) + 1 + i*13 + P.pen*977 }));
        svg.appendChild(grp);
      } else if (ch !== ' '){               // 没有轮廓的字，退回普通文字
        var t = mk('text');
        t.setAttribute('x', x.toFixed(1)); t.setAttribute('y', (y+base+dy).toFixed(1));
        t.setAttribute('font-family', FAM + ',sans-serif');
        t.setAttribute('font-size', size); t.setAttribute('fill', color);
        t.textContent = ch; svg.appendChild(t);
      }
      x += adv;
      if (x > wide) wide = x;
    }
    svg.setAttribute('width', Math.ceil(wide + size*0.1));
    svg.setAttribute('height', Math.ceil(y + size*1.22));
    svg.style.display = 'block'; svg.style.overflow = 'visible';
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(svg);
  }

  function paint(root){
    var list = (root || document).querySelectorAll('[data-hand]');
    for (var i=0;i<list.length;i++) render(list[i]);
    return list.length;
  }
  window.handtype = paint;
  paint.reseed = function(){ P.pen++; paint(); };
  paint.params = P;
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', function(){ paint(); });
  else paint();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ paint(); });
})();
"""


def main():
    g = outlines()
    traced = sum(1 for v in g.values() if "d" in v)
    js = ("/* 自动生成，勿手改 —— 见 build-handtype.py */\n"
          f"/* 霞鹜漫黑 LXGW MarkerGothic (OFL) 字形轮廓 {traced} 字 */\n"
          "window.HANDTYPE_GLYPH="
          + json.dumps(g, ensure_ascii=False, separators=(",", ":")) + ";\n"
          + RUNTIME.replace("__FAMILY__", FAMILY))
    out = HERE / "handtype.js"
    out.write_text(js, encoding="utf-8")
    print(f"轮廓 {traced} 字 / 共 {len(g)} 个码位")
    print(f"{out.name} {out.stat().st_size // 1024}K")


if __name__ == "__main__":
    main()
