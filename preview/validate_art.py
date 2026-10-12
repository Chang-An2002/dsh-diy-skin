"""Validate the preview page's inline SVG artwork and render it to a sheet.

The preview page keeps each artwork's markup in JS template strings; this pulls
them out, checks they parse as XML (a malformed path silently breaks an icon in
the browser too), and rasterizes what it can so the shapes can be eyeballed.
"""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HTML = Path(__file__).with_name("index.html")
OUT_DIR = Path(__file__).with_name("render")


def extract_svgs(text: str):
    """Yield (label, svg_markup) for every top-level <svg>...</svg> in the file."""
    out = []
    # The artwork helpers live in the ART object; each returns a template
    # literal with the SVG markup.
    for m in re.finditer(r"return `(<svg\b.*?</svg>)`;", text, re.S):
        out.append(("art" + str(len(out)), m.group(1)))
    # Also capture any SVG written directly into markup.
    for m in re.finditer(r'"(<svg\b.*?</svg>)"', text, re.S):
        out.append(("dom" + str(len(out)), m.group(1)))
    return out


def main() -> int:
    text = HTML.read_text(encoding="utf-8")
    artworks = extract_svgs(text)

    # The markup uses ${...} interpolation, so substitute neutral samples first.
    def neutralize(svg: str) -> str:
        svg = re.sub(r"\$\{[^}]*\}", "0", svg)
        return svg

    OUT_DIR.mkdir(exist_ok=True)
    failures = 0
    for label, raw in artworks:
        svg = neutralize(raw)
        try:
            root = ET.fromstring(svg)
        except ET.ParseError as exc:
            failures += 1
            print(f"FAIL {label}: {exc}")
            continue
        shapes = len(list(root.iter()))
        tag = root.tag.split("}")[-1]
        print(f"OK   {label}: <{tag}> nodes={shapes} viewBox={root.get('viewBox')}")
        (OUT_DIR / f"{label}.svg").write_text(svg, encoding="utf-8")

    print(f"\nartworks={len(artworks)} failures={failures}")

    # Rasterize when a converter is available; absence is not a failure.
    try:
        import cairosvg  # type: ignore
    except Exception:
        print("cairosvg unavailable: SVG files written to render/ for manual viewing")
        return 1 if failures else 0

    for svg_file in sorted(OUT_DIR.glob("*.svg")):
        png = svg_file.with_suffix(".png")
        cairosvg.svg2png(url=str(svg_file), write_to=str(png), scale=3, background_color="#ffffff")
        print(f"rendered {png.name}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
