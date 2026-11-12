# The cinematography examples into the app: each 1024x576 PNG to a 384x216 WebP in src/renderer/src/assets/cinema.
#   python docs/art/cinema-webp.py <folder of PNGs>
import os, sys
from PIL import Image
src = sys.argv[1]
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'renderer', 'src', 'assets', 'cinema')
os.makedirs(dst, exist_ok=True)
n = 0
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'):
        continue
    Image.open(os.path.join(src, f)).convert('RGB').resize((384, 216), Image.LANCZOS).save(os.path.join(dst, f[:-4] + '.webp'), 'WEBP', quality=74, method=6)
    n += 1
total = sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst))
print(f'{n} pictures, {total / 1024 / 1024:.1f} MB in {os.path.normpath(dst)}')
