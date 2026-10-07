import { requestReview } from './api.js';
import { activity } from './activity.js';

const $ = id => document.getElementById(id);
let designs = [], responses = [], busy = false, hasLoaded = false;
let view = 'designs', selected = 'all';
let ownerToken = location.hash.slice(1);
if (/^[A-Za-z0-9_-]{43}$/.test(ownerToken)) {
  try { sessionStorage.setItem('trades-hall-review-owner', ownerToken); } catch {}
  history.replaceState(null, '', location.pathname + location.search);
} else {
  try { ownerToken = sessionStorage.getItem('trades-hall-review-owner') || ''; } catch { ownerToken = ''; }
}

const design = id => designs.find(item => item.id === id);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
const label = id => { const item = design(id); return item ? item.label + ' — ' + item.title : id; };
const date = value => new Date(value).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
});
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, className, action) {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function counts(id) {
  return {
    votes: responses.filter(r => r.favourite === id).length,
    comments: responses.filter(r => hasText(r.comments?.[id])).length,
  };
}
function compareResponses(a, b) {
  const order = $('results-sort').value;
  return order === 'name'
    ? a.reviewerName.localeCompare(b.reviewerName, 'en', { sensitivity: 'base' }) || b.updatedAt.localeCompare(a.updatedAt)
    : order === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt);
}
function sortResponses(items) {
  return [...items].sort(compareResponses);
}
function matches(...values) {
  const query = $('results-search').value.trim().toLocaleLowerCase('en');
  return !query || values.some(value => String(value || '').toLocaleLowerCase('en').includes(query));
}
function artwork(item) {
  const node = button('', 'artwork-button', () => openPreview(item));
  node.setAttribute('aria-label', 'Enlarge ' + label(item.id));
  const image = element('img');
  image.src = item.image; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
  node.append(image);
  return node;
}
function openPreview(item) {
  $('preview-title').textContent = label(item.id);
  $('preview-image').src = item.image;
  $('preview-image').alt = item.title + ', front and reverse';
  $('preview-note').textContent = item.productionNote || 'Front and reverse · Landscape format · Venue planner QR';
  $('preview-dialog').showModal();
  document.body.classList.add('dialog-open');
}
$('close-preview').addEventListener('click', () => $('preview-dialog').close());
$('preview-dialog').addEventListener('close', () => document.body.classList.remove('dialog-open'));

function selectDesign(id) {
  selected = id; $('design-filter').value = id;
  updateSelection(); render();
}
function updateSelection() {
  for (const node of $('design-list').querySelectorAll('button')) {
    node.setAttribute('aria-pressed', String(node.dataset.design === selected));
  }
}
function buildOverview() {
  $('response-count').textContent = String(responses.length);
  const totalComments = responses.reduce((sum, r) => sum + designs.filter(d => hasText(r.comments?.[d.id])).length + Number(hasText(r.generalComment)), 0);
  $('comment-count').textContent = String(totalComments);
  const ranked = designs.map(item => ({ ...item, ...counts(item.id) }))
    .sort((a, b) => b.votes - a.votes || b.comments - a.comments);
  const leaders = ranked.filter(item => item.votes > 0 && item.votes === ranked[0]?.votes);
  $('leading-label').textContent = leaders.length > 1 ? 'Joint favourites' : 'Most selected';
  $('leading-design').textContent = leaders.length
    ? leaders.map(item => item.label + ' · ' + (item.shortTitle || item.title)).join(' / ')
    : 'No favourites yet';

  const all = button('All feedback', 'design-choice all-choice', () => selectDesign('all'));
  all.dataset.design = 'all'; all.append(element('span', String(responses.length)));
  const overall = button('Overall comments', 'design-choice all-choice', () => selectDesign('overall'));
  overall.dataset.design = 'overall'; overall.append(element('span', String(responses.filter(r => hasText(r.generalComment)).length)));
  $('design-list').replaceChildren(all, overall);
  for (const item of ranked) {
    const node = button('', 'design-choice', () => selectDesign(item.id));
    node.dataset.design = item.id;
    node.setAttribute('aria-label', label(item.id) + ': ' + plural(item.votes, 'favourite') + ', ' + plural(item.comments, 'comment'));
    const image = element('img'); image.src = item.image; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    const copy = element('span', undefined, 'choice-copy');
    const title = element('span', undefined, 'choice-name');
    title.append(element('b', item.label), document.createTextNode(item.shortTitle || item.title));
    copy.append(title, element('span', plural(item.votes, 'favourite') + ' · ' + plural(item.comments, 'comment'), 'choice-counts'));
    node.append(image, copy); $('design-list').append(node);
  }
  $('design-filter').replaceChildren();
  for (const [id, title] of [['all', 'All designs'], ['overall', 'Overall comments'], ...designs.map(item => [item.id, label(item.id)])]) {
    const option = element('option', title); option.value = id; $('design-filter').append(option);
  }
  $('design-filter').value = selected;
  updateSelection();
}
function timestamp(value) {
  const node = element('time', 'Saved ' + date(value) + ' UK', 'note-date');
  node.dateTime = value;
  return node;
}
function feedbackNote(response, id) {
  const note = element('article', undefined, 'feedback-note');
  const meta = element('div', undefined, 'note-meta');
  meta.append(element('span', response.reviewerName, 'note-author'), timestamp(response.updatedAt));
  note.append(meta);
  const text = id === 'overall' ? response.generalComment : response.comments?.[id];
  note.append(element('p', hasText(text) ? text : 'Chose this design without a written comment.', hasText(text) ? 'comment-text' : 'comment-absent'));
  if (id !== 'overall' && response.favourite === id) note.append(element('span', 'Their favourite', 'favourite-badge'));
  return note;
}
function designSection(item, items) {
  const section = element('section', undefined, 'feedback-design');
  section.dataset.design = item.id;
  const header = element('div', undefined, 'design-header');
  const copy = element('div');
  copy.append(element('p', 'Design ' + item.label, 'design-kicker'), element('h3', item.title));
  const totals = counts(item.id), summary = element('div', undefined, 'design-counts');
  summary.append(element('span', plural(totals.votes, 'favourite')), element('span', plural(totals.comments, 'comment')));
  copy.append(summary); header.append(artwork(item), copy); section.append(header);
  for (const response of sortResponses(items)) section.append(feedbackNote(response, item.id));
  if (!items.length) section.append(element('p', 'No feedback for this design yet.', 'feedback-note comment-absent'));
  return section;
}
function renderDesigns() {
  const groups = [];
  for (const item of designs) {
    if (selected !== 'all' && selected !== item.id) continue;
    const items = responses.filter(r => (r.favourite === item.id || hasText(r.comments?.[item.id]))
      && matches(r.reviewerName, r.comments?.[item.id], label(item.id), item.shortTitle));
    if (items.length || (selected === item.id && !$('results-search').value.trim())) groups.push({ item, items });
  }
  // The chosen ordering applies to people within each design, and to the first matching response in each group.
  groups.sort((a, b) => {
    const firstA = sortResponses(a.items)[0], firstB = sortResponses(b.items)[0];
    if (!firstA || !firstB) return Number(!firstA) - Number(!firstB);
    return compareResponses(firstA, firstB);
  });
  let entries = 0;
  for (const group of groups) {
    entries += group.items.length; $('results-list').append(designSection(group.item, group.items));
  }
  if (selected === 'all' || selected === 'overall') {
    const overall = sortResponses(responses.filter(r => hasText(r.generalComment) && matches(r.reviewerName, r.generalComment, 'Overall comments')));
    if (overall.length) {
      const section = element('section', undefined, 'feedback-design');
      section.dataset.design = 'overall';
      section.append(element('h3', 'Overall comments', 'overall-header'));
      for (const response of overall) section.append(feedbackNote(response, 'overall'));
      $('results-list').append(section); entries += overall.length;
    }
  }
  const sections = $('results-list').children.length;
  $('match-count').textContent = entries
    ? entries + (entries === 1 ? ' feedback entry' : ' feedback entries') + ' across ' + plural(sections, 'section') + '. A person may appear under more than one design.'
    : selected !== 'all' && selected !== 'overall' && sections ? 'No responses for this design yet.' : 'No matching feedback.';
  return sections;
}
function responseMatches(response) {
  if (selected === 'overall' && !hasText(response.generalComment)) return false;
  if (selected !== 'all' && selected !== 'overall' && response.favourite !== selected && !hasText(response.comments?.[selected])) return false;
  const designNames = designs.filter(d => response.favourite === d.id || hasText(response.comments?.[d.id])).map(d => label(d.id));
  return matches(response.reviewerName, response.generalComment, ...Object.values(response.comments || {}), ...designNames);
}
function renderPeople() {
  const items = sortResponses(responses.filter(responseMatches));
  for (const response of items) {
    const row = element('article', undefined, 'response');
    const heading = element('div', undefined, 'response-heading');
    heading.append(element('h3', response.reviewerName), timestamp(response.updatedAt)); row.append(heading);
    const favourite = element('div', undefined, 'response-favourite');
    const favouriteDesign = design(response.favourite);
    if (favouriteDesign) {
      const copy = element('div', 'Favourite choice'); copy.append(element('strong', label(favouriteDesign.id)));
      favourite.append(artwork(favouriteDesign), copy);
    } else favourite.append(element('span', 'No favourite selected · Comments only'));
    row.append(favourite);
    const comments = element('div', undefined, 'response-comments');
    for (const item of designs) {
      const text = response.comments?.[item.id]; if (!hasText(text)) continue;
      const note = element('div', undefined, 'feedback-note');
      const title = element('h4');
      title.append(button(label(item.id) + ' ↗', 'inline-design', () => openPreview(item)));
      note.append(title, element('p', text, 'comment-text')); comments.append(note);
    }
    if (hasText(response.generalComment)) {
      const note = element('div', undefined, 'feedback-note');
      note.append(element('h4', 'Overall comments'), element('p', response.generalComment, 'comment-text')); comments.append(note);
    }
    if (!comments.children.length) comments.append(element('p', 'Favourite selected; no comments added.', 'feedback-note comment-absent'));
    row.append(comments); $('results-list').append(row);
  }
  $('match-count').textContent = plural(items.length, 'response') + (selected !== 'all' || $('results-search').value.trim() ? ' matched · Showing each person’s complete response.' : ' · Each person’s complete response.');
  return items.length;
}
function render() {
  $('view-designs').setAttribute('aria-pressed', String(view === 'designs'));
  $('view-people').setAttribute('aria-pressed', String(view === 'people'));
  $('results-list').replaceChildren();
  $('clear-filters').hidden = selected === 'all' && !$('results-search').value.trim();
  $('empty-results').hidden = responses.length > 0;
  const shown = view === 'designs' ? renderDesigns() : renderPeople();
  $('no-matches').hidden = !responses.length || shown > 0;
  if (!responses.length) { $('results-list').replaceChildren(); $('match-count').textContent = ''; }
}
function clearFilters() {
  $('results-search').value = ''; selectDesign('all');
}
$('clear-filters').addEventListener('click', clearFilters);
$('reset-empty').addEventListener('click', clearFilters);
$('view-designs').addEventListener('click', () => { view = 'designs'; render(); });
$('view-people').addEventListener('click', () => { view = 'people'; render(); });
$('results-search').addEventListener('input', render);
$('results-sort').addEventListener('change', render);
$('design-filter').addEventListener('change', () => selectDesign($('design-filter').value));

async function refresh() {
  if (busy) return;
  if (!/^[A-Za-z0-9_-]{43}$/.test(ownerToken)) {
    $('results-status').textContent = 'Open this page using your private owner link to view saved responses.';
    $('results-status').dataset.state = 'error'; return;
  }
  busy = true; $('refresh-results').disabled = true;
  activity($('results-status'), hasLoaded ? 'Refreshing responses…' : 'Retrieving saved responses…', true);
  $('results-status').dataset.state = '';
  try {
    if (!designs.length) {
      const result = await fetch('./designs.json');
      if (!result.ok) throw Error('Could not load the design list.');
      designs = await result.json();
    }
    const data = await requestReview({ token: ownerToken, all: true });
    responses = data.responses;
    hasLoaded = true; $('results-content').hidden = false;
    $('export-results').disabled = responses.length === 0;
    buildOverview(); render();
    activity($('results-status'), 'Last refreshed ' + date(data.updatedAt || new Date().toISOString()) + ' UK');
  } catch (error) {
    // A rejected credential must not leave previously fetched private content visible.
    if (error.status === 401 || error.status === 403) {
      responses = []; hasLoaded = false; $('results-content').hidden = true;
      $('results-list').replaceChildren(); $('design-list').replaceChildren(); $('export-results').disabled = true;
    }
    const message = error.code === 'NETWORK_ERROR' ? 'Could not reach the feedback service.'
      : error.code === 'TIMEOUT' ? 'The feedback service took too long to respond.' : error.message;
    activity($('results-status'), message + (hasLoaded ? ' Previously loaded responses are still shown. Try Refresh responses again.' : ''));
    $('results-status').dataset.state = 'error';
  } finally {
    $('results-status').setAttribute('aria-busy', 'false');
    busy = false; $('refresh-results').disabled = false;
  }
}
function csvValue(value) {
  let text = String(value ?? '');
  if (/^\s*[=+@\u002d]|^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
$('export-results').addEventListener('click', () => {
  const rows = [['Name', 'Favourite', 'Saved', ...designs.map(d => 'Design ' + d.label), 'Overall comments'],
    ...responses.map(r => [r.reviewerName, r.favourite ? label(r.favourite) : '', r.updatedAt, ...designs.map(d => r.comments?.[d.id] || ''), r.generalComment || ''])];
  const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvValue).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = element('a');
  link.href = url; link.download = 'trades-hall-card-feedback-' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('refresh-results').addEventListener('click', refresh);
refresh();
