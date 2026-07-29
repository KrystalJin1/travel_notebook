#!/usr/bin/env python3
"""把原型页面打包成不依赖任何外部文件的单文件 HTML。

用途：公司代理会 403 掉容器上的临时 http 服务，远程文件也不方便直接用浏览器打开。
打包成单文件后，右键下载到本机双击即可，字体/JS/地图数据全部内嵌，file:// 下也完整。

用法：python3 build-standalone.py            # 打包 PAGES 里的全部页面
      python3 build-standalone.py map.html   # 只打包指定页面
输出：<name>.standalone.html
"""
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
PAGES = ["hand-drawn.html", "map.html"]


def build(name: str):
    src = HERE / name
    dst = HERE / (src.stem + ".standalone.html")
    html = src.read_text(encoding="utf-8")

    # 1) <link rel="stylesheet" href="..."> -> 内联 <style>
    def inline_css(m):
        href = m.group(1)
        css = (HERE / href).read_text(encoding="utf-8")
        return f"<style>/* inlined {href} */\n{css}</style>"

    html, n_css = re.subn(
        r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>', inline_css, html)

    # 2) <script src="..."></script> -> 内联（vendor 库、地图数据都走这条）
    def inline_js(m):
        src_ref = m.group(1)
        js = (HERE / src_ref).read_text(encoding="utf-8")
        # 内容里如果出现 </script> 会提前闭合标签，拆开写
        js = js.replace("</script>", "<\\/script>")
        return f"<script>/* inlined {src_ref} */\n{js}\n</script>"

    html, n_js = re.subn(
        r'<script\s+src="([^"]+)"\s*>\s*</script>', inline_js, html)

    # 3) 标题上加个记号，免得跟联网版本搞混
    html = html.replace("<title>", "<title>[单文件] ", 1)

    dst.write_text(html, encoding="utf-8")
    left = re.findall(r'(?:src|href)="(?!data:|#|https?:)([^"]+)"', html)
    print(f"{dst.name:<34} {dst.stat().st_size:>9} bytes  "
          f"(css {n_css}, js {n_js})  外部依赖: {left or 'none'}")


def main():
    for name in (sys.argv[1:] or PAGES):
        build(name)


if __name__ == "__main__":
    main()
