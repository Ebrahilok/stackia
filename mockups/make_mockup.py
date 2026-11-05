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


def char(x, y, hair, shirt, skin=(244, 206, 170), pants=(70, 80, 120)):
    R(x + 1, y, x + 7, y + 3, hair); R(x, y + 1, x + 8, y + 4, hair)
    R(x + 1, y + 3, x + 7, y + 7, skin)
    d.point((x + 2, y + 5), fill=DARK); d.point((x + 5, y + 5), fill=DARK)
    R(x + 1, y + 7, x + 7, y + 12, shirt); R(x, y + 8, x + 1, y + 11, shirt); R(x + 7, y + 8, x + 8, y + 11, shirt)
    R(x + 2, y + 12, x + 6, y + 15, pants); R(x + 2, y + 15, x + 3, y + 16, DARK); R(x + 5, y + 15, x + 6, y + 16, DARK)


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
char(372, 66 - 6, (240, 210, 110), (120, 110, 210))                 # FLA (biblioteca)
char(68, 168 - 10, (200, 80, 60), (236, 190, 70))                   # QA
char(262, 138, (96, 64, 44), (110, 190, 100))                       # OWNER
char(382, 172 - 12, (50, 40, 36), (240, 140, 150))                  # amigo 1
char(424, 172 - 12, (130, 80, 50), (240, 160, 80))                  # amigo 2

# ---------------- upscale
world = img.resize((W * Z, H * Z), Image.NEAREST)

# ================= full canvas
CW, CH = 1920, 1080
TOP, BOT = 56, 872
canvas = Image.new("RGB", (CW, CH), (44, 34, 40))
canvas.paste(world, (0, TOP))
D = ImageDraw.Draw(canvas)


def T(xy, s, sz=18, fill=(250, 244, 232), bold=True, anchor="la"):
    D.text(xy, s, font=font(sz, bold), fill=fill, anchor=anchor)


def rr(box, r, fill=None, outline=None, w=1):
    D.rounded_rectangle(box, r, fill=fill, outline=outline, width=w)


def wx(x):  # world->canvas
    return x * Z


def wy(y):
    return y * Z + TOP


# room labels
for key, label, col in [("A", "ARQUITECTO", (224, 120, 90)), ("B", "TALLER", (60, 170, 170)), ("C", "BIBLIOTECA", (120, 110, 210)),
                        ("D", "QA", (236, 190, 70)), ("E", "SALA COMÚN", (210, 110, 90)), ("F", "RED · INVITADOS", (90, 150, 210))]:
    x0, y0, x1, y1 = ROOMS[key]
    tw = D.textlength(label, font=font(15))
    bx = wx(x0) + 10
    rr((bx, wy(y0) + 4, bx + tw + 16, wy(y0) + 28), 6, fill=(60, 44, 40), outline=col, w=2)
    T((bx + 8, wy(y0) + 7), label, 15, (250, 240, 225))


def bubble(cx, cy, tag, icon, col):
    # cx,cy: world coords of the character's head top
    px, py = wx(cx) - 6, wy(cy) - 48
    tw = D.textlength(tag + ":", font=font(15))
    w = int(tw) + 54
    rr((px, py, px + w, py + 34), 10, fill=(255, 252, 244), outline=OUTL, w=3)
    D.polygon([(px + 18, py + 34), (px + 30, py + 34), (px + 22, py + 44)], fill=(255, 252, 244), outline=OUTL)
    D.line([(px + 20, py + 33), (px + 29, py + 33)], fill=(255, 252, 244), width=3)
    T((px + 10, py + 8), tag + ":", 15, col)
    ix, iy = px + 14 + int(tw), py + 17
    if icon == "typing":
        for i in range(3):
            D.ellipse([ix + i * 11, iy - 3, ix + 5 + i * 11, iy + 2], fill=(90, 90, 100))
    elif icon == "search":
        D.ellipse([ix, iy - 8, ix + 14, iy + 6], outline=(60, 120, 210), width=3); D.line([(ix + 12, iy + 5), (ix + 20, iy + 13)], fill=(60, 120, 210), width=3)
    elif icon == "ask":
        T((ix + 4, iy - 11), "?", 24, (240, 140, 40), anchor="la")
    elif icon == "check":
        D.line([(ix, iy), (ix + 6, iy + 7), (ix + 18, iy - 8)], fill=(60, 170, 90), width=4)
    elif icon == "bug":
        D.ellipse([ix, iy - 6, ix + 16, iy + 8], fill=(214, 70, 70))
    elif icon == "zzz":
        T((ix, iy - 11), "zZ", 18, (110, 130, 200))
    elif icon == "gear":
        D.ellipse([ix, iy - 8, ix + 16, iy + 8], outline=(110, 110, 120), width=4); D.ellipse([ix + 5, iy - 3, ix + 11, iy + 3], fill=(110, 110, 120))


bubble(60, 52, "ARQ", "typing", (200, 90, 60))
bubble(216, 54, "COD", "gear", (40, 140, 140))
bubble(372, 60, "FLA", "search", (100, 90, 200))
bubble(68, 158, "QA", "bug", (200, 150, 30))
bubble(262, 136, "TÚ", "ask", (60, 140, 70))
bubble(382, 160, "ANA", "typing", (210, 100, 120))
bubble(424, 160, "LEO", "check", (200, 120, 40))
# cat zzz
D.text((wx(262), wy(200)), "z", font=font(18), fill=(110, 130, 200)); D.text((wx(268), wy(194)), "Z", font=font(22), fill=(110, 130, 200))

# notification badge on mail tray
bx, by = wx(350), wy(134)
D.ellipse([bx - 12, by - 12, bx + 14, by + 14], fill=(220, 60, 60), outline=(255, 250, 240), width=2)
T((bx + 1, by + 1), "2", 18, (255, 255, 255), anchor="mm")
T((wx(318), wy(148)), "BANDEJA", 13, (90, 60, 44))
T((wx(184), wy(151)), "TABLÓN", 13, (90, 60, 44))

# ---- top bar
D.rectangle([0, 0, CW, TOP], fill=(60, 44, 44))
D.line([(0, TOP - 1), (CW, TOP - 1)], fill=(110, 80, 64), width=2)
T((22, 14), "STACK IA", 26, (250, 214, 150))
T((190, 20), "·  Tiny Titan  ·  oficina de agentes", 18, (220, 200, 180), False)


def meter(x, label, pct, col):
    T((x, 8), label, 14, (230, 214, 196), False)
    rr((x, 30, x + 190, 44), 4, fill=(36, 28, 32), outline=(110, 80, 64), w=1)
    rr((x + 2, 32, x + 2 + int(186 * pct / 100), 42), 3, fill=col)
    T((x + 198, 28), f"{pct}%", 14, (250, 240, 225))


meter(640, "Claude Pro", 62, (224, 120, 90))
meter(900, "ChatGPT Plus", 35, (70, 180, 160))
meter(1160, "Gemini", 20, (140, 120, 230))
D.ellipse([1500, 20, 1516, 36], fill=(110, 230, 140))
T((1526, 14), "Tailnet · 3 conectados", 17, (200, 240, 210))
T((1526, 34), "LAN: oficina.local:7777", 13, (200, 190, 175), False)

# ---- right panel: cuaderno
PX = 1440
D.rectangle([PX, TOP, CW, BOT], fill=(250, 240, 220))
D.rectangle([PX, TOP, PX + 6, BOT], fill=(150, 100, 62))
for yy in range(TOP + 30, BOT, 28):
    D.line([(PX + 20, yy), (CW - 16, yy)], fill=(232, 218, 192), width=1)
T((PX + 24, TOP + 14), "Cuaderno · Arquitecto", 20, (110, 60, 40))
T((PX + 24, TOP + 42), "Claude · Opus  ·  sesión nueva en cada tarea", 13, (140, 110, 90), False)

y = TOP + 76
T((PX + 24, y), "CHARTER  (editable)", 14, (200, 100, 70)); y += 22
for ln in ["Rol: arquitecto de sistemas y QA.", "Escribe lógica Luau: fórmulas,", "jefes, DataStore. No toca la UI.", "Sale con un handoff en JSON."]:
    T((PX + 24, y), ln, 15, (80, 56, 46), False); y += 22
y += 10
T((PX + 24, y), "MEMORIA  (auto) · 372/400 tok", 14, (200, 100, 70)); y += 22
for ln in ["[x] Hecho: fórmula rebirth v2", "    en Game.luau", "◆ Decidido: daño del jefe escala", "  con Rebirths (tope x2.5)", "[ ] Pendiente: QA jefe fase 3",
           "(!) Ojo: stationAt usa la escala", "  del cuerpo, no 9 studs fijos"]:
    T((PX + 24, y), ln, 15, (80, 56, 46), False); y += 22
y += 10
T((PX + 24, y), "PAQUETE DE CONTEXTO  ≈ 1.9k tok", 14, (200, 100, 70)); y += 26
segs = [("charter", 310, (224, 120, 90)), ("proyecto", 780, (110, 150, 210)), ("memoria", 372, (110, 190, 130)), ("tarea", 440, (240, 190, 90))]
tot = sum(s[1] for s in segs); x = PX + 24; full = 400
for name, n, c in segs:
    w = int(full * n / tot)
    D.rectangle([x, y, x + w - 2, y + 18], fill=c); x += w
y += 26
lx = PX + 24
for name, n, c in segs:
    D.rectangle([lx, y + 4, lx + 10, y + 14], fill=c); T((lx + 15, y), f"{name} {n}", 12, (100, 80, 66), False); lx += 108
y += 34
rr((PX + 24, y, CW - 24, y + 62), 8, fill=(255, 248, 232), outline=(214, 170, 120), w=2)
T((PX + 36, y + 8), "Última nota auto-actualizada", 13, (200, 100, 70))
T((PX + 36, y + 30), "pendiente de tu aprobación  [ aprobar ]", 14, (80, 56, 46), False)

# ---- bottom: kanban
D.rectangle([0, BOT, CW, CH], fill=(60, 44, 44))
D.line([(0, BOT), (CW, BOT)], fill=(110, 80, 64), width=2)
cols = [("PROPUESTAS (tú apruebas)", (240, 190, 90), [("Daño del jefe según rebirths", "ARQ", (224, 120, 90)), ("Traducir tienda ES/EN", "FLA", (140, 120, 230))]),
        ("APROBADAS", (110, 190, 130), [("Pulir HUD móvil", "COD", (70, 180, 160))]),
        ("EN CURSO", (110, 150, 210), [("Efectos de golpe del jefe", "COD", (70, 180, 160)), ("Auditar remote BuyUpgrade", "QA", (236, 190, 70))]),
        ("REVISIÓN / HECHO", (180, 130, 210), [("Fix pads tier 13+  (ok)", "QA", (236, 190, 70)), ("Handoff de la sesión  (ok)", "FLA", (140, 120, 230))])]
cw = (CW - 40 - 3 * 20) // 4
for i, (title, tc, cards) in enumerate(cols):
    x0 = 20 + i * (cw + 20)
    rr((x0, BOT + 14, x0 + cw, CH - 14), 10, fill=(78, 58, 56), outline=tc, w=2)
    T((x0 + 14, BOT + 22), title, 15, tc)
    for j, (txt, who, wc) in enumerate(cards):
        cy0 = BOT + 52 + j * 66
        rr((x0 + 12, cy0, x0 + cw - 12, cy0 + 56), 8, fill=(252, 244, 226), outline=(200, 160, 110), w=2)
        T((x0 + 24, cy0 + 8), txt, 16, (80, 56, 46))
        rr((x0 + 24, cy0 + 32, x0 + 24 + 44, cy0 + 50), 8, fill=wc)
        T((x0 + 46, cy0 + 41), who, 12, (255, 255, 255), anchor="mm")

T((CW - 12, CH - 22), "MAQUETA · el diseño final puede variar", 12, (170, 150, 130), False, anchor="ra")
canvas.save(OUT)
print("saved", OUT)
