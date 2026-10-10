"""Create task-owned raster/vector/crop sources for native Word acceptance."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (1800, 900), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype("DejaVuSans.ttf", 64)
    for x, text in [(100, "Input"), (700, "Check"), (1300, "Result")]:
        draw.rounded_rectangle((x, 240, x + 400, 600), radius=12, outline="black", width=5)
        draw.text((x + 35, 360), text, fill="black", font=font)
    for x in [500, 1100]:
        draw.line((x, 420, x + 200, 420), fill="black", width=5)
        draw.polygon([(x + 200, 420), (x + 170, 402), (x + 170, 438)], fill="black")
    image.save(destination / "diagram.png")
    icon = Image.new("RGB", (96, 96), "white")
    ImageDraw.Draw(icon).ellipse((10, 10, 85, 85), outline="black", width=4)
    icon.save(destination / "icon.png")
    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600">
<rect width="1200" height="600" fill="white"/>
<g fill="none" stroke="black" stroke-width="3"><rect x="80" y="160" width="280" height="240"/><rect x="460" y="160" width="280" height="240"/><rect x="840" y="160" width="280" height="240"/><path d="M360 280 H460 M740 280 H840"/></g>
<g font-family="Arial" font-size="44" fill="black"><text x="110" y="290">Input</text><text x="490" y="290">Check</text><text x="870" y="290">Result</text></g></svg>"""
    (destination / "diagram.svg").write_text(svg, encoding="utf-8")
    metadata = """---
department: Example institute
subdepartment: Example department
reportType: Figure acceptance
degree: bachelor
semester: 6
specialtyCode: "01.03.02"
specialtyName: Example specialty
profileName: Example profile
supervisorName: Example supervisor
supervisorTitle: Example title
city: Samara
topic: Physical dimensions and original media preservation
studentName: Example
groupNumber: Example
year: 2026
---

Raster at explicit width.

![High resolution raster](diagram.png)

Рисунок 1 \u2013 Raster at 140 mm (@fig:raster)

Repeated asset at a different width.

![Repeated raster](diagram.png)

Рисунок 2 \u2013 Raster at 100 mm (@fig:repeat)

Editable non-destructive crop.

![Cropped raster](diagram.png)

Рисунок 3 \u2013 Cropped raster (@fig:crop)

Vector with a genuine raster fallback.

![Vector](diagram.svg)

Рисунок 4 \u2013 SVG with PNG fallback (@fig:vector)

Small original must retain its selected dimensions.

![Small icon](icon.png)

Рисунок 5 \u2013 Small raster at 10 mm (@fig:icon)
"""
    (destination / "00.md").write_text(metadata, encoding="utf-8")
    settings = {
        "defaults": {"minDpi": 150, "minTextPt": 9, "quality": "warn"},
        "figures": {
            "raster": {"widthMm": 140, "textSizePx": 64},
            "repeat": {"widthMm": 100, "textSizePx": 64},
            "crop": {
                "widthMm": 130,
                "textSizePx": 64,
                "crop": {"left": 2, "right": 2, "top": 15, "bottom": 15},
            },
            "vector": {"widthMm": 140, "fallback": "diagram.png"},
            "icon": {"widthMm": 10},
        },
    }
    (destination / "figures.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
