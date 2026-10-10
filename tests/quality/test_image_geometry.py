import unittest
from types import SimpleNamespace

from scripts.sto_post_build.word_automation import normalize_inline_images


class InlineShapes:
    def __init__(self, shapes):
        self.shapes = shapes
        self.Count = len(shapes)

    def __call__(self, index):
        return self.shapes[index - 1]


def shape(kind=3, text="\x01\r", width=120, height=60):
    paragraph = SimpleNamespace(
        Range=SimpleNamespace(Text=text, ParagraphFormat=SimpleNamespace(Alignment=0))
    )
    return SimpleNamespace(
        Type=kind,
        Width=width,
        Height=height,
        LockAspectRatio=False,
        Range=SimpleNamespace(Paragraphs=lambda _index: paragraph),
    )


class ImageGeometryTests(unittest.TestCase):
    def test_standalone_picture_centered_without_resizing(self):
        picture = shape()
        self.assertEqual(
            normalize_inline_images(SimpleNamespace(InlineShapes=InlineShapes([picture]))), (1, 0)
        )
        self.assertEqual((picture.Width, picture.Height, picture.LockAspectRatio), (120, 60, False))
        self.assertEqual(picture.Range.Paragraphs(1).Range.ParagraphFormat.Alignment, 1)

    def test_small_and_large_linked_pictures_keep_author_geometry(self):
        pictures = [shape(width=24, height=12), shape(kind=4, width=700, height=400)]
        self.assertEqual(
            normalize_inline_images(SimpleNamespace(InlineShapes=InlineShapes(pictures))), (2, 0)
        )
        self.assertEqual([(item.Width, item.Height) for item in pictures], [(24, 12), (700, 400)])

    def test_ole_equations_are_untouched(self):
        equation = SimpleNamespace(Type=1)  # No picture geometry/range interface.
        self.assertEqual(
            normalize_inline_images(SimpleNamespace(InlineShapes=InlineShapes([equation]))), (0, 0)
        )

    def test_picture_in_running_prose_is_not_centered(self):
        picture = shape(text="Before \x01 after\r")
        self.assertEqual(
            normalize_inline_images(SimpleNamespace(InlineShapes=InlineShapes([picture]))), (0, 0)
        )
        self.assertEqual(picture.Range.Paragraphs(1).Range.ParagraphFormat.Alignment, 0)

    def test_com_errors_are_not_swallowed(self):
        picture = shape()
        picture.Range.Paragraphs(1).Range.ParagraphFormat = object()
        with self.assertRaisesRegex(RuntimeError, "Cannot center inline picture 1"):
            normalize_inline_images(SimpleNamespace(InlineShapes=InlineShapes([picture])))


if __name__ == "__main__":
    unittest.main()
