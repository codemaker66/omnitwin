"""Create a host-independent CMS draft from the preserved selected design."""
from pathlib import Path
import hashlib
import re

root = Path(__file__).resolve().parent
source = Path(r'C:/Users/blake/.codex/visualizations/2026/09/07/01a07bb7-4d06-7c42-90f6-81a87721e3dd/trades-hall-option-b.html')
fragment = source.read_text(encoding='utf-8')
assert source.is_file()
assert 'id="th-open-hall"' in fragment
fragment = fragment.replace('aria-label="Option B — The Open Hall"', 'aria-label="Trades Hall of Glasgow"', 1)

# Keep the selected visual intact; remove conversation-only design controls.
fragment, removed = re.subn(r'      if\(globalThis\.Tweak\)\{.*?\n      \}', '', fragment, flags=re.S)
assert removed == 1
assert 'Tweak' not in fragment

# Real destinations remain reachable when JavaScript is unavailable. Enhanced
# ordinary activation previews the selected branch as in the accepted design.
destinations = {'event': 'https://venviewer.com/tour', 'craft': 'https://venviewer.com/quiz'}
for intent, destination in destinations.items():
    pattern = r'<button class="oh-choice" type="button" data-intent="' + intent + r'">(.*?)</button>'
    replacement = '<a class="oh-choice" href="' + destination + '" data-intent="' + intent + '">' + r'\1' + '</a>'
    fragment, replaced = re.subn(pattern, replacement, fragment, flags=re.S)
    assert replaced == 1

old_handler = "root.querySelectorAll('[data-intent]').forEach(button=>button.addEventListener('click',()=>showScene(button.dataset.intent)));"
new_handler = "root.querySelectorAll('[data-intent]').forEach(link=>link.addEventListener('click',event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();showScene(link.dataset.intent);}));"
assert old_handler in fragment
fragment = fragment.replace(old_handler, new_handler)
fragment = fragment.replace('#th-open-hall .oh-choice { position:relative;', '#th-open-hall .oh-choice { color:inherit; font:inherit; text-decoration:none; cursor:pointer; position:relative;', 1)

document = '''<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Explore Trades Hall of Glasgow and discover your connection to the fourteen Incorporated Crafts.">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>Find your place | Trades Hall of Glasgow</title>
  <link rel="canonical" href="https://www.tradeshallglasgow.co.uk/landing">
  <style>html{background:#171915}body{margin:0}#th-open-hall{min-height:100svh}#th-open-hall .oh-main{flex:1}#th-open-hall{display:flex;flex-direction:column}</style>
</head>
<body>
''' + fragment + '\n</body>\n</html>\n'
assert 'window.openai' not in document
assert '__FONTS__' not in document
assert document.count('class="oh-crest"') == 14
assert '<iframe' not in document
output = root / 'cms-draft.html'
output.write_text(document, encoding='utf-8')
script = re.search(r'<script>(.*?)</script>', document, re.S).group(1)
(root / 'cms-draft-script.js').write_text(script, encoding='utf-8')
print({'file': output.name, 'bytes': output.stat().st_size, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'draft_sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
