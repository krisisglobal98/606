"""
Builds every DOD logo asset from the official artwork docs/brand/DOD-logo.png (white glyph on a
green-to-orange gradient). The glyph is lifted out as an alpha mask (the background has almost no blue,
the glyph is white), the gradient is rebuilt smoothly, and each asset re-composes the two at the size
and padding that suits it:

  public/brand/dod-icon-{192,512}.png   PWA / apple-touch icons, full bleed, maskable-safe
  public/brand/dod-mark.png             header tile, rounded, glyph enlarged for 32 px
  public/brand/dod-logo.webp            login tile, rounded (the page adds the shadow)
  public/favicon.png                    64 px rounded tile, glyph as large as possible
  docs/brand/DOD-icon.png               1024 px rounded tile
  templates/webpwadh2/assets/...        DOD Executive Summary icons (theme untouched)

Run from the repository root: python3 docs/brand/dod_logo.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
src = Image.open(ROOT / 'docs/brand/DOD-logo.png').convert('RGB')
W, H = src.size

# Glyph mask from the blue channel: background blue ≈ 3, glyph 255.
b = src.getchannel('B')
glyph = b.point(lambda v: max(0, min(255, round((v - 10) * 255 / 235)))).crop(b.point(lambda v: 255 if v > 128 else 0).getbbox())

# Gradient stops sampled from the artwork's left edge (top → bottom).
rows = [src.getpixel((8, y)) for y in range(0, H, max(1, H // 64))] + [src.getpixel((8, H - 4))]


def gradient(size: int) -> Image.Image:
    col = Image.new('RGB', (1, len(rows)))
    for i, c in enumerate(rows):
        col.putpixel((0, i), c)
    return col.resize((size, size), Image.BICUBIC)


def compose(size: int, glyph_w: float, radius: float = 0.0, ss: int = 4) -> Image.Image:
    """`glyph_w` = glyph width as a share of the tile, `radius` as a share of the side (0 = square)."""
    S = size * ss
    tile = gradient(S).convert('RGBA')
    gw = round(S * glyph_w)
    g = glyph.resize((gw, round(glyph.height * gw / glyph.width)), Image.LANCZOS)
    white = Image.new('RGBA', g.size, (255, 255, 255, 255))
    tile.paste(white, ((S - g.width) // 2, (S - g.height) // 2), g)
    if radius:
        m = Image.new('L', (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, S - 1, S - 1), radius=round(S * radius), fill=255)
        tile.putalpha(m)
    return tile.resize((size, size), Image.LANCZOS)


def caption(img: Image.Image, text: str, share: float) -> Image.Image:
    """Small caps line under the glyph (webpwadh2 install icons)."""
    out = img.copy()
    d = ImageDraw.Draw(out)
    size = max(9, round(img.width * share))
    font = None
    for f in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf', 'DejaVuSans-Bold.ttf'):
        try:
            font = ImageFont.truetype(f, size)
            break
        except OSError:
            pass
    font = font or ImageFont.load_default()
    w = d.textlength(text, font=font)
    d.text(((img.width - w) / 2, img.height * 0.80), text, font=font, fill=(255, 255, 255, 235))
    return out


def save(img: Image.Image, rel: str, **kw):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p, optimize=True, **kw)
    print(rel, img.size)


# Web app
save(compose(512, 0.62), 'public/brand/dod-icon-512.png')
save(compose(192, 0.62), 'public/brand/dod-icon-192.png')
save(compose(128, 0.76, 0.24), 'public/brand/dod-mark.png')
save(compose(384, 0.66, 0.24), 'public/brand/dod-logo.webp', quality=92, method=6)
save(compose(64, 0.84, 0.22), 'public/favicon.png')
save(compose(1024, 0.66, 0.24), 'docs/brand/DOD-icon.png')

# DOD Executive Summary (webpwadh2): same artwork, icons only
T = 'templates/webpwadh2/assets'
for n in (192, 512):
    save(compose(n, 0.62), f'{T}/icons/icon-maskable-{n}.png')
    save(caption(compose(n, 0.62), 'EXECUTIVE SUMMARY', 0.062), f'{T}/icons/icon-{n}.png')
save(caption(compose(180, 0.62), 'EXECUTIVE SUMMARY', 0.062), f'{T}/icons/apple-touch-icon.png')
save(compose(32, 0.86, 0.22), f'{T}/icons/favicon-32.png')
save(compose(256, 0.72), f'{T}/images/dod-executive-summary-logo.png')  # square: the template's CSS rounds it
