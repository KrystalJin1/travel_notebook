#!/usr/bin/env python3
"""生成「笔画本身在抖」对比页 —— 用 rough.js 直接描字形轮廓。

为什么要这个：上一版 wobble 只是把整个字当一块砖，随机转一点、挪一点，
字的内部还是印刷体的完美笔画，所以看着「死板」。
真手写歪的是笔画自己：横不平、竖不直、边缘毛。
做法：用 fontTools 把字形轮廓抽出来（缩放到 em=100、y 向下），存成 JS 表，
运行时把轮廓丢给 rough.js 描一遍 —— 和地图海岸线、插图用的是同一支笔。

填充用普通 <path>（保留内部镂空的绕行规则），rough.js 只负责描边，
再把填充整体错开一点，像色铅笔没涂准。

用法：python3 build-glyph.py
输出：glyph.standalone.html
"""
import base64
import json
import pathlib
import tempfile

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools import subset

HERE = pathlib.Path(__file__).parent
FONTS = HERE / "fonts"
CAND = FONTS / "candidates"

# 只收全覆盖简体的字体：芫荽缺 1033/3755 个 GB2312 一级字（连「东」都没有），不能用
FACES = [
    ("MarkerGothic", FONTS / "LXGWMarkerGothic-Regular.ttf", "霞鹜漫黑",
     "现在手帐用的，马克笔轮廓"),
    ("Yozai", CAND / "Yozai-Regular.ttf", "悠哉字体", "圆头手写楷"),
]

BIG = "东京"
TITLE = "旅行手帐"
LINE = "第三天 · 浅草寺 · 晴"
MIX = "SHA → HND · 2026.03.14"
TRACE_TEXT = [("big", BIG, 62), ("title", TITLE, 31), ("line", LINE, 17), ("mix", MIX, 19)]

BODY = ("早上七点半从新宿出发，中央线转富士急行，车窗外的房子越来越低，"
        "富士山是在过了大月站之后突然出现的，比想象中近。")

TRACE_CHARS = sorted(set("".join(t[1] for t in TRACE_TEXT)) - {" "})

SUBSET_CHARS = "".join(sorted(set(
    BIG + TITLE + LINE + MIX + BODY
    + "原样整字抖笔画描字形实心空只边填充转角上下大小换一支笔手弯曲粗"
    + "字体候选说明缺覆盖简体不能用同一支的和地图海岸线插图"
    + "".join(chr(c) for c in range(0x20, 0x7F)) + "·—…、。，；：？！（）「」“”→¥°%")))


def subset_b64(src: pathlib.Path) -> tuple[str, int]:
    with tempfile.NamedTemporaryFile(suffix=".woff2", delete=False) as tmp:
        out = pathlib.Path(tmp.name)
    subset.main([str(src), f"--text={SUBSET_CHARS}", "--flavor=woff2",
                 f"--output-file={out}", "--no-hinting", "--desubroutinize"])
    size = out.stat().st_size
    uri = "data:font/woff2;base64," + base64.b64encode(out.read_bytes()).decode("ascii")
    out.unlink()
    return uri, size


def outlines(src: pathlib.Path) -> dict:
    """抽字形轮廓，统一缩放到 em=100 且 y 轴向下（SVG 坐标系）。"""
    font = TTFont(src)
    gs = font.getGlyphSet()
    cmap = {}
    for t in font["cmap"].tables:
        cmap.update(t.cmap)
    upem = font["head"].unitsPerEm
    k = 100 / upem
    hmtx = font["hmtx"]
    out = {}
    for ch in TRACE_CHARS:
        gn = cmap.get(ord(ch))
        if gn is None:
            continue
        try:
            pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}")
        except TypeError:
            pen = SVGPathPen(gs)
        gs[gn].draw(TransformPen(pen, (k, 0, 0, -k, 0, 0)))
        d = pen.getCommands()
        if not d:
            continue
        out[ch] = {"d": d, "a": round(hmtx[gn][0] * k, 1)}
    return out


CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{--sys:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
      --ink:#2f2c26;--ink2:#7d7566;--ink3:#b3a894;--paper:#fdfbf5;--stage:#efe9dd;
      --sand:#e6dcc6}
body{background:var(--stage);color:var(--ink);padding:26px 22px 80px;
     font-family:var(--sys);line-height:1.7}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:19px;margin-bottom:6px}
.lead{font-size:13px;color:var(--ink2);margin-bottom:18px;max-width:820px}
.ctl{position:sticky;top:0;z-index:9;background:var(--paper);padding:11px 15px;
     margin-bottom:18px;display:flex;flex-wrap:wrap;gap:14px;align-items:center;
     font-size:13px;color:#5d564a;border-bottom:1px dashed #d3c7ae}
.ctl label{display:flex;align-items:center;gap:6px;white-space:nowrap}
.ctl input[type=range]{width:82px;accent-color:#8a6d4a}
.ctl b{min-width:26px;display:inline-block;font-family:ui-monospace,monospace;font-size:12px}
.ctl button,.ctl select{font-family:inherit;font-size:13px;background:#f1ead9;cursor:pointer;
     color:var(--ink);padding:5px 11px;border:1px dashed #b3a894;border-radius:3px}
.ctl .hint{color:var(--ink3);font-size:12px}
.ctl input[type=color]{width:34px;height:22px;padding:0;border:1px dashed #b3a894;background:none;cursor:pointer}
.sw{width:17px;height:17px;display:inline-block;cursor:pointer;outline:1px dashed #c9bda3;outline-offset:2px}
.card{background:var(--paper);padding:20px 22px 18px;margin-bottom:16px}
.hd{font-size:13px;color:var(--ink2);margin-bottom:12px}
.hd b{font-size:15px;color:var(--ink)}
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.cap{font-size:11px;color:var(--ink3);font-family:ui-monospace,monospace;
     margin-bottom:10px;letter-spacing:.03em}
.s{font-family:var(--face)}
.big{font-size:62px;line-height:1.25}
.title{font-size:31px;line-height:1.35;margin-top:4px}
.line{font-size:17px;margin-top:8px;opacity:.82}
.mix{font-size:19px;margin-top:8px}
.trace svg{display:block;overflow:visible;margin-bottom:2px}
hr{border:0;border-top:1px dashed #e2d8c0;margin:12px 0}
.foot{font-size:12.5px;color:var(--ink2);margin-top:24px;line-height:1.9;max-width:840px}
.foot code{background:#e4dcc9;padding:1px 5px;font-size:11.5px;font-family:ui-monospace,monospace}
"""

JS = r"""
const C = { ink:'#2f2c26', ink2:'#5d564a', sand:'#e0d3b6' };
const S = { rough:0.4, bow:0.4, sw:0.6, rot:0.3, dy:0.2, fill:'solid',
            col:'#2f2c26', pen:0 };
const NS = 'http://www.w3.org/2000/svg';
const mk = n => document.createElementNS(NS, n);

function h32(s){ let h=2166136261;
  for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  return h>>>0; }
function rnd(seed){ let a=seed>>>0; return ()=>{
  a=(a+0x6D2B79F5)>>>0; let t=Math.imul(a^a>>>15, 1|a);
  t=(t+Math.imul(t^t>>>7, 61|t))^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const esc = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

/* ② 整字抖：每个字包一层 inline-block，随机转/挪一点，笔画内部不变 */
function wobble(el){
  const src = el.dataset.raw || (el.dataset.raw = el.textContent);
  let out = '';
  for (let i=0;i<src.length;i++){
    const ch = src[i];
    if (ch === ' '){ out += ch; continue; }
    const r = rnd(h32(ch) + Math.imul(i+1,2654435761) + S.pen*1013904223);
    const rot=(r()*2-1)*S.rot, dy=(r()*2-1)*S.dy, dx=(r()*2-1)*0.5, sc=1+(r()*2-1)*0.03;
    out += '<span style="display:inline-block;transform-origin:50% 62%;transform:'
         + `translate(${dx.toFixed(2)}px,${dy.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) `
         + `scale(${sc.toFixed(3)})">` + esc(ch) + '</span>';
  }
  el.innerHTML = out;
}

/* ③ 描字形：轮廓坐标在 em=100 空间，整体 scale(k) 到字号。
   rough.js 的抖动量和线宽都按输入坐标算，所以要除以 k 反向补偿，
   否则字号越小抖得越轻、越看不出手绘。 */
function trace(host, text, size, fam, color){
  const tab = GLYPH[fam] || {};
  const k = size/100, base = size*0.86 + 3;
  const svg = mk('svg');
  const rc = rough.svg(svg);
  let pen = 2;
  for (let i=0;i<text.length;i++){
    const ch = text[i], g = tab[ch];
    const r = rnd(h32(ch) + Math.imul(i+1,2654435761) + S.pen*1013904223);
    const rot=(r()*2-1)*S.rot, dy=(r()*2-1)*S.dy, sc=1+(r()*2-1)*0.03;
    if (!g){                       // 空格 / 字库里没轮廓的字，退回普通文字
      if (ch !== ' '){
        const t = mk('text');
        t.setAttribute('x', pen.toFixed(1)); t.setAttribute('y', (base+dy).toFixed(1));
        t.setAttribute('font-family', fam + ',sans-serif');
        t.setAttribute('font-size', size); t.setAttribute('fill', color);
        t.textContent = ch; svg.appendChild(t);
      }
      pen += size * (ch === ' ' ? 0.30 : 1.0);
      continue;
    }
    const grp = mk('g');
    grp.setAttribute('transform',
      `translate(${pen.toFixed(1)} ${(base+dy).toFixed(1)}) `
      + `rotate(${rot.toFixed(2)}) scale(${(k*sc).toFixed(4)})`);
    if (S.fill !== 'none'){        // 填充用普通 path，保留内部镂空的绕行规则
      const f = mk('path');
      f.setAttribute('d', g.d);
      f.setAttribute('fill', S.fill === 'solid' ? color : C.sand);
      f.setAttribute('transform',
        `translate(${(1.5/k).toFixed(2)} ${(1.7/k).toFixed(2)})`);
      grp.appendChild(f);
    }
    grp.appendChild(rc.path(g.d, { roughness:S.rough/k, bowing:S.bow,
      strokeWidth:S.sw/k, stroke:color, fill:'none', preserveVertices:false,
      seed:(h32(ch)%9000)+1 + i*13 + S.pen*977 }));
    svg.appendChild(grp);
    pen += g.a * k;
  }
  svg.setAttribute('width', Math.ceil(pen+4)); svg.setAttribute('height', Math.ceil(size*1.30));
  host.textContent = ''; host.appendChild(svg);
}

function repaint(){
  document.querySelectorAll('.cols').forEach(e => { e.style.color = S.col; });
  document.querySelectorAll('.wob').forEach(wobble);
  document.querySelectorAll('.trace').forEach(el => {
    const fam = el.closest('.card').dataset.fam;
    trace(el, el.dataset.text, +el.dataset.size, fam, S.col);
  });
  document.getElementById('dbg').textContent =
    `手抖 ${S.rough} / 弯曲 ${S.bow} / 笔粗 ${S.sw} / 转角 ${S.rot}° / 上下 ${S.dy}px / ${S.col}`;
}

const bind = (id, key, out) => {
  const inp = document.getElementById(id), lab = document.getElementById(out);
  const apply = () => {
    S[key] = inp.type === 'range' ? +inp.value : inp.value;
    if (lab) lab.textContent = (+inp.value).toFixed(1);
    repaint();
  };
  inp.addEventListener('input', apply); inp.addEventListener('change', apply);
  if (lab) lab.textContent = (+inp.value).toFixed(1);
};
bind('c-rough','rough','o-rough'); bind('c-bow','bow','o-bow');
bind('c-sw','sw','o-sw'); bind('c-rot','rot','o-rot'); bind('c-dy','dy','o-dy');
bind('c-fill','fill');
document.getElementById('c-col').addEventListener('input', e => {
  S.col = e.target.value; repaint(); });
document.querySelectorAll('.sw').forEach(e => {
  e.style.background = e.dataset.col;
  e.addEventListener('click', () => {
    S.col = e.dataset.col; document.getElementById('c-col').value = S.col; repaint(); });
});
document.getElementById('c-pen').addEventListener('click', () => { S.pen++; repaint(); });
repaint();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(repaint);
"""


def card(family, cn, note):
    plain = (f'<div class="s big">{BIG}</div><div class="s title">{TITLE}</div>'
             f'<div class="s line">{LINE}</div><div class="s mix">{MIX}</div>')
    wob = plain.replace('class="s ', 'class="wob s ')
    tr = "".join(
        f'<div class="trace {cls}" data-text="{txt}" data-size="{sz}"'
        f'{" data-dim=1" if cls == "line" else ""}></div>'
        for cls, txt, sz in TRACE_TEXT)
    return f"""
<div class="card" data-fam="{family}" style="--face:'{family}',serif">
  <div class="hd"><b>{cn}</b> · {note}</div>
  <div class="cols">
    <div><div class="cap">① 原样 · 字体自己排</div>{plain}</div>
    <div><div class="cap">② 整字抖 · 当一块砖转</div>{wob}</div>
    <div><div class="cap">③ 描字形 · rough.js 描轮廓</div><div class="trace-col">{tr}</div></div>
  </div>
</div>"""


def main():
    faces_css, cards, glyphs = [], [], {}
    for family, path, cn, note in FACES:
        uri, size = subset_b64(path)
        faces_css.append(f"@font-face{{font-family:'{family}';font-display:block;"
                         f"src:url({uri}) format('woff2')}}")
        glyphs[family] = outlines(path)
        cards.append(card(family, cn, note))
        d_bytes = sum(len(v["d"]) for v in glyphs[family].values())
        print(f"{cn:<10} {family:<14} 子集 {size:>7}B  轮廓 {len(glyphs[family])} 字 / {d_bytes}B")

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>[单文件] 手写歪扭 —— 三种做法对比</title>
<style>
{chr(10).join(faces_css)}
{CSS}</style></head>
<body><div class="wrap">
<h1>「歪歪扭扭」的三个层次</h1>
<p class="lead">
① 是字体原样。② 是把每个字当一块砖随机转一点 —— 位置歪了，但笔画内部还是印刷体的完美直线，
所以你说的「死板」是对的。③ 把字形轮廓抽出来交给 rough.js 描，横不平竖不直、边缘发毛，
和地图海岸线、手帐插图是同一支笔。三列用的是同一个字体文件，差别全在渲染方式。</p>

<div class="ctl">
  <label>手抖 <input type="range" id="c-rough" min="0" max="3" step="0.1" value="0.4"><b id="o-rough"></b></label>
  <label>弯曲 <input type="range" id="c-bow" min="0" max="4" step="0.1" value="0.4"><b id="o-bow"></b></label>
  <label>笔粗 <input type="range" id="c-sw" min="0.3" max="2.5" step="0.1" value="0.6"><b id="o-sw"></b></label>
  <label>转角 <input type="range" id="c-rot" min="0" max="7" step="0.1" value="0.3"><b id="o-rot"></b></label>
  <label>上下 <input type="range" id="c-dy" min="0" max="5" step="0.1" value="0.2"><b id="o-dy"></b></label>
  <label>填充 <select id="c-fill">
    <option value="solid">实心</option><option value="sand">淡色垫底</option>
    <option value="none">只描边</option></select></label>
  <label>颜色 <input type="color" id="c-col" value="#2f2c26"></label>
  <span class="sw" data-col="#2f2c26" title="墨"></span><span class="sw" data-col="#b0483a" title="砖红"></span>
  <span class="sw" data-col="#4a6b52" title="松绿"></span><span class="sw" data-col="#8a6d4a" title="牛皮"></span>
  <button id="c-pen">换一支笔</button>
  <span class="hint" id="dbg"></span>
</div>
{''.join(cards)}
<p class="foot">
③ 的轮廓是构建时用 fontTools 抽的，缩放到 <code>em=100</code> 存成 JS 表；运行时整体 <code>scale(k)</code>
到字号，rough.js 的抖动量和线宽都除以 <code>k</code> 补偿，否则小字号会抖不出来。
填充走普通 <code>&lt;path&gt;</code>（rough.js 的实心填充不认字形内部的镂空，「口」会被涂死），
再整体错开 1.5px，像色铅笔没涂准。<br>
代价：每个字是一组 SVG，只适合标题和短句，正文段落还是得用真字体直接排。
字库里没有轮廓的字会自动退回普通文字渲染。<br>
生成脚本 <code>build-glyph.py</code>，轮廓数据只包含这一页用到的字。
</p>
</div>
<script>{(HERE / "vendor" / "rough.js").read_text(encoding="utf-8")}</script>
<script>const GLYPH = {json.dumps(glyphs, ensure_ascii=False, separators=(',', ':'))};</script>
<script>{JS}</script>
</body></html>
"""
    out = HERE / "glyph.standalone.html"
    out.write_text(html, encoding="utf-8")
    print(f"\n{out.name} {out.stat().st_size // 1024}K")


if __name__ == "__main__":
    main()
