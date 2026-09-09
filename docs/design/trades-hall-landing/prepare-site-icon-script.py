"""Package the existing crest export for the CMS's shared external script route."""
from pathlib import Path
import base64
import hashlib
import json

ROOT = Path(__file__).resolve().parent / 'site-icon'
png = (ROOT / 'trades-hall-crest-v1.png').read_bytes()
uri = 'data:image/png;base64,' + base64.b64encode(png).decode()
script = '''/* Trades Hall browser-tab crest, v1. Original official artwork preserved. */
(() => {
  'use strict';
  if (!document.head || document.getElementById('th-crest-tab-icon')) return;
  const icon = document.createElement('link');
  icon.id = 'th-crest-tab-icon';
  icon.rel = 'icon';
  icon.type = 'image/png';
  icon.sizes = '256x256';
  icon.href = __ICON_URI__;
  document.head.querySelectorAll('link[rel~="icon"]').forEach(previous => previous.remove());
  document.head.appendChild(icon);
})();
'''.replace('__ICON_URI__', json.dumps(uri))
path = ROOT / 'trades-hall-site-icon-v1.js'
if path.exists():
    assert path.read_bytes() == script.encode(), 'Published versions are immutable'
else:
    path.write_text(script, encoding='utf-8', newline='\n')
print(json.dumps({'bundle': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'png_sha256': hashlib.sha256(png).hexdigest()}))
