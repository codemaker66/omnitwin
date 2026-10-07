import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setImmediate as nextTurn} from 'node:timers/promises';
import test from 'node:test';
import {Window} from 'happy-dom';

const pageURL = new URL('../public/trades-hall/cards/results.html', import.meta.url);
const scriptURL = new URL('../public/trades-hall/cards/results.js', import.meta.url);
const designs = JSON.parse(await readFile(new URL('../public/trades-hall/cards/designs.json', import.meta.url), 'utf8'));
const ownerToken = 'synthetic_owner_token_'.padEnd(43, 'x');
let fixtureNumber = 0;

const response = (name, day, extra = {}) => ({
  id: `synthetic-${name}`,
  reviewerName: name,
  favourite: null,
  comments: {},
  generalComment: '',
  createdAt: `2026-10-${day}T10:00:00.000Z`,
  updatedAt: `2026-10-${day}T10:00:00.000Z`,
  ...extra,
});

function responses() {
  return [
    response('Alice', '01', {favourite: '38', comments: {'43': 'Please improve the alignment.'}, generalComment: 'Compare the gold foil samples.'}),
    response('Beatrice', '02', {favourite: '43', comments: {'38': 'The layout has a lovely rhythm.', 'nocturne-2': 'A bolder gold would help.'}}),
    response('Cara', '03', {comments: {'nocturne-2': 'The contrast is excellent.'}}),
    response('Dan', '04', {favourite: '38'}),
    response('Erin', '05', {favourite: '43'}),
    response('Faye', '06', {generalComment: 'Please compare warmer paper.'}),
  ];
}

async function settle(window) {
  for (let turn = 0; turn < 100; turn++) {
    await nextTurn();
    const refresh = window.document.getElementById('refresh-results');
    const status = window.document.getElementById('results-status');
    if (!refresh.disabled && status.getAttribute('aria-busy') !== 'true') return;
  }
  throw Error('Results did not finish refreshing.');
}

async function fixture(t, {rows = responses(), token = ownerToken, storedToken = '', failure = null} = {}) {
  const window = new Window({
    url: `https://review.test/trades-hall/cards/results.html${token ? `#${token}` : ''}`,
    settings: {disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true},
  });
  const state = {rows, failure, requests: []};
  if (storedToken) window.sessionStorage.setItem('trades-hall-review-owner', storedToken);
  const fetch = async (url, options = {}) => {
    const target = String(url);
    state.requests.push({url: target, options});
    if (target === './designs.json') return {ok: true, status: 200, json: async () => structuredClone(designs)};
    assert.equal(target, '/api/card-review?view=all', 'the owner view only reads its review endpoint');
    assert.equal(options.headers.Authorization, `Bearer ${ownerToken}`);
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store');
    if (state.failure) {
      const current = state.failure;
      state.failure = null;
      return {ok: false, status: current.status ?? 503, json: async () => ({error: current.message, code: 'SERVICE_ERROR'})};
    }
    return {ok: true, status: 200, json: async () => ({responses: structuredClone(state.rows), updatedAt: '2026-10-06T11:00:00.000Z'})};
  };
  const globals = {window, document: window.document, location: window.location, history: window.history, sessionStorage: window.sessionStorage, fetch};
  const originals = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, writable: true, configurable: true});
  t.after(async () => {
    await window.happyDOM.abort();
    window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  window.document.write(await readFile(pageURL, 'utf8'));
  await import(`${scriptURL.href}?test-fixture=${++fixtureNumber}`);
  await settle(window);
  const byId = id => {
    const element = window.document.getElementById(id);
    assert.ok(element, `Expected #${id} in the owner results page`);
    return element;
  };
  const change = (id, value, event = 'change') => {
    const element = byId(id);
    element.value = value;
    element.dispatchEvent(new window.Event(event, {bubbles: true}));
  };
  return {window, document: window.document, byId, change, state, feed: () => byId('results-list').textContent};
}

test('overview separates responses, comments and favourites, including tied favourites', async t => {
  const {byId, document, window} = await fixture(t);
  assert.equal(byId('response-count').textContent.trim(), '6');
  assert.equal(byId('comment-count').textContent.trim(), '6');
  assert.match(byId('leading-design').textContent, /38/);
  assert.match(byId('leading-design').textContent, /43/);
  assert.doesNotMatch(byId('leading-design').textContent, /N2|Nocturne/);
  assert.equal(byId('view-designs').getAttribute('aria-pressed'), 'true');
  assert.equal(byId('view-people').getAttribute('aria-pressed'), 'false');
  assert.equal(byId('design-filter').value, 'all');
  const choices = [...document.querySelectorAll('#design-list .design-choice[data-design]')];
  for (const design of designs) assert.ok(choices.some(choice => choice.dataset.design === design.id), `Design ${design.id} remains discoverable`);
  assert.equal(window.location.hash, '', 'the owner token is removed from the address bar');
  assert.equal(window.sessionStorage.getItem('trades-hall-review-owner'), ownerToken);
});

test('a design shows its own comments and favourite-only reviewers without borrowing other design feedback', async t => {
  const {byId, change, feed} = await fixture(t);
  change('design-filter', '43');
  assert.match(feed(), /Alice/);
  assert.match(feed(), /Please improve the alignment\./);
  assert.match(feed(), /Beatrice/);
  assert.match(feed(), /Erin/);
  assert.doesNotMatch(feed(), /lovely rhythm|bolder gold|gold foil samples|warmer paper|Dan|Cara/);
  assert.equal(byId('design-filter').value, '43');
  change('design-filter', 'nocturne-2');
  assert.match(feed(), /Beatrice/);
  assert.match(feed(), /Cara/);
  assert.match(feed(), /bolder gold|contrast is excellent/);
  assert.doesNotMatch(feed(), /Please improve|lovely rhythm|gold foil samples|warmer paper/);
});

test('overall comments remain separate from card-specific feedback', async t => {
  const {change, feed} = await fixture(t);
  change('design-filter', 'overall');
  assert.match(feed(), /Alice/);
  assert.match(feed(), /Faye/);
  assert.match(feed(), /gold foil samples/);
  assert.match(feed(), /warmer paper/);
  assert.doesNotMatch(feed(), /Please improve the alignment|lovely rhythm|bolder gold|contrast is excellent/);
});

test('comments without a favourite do not invent a leading choice', async t => {
  const {byId, change, feed} = await fixture(t, {rows: [response('Cara', '03', {comments: {'nocturne-2': 'The contrast is excellent.'}})]});
  assert.equal(byId('response-count').textContent.trim(), '1');
  assert.equal(byId('comment-count').textContent.trim(), '1');
  assert.doesNotMatch(byId('leading-design').textContent, /N2|Nocturne/);
  change('design-filter', 'nocturne-2');
  assert.match(feed(), /Cara/);
  assert.match(feed(), /The contrast is excellent\./);
});

test('the person view preserves complete responses and filters by a relationship to the selected design', async t => {
  const {byId, change, feed} = await fixture(t);
  change('design-filter', '43');
  byId('view-people').click();
  assert.equal(byId('view-people').getAttribute('aria-pressed'), 'true');
  assert.equal(byId('view-designs').getAttribute('aria-pressed'), 'false');
  assert.match(feed(), /Alice/);
  assert.match(feed(), /Beatrice/);
  assert.match(feed(), /Erin/);
  assert.match(feed(), /gold foil samples/);
  assert.match(feed(), /lovely rhythm/);
  assert.match(feed(), /bolder gold/);
  assert.doesNotMatch(feed(), /Cara|Dan|Faye/);
});

test('search finds names, comments and design names; clearing filters restores the view', async t => {
  const {byId, change, feed, document} = await fixture(t);
  document.querySelector('.design-choice[data-design="43"]').click();
  assert.equal(byId('design-filter').value, '43');
  change('results-search', 'alice', 'input');
  assert.match(feed(), /Alice/);
  assert.doesNotMatch(feed(), /Beatrice|Erin/);
  byId('clear-filters').click();
  assert.equal(byId('design-filter').value, 'all');
  assert.equal(byId('results-search').value, '');
  change('results-search', 'rhythm', 'input');
  assert.match(feed(), /Beatrice/);
  assert.match(feed(), /lovely rhythm/);
  assert.doesNotMatch(feed(), /Alice|Erin|Cara/);
  change('results-search', 'Nocturne 2', 'input');
  assert.match(feed(), /Beatrice/);
  assert.match(feed(), /Cara/);
  assert.doesNotMatch(feed(), /Alice|Erin|Dan/);
  change('results-search', 'no matching feedback phrase', 'input');
  assert.doesNotMatch(feed(), /Alice|Beatrice|Cara|Dan|Erin|Faye/);
  assert.match(document.body.textContent, /no .*match|nothing .*match/i);
  byId('clear-filters').click();
  assert.match(feed(), /Alice/);
  assert.match(feed(), /Cara/);
});

test('people can be sorted by latest, earliest and name', async t => {
  const {byId, change, feed} = await fixture(t);
  byId('view-people').click();
  const namesInOrder = names => {
    let previous = -1;
    for (const name of names) {
      const index = feed().indexOf(name);
      assert.ok(index > previous, `${name} should follow the previous person`);
      previous = index;
    }
  };
  change('results-sort', 'newest');
  namesInOrder(['Faye', 'Erin', 'Dan', 'Cara', 'Beatrice', 'Alice']);
  change('results-sort', 'oldest');
  namesInOrder(['Alice', 'Beatrice', 'Cara', 'Dan', 'Erin', 'Faye']);
  change('results-sort', 'name');
  namesInOrder(['Alice', 'Beatrice', 'Cara', 'Dan', 'Erin', 'Faye']);
});

test('empty results and missing owner access remain distinct states', async t => {
  await t.test('an authenticated empty collection is visible with disabled export', async t => {
    const {byId, document} = await fixture(t, {rows: []});
    assert.equal(byId('results-content').hidden, false);
    assert.equal(byId('response-count').textContent.trim(), '0');
    assert.equal(byId('comment-count').textContent.trim(), '0');
    assert.equal(byId('export-results').disabled, true);
    assert.match(document.body.textContent, /no responses yet/i);
  });
  await t.test('missing token does not fetch or reveal results', async t => {
    const {byId, state} = await fixture(t, {token: ''});
    assert.equal(state.requests.length, 0);
    assert.equal(byId('results-content').hidden, true);
    assert.equal(byId('export-results').disabled, true);
    assert.match(byId('results-status').textContent, /private owner link/i);
  });
  await t.test('an owner token kept in the session can reopen the page', async t => {
    const {byId} = await fixture(t, {token: '', storedToken: ownerToken});
    assert.equal(byId('results-content').hidden, false);
    assert.equal(byId('response-count').textContent.trim(), '6');
  });
});

test('failed refresh retains loaded feedback and active filters, then a retry recovers', async t => {
  const {byId, change, feed, state, window} = await fixture(t);
  change('design-filter', '43');
  change('results-search', 'Alice', 'input');
  const before = feed();
  state.failure = {message: 'Synthetic service unavailable'};
  byId('refresh-results').click();
  await settle(window);
  assert.equal(byId('results-status').dataset.state, 'error');
  assert.match(byId('results-status').textContent, /Synthetic service unavailable/);
  assert.equal(byId('results-content').hidden, false);
  assert.equal(feed(), before);
  assert.equal(byId('design-filter').value, '43');
  assert.equal(byId('results-search').value, 'Alice');
  assert.equal(byId('refresh-results').disabled, false);
  byId('refresh-results').click();
  await settle(window);
  assert.notEqual(byId('results-status').dataset.state, 'error');
  assert.equal(byId('design-filter').value, '43');
  assert.equal(byId('results-search').value, 'Alice');
  assert.match(feed(), /Alice/);
});

test('a denied initial request reveals no response content', async t => {
  const {byId, document} = await fixture(t, {failure: {status: 403, message: 'Owner access was denied.'}});
  assert.equal(byId('results-content').hidden, true);
  assert.equal(byId('results-status').dataset.state, 'error');
  assert.equal(byId('export-results').disabled, true);
  assert.doesNotMatch(document.body.textContent, /Alice|Beatrice|Cara/);
});

test('HTML-looking names and multiline comments stay literal text in both views', async t => {
  const name = '<img src=x onerror="globalThis.pwned=true">';
  const comment = '<script>globalThis.pwned=true</script>\nKeep this second line. & < >';
  const {byId, change, feed, document} = await fixture(t, {rows: [response(name, '01', {favourite: '38', comments: {'43': comment}, generalComment: '<svg onload="globalThis.pwned=true">'})]});
  change('design-filter', '43');
  assert.ok(feed().includes(name));
  assert.ok(feed().includes(comment));
  assert.equal(document.querySelectorAll('#results-list script, #results-list [onerror], #results-list [onload]').length, 0);
  byId('view-people').click();
  assert.ok(feed().includes(name));
  assert.ok(feed().includes(comment));
  assert.equal(document.querySelectorAll('#results-list script, #results-list [onerror], #results-list [onload]').length, 0);
  assert.equal(globalThis.pwned, undefined);
});

test('CSV export keeps all submitted feedback when the visible feed is filtered and protects formula-like text', async t => {
  const rows = [
    response('=SUM(A1:A2)', '01', {favourite: 'nocturne-2', comments: {'nocturne': '+Make the gold warmer'}, generalComment: '@Literal feedback'}),
    response('Second reviewer', '02', {favourite: '38', comments: {'43': 'A line with "quotes"\nand a second line.'}}),
  ];
  const {byId, change, window} = await fixture(t, {rows});
  let exportedBlob;
  let downloadName;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const originalClick = window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => {exportedBlob = blob; return 'blob:synthetic-feedback-export';};
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {downloadName = this.download;};
  t.after(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    window.HTMLAnchorElement.prototype.click = originalClick;
  });
  change('design-filter', 'nocturne');
  byId('export-results').click();
  assert.ok(exportedBlob, 'export produces a download');
  const csv = await exportedBlob.text();
  assert.match(downloadName, /^trades-hall-card-feedback-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(csv.includes("\"'=SUM(A1:A2)\""));
  assert.ok(csv.includes("\"'+Make the gold warmer\""));
  assert.ok(csv.includes("\"'@Literal feedback\""));
  assert.match(csv, /N2 — Nocturne 2/);
  assert.match(csv, /Second reviewer/);
  assert.ok(csv.includes('A line with ""quotes""\nand a second line.'));
});
