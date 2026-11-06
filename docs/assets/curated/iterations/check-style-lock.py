"""Enforce prompt-3 token block on SVGs. Usage: python3 -I check-style-lock.py FILE.svg ...  Exit 1 on any violation."""
import re
import sys
import xml.etree.ElementTree as ET

ALLOWED = {"#f8fafc", "#1e293b", "#059669", "none"}
BANNED = {"text", "lineargradient", "radialgradient", "filter", "image", "fegaussianblur"}
STROKED = {"path", "line", "rect", "circle", "polyline", "polygon", "ellipse"}

def check(path: str) -> list[str]:
    out = []
    root = ET.parse(path).getroot()
    hero = "hero" in path
    nodes = 0
    for el in root.iter():
        tag = el.tag.split("}")[-1].lower()
        a = {k.split("}")[-1]: v for k, v in el.attrib.items()}
        if tag in BANNED:
            out.append(f"<{tag}> is banned")
        for key in ("fill", "stroke", "stop-color"):
            v = a.get(key, "").lower()
            if v and v not in ALLOWED:
                out.append(f"<{tag}> {key}={v} is off-palette")
        if "opacity" in a:
            out.append(f"<{tag}> opacity={a['opacity']} (use stroke-opacity on hero lines only)")
        if "stroke-opacity" in a and not (hero and a["stroke-opacity"] == "0.18"):
            out.append(f"<{tag}> stroke-opacity={a['stroke-opacity']} not allowed here")
        if tag == "circle" and a.get("fill", "").lower() == "#059669":
            nodes += 1
            if a.get("r") != "2.5" or a.get("stroke") not in (None, "none"):
                out.append(f"invariant node must be r=2.5 with no stroke (got r={a.get('r')})")
            continue
        if tag == "rect" and a.get("fill", "").lower() == "#f8fafc" and "stroke" not in a:
            continue  # background
        if tag in STROKED or tag == "g":
            if "stroke-width" in a and a["stroke-width"] != "1.5":
                out.append(f"<{tag}> stroke-width={a['stroke-width']} (must be 1.5)")
    # stroke-width / vector-effect may be inherited from a <g>: require them somewhere on every stroked element's ancestors.
    def inherited(el, key, parents):
        for n in [el] + parents:
            v = {k.split("}")[-1]: x for k, x in n.attrib.items()}.get(key)
            if v is not None:
                return v
        return None
    def walk(el, parents):
        tag = el.tag.split("}")[-1].lower()
        a = el.attrib
        if tag in STROKED and not (tag == "circle" and a.get("fill", "").lower() == "#059669") and not (tag == "rect" and a.get("fill", "").lower() == "#f8fafc" and "stroke" not in a):
            fill = (inherited(el, "fill", parents) or "").lower()
            if fill != "none":
                out.append(f"<{tag}> fill={fill or 'unset (SVG default is black)'}: line art must be fill=none")
            if inherited(el, "stroke-width", parents) != "1.5":
                out.append(f"<{tag}> has no 1.5 stroke-width")
            # vector-effect does not inherit in SVG: it must sit on the element itself.
            if a.get("vector-effect") != "non-scaling-stroke":
                out.append(f"<{tag}> lacks vector-effect=non-scaling-stroke on the element")
        for c in el:
            walk(c, [el] + parents)
    walk(root, [])
    if not 1 <= nodes <= 3:
        out.append(f"{nodes} emerald invariant nodes (need 1-3)")
    vb = root.attrib.get("viewBox", "")
    if vb != ("0 0 480 240" if hero else "0 0 48 48"):
        out.append(f"viewBox {vb!r} is off-grid")
    return sorted(set(out))

failed = False
for f in sys.argv[1:]:
    v = check(f)
    failed |= bool(v)
    print(f"{'PASS' if not v else 'FAIL'} {f.split('/')[-1]}" + "".join(f"\n     - {x}" for x in v))
sys.exit(1 if failed else 0)
