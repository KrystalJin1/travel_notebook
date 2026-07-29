<div align="center">

# 🧳 旅行手帐 · Travel Notebook

**一次旅行结束后，照片、票根、花了多少钱、去过哪几个城市，散在相册和备忘录里，过两年就全忘了。**
**这个项目把它们拼成一页能看的东西 —— 而且是手画的。**

🖊️ 纸 · 墨 · 胶带 · 邮戳　|　✈️ 手绘航线　|　📝 能填数字的编辑器　|　🚫 没有框架，没有打包器

</div>

---

## ✨ 先看效果

整个 `prototype/` 拿下来，直接双击 `prototype/index.html` 就能开 —— **不用起服务器**，`file://` 下功能完整。

只想拿**一个文件**发给别人 / 双击就看（字体、rough.js、数据全部内嵌）：

```bash
python3 prototype/build.py pages      # 生成 3 个 .standalone.html，外部依赖 none
```

```
prototype/index.standalone.html       # 880KB，一个文件就是完整的手帐本
```

> 💡 `.standalone.html` 是构建产物，**没有进仓库**（一份 800KB+），跑一下上面那条命令就有。

落地流程：封面 → 点「翻开 →」进书架 → 点任意一趟进详情 → 右上角「编辑 ✎」开始填数字。

| 想干什么 | 打开哪个 |
|---|---|
| 🧳 看完整的手帐本（能点、能填） | `prototype/index.html` |
| 🎨 只看手绘风格样张（两张卡片 + 贴纸墙） | `prototype/hand-drawn.html` |
| 🗺️ 只看手绘世界地图 | `prototype/map.html` |
| 📮 发给别人 / 只拿一个文件 | `prototype/index.standalone.html`（先构建） |

> ⚠️ 单独下载 `prototype/index.html` 会白屏 —— 它靠 8 个外部 `<script>` 和 3 个 css。
> 要么整个 `prototype/` 一起拿，要么用上面那个 `.standalone.html`。

---

## 🎨 它长什么样

- **两个分区，一套数据模型**：已旅行（📷 照片、逐日行程、花销、当时写的几句话）和待出行（🏨 订好的住处、💰 预算、📍 想去的地方）。区别只在 `status`，待出行的标题视觉上淡一档 —— 它还没成为回忆。
- **手绘不是滤镜**：所有的框、线、胶带、插图都是 [rough.js](https://roughjs.com) 当场描出来的 SVG。标题的**笔画本身在抖**，不是把字当一块砖随机旋转 —— 构建时用 fontTools 抽出字形轮廓，运行时再交给同一支笔描边。
- **同一支笔画全场**：地图海岸线、插图、卡片边框、标题，共用一套参数（手抖 1.2 / 弯曲 1.5 / 笔粗 0.8），风格自洽。
- **交互按 app 做，不是 PPT**：手帐只是视觉隐喻。导航是**栈**不是幻灯片，后退键 / `Esc` / 右滑都回**来处**；内容可自由滚动，不为了「一屏装下」被裁；返回时还原滚动位置。3D 翻页只留给封面 → 书架那一次仪式。
- **能填数字**：详情页的编辑表单能改标题、日期、预算、航段、花销（支持外币，自动折算）、想去的地方、随手写的笔记。填完卡片上的数字立刻跟着变。

---

## 🔤 中英文与符号：字都得画得出来

手绘标题不是把系统字体加个滤镜，而是**构建时抽字形轮廓、运行时用 rough.js 描边**。
所以「页面上会出现哪个字」这件事必须在构建时就知道 —— 少扫一个文件，浏览器上就是一个豆腐块 □。

页面里真实用到的混排长这样：

| 场景 | 实际文案 | 涉及 |
|---|---|---|
| 分区标题 | `已旅行 · PAST`　`待出行 · PLANNED` | 中文 + 拉丁 + 间隔号 |
| 航段 | `SHA → HND`　`NRT ✈ PVG` | 三字码 + 箭头 + 符号 |
| 金额 | `¥12,345`　`JPY 98,000 → ¥4,802` | 全角货币号 + 千分位 + 折算 |
| 按钮 | `＋ 记一趟新的`　`编辑 ✎`　`完成 ✓`　`翻开 →` | 全角加号 + 图形符号 |
| 提示 | `第 3 天 · 東京 → 箱根（雨）` | 中日汉字 + 括号 |

字形收集分两条流水线：

```python
# build-fonts.py —— 给两支中文字体做子集
SOURCES = ["index.html", "hand-drawn.html", "map.html",
           "app.js", "store.js", "trip.js", "kernel.js", "sketch.js",
           "data/trips.json", "data/places.json"]     # 文案散在 js 里，必须一起扫

ASCII       = "".join(chr(c) for c in range(0x20, 0x7F))
PUNCT       = "·—…、。，；：？！（）「」『』【】《》〈〉“”‘’～￥°※→←↑↓○●◎★☆　"
LATIN_EXTRA = "①②③④⑤⑥⑦⑧⑨⑩ºªµ×÷±"
```

```python
# build-handtype.py —— 只给「手写标题」抽轮廓，多抽一个字就白胖一圈
PAGES = ["hand-drawn.html", "map.html"]
EXTRA = "旅行手帐新的一趟未命名"     # 封面书名不在 trips.json 里，得手工补
```

产物：`handtype.js` 里 **551 个字形轮廓**，`fonts/inline.css` 里两支字体 base64 内联。
字库里没有轮廓的字**自动退回普通文字渲染**，所以加新文案不会缺字，只是那几个字不抖。
手绘标题同时把原文留在 `data-hand-raw` 里 —— 选中、朗读、Ctrl+F 搜索都还拿得到文字。

---

## 🧩 技术上有意思的三点

这个项目刻意留了三处能在面试里讲的地方（不打算讲 CRUD / 路由 / 响应式，那些是及格线）：

1. **🖊️ 手绘渲染管线**　fontTools 抽轮廓 → rough.js 描边。同一支笔画地图海岸线、插图、卡片框、标题，风格自洽；换一支笔（reseed）全页笔迹一起换。
2. **🎲 确定性排版**　拼贴要「看着随机」但必须「每次一样」，否则没法导出也没法测。`seed` 存在数据里，`seedOf(base, key)` 派生子种子 → 同数据同 seed 得到**像素级同一版面**。测试里就是渲染两遍比对序列化结果。
3. **📥 录入 provider 抽象 + 评测集**（M5）　录入是这类产品真正的门槛。`manual` / `text` / `exif` 三个 provider 同一个接口，产出带 `confidence`，一律进「待确认」区；并且有标注好的评测集算字段级 F1，改规则后 F1 不许降。

---

## 🗂️ 目录

```
index.html                  GitHub Pages 用的重定向
docs/需求文档.md            范围、数据模型、§4.8 导航约定、里程碑
data/trips.json             唯一数据源：2 趟 / 32 条 entry
data/places.json            城市与机场坐标（28 条），查不到就报错，不猜
prototype/
  index.html                手帐本本体
  app.js        (519 行)    hash 路由 + 封面 / 书架 / 详情 / 编辑 / 地图 / 关于
  store.js      (143 行)    bundle 之上叠 localStorage 改动 + exportJSON
  trip.js       (324 行)    旅行皮肤：leg / place / spend / stay / note / photo
  kernel.js     (119 行)    内核：时间、汇率、汇总、seed —— 不认识「旅行」两个字
  sketch.js     (465 行)    手绘渲染引擎 + ART 插图库
  paper.css / app.css       纸面与卡片 / 页面外壳
  hand-drawn.html           风格样张页（贴纸墙、调参对比）
  map.html                  手绘世界地图
  test-page.js  (454 行)    stub DOM 跑真页面，62 条断言
  build*.py                 字体子集 / 字形轮廓 / 数据打包 / 单文件导出
```

---

## 🛠️ 构建与测试

```bash
python3 build.py            # fonts → handtype → data → pages
python3 build.py data pages # 只改了 data/*.json 时
node prototype/test-page.js # 62 条断言，两页都跑（--svg 顺便导 /tmp/art/*.svg）
```

测试不开浏览器：手写一个 stub DOM，用 `vm` 依次执行页面里的 `<script>`，然后**真的去点、真的去填** ——
填一个预算就断言仓库和卡片上的数字都跟着变，点「加一笔」断言 entry 多了一条。

```
OK 62 项通过 · 594 KB 输出 · 445 ms
```

---

## 🧱 分层约定

```
kernel.js   时间 / 汇率 / 汇总 / seed        ← 不认识「旅行」，换皮肤不用改
trip.js     leg·place·spend·stay·note       ← 只决定「算什么、放哪个盒子」
sketch.js   data-frame / data-art → SVG     ← 换 canvas 后端时只改这一层
app.js      路由 + 页面                     ← 只管把 hash 变成一页
```

规矩：**SVG 调用不许漏进插图库和排版引擎**。`rough.generator()` 只吐 `move` / `lineTo` / `bcurveTo` + 裸数字，
同 seed 两端笔迹一致 —— 所以小程序端只是再写一个 canvas 2d 后端（M7），前两层白拿。

---

## 🚧 里程碑

| | 内容 | |
|---|---|---|
| M0 | 手绘风格定稿：参数、手写标题、场景插图、贴纸、地图原型 | ✅ |
| M1 | 内核数据模型 + 真实 JSON 驱动整页，删掉硬编码 | ✅ |
| M2 | 手帐本外壳：封面 → 书架 → 详情 → 编辑，栈式路由，导出 JSON | ✅ |
| M3 | 地图接真实航段、照片大图、共享元素转场 | 👉 下一步 |
| M4 | 拼贴排版引擎 + PNG/PDF 导出 + 排版快照测试 | |
| M5 | 录入 provider（manual / text / exif）+ 解析评测集 | |
| M6 | 打磨 + 案例页 | |
| M7 | 小程序端：canvas 2d 渲染后端，复用同一内核 | |

---

## 📄 字体与许可

| | |
|---|---|
| [霞鹜漫黑 LXGW Marker Gothic](https://github.com/lxgw/LxgwMarkerGothic) | SIL OFL 1.1 · `prototype/fonts/LXGWMarkerGothic-OFL.txt` |
| [得意黑 Smiley Sans](https://github.com/atelier-anchor/smiley-sans) | SIL OFL 1.1 |
| [rough.js](https://roughjs.com) · [d3-geo](https://github.com/d3/d3-geo) · [topojson](https://github.com/topojson) | MIT · `prototype/vendor/` |

> 📌 待补：得意黑的 OFL 正文还没放进 `fonts/`，代码本身也还没有 `LICENSE`。公开前补上。

---

<div align="center">

**🧳 一次旅行只值得记一页 —— 但那一页得好看。**

</div>
