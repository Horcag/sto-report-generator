import unittest
from types import SimpleNamespace

from scripts.sto_post_build.word_automation import (
    collect_page_placeholder_paragraphs,
    find_broken_references,
    previous_paragraph_before,
)


class Paragraphs:
    def __init__(self, paragraphs):
        self.items = paragraphs
        self.visits = 0

    def __iter__(self):
        for item in self.items:
            self.visits += 1
            yield item


class Document:
    def __init__(self, texts):
        self.text = "".join(texts)
        start = 0
        paragraphs = []
        for text in texts:
            paragraphs.append(
                SimpleNamespace(
                    Range=SimpleNamespace(Start=start, End=start + len(text), Text=text)
                )
            )
            start += len(text)
        self.Paragraphs = Paragraphs(paragraphs)

    @property
    def Content(self):
        return SearchRange(self, 0, len(self.text))

    def Range(self, start, end):
        if start < 0 or start >= len(self.text):
            raise ValueError("Outside story")
        return SearchRange(self, start, end)


class SearchRange:
    def __init__(self, doc, start, end):
        self.doc, self.Start, self.End = doc, start, end
        self.Find = self

    @property
    def Text(self):
        return self.doc.text[self.Start : self.End]

    def Paragraphs(self, index):
        return next(
            p for p in self.doc.Paragraphs.items if p.Range.Start <= self.Start < p.Range.End
        )

    def Execute(self, **kwargs):
        token = kwargs["FindText"]
        position = self.doc.text.find(token, self.Start, self.End)
        if position < 0:
            return False
        self.Start, self.End = position, position + len(token)
        return True


class WordRangeAccessTests(unittest.TestCase):
    def test_previous_completed_paragraph_boundaries_and_interior(self):
        doc = Document(["first\r", "second\r", "cell\r\x07", "last\r"])
        self.assertIsNone(previous_paragraph_before(doc, 0))
        self.assertIsNone(previous_paragraph_before(doc, 2))
        for position, index in [(6, 0), (8, 0), (13, 1), (19, 2), (24, 3)]:
            self.assertIs(previous_paragraph_before(doc, position), doc.Paragraphs.items[index])

    def test_templates_preserve_order_and_one_entry_per_paragraph(self):
        doc = Document(["intro\r", "{{PAGES}} {{PAGES_WORD}}\r", "x\r", "{{PAGES}}\r\x07"])
        found = collect_page_placeholder_paragraphs(doc)
        self.assertEqual([text for _, text in found], ["{{PAGES}} {{PAGES_WORD}}", "{{PAGES}}"])
        self.assertIs(found[0][0], doc.Paragraphs.items[1])
        self.assertEqual(collect_page_placeholder_paragraphs(Document(["none\r"])), [])

    def test_broken_references_keep_paragraph_and_cell_boundaries(self):
        doc = Document(
            [
                "normal\r",
                "NOT FOUND\vmanual break\r",
                "Источник не найден\r\x07",
                "NOT \r",
                "FOUND\r",
            ]
        )
        self.assertEqual(
            find_broken_references(doc),
            [
                "CRITICAL: Broken reference or source found: NOT FOUND\vmanual break",
                "CRITICAL: Broken reference or source found: Источник не найден\r\x07",
            ],
        )

    def test_addressed_lookups_do_not_enumerate_global_collection(self):
        doc = Document(["paragraph\r"] * 4000 + ["{{PAGES}}\r"])
        previous_paragraph_before(doc, 39990)
        collect_page_placeholder_paragraphs(doc)
        find_broken_references(doc)
        self.assertEqual(doc.Paragraphs.visits, 0)


if __name__ == "__main__":
    unittest.main()
