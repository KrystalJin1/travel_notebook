/* 手绘渲染引擎（rough.js）—— 从 hand-drawn.html 抽出来，index.html 和样张页共用。
   对外只暴露 window.Sketch，不靠顶层 const 跨 <script> 共享（那样 vm 里的测试跑不通）。
   参数已定稿，见 docs/需求文档.md §4.5。 */
const NS = 'http://www.w3.org/2000/svg';
const mk = n => document.createElementNS(NS, n);

const C = {
  ink:'#2f2c26', ink2:'#7d7566', ink3:'#b3a894',
  blue:'#a9c6d6', lblue:'#cfe0e8', green:'#a3bd9a', red:'#e0917a',
  yellow:'#f0cd7f', pink:'#e9bdb0', snow:'#f7f8f6', sand:'#e6dcc6', paper:'#fdfbf5'
};

/* 已定稿的手绘参数：手抖 1.2 / 弯曲 1.5 / 笔粗 0.8 */
const S = { rough:1.2, bow:1.5, sw:0.8, color:true, hatch:false, pen:0 };

/* ---------- 插画库 ----------
   f  = 填色块（先画，会被压在墨线下面）
   无 f = 墨线；w = 笔粗倍数（细节线细）；s = 笔色（远景/纹理用淡墨拉开层次）
   画法：远景 → 中景 → 主体 → 前景，每层都有一点纹理（排线、点、涟漪），
   而不是一个轮廓一块色 —— 那样会像剪贴画。 */
const ART = {
  /* 河口湖：日 / 远山 / 富士 / 林线 / 湖面倒影 / 小舟 / 前景芦苇 */
  fuji:{ w:150, h:105, k:1.35, items:[
    {c:[126,21,9], f:C.yellow},
    {c:[126,21,9], w:.8, s:C.ink2},
    {d:'M126 8 V3 M141 21 h5 M136 11 l4-4 M136 31 l4 4', w:.6, s:C.ink3},
    {d:'M0 74 L22 54 Q26 51 30 55 L52 74 Z', f:C.sand},
    {d:'M96 74 L120 52 Q124 49 128 53 L150 74 Z', f:C.sand},
    {d:'M0 74 L22 54 Q26 51 30 55 L52 74', w:.65, s:C.ink2},
    {d:'M96 74 L120 52 Q124 49 128 53 L150 74', w:.65, s:C.ink2},
    {d:'M4 74 L50 20 Q57 13 64 20 L112 74 Z', f:C.blue},
    {d:'M36 40 L50 20 Q57 13 64 20 L80 40 L74 45 L67 36 L60 46 L53 35 L46 44 Z', f:C.snow},
    {d:'M4 74 L50 20 Q57 13 64 20 L112 74'},
    {d:'M36 40 L46 44 L53 35 L60 46 L67 36 L74 45 L80 40'},
    {d:'M50 20 q7 4 14 0', w:.75},
    {d:'M42 50 L39 63 M52 46 L49 60 M64 47 L67 60 M76 54 L79 65', w:.5, s:C.ink2},
    {d:'M0 76 V72 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 '
      + 'q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 V76 Z', f:C.green},
    {d:'M0 72 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 '
      + 'q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0 q7.5-7 15 0', w:.6},
    {c:[26,67,4.5], f:C.green}, {c:[26,67,4.5], w:.5, s:C.ink2},
    {c:[88,66,4], f:C.green}, {c:[88,66,4], w:.5, s:C.ink2},
    {c:[122,68,3.5], f:C.green}, {c:[122,68,3.5], w:.5, s:C.ink2},
    {d:'M0 76 H150 V103 H0 Z', f:C.lblue},
    {d:'M0 76 H150'},
    {d:'M32 81 q10-3 20 0 M48 86 q11-3 22 0 M38 91 q10-3 20 0', dash:[4,4], w:.5, s:C.ink2},
    {d:'M9 84 q7-4 14 0 M30 96 q7-4 14 0 M76 82 q7-4 14 0 '
      + 'M83 92 q7-4 14 0 M104 87 q7-4 14 0 M118 96 q7-4 14 0', w:.6, s:C.ink2},
    {c:[68,99,1.4], f:C.ink3}, {c:[126,84,1.2], f:C.ink3},
    {d:'M96 87 q10 1 20 0 q-3 7-10 7 q-7 0-10-7 Z', f:C.paper},
    {d:'M96 87 q10 1 20 0 q-3 7-10 7 q-7 0-10-7 Z', w:.85},
    {d:'M106 87 V79 M103 82 h6', w:.65},
    {d:'M4 103 Q7 95 6 87 M10 103 Q13 96 15 89 M16 103 Q17 97 14 92', w:.7, s:C.ink2},
    {c:[6,86,1.5], f:C.ink3}, {c:[15,88,1.3], f:C.ink3},
    {d:'M22 27 q4-4 8 0 M34 20 q3.5-3.5 7 0 M28 35 q3-3 6 0', w:.6, s:C.ink2}
  ]},
  /* 浅草：石板路 / 鸟居 / 挂灯笼 / 樱花枝 / 参道上的人 */
  torii:{ w:150, h:105, k:1.35, items:[
    {d:'M0 88 H150 V103 H0 Z', f:C.sand},
    {d:'M0 88 Q10 70 21 81 Q30 72 40 88 Z', f:C.green},
    {d:'M112 88 Q123 70 134 79 Q143 72 150 88 Z', f:C.green},
    {d:'M0 88 Q10 70 21 81 Q30 72 40 88', w:.65, s:C.ink2},
    {d:'M112 88 Q123 70 134 79 Q143 72 150 88', w:.65, s:C.ink2},
    {d:'M58 88 H92 L114 103 H36 Z', f:C.paper},
    {d:'M58 88 H92 L114 103 H36 Z', w:.8},
    {d:'M52 94 H98 M44 99 H106', w:.5, s:C.ink3},
    {d:'M18 22 Q75 12 132 22 L130 31 Q75 21 20 31 Z', f:C.red},
    {d:'M30 44 H120 V52 H30 Z', f:C.red},
    {d:'M40 28 H51 L53 88 H38 Z', f:C.red},
    {d:'M99 28 H110 L112 88 H97 Z', f:C.red},
    {d:'M71 32 H79 V44 H71 Z', f:C.red},
    {d:'M18 22 Q75 12 132 22 L130 31 Q75 21 20 31 Z'},
    {d:'M30 44 H120 V52 H30 Z'},
    {d:'M40 28 H51 L53 88 H38 Z'},
    {d:'M99 28 H110 L112 88 H97 Z'},
    {d:'M71 32 H79 V44 H71 Z'},
    {d:'M49 36 V50 M49 57 V71 M49 78 V86', w:.5, s:C.ink2},
    {d:'M108 36 V50 M108 57 V71 M108 78 V86', w:.5, s:C.ink2},
    {d:'M33 88 H57 M93 88 H117', w:.9},
    {d:'M60 52 V57 M84 52 V57', w:.65},
    {d:'M54 57 H67 V66 H54 Z', f:C.paper},
    {d:'M78 57 H91 V66 H78 Z', f:C.paper},
    {d:'M54 57 H67 V66 H54 Z', w:.8}, {d:'M78 57 H91 V66 H78 Z', w:.8},
    {d:'M56 60 h9 M56 63 h9 M80 60 h9 M80 63 h9', w:.5, s:C.ink3},
    {d:'M0 7 Q24 12 41 3 M17 10 q4 6 2 11 M31 7 q3 6 8 9', w:.8},
    {c:[13,17,3.2], f:C.pink}, {c:[24,12,2.6], f:C.pink},
    {c:[38,15,3], f:C.pink}, {c:[5,4,2.4], f:C.pink},
    {c:[13,17,.9], f:C.ink3}, {c:[38,15,.9], f:C.ink3},
    {d:'M71 88 q0-11 4-11 q4 0 4 11 Z', f:C.ink2},
    {c:[75,73,3], f:C.ink2},
    {d:'M68 89 h14', w:.55, s:C.ink3},
    {d:'M120 12 q4-4 8 0 M132 8 q3-3 6 0', w:.6, s:C.ink2},
    {c:[24,96,1.5], f:C.ink3}, {c:[126,93,1.4], f:C.ink3}, {c:[16,100,1.2], f:C.ink3}
  ]},
  /* 新宿：电线在最底层（被楼挡住，只在天空露出来）→ 楼 → 招牌布帘 → 电杆 → 路上的人 */
  street:{ w:150, h:105, k:1.35, items:[
    {d:'M0 90 H150 V103 H0 Z', f:C.sand},
    {d:'M0 33 Q70 41 140 31 M0 39 Q70 47 140 37 M0 45 Q70 52 140 43', w:.45, s:C.ink3},
    {d:'M2 90 V42 H34 V90 Z', f:C.lblue},
    {d:'M38 90 V24 H70 V90 Z', f:C.pink},
    {d:'M74 90 V52 H100 V90 Z', f:C.yellow},
    {d:'M104 90 V34 H132 V90 Z', f:C.green},
    {d:'M134 90 V60 H149 V90 Z', f:C.lblue},
    {d:'M2 90 V42 H34 V90'}, {d:'M38 90 V24 H70 V90'},
    {d:'M74 90 V52 H100 V90'}, {d:'M104 90 V34 H132 V90'},
    {d:'M134 90 V60 H149 V90'},
    {d:'M44 24 V17 H55 V24 M60 24 V11 M56 15 h8', w:.7},
    {d:'M112 34 V28 H122 V34', w:.7},
    {d:'M6 47 h7 v6 h-7 Z', f:C.yellow}, {d:'M24 58 h7 v6 h-7 Z', f:C.yellow},
    {d:'M42 31 h7 v6 h-7 Z', f:C.yellow}, {d:'M60 44 h7 v6 h-7 Z', f:C.yellow},
    {d:'M78 59 h6 v6 h-6 Z', f:C.yellow}, {d:'M108 41 h7 v6 h-7 Z', f:C.yellow},
    {d:'M122 54 h7 v6 h-7 Z', f:C.yellow},
    {d:'M6 47 h7 v6 h-7 Z M24 58 h7 v6 h-7 Z M42 31 h7 v6 h-7 Z '
      + 'M60 44 h7 v6 h-7 Z M78 59 h6 v6 h-6 Z M108 41 h7 v6 h-7 Z M122 54 h7 v6 h-7 Z', w:.6},
    {d:'M6 58 h7 M6 69 h7 M24 47 h7 M24 69 h7 M42 42 h7 M42 53 h7 M42 64 h7 '
      + 'M60 33 h7 M60 55 h7 M60 66 h7 M78 70 h6 M90 59 h6 M90 70 h6 '
      + 'M108 52 h7 M108 63 h7 M122 43 h7 M122 65 h7', w:.5, s:C.ink2},
    {d:'M26 44 h10 v22 h-10 Z', f:C.red},
    {d:'M26 44 h10 v22 h-10 Z', w:.75},
    {d:'M29 49 h4 M29 55 h4 M29 61 h4', w:.55, s:C.paper},
    {d:'M62 36 h7 v16 h-7 Z', f:C.blue}, {d:'M62 36 h7 v16 h-7 Z', w:.7},
    {d:'M4 76 H33 V90 H4 Z', f:C.paper}, {d:'M4 76 H33 V90 H4 Z', w:.8},
    {d:'M5 76 H32 V80 H5 Z', f:C.red},
    {d:'M11 76 V80 M18 76 V80 M25 76 V80', w:.5, s:C.paper},
    {d:'M8 82 h7 v8 h-7 Z', w:.7},
    {d:'M20 82 h9 v6 h-9 Z', f:C.lblue}, {d:'M20 82 h9 v6 h-9 Z', w:.6},
    {d:'M40 78 H70 V90 H40 Z', f:C.snow}, {d:'M40 78 H70 V90 H40 Z', w:.8},
    {d:'M44 82 h8 v8 h-8 Z', w:.7}, {d:'M56 82 h10 v6 h-10 Z', f:C.lblue},
    {d:'M56 82 h10 v6 h-10 Z', w:.6},
    {d:'M106 90 V74 H120 V90 Z', f:C.snow}, {d:'M106 90 V74 H120 V90', w:.8},
    {d:'M106 74 H120 V78 H106 Z', f:C.red},
    {d:'M107 80 h5 v4 h-5 Z M114 80 h5 v4 h-5 Z', w:.5, s:C.ink2},
    {d:'M107 86 h7', w:.5, s:C.ink2}, {c:[118,87,.9], f:C.ink2},
    {d:'M139 90 V30 M133 36 h13 M134 43 h11', w:.9},
    {d:'M19 88 q0-8 3.4-8 q3.4 0 3.4 8 Z', f:C.ink2},
    {c:[22.4,77.5,2.5], f:C.ink2},
    {d:'M85 88 q0-7 3-7 q3 0 3 7 Z', f:C.ink2},
    {c:[88,79,2.2], f:C.ink2},
    {d:'M96 89 q0-5.5 2.4-5.5 q2.4 0 2.4 5.5 Z', f:C.ink3},
    {c:[98.4,81.5,1.8], f:C.ink3},
    {d:'M4 97 H146', dash:[6,6], w:.8, s:C.ink2},
    {d:'M0 90 H150'},
    {d:'M124 70 q4-5 0-9 M127 66 q3-4 0-7', w:.55, s:C.ink3}
  ]},
  arc:{ w:200, h:46, k:1.2, items:[
    {d:'M10 36 Q100 -6 190 36', dash:[1,7]},
    {d:'M92 11 l17 7 -17 7 4-7 Z', f:C.ink, keep:true},
    {c:[10,36,4], f:C.red}, {c:[10,36,4]},
    {c:[190,36,4]}
  ]},
  /* ---- 22px 图标 ---- */
  'ico-hotel':{ w:24, h:24, k:1, items:[
    {d:'M3 20 V6 H21 V20 Z', f:C.lblue},
    {d:'M3 20 V6 H21 V20 M3 12 H21 M7 9 h2 M7 16 h2 M15 9 h2 M15 16 h2'}
  ]},
  'ico-cal':{ w:24, h:24, k:1, items:[
    {d:'M3.5 5.5 H20.5 V20.5 H3.5 Z', f:C.yellow},
    {d:'M3.5 5.5 H20.5 V20.5 H3.5 Z M3.5 10 H20.5 M8 3 V7 M16 3 V7 M8 14 h3 M8 17 h6'}
  ]},
  'ico-pin':{ w:24, h:24, k:1, items:[
    {d:'M12 21 C12 21 19 14.8 19 10 A7 7 0 0 0 5 10 C5 14.8 12 21 12 21 Z', f:C.green},
    {d:'M12 21 C12 21 19 14.8 19 10 A7 7 0 0 0 5 10 C5 14.8 12 21 12 21 Z'},
    {c:[12,10,2.6]},
    {d:'M8 22 h8', w:.5, s:C.ink3}
  ]},
  'ico-wallet':{ w:24, h:24, k:1, items:[
    {d:'M4 6 H19 V20 H4 Z', f:C.pink},
    {d:'M4 6 H19 V20 H4 Z M4 10 H21 V16 H15 Q13 13 15 10 Z'},
    {c:[16.6,13,1.2]},
    {d:'M6 8 h9', w:.5, s:C.ink2}
  ]},
  /* ---- 贴纸（60×60）。每个都带一点「用过的痕迹」：投影排线、高光、内容细节 ---- */
  plane:{ w:60, h:60, k:.85, items:[
    {d:'M6 33 L54 11 L34 50 L27 36 Z', f:C.lblue},
    {d:'M6 33 L54 11 L34 50 L27 36 Z'},
    {d:'M6 33 L27 36 L54 11'},
    {d:'M27 36 L36 31 L34 50', w:.6, s:C.ink2},
    {c:[16,31,1.1], f:C.ink3}, {c:[22,28,1.1], f:C.ink3}, {c:[28,25,1.1], f:C.ink3},
    {d:'M2 41 q10 3 20 0 M6 46 q8 2 16 0', dash:[3,4], w:.55, s:C.ink3},
    {d:'M14 53 h22', w:.7, s:C.ink3}
  ]},
  camera:{ w:60, h:60, k:.85, items:[
    {d:'M8 20 H52 V47 H8 Z', f:C.yellow},
    {d:'M21 13 H33 V20 H21 Z', f:C.yellow},
    {c:[30,33,9], f:C.lblue},
    {d:'M8 20 H52 V47 H8 Z'},
    {d:'M21 13 H33 V20'},
    {c:[30,33,9]}, {c:[30,33,4]},
    {c:[27,30,1.4], f:C.snow},
    {d:'M43 25 h5'}, {c:[14,25,1.6]},
    {d:'M12 41 h7 M12 44 h4', w:.5, s:C.ink2},
    {d:'M8 24 Q2 18 6 12 M52 24 Q58 18 54 12', w:.6, s:C.ink2},
    {d:'M12 51 h36', w:.7, s:C.ink3}
  ]},
  coffee:{ w:60, h:60, k:.85, items:[
    {d:'M13 23 H39 V36 Q39 47 26 47 Q13 47 13 36 Z', f:C.pink},
    {d:'M13 23 H39 V36 Q39 47 26 47 Q13 47 13 36 Z'},
    {d:'M39 27 Q48 28 48 34 Q48 40 39 41'},
    {d:'M15 27 H37', w:.6, s:C.ink2},
    {d:'M26 30 q4 3 0 6 q-4 3 0 6', w:.55, s:C.ink2},
    {d:'M34 38 V44 M36 37 V43', w:.5, s:C.ink3},
    {d:'M9 51 H49'},
    {d:'M14 51 q12 4 24 0', w:.6, s:C.ink3},
    {d:'M21 17 q5-6 0-11 M31 17 q5-6 0-11'},
    {c:[42,49,1.3], f:C.ink3}
  ]},
  ramen:{ w:60, h:60, k:.85, items:[
    {d:'M9 27 H51 Q48 48 30 48 Q12 48 9 27 Z', f:C.red},
    {d:'M9 27 H51 Q48 48 30 48 Q12 48 9 27 Z'},
    {d:'M13 33 H47'},
    {d:'M15 40 q6 4 12 0 M32 42 q6 4 12 0', w:.5, s:C.paper},
    {d:'M18 24 q6-8 12-2 q6 6 12-2'},
    {c:[21,27,4], f:C.snow}, {c:[21,27,4], w:.7},
    {c:[21,27,1.7], f:C.yellow},
    {d:'M33 22 h10 v7 h-10 Z', f:C.ink2},
    {c:[29,25,1.1], f:C.green}, {c:[45,26,1.1], f:C.green},
    {d:'M33 8 L53 22 M37 6 L57 20'},
    {d:'M14 52 h32', w:.7, s:C.ink3}
  ]},
  luggage:{ w:60, h:60, k:.85, items:[
    {d:'M13 20 H47 V48 H13 Z', f:C.green},
    {d:'M13 20 H47 V48 H13 Z'},
    {d:'M24 20 V13 H36 V20'},
    {d:'M22 25 V43 M38 25 V43'},
    {d:'M28 28 h4 v4 h-4 Z', f:C.red}, {d:'M28 28 h4 v4 h-4 Z', w:.6},
    {c:[30,39,3], f:C.yellow}, {c:[30,39,3], w:.6},
    {d:'M15 22 h4 M41 22 h4 M15 46 h4 M41 46 h4', w:.55, s:C.ink2},
    {d:'M26 16 q4-3 8 0', w:.6, s:C.ink2},
    {c:[19,52,3]}, {c:[41,52,3]},
    {d:'M16 56 h28', w:.7, s:C.ink3}
  ]},
  onsen:{ w:60, h:60, k:.85, items:[
    {d:'M10 33 H50 Q50 48 30 48 Q10 48 10 33 Z', f:C.lblue},
    {d:'M10 33 H50 Q50 48 30 48 Q10 48 10 33 Z'},
    {d:'M6 33 H54'},
    {d:'M15 39 q6-3 12 0 M32 42 q6-3 12 0', w:.55, s:C.ink2},
    {c:[18,45,2.2], f:C.ink3}, {c:[42,44,1.8], f:C.ink3},
    {d:'M20 28 q7-5 0-10 q-7-5 0-9'},
    {d:'M30 28 q7-5 0-10 q-7-5 0-9'},
    {d:'M40 28 q7-5 0-10 q-7-5 0-9'},
    {d:'M25 24 q4-3 0-6 M35 24 q4-3 0-6', w:.5, s:C.ink3},
    {d:'M12 52 h36', w:.7, s:C.ink3}
  ]},
  ticket:{ w:60, h:60, k:.85, items:[
    {d:'M6 19 H54 V45 H6 Z', f:C.yellow},
    {d:'M6 19 H54 V45 H6 Z'},
    {d:'M36 19 V45', dash:[2,4]},
    {d:'M12 27 h18 M12 34 h13'},
    {d:'M12 39 h10', w:.5, s:C.ink2},
    {d:'M40 24 V40 M42.5 24 V40 M45 25 V39 M48 24 V40 M50 26 V38', w:.5, s:C.ink2},
    {c:[45,32,5]},
    {d:'M6 24 q-3 3 0 6 M54 24 q3 3 0 6', w:.6, s:C.ink2},
    {d:'M10 49 h30', w:.7, s:C.ink3}
  ]},
  stamp:{ w:60, h:60, k:.85, items:[
    {d:'M8 8 H52 V52 H8 Z', f:C.paper},
    {d:'M15 40 L26 22 Q29 18 32 22 L44 40 Z', f:C.blue},
    {d:'M8 8 H52 V52 H8 Z', dash:[3,3]},
    {d:'M12 12 H48 V48 H12 Z', w:.5, s:C.ink3},
    {d:'M15 40 L26 22 Q29 18 32 22 L44 40'},
    {d:'M22 31 L26 26 L30 31', w:.55, s:C.snow},
    {c:[40,18,4], f:C.red}, {c:[40,18,4]},
    {d:'M13 40 H47'},
    {d:'M16 36 h8 M34 37 h9', w:.5, s:C.ink2},
    {c:[41,41,8], w:.6, s:C.ink2}, {c:[41,41,5.5], w:.5, s:C.ink2},
    {tx:'JPN', x:30, y:50, s:8}
  ]}
};
/* ---------- 通用绘制 ---------- */
function opts(extra, seed, kScale){
  const k = kScale || 1;
  return Object.assign({
    roughness: S.rough,
    bowing: S.bow,
    strokeWidth: S.sw * k,
    stroke: C.ink,
    seed: seed + S.pen * 977,
    fill: undefined,
    preserveVertices: false
  }, extra);
}

function shape(rc, it, seed, k){
  // 填色块
  if (it.f) {
    if (!S.color && !it.keep) return null;
    // 色块的抖动要比墨线小得多：rough.js 的 solid 填充是沿「抖过的轮廓」铺色，
    // 用墨线那档参数会把细长矩形涂成一片叶子，看着像没画准而不是手绘。
    const o = opts({
      fill: it.f,
      fillStyle: it.keep ? 'solid' : (S.hatch ? 'hachure' : 'solid'),
      fillWeight: S.sw * k * .9,
      hachureGap: 3.6,
      hachureAngle: -41,
      stroke: 'none',
      roughness: S.rough * (S.hatch ? .8 : .45),
      bowing: S.bow * .45
    }, seed, k);
    const n = it.c ? rc.circle(it.c[0], it.c[1], it.c[2] * 2, o) : rc.path(it.d, o);
    // 色块故意错开一点，像蜡笔涂出格
    if (!it.keep) n.setAttribute('transform', 'translate(.6,.8)');
    return n;
  }
  // 文字（手写体，不抖）
  if (it.tx) {
    const t = mk('text');
    t.setAttribute('x', it.x); t.setAttribute('y', it.y);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', it.s);
    t.setAttribute('fill', C.ink);
    t.setAttribute('font-family', "MarkerGothic, sans-serif");
    t.setAttribute('letter-spacing', '.5');
    t.textContent = it.tx;
    return t;
  }
  // 墨线。w = 笔粗倍数（细节线细一点），s = 换笔色（远景/纹理用淡墨）
  const o = opts({ fill: 'none' }, seed, k);
  if (it.s) o.stroke = it.s;
  if (it.w) o.strokeWidth = S.sw * k * it.w;
  if (it.dash) o.strokeLineDash = it.dash;
  return it.c ? rc.circle(it.c[0], it.c[1], it.c[2] * 2, o) : rc.path(it.d, o);
}

function drawArt(host){
  const spec = ART[host.dataset.art];
  if (!spec) { host.textContent = '?' + host.dataset.art; return; }
  const svg = mk('svg');
  svg.setAttribute('viewBox', `0 0 ${spec.w} ${spec.h}`);
  svg.setAttribute('class', 'art');
  const rc = rough.svg(svg);
  const k = spec.k || 1;
  spec.items.forEach((it, i) => {
    const n = shape(rc, it, hash(host.dataset.art) + i * 13, k);
    if (n) svg.appendChild(n);
  });
  while (host.firstChild) host.removeChild(host.firstChild);
  host.appendChild(svg);
}

function hash(s){ let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h; }
/* ---------- 手绘 UI 描边：边框 / 分割线 / 横格 / 进度条 ---------- */
function paintFrame(el){
  const t = el.dataset.frame;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  Array.prototype.slice.call(el.children).forEach(n => {
    if (n.tagName && n.tagName.toLowerCase() === 'svg' && n.getAttribute('class') === 'frame') n.remove();
  });

  const svg = mk('svg');
  svg.setAttribute('class', 'frame');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const rc = rough.svg(svg);
  const seed = (+el.dataset.seed || 1);
  const stroke = el.dataset.stroke;
  const add = n => svg.appendChild(n);

  if (t === 'rect') {
    const fill = el.dataset.fill;
    if (fill && S.color) {
      add(rc.rectangle(2.5, 2.5, w - 5, h - 5, opts({
        fill, fillStyle: S.hatch ? 'hachure' : 'solid', hachureGap: 4,
        stroke: 'none', roughness: S.rough * 1.1
      }, seed + 3)));
    }
    add(rc.rectangle(2, 2, w - 4, h - 4, opts({
      fill: 'none', stroke: stroke || C.ink, strokeWidth: S.sw * .95
    }, seed)));
  }
  else if (t === 'hr')   add(rc.line(0, 1.5, w, 1.5, opts({ stroke: stroke || C.ink3 }, seed)));
  else if (t === 'hr-b') add(rc.line(0, h - 1.5, w, h - 1.5, opts({ stroke: stroke || C.ink3 }, seed)));
  else if (t === 'rules') {
    for (let y = 32, i = 0; y < h + 6; y += 32, i++)
      add(rc.line(0, y, w, y, opts({ stroke: '#d9cdb4', strokeWidth: S.sw * .8 }, seed + i * 7)));
  }
  else if (t === 'bar') {
    const pct = (+el.dataset.pct || 0) / 100;
    add(rc.rectangle(1, 2, w - 2, h - 4, opts({ stroke: C.ink3, strokeWidth: S.sw * .8 }, seed)));
    add(rc.rectangle(1, 2, (w - 2) * pct, h - 4, opts({
      fill: C.green, fillStyle: 'hachure', hachureGap: 3, hachureAngle: -45,
      fillWeight: S.sw * .9, stroke: 'none'
    }, seed + 5)));
  }
  el.insertBefore(svg, el.firstChild);
}

/* ---------- washi 胶带 ---------- */
function paintTape(el){
  const w = 112, h = 28;
  while (el.firstChild) el.removeChild(el.firstChild);
  const svg = mk('svg');
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const rc = rough.svg(svg);
  const seed = +el.dataset.seed || 3;
  const col = S.color ? (el.dataset.tape || '#a8c8b4') : '#e8e4da';
  svg.appendChild(rc.path(`M3 3 L${w - 4} 6 L${w - 2} ${h - 5} L5 ${h - 3} Z`, opts({
    fill: col, fillStyle: 'solid', stroke: 'none', roughness: S.rough * 1.2
  }, seed)));
  svg.appendChild(rc.path(`M3 3 L${w - 4} 6 L${w - 2} ${h - 5} L5 ${h - 3} Z`, opts({
    fill: 'none', stroke: 'rgba(255,255,255,.55)', strokeWidth: S.sw * .7
  }, seed + 2)));
  for (let x = 14; x < w - 12; x += 15)
    svg.appendChild(rc.line(x, 5, x - 4, h - 4, opts({
      stroke: 'rgba(255,255,255,.4)', strokeWidth: S.sw * .6
    }, seed + x)));
  el.appendChild(svg);
}
/* ---------- 渲染调度 ---------- */
function paintArt(){ document.querySelectorAll('[data-art]').forEach(drawArt); }
function paintChrome(){
  document.querySelectorAll('[data-frame]').forEach(paintFrame);
  document.querySelectorAll('[data-tape]').forEach(paintTape);
}
function paintAll(){ paintArt(); paintChrome(); }

/* ---------- 自检：任何异常都显示在面板上，不要静默失败 ---------- */
let nPaint = 0;
function say(msg){
  const d = document.getElementById('dbg');
  if (!d) return;
  d.style.color = msg ? '#b0483a' : '';
  d.textContent = msg ? '⚠ ' + msg
    : `rough=${typeof rough} · 重绘 ${nPaint} 次 · 手抖 ${S.rough} / 弯曲 ${S.bow} / 笔粗 ${S.sw}`
      + (S.color ? ' · 上色开' : ' · 上色关');
}
function repaint(){
  nPaint++;
  try { paintAll(); say(''); }
  catch (e) { say(e.message); console.error(e); }
}
/* ---------- 调参面板（没有这些控件的页面自动跳过） ---------- */
function bindPanel(){
  if (!document.getElementById('c-rough')) return;
  const bind = (id, key, out) => {
    const inp = document.getElementById(id);
    if (!inp) { say('找不到控件 #' + id); return; }
    const lab = out && document.getElementById(out);
    const apply = () => {
      S[key] = inp.type === 'checkbox' ? inp.checked : +inp.value;
      if (lab) lab.textContent = (+inp.value).toFixed(1);
      repaint();
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('change', apply);
    if (lab) lab.textContent = (+inp.value).toFixed(1);
  };
  bind('c-rough', 'rough', 'v-rough');
  bind('c-bow',   'bow',   'v-bow');
  bind('c-sw',    'sw',    'v-sw');
  bind('c-color', 'color');
  bind('c-hatch', 'hatch');
  const sb = document.getElementById('c-seed');
  if (sb) sb.addEventListener('click', () => {
    S.pen++; repaint();
    if (window.handtype) window.handtype.reseed();   // 标题也换一支笔
  });
}

window.Sketch = {
  S, C, ART, mk, hash, opts,
  drawArt, paintFrame, paintTape, paintArt, paintChrome, paintAll,
  repaint, say, bindPanel
};
