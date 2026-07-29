#!/usr/bin/env python3
"""把 data/*.json 打成一个 data/bundle.js。

为什么要这一步：`file://` 下 fetch 读不到本地 JSON（跨源），而单文件导出也只认
`<script src>`。所以数据的**唯一来源**是 JSON（好编辑、好校验、以后好给编辑器用），
运行时吃的是这里生成的 js。

用法：python3 build-data.py
输入：data/trips.json  data/places.json
输出：data/bundle.js   ->  window.DATA = {baseCurrency, rates, places, trips}
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
DATA = HERE / "data"


def strip(node):
    """去掉 _ 开头的注释键（JSON 没有注释，只能这么写）。"""
    if isinstance(node, dict):
        return {k: strip(v) for k, v in node.items() if not str(k).startswith("_")}
    if isinstance(node, list):
        return [strip(v) for v in node]
    return node


def main():
    trips = strip(json.loads((DATA / "trips.json").read_text(encoding="utf-8")))
    places = strip(json.loads((DATA / "places.json").read_text(encoding="utf-8")))

    bundle = {
        "baseCurrency": trips.get("baseCurrency", "CNY"),
        "rates": trips.get("rates", {"CNY": 1}),
        "places": places,
        "trips": trips.get("trips", []),
    }
    body = json.dumps(bundle, ensure_ascii=False, indent=1, sort_keys=False)
    out = DATA / "bundle.js"
    out.write_text(
        "/* 自动生成，别手改。改 data/trips.json 或 data/places.json 后跑："
        "python3 build-data.py */\nwindow.DATA = " + body + ";\n",
        encoding="utf-8")

    n_entries = sum(len(t.get("entries", [])) for t in bundle["trips"])
    print(f"{out.relative_to(HERE)}  {out.stat().st_size} bytes  "
          f"{len(bundle['trips'])} 个行程 / {n_entries} 条 entry / "
          f"{len(places)} 个地点")


if __name__ == "__main__":
    main()
