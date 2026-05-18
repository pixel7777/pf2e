"""Generate OG image (1200x630) for social media previews."""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
bg = (26, 22, 37)  # #1a1625

img = Image.new('RGB', (W, H), bg)
draw = ImageDraw.Draw(img)

arcane_blue = (100, 149, 237)
divine_gold = (218, 165, 32)
occult_purple = (178, 102, 238)
primal_green = (76, 175, 80)
colors = [arcane_blue, divine_gold, occult_purple, primal_green]

# Bottom accent bar — four tradition colors
bar_h = 8
segment_w = W // 4
for i, c in enumerate(colors):
    draw.rectangle([i * segment_w, H - bar_h, (i + 1) * segment_w, H], fill=c)

# Subtle top accent
draw.rectangle([0, 0, W, 3], fill=(80, 60, 120))

# Fonts
FONTS = r'C:\Windows\Fonts'
def load(name, size):
    path = os.path.join(FONTS, name)
    if os.path.exists(path):
        return ImageFont.truetype(path, size)
    return ImageFont.load_default()

title_font = load('arialbd.ttf', 72)
subtitle_font = load('arialbd.ttf', 32)
tagline_font = load('arial.ttf', 24)
mark_font = load('segoeuib.ttf', 48)

# Diamond mark drawn as polygon
cx, cy, r = W // 2, 180, 18
draw.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=occult_purple)

# Title
draw.text((W // 2, 260), 'PF2e Spell Planner', fill=(240, 235, 220), font=title_font, anchor='mm')

# Subtitle
draw.text((W // 2, 330), 'Prepared Caster Edition', fill=(178, 165, 140), font=subtitle_font, anchor='mm')

# Tagline
draw.text((W // 2, 410), 'Free spell selection planning for prepared casters', fill=(140, 130, 115), font=tagline_font, anchor='mm')

# Tradition labels above bar
tradition_names = ['Arcane', 'Divine', 'Occult', 'Primal']
for i, (name, color) in enumerate(zip(tradition_names, colors)):
    x = i * segment_w + segment_w // 2
    draw.text((x, H - 55), name, fill=color, font=tagline_font, anchor='mm')

out_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets', 'og-image.png')
img.save(out_path, 'PNG')
print(f'Saved {out_path} ({os.path.getsize(out_path)} bytes)')
