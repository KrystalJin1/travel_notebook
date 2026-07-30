/* 导出：把画好的 SVG 存成文件 —— docs/需求文档.md §4.7。

   为什么要三种格式，而不是只给一个「下载」：
     SVG  —— 无损、能再编辑、不需要 canvas，任何环境都存得出来。兜底就是它。
     PNG  —— 发微信 / 贴简历用。要过一遍 canvas。
     PDF  —— 打印用。也要过 canvas，另外自己拼一个 PDF 1.4 的骨架。
   没有第三方库：jsPDF 之类要么打包、要么走 CDN，这个项目 file:// 双击就得能跑（§2）。

   一条底线：导不出来就说导不出来。canvas / Blob 缺哪个就报哪个，
   不静默失败、也不假装成功 —— 无浏览器的 stub DOM 里点这几个按钮不许抛异常。 */
(function (root) {
  'use strict';
  const D = root.Draw;
  const doc = root.document;
  const nope = m => Promise.reject(new Error(m));

  /* ---------- 一、字节小工具 ---------- */

  // PDF 骨架只写 ASCII，二进制注释那几个字节靠 &0xff 落回原值
  const fromStr = s => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  };
  const fromB64 = s => {
    const raw = root.atob ? root.atob(s) : Buffer.from(s, 'base64').toString('binary');
    return fromStr(raw);
  };
  // 中文得先转成 UTF-8 再进 base64 / 落成字节，btoa 和 charCodeAt 都只认 latin1
  const u8 = s => unescape(encodeURIComponent(s));
  const utf8 = s => fromStr(u8(s));
  const b64 = s => root.btoa ? root.btoa(u8(s)) : Buffer.from(s, 'utf8').toString('base64');

  function join(list) {
    let n = 0;
    for (const b of list) n += b.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const b of list) { out.set(b, at); at += b.length; }
    return out;
  }

  /* ---------- 二、SVG 文本 ---------- */

  /* 一旦被塞进 <img>，SVG 就是一份独立文档：页面上外链的 fonts/inline.css 不跟着走，
     正文会掉回系统字体。所以把 @font-face 抄进 SVG 自己的 <style> 里。
     file:// 下读不到 —— Chrome 把每个本地文件当独立来源，cssRules 会抛 SecurityError。
     那种情况下返回空串，由调用方去告诉用户「这张图的字体不是本来那支」。 */
  function fontCss() {
    let css = '';
    const list = (doc && doc.styleSheets) ? Array.prototype.slice.call(doc.styleSheets) : [];
    for (const s of list) {
      let rules = null;
      try { rules = s.cssRules; } catch (e) { rules = null; }
      if (!rules) continue;
      for (const r of Array.prototype.slice.call(rules))
        if (r.type === 5) css += (r.cssText || '') + '\n';       // 5 = @font-face
    }
    return css;
  }

  function sizeOf(node) {
    const vb = (node.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    return {
      w: vb.length === 4 && vb[2] > 0 ? vb[2] : +node.getAttribute('width') || 900,
      h: vb.length === 4 && vb[3] > 0 ? vb[3] : +node.getAttribute('height') || 1200
    };
  }

  function svgText(node, opt) {
    const o = opt || {};
    const s = sizeOf(node);
    const el = node.cloneNode(true);
    el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    el.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    el.setAttribute('width', s.w);
    el.setAttribute('height', s.h);
    const css = o.font === false ? '' : fontCss();
    if (css && el.insertBefore) {
      const st = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
      st.textContent = css;
      el.insertBefore(st, el.firstChild);
    }
    const body = (root.XMLSerializer && new root.XMLSerializer().serializeToString(el))
      || el.outerHTML || '';
    return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + body + '\n', w: s.w, h: s.h, font: !!css };
  }

  /* ---------- 三、栅格化 ---------- */

  /* scale = 2 是默认：900×1200 出 1800×2400，够打印也不至于让 toDataURL 卡住。
     底色要自己铺一遍 —— PNG 默认透明，贴到白底以外的地方纸就没了。 */
  function raster(node, opt) {
    const o = opt || {};
    if (!doc || !doc.createElement) return nope('没有 document —— 栅格化不了');
    if (!root.Image) return nope('这个环境没有 Image —— 只能存 SVG');
    const cv = doc.createElement('canvas');
    if (!cv.getContext) return nope('这个环境没有 canvas —— 只能存 SVG');
    const cx = cv.getContext('2d');
    if (!cx || !cx.drawImage) return nope('canvas 拿不到 2d 上下文 —— 只能存 SVG');

    const src = svgText(node, o);
    const k = o.scale || 2;
    cv.width = Math.round(src.w * k);
    cv.height = Math.round(src.h * k);

    return new Promise((res, rej) => {
      const img = new root.Image();
      img.onload = () => {
        cx.fillStyle = o.bg || (D && D.C.paper) || '#fdfbf5';
        cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        res({ canvas: cv, font: src.font, w: src.w, h: src.h });
      };
      img.onerror = () => rej(new Error('浏览器没能把这张 SVG 读成图片'));
      img.src = 'data:image/svg+xml;base64,' + b64(src.text);
    });
  }

  const dataBytes = uri => {
    const i = String(uri).indexOf(',');
    if (i < 0) throw new Error('canvas 没给出 data URI');
    return fromB64(uri.slice(i + 1));
  };

  /* ---------- 四、PDF ---------- */

  /* 手拼一个最小 PDF 1.4：一页、一张 JPEG、一条把图铺满页面的内容流。
     JPEG 直接当 /DCTDecode 塞进去，不用自己压缩 —— canvas 已经压过了。
     页面尺寸按 SVG 的一半算点数：900×1200 的明信片出 450×600pt（6.25×8.33 英寸），
     配上 scale=2 的栅格就是 288dpi，印出来看不见马赛克。页面大小跟栅格倍数无关 ——
     调 scale 只改清晰度，不改纸的大小。
     xref 里的偏移量是「字节」偏移，所以从头到尾按 Uint8Array 拼，不能拿字符串数长度
     （JPEG 里的高位字节会让字符数和字节数对不上）。 */
  function pdfBytes(canvas, opt) {
    const o = opt || {};
    const jpg = dataBytes(canvas.toDataURL('image/jpeg', o.quality || .92));
    const ppt = o.ppt || .5;                                  // SVG 单位 → PDF 点
    const W = Math.round((o.w || canvas.width) * ppt);
    const H = Math.round((o.h || canvas.height) * ppt);
    const content = fromStr('q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q\n');
    const objs = [
      { d: '<</Type/Catalog/Pages 2 0 R>>' },
      { d: '<</Type/Pages/Kids[3 0 R]/Count 1>>' },
      { d: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' + W + ' ' + H + ']'
         + '/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>' },
      { d: '<</Type/XObject/Subtype/Image/Width ' + canvas.width + '/Height ' + canvas.height
         + '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + jpg.length + '>>',
        s: jpg },
      { d: '<</Length ' + content.length + '>>', s: content }
    ];

    const out = [], at = [];
    let len = 0;
    const put = x => { const b = typeof x === 'string' ? fromStr(x) : x; out.push(b); len += b.length; };

    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');   // 二进制标记：告诉工具链这不是纯文本
    objs.forEach((ob, i) => {
      at[i] = len;
      put((i + 1) + ' 0 obj\n' + ob.d);
      if (ob.s) { put('\nstream\n'); put(ob.s); put('\nendstream'); }
      put('\nendobj\n');
    });
    const xref = len;
    put('xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n');
    at.forEach(n => put(('0000000000' + n).slice(-10) + ' 00000 n \n'));
    put('trailer\n<</Size ' + (objs.length + 1) + '/Root 1 0 R>>\n'
      + 'startxref\n' + xref + '\n%%EOF\n');
    return join(out);
  }

  /* ---------- 五、存盘 ---------- */

  function save(bytes, name, mime) {
    if (typeof root.Blob !== 'function' || !root.URL || !root.URL.createObjectURL)
      throw new Error('这个环境不能触发下载 —— 换浏览器打开');
    const url = root.URL.createObjectURL(new root.Blob([bytes], { type: mime }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    if (a.remove) a.remove();
    if (root.setTimeout) root.setTimeout(() => root.URL.revokeObjectURL(url), 4000);
    return { name, size: bytes.length };
  }

  /* ---------- 六、三个出口 ---------- */

  // 文件名里的斜杠、冒号、引号都得清掉，不然 Windows 上存不下来
  const safe = s => String(s || 'card').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-|-$/g, '') || 'card';

  function svg(node, name) {
    const src = svgText(node, { font: false });     // SVG 留外链字体，体积小、还能再编辑
    return Promise.resolve(save(utf8(src.text), safe(name) + '.svg',
      'image/svg+xml;charset=utf-8'));
  }

  function png(node, name, opt) {
    return raster(node, opt).then(r => Object.assign(
      save(dataBytes(r.canvas.toDataURL('image/png')), safe(name) + '.png', 'image/png'),
      { font: r.font }));
  }

  function pdf(node, name, opt) {
    return raster(node, opt).then(r => Object.assign(
      save(pdfBytes(r.canvas, Object.assign({ w: r.w, h: r.h }, opt)),
        safe(name) + '.pdf', 'application/pdf'),
      { font: r.font }));
  }

  root.Bake = { svg, png, pdf, raster, svgText, pdfBytes, fontCss, save, sizeOf, safe };
})(typeof window !== 'undefined' ? window : globalThis);
