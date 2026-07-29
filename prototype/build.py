#!/usr/bin/env python3
"""一个入口跑完所有构建。

    python3 build.py            # 字体子集 -> 标题轮廓 -> 数据 -> 打包单文件
    python3 build.py pages      # 只重新打包单文件（改了 html 通常只需要这个）
    python3 build.py data       # 改了 data/*.json，重新生成 data/bundle.js
    python3 build.py handtype   # 标题文案加了新字，重抽轮廓
    python3 build.py fonts      # 换了字体或正文加了生僻字，重做子集
    python3 build.py glyph      # 重建「歪扭三种做法」调参对比页

各步骤的实现仍在各自脚本里，这里只负责按顺序调用：
    build-fonts.py     字体 -> woff2 子集 -> base64 塞进 fonts/inline.css
    build-handtype.py  字形轮廓 -> handtype.js（标题用 rough.js 描出来）
    build-data.py      data/*.json -> data/bundle.js（必须在 pages 之前）
    build-standalone.py  html + css + js -> *.standalone.html（可直接下载打开）
    build-glyph.py     调参对比页，参数定稿后一般不用再跑
"""
import subprocess
import sys
import pathlib

HERE = pathlib.Path(__file__).parent
STEPS = {"fonts": "build-fonts.py", "handtype": "build-handtype.py",
         "data": "build-data.py",
         "pages": "build-standalone.py", "glyph": "build-glyph.py"}
DEFAULT = ["fonts", "handtype", "data", "pages"]


def main():
    names = sys.argv[1:] or DEFAULT
    for n in names:
        if n not in STEPS:
            sys.exit(f"未知步骤 {n}，可选：{' '.join(STEPS)}")
    for n in names:
        print(f"\n=== {n} ({STEPS[n]}) ===")
        r = subprocess.run([sys.executable, STEPS[n]], cwd=HERE)
        if r.returncode:
            sys.exit(f"{STEPS[n]} 失败，退出码 {r.returncode}")


if __name__ == "__main__":
    main()
