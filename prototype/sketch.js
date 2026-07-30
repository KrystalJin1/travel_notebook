/* 手绘渲染引擎 —— 插画库（ART）+ 手绘 UI 描边。index.html 和样张页共用。
   对外只暴露 window.Sketch，不靠顶层 const 跨 <script> 共享（那样 vm 里的测试跑不通）。
   参数已定稿，见 docs/需求文档.md §4.5。

   笔、颜料、rough 调用都在 draw.js 里（§6.1）：ART 解释器只跟 draw 说话，
   这样明信片拼贴能复用同一批插图，小程序端换 canvas 后端时这里一行都不用改。 */
const NS = Draw.NS;
const mk = Draw.mk;
const C = Draw.C;
const S = Draw.S;
const opts = Draw.opts;

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
  /* 蒙马特台阶：圆顶教堂在最远 → 两侧的树 → 长石阶 → 路灯 → 前景长椅 */
  stair:{ w:150, h:105, k:1.35, items:[
    {d:'M4 12 q9-5 18 0 M116 9 q9-4 18 0', w:.5, s:C.ink3},
    {d:'M0 62 H150 V103 H0 Z', f:C.green},
    {d:'M8 72 l3 5 M22 76 l3 5 M138 88 l3 5 M146 96 l3 5', w:.5, s:C.ink2},
    /* 教堂：一大两小三个圆顶，横向比台阶顶端宽出一截 —— 一样宽会读成一座金字塔 */
    {d:'M44 44 H106 V62 H44 Z', f:C.paper},
    {d:'M48 46 Q54 32 60 46 Z', f:C.snow}, {d:'M90 46 Q96 32 102 46 Z', f:C.snow},
    {d:'M66 44 Q75 14 84 44 Z', f:C.snow},
    {d:'M44 44 H106 V62 H44 Z'},
    {d:'M48 46 Q54 32 60 46 M90 46 Q96 32 102 46', w:.7},
    {d:'M66 44 Q75 14 84 44'},
    {d:'M75 29 V22 M72 25 h6', w:.7},
    {d:'M71 62 V53 q4-5 8 0 V62', w:.6, s:C.ink2},
    {d:'M53 56 V51 q2.5-3 5 0 V56 M92 56 V51 q2.5-3 5 0 V56', w:.5, s:C.ink2},
    {d:'M44 49 H106', w:.5, s:C.ink3},
    {c:[20,50,11], f:C.green}, {c:[20,50,11], w:.6, s:C.ink2},
    {d:'M20 61 V72', w:.75, s:C.ink2},
    {c:[130,52,11], f:C.green}, {c:[130,52,11], w:.6, s:C.ink2},
    {d:'M130 63 V74', w:.75, s:C.ink2},
    /* 教堂门前的平台：把建筑和台阶隔开一截，台阶才不会长到墙根上 */
    {d:'M40 62 H110 V68 H40 Z', f:C.sand}, {d:'M40 68 H110', w:.7},
    {d:'M62 68 H88 L112 103 H38 Z', f:C.sand},
    {d:'M62 68 H88 L112 103 H38 Z'},
    {d:'M57.9 74 H92.1 M53.8 80 H96.2 M49.7 86 H100.3 M45.5 92 H104.5 M41.4 98 H108.6',
      w:.6, s:C.ink2},
    {d:'M75 68 V103', dash:[5,5], w:.55, s:C.ink3},
    {d:'M36 98 L33 68', w:.9}, {c:[33,65,3.4], f:C.yellow}, {c:[33,65,3.4], w:.7},
    {d:'M27 60 l-4-3 M39 60 l4-3 M33 58 V54', w:.5, s:C.ink3},
    {d:'M118 101 L121 72', w:.9}, {c:[121,69,3], f:C.yellow}, {c:[121,69,3], w:.7},
    {d:'M64 90 q0-7 3-7 q3 0 3 7 Z', f:C.ink2}, {c:[67,81,2.3], f:C.ink2},
    {d:'M86 84 q0-6 2.6-6 q2.6 0 2.6 6 Z', f:C.ink3}, {c:[88.6,76,2], f:C.ink3},
    {d:'M2 90 H24 V94 H2 Z', f:C.sand}, {d:'M2 90 H24 V94 H2 Z', w:.7},
    {d:'M4 84 H24 V88 H4 Z', w:.7},
    {d:'M5 94 V101 M21 94 V101', w:.7}
  ]},
  /* 跨年夜的河：夜空 + 烟火 → 对岸楼群 → 钟楼 → 河面倒影 → 桥（最前）
     全场只有这一张是夜色，天空平涂淡墨，亮的地方靠黄色点出来 */
  river:{ w:150, h:105, k:1.35, items:[
    {d:'M0 0 H150 V70 H0 Z', f:C.ink2},
    {c:[18,10,1], f:C.snow}, {c:[46,6,.9], f:C.snow}, {c:[66,15,.8], f:C.snow},
    {c:[134,8,1], f:C.snow},
    {d:'M34 22 V10 M34 22 V34 M34 22 H22 M34 22 H46 M34 22 l-8-8 M34 22 l8 8 '
      + 'M34 22 l8-8 M34 22 l-8 8', w:.6, s:C.yellow},
    {c:[34,9,1.2], f:C.yellow}, {c:[43,13,1.1], f:C.yellow}, {c:[25,31,1.1], f:C.yellow},
    {d:'M120 20 V12 M120 20 V28 M120 20 h-8 M120 20 h8 M120 20 l-6-6 M120 20 l6 6',
      w:.55, s:C.red},
    {c:[120,11,1], f:C.red}, {c:[127,27,1], f:C.red},
    {d:'M0 70 V50 H14 V70 Z', f:C.ink3}, {d:'M18 70 V42 H32 V70 Z', f:C.ink3},
    {d:'M50 70 V56 H70 V70 Z', f:C.ink3}, {d:'M55 56 Q60 45 65 56 Z', f:C.ink3},
    {d:'M60 45 V40', w:.6, s:C.ink3},
    {d:'M4 55 h3 M9 61 h3 M22 47 h3 M27 55 h3 M56 62 h3 M63 62 h3', w:.7, s:C.yellow},
    {d:'M96 70 V30 H112 V70 Z', f:C.sand},
    {d:'M95 30 L104 13 L113 30 Z', f:C.sand},
    {d:'M96 70 V30 H112 V70'}, {d:'M95 30 L104 13 L113 30 Z'},
    {c:[104,39,5], f:C.snow}, {c:[104,39,5], w:.7},
    {d:'M104 39 V35 M104 39 h3', w:.6},
    {d:'M100 48 V68 M108 48 V68', w:.45, s:C.ink2},
    {d:'M0 70 H150 V103 H0 Z', f:C.blue},
    {d:'M104 72 q-3 7 0 13 q3 7 0 11', w:.9, s:C.yellow},
    {d:'M26 72 q-2 6 0 10 M60 72 q2 6 0 9', w:.6, s:C.yellow},
    {d:'M10 80 q9-3 18 0 M62 88 q10-3 20 0 M114 84 q9-3 18 0', dash:[4,4], w:.5, s:C.snow},
    {d:'M6 94 q8-4 16 0 M32 99 q8-4 16 0 M74 96 q8-4 16 0 M118 93 q8-4 16 0',
      w:.6, s:C.lblue},
    {d:'M0 64 H150 V69 H0 Z', f:C.sand}, {d:'M0 64 H150 M0 69 H150', w:.7},
    {d:'M16 69 q10 9 20 0 M56 69 q10 9 20 0 M116 69 q10 9 20 0', w:.7},
    {d:'M8 64 V57 M46 64 V57 M88 64 V57 M140 64 V57', w:.6},
    {c:[8,55,2], f:C.yellow}, {c:[46,55,2], f:C.yellow},
    {c:[88,55,2], f:C.yellow}, {c:[140,55,2], f:C.yellow},
    {d:'M28 64 q0-7 3-7 q3 0 3 7 Z', f:C.ink}, {c:[31,55,2.2], f:C.ink},
    {d:'M64 64 q0-6 2.6-6 q2.6 0 2.6 6 Z', f:C.ink}, {c:[66.6,56,2], f:C.ink}
  ]},
  /* 北村的巷子：远处南山塔 → 两侧韩屋瓦檐（透视收进去）→ 石板路 → 挂灯 → 走远的人 */
  alley:{ w:150, h:105, k:1.35, items:[
    {d:'M10 10 q10-4 20 0 M112 14 q9-4 18 0', w:.5, s:C.ink3},
    {d:'M34 52 Q75 24 116 52 Z', f:C.green},
    {d:'M34 52 Q75 24 116 52', w:.6, s:C.ink2},
    {d:'M75 32 V18', w:.8}, {d:'M71 18 L75 8 L79 18 Z', f:C.red},
    {d:'M71 18 L75 8 L79 18 Z', w:.7}, {d:'M71 24 h8', w:.6},
    {d:'M58 62 L0 103 H150 L92 62 Z', f:C.paper},
    {d:'M0 14 L58 50 L58 62 L0 103 Z', f:C.sand},
    {d:'M150 14 L92 50 L92 62 L150 103 Z', f:C.sand},
    {d:'M0 4 L60 44 L58 52 L0 22 Z', f:C.ink3},
    {d:'M150 4 L90 44 L92 52 L150 22 Z', f:C.ink3},
    {d:'M0 4 L60 44 L58 52 L0 22 Z', w:.7},
    {d:'M150 4 L90 44 L92 52 L150 22 Z', w:.7},
    {d:'M6 10 l2 5 M18 18 l2 5 M30 26 l2 5 M42 34 l2 5 '
      + 'M144 10 l-2 5 M132 18 l-2 5 M120 26 l-2 5 M108 34 l-2 5', w:.5, s:C.ink2},
    {d:'M0 14 L58 50 L58 62 L0 103', w:.8},
    {d:'M150 14 L92 50 L92 62 L150 103', w:.8},
    {d:'M8 56 L28 60 L28 88 L8 92 Z', f:C.red},
    {d:'M8 56 L28 60 L28 88 L8 92 Z', w:.8},
    {d:'M18 58 V90', w:.5, s:C.ink2}, {c:[24,74,1.6]},
    {d:'M118 39 V45', w:.6},
    {d:'M112 45 H124 V56 H112 Z', f:C.paper}, {d:'M112 45 H124 V56 H112 Z', w:.8},
    {d:'M113 48 h10 M113 52 h10', w:.5, s:C.ink3}, {d:'M118 56 V60', w:.6, s:C.red},
    {d:'M49.5 68 H100.5 M38.2 76 H111.8 M24.1 86 H125.9 M6 96 H144',
      dash:[5,5], w:.5, s:C.ink3},
    {d:'M72 84 q0-7 2.8-7 q2.8 0 2.8 7 Z', f:C.ink2}, {c:[74.8,75,2.2], f:C.ink2},
    {c:[8,98,6], f:C.green}, {c:[8,98,6], w:.5, s:C.ink2},
    {c:[142,100,6], f:C.green}, {c:[142,100,6], w:.5, s:C.ink2}
  ]},
  /* 九份的阶梯：海 → 远山 → 山坡 → 茶楼 → 石阶 → 一串红灯笼（前景压过去）*/
  lantern:{ w:150, h:105, k:1.35, items:[
    {d:'M0 26 H62 V44 H0 Z', f:C.blue},
    {d:'M0 44 H62', w:.6, s:C.ink2},
    {d:'M6 32 q7-2 14 0 M26 37 q7-2 14 0 M44 30 q7-2 14 0', w:.5, s:C.ink3},
    {d:'M56 44 Q80 22 108 44 Z', f:C.green},
    {d:'M56 44 Q80 22 108 44', w:.6, s:C.ink2},
    {d:'M0 44 H150 V103 H0 Z', f:C.green},
    {d:'M8 56 l4 6 M28 70 l4 6 M96 60 l4 6 M118 84 l4 6 M60 92 l4 6', w:.5, s:C.ink2},
    {d:'M96 34 H150 V96 H96 Z', f:C.sand},
    {d:'M92 34 H150 V40 H92 Z', f:C.ink3},
    {d:'M96 40 H150 V96', w:.8}, {d:'M92 34 H150 V40 H92 Z', w:.7},
    {d:'M102 48 h12 v12 h-12 Z', f:C.yellow}, {d:'M122 48 h12 v12 h-12 Z', f:C.yellow},
    {d:'M102 48 h12 v12 h-12 Z M122 48 h12 v12 h-12 Z', w:.6},
    {d:'M108 48 V60 M128 48 V60 M102 54 h12 M122 54 h12', w:.45, s:C.ink2},
    {d:'M100 70 H146', w:.6, s:C.ink2},
    {d:'M104 74 h10 v20 h-10 Z', f:C.paper}, {d:'M104 74 h10 v20 h-10 Z', w:.7},
    {d:'M124 76 h16 v6 h-16 Z', f:C.red}, {d:'M124 76 h16 v6 h-16 Z', w:.6},
    {d:'M8 103 L58 46 H74 L34 103 Z', f:C.sand},
    {d:'M8 103 L58 46 M34 103 L74 46', w:.85},
    {d:'M12.4 98 H37.5 M17.6 92 H41.7 M22.9 86 H45.9 M28.2 80 H50.1 M33.4 74 H54.4 '
      + 'M38.7 68 H58.6 M44 62 H62.8 M49.2 56 H67 M54.5 50 H71.2', w:.6, s:C.ink2},
    {d:'M40 76 q0-7 2.8-7 q2.8 0 2.8 7 Z', f:C.ink2}, {c:[42.8,67,2.2], f:C.ink2},
    {d:'M0 12 Q40 30 80 20 Q116 12 150 20', w:.7},
    {d:'M15 23 h10 v9 h-10 Z', f:C.red}, {d:'M39 27 h10 v9 h-10 Z', f:C.red},
    {d:'M63 24 h10 v9 h-10 Z', f:C.red}, {d:'M91 18 h10 v9 h-10 Z', f:C.red},
    {d:'M119 18 h10 v9 h-10 Z', f:C.red},
    {d:'M15 23 h10 v9 h-10 Z M39 27 h10 v9 h-10 Z M63 24 h10 v9 h-10 Z '
      + 'M91 18 h10 v9 h-10 Z M119 18 h10 v9 h-10 Z', w:.65},
    {d:'M20 32 V35 M44 36 V39 M68 33 V36 M96 27 V30 M124 27 V30', w:.5, s:C.ink2}
  ]},
  /* 运河边的摊子：日头 → 对岸绿带 → 高脚屋 → 棕榈 → 岸上的棚子 → 水面 → 长尾船 */
  canal:{ w:150, h:105, k:1.35, items:[
    {c:[132,14,9], f:C.yellow}, {c:[132,14,9], w:.5, s:C.ink3},
    {d:'M8 12 q10-4 20 0 M100 8 q10-4 20 0', w:.5, s:C.ink3},
    {d:'M0 66 H150 V78 H0 Z', f:C.green},
    {d:'M92 44 H140 V70 H92 Z', f:C.sand},
    {d:'M86 46 L116 28 L146 46 Z', f:C.red},
    {d:'M92 44 H140 V70', w:.8}, {d:'M86 46 L116 28 L146 46 Z', w:.75},
    {d:'M116 28 V24', w:.6},
    {d:'M100 52 h10 v10 h-10 Z', f:C.lblue}, {d:'M100 52 h10 v10 h-10 Z', w:.6},
    {d:'M105 52 V62 M100 57 h10', w:.45, s:C.ink2},
    {d:'M122 52 h12 v10 h-12 Z', f:C.yellow}, {d:'M122 52 h12 v10 h-12 Z', w:.6},
    {d:'M96 70 V84 M112 70 V86 M132 70 V84', w:.8},
    {d:'M62 78 Q68 56 72 40', w:.95},
    {d:'M72 40 q-16-6-22 3 M72 40 q16-6 22 3 M72 40 q-11-14-22-13 M72 40 q11-14 22-13 '
      + 'M72 40 q-2-14-8-18 M72 40 q4-14 12-16', w:.7, s:C.ink2},
    {c:[68,44,2], f:C.green}, {c:[76,45,1.8], f:C.green},
    {d:'M0 60 H62 V78 H0 Z', f:C.sand},
    {d:'M0 44 H46 V49 H0 Z', f:C.red}, {d:'M0 44 H46 V49 H0 Z', w:.65},
    {d:'M6 49 V64 M42 49 V64', w:.7},
    {d:'M4 58 H44 V62 H4 Z', f:C.sand}, {d:'M4 58 H44 V62 H4 Z', w:.7},
    {c:[12,55,3], f:C.red}, {c:[20,55,3], f:C.yellow}, {c:[28,55,3], f:C.green},
    {c:[36,56,2.6], f:C.red},
    {c:[12,55,3], w:.5, s:C.ink2}, {c:[20,55,3], w:.5, s:C.ink2},
    {c:[28,55,3], w:.5, s:C.ink2},
    {d:'M24 74 Q28 60 30 48', w:.85},
    {d:'M30 48 q-13-5-18 2 M30 48 q13-5 18 2 M30 48 q-9-11-18-10 M30 48 q9-11 18-10 '
      + 'M30 48 q0-11-5-14', w:.65, s:C.ink2},
    {d:'M0 76 H150 V103 H0 Z', f:C.lblue},
    {d:'M0 76 H150'},
    {d:'M60 82 q10-3 20 0 M108 88 q9-3 18 0 M30 96 q9-3 18 0 M84 98 q9-3 18 0',
      w:.6, s:C.ink2},
    {d:'M96 78 q-2 6 0 10 M112 78 q2 6 0 12', dash:[3,4], w:.5, s:C.ink3},
    {d:'M8 88 q30-5 58 1 q-6 9-29 9 q-20 0-29-10 Z', f:C.paper},
    {d:'M8 88 q30-5 58 1 q-6 9-29 9 q-20 0-29-10 Z', w:.85},
    {d:'M16 82 H46 V86 H16 Z', f:C.yellow}, {d:'M16 82 H46 V86 H16 Z', w:.6},
    {d:'M18 86 V90 M44 86 V90', w:.5, s:C.ink2},
    {d:'M56 88 q0-6 2.4-6 q2.4 0 2.4 6 Z', f:C.ink2}, {c:[58.4,80,2], f:C.ink2},
    {d:'M64 86 L78 96', w:.8},
    {c:[132,98,4], f:C.green}, {c:[141,96,5], f:C.green},
    {d:'M128 103 q4-8 8-6 M139 103 q2-8 6-7', w:.6, s:C.ink2}
  ]},
  /* 小樽运河：冷天 → 石造仓库 + 屋顶积雪 → 河面 → 前景雪堆 → 煤气灯 → 撑伞的人 → 飘雪 */
  snow:{ w:150, h:105, k:1.35, items:[
    {d:'M0 0 H150 V46 H0 Z', f:C.lblue},
    {d:'M8 40 H40 V72 H8 Z', f:C.sand}, {d:'M42 46 H70 V72 H42 Z', f:C.sand},
    {d:'M74 36 H102 V72 H74 Z', f:C.sand}, {d:'M104 28 H128 V72 H104 Z', f:C.sand},
    {d:'M130 38 H150 V72 H130 Z', f:C.sand},
    {d:'M6 40 H42 V45 H6 Z', f:C.snow}, {d:'M40 46 H72 V51 H40 Z', f:C.snow},
    {d:'M72 36 H104 V41 H72 Z', f:C.snow}, {d:'M102 28 H130 V33 H102 Z', f:C.snow},
    {d:'M128 38 H150 V43 H128 Z', f:C.snow},
    {d:'M8 45 V72 M40 45 V72 M42 51 V72 M70 51 V72 M74 41 V72 M102 41 V72 '
      + 'M104 33 V72 M128 33 V72 M130 43 V72', w:.75},
    {d:'M6 45 H42 M40 51 H72 M72 41 H104 M102 33 H130 M128 43 H150', w:.7},
    {d:'M14 52 h6 v7 h-6 Z', f:C.yellow}, {d:'M28 52 h6 v7 h-6 Z', f:C.ink2},
    {d:'M48 56 h6 v7 h-6 Z', f:C.ink2}, {d:'M60 56 h6 v7 h-6 Z', f:C.yellow},
    {d:'M80 46 h7 v8 h-7 Z', f:C.ink2}, {d:'M91 46 h7 v8 h-7 Z', f:C.yellow},
    {d:'M110 38 h7 v8 h-7 Z', f:C.yellow}, {d:'M117 52 h7 v8 h-7 Z', f:C.ink2},
    {d:'M136 52 h7 v8 h-7 Z', f:C.ink2},
    {d:'M14 52 h6 v7 h-6 Z M28 52 h6 v7 h-6 Z M48 56 h6 v7 h-6 Z M60 56 h6 v7 h-6 Z '
      + 'M80 46 h7 v8 h-7 Z M91 46 h7 v8 h-7 Z M110 38 h7 v8 h-7 Z M117 52 h7 v8 h-7 Z '
      + 'M136 52 h7 v8 h-7 Z', w:.55, s:C.ink2},
    {d:'M12 66 h8 M46 66 h8 M84 64 h10 M112 64 h10', w:.5, s:C.ink3},
    {d:'M0 72 H150 V90 H0 Z', f:C.blue}, {d:'M0 72 H150', w:.7},
    {d:'M18 74 q2 5 0 9 M64 74 q-2 5 0 8 M114 74 q2 5 0 9', w:.7, s:C.yellow},
    {d:'M6 82 q9-3 18 0 M40 86 q9-3 18 0 M92 82 q9-3 18 0', dash:[4,4], w:.5, s:C.snow},
    {d:'M0 88 q20-8 38-2 q20 6 38-3 q20-9 38 1 q18 8 36 1 V103 H0 Z', f:C.snow},
    {d:'M0 88 q20-8 38-2 q20 6 38-3 q20-9 38 1 q18 8 36 1', w:.7},
    {d:'M10 97 q10-3 20 0 M58 99 q10-3 20 0 M106 97 q10-3 20 0', w:.5, s:C.ink3},
    {d:'M20 94 V62', w:.9}, {c:[20,59,3], f:C.yellow}, {c:[20,59,3], w:.65},
    {d:'M112 96 V68', w:.9}, {c:[112,65,2.8], f:C.yellow}, {c:[112,65,2.8], w:.6},
    {d:'M62 92 q0-8 3-8 q3 0 3 8 Z', f:C.ink2}, {c:[65,82,2.4], f:C.ink2},
    {d:'M56 78 q9-7 18 0 Z', f:C.red}, {d:'M56 78 q9-7 18 0', w:.7},
    {d:'M65 78 V84', w:.6},
    {c:[24,20,1.4], f:C.snow}, {c:[46,12,1.2], f:C.snow}, {c:[70,24,1.5], f:C.snow},
    {c:[96,16,1.3], f:C.snow}, {c:[122,22,1.4], f:C.snow}, {c:[138,10,1.2], f:C.snow},
    {c:[34,34,1.2], f:C.snow}, {c:[86,32,1.3], f:C.snow}
  ]},
  /* 德格拉朗梯田：整片山坡先铺满 → 一层层内缩的田面（水田用水色）→ 田埂 → 棕榈 → 农人
     关键是每层比下一层窄、两头缩进去，露出底下的山坡当田埂；等宽平行只会像条纹壁纸 */
  terrace:{ w:150, h:105, k:1.35, items:[
    {c:[122,18,9], f:C.yellow},
    {d:'M0 30 Q38 16 76 28 Q112 40 150 26 V103 H0 Z', f:C.green},
    {d:'M0 30 Q38 16 76 28 Q112 40 150 26', w:.6, s:C.ink2},
    {d:'M26 46 Q76 36 128 48 L128 56 Q76 44 26 54 Z', f:C.lblue},
    {d:'M18 58 Q76 47 136 60 L136 68 Q76 55 18 66 Z', f:C.green},
    {d:'M10 70 Q76 58 144 72 L144 80 Q76 66 10 78 Z', f:C.lblue},
    {d:'M2 82 Q76 69 150 84 V103 H0 Z', f:C.green},
    {d:'M26 46 Q76 36 128 48 M26 54 Q76 44 128 56 M18 58 Q76 47 136 60 '
      + 'M18 66 Q76 55 136 68 M10 70 Q76 58 144 72 M10 78 Q76 66 144 80 '
      + 'M2 82 Q76 69 150 84', w:.7, s:C.ink2},
    {d:'M50 46 q3-3 6 0 M74 45 q3-3 6 0 M98 46 q3-3 6 0', w:.5, s:C.snow},
    {d:'M56 60 v-3 M70 59 v-3 M84 59 v-3 M98 60 v-3', w:.5, s:C.ink2},
    {d:'M34 70 q3-3 6 0 M60 69 q3-3 6 0 M88 69 q3-3 6 0 M116 71 q3-3 6 0', w:.5, s:C.snow},
    {d:'M44 96 v-4 M70 95 v-4 M96 96 v-4 M122 98 v-4', w:.5, s:C.ink2},
    {d:'M126 78 Q132 58 134 42', w:.95},
    {d:'M134 42 q-16-6-21 3 M134 42 q14-7 16 4 M134 42 q-11-14-22-12 '
      + 'M134 42 q10-13 16-10 M134 42 q-1-14-7-17', w:.7, s:C.ink2},
    {c:[130,46,2], f:C.green}, {c:[138,47,1.8], f:C.green},
    {d:'M14 66 Q18 52 20 42', w:.8},
    {d:'M20 42 q-12-5-16 2 M20 42 q12-5 16 2 M20 42 q-8-10-16-9 M20 42 q8-10 16-9 '
      + 'M20 42 q0-10-4-13', w:.6, s:C.ink2},
    {d:'M4 38 q22-4 44 0 M60 34 q24-4 48 0 M84 46 q20-4 40 0', dash:[6,5], w:.5, s:C.snow},
    /* 田边的草棚：给梯田一个尺度参照，不然分不出这几层有多大 */
    {d:'M14 84 H30 V94 H14 Z', f:C.paper}, {d:'M11 84 L22 74 L33 84 Z', f:C.sand},
    {d:'M14 84 H30 V94 H14 Z M11 84 L22 74 L33 84 Z', w:.7},
    {d:'M60 90 q0-8 3-8 q3 0 3 8 Z', f:C.ink2}, {c:[63,80,2.2], f:C.ink2},
    {d:'M56 78 q7-5 14 0 Z', f:C.sand}, {d:'M56 78 q7-5 14 0', w:.65}
  ]},
  /* 牛车水的店屋：三栋不同颜色的立面 → 百叶窗 → 竹竿晾的衣服 → 遮阳棚 → 街面盆栽 */
  shophouse:{ w:150, h:105, k:1.35, items:[
    {d:'M6 12 q10-4 20 0 M112 9 q10-4 18 0', w:.5, s:C.ink3},
    {d:'M4 22 H50 V92 H4 Z', f:C.pink},
    {d:'M52 18 H98 V92 H52 Z', f:C.yellow},
    {d:'M100 24 H146 V92 H100 Z', f:C.lblue},
    {d:'M2 22 H52 V28 H2 Z', f:C.ink3},
    {d:'M50 18 H100 V24 H50 Z', f:C.ink3},
    {d:'M98 24 H148 V30 H98 Z', f:C.ink3},
    {d:'M4 28 H50 V92 M52 24 H98 V92 M100 30 H146 V92', w:.8},
    {d:'M2 22 H52 V28 H2 Z M50 18 H100 V24 H50 Z M98 24 H148 V30 H98 Z', w:.7},
    {d:'M10 25 v3 M20 25 v3 M30 25 v3 M40 25 v3 M58 21 v3 M68 21 v3 M78 21 v3 '
      + 'M88 21 v3 M106 27 v3 M116 27 v3 M126 27 v3 M136 27 v3', w:.45, s:C.ink2},
    {d:'M12 40 H24 V62 H12 Z', f:C.paper}, {d:'M30 40 H42 V62 H30 Z', f:C.paper},
    {d:'M60 36 H72 V58 H60 Z', f:C.paper}, {d:'M78 36 H90 V58 H78 Z', f:C.paper},
    {d:'M108 42 H120 V64 H108 Z', f:C.paper}, {d:'M126 42 H138 V64 H126 Z', f:C.paper},
    {d:'M12 40 H24 V62 H12 Z M30 40 H42 V62 H30 Z M60 36 H72 V58 H60 Z '
      + 'M78 36 H90 V58 H78 Z M108 42 H120 V64 H108 Z M126 42 H138 V64 H126 Z', w:.7},
    {d:'M12 40 Q18 33 24 40 M30 40 Q36 33 42 40 M60 36 Q66 29 72 36 M78 36 Q84 29 90 36 '
      + 'M108 42 Q114 35 120 42 M126 42 Q132 35 138 42', w:.7},
    {d:'M13 46 h10 M13 50 h10 M13 54 h10 M13 58 h10 M31 46 h10 M31 50 h10 M31 54 h10 '
      + 'M31 58 h10 M61 42 h10 M61 46 h10 M61 50 h10 M61 54 h10 M79 42 h10 M79 46 h10 '
      + 'M79 50 h10 M79 54 h10 M109 48 h10 M109 52 h10 M109 56 h10 M109 60 h10 '
      + 'M127 48 h10 M127 52 h10 M127 56 h10 M127 60 h10', w:.45, s:C.ink2},
    {d:'M56 32 H96', w:.7},
    {d:'M62 32 h6 v10 h-6 Z', f:C.lblue}, {d:'M74 32 h7 v9 h-7 Z', f:C.pink},
    {d:'M86 32 h6 v11 h-6 Z', f:C.snow},
    {d:'M62 32 h6 v10 h-6 Z M74 32 h7 v9 h-7 Z M86 32 h6 v11 h-6 Z', w:.55, s:C.ink2},
    {d:'M4 68 H50 V74 H4 Z', f:C.red}, {d:'M52 64 H98 V70 H52 Z', f:C.green},
    {d:'M100 70 H146 V76 H100 Z', f:C.red},
    {d:'M4 68 H50 V74 H4 Z M52 64 H98 V70 H52 Z M100 70 H146 V76 H100 Z', w:.65},
    {d:'M12 68 V74 M22 68 V74 M32 68 V74 M42 68 V74 M60 64 V70 M70 64 V70 M80 64 V70 '
      + 'M90 64 V70 M108 70 V76 M118 70 V76 M128 70 V76 M138 70 V76', w:.5, s:C.paper},
    {d:'M14 78 H30 V92 H14 Z', f:C.paper}, {d:'M14 78 H30 V92 H14 Z', w:.7},
    {d:'M22 78 V92', w:.5, s:C.ink2},
    {d:'M62 78 H84 V92 H62 Z', f:C.sand}, {d:'M62 78 H84 V92 H62 Z', w:.7},
    {d:'M110 78 H132 V92 H110 Z', f:C.paper}, {d:'M110 78 H132 V92 H110 Z', w:.7},
    {d:'M116 84 h10', w:.5, s:C.ink2},
    {d:'M36 76 h8 v14 h-8 Z', f:C.red}, {d:'M36 76 h8 v14 h-8 Z', w:.6},
    {d:'M38 79 h4 M38 83 h4 M38 87 h4', w:.5, s:C.paper},
    {d:'M0 92 H150 V103 H0 Z', f:C.sand},
    {d:'M0 92 H150'}, {d:'M0 98 H150', dash:[6,6], w:.5, s:C.ink3},
    {c:[8,96,5], f:C.green}, {c:[8,96,5], w:.5, s:C.ink2},
    {c:[142,97,5], f:C.green}, {c:[142,97,5], w:.5, s:C.ink2},
    {d:'M94 92 q0-8 3-8 q3 0 3 8 Z', f:C.ink2}, {c:[97,82,2.4], f:C.ink2}
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
/* ---------- 通用绘制 ----------
   一条 ART item → draw 后端的一次调用。这里不许出现 rough / setAttribute（§6.1）。
     f  = 填色块   tx = 文字（手写体，不抖）   其余 = 墨线（w 笔粗倍数 / s 笔色 / dash）*/
function shape(d, it, seed, k){
  const st = { seed, k };
  if (it.f) { st.fill = it.f; st.keep = it.keep; }
  else if (it.tx) return d.text(it.tx, { x: it.x, y: it.y, size: it.s });
  else {
    if (it.s) st.stroke = it.s;
    if (it.w) st.w = it.w;
    if (it.dash) st.dash = it.dash;
  }
  return it.c ? d.circle(it.c[0], it.c[1], it.c[2], st) : d.path(it.d, st);
}

/* 把一张插图画进任意 draw 画布 —— 明信片拼贴复用的就是这个入口。
   k 会一路乘进笔粗：外层 group 有 scale 时得反向补偿，否则放大的那张笔明显粗一圈。 */
function artInto(d, name, seedBase, k){
  const spec = ART[name];
  if (!spec) return null;
  spec.items.forEach((it, i) => shape(d, it, seedBase + i * 13, k));
  return spec;
}

function drawArt(host){
  const name = host.dataset.art;
  const spec = ART[name];
  if (!spec) { host.textContent = '?' + name; return; }
  const d = Draw.svg({ w: spec.w, h: spec.h, cls: 'art' });
  artInto(d, name, hash(name), spec.k || 1);
  while (host.firstChild) host.removeChild(host.firstChild);
  host.appendChild(d.node);
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
  drawArt, artInto, paintFrame, paintTape, paintArt, paintChrome, paintAll,
  repaint, say, bindPanel
};
