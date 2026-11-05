#!/usr/bin/env python3
"""Pixel-art mockup of the 'Stack IA' cozy agent office (1920x1080)."""
from PIL import Image, ImageDraw, ImageFont
import sys

OUT = sys.argv[1]
W, H = 480, 272            # world at 1x
Z = 3                      # world zoom -> 1440x816
FB = "/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Bold.ttf"
FR = "/usr/share/fonts/TTF/JetBrainsMonoNerdFontMono-Medium.ttf"
_f = {}


def font(sz, bold=True):
    k = (sz, bold)
    if k not in _f:
        _f[k] = ImageFont.truetype(FB if bold else FR, sz)
    return _f[k]


# palette
GRASS = (143, 201, 92); GRASS2 = (128, 186, 80); SAND = (240, 222, 160); SAND2 = (226, 205, 140)
OUTL = (84, 56, 44); WALL = (246, 234, 212); WAIN = (222, 178, 146); WALLSH = (230, 214, 188)
WOOD1 = (212, 160, 104); WOOD2 = (198, 145, 92); WOODD = (150, 100, 62); WOODL = (232, 190, 136)
CREAM1 = (250, 240, 214); CREAM2 = (240, 226, 190)
MINT1 = (200, 226, 196); MINT2 = (186, 214, 184)
PINK1 = (248, 218, 214); PINK2 = (240, 202, 200)
BLUE1 = (206, 224, 240); BLUE2 = (190, 212, 234)
SCREEN = (120, 220, 230); DARK = (50, 44, 56)
GREEN = (74, 150, 76); GREEND = (52, 112, 60)

img = Image.new("RGB", (W, H), GRASS)
d = ImageDraw.Draw(img)


def R(x0, y0, x1, y1, c):
    d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=c)


# ---------------- outside
for y in range(0, H, 4):
    for x in range((y // 4 % 2) * 6, W, 12):
        d.point((x, y), fill=GRASS2)
R(190, 232, 264, 272, SAND); R(200, 236, 254, 272, SAND2)
for i in range(0, 56, 8):
    R(200 + i, 240 + (i % 16) // 2, 206 + i, 246 + (i % 16) // 2, SAND)


def tree(x, y):
    R(x + 5, y + 18, x + 9, y + 26, (120, 84, 54))
    d.ellipse([x, y, x + 14, y + 20], fill=GREEND)
    d.ellipse([x + 2, y + 1, x + 12, y + 14], fill=GREEN)
    d.ellipse([x + 4, y + 3, x + 8, y + 7], fill=(110, 176, 90))


for tx, ty in [(4, 240), (12, 8), (462, 6), (456, 240), (8, 130), (466, 128), (150, 244), (330, 246), (36, 252)]:
    tree(tx, ty)


def flower(x, y, c):
    d.point((x, y), fill=c); d.point((x + 1, y), fill=c); d.point((x, y + 1), fill=(255, 245, 200))


for fx, fy, fc in [(60, 246, (240, 120, 150)), (110, 252, (250, 220, 90)), (300, 250, (240, 120, 150)), (380, 244, (160, 140, 240)),
                   (420, 252, (250, 220, 90)), (24, 70, (250, 220, 90)), (470, 76, (240, 120, 150)), (20, 200, (160, 140, 240))]:
    flower(fx, fy, fc)

# ---------------- building shell
R(24, 20, 456, 238, OUTL)

ROOMS = {
    "A": (28, 24, 172, 120), "B": (176, 24, 316, 120), "C": (320, 24, 452, 120),
    "D": (28, 124, 172, 234), "E": (176, 124, 360, 234), "F": (364, 124, 452, 234),
}


def room(key, f1, f2, plank=False):
    x0, y0, x1, y1 = ROOMS[key]
    R(x0, y0, x1, y1, f1)
    if plank:
        for y in range(y0 + 12, y1, 8):
            R(x0, y, x1, y + 1, f2)
        for y in range(y0 + 12, y1, 16):
            for x in range(x0 + ((y // 16) % 2) * 20, x1, 40):
                R(x, y, x + 1, y + 8, f2)
    else:
        for y in range(y0 + 12, y1, 8):
            for x in range(x0 + (((y - y0) // 8) % 2) * 8, x1, 16):
                R(x, y, min(x + 8, x1), min(y + 8, y1), f2)
    R(x0, y0, x1, y0 + 12, WALL)
    R(x0, y0 + 8, x1, y0 + 12, WAIN)
    R(x0, y0 + 12, x1, y0 + 13, WALLSH)


room("A", WOOD1, WOOD2, True)
room("B", CREAM1, CREAM2)
room("C", MINT1, MINT2)
room("D", PINK1, PINK2)
room("E", WOOD1, WOOD2, True)
room("F", BLUE1, BLUE2)

# doors
for (x0, y0, x1, y1, c) in [(172, 88, 176, 112, WOOD1), (316, 88, 320, 112, CREAM1), (88, 120, 112, 124, WOOD1),
                            (228, 120, 252, 124, CREAM1), (328, 120, 352, 124, MINT1), (172, 168, 176, 192, WOOD1),
                            (360, 168, 364, 192, WOOD1), (252, 234, 284, 238, WOOD1)]:
    R(x0, y0, x1, y1, c)


# ---------------- furniture helpers
def desk(x, y, w=30):
    R(x, y, x + w, y + 8, WOODL); R(x, y + 8, x + w, y + 12, WOODD); R(x + 1, y + 12, x + 3, y + 16, WOODD); R(x + w - 3, y + 12, x + w - 1, y + 16, WOODD)


def monitor(x, y, glow=SCREEN):
    R(x, y, x + 10, y + 8, DARK); R(x + 1, y + 1, x + 9, y + 7, glow); R(x + 4, y + 8, x + 6, y + 10, DARK)
    for i in range(3):
        R(x + 2, y + 2 + i * 2, x + 2 + 3 + (i % 2) * 3, y + 3 + i * 2, (240, 250, 250))


def chair(x, y, c=(190, 90, 80)):
    R(x, y, x + 8, y + 6, c); R(x + 1, y + 6, x + 7, y + 8, tuple(max(0, v - 40) for v in c))


def plant(x, y):
    R(x + 2, y + 8, x + 8, y + 14, (196, 108, 78)); R(x + 2, y + 8, x + 8, y + 9, (220, 140, 100))
    d.ellipse([x, y, x + 10, y + 10], fill=GREEND); d.ellipse([x + 2, y + 1, x + 9, y + 8], fill=GREEN)
    d.point((x + 4, y + 3), fill=(120, 190, 100))


def shelf(x, y, w=30, rows=2):
    R(x, y, x + w, y + 10 * rows + 2, WOODD)
    for r in range(rows):
        R(x + 1, y + 1 + r * 10, x + w - 1, y + 10 + r * 10, (110, 72, 46))
        bx = x + 2
        i = 0
        cols = [(214, 92, 84), (90, 140, 210), (240, 200, 80), (110, 180, 120), (180, 110, 200), (240, 150, 80)]
        while bx < x + w - 3:
            bw = 2 + (i * 7 + r * 3) % 3
            R(bx, y + 3 + r * 10 + (i % 2), bx + bw, y + 10 + r * 10, cols[(i + r * 2) % 6])
            bx += bw + 1
            i += 1


def window(x, y, w=18):
    R(x, y, x + w, y + 10, OUTL); R(x + 1, y + 1, x + w - 1, y + 9, (170, 220, 245)); R(x + w // 2, y + 1, x + w // 2 + 1, y + 9, OUTL)
    R(x + 2, y + 2, x + 5, y + 4, (220, 240, 252))


def rug(x0, y0, x1, y1, c1, c2):
    R(x0, y0, x1, y1, c1); R(x0 + 2, y0 + 2, x1 - 2, y1 - 2, c2)
    for x in range(x0 + 4, x1 - 4, 6):
        R(x, y0 + 3, x + 2, y0 + 4, c1); R(x, y1 - 4, x + 2, y1 - 3, c1)


def char(x, y, hair, shirt, skin=(244, 206, 170), pants=(70, 80, 120), arms_up=False):
    R(x + 1, y, x + 7, y + 3, hair); R(x, y + 1, x + 8, y + 4, hair)
    R(x + 1, y + 3, x + 7, y + 7, skin)
    d.point((x + 2, y + 5), fill=DARK); d.point((x + 5, y + 5), fill=DARK)
    R(x + 1, y + 7, x + 7, y + 12, shirt); R(x, y + 8, x + 1, y + 11, shirt); R(x + 7, y + 8, x + 8, y + 11, shirt)
    R(x + 2, y + 12, x + 6, y + 15, pants); R(x + 2, y + 15, x + 3, y + 16, DARK); R(x + 5, y + 15, x + 6, y + 16, DARK)
    if arms_up:
        R(x - 1, y - 3, x + 1, y + 6, shirt); R(x + 7, y - 3, x + 9, y + 6, shirt)
        R(x - 1, y - 5, x + 1, y - 3, skin); R(x + 7, y - 5, x + 9, y - 3, skin)


def cat(x, y):
    d.ellipse([x, y + 2, x + 12, y + 9], fill=(232, 150, 80)); d.ellipse([x + 9, y, x + 15, y + 6], fill=(232, 150, 80))
    d.point((x + 10, y), fill=(232, 150, 80)); R(x + 10, y - 1, x + 11, y + 1, (232, 150, 80)); R(x + 13, y - 1, x + 14, y + 1, (232, 150, 80))
    R(x + 1, y + 8, x + 11, y + 9, (200, 120, 60)); d.point((x + 11, y + 3), fill=DARK); d.point((x + 13, y + 3), fill=DARK)


def bug(x, y):
    d.ellipse([x, y, x + 6, y + 4], fill=(214, 70, 70)); R(x - 1, y + 1, x, y + 2, DARK); R(x + 6, y + 1, x + 7, y + 2, DARK)
    R(x, y + 4, x + 1, y + 6, DARK); R(x + 5, y + 4, x + 6, y + 6, DARK); d.point((x + 3, y + 1), fill=DARK)


# ---------------- Room A: Arquitecto
window(38, 28); window(62, 28)
shelf(120, 28, 36, 1)
rug(40, 70, 110, 108, (96, 130, 190), (130, 164, 220))
desk(48, 52, 36); monitor(56, 42); monitor(70, 42, (250, 200, 130))
chair(62, 74, (214, 100, 86))
plant(150, 96); plant(32, 98)
# blueprint on wall
R(92, 30, 112, 42, (120, 170, 220)); d.line([(95, 38), (100, 33), (106, 37), (109, 32)], fill=(240, 250, 255))

# ---------------- Room B: Taller
R(184, 30, 232, 40, (150, 170, 160))
for i in range(6):
    R(188 + i * 7, 32, 191 + i * 7, 38, [(230, 120, 90), (110, 150, 200), (240, 200, 80)][i % 3])
desk(188, 56, 70); monitor(196, 46); monitor(212, 46); monitor(228, 46, (170, 230, 150))
chair(214, 78, (80, 150, 150))
R(272, 54, 296, 76, (176, 130, 86)); R(272, 54, 296, 58, WOODL); R(276, 62, 292, 64, WOODD)
R(284, 92, 304, 110, (176, 130, 86)); R(284, 92, 304, 96, WOODL)
plant(300, 96)
d.ellipse([260, 98, 270, 108], outline=DARK); d.ellipse([263, 101, 267, 105], fill=(250, 200, 80))

# ---------------- Room C: Biblioteca
shelf(326, 28, 28, 2); shelf(358, 28, 28, 2); shelf(390, 28, 28, 2)
R(424, 30, 446, 42, (170, 220, 245)); R(425, 31, 445, 41, (200, 235, 250))
desk(356, 62, 40); chair(370, 84, (110, 100, 190))
R(362, 56, 368, 62, (250, 220, 120)); R(364, 58, 366, 62, (250, 240, 190))   # lamp
rug(332, 88, 440, 114, (90, 160, 130), (130, 196, 160))
plant(432, 96); shelf(332, 70, 22, 1)

# ---------------- Room D: QA
R(34, 128, 76, 146, (250, 250, 246)); R(35, 129, 75, 145, (255, 255, 252))
for i in range(4):
    R(38, 132 + i * 4, 42, 134 + i * 4, (90, 190, 110)); R(46, 133 + i * 4, 46 + 14 + (i % 2) * 8, 134 + i * 4, (180, 180, 190))
desk(48, 164, 40); monitor(54, 154); monitor(68, 154, (150, 230, 160)); monitor(82, 154, (240, 150, 140))
chair(66, 186, (230, 190, 70))
rug(100, 190, 164, 226, (214, 130, 150), (240, 170, 186))
bug(130, 208); plant(150, 130); plant(32, 214)
R(120, 140, 160, 150, WOODD); R(121, 141, 159, 149, (130, 90, 60))
for i in range(5):
    R(124 + i * 7, 143, 127 + i * 7, 147, [(240, 110, 100), (110, 200, 130)][i % 2])

# ---------------- Room E: lounge (hub)
window(260, 128, 22); window(300, 128, 22)
# cork board
R(182, 128, 232, 150, WOODD); R(183, 129, 231, 149, (196, 150, 100))
for (nx, ny, nc) in [(186, 132, (250, 230, 110)), (198, 133, (240, 140, 150)), (210, 132, (140, 200, 240)), (220, 134, (150, 220, 150)), (190, 141, (250, 230, 110)),
                     (204, 141, (240, 140, 150)), (216, 142, (140, 200, 240))]:
    R(nx, ny, nx + 8, ny + 7, nc); d.point((nx + 3, ny), fill=(200, 60, 60))
# mail tray
R(326, 134, 350, 146, WOODD); R(327, 135, 349, 145, (240, 234, 220)); R(330, 137, 346, 141, (250, 250, 246)); R(334, 138, 342, 140, (210, 90, 80))
rug(206, 168, 330, 222, (206, 96, 84), (240, 196, 150))
R(232, 184, 304, 204, (196, 120, 72)); R(234, 186, 302, 202, (226, 150, 96)); R(256, 188, 262, 194, (250, 250, 240))
R(244, 188, 250, 193, (240, 230, 220)); R(280, 189, 286, 194, (220, 120, 120))
# couches
R(222, 154, 262, 166, (120, 150, 200)); R(222, 150, 262, 156, (96, 126, 176)); R(224, 152, 232, 160, (150, 180, 224))
R(274, 154, 314, 166, (214, 120, 140)); R(274, 150, 314, 156, (184, 96, 116))
plant(188, 214); plant(340, 214)
cat(246, 206)
# coffee machine
R(342, 168, 354, 182, DARK); R(344, 170, 352, 176, (180, 60, 60)); R(346, 178, 350, 182, (240, 240, 240))

# ---------------- Room F: Red / invitados
R(370, 128, 446, 146, (40, 52, 70)); R(371, 129, 445, 145, (50, 70, 96))
for i in range(5):
    R(376 + i * 14, 134, 382 + i * 14, 139, [(120, 220, 130), (120, 220, 130), (240, 190, 90), (120, 220, 130), (120, 220, 130)][i])
desk(372, 168, 30); monitor(380, 158, (250, 190, 150)); chair(384, 188, (230, 140, 90))
desk(414, 168, 30); monitor(422, 158, (200, 170, 250)); chair(426, 188, (170, 100, 200))
# router
R(388, 206, 408, 214, DARK); R(390, 208, 394, 210, (120, 230, 140)); R(396, 208, 400, 210, (120, 230, 140)); R(402, 208, 406, 210, (250, 200, 90))
R(390, 198, 391, 206, DARK); R(405, 198, 406, 206, DARK)
plant(436, 210)

# ---------------- characters
char(60, 58 - 6, (86, 56, 40), (224, 120, 90))                      # ARQ
char(216, 62 - 8, (30, 30, 36), (60, 170, 170))                     # COD
char(216, 176, (240, 210, 110), (120, 110, 210), arms_up=True)       # FLA bailando en la sala comun
char(68, 168 - 10, (200, 80, 60), (236, 190, 70))                   # QA
char(262, 138, (96, 64, 44), (110, 190, 100))                       # OWNER
char(382, 172 - 12, (50, 40, 36), (240, 140, 150))                  # amigo 1
char(424, 172 - 12, (130, 80, 50), (240, 160, 80))                  # amigo 2


Z5 = 5
world = img.resize((W * Z5, H * Z5), Image.NEAREST)
world.save(OUT)
print("saved", OUT, world.size)
