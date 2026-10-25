"""Validate generated style definitions against the bundled WML schema."""

import copy
import sys
from pathlib import Path

from lxml import etree

root = Path(__file__).resolve().parents[2]
schema = etree.XMLSchema(
    etree.parse(root / ".agents/skills/docx/scripts/office/schemas/ISO-IEC29500-4_2016/wml.xsd")
)
word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
document = etree.fromstring(sys.stdin.buffer.read())
styles = document.findall(f"{{{word}}}style")
if not styles:
    raise RuntimeError("No generated style definitions were discovered")
for style in styles:
    # Validate each definition without unrelated compatibility-extension attributes
    # on the generated w:styles container.
    wrapper = etree.Element(f"{{{word}}}styles", nsmap={"w": word})
    wrapper.append(copy.deepcopy(style))
    schema.assertValid(wrapper)
print(f"WML schema validated {len(styles)} generated style definitions.")
