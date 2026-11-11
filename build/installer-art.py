# The installer's artwork, made from IV Studio's own eye art (src/renderer/src/assets/eye*.webp) and font.
#   python build/installer-art.py
# Writes, at the sizes NSIS's Modern UI uses (24-bit BMP):
#   build/installerSidebar.bmp    164 x 314  the welcome and finish pages (the open eye)
#   build/uninstallerSidebar.bmp  164 x 314  the uninstaller's pages (the closed eye)
#   build/installerHeader.bmp     150 x 57   the strip along the top of the other pages
# electron-builder picks these files up by name; build/installer.nsh sets the matching colours.
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'src' / 'renderer' / 'src' / 'assets'
FONT = ROOT / 'resources' / 'fonts' / 'BarlowCondensed-SemiBold.ttf'
INK = (16, 12, 14)  # #100c0e, the app's background
CREAM = (244, 236, 220)  # #f4ecdc, the "What If?" lettering
RED = (244, 72, 89)  # #f44859
PUPIL = (693, 372)  # the eye's centre in the 1400 x 737 art


def fade(img, top, bottom, color=INK, strength=1.0):
    """Fades img into color between rows top and bottom (0..1 of the height), fully at the bottom."""
    w, h = img.size
    over = Image.new('RGB', (w, h), color)
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    for y in range(h):
        t = (y / h - top) / max(1e-6, bottom - top)
        d.line([(0, y), (w, y)], fill=int(255 * strength * min(1, max(0, t))))
    return Image.composite(over, img, mask)


def sidebar(src, out):
    art = Image.open(ASSETS / src).convert('RGB')
    h = art.height
    w = round(h * 164 / 314)
    x = PUPIL[0] - w // 2
    img = art.crop((x, 0, x + w, h)).resize((164, 314), Image.LANCZOS)
    # a little quieter than the app's banners, so the page's words stay the thing to read
    img = Image.blend(img, Image.new('RGB', img.size, INK), 0.18)
    img = fade(img, 0.62, 0.86)
    d = ImageDraw.Draw(img)
    big = ImageFont.truetype(str(FONT), 30)
    small = ImageFont.truetype(str(FONT), 11)
    word = 'IV STUDIO'
    tw = d.textlength(word, font=big)
    d.text(((164 - tw) / 2, 256), word, font=big, fill=CREAM)
    d.line([(52, 291), (112, 291)], fill=RED, width=2)
    sub = 'INFINITE VARIANCE'
    sw = d.textlength(sub, font=small)
    d.text(((164 - sw) / 2, 294), sub, font=small, fill=(196, 180, 170))
    img.save(ROOT / 'build' / out, 'BMP')
    return img


def header():
    art = Image.open(ASSETS / 'eye.webp').convert('RGB')
    ch = 190
    cw = round(ch * 150 / 57)
    x, y = PUPIL[0] - cw // 2, PUPIL[1] - ch // 2
    img = art.crop((x, y, x + cw, y + ch)).resize((150, 57), Image.LANCZOS)
    img = Image.blend(img, Image.new('RGB', img.size, INK), 0.12)
    # its left edge melts into the dark header behind the page title
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    for i in range(w):
        d.line([(i, 0), (i, h)], fill=int(255 * max(0.0, 1 - i / (w * 0.45))))
    img = Image.composite(Image.new('RGB', (w, h), INK), img, mask)
    img.save(ROOT / 'build' / 'installerHeader.bmp', 'BMP')
    return img


if __name__ == '__main__':
    a = sidebar('eye.webp', 'installerSidebar.bmp')
    b = sidebar('eye-closed.webp', 'uninstallerSidebar.bmp')
    c = header()
    for name in ['installerSidebar.bmp', 'uninstallerSidebar.bmp', 'installerHeader.bmp']:
        im = Image.open(ROOT / 'build' / name)
        print(name, im.size, im.mode)
