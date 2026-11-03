# Regenerates gpuix-test-square.ttf and gpuix-test-nameless.ttf (needs `pip install fonttools`).
#
# "A" and "m" are one em wide, "B" is two. Each is a filled square, so text
# measured with this font has widths no system font produces.
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

NAME = "GpuixTestSquare"
UPM = 1000


def square(width):
    pen = TTGlyphPen(None)
    pen.moveTo((0, 0))
    pen.lineTo((0, UPM))
    pen.lineTo((width, UPM))
    pen.lineTo((width, 0))
    pen.closePath()
    return pen.glyph()


widths = {".notdef": UPM, "A": UPM, "B": 2 * UPM, "m": UPM}


def build(path, names):
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(list(widths))
    fb.setupCharacterMap({ord("A"): "A", ord("B"): "B", ord("m"): "m"})
    fb.setupGlyf({name: square(width) for name, width in widths.items()})
    fb.setupHorizontalMetrics({name: (width, 0) for name, width in widths.items()})
    fb.setupHorizontalHeader(ascent=UPM, descent=0)
    fb.setupNameTable(names)
    fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, usWinAscent=UPM, usWinDescent=0)
    fb.setupPost()
    fb.save(path)


build(
    "gpuix-test-square.ttf",
    {
        "familyName": NAME,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{NAME}-Regular",
        "fullName": f"{NAME} Regular",
        "psName": f"{NAME}-Regular",
        "version": "Version 1.0",
    },
)

# Valid, but without the full and PostScript names. GPUI aborts the process
# when it loads such a font, so registerFont has to refuse it.
build("gpuix-test-nameless.ttf", {"familyName": "GpuixTestNameless", "styleName": "Regular"})
