"""
Desktop app icon (build/icon.png, 1024x1024; electron-builder turns it into the .icns).
The game's look: synthwave sun and grid, and the receptor arrow drawn as a neon tube.
Colors are the ones in src/render/theme.ts. Needs Pillow: python3 scripts/generate-icon.py
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 2048  # drawn at 2x, downscaled for anti-aliasing
OUT = Path(__file__).resolve().parent.parent / 'build' / 'icon.png'

CYAN = (34, 231, 255)
MAGENTA = (255, 43, 214)
VIOLET = (139, 92, 255)
GOLD = (255, 210, 63)
DEEP = (11, 9, 32)
NIGHT = (5, 4, 13)

# macOS icon grid: an 824/1024 rounded square, corner radius ~22.5% of its side
INSET = S * 100 // 1024
BOX = (INSET, INSET, S - INSET, S - INSET)
RADIUS = int((BOX[2] - BOX[0]) * 0.225)
HORIZON = int(S * 0.62)
# src/render/playfield.ts ARROW_POINTS
ARROW = [(0, 0.5), (0.5, 0.02), (0.5, -0.16), (0.36, -0.16), (0.15, 0.05), (0.15, -0.5), (-0.15, -0.5), (-0.15, 0.05), (-0.36, -0.16), (-0.5, -0.16), (-0.5, 0.02)]


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def vertical_gradient(size, stops):
    """stops: [(t, rgb), ...] from top (0) to bottom (1)"""
    w, h = size
    img = Image.new('RGB', size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                d.line([(0, y), (w, y)], fill=lerp(c0, c1, (t - t0) / (t1 - t0)))
                break
    return img


def glow(mask, color, radius, strength):
    """A colored halo from a white-on-black mask"""
    blurred = mask.filter(ImageFilter.GaussianBlur(radius))
    layer = Image.new('RGB', mask.size, color)
    return layer, blurred.point(lambda v: min(255, int(v * strength)))


def add(base, color_layer, alpha):
    """Additive blend of color_layer * alpha onto base"""
    lit = ImageChops.multiply(color_layer, Image.merge('RGB', [alpha] * 3))
    return ImageChops.add(base, lit)


def main():
    # Sky: deep violet at the top, a magenta haze toward the horizon
    img = vertical_gradient((S, S), [(0, (24, 10, 58)), (0.45, DEEP), (0.6, (42, 12, 58)), (0.62, (26, 8, 38)), (1, NIGHT)])

    # Sun: gold to magenta, striped below its middle, cut by the horizon
    cx, cy, r = S // 2, int(S * 0.5), int(S * 0.27)
    sun = vertical_gradient((S, S), [(0, GOLD), ((cy - r) / S, GOLD), ((cy + r * 0.2) / S, (255, 120, 120)), (HORIZON / S, MAGENTA), (1, MAGENTA)])
    sun_mask = Image.new('L', (S, S), 0)
    sd = ImageDraw.Draw(sun_mask)
    sd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    gap, y, step = 6, cy + int(r * 0.05), 2
    while y < HORIZON:
        sd.rectangle((0, y, S, y + gap), fill=0)
        y += gap + int(80 / step)
        gap += 7
        step += 1
    sd.rectangle((0, HORIZON, S, S), fill=0)
    halo_color, halo_alpha = glow(sun_mask, MAGENTA, 90, 0.55)
    img = add(img, halo_color, halo_alpha)
    img.paste(sun, (0, 0), sun_mask)

    # Grid floor: lines converging on the horizon's center, rows tightening toward it
    grid = Image.new('L', (S, S), 0)
    gd = ImageDraw.Draw(grid)
    for k in range(-12, 13):
        gd.line([(cx, HORIZON), (cx + k * S * 0.16, S)], fill=255, width=5)
    # Rows closer than this merge into a solid band near the horizon
    z, last = 1.0, float('inf')
    while True:
        y = HORIZON + (S - HORIZON) / z
        if last - y < 22:
            break
        if y < S:
            gd.line([(0, y), (S, y)], fill=255, width=5)
            last = y
        z += 0.55
    grid_color = vertical_gradient((S, S), [(0, VIOLET), (HORIZON / S, MAGENTA), (1, CYAN)])
    fade = vertical_gradient((S, S), [(0, (0, 0, 0)), (HORIZON / S, (90, 90, 90)), (1, (255, 255, 255))]).convert('L')
    grid_alpha = ImageChops.multiply(grid, fade)
    img = add(img, grid_color, grid_alpha.filter(ImageFilter.GaussianBlur(10)))
    img = add(img, grid_color, grid_alpha.point(lambda v: v * 0.8))
    # horizon line
    hl = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hl).line([(0, HORIZON), (S, HORIZON)], fill=255, width=6)
    hc, ha = glow(hl, MAGENTA, 16, 0.9)
    img = add(img, hc, ha)
    img = add(img, Image.new('RGB', (S, S), (255, 200, 240)), hl)

    # The receptor arrow as a neon tube: dark glass inside, cyan glow, white-hot core
    scale, acx, acy = S * 0.46, S // 2, int(S * 0.47)
    pts = [(acx + x * scale, acy - y * scale) for x, y in ARROW]
    inside = Image.new('L', (S, S), 0)
    ImageDraw.Draw(inside).polygon(pts, fill=255)
    glass = Image.new('RGB', (S, S), (6, 10, 30))
    img = Image.composite(Image.blend(img, glass, 0.72), img, inside)
    tube = Image.new('L', (S, S), 0)
    ImageDraw.Draw(tube).line(pts + [pts[0]], fill=255, width=34, joint='curve')
    for radius, strength in ((80, 0.6), (34, 0.9), (12, 1.2)):
        c, a = glow(tube, CYAN, radius, strength)
        img = add(img, c, a)
    img = add(img, Image.new('RGB', (S, S), (20, 190, 215)), tube)
    core = Image.new('L', (S, S), 0)
    ImageDraw.Draw(core).line(pts + [pts[0]], fill=255, width=12, joint='curve')
    img = add(img, Image.new('RGB', (S, S), (225, 252, 255)), core.filter(ImageFilter.GaussianBlur(2)))

    # Rounded square with a faint rim, transparent around it
    shape = Image.new('L', (S, S), 0)
    ImageDraw.Draw(shape).rounded_rectangle(BOX, RADIUS, fill=255)
    rim = Image.new('L', (S, S), 0)
    ImageDraw.Draw(rim).rounded_rectangle(BOX, RADIUS, outline=70, width=6)
    img = add(img, Image.new('RGB', (S, S), (200, 180, 255)), rim)
    icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    icon.paste(img, (0, 0), shape)

    OUT.parent.mkdir(exist_ok=True)
    icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(OUT)
    print(OUT)


if __name__ == '__main__':
    main()
