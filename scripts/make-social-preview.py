"""Draws docs/media/social-preview.png (1280x640), the picture GitHub shows when the repo is shared.
Needs Pillow:  python3 -m pip install pillow   then   python3 scripts/make-social-preview.py"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os
root = os.path.join(os.path.dirname(__file__), '..')
P = lambda *a: os.path.join(root, *a)
W, H = 1280, 640
PAPER, ACCENT, INK, MUTED = (20, 17, 16), (255, 106, 50), (246, 241, 234), (184, 173, 161)

def font(path, size, variation=None):
    f = ImageFont.truetype(path, size)
    if variation:
        try: f.set_variation_by_name(variation)
        except Exception: pass
    return f
bric = P('android-tv/app/src/main/res/font/bricolage.ttf')
hank = P('android-tv/app/src/main/res/font/hanken.ttf')

img = Image.new('RGB', (W, H), PAPER)
# a warm glow behind the picture
glow = Image.new('RGB', (W, H), PAPER)
g = ImageDraw.Draw(glow)
g.ellipse((640, -40, 1380, 640), fill=(120, 48, 22))
glow = glow.filter(ImageFilter.GaussianBlur(120))
img = Image.blend(img, glow, 0.9)
d = ImageDraw.Draw(img)

# the app picture, rounded, bleeding off the right edge
shot = Image.open(P('tv-site/assets/hero-home.jpg')).convert('RGB')
sw = 640; sh = int(sw * shot.height / shot.width)
shot = shot.resize((sw, sh), Image.LANCZOS)
mask = Image.new('L', shot.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, shot.width, shot.height), 26, fill=255)
x, y = 700, (H - sh) // 2 + 6
shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((x, y + 18, x + sw, y + sh + 18), 26, fill=(0, 0, 0, 170))
img.paste(Image.alpha_composite(img.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(26))).convert('RGB'))
img.paste(shot, (x, y), mask)
d = ImageDraw.Draw(img)
d.rounded_rectangle((x, y, x + sw, y + sh), 26, outline=(70, 58, 52), width=2)

# logo + wordmark
logo = Image.open(P('tv-site/assets/logo-512.png')).convert('RGBA').resize((76, 76), Image.LANCZOS)
lm = Image.new('L', logo.size, 0); ImageDraw.Draw(lm).rounded_rectangle((0, 0, 76, 76), 18, fill=255)
img.paste(logo, (72, 72), lm)
d.text((166, 84), 'Reddate', font=font(bric, 44, 'Bold'), fill=INK)

# headline (two lines) and one line of context
hf = font(bric, 92, 'Bold')
d.text((70, 196), 'Movie night,', font=hf, fill=INK)
d.text((70, 296), 'in sync.', font=hf, fill=ACCENT)
sf = font(hank, 28)
d.text((74, 430), 'Open-source watch parties for Android TV,', font=sf, fill=MUTED)
d.text((74, 468), 'phones and browsers. Bring your own addons.', font=sf, fill=MUTED)
d.rounded_rectangle((72, 548, 72 + 232, 548 + 48), 24, fill=ACCENT)
d.text((72 + 116, 548 + 24), 'tv.reddate.xyz', font=font(hank, 24, 'Bold'), fill=(26, 15, 9), anchor='mm')
out = P('docs/media/social-preview.png')
img.save(out, optimize=True)
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
