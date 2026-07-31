#!/usr/bin/env python3
"""把 data/*.json 打成一个 data/bundle.js。

为什么要这一步：`file://` 下 fetch 读不到本地 JSON（跨源），而单文件导出也只认
`<script src>`。所以数据的**唯一来源**是 JSON（好编辑、好校验、以后好给编辑器用），
运行时吃的是这里生成的 js。

用法：python3 build-data.py
输入：data/trips.json  data/places.json  data/samples.json  media/*.jpg
输出：data/bundle.js   ->  window.DATA = {baseCurrency, rates, stamp, places, trips, samples, images}

samples 是「点了才叠进来」的那几趟（§4.8 空状态）：默认书架只有 trips 里的 2+2，
示例跟着 bundle 一起发但不进 Store，所以离线单文件里也点得动，不用再发一次请求。

images 是位图场景插画（entry.media[].path 写成 `img:kyoto`，§3.1）：这里读成
data: URI 内联进 bundle。**必须内联**，不能留 media/kyoto.jpg 这种相对路径 ——
单文件导出只内联 <link> 和 <script src>，数据里的路径它扫不到（会照旧报「外部依赖
none」却裂图）；而明信片存 PNG/PDF 是把 SVG 塞进 <img>，那时候 SVG 成了独立文档，
外部文件一律读不到。代价是 bundle 胖 ~1MB，单文件从 1.2MB 涨到约 2.3MB。
"""
import base64
import hashlib
import json
import pathlib

HERE = pathlib.Path(__file__).parent
DATA = HERE / "data"
MEDIA = HERE / "media"


def strip(node):
    """去掉 _ 开头的注释键（JSON 没有注释，只能这么写）。"""
    if isinstance(node, dict):
        return {k: strip(v) for k, v in node.items() if not str(k).startswith("_")}
    if isinstance(node, list):
        return [strip(v) for v in node]
    return node


def images():
    """media/*.jpg -> {名字: data: URI}。名字就是 img: 后面那一截。"""
    out = {}
    for f in sorted(MEDIA.glob("*.jpg")) if MEDIA.is_dir() else []:
        b64 = base64.b64encode(f.read_bytes()).decode("ascii")
        out[f.stem] = "data:image/jpeg;base64," + b64
    return out


def stamp(trips, samples):
    """出厂数据的指纹：trips + samples 的内容哈希。

    为什么不用构建时间：那样每次跑一遍构建、内容一个字没改，回头客都会被问一次
    「出厂数据更新了，取新的吗」—— 问多了就没人看了。内容哈希才只在数据真的
    变了的时候变。也不把 places / images 算进来：那两样改了不影响「书架上是哪几趟」。
    """
    body = json.dumps([trips, samples], ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(body.encode("utf-8")).hexdigest()[:12]


def main():
    trips = strip(json.loads((DATA / "trips.json").read_text(encoding="utf-8")))
    places = strip(json.loads((DATA / "places.json").read_text(encoding="utf-8")))
    samples = strip(json.loads((DATA / "samples.json").read_text(encoding="utf-8")))

    imgs = images()

    bundle = {
        "baseCurrency": trips.get("baseCurrency", "CNY"),
        "rates": trips.get("rates", {"CNY": 1}),
        "stamp": stamp(trips.get("trips", []), samples.get("trips", [])),
        "places": places,
        "trips": trips.get("trips", []),
        "samples": samples.get("trips", []),
        "images": imgs,
    }
    body = json.dumps(bundle, ensure_ascii=False, indent=1, sort_keys=False)
    out = DATA / "bundle.js"
    out.write_text(
        "/* 自动生成，别手改。改 data/trips.json 或 data/places.json 后跑："
        "python3 build-data.py */\nwindow.DATA = " + body + ";\n",
        encoding="utf-8")

    n_entries = sum(len(t.get("entries", [])) for t in bundle["trips"])
    n_sample = sum(len(t.get("entries", [])) for t in bundle["samples"])
    n_img = sum(len(v) for v in imgs.values())
    print(f"{out.relative_to(HERE)}  {out.stat().st_size} bytes  "
          f"{len(bundle['trips'])} 个行程 / {n_entries} 条 entry / "
          f"{len(places)} 个地点 / "
          f"示例 {len(bundle['samples'])} 趟 {n_sample} 条 / "
          f"位图 {len(imgs)} 张 {n_img} bytes / "
          f"指纹 {bundle['stamp']}")


if __name__ == "__main__":
    main()
