/**
 * Local behavioural checks for the actual CMS landing bundle.
 *
 * Run from any directory:
 *   node docs/design/trades-hall-landing/check-craft-explorer.mjs [bundle.js] [copy.json]
 *
 * Uses the repository's existing Happy DOM, makes no network requests and does
 * not load the CMS. Browser checks still own layout, imagery and real focus UX.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '../../../packages/web/package.json'));
const { Window } = require('happy-dom');
const bundlePath = process.argv[2] ? resolve(process.argv[2]) : resolve(here, 'trades-hall-option-b-v3.js');
const copyPath = process.argv[3] ? resolve(process.argv[3]) : resolve(here, 'craft-stories.json');
const script = await readFile(bundlePath, 'utf8');
const copyDocument = JSON.parse(await readFile(copyPath, 'utf8'));
const crafts = Array.isArray(copyDocument) ? copyDocument : copyDocument.crafts;
assert.equal(crafts?.length, 14, 'The editorial source must define all fourteen Crafts');
assert.equal(new Set(crafts.map((craft) => craft.id)).size, 14, 'Craft identifiers must be unique');
assert.equal(new Set(crafts.map((craft) => craft.name)).size, 14, 'Craft names must be unique');

const results = [];
const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const tick = () => new Promise((done) => setImmediate(done));

function fixture({ reduced = false, bodyClass = 'pf-landing' } = {}) {
  const window = new Window({
    url: 'https://www.tradeshallglasgow.co.uk/landing',
    settings: {
      enableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
        disableFallbackToSetURL: true,
      },
    },
  });
  const errors = [];
  const animations = [];
  const scrolls = [];
  const media = new window.EventTarget();
  media.matches = reduced;
  media.media = '(prefers-reduced-motion: reduce)';
  window.matchMedia = (query) => {
    if (query.includes('prefers-reduced-motion')) return media;
    const other = new window.EventTarget();
    other.matches = false;
    other.media = query;
    return other;
  };
  window.fetch = () => { throw new Error('Network requests are forbidden in this local fixture'); };
  window.Element.prototype.scrollIntoView = function (options) {
    scrolls.push({ element: this, options });
  };
  window.Element.prototype.animate = function (keyframes, options) {
    const animation = {
      element: this, keyframes, options, cancelled: false,
      cancel() { this.cancelled = true; },
      finished: Promise.resolve(),
    };
    animations.push(animation);
    return animation;
  };
  window.Element.prototype.getAnimations = function ({ subtree = false } = {}) {
    return animations.filter((animation) => !animation.cancelled &&
      (animation.element === this || (subtree && this.contains(animation.element))));
  };
  window.addEventListener('error', (event) => errors.push(event.error ?? new Error(event.message)));
  window.document.body.className = bodyClass;
  window.document.body.innerHTML = '<main id="contentstart"><div id="th-open-hall-mount"><a href="https://venviewer.com/quiz">Find your Craft</a></div></main>';
  const mount = window.document.querySelector('#th-open-hall-mount');
  const initialize = () => {
    window.eval(script);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  };
  initialize();
  const shadow = mount.shadowRoot;
  const root = shadow?.querySelector('#th-open-hall');
  return {
    window, mount, shadow, root, errors, animations, scrolls, media, initialize,
    query(selector) {
      const element = shadow?.querySelector(selector);
      assert.ok(element, `Missing rendered control: ${selector}`);
      return element;
    },
    click(selector) { this.query(selector).click(); },
    escape() {
      const target = shadow.activeElement ?? root;
      target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    },
    async close() {
      await tick();
      const caught = [...errors];
      await window.happyDOM.close();
      assert.deepEqual(caught, [], 'No uncaught landing runtime errors');
    },
  };
}

async function check(name, run, options) {
  const app = fixture(options);
  try {
    await run(app);
    results.push({ name, passed: true });
  } finally {
    await app.close();
  }
}

function assertClosed(app) {
  assert.ok(!app.root.dataset.craft, 'Closing removes selected Craft state');
  assert.equal(app.query('.oh-craft-story').hidden, true, 'Closed story is hidden');
  assert.equal(app.shadow.querySelectorAll('.oh-crest[aria-pressed="true"]').length, 0, 'No badge remains pressed');
}

function assertSelected(app, index) {
  const craft = crafts[index];
  const button = app.query(`.oh-crest[data-craft-index="${index}"]`);
  assert.equal(app.root.dataset.craft, craft.id, `Selected state identifies ${craft.name}`);
  assert.equal(app.query('.oh-craft-story').hidden, false, 'Selected story is visible');
  assert.equal(normalize(app.query('#oh-craft-story-title').textContent), 'The ' + craft.name, 'Correct Craft heading');
  assert.equal(normalize(app.query('.oh-story-text').textContent), normalize(craft.text), 'Full correct editorial story');
  assert.equal(normalize(app.query('.oh-story-trade').textContent), craft.eyebrow, 'Correct Craft trade label');
  assert.equal(app.query('.oh-story-source').href, craft.sourceUrl, 'Each Craft retains its own source link');
  assert.equal(app.query('.oh-story-source').getAttribute('aria-label'), 'Explore the history of the ' + craft.name);
  assert.equal(app.shadow.querySelectorAll('.oh-crest[aria-pressed="true"]').length, 1, 'Only one badge is pressed');
  assert.equal(button.getAttribute('aria-pressed'), 'true', 'The matching badge is pressed');
  return button;
}

await check('Fourteen native, named and independently selectable badges', (app) => {
  app.click('[data-intent="craft"]');
  assert.equal(app.root.dataset.scene, 'craft');
  const badges = [...app.shadow.querySelectorAll('.oh-crest')];
  assert.equal(badges.length, 14);
  assert.equal(new Set(badges.map((badge) => badge.dataset.craftIndex)).size, 14);
  for (const [index, badge] of badges.entries()) {
    assert.equal(badge.tagName, 'BUTTON', 'Badges must retain native keyboard activation');
    assert.equal(badge.type, 'button');
    assert.equal(badge.disabled, false);
    assert.ok(badge.tabIndex >= 0, 'Badge participates in keyboard order');
    assert.ok(normalize(badge.getAttribute('aria-label') ?? badge.textContent).includes(crafts[index].name), 'Badge has its Craft name');
    badge.click();
    assertSelected(app, index);
  }
});

await check('Rapid selection retains the latest story', async (app) => {
  app.click('[data-intent="craft"]');
  for (const index of [0, 8, 2, 13, 4, 7, 1, 12, 3]) {
    app.click(`.oh-crest[data-craft-index="${index}"]`);
  }
  await tick();
  assertSelected(app, 3);
});

await check('Arrow, Home and End keys navigate badge stories and restore focus', (app) => {
  app.click('[data-intent="craft"]');
  const press = (index, key) => {
    const button = app.query(`.oh-crest[data-craft-index="${index}"]`);
    button.focus();
    const event = new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true, 'Handled navigation keys suppress page scrolling');
  };
  press(0, 'ArrowLeft');
  assert.equal(app.shadow.activeElement, assertSelected(app, 13));
  press(13, 'ArrowRight');
  assert.equal(app.shadow.activeElement, assertSelected(app, 0));
  press(0, 'End');
  assert.equal(app.shadow.activeElement, assertSelected(app, 13));
  press(13, 'Home');
  assert.equal(app.shadow.activeElement, assertSelected(app, 0));
});

await check('Close and Escape restore badge focus; a second Escape returns home', (app) => {
  app.click('[data-intent="craft"]');
  app.click('.oh-crest[data-craft-index="5"]');
  app.click('.oh-story-close');
  assertClosed(app);
  assert.equal(app.shadow.activeElement, app.query('.oh-crest[data-craft-index="5"]'));
  assert.equal(app.root.dataset.scene, 'craft');
  app.click('.oh-crest[data-craft-index="10"]');
  app.escape();
  assertClosed(app);
  assert.equal(app.shadow.activeElement, app.query('.oh-crest[data-craft-index="10"]'));
  assert.equal(app.root.dataset.scene, 'craft');
  app.escape();
  assert.equal(app.root.dataset.scene, 'welcome');
  assert.equal(app.shadow.activeElement, app.query('[data-intent="craft"]'));
});

await check('Back clears an open story and re-entry starts unselected', (app) => {
  app.click('[data-intent="craft"]');
  app.click('.oh-crest[data-craft-index="2"]');
  app.click('.oh-back');
  assert.equal(app.root.dataset.scene, 'welcome');
  assertClosed(app);
  assert.equal(app.shadow.activeElement, app.query('[data-intent="craft"]'));
  app.click('[data-intent="craft"]');
  assertClosed(app);
});

await check('Planner, tour and quiz handoffs remain native same-tab links', (app) => {
  const expected = {
    '[data-intent="event"]': 'https://venviewer.com/plan?space=grand-hall',
    '[data-intent="craft"]': 'https://venviewer.com/quiz',
  };
  for (const [selector, href] of Object.entries(expected)) {
    assert.equal(app.query(selector).href, href);
    assert.equal(app.query(selector).target, '');
  }
  app.click('[data-intent="event"]');
  assert.equal(app.query('.oh-enter').href, expected['[data-intent="event"]']);
  assert.equal(app.query('.oh-enter').target, '');
  assert.equal(app.query('.oh-explore').href, 'https://venviewer.com/tour');
  app.click('.oh-back');
  app.click('[data-intent="craft"]');
  app.click('.oh-crest[data-craft-index="0"]');
  assert.equal(app.query('.oh-enter').href, expected['[data-intent="craft"]']);
  assert.equal(app.query('.oh-enter').target, '');
});

await check('Reduced motion performs every interaction without animation', (app) => {
  app.click('[data-intent="craft"]');
  app.click('.oh-crest[data-craft-index="1"]');
  assertSelected(app, 1);
  app.click('.oh-story-close');
  app.click('.oh-back');
  app.click('[data-intent="event"]');
  assert.equal(app.animations.length, 0, 'Reduced motion must not call Web Animations');
}, { reduced: true });

await check('Repeated initialization keeps one widget and one set of handlers', (app) => {
  const originalRoot = app.root;
  app.initialize();
  app.initialize();
  assert.equal(app.mount.shadowRoot.querySelector('#th-open-hall'), originalRoot);
  assert.equal(app.window.document.querySelectorAll('#th-open-hall-page-style').length, 1);
  assert.equal(app.shadow.querySelectorAll('.oh-crest').length, 14);
  app.click('[data-intent="craft"]');
  app.click('.oh-crest[data-craft-index="6"]');
  assertSelected(app, 6);
  app.escape();
  assert.equal(app.root.dataset.scene, 'craft', 'Duplicate handlers must not consume both Escape levels');
  assertClosed(app);
});

await check('A non-landing body is left untouched', (app) => {
  assert.equal(app.mount.shadowRoot, null);
  assert.equal(app.window.document.querySelector('#th-open-hall-page-style'), null);
  assert.equal(app.window.document.querySelector('link[rel="canonical"]'), null);
  assert.equal(app.mount.textContent, 'Find your Craft');
}, { bodyClass: 'pf-front' });

console.log(JSON.stringify({ bundle: bundlePath, copy: copyPath, checks: results.length, results }, null, 2));
