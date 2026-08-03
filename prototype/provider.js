/* 录入 provider（§4.6）：把「某一种输入」变成 Entry[]。
   录入是这类产品真正的门槛 —— 手工填 20 个字段没人愿意干，全自动又不可靠。
   所以抽象成可替换的 provider，每个只干一件事，产出一律带 confidence，
   一律先进「待确认」区，用户点确认才落库。

   四条边界，写代码时拿这四条自查：

   · **不碰 DOM、不碰 Store。** 输入是裸数据，输出是裸 Entry[]，**不带 id** ——
     id 由 Store.addEntry() 发，provider 不知道自己会落进哪一趟。
     所以 exif 收的是 {name, bytes} 而不是 File：读文件是浏览器的事，
     解析是纯函数的事，后者才测得动（test-page.js 里手搓一个 JPEG 喂进来）。
   · **parse() 是同步纯函数**，不是 §4.6 初稿里写的 `Promise<Entry[]>`。
     异步只出现在「读文件」那一步，归调用方。解析本身同输入必须同输出，
     否则 §7.1 的评测集没法当回归门槛用。
   · **漏解析比错解析可接受**（§7.1）。看不懂的行收进 `misses` 让用户自己看，
     不硬塞成 note —— 那是「错」，而错了用户不一定发现。
   · **provider 不写除自己产出之外的字段。** 城市坐标查不到就查不到（§3.2 一律不猜），
     缺汇率就把那一格标成「要人看一眼」，不静默当 1:1。
*/
(function (root) {
  'use strict';

  const K = root.Kernel;

  /* ================= 一、产出 ================= */

  /* low 是「这几格是猜的」的字段路径清单，页面据此高亮（§4.6）。
     不另发明一套打分：conf 是整条的可信度，low 指出具体哪一格要人看一眼。 */
  function mk(type, patch, conf, low) {
    const e = Object.assign({ type, title: '', time: {}, tags: [], data: {} }, patch || {});
    e.source = { confidence: conf == null ? 1 : conf };
    if (low && low.length) e.source.low = low;
    return e;
  }

  /* ================= 二、小解析器（都是纯函数） ================= */

  const pad = x => (x < 10 ? '0' : '') + x;
  const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);

  /* 日期：2026-03-14 / 2026/3/14 / 2026年3月14日 / 3月14日 / 3/14。缺年份用 year 补。
     **不认光秃秃的 `3-14`** —— 跟「3-14日」这种范围写法分不开，宁可漏（§7.1）。 */
  const RE_DATE = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?|(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})\s*日?/g;

  function dates(s, year) {
    const out = [];
    let m;
    RE_DATE.lastIndex = 0;
    while ((m = RE_DATE.exec(s))) {
      const y = +(m[1] || year), mo = +(m[2] || m[4]), d = +(m[3] || m[5]);
      if (y && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) out.push(iso(y, mo, d));
    }
    return out;
  }

  // 时间只认 09:20 这一种。「上午九点」不猜
  function clock(s) {
    const m = /\b(\d{1,2}):(\d{2})\b/.exec(s);
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return pad(+m[1]) + ':' + m[2];
  }

  const SIGN_CUR = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₩': 'KRW', '฿': 'THB' };
  const WORD_CUR = {
    '日元': 'JPY', '円': 'JPY', '美元': 'USD', '欧元': 'EUR', '英镑': 'GBP',
    '港币': 'HKD', '港元': 'HKD', '韩元': 'KRW', '泰铢': 'THB', '泰币': 'THB',
    '新台币': 'TWD', '元': null, '块': null
  };
  const WORDS = Object.keys(WORD_CUR).sort((a, b) => b.length - a.length).join('|');
  const AMT = '\\d[\\d,]*(?:\\.\\d+)?';
  // 三种写法：JPY 98,000 ／ ¥3,200 ／ 2000日元。¥ 和￥一律当基准币 ——
  // 数据里的金额就是这么写的，日元写成「日元/円/JPY」才算日元
  const RE_MONEY = new RegExp(
    '\\b([A-Z]{3})\\s+(' + AMT + ')' +
    '|([¥￥$€£₩฿])\\s*(' + AMT + ')' +
    '|(' + AMT + ')\\s*(' + WORDS + '|[A-Z]{3})');

  function money(s, base) {
    const m = RE_MONEY.exec(s);
    if (!m) return null;
    const amount = Number(String(m[2] || m[4] || m[5]).replace(/,/g, ''));
    if (!isFinite(amount) || amount <= 0) return null;
    let cur = base || 'CNY';
    if (m[1]) cur = m[1];
    else if (m[3]) cur = SIGN_CUR[m[3]] || cur;
    else if (m[6]) cur = /^[A-Z]{3}$/.test(m[6]) ? m[6] : (WORD_CUR[m[6]] || cur);
    return { amount, currency: cur, text: m[0] };
  }

  /* 地名 → 坐标表里的 key。IATA 码、中文地名、name、sub、name+sub 都认。
     认不出就是认不出（§3.2 一律不猜），不做模糊匹配。
     key 本身先占位，所以「上海」拿到的是「上海」这个 key，而不是 SHA 或 PVG。 */
  function placeIndex(places) {
    const idx = Object.create(null);
    const put = (k, v) => { k = String(k || '').trim(); if (k && !(k in idx)) idx[k] = v; };
    // `_` 是 places.json 里那条说明，不是地名
    const keys = Object.keys(places || {}).filter(k => k !== '_');
    keys.forEach(k => put(k, k));
    keys.forEach(k => {
      const p = places[k] || {};
      put(p.name, k);
      if (p.sub) { put(p.sub, k); put(String(p.name || '') + p.sub, k); }
    });
    const names = Object.keys(idx).sort((a, b) => b.length - a.length);   // 长的先匹配
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lat = names.filter(n => /^[A-Za-z]/.test(n)).map(esc);
    const cjk = names.filter(n => !/^[A-Za-z]/.test(n)).map(esc);
    // 拉丁的要 \b 夹住（否则 PVG 会在 UPVGX 里命中），中文的 \b 不管用，直接排列
    const src = [lat.length ? '\\b(?:' + lat.join('|') + ')\\b' : '',
                 cjk.length ? '(?:' + cjk.join('|') + ')' : ''].filter(Boolean).join('|');
    return { idx, re: src ? new RegExp(src, 'g') : null };
  }

  // 一行里出现的地名，按出现顺序、去重后给 key
  function findPlaces(s, pi) {
    if (!pi.re) return [];
    pi.re.lastIndex = 0;
    const out = [];
    let m;
    while ((m = pi.re.exec(s))) {
      const k = pi.idx[m[0]];
      if (k && out.indexOf(k) < 0) out.push(k);
      if (m.index === pi.re.lastIndex) pi.re.lastIndex++;   // 防空匹配死循环
    }
    return out;
  }

  /* ================= 三、词表 ================= */

  /* 花销类目只有这六档（§3.2 的表），所以词表也只需要认到这六档。
     一条都没命中就落「其他」并标成要人看一眼 —— 不硬猜成「吃」。 */
  const CATS = [
    [/打车|出租车|地铁|电车|巴士|大巴|公交|机票|车票|船票|租车|加油|过路|JR|新干线|高铁|动车/i, '交通'],
    [/酒店|旅馆|民宿|旅店|客栈|青旅|hotel|hostel|airbnb|住宿|住/i, '住'],
    [/早餐|午餐|晚餐|早饭|午饭|晚饭|拉面|寿司|居酒屋|咖啡|奶茶|甜品|烧肉|火锅|吃|餐/i, '吃'],
    [/门票|入场|通票|一日券|周游券|展|馆|入园/i, '门票'],
    [/买|购|纪念品|伴手礼|手信|扭蛋|药妆|免税/i, '购物']
  ];
  const catOf = s => {
    for (const [re, c] of CATS) if (re.test(s)) return c;
    return null;
  };

  const MODES = [
    [/航班|飞机|机票|✈|starflyer|air/i, 'air'],
    // 日本那边的私铁写法（小田急 / ロマンスカー / 特急）在行程单里很常见，
    // 认不出来会让整行退回「地点」，凭空多出两条假地点 —— 那是错解析，比漏更糟
    [/高铁|动车|火车|列车|新干线|新幹線|JR|铁路|铁道|次列车|轨道|特急|急行|电铁|小田急|京王|近铁|阪急|ロマンスカー/i, 'rail'],
    [/大巴|巴士|长途车|客运|bus/i, 'bus'],
    [/轮渡|渡轮|渡船|ferry/i, 'ferry'],
    [/自驾|租车|开车|驾车|car/i, 'car']
  ];
  const modeOf = s => {
    for (const [re, m] of MODES) if (re.test(s)) return m;
    return null;
  };

  const RE_FLIGHT = /\b([A-Z]{2}\d{2,4})\b/;
  // 车次得有「次」字或者本行别处已经说了是铁路 —— 否则「浦东 T1」里的 T1 会被当成车次
  const RE_TRAIN = /\b([GDCZKTS]\d{1,4})\b/;
  const RE_STAY = /入住|退房|check\s*-?\s*in|check\s*-?\s*out|酒店|旅馆|民宿|旅店|客栈|青旅|hotel|hostel|airbnb/i;
  const RE_IN = /入住|check\s*-?\s*in/i;
  const RE_OUT = /退房|check\s*-?\s*out/i;
  const RE_BOOKED = /已订|订单|已确认|确认单|已付|已支付|预订成功|confirmed|booked/i;
  const RE_DAY = /第\s*(\d{1,2})\s*天|day\s*(\d{1,2})/i;
  /* 箭头本身就是「从哪到哪」的信号，跟认不认得出交通工具无关。
     少了这条，「箱根 → 东京 小田急ロマンスカー」会退回第 4 支，切出两条假地点。
     只认明写的箭头和「至」，不认「到」—— 「到达京都」「3-14 到 3-17」都带「到」，
     误判成航段就是错解析。 */
  const RE_ARROW = /→|➔|⇒|->|—>|=>|至/;

  /* 标题 = 这一行去掉日期、时间、金额、关键词之后剩下的字。
     剩不下东西就用兜底文案，不把整行原样塞进标题（那会让卡片上出现「¥3,200」这种标题）。 */
  function label(line, extra) {
    let s = String(line).replace(new RegExp(RE_DATE.source, 'g'), ' ')
      .replace(/\b\d{1,2}:\d{2}\b/g, ' ');
    (extra || []).forEach(x => { if (x) s = s.split(x).join(' '); });
    return s.replace(/[，,。;；|·~～]+/g, ' ').replace(/[-–—]{1,}/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* ================= 四、text provider ================= */

  /* 输入是粘进来的一段话，**一行一条**：一行看不懂就收进 misses，不牵连别的行。
     词表和规则都在本文件里，不联网（§4.6）。
     ctx: {places, rates, baseCurrency, year, tripStart} —— 全是调用方喂进来的，
     provider 自己不去问 Store。 */
  function textParse(input, ctx) {
    ctx = ctx || {};
    const base = ctx.baseCurrency || 'CNY';
    const rates = ctx.rates || {};
    const year = ctx.year || new Date().getFullYear();
    const pi = placeIndex(ctx.places);
    const entries = [], misses = [];

    // 日期 → 这一趟的第几天。算不出来就是 null，不猜
    const dayOf = d => (ctx.tripStart && d)
      ? K.dayIndex({ time: { start: d } }, { time: { start: ctx.tripStart } }) : null;

    String(input == null ? '' : input).split(/\r?\n/).forEach(raw => {
      const line = raw.replace(/^[\s\-•*·○]+/, '').trim();
      if (!line) return;

      const ds = dates(line, year);
      const tm = clock(line);
      const mo = money(line, base);
      const md = modeOf(line);
      const pl = findPlaces(line, pi);
      const fl = RE_FLIGHT.exec(line);
      const tr = RE_TRAIN.exec(line);
      // 「浦东 T1」里的 T1 不是车次，所以要么带「次」字，要么本行别处说了是铁路
      const isTrain = !!(tr && (/次/.test(line) || md === 'rail'));
      const code = fl ? fl[1] : (isTrain ? tr[1] : '');

      /* --- 1) 航段：有航班号/车次，或者「认得出两个地名 + 说了交通方式或画了箭头」 --- */
      if (code || ((md || RE_ARROW.test(line)) && pl.length >= 2)) {
        const from = pl[0] || '', to = pl[1] || '';
        const low = [];
        if (!from) low.push('data.from');
        if (!to) low.push('data.to');
        // 认不出坐什么就留空，**不默认成飞机** —— 猜错了用户不一定发现（§7.1）
        const mode = md || (fl ? 'air' : isTrain ? 'rail' : '');
        if (!mode) low.push('data.mode');
        // 粘进来的基本都是订单，所以按「还没飞」算 —— 但这一格一定要人确认
        low.push('data.flown');
        entries.push(mk('leg', {
          title: code || (from && to ? from + ' → ' + to : label(line)),
          time: ds[0] ? { start: ds[0] + (tm ? 'T' + tm : '') } : {},
          data: { from, to, mode, code, flown: false }
        }, from && to && mode ? 0.8 : 0.5, low));
        return;
      }

      /* --- 2) 住宿：认「入住/退房」和一串住处的说法 --- */
      if (RE_STAY.test(line)) {
        const low = [];
        /* 只说了退房的那一行，日期是**离店**日 —— 塞进 checkIn 就是把一个错的
           入住日写进库里，比空着糟（§7.1）。所以先看这行说的是进还是出。 */
        const outOnly = RE_OUT.test(line) && !RE_IN.test(line) && ds.length === 1;
        const inD = outOnly ? '' : (ds[0] || '');
        const outD = outOnly ? ds[0] : (ds[1] || '');
        if (!inD || !outD) low.push('data.checkIn', 'data.checkOut');
        const booked = RE_BOOKED.test(line);
        if (!booked) low.push('data.booked');       // 没说「已订」就当没订，但要人看一眼
        const d = { checkIn: inD, checkOut: outD, booked };
        if (mo) { d.price = mo.amount; d.currency = mo.currency; }
        entries.push(mk('stay', {
          title: label(line, [mo && mo.text, '入住', '退房']) || '住宿',
          time: inD ? (outD ? { start: inD, end: outD } : { start: inD })
            : (outD ? { end: outD } : {}),
          data: d
        }, inD && outD ? 0.8 : 0.5, low));
        return;
      }

      /* --- 3) 花销：有金额，而且不属于上面两类 --- */
      if (mo) {
        const low = [];
        const cat = catOf(line);
        if (!cat) low.push('data.category');
        // 缺汇率的币种：Kernel.convert() 会返回 NaN 显式坏掉，所以这一格必须让人看一眼
        if (mo.currency !== base && rates[mo.currency] == null) low.push('data.currency');
        entries.push(mk('spend', {
          title: label(line, [mo.text]) || cat || '花销',
          time: ds[0] ? { start: ds[0] } : {},
          data: { amount: mo.amount, currency: mo.currency, category: cat || '其他' }
        }, cat ? 0.8 : 0.6, low));
        return;
      }

      /* --- 4) 去了哪儿。两条路，切开的方式不一样 ---
             · 「第 N 天 …」：这是人在列当天的行程，景点不在 places.json 里
               （那张表只管城市和机场），所以名字只能取原文切开。
             · 没说第几天、只是认出了地名：**就只收认出来的那几个地名**。
               不切原文 —— 「3-14 到 3-17 京都」切出来会是「3 / 14 / 到 / 17 / 京都」
               五条假地点，而错解析比漏解析糟（§7.1）。 */
      const dm = RE_DAY.exec(line);
      if (dm || pl.length) {
        const day = dm ? +(dm[1] || dm[2]) : dayOf(ds[0]);
        const city = pl[0] ? ((ctx.places || {})[pl[0]] || {}).name || pl[0] : '';
        const names = dm
          ? label(line, [dm[0]]).split(/[、/／]+|\s+/).map(s => s.trim())
            // 一个字的、纯数字的一律扔掉：那是切碎的日期和量词，不是地名
            .filter(s => s.length > 1 && !/^\d+$/.test(s))
          : pl.map(k => ((ctx.places || {})[k] || {}).name || k);
        if (!names.length) { misses.push({ line, why: '认出是地点，但没读出名字' }); return; }
        names.forEach(nm => entries.push(mk('place', {
          title: nm,
          place: { name: nm, city },
          time: ds[0] ? { start: ds[0] } : {},
          data: day ? { day } : {}
        }, day ? 0.7 : 0.5, day ? [] : ['data.day'])));
        return;
      }

      misses.push({ line, why: '看不出是航段 / 住宿 / 花销 / 地点' });
    });

    return { entries, misses };
  }

  /* ================= 五、manual provider ================= */

  /* 「手工填」也算一个 provider，不是「没有 provider」—— 否则「每条 entry 都带 source」
     这条就不成立，待确认区还得为手填的那条开特例。
     输入是明说了 type 的对象（或一串），confidence 恒为 1：人自己填的，不用再确认。 */
  const TYPES = ['leg', 'stay', 'spend', 'place', 'note', 'photo'];

  function manualParse(input) {
    const list = Array.isArray(input) ? input : [input];
    const entries = [], misses = [];
    list.forEach(o => {
      if (!o || TYPES.indexOf(o.type) < 0) {
        misses.push({ line: String((o && o.type) || o), why: '没说这是哪一类（' + TYPES.join('/') + '）' });
        return;
      }
      const patch = Object.assign({}, o);
      delete patch.type;
      delete patch.id;                  // id 由 Store.addEntry() 发，provider 不发
      delete patch.source;              // source 一律由 mk() 盖，不接受外面塞进来的可信度
      entries.push(mk(o.type, patch, 1));
    });
    return { entries, misses };
  }

  /* ================= 六、exif provider ================= */

  /* 输入是 [{name, bytes}]，bytes 给 Uint8Array 或普通数组都行 ——
     「读文件」是浏览器的事（FileReader），这里只认字节。所以测试里能手搓一个
     JPEG 喂进来，不需要真图、不需要 canvas。
     只读三样：拍摄时间、经纬度、拍摄日期。读不出就说读不出（§7.1 宁可漏）。 */

  // 读 n 字节无符号整数。le=小端
  function rd(b, i, n, le) {
    let v = 0;
    for (let k = 0; k < n; k++) v += (b[i + (le ? k : n - 1 - k)] || 0) * Math.pow(256, k);
    return v;
  }

  const TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  /* 一个 IFD entry 的值。t0 是 TIFF 头的字节位置，所有 offset 都相对它。
     值超过 4 字节才是 offset，否则就地存 —— 这条搞错的话读出来全是垃圾。 */
  function val(b, t0, e, le) {
    const type = rd(b, e + 2, 2, le), cnt = rd(b, e + 4, 4, le);
    const unit = TSIZE[type] || 0, size = unit * cnt;
    if (!size || cnt > 4096) return null;
    const at = size > 4 ? t0 + rd(b, e + 8, 4, le) : e + 8;
    if (at < 0 || at + size > b.length) return null;
    if (type === 2) {                                  // ASCII，末尾那个 \0 不要
      let s = '';
      for (let k = 0; k < cnt; k++) { const c = b[at + k]; if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    const out = [];
    for (let k = 0; k < cnt; k++) {
      if (type === 5 || type === 10) {                  // RATIONAL：分子 / 分母
        const n = rd(b, at + k * 8, 4, le), d = rd(b, at + k * 8 + 4, 4, le);
        out.push(d ? n / d : 0);
      } else out.push(rd(b, at + k * unit, unit, le));
    }
    return cnt === 1 ? out[0] : out;
  }

  // 一层 IFD → {tag: 值}
  function ifd(b, t0, at, le) {
    const out = {};
    if (at < 0 || at + 2 > b.length) return out;
    const n = rd(b, at, 2, le);
    for (let k = 0; k < n; k++) {
      const e = at + 2 + k * 12;
      if (e + 12 > b.length) break;
      out[rd(b, e, 2, le)] = val(b, t0, e, le);
    }
    return out;
  }

  // 度分秒 + N/S/E/W → 十进制。缺一样就算没有，不按 0 度当赤道
  function dms(v, ref) {
    if (!Array.isArray(v) || v.length < 3) return null;
    const d = v[0] + v[1] / 60 + v[2] / 3600;
    if (!isFinite(d)) return null;
    return /^[SW]/i.test(String(ref || '')) ? -d : d;
  }

  /* 在 JPEG 里找 APP1/Exif 段，读出 {at, day, ll}。
     不是 JPEG、没有 APP1、APP1 里没那几个 tag —— 一律返回 null，不硬凑。 */
  function exifOf(bytes) {
    const b = bytes || [];
    if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    let i = 2, t0 = -1;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF || m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += 2; continue; }
      if (m === 0xDA || m === 0xD9) break;             // 到图像数据了，后面不会再有 APP1
      const len = rd(b, i + 2, 2, false);
      if (len < 2) break;
      // "Exif\0\0" 之后就是 TIFF 头
      if (m === 0xE1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 &&
          b[i + 6] === 0x69 && b[i + 7] === 0x66) { t0 = i + 10; break; }
      i += 2 + len;
    }
    if (t0 < 0 || t0 + 8 > b.length) return null;
    const le = b[t0] === 0x49;                          // 'I' 小端 / 'M' 大端
    if (!le && b[t0] !== 0x4D) return null;
    const d0 = ifd(b, t0, t0 + rd(b, t0 + 4, 4, le), le);
    const ex = typeof d0[0x8769] === 'number' ? ifd(b, t0, t0 + d0[0x8769], le) : {};
    const gp = typeof d0[0x8825] === 'number' ? ifd(b, t0, t0 + d0[0x8825], le) : {};

    // 拍摄时间优先，没有才退回文件的修改时间（0x0132）
    const dt = String(ex[0x9003] || ex[0x9004] || d0[0x0132] || '');
    const dm = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})/.exec(dt);
    const at = dm ? dm[1] + '-' + dm[2] + '-' + dm[3] + 'T' + dm[4] + ':' + dm[5] : '';
    const la = dms(gp[2], gp[1]), lo = dms(gp[4], gp[3]);
    const ll = (la == null || lo == null || Math.abs(la) > 90 || Math.abs(lo) > 180)
      ? null : [Math.round(lo * 1e5) / 1e5, Math.round(la * 1e5) / 1e5];
    if (!at && !ll) return null;
    return { at, day: at ? at.slice(0, 10) : '', ll };
  }

  /* 两点球面距离（km）。只有一个用处：这张照片离表里哪个地方最近。
     反过来「地名 → 坐标」是 §3.2 那条「查不到就问人」，两件事别混。 */
  function km(a, b) {
    const r = Math.PI / 180, s = Math.sin, c = Math.cos;
    const v = s(a[1] * r) * s(b[1] * r) +
      c(a[1] * r) * c(b[1] * r) * c((b[0] - a[0]) * r);
    return 6371 * Math.acos(Math.max(-1, Math.min(1, v)));
  }

  /* 最近的已知地点。超出 NEAR 就当「表里没有」——
     硬认成 300km 外那座城市是「错解析」，比漏掉更糟（§7.1）。 */
  const NEAR = 60;
  function nearest(ll, places) {
    let best = '', bd = Infinity;
    Object.keys(places || {}).forEach(k => {
      if (k === '_') return;
      const p = places[k] || {};
      if (!Array.isArray(p.ll) || p.ll.length < 2) return;
      const d = km(ll, p.ll);
      if (d < bd) { bd = d; best = k; }
    });
    return bd <= NEAR ? { key: best, km: Math.round(bd) } : null;
  }

  /* 一堆照片 → 每张一条 photo，外加「哪天在哪儿」按天 × 地点去重后各一条 place。
     ctx: {places}。GPS 反查出来的只是「最近的城市」，不是「去了哪个景点」，
     所以那条 place 一律标成要人看一眼。 */
  function exifParse(input, ctx) {
    ctx = ctx || {};
    const places = ctx.places || {};
    const files = (Array.isArray(input) ? input : [input]).filter(Boolean);
    const entries = [], misses = [], seen = Object.create(null);

    files.forEach(f => {
      const name = String(f.name || '');
      const shot = { id: 'm', path: name, kind: 'photo', w: 150, h: 105 };
      const ex = exifOf(f.bytes);

      // 读不出 EXIF 的照片照样收：图是真的，只是不知道什么时候拍的
      if (!ex) {
        entries.push(mk('photo', { media: [shot] }, 0.5, ['time.start']));
        misses.push({ line: name, why: '读不出拍摄时间和坐标（不是 JPEG 或没写 EXIF）' });
        return;
      }
      entries.push(mk('photo', {
        media: [shot], time: ex.at ? { start: ex.at } : {}
      }, ex.at ? 0.9 : 0.6, ex.at ? [] : ['time.start']));

      if (!ex.ll || !ex.day) return;
      const near = nearest(ex.ll, places);
      if (!near) {
        misses.push({ line: name, why: '有坐标 ' + ex.ll[1] + ',' + ex.ll[0] +
          '，但表里 ' + NEAR + 'km 内没有已知地点' });
        return;
      }
      const k = ex.day + '|' + near.key;
      if (seen[k]) return;
      seen[k] = 1;
      const nm = (places[near.key] || {}).name || near.key;
      entries.push(mk('place', {
        title: nm, place: { name: nm, city: nm }, time: { start: ex.day }
      }, 0.6, ['place.name']));
    });

    return { entries, misses };
  }

  /* ================= 七、调度 ================= */

  /* 三个 provider 同一个接口：{id, label, hint, canHandle(input), parse(input, ctx)}。
     pick() 顺着问「你认这个输入吗」，第一个点头的就是它 —— manual 排最后当兜底。
     加第四个 provider（订单截图 OCR、日历 ics…）只是往这张表里加一行，
     页面和评测集都不用改：这就是把它抽象成 provider 的全部理由。 */
  const PROVIDERS = [
    { id: 'exif', label: '照片 EXIF', hint: '选一批照片，读拍摄时间和坐标',
      canHandle: i => Array.isArray(i) && i.length > 0 && i.every(f => f && f.bytes),
      parse: exifParse },
    { id: 'text', label: '粘一段文字', hint: '订单、行程单、随手记的几行，一行一条',
      canHandle: i => typeof i === 'string' && i.trim() !== '',
      parse: textParse },
    { id: 'manual', label: '手工填', hint: '自己说清是哪一类，直接落库',
      canHandle: i => !!i && typeof i === 'object',
      parse: manualParse }
  ];

  const byId = id => PROVIDERS.filter(p => p.id === id)[0] || null;
  const pick = input => PROVIDERS.filter(p => {
    try { return !!p.canHandle(input); } catch (e) { return false; }
  })[0] || null;

  /* 统一入口。在每条上盖一个 source.provider —— 落库之后还看得出这条是谁读出来的，
     出了问题知道该改哪个 provider 的规则。 */
  function parse(input, ctx, id) {
    const p = id ? byId(id) : pick(input);
    if (!p) return { provider: '', entries: [], misses: [{ line: '', why: '没有 provider 认这种输入' }] };
    const r = p.parse(input, ctx) || {};
    const entries = r.entries || [];
    entries.forEach(e => { e.source.provider = p.id; });
    return { provider: p.id, entries, misses: r.misses || [] };
  }

  root.Providers = {
    list: () => PROVIDERS.map(p => ({ id: p.id, label: p.label, hint: p.hint })),
    byId, pick, parse,
    // 小解析器单独露出来：评测集要能单独考一个字段，不必每次都走整条流水线
    parts: { mk, dates, clock, money, placeIndex, findPlaces, catOf, modeOf, label, exifOf, nearest }
  };
})(typeof window !== 'undefined' ? window : globalThis);
