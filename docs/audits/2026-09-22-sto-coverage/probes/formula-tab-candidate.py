"""Build a tab-stop formula candidate from a generated DOCX for Word comparison.

This is an audit probe, not a production formatter. It changes only formula layout
tables and adds an MTDisplayEquation paragraph style to a copy of the DOCX.
"""

import re
import sys
from pathlib import Path
from zipfile import ZipFile

STYLE = (
    '<w:style w:type="paragraph" w:styleId="MTDisplayEquation">'
    '<w:name w:val="MTDisplayEquation"/><w:basedOn w:val="Normal"/>'
    '<w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/>'
    '<w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>'
    '<w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>'
    "</w:style>"
)
TABLE = re.compile(r"<w:tbl>[\s\S]*?</w:tbl>")
MATH = re.compile(r"<m:oMath>[\s\S]*?</m:oMath>")
NUMBER = re.compile(r"<w:t[^>]*>(\([A-Za-z\u0410-\u042f\u0430-\u044f0-9.]+\))</w:t>")


def convert_table(match: re.Match[str]) -> str:
    table = match.group()
    math = MATH.search(table)
    if not math:
        return table
    number = NUMBER.search(table)
    if not number:
        raise ValueError("Formula table has no number")
    return (
        '<w:p><w:pPr><w:pStyle w:val="MTDisplayEquation"/></w:pPr>'
        "<w:r><w:tab/></w:r>"
        + math.group()
        + "<w:r><w:tab/><w:t>"
        + number.group(1)
        + "</w:t></w:r></w:p>"
    )


def main() -> None:
    source, target = map(Path, sys.argv[1:3])
    if source.resolve() == target.resolve():
        raise ValueError("Source and target must differ")
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(source) as original, ZipFile(target, "w") as candidate:
        for info in original.infolist():
            content = original.read(info.filename)
            if info.filename == "word/document.xml":
                document = content.decode("utf-8")
                document, count = TABLE.subn(convert_table, document)
                if count == 0 or "MTDisplayEquation" not in document:
                    raise ValueError("No formula layout table converted")
                content = document.encode("utf-8")
            elif info.filename == "word/styles.xml":
                styles = content.decode("utf-8")
                if 'w:styleId="MTDisplayEquation"' not in styles:
                    styles = styles.replace("</w:styles>", STYLE + "</w:styles>")
                content = styles.encode("utf-8")
            candidate.writestr(info, content)


if __name__ == "__main__":
    main()
