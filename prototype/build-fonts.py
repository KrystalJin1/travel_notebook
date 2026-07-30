#!/usr/bin/env python3
"""把字体裁剪成 woff2 并写成 base64 data URI 的 CSS。

为什么要这么做：Chrome 把 file:// 当成不透明来源，@font-face 的字体请求走 CORS
模式，所以本地 HTML 加载同目录下的字体文件会被静默拦掉，直接回退系统默认字体。
data URI 不发请求，因此不受此限制，也不受公司代理影响。

用法：python3 build-fonts.py
输出：fonts/inline.css
"""
import base64
import pathlib
from fontTools import subset

HERE = pathlib.Path(__file__).parent
FONTS = HERE / "fonts"


def gb2312_level1():
    """GB2312 一级字库 3755 个常用汉字（区位 0xB0-0xD7）。"""
    out = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return "".join(out)


ASCII = "".join(chr(c) for c in range(0x20, 0x7F))
PUNCT = "·—…、。，；：？！（）「」『』【】《》〈〉“”‘’～￥°※→←↑↓○●◎★☆　"
LATIN_EXTRA = "①②③④⑤⑥⑦⑧⑨⑩ºªµ×÷±"
# 会出现在页面上的字都得扫一遍：文案散在 html / js / data 三处，漏一个文件就掉字。
# 排除 vendor/rough.js（没有中文）、handtype.js（本身是构建产物）、test-page.js（只在终端里）。
SOURCES = ["index.html", "hand-drawn.html", "map.html",
           "app.js", "store.js", "trip.js", "kernel.js", "sketch.js", "map.js",
           "postcard.js", "bake.js",
           "data/trips.json", "data/places.json"]


def used_chars() -> str:
    s = set()
    for p in SOURCES:
        f = HERE / p
        if f.exists():
            s |= set(f.read_text(encoding="utf-8"))
    return "".join(sorted(s))


def make_subset(src: pathlib.Path, text: str, dst: pathlib.Path):
    args = [
        str(src),
        f"--text={text}",
        "--flavor=woff2",
        f"--output-file={dst}",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
        "--drop-tables+=DSIG",
    ]
    subset.main(args)
    return dst.stat().st_size


def data_uri(path: pathlib.Path) -> str:
    return "data:font/woff2;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def main():
    page_chars = used_chars()
    # 正文手写体：留常用字，以后加中文文案不用重新裁
    hand_text = gb2312_level1() + ASCII + PUNCT + page_chars
    # 标题/数字用的得意黑：只在拉丁字母、数字、机场代码上用，裁小一点
    disp_text = ASCII + PUNCT + LATIN_EXTRA + page_chars

    hand = make_subset(FONTS / "LXGWMarkerGothic-Regular.ttf", hand_text,
                       FONTS / "_sub-markergothic.woff2")
    disp = make_subset(FONTS / "SmileySans-Oblique.woff2", disp_text,
                       FONTS / "_sub-smileysans.woff2")

    css = (
        "/* 自动生成，勿手改 —— 见 build-fonts.py */\n"
        "/* 霞鹜漫黑 LXGW MarkerGothic (OFL) 子集 %d 字节 */\n"
        "@font-face{font-family:'MarkerGothic';font-style:normal;font-weight:400;"
        "font-display:block;src:url(%s) format('woff2')}\n"
        "/* 得意黑 Smiley Sans (OFL) 子集 %d 字节 */\n"
        "@font-face{font-family:'SmileySans';font-style:normal;font-weight:400;"
        "font-display:block;src:url(%s) format('woff2')}\n"
    ) % (hand, data_uri(FONTS / "_sub-markergothic.woff2"),
         disp, data_uri(FONTS / "_sub-smileysans.woff2"))

    out = FONTS / "inline.css"
    out.write_text(css, encoding="utf-8")
    print(f"markergothic woff2 {hand:>8} bytes")
    print(f"smileysans   woff2 {disp:>8} bytes")
    print(f"{out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
