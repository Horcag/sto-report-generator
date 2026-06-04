import re
from pathlib import Path

WD_ALIGN_PARAGRAPH_CENTER = 1
WD_FIND_CONTINUE = 1
WD_REPLACE_ALL = 2
WD_STATISTIC_PAGES = 2
WD_ACTIVE_END_PAGE_NUMBER = 3
WD_EXPORT_FORMAT_PDF = 17
MAX_IMAGE_WIDTH_POINTS = 14 / 2.54 * 72
DIRTY_TRUE_RE = re.compile(r'w:dirty="(?:true|1)"')
MATH_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
MATH_XSL_PATH = Path(r"C:\Program Files\Microsoft Office\root\Office16\MML2OMML.XSL")
MATH_PATTERN = re.compile(r"\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$")
SPACING_AFTER_TABLE_TWIPS = "120"
SMALL_TILDE = "\u02dc"
BROKEN_REFERENCE_MARKERS = ("Источник не найден", "NOT FOUND")
