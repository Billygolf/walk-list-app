"""Turn a route sheet HTML (from build_route.py) into a turf pack JSON the app can import."""
import re, sys, json, html, os

def txt(s): return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()

def parse(path):
    t = open(path, encoding="utf-8").read()
    title = txt(re.search(r"<h1>(.*?)</h1>", t).group(1)).removesuffix(" Route")
    mode = "walking" if "travelmode=walking" in t else "driving"
    turfs = []
    for si, sec in enumerate(re.findall(r'<section class="turf">(.*?)</section>', t, flags=re.S), 1):
        name = txt(re.search(r"<h2>(.*?)</h2>", sec).group(1))
        maps = [{"url": html.unescape(u), "label": txt(l)} for u, l in
                re.findall(r'<a class="leg" href="([^"]+)".*?<span>(.*?)</span></a>', sec, flags=re.S)]
        rows, street, cur_map = [], None, None
        for cls, inner in re.findall(r'<tr class="([^"]*)">(.*?)</tr>', sec.split("<tbody>")[1], flags=re.S):
            tds = [txt(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", inner, flags=re.S)]
            if cls == "st": street = re.sub(r"\s+\d+ of \d+ doors?$", "", tds[0]); continue
            if cls == "legrow": cur_map = int(re.search(r"Map (\d+)", tds[0]).group(1)); continue
            knock = cls == ""
            rows.append({"n": int(tds[0]) if knock else None, "knock": knock, "addr": tds[1], "name": tds[2],
                         "hh": tds[3], "tier": tds[4], "phone": tds[5], "street": street, "map": cur_map if knock else None})
        turfs.append({"id": f"T{si}", "name": name, "maps": maps, "rows": rows})
    return {"v": 1, "title": title, "mode": mode, "turfs": turfs}

if __name__ == "__main__":
    out = sys.argv[-1]; os.makedirs(out, exist_ok=True)
    for p in sys.argv[1:-1]:
        d = parse(p); f = os.path.join(out, d["title"] + ".json")
        json.dump(d, open(f, "w"), separators=(",", ":"))
        print(f, len(d["turfs"]), "turfs", sum(r["knock"] for t in d["turfs"] for r in t["rows"]), "doors")
