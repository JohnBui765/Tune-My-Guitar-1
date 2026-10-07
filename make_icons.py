"""Echo Tune icon: the Echo teal tile with a tuner's scale on it. The ticks rise towards the centre like
the Echo waveform, and the needle stands straight up in the middle: a string exactly in tune.
Run it with Python 3 (needs Pillow and NumPy): python3 make_icons.py"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.dirname(os.path.abspath(__file__))
S = 2048          # drawn large, then scaled down, for smooth edges
C = S / 2

# Background: teal at the top left to deep cyan at the bottom right, with a soft light in the top corner
# (the same tile as Echo Peel and Echo Stems).
a = np.array([45, 212, 191], dtype=float)   # teal-400
b = np.array([21, 94, 117], dtype=float)    # cyan-800
yy, xx = np.mgrid[0:S, 0:S]
t = ((xx + yy) / (2 * S - 2))[..., None]
img = Image.fromarray((a * (1 - t) + b * t).astype(np.uint8), "RGB").convert("RGBA")
glow = Image.new("L", (S, S), 0)
ImageDraw.Draw(glow).ellipse([-S * 0.25, -S * 0.35, S * 0.75, S * 0.55], fill=56)
glow = glow.filter(ImageFilter.GaussianBlur(S * 0.08))
img = Image.composite(Image.new("RGBA", (S, S), (255, 255, 255, 255)), img, glow)

# The scale: ticks on a common baseline, taller towards the middle; the needle in the centre.
base = 0.695 * S
heights = [0.075, 0.105, 0.14, 0.18]          # outer → inner, mirrored on the other side
bw, gap = 0.034 * S, 0.046 * S
shape = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(shape)
for side in (-1, 1):
    for i, hgt in enumerate(reversed(heights)):  # inner tick first
        cx = C + side * (gap + bw) * (i + 1.25)
        hh = hgt * S
        d.rounded_rectangle([cx - bw / 2, base - hh, cx + bw / 2, base], radius=bw / 2, fill=255)
# the needle: a taller bar with a round head
nw = 0.04 * S
d.rounded_rectangle([C - nw / 2, base - 0.40 * S, C + nw / 2, base + 0.035 * S], radius=nw / 2, fill=255)
head_r = 0.062 * S
d.ellipse([C - head_r, base - 0.40 * S - head_r * 1.15, C + head_r, base - 0.40 * S + head_r * 0.85], fill=255)

# a soft shadow under the white parts, then the white parts themselves
shadow = shape.filter(ImageFilter.GaussianBlur(S * 0.02)).point(lambda v: int(v * 0.22))
img = Image.composite(Image.new("RGBA", (S, S), (8, 40, 56, 255)), img, shadow.transform((S, S), Image.AFFINE, (1, 0, 0, 0, 1, -S * 0.012)))
img = Image.composite(Image.new("RGBA", (S, S), (255, 255, 255, 255)), img, shape)
# the needle's head glows faintly green: in tune
dot = Image.new("L", (S, S), 0)
r2 = head_r * 0.48
cy = base - 0.40 * S - head_r * 0.15
ImageDraw.Draw(dot).ellipse([C - r2, cy - r2, C + r2, cy + r2], fill=255)
img = Image.composite(Image.new("RGBA", (S, S), (34, 197, 94, 255)), img, dot)

img = img.convert("RGB")
for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "icon-180.png")]:
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
print("icons written to", OUT)
