"""Build the selected landing as a CMS-safe, page-scoped shadow widget.

The CMS rewrites native images, strips styles, entity-encodes inline scripts and
truncates large text blocks. The external JavaScript bundle keeps the selected
fragment outside that editor. The editable light DOM retains destination links.
The older inline output remains available for local inspection only.
"""

from pathlib import Path
import argparse
import hashlib
import json
import re
from craft_explorer import add_craft_explorer


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "cms-draft.html"
CONTACT = "mailto:info@tradeshallglasgow.co.uk"
TOUR = "https://venviewer.com/tour"
QUIZ = "https://venviewer.com/quiz"
VERSION = "v5"
# Fill this only after the selected version has a confirmed native upload URL.
CMS_BUNDLE_URL: str | None = "https://www.tradeshallglasgow.co.uk/file-download/92/trades-hall-option-b-v5.js"


def replace_once(value: str, before: str, after: str) -> str:
    assert value.count(before) == 1, f"Expected one occurrence: {before[:90]}"
    return value.replace(before, after, 1)


def script_string(value: str) -> str:
    # Raw-text script parsing ends at a literal closing tag even inside a JS
    # string. Escaping every less-than also keeps markup out of CMS rewriting.
    return json.dumps(value, ensure_ascii=True).replace("<", "\\u003c")


def build(*, external_only: bool = False, preview: bool = False) -> None:
    source_bytes = SOURCE.read_bytes()
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    document = source_bytes.decode("utf-8")
    body = re.search(r"<body>\s*(.*?)\s*</body>", document, re.S)
    assert body is not None
    fragment = body.group(1)
    scripts = re.findall(r"<script>(.*?)</script>", fragment, re.S)
    assert len(scripts) == 1
    interaction = scripts[0]
    fragment, removed = re.subn(r"\s*<script>.*?</script>", "", fragment, flags=re.S)
    assert removed == 1
    fragment = replace_once(fragment, '<main class="oh-main">', '<section class="oh-main" aria-label="Find your place">')
    fragment = replace_once(fragment, "</main>", "</section>")

    # Font-face declarations in shadow roots are not reliably registered by
    # browsers. Register uniquely named faces in the document; shadow content
    # explicitly opts into that family without affecting the rest of the site.
    font_faces = re.findall(r"@font-face\s*\{[^}]*\}", fragment)
    assert len(font_faces) == 2
    for face in font_faces:
        fragment = replace_once(fragment, face, "")
    font_name = "TH Open Hall Cormorant"
    fragment = fragment.replace("'Cormorant Garamond'", repr(font_name))
    font_css = "\n".join(font_faces).replace("'Cormorant Garamond'", repr(font_name))

    event_choice = re.search(r'<a class="oh-choice" href="' + re.escape(TOUR) + r'" data-intent="event">(.*?)</a>', fragment, re.S)
    assert event_choice is not None
    fragment = replace_once(fragment, event_choice.group(0), '<button class="oh-choice" type="button" data-intent="event">' + event_choice.group(1).replace('Explore the venue. Make it yours.', 'Under construction for now.') + '</button>')
    fragment = replace_once(fragment, ' target="_blank"', "")
    fragment = replace_once(
        fragment,
        'Walk through the rooms.<br>Picture what you could create here.',
        'Our team can help with your plans<br>while we prepare the online experience.',
    )
    original_enter = f'<a class="oh-enter" href="{TOUR}" rel="noopener noreferrer"><span>Explore the venue</span><span aria-hidden="true">↗</span></a>'
    detail_actions = f'''<div class="oh-detail-actions"><a class="oh-enter" href="{CONTACT}"><span>Contact our team</span><span aria-hidden="true">↗</span></a></div>'''
    fragment = replace_once(fragment, original_enter, detail_actions)

    adapter_css = """
:host { all:initial; display:block; width:100%; min-width:0; }
#th-open-hall { display:flex; flex-direction:column; min-height:100svh; width:100%; text-align:left; font-size:16px; line-height:1.5; letter-spacing:normal; text-transform:none; font-weight:400; font-style:normal; }
#th-open-hall .oh-main { flex:1; }
#th-open-hall a:focus-visible, #th-open-hall button:focus-visible { outline:3px solid #edc78f; outline-offset:5px; }
#th-open-hall .oh-detail-actions { flex-shrink:0; text-align:right; }
@media(max-width:650px) {
  #th-open-hall .oh-detail-actions { width:100%; }
}
""".strip()
    fragment = replace_once(fragment, "  <style>", "  <style>\n" + adapter_css)
    # These measured desktop adjustments must follow the selected design's
    # original media rules, including its >=1050px minimum room-panel height.
    compact_css = """
#th-open-hall[data-scene='event'] h1 { font-size:clamp(48px,7vw,84px); }
@media(min-width:651px) and (max-height:800px) {
  #th-open-hall .oh-header { padding:20px 42px; }
  #th-open-hall .oh-main { min-height:0; padding:24px 42px 28px; }
  #th-open-hall .oh-footer { padding:10px 42px; }
  #th-open-hall .oh-gallery { top:0; height:100%; max-height:380px; }
}
""".strip()
    fragment = replace_once(fragment, "  </style>", compact_css + "\n  </style>")

    interaction = replace_once(
        interaction,
        "const root=document.getElementById('th-open-hall');",
        "const root=shadow.querySelector('#th-open-hall');",
    )
    interaction = replace_once(
        interaction,
        "event:{first:'Imagine it.',second:'Here.',eyebrow:'Your next occasion',subtitle:['A remarkable setting.','Entirely your story.'],label:'THE VENUE EXPERIENCE',description:['Walk through the rooms.','Picture what you could create here.'],action:'Explore the venue',url:'https://venviewer.com/tour'}",
        "event:{first:'Under',second:'construction.',eyebrow:'Your next occasion',subtitle:['Online event planning is being prepared.','Please contact our team for event enquiries.'],label:'UNDER CONSTRUCTION',description:['Our team can help with your plans','while we prepare the online experience.'],action:'Contact our team',url:'" + CONTACT + "'}",
    )
    fragment, interaction = add_craft_explorer(fragment, interaction)

    host_css = """
body.pf-landing { margin:0; background:#171915; }
body.pf-landing > header, body.pf-landing > footer, body.pf-landing > .skipto, body.pf-landing > #topbar { display:none !important; }
body.pf-landing main#contentstart, body.pf-landing main#contentstart > .wrapper { display:block; width:100%; max-width:none; margin:0; padding:0; }
body.pf-landing #block78, body.pf-landing #block78 .colwide, body.pf-landing #block78 .colcontent { width:100% !important; max-width:none !important; margin:0 !important; padding:0 !important; transform:none !important; opacity:1 !important; }
body.pf-landing #block78 .colcontent > h1 { display:none !important; }
body.pf-landing #block78 > .colwide > h1.colhead { display:none !important; }
body.pf-landing #th-open-hall-mount { display:block; width:100%; min-width:0; margin:0; padding:0; }
""".strip() + "\n" + font_css

    script = """(() => {
  'use strict';
  function mountHall() {
    if (!document.body.classList.contains('pf-landing')) return;
    const mount = document.getElementById('th-open-hall-mount');
    if (!mount || mount.shadowRoot || typeof mount.attachShadow !== 'function') return;
    const shadow = mount.attachShadow({mode:'open'});
    shadow.innerHTML = __FRAGMENT__;
    const pageStyle = document.createElement('style');
    pageStyle.id = 'th-open-hall-page-style';
    pageStyle.textContent = __HOST_CSS__;
    document.head.appendChild(pageStyle);
    if (!document.querySelector('link[rel="canonical"]')) {
      const canonical = document.createElement('link');
      canonical.rel = 'canonical';
      canonical.href = 'https://www.tradeshallglasgow.co.uk/landing';
      document.head.appendChild(canonical);
    }
    if (!document.querySelector('meta[name="description"]')) {
      const description = document.createElement('meta');
      description.name = 'description';
      description.content = 'Discover your connection to the fourteen Incorporated Crafts or contact Trades Hall of Glasgow to plan an event.';
      document.head.appendChild(description);
    }
__INTERACTION__
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountHall, {once:true});
  } else {
    mountHall();
  }
})();
"""
    script = script.replace("__FRAGMENT__", script_string(fragment))
    script = script.replace("__HOST_CSS__", script_string(host_css))
    script = script.replace("__INTERACTION__", interaction.strip())
    assert "</script" not in script.lower()
    assert "document.getElementById('th-open-hall')" not in script
    assert fragment.count('class="oh-crest"') == 14
    assert fragment.count("data:") + host_css.count("data:") == document.count("data:")
    assert "<script" not in fragment
    assert "<main" not in fragment
    assert 'target="_blank"' not in fragment
    assert "__FRAGMENT__" not in script and "__HOST_CSS__" not in script

    fallback = f'''<div id="th-open-hall-mount">
  <h1>Find your place at Trades Hall</h1>
  <p>Host here. Belong here.</p>
  <h2>Plan an event — under construction</h2>
  <p>Online event planning is being prepared. Please contact our team for event enquiries.</p>
  <p><a href="{QUIZ}">Find your Craft</a></p>
  <p><a href="mailto:info@tradeshallglasgow.co.uk">Talk to our team</a></p>
</div>'''
    embed = fallback + "\n<script>\n" + script + "</script>\n"
    # The editor wraps external scripts in a paragraph. Keep that light-DOM
    # paragraph inside the shadow host so it cannot add a strip below the scene.
    external_embed = None if CMS_BUNDLE_URL is None else replace_once(
        fallback, "</div>", f'  <script defer src="{CMS_BUNDLE_URL}"></script>\n</div>'
    ) + "\n"
    assert embed.lower().count("</script>") == 1
    assert '<img' not in embed and '<style' not in embed
    bundle_path = ROOT / f"trades-hall-option-b-{VERSION}.js"
    if preview:
        (ROOT / 'craft-preview.js').write_text(script, encoding='utf-8', newline='\n')
        (ROOT / 'craft-preview.html').write_text('''<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Find your place | Trades Hall of Glasgow</title></head><body class="page_content pf-landing"><main id="contentstart"><div class="wrapper"><div><div class="pageblocks"><div id="block78" class="colsone"><div class="colwide"><h1 class="colhead">Find your place</h1><div class="colcontent">''' + fallback.replace('</div>', '<script defer src="craft-preview.js"></script></div>') + '</div></div></div></div></div></div></main></body></html>', encoding='utf-8')
        print(json.dumps({'preview': 'craft-preview.html', 'bytes': len(script.encode('utf-8')), 'source_unchanged': SOURCE.read_bytes() == source_bytes}))
        return
    if external_only:
        assert external_embed is not None, "External-only generation needs a confirmed upload URL"
        assert bundle_path.read_bytes() == script.encode("utf-8"), "External-only generation cannot change the bundle"
    else:
        (ROOT / "cms-embed.html").write_text(embed, encoding="utf-8", newline="\n")
        (ROOT / "cms-embed-script.js").write_text(script, encoding="utf-8", newline="\n")
    if external_embed is not None:
        (ROOT / "cms-external-embed.html").write_text(external_embed, encoding="utf-8", newline="\n")
    if bundle_path.exists():
        assert bundle_path.read_bytes() == script.encode("utf-8"), "Published bundle versions are immutable; choose a new VERSION"
    else:
        bundle_path.write_text(script, encoding="utf-8", newline="\n")
    assert SOURCE.read_bytes() == source_bytes, "Preserved draft changed"
    print(json.dumps({
        "source_sha256": source_sha256,
        "source_unchanged": True,
        "embed_bytes": (ROOT / "cms-embed.html").stat().st_size,
        "embed_sha256": hashlib.sha256((ROOT / "cms-embed.html").read_bytes()).hexdigest(),
        "bundle": bundle_path.name,
        "bundle_bytes": bundle_path.stat().st_size,
        "bundle_sha256": hashlib.sha256(bundle_path.read_bytes()).hexdigest(),
        "external_embed_written": external_embed is not None,
        "assets_preserved": document.count("data:"),
    }))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--external-only", action="store_true", help="Rewrite only the small CMS embed against the unchanged bundle")
    parser.add_argument("--preview", action="store_true", help="Write local candidate artifacts without changing immutable bundles")
    args = parser.parse_args()
    build(external_only=args.external_only, preview=args.preview)
