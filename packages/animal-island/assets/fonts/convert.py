"""Convert the original demo's WOFF faces without downloading font data.

Run with FontTools 4.66.1:
  python convert.py /path/to/animal-island-vue/demo/html/fonts
Preserve outlines/metrics; normalize native family names and embed the OFL.
"""
from pathlib import Path
import hashlib
import json
import sys

import fontTools
from fontTools.ttLib import TTFont

source = Path(sys.argv[1])
target = Path(__file__).resolve().parent
faces = [
    ("nunito-latin", 500, "Medium", "Animal Island Nunito", "AnimalIslandNunito", "Nunito-OFL.txt"),
    ("nunito-latin", 700, "Bold", "Animal Island Nunito", "AnimalIslandNunito", "Nunito-OFL.txt"),
    ("nunito-latin", 900, "Black", "Animal Island Nunito", "AnimalIslandNunito", "Nunito-OFL.txt"),
    ("noto-sans-sc-chinese-simplified", 400, "Regular", "Animal Island Noto Sans SC", "AnimalIslandNotoSansSC", "NotoSansSC-OFL.txt"),
    ("noto-sans-sc-chinese-simplified", 500, "Medium", "Animal Island Noto Sans SC", "AnimalIslandNotoSansSC", "NotoSansSC-OFL.txt"),
    ("noto-sans-sc-chinese-simplified", 700, "Bold", "Animal Island Noto Sans SC", "AnimalIslandNotoSansSC", "NotoSansSC-OFL.txt"),
]

# The original CJK files already include every Latin-subset code point.
# Keep that complete face, including its layout tables, instead of merging
# duplicate glyphs and manufacturing locl substitutions.
for weight in [400, 500, 700]:
    with TTFont(source / f"noto-sans-sc-latin-{weight}-normal.woff") as latin, TTFont(source / f"noto-sans-sc-chinese-simplified-{weight}-normal.woff") as cjk:
        assert set(latin.getBestCmap()) <= set(cjk.getBestCmap())

records = []
for prefix, weight, style, family, postscript_family, license_name in faces:
    input_path = source / f"{prefix}-{weight}-normal.woff"
    data = input_path.read_bytes()
    with TTFont(input_path, recalcTimestamp=False) as font:
        assert "glyf" in font and "fvar" not in font
        assert font["OS/2"].usWeightClass == weight
        old_family = font["name"].getDebugName(1)
        full_name = f"{family} {style}"
        postscript_name = f"{postscript_family}-{style}"
        names = {1: family, 2: style, 3: f"{postscript_name};animal-island-native", 4: full_name,
                 6: postscript_name, 16: family, 17: style, 18: full_name, 21: family, 22: style,
                 13: (target / license_name).read_text(), 14: "https://openfontlicense.org/"}
        for name_id, value in names.items():
            font["name"].removeNames(nameID=name_id)
            font["name"].setName(value, name_id, 3, 1, 0x409)
            font["name"].setName(value, name_id, 1, 0, 0)
        font["OS/2"].fsSelection &= ~(1 << 5 | 1 << 6)
        font["OS/2"].fsSelection |= 1 << (5 if weight >= 700 else 6)
        font["head"].macStyle = (font["head"].macStyle & ~1) | (1 if weight >= 700 else 0)
        if "DSIG" in font:
            del font["DSIG"]
        font.flavor = None
        output = target / f"{postscript_name}.ttf"
        font.save(output)
        records.append({"file": output.name, "family": family, "style": style, "weight": weight,
                        "original": input_path.name, "originalFamily": old_family,
                        "sourceSha256": hashlib.sha256(data).hexdigest(),
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "codePoints": len(font.getBestCmap()), "license": license_name})
(target / "sources.json").write_text(json.dumps({"fontTools": fontTools.__version__, "faces": records}, indent=2) + "\n")
