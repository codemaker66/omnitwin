"""Helpers: 2x2 box-average the DPR-2 read-backs to 1x frames (what a 1x display shows), and simple
side-by-side sheets for looking at results."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from common import ROOT

def one_x(path2x, out=None):
    a = np.asarray(Image.open(path2x).convert("RGB"), dtype=np.float32)
    h, w = a.shape[0] // 2, a.shape[1] // 2
    b = a[:2 * h, :2 * w].reshape(h, 2, w, 2, 3).mean((1, 3))
    im = Image.fromarray(np.clip(b + 0.5, 0, 255).astype(np.uint8))
    if out: im.save(out)
    return im

def label(im, text, size=28):
    d = ImageDraw.Draw(im)
    try: f = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", size)
    except Exception: f = ImageFont.load_default()
    x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f)
    d.rectangle([0, 0, x1 + 16, y1 + 12], fill=(12, 20, 20))
    d.text((8, 4), text, fill=(240, 236, 225), font=f)
    return im

def grid(items, cols, width=960, out=None, size=24):
    ims = []
    for path, text in items:
        im = Image.open(path).convert("RGB") if isinstance(path, str) else path
        im = im.resize((width, int(im.height * width / im.width)), Image.LANCZOS)
        ims.append(label(im, text, size))
    rows = (len(ims) + cols - 1) // cols
    H = max(i.height for i in ims)
    sheet = Image.new("RGB", (cols * width + (cols - 1) * 6, rows * H + (rows - 1) * 6), (30, 30, 30))
    for k, im in enumerate(ims):
        sheet.paste(im, ((k % cols) * (width + 6), (k // cols) * (H + 6)))
    if out: sheet.save(out, quality=92)
    return sheet

if __name__ == "__main__":
    for p in sys.argv[1:]:
        one_x(p, p.replace("@2x.png", ".png"))
