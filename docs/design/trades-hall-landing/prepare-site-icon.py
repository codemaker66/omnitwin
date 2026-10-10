"""Frame the official crest as SVG without altering its original artwork."""
from pathlib import Path
import base64
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parent / 'site-icon'
SOURCE = 'https://www.tradeshouse.org.uk/gfx/trades-house@2x.png'
ROOT.mkdir(exist_ok=True)
art = urllib.request.urlopen(SOURCE).read()
source = ROOT / 'trades-house-original.png'
if source.exists():
    assert source.read_bytes() == art, 'Review changed official artwork before replacing it'
else:
    source.write_bytes(art)
# The supplied 280×300 header has the crest at x61..219, y0..195;
# its separate wordmark starts at y221. A square viewBox frames only the crest.
svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256" viewBox="37.5 -5 205 205"><image width="280" height="300" xlink:href="data:image/png;base64,' + base64.b64encode(art).decode() + '"/></svg>\n'
(ROOT / 'trades-hall-crest-v1.svg').write_text(svg, encoding='utf-8')
print(json.dumps({'source': SOURCE, 'source_sha256': hashlib.sha256(art).hexdigest(), 'svg_bytes': len(svg.encode()), 'output': str(ROOT)}))
