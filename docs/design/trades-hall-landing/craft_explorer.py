"""Add the founder-requested badge explorer without editing the selected sources."""
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent


def add_craft_explorer(fragment: str, interaction: str) -> tuple[str, str]:
    stories = json.loads((ROOT / 'craft-stories.json').read_text(encoding='utf-8'))
    assert len(stories) == 14 and len({s['id'] for s in stories}) == 14
    for story in stories:
        assert all(isinstance(story[key], str) and story[key].strip() for key in ('id', 'name', 'eyebrow', 'text', 'sourceUrl', 'sourceTitle'))
        assert story['sourceUrl'].startswith('https://')
    index = 0

    def badge(match: re.Match[str]) -> str:
        nonlocal index
        story = stories[index]
        image = match.group(1)
        alt = re.search(r'alt="([^"]*)"', image)
        assert alt and html.unescape(alt.group(1)) == story['name']
        result = f'<button class="oh-crest" type="button" data-craft-index="{index}" aria-label="Meet the {html.escape(story["name"], quote=True)}" aria-pressed="false" aria-controls="oh-craft-story">{image}</button>'
        index += 1
        return result

    fragment = re.sub(r'<div class="oh-crest">(\s*<img\b[^>]+>\s*)</div>', badge, fragment)
    assert index == 14, f'Expected fourteen badges, found {index}'
    fragment = fragment.replace('Fourteen Crafts. A place for you.</div>', 'Every badge has a story. Choose one.</div>')
    panel = '''<section class="oh-craft-story" id="oh-craft-story" aria-labelledby="oh-craft-story-title" hidden>
      <div class="oh-story-top"><span class="oh-story-kicker">A CRAFT, A CHARACTER</span><button class="oh-story-close" type="button" aria-label="Close Craft story"><span aria-hidden="true">×</span></button></div>
      <div class="oh-story-body">
      <div class="oh-story-rule"><span class="oh-story-number" aria-hidden="true">01 / 14</span><span class="oh-story-trade"></span></div>
      <h2 id="oh-craft-story-title"></h2>
      <p class="oh-story-text"></p>
      <a class="oh-story-source" href="https://www.tradeshouse.org.uk/">Explore this Craft’s history <span aria-hidden="true">↗</span></a>
      </div>
      __STORY_RESERVES__
    </section>'''
    # Overlapping, inaccessible copies let CSS reserve the tallest complete story
    # at any width/font size, without measuring or clipping the live content.
    reserves = []
    for number, story in enumerate(stories, 1):
        reserves.append(f'''<div class="oh-story-reserve" aria-hidden="true" inert>
          <div class="oh-story-rule"><span class="oh-story-number">{number:02d} / 14</span><span>{html.escape(story['eyebrow'])}</span></div>
          <h2>The {html.escape(story['name'])}</h2>
          <p class="oh-story-text">{html.escape(story['text'])}</p>
          <span class="oh-story-source">Explore this Craft’s history <span>↗</span></span>
        </div>''')
    panel = panel.replace('__STORY_RESERVES__', '\n'.join(reserves))
    assert fragment.count('</section>') == 1
    fragment = fragment.replace('</section>', panel + '\n</section>')
    css = (ROOT / 'craft-explorer.css').read_text(encoding='utf-8')
    fragment = fragment.replace('  </style>', css + '\n  </style>')
    js = (ROOT / 'craft-explorer.js').read_text(encoding='utf-8')
    js = js.replace('__CRAFT_STORIES__', json.dumps(stories, ensure_ascii=True).replace('<', '\\u003c'))
    assert interaction.count('      let activeAnimation;') == 1
    interaction = interaction.replace('      let activeAnimation;', js + '\n      let activeAnimation;')
    interaction = interaction.replace('const previous=state.scene;', 'const previous=state.scene;\n        resetCraft(false);')
    old = "root.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.scene!=='welcome')showScene('welcome');});"
    new = "root.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(selectedCraft!==null){event.preventDefault();resetCraft(true);}else if(state.scene!=='welcome')showScene('welcome');});"
    assert old in interaction
    interaction = interaction.replace(old, new)
    return fragment, interaction
