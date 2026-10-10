/**
 * Local behavioural checks for the actual CMS landing bundle.
 *
 * Run from any directory:
 *   node docs/design/trades-hall-landing/check-craft-explorer.mjs [bundle.js] [copy.json] [fallback.html]
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
const bundlePath = process.argv[2] ? resolve(process.argv[2]) : resolve(here, 'trades-hall-option-b-v5.js');
const copyPath = process.argv[3] ? resolve(process.argv[3]) : resolve(here, 'craft-stories.json');
const fallbackPath = process.argv[4] ? resolve(process.argv[4]) : resolve(here, 'cms-external-embed.html');
const script = await readFile(bundlePath, 'utf8');
const copyDocument = JSON.parse(await readFile(copyPath, 'utf8'));
const crafts = Array.isArray(copyDocument) ? copyDocument : copyDocument.crafts;
assert.equal(crafts?.length, 14, 'The editorial source must define all fourteen Crafts');
assert.equal(new Set(crafts.map((craft) => craft.id)).size, 14, 'Craft identifiers must be unique');
assert.equal(new Set(crafts.map((craft) => craft.name)).size, 14, 'Craft names must be unique');

const results = [];
const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const tick = () => new Promise((done) => setImmediate(done));

function fixture({ reduced = false, mobile = false, bodyClass = 'pf-landing' } = {}) {
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
    other.matches = mobile && query === '(max-width: 650px)';
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

await check('All story size reserves are complete, inaccessible and free of duplicate IDs', (app) => {
  app.click('[data-intent="craft"]');
  const panel = app.query('.oh-craft-story');
  const reserves = [...panel.querySelectorAll('.oh-story-reserve')];
  assert.equal(reserves.length, crafts.length, 'Each Craft contributes its complete natural text size');
  assert.equal(panel.querySelectorAll('.oh-story-body').length, 1, 'Only one live story body exists');
  const ids = [...app.shadow.querySelectorAll('[id]')].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length, 'Sizing copies cannot duplicate live region or heading IDs');
  for (const [index, reserve] of reserves.entries()) {
    assert.equal(reserve.getAttribute('aria-hidden'), 'true', 'Sizing content is excluded from assistive technology');
    assert.equal(reserve.hasAttribute('inert'), true, 'Sizing content cannot receive interaction');
    assert.equal(reserve.querySelector('[id]'), null, 'Sizing descendants have no IDs');
    assert.equal(reserve.querySelector('a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]'), null, 'Sizing content adds no focusable controls');
    assert.equal(normalize(reserve.querySelector('h2').textContent), 'The ' + crafts[index].name);
    assert.equal(normalize(reserve.querySelector('.oh-story-text').textContent), normalize(crafts[index].text));
    assert.ok(normalize(reserve.querySelector('.oh-story-rule').textContent).endsWith(crafts[index].eyebrow));
    assert.equal(normalize(reserve.querySelector('.oh-story-source').textContent), 'Explore this Craft’s history ↗');
  }
  const reservedCopy = reserves.map((reserve) => reserve.textContent);
  for (const index of [13, 1, 6, 0]) {
    app.click(`.oh-crest[data-craft-index="${index}"]`);
    assertSelected(app, index);
  }
  assert.deepEqual(reserves.map((reserve) => reserve.textContent), reservedCopy, 'Selecting a Craft must not alter any size reserve');
});

await check('Craft switching fades only the story body and cancels earlier transitions', (app) => {
  app.click('[data-intent="craft"]');
  const beforeSelection = app.animations.length;
  for (const index of [1, 13, 6, 9]) app.click(`.oh-crest[data-craft-index="${index}"]`);
  const transitions = app.animations.slice(beforeSelection);
  assert.equal(transitions.length, 4);
  for (const [index, animation] of transitions.entries()) {
    assert.equal(animation.element, app.query('.oh-story-body'), 'The outer card must not animate');
    assert.deepEqual(JSON.parse(JSON.stringify(animation.keyframes)), [{ opacity: 0 }, { opacity: 1 }], 'Story transitions change opacity without translation or size');
    assert.equal(animation.cancelled, index < transitions.length - 1, 'Only the latest story transition remains active');
  }
  assert.equal(app.scrolls.length, 0, 'Desktop selection never requests programmatic scrolling');
  assertSelected(app, 9);
});

for (const reduced of [false, true]) {
  await check(`Phone scrolls to the first story once, then preserves the visitor’s position${reduced ? ' with reduced motion' : ''}`, (app) => {
    app.click('[data-intent="craft"]');
    app.click('.oh-crest[data-craft-index="13"]');
    assert.equal(app.scrolls.length, 1, 'The initial phone story can be revealed');
    assert.equal(app.scrolls[0].element, app.query('.oh-craft-story'));
    assert.equal(app.scrolls[0].options.block, 'nearest');
    assert.equal(app.scrolls[0].options.behavior, reduced ? 'instant' : 'smooth');
    for (const index of [1, 6, 9, 0, 13]) app.click(`.oh-crest[data-craft-index="${index}"]`);
    const badge = app.query('.oh-crest[data-craft-index="13"]');
    badge.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assertSelected(app, 0);
    assert.equal(app.scrolls.length, 1, 'Switching by touch or keyboard must not scroll the page again');
    app.click('.oh-story-close');
    app.click('.oh-crest[data-craft-index="5"]');
    assert.equal(app.scrolls.length, 2, 'Opening a story again after closing may reveal it once');
    app.click('.oh-crest[data-craft-index="2"]');
    assert.equal(app.scrolls.length, 2);
    if (reduced) assert.equal(app.animations.length, 0, 'Reduced motion suppresses all animated transitions');
  }, { mobile: true, reduced });
}

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

function assertNoEventHandoffs(container) {
  const heldLinks = [...container.querySelectorAll('a[href]')].filter((anchor) => {
    const url = new URL(anchor.getAttribute('href'), 'https://www.tradeshallglasgow.co.uk/landing');
    return url.hostname === 'venviewer.com' && (url.pathname === '/tour' || /(^|\/)plan(\/|$)/.test(url.pathname));
  });
  assert.deepEqual(heldLinks.map((anchor) => anchor.href), [], 'No hidden or visible link bypasses the event planning hold');
}

await check('Event choice stays on the landing page and explains the construction hold', (app) => {
  const initialUrl = app.window.location.href;
  const choice = app.query('[data-intent="event"]');
  assert.equal(choice.tagName, 'BUTTON', 'The held event experience is an in-page action');
  assert.equal(choice.type, 'button');
  assert.equal(choice.disabled, false, 'Visitors can open the explanation');
  assert.equal(choice.hasAttribute('href'), false, 'Event choice cannot bypass the hold');
  assert.match(normalize(choice.textContent), /Under construction for now\./);
  assertNoEventHandoffs(app.shadow);
  app.click('[data-intent="event"]');
  assert.equal(app.window.location.href, initialUrl, 'Selecting an event must not navigate');
  assert.equal(app.root.dataset.scene, 'event');
  assert.equal(normalize(app.query('h1 span').textContent), 'Under');
  assert.equal(normalize(app.query('h1 em').textContent), 'construction.');
  assert.match(app.query('.oh-subtitle').textContent, /Online event planning is being prepared\./);
  assert.match(app.query('.oh-subtitle').textContent, /Please contact our team for event enquiries\./);
  assert.equal(normalize(app.query('.oh-detail-title').textContent), 'UNDER CONSTRUCTION');
  assert.equal(app.query('.oh-detail').hidden, false);
  assert.equal(app.query('.oh-enter').href, 'mailto:info@tradeshallglasgow.co.uk');
  assert.equal(normalize(app.query('.oh-enter span').textContent), 'Contact our team');
  assert.equal(app.query('.oh-enter').target, '');
  assert.equal(app.shadow.querySelector('.oh-explore'), null);
  assert.match(app.query('.oh-live').textContent, /UNDER CONSTRUCTION/);
  assert.equal(app.shadow.activeElement, app.query('.oh-back'));
  assertNoEventHandoffs(app.shadow);
});

await check('Back and Escape leave the event hold with focus restored; the quiz remains available', (app) => {
  const choice = app.query('[data-intent="event"]');
  app.click('[data-intent="event"]');
  app.click('.oh-back');
  assert.equal(app.root.dataset.scene, 'welcome');
  assert.equal(app.shadow.activeElement, choice);
  app.click('[data-intent="event"]');
  app.escape();
  assert.equal(app.root.dataset.scene, 'welcome');
  assert.equal(app.shadow.activeElement, choice);
  assert.equal(app.query('[data-intent="craft"]').href, 'https://venviewer.com/quiz');
  assert.equal(app.query('[data-intent="craft"]').target, '');
  app.click('[data-intent="craft"]');
  app.click('.oh-crest[data-craft-index="0"]');
  assert.equal(app.query('.oh-enter').href, 'https://venviewer.com/quiz');
  assert.equal(app.query('.oh-enter').target, '');
  assert.equal(normalize(app.query('.oh-enter span').textContent), 'Discover my Craft');
  assertNoEventHandoffs(app.shadow);
});

await check('Native CMS fallback explains the hold while preserving quiz and contact links', async (app) => {
  const fallback = app.window.document.createElement('template');
  fallback.innerHTML = await readFile(fallbackPath, 'utf8');
  const mount = fallback.content.querySelector('#th-open-hall-mount');
  assert.ok(mount, 'Native CMS fallback retains the expected mount');
  assert.match(normalize(mount.textContent), /Plan an event/i);
  assert.match(normalize(mount.textContent), /under construction/i);
  assertNoEventHandoffs(fallback.content);
  const links = [...fallback.content.querySelectorAll('a[href]')];
  assert.ok(links.some((anchor) => anchor.href === 'https://venviewer.com/quiz'), 'Quiz remains reachable without JavaScript');
  assert.ok(links.some((anchor) => anchor.href === 'mailto:info@tradeshallglasgow.co.uk'), 'Event enquiries remain reachable without JavaScript');
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

console.log(JSON.stringify({ bundle: bundlePath, copy: copyPath, fallback: fallbackPath, checks: results.length, results }, null, 2));
