#!/usr/bin/env python3
"""Builds public/office.png (empty office) and public/sprites.png from mockups/make_world.py."""
import pathlib
import sys
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "mockups" / "make_world.py").read_text(encoding="utf8")
SPRITE_W, SPRITE_H, SCALE = 12, 24, 5

# Order must match SPRITE_ROWS in public/app.js.
PEOPLE = [
    ("arq", (86, 56, 40), (224, 120, 90)),
    ("cod", (30, 30, 36), (60, 170, 170)),
    ("qa", (200, 80, 60), (236, 190, 70)),
    ("bib", (240, 210, 110), (120, 110, 210)),
    ("mun", (70, 110, 50), (110, 170, 80)),
    ("ui", (150, 60, 120), (220, 120, 170)),
    ("rev", (70, 70, 110), (150, 150, 200)),
    ("owner", (96, 64, 44), (110, 190, 100)),
]

head, tail = SOURCE.split("# ---------------- characters")
scope = {}
sys.argv = ["make_world", str(ROOT / "public" / "office.png")]
exec(head, scope)
exec(tail[tail.index("Z5 = 5"):], scope)

sheet = Image.new("RGBA", (SPRITE_W * 2, SPRITE_H * len(PEOPLE)), (0, 0, 0, 0))
for row, (_, hair, shirt) in enumerate(PEOPLE):
    for frame, arms_up in enumerate((False, True)):
        cell = Image.new("RGBA", (SPRITE_W, SPRITE_H), (0, 0, 0, 0))
        scope["d"] = ImageDraw.Draw(cell)
        scope["char"](2, 6, hair, shirt, arms_up=arms_up)
        sheet.paste(cell, (frame * SPRITE_W, row * SPRITE_H))
sheet.resize((sheet.width * SCALE, sheet.height * SCALE), Image.NEAREST).save(ROOT / "public" / "sprites.png")
print("sprites saved")
