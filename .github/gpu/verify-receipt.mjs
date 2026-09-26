import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Versioned contract for the reviewed 2026-09-15 benchmark. No network or publisher.
export const POLICY = Object.freeze({
  version: 'venviewer-twin-gpu-v2',
  repository: 'codemaker66/omnitwin',
  benchmarkSha256: '3560350f52bc0db11331a545d07df87d55ba86cdef9426b719b4a0a6fa3a2d15',
  budgets: Object.freeze({ appBytes: 21000000, arrivalImageryBytes: 140000,
    arrivalPanoRequests: 7, hopImageryBytes: 360000, hopPanoRequests: 18,
    hopLongTaskMs: 150, p95Ms: 20, sustainedStalls: 1, droppedFrameMs: 33.4,
    sampleMs: 1200, minimumIntervalsExclusive: 20, cameraDelta: 1e-7 }),
  quality: Object.freeze({ viewport: [1440, 900], dpr: 1, panorama: [4096, 2048],
    preview: [512, 256], effects: 'source-default', dollhouseFixture: 'empty-glb',
    webServerMode: 'dev', launchArgs: ['--use-gl=angle', '--use-angle=gl',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }),
});
export const CASES = Object.freeze([
  ['the arrival at a validated viewpoint stays inside its byte budget', 'arrival-bytes.json'],
  ['a hop between rooms neither floods the network nor blocks the main thread', 'hop.json'],
  ['looking around the pano holds its frame pacing', 'walk-look-frames.json'],
  ['orbiting the dollhouse holds its frame pacing', 'orbit-frames.json'],
  ['the fixture the budgets were measured against still holds', null],
]);
for (const value of Object.values(POLICY.quality)) if (Array.isArray(value)) Object.freeze(value);
for (const value of CASES) Object.freeze(value);
const MAX_JSON_BYTES = 20 * 1024 * 1024;
const REQUIRED_SOURCES = ['package.json', 'pnpm-lock.yaml', 'packages/web/package.json',
  'packages/web/playwright.config.ts', 'packages/web/e2e/twin-performance.spec.ts',
  'packages/web/src/twin/__fixtures__/twin-fixture.ts',
  'packages/web/src/twin/shell/twin-rooms.ts', 'packages/web/src/twin/twin-copy.ts'];
const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const requireThat = (ok, path, message) => { if (!ok) fail(path, message); };
const record = (value, path) => {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
  requireThat(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    path, 'unexpected object prototype');
  return value;
};
const exactKeys = (value, keys, path) => {
  record(value, path);
  requireThat(Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'), path, 'missing or unknown fields');
};
const array = (value, path, min = 0, max = 20000) => {
  requireThat(Array.isArray(value) && value.length >= min && value.length <= max, path, 'invalid array length');
  for (let i = 0; i < value.length; i++) requireThat(Object.hasOwn(value, i), path, 'sparse arrays are forbidden');
  return value;
};
const number = (value, path, min = 0, max = Number.MAX_SAFE_INTEGER, integer = false) => {
  requireThat(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isSafeInteger(value)), path, 'invalid finite number');
  return value;
};
const text = (value, path, pattern = /^[^\x00-\x1f]{1,512}$/u) => {
  requireThat(typeof value === 'string' && pattern.test(value), path, 'invalid string'); return value;
};
const hash = (value, path, width = 64) => text(value, path, new RegExp(`^[0-9a-f]{${width}}$`, 'u'));
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const same = (actual, expected, path) => requireThat(canonical(actual) === canonical(expected), path, 'mismatch');
const empty = (value, path) => array(value, path, 0, 0);
const iso = (value, path) => {
  text(value, path, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  const result = Date.parse(value);
  requireThat(Number.isFinite(result) && new Date(result).toISOString() === value, path, 'invalid UTC instant');
  return result;
};
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** JSON.parse alone silently accepts duplicate keys. Reject ambiguity and deep input first. */
export function parseJson(bytes, path = 'json') {
  requireThat(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_JSON_BYTES, path, 'invalid JSON byte length');
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
  const parsed = JSON.parse(raw); // Establish the JSON grammar; scanner below checks duplicate keys.
  let at = 0;
  const white = () => { while (/\s/u.test(raw[at] ?? '') && at < raw.length) at++; };
  const string = () => {
    const start = at++;
    while (at < raw.length) { const char = raw[at++]; if (char === '\\') at++; else if (char === '"') break; }
    return JSON.parse(raw.slice(start, at));
  };
  function scan(depth) {
    requireThat(depth < 64, path, 'JSON nesting limit'); white();
    if (raw[at] === '"') { string(); return; }
    if (raw[at] === '{') {
      at++; white(); const keys = new Set();
      if (raw[at] === '}') { at++; return; }
      for (;;) { white(); const key = string(); requireThat(!keys.has(key), path, `duplicate key ${key}`);
        keys.add(key); white(); at++; scan(depth + 1); white(); if (raw[at++] === '}') break; }
      return;
    }
    if (raw[at] === '[') {
      at++; white(); if (raw[at] === ']') { at++; return; }
      for (;;) { scan(depth + 1); white(); if (raw[at++] === ']') break; }
      return;
    }
    while (at < raw.length && !/[\s,\]}]/u.test(raw[at])) at++;
  }
  scan(0); white(); requireThat(at === raw.length, path, 'trailing data'); return parsed;
}

function validateSource(source, path) {
  exactKeys(source, ['repository', 'commitSha', 'treeSha', 'sourceHashes'], path);
  same(source.repository, POLICY.repository, `${path}.repository`);
  hash(source.commitSha, `${path}.commitSha`, 40); hash(source.treeSha, `${path}.treeSha`, 40);
  record(source.sourceHashes, `${path}.sourceHashes`);
  const entries = Object.entries(source.sourceHashes);
  requireThat(entries.length >= REQUIRED_SOURCES.length && entries.length <= 50000, path, 'expected complete reviewed source manifest');
  for (const [file, digest] of entries) {
    text(file, `${path}.source path`, /^[^\x00-\x1f\\:]{1,1024}$/u);
    requireThat(file.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), path, 'noncanonical source path');
    hash(digest, `${path}.sourceHashes[${file}]`);
  }
  for (const file of REQUIRED_SOURCES) requireThat(Object.hasOwn(source.sourceHashes, file), path, `missing reviewed source ${file}`);
  same(source.sourceHashes['packages/web/e2e/twin-performance.spec.ts'], POLICY.benchmarkSha256, path);
}
function validateRuntime(runtime, path) {
  exactKeys(runtime, ['node', 'playwright', 'chromium', 'os', 'driver'], path);
  for (const key of ['node', 'playwright', 'chromium']) text(runtime[key], `${path}.${key}`, /^\d+\.\d+\.\d+(?:\.\d+)?$/u);
  text(runtime.os, `${path}.os`); text(runtime.driver, `${path}.driver`);
}
function validateAdapter(renderer, path) {
  text(renderer, path);
  requireThat(!/swiftshader|llvmpipe|softpipe|software|\bwarp\b|microsoft basic|lavapipe/iu.test(renderer), path, 'software adapter forbidden');
  requireThat(/nvidia|radeon|\bamd\b|\bintel\b|apple/iu.test(renderer), path, 'unrecognized hardware adapter');
}
const intervals = (times) => times.slice(1).map((time, index) => time - times[index]);
const percentile95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(0.95 * values.length) - 1];
const longestRun = (values) => {
  let longest = 0, current = 0;
  for (const value of values) { current = value > POLICY.budgets.droppedFrameMs ? current + 1 : 0; longest = Math.max(longest, current); }
  return longest;
};
const quarters = (times, start, duration) => {
  const counts = [0, 0, 0, 0];
  for (const time of times) counts[Math.min(3, Math.floor(((time - start) / duration) * 4))]++;
  return counts;
};
function times(value, path, start, end, min, { strict = false, leadingFrameTimestamp = false } = {}) {
  array(value, path, min);
  value.forEach((time, index) => {
    // RAF's first frame timestamp can precede pointerdown's performance.now()
    // even though the pinned producer records the callback only while native
    // input owns the sample. Only that first timestamp may lead the boundary;
    // its interval is retained in all cadence metrics, with no time tolerance.
    number(time, `${path}[${index}]`, leadingFrameTimestamp && index === 0 ? 0 : start, end);
    if (index > 0) requireThat(strict ? time > value[index - 1] : time >= value[index - 1], path,
      strict ? 'timestamps must be strictly increasing' : 'timestamps must be monotonic');
  }); return value;
}
function near(actual, expected, path) {
  number(actual, path);
  requireThat(Math.abs(actual - expected) <= 1e-6, path, 'claimed metric disagrees with raw samples');
}
function motion(measured, renderer, path, caseDuration) {
  const metrics = ['frameCount', 'p95Ms', 'maxMs', 'droppedFrames', 'longestSustainedStall',
    'rafFrameCount', 'rafP95Ms', 'rafLongestSustainedStall', 'activeDurationMs', 'submittedRenderCount',
    'cameraChangeCount', 'inputMovesPerQuarter', 'drawsPerQuarter', 'cameraChangesPerQuarter',
    'renderIntervalsMs', 'rafIntervalsMs', 'sample'];
  exactKeys(measured, metrics, path);
  const sample = measured.sample;
  exactKeys(sample, ['startedAtMs', 'endedAtMs', 'rafTimesMs', 'renders', 'trustedPointerMoveTimesMs',
    'renderer', 'pixelRatio', 'drawingBuffer', 'contextLost', 'canvasReplaced'], `${path}.sample`);
  const start = number(sample.startedAtMs, `${path}.start`), end = number(sample.endedAtMs, `${path}.end`, start);
  const duration = end - start;
  requireThat(duration >= POLICY.budgets.sampleMs, path, 'native drag sample is too short');
  requireThat(duration <= caseDuration, path, 'sample exceeds its test execution duration');
  same(sample.contextLost, false, path); same(sample.canvasReplaced, false, path);
  validateAdapter(sample.renderer, `${path}.renderer`); same(sample.renderer, renderer, `${path}.renderer`);
  same(sample.pixelRatio, POLICY.quality.dpr, `${path}.dpr`);
  same(sample.drawingBuffer, POLICY.quality.viewport, `${path}.drawingBuffer`);
  const raf = times(sample.rafTimesMs, `${path}.rafTimesMs`, start, end, 22, { strict: true, leadingFrameTimestamp: true });
  const input = times(sample.trustedPointerMoveTimesMs, `${path}.input`, start, end, 4);
  array(sample.renders, `${path}.renders`, 22);
  const cameraTimes = [], renderTimes = [];
  sample.renders.forEach((frame, index) => {
    exactKeys(frame, ['atMs', 'frameAdvance', 'drawCalls', 'cameraWorldMatrix'], `${path}.renders[${index}]`);
    number(frame.atMs, `${path}.render time`, start, end);
    same(frame.frameAdvance, 1, `${path}.frameAdvance`); number(frame.drawCalls, `${path}.drawCalls`, 1, Number.MAX_SAFE_INTEGER, true);
    array(frame.cameraWorldMatrix, `${path}.cameraWorldMatrix`, 16, 16);
    frame.cameraWorldMatrix.forEach((value) => number(value, `${path}.camera component`, -1e12, 1e12));
    for (const component of [3, 7, 11]) requireThat(Math.abs(frame.cameraWorldMatrix[component]) <= 1e-6, path, 'camera matrix must be affine');
    requireThat(Math.abs(frame.cameraWorldMatrix[15] - 1) <= 1e-6, path, 'camera matrix must be affine');
    const matrix = frame.cameraWorldMatrix;
    for (let axis = 0; axis < 3; axis++) for (let other = axis; other < 3; other++) {
      let dot = 0;
      for (let component = 0; component < 3; component++) dot += matrix[axis * 4 + component] * matrix[other * 4 + component];
      requireThat(Math.abs(dot - (axis === other ? 1 : 0)) <= 1e-3, path, 'camera matrix must contain a rigid orientation');
    }
    renderTimes.push(frame.atMs);
    if (index > 0 && frame.cameraWorldMatrix.some((value, component) =>
      Math.abs(value - sample.renders[index - 1].cameraWorldMatrix[component]) > POLICY.budgets.cameraDelta)) cameraTimes.push(frame.atMs);
  });
  times(renderTimes, `${path}.renderTimes`, start, end, 22, { strict: true });
  const frames = intervals(renderTimes), rafFrames = intervals(raf);
  const calculated = { frameCount: frames.length, p95Ms: percentile95(frames), maxMs: Math.max(...frames),
    droppedFrames: frames.filter((value) => value > POLICY.budgets.droppedFrameMs).length,
    longestSustainedStall: longestRun(frames), rafFrameCount: rafFrames.length,
    rafP95Ms: percentile95(rafFrames), rafLongestSustainedStall: longestRun(rafFrames),
    activeDurationMs: duration, submittedRenderCount: renderTimes.length, cameraChangeCount: cameraTimes.length,
    inputMovesPerQuarter: quarters(input, start, duration), drawsPerQuarter: quarters(renderTimes, start, duration),
    cameraChangesPerQuarter: quarters(cameraTimes, start, duration), renderIntervalsMs: frames, rafIntervalsMs: rafFrames };
  const counters = new Set(['frameCount', 'droppedFrames', 'longestSustainedStall', 'rafFrameCount',
    'rafLongestSustainedStall', 'submittedRenderCount', 'cameraChangeCount']);
  for (const [key, value] of Object.entries(calculated)) {
    if (Array.isArray(value)) { array(measured[key], `${path}.${key}`, value.length, value.length);
      measured[key].forEach((item, index) => {
        if (key.endsWith('PerQuarter')) number(item, `${path}.${key}[${index}]`, 0, Number.MAX_SAFE_INTEGER, true);
        near(item, value[index], `${path}.${key}[${index}]`);
      });
    } else {
      if (counters.has(key)) number(measured[key], `${path}.${key}`, 0, Number.MAX_SAFE_INTEGER, true);
      near(measured[key], value, `${path}.${key}`);
    }
  }
  for (const key of ['frameCount', 'rafFrameCount', 'cameraChangeCount']) requireThat(calculated[key] > 20, path, `${key} must exceed 20`);
  for (const key of ['inputMovesPerQuarter', 'drawsPerQuarter', 'cameraChangesPerQuarter'])
    requireThat(calculated[key].every((value) => value > 0), path, `${key} must cover all four quarters`);
  for (const key of ['p95Ms', 'rafP95Ms']) requireThat(calculated[key] <= POLICY.budgets.p95Ms, path, `${key} exceeds unchanged 20 ms budget`);
  for (const key of ['longestSustainedStall', 'rafLongestSustainedStall'])
    requireThat(calculated[key] <= POLICY.budgets.sustainedStalls, path, `${key} exceeds unchanged limit 1`);
  return calculated;
}
function attachment(result, name, path) {
  const attachments = array(result.attachments, `${path}.attachments`, name === null ? 0 : 1, name === null ? 0 : 1);
  if (name === null) return null;
  const found = attachments[0]; exactKeys(found, ['name', 'contentType', 'body'], path);
  same(found.name, name, path); same(found.contentType, 'application/json', path);
  text(found.body, `${path}.base64`, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
  const bytes = Buffer.from(found.body, 'base64');
  requireThat(bytes.length > 0 && bytes.toString('base64') === found.body, path, 'noncanonical base64 attachment');
  return parseJson(bytes, `${path}.${name}`);
}
function ledger(value, kind) {
  exactKeys(value, kind === 'arrival' ? ['imageryBytes', 'appBytes', 'panoRequests']
    : ['imageryBytes', 'appBytes', 'panoRequests', 'longTaskCount', 'longestTaskMs'], kind);
  for (const key of ['imageryBytes', 'appBytes', 'panoRequests']) number(value[key], `${kind}.${key}`, 0, Number.MAX_SAFE_INTEGER, true);
  requireThat(value.imageryBytes > 0 && value.panoRequests > 0, kind, 'empty byte/request observation');
  if (kind === 'arrival') {
    requireThat(value.appBytes > 0 && value.appBytes <= POLICY.budgets.appBytes, kind, 'app byte budget');
    requireThat(value.imageryBytes <= POLICY.budgets.arrivalImageryBytes && value.panoRequests <= POLICY.budgets.arrivalPanoRequests, kind, 'arrival budget');
  } else {
    requireThat(value.imageryBytes <= POLICY.budgets.hopImageryBytes && value.panoRequests <= POLICY.budgets.hopPanoRequests, kind, 'hop byte/request budget');
    number(value.longTaskCount, 'hop.longTaskCount', 0, Number.MAX_SAFE_INTEGER, true);
    number(value.longestTaskMs, 'hop.longestTaskMs', 0, POLICY.budgets.hopLongTaskMs);
    requireThat(value.longTaskCount === 0 ? value.longestTaskMs === 0 : value.longestTaskMs >= 50,
      kind, 'inconsistent Long Tasks API count/maximum');
  }
  return value;
}

/** Pure local validation. trusted MUST come from the caller's independent controller. */
export function verifyReceipt({ trusted, receipt, resultsBytes }) {
  exactKeys(trusted, ['schemaVersion', 'source', 'runNonce', 'renderer', 'runtime'], 'trusted');
  same(trusted.schemaVersion, 1, 'trusted.schemaVersion'); validateSource(trusted.source, 'trusted.source');
  text(trusted.runNonce, 'trusted.runNonce', /^[A-Za-z0-9_-]{24,128}$/u);
  validateAdapter(trusted.renderer, 'trusted.renderer'); validateRuntime(trusted.runtime, 'trusted.runtime');
  exactKeys(receipt, ['schemaVersion', 'policyVersion', 'source', 'runNonce', 'renderer', 'runtime',
    'quality', 'budgets', 'run', 'resultsSha256'], 'receipt');
  same(receipt.schemaVersion, 1, 'receipt.schemaVersion'); same(receipt.policyVersion, POLICY.version, 'receipt.policyVersion');
  validateSource(receipt.source, 'receipt.source'); same(receipt.source, trusted.source, 'receipt.source');
  same(receipt.runNonce, trusted.runNonce, 'receipt.runNonce');
  same(receipt.renderer, trusted.renderer, 'receipt.renderer'); same(receipt.runtime, trusted.runtime, 'receipt.runtime');
  same(receipt.quality, POLICY.quality, 'receipt.quality'); same(receipt.budgets, POLICY.budgets, 'receipt.budgets');
  exactKeys(receipt.run, ['workers', 'retries', 'repeatEach', 'exitCode', 'exclusive', 'startedAt', 'endedAt', 'elapsedMs'], 'receipt.run');
  for (const [key, expected] of Object.entries({workers: 1, retries: 0, repeatEach: 1, exitCode: 0, exclusive: true}))
    same(receipt.run[key], expected, `receipt.run.${key}`);
  const runStart = iso(receipt.run.startedAt, 'receipt.run.startedAt'), runEnd = iso(receipt.run.endedAt, 'receipt.run.endedAt');
  requireThat(runEnd > runStart, 'receipt.run', 'invalid run interval');
  const runElapsed = number(receipt.run.elapsedMs, 'receipt.run.elapsedMs', Number.MIN_VALUE);
  hash(receipt.resultsSha256, 'receipt.resultsSha256'); same(sha256(resultsBytes), receipt.resultsSha256, 'receipt.resultsSha256');
  const results = parseJson(resultsBytes, 'results'); record(results, 'results');
  empty(results.errors, 'results.errors'); record(results.config, 'config');
  same(results.config.workers, 1, 'config.workers'); same(results.config.metadata.actualWorkers, 1, 'config.actualWorkers');
  same(results.config.forbidOnly, true, 'config.forbidOnly'); same(results.config.shard, null, 'config.shard');
  same(results.config.updateSnapshots, 'none', 'config.updateSnapshots'); same(results.config.version, trusted.runtime.playwright, 'config.version');
  same(results.config.grep, {}, 'config.grep'); same(results.config.grepInvert, null, 'config.grepInvert');
  same(results.config.maxFailures, 0, 'config.maxFailures'); empty(results.config.tags, 'config.tags');
  array(results.config.projects, 'config.projects', 1, 1);
  const project = results.config.projects[0]; record(project, 'config.project');
  same(project.id, 'chromium', 'project.id'); same(project.name, 'chromium', 'project.name');
  same(project.repeatEach, 1, 'project.repeatEach'); same(project.retries, 0, 'project.retries'); empty(project.testIgnore, 'project.testIgnore');
  const flat = [];
  function flatten(suite, depth) {
    requireThat(depth < 20, 'suites', 'excessive nesting'); record(suite, 'suite');
    if (suite.specs !== undefined) for (const spec of array(suite.specs, 'suite.specs', 0, 5)) flat.push(spec);
    if (suite.suites !== undefined) for (const child of array(suite.suites, 'suite.suites', 0, 5)) flatten(child, depth + 1);
  }
  for (const suite of array(results.suites, 'results.suites', 1, 5)) flatten(suite, 0);
  requireThat(flat.length === 5, 'results', 'exactly five scheduled cases are required');
  const identities = new Set(), payloads = new Map(), durations = new Map(), timeline = [];
  for (const spec of flat) {
    record(spec, 'spec'); text(spec.title, 'spec.title');
    requireThat(spec.file === 'twin-performance.spec.ts', 'spec.file', 'unexpected file');
    const expected = CASES.find(([title]) => title === spec.title);
    requireThat(expected !== undefined && !identities.has(spec.title), 'spec.title', 'unknown or duplicate case');
    identities.add(spec.title); same(spec.ok, true, spec.title); empty(spec.tags, `${spec.title}.tags`);
    array(spec.tests, 'spec.tests', 1, 1); const test = spec.tests[0]; record(test, spec.title);
    same(test.projectId, 'chromium', spec.title); same(test.projectName, 'chromium', spec.title);
    same(test.status, 'expected', spec.title); same(test.expectedStatus, 'passed', spec.title);
    empty(test.annotations, `${spec.title}.annotations`); array(test.results, `${spec.title}.results`, 1, 1);
    const result = test.results[0]; record(result, spec.title);
    same(result.status, 'passed', spec.title); same(result.retry, 0, spec.title);
    empty(result.errors, `${spec.title}.errors`); empty(result.annotations, `${spec.title}.result.annotations`);
    number(result.workerIndex, 'workerIndex', 0, Number.MAX_SAFE_INTEGER, true); same(result.parallelIndex, 0, 'parallelIndex');
    const start = iso(result.startTime, 'result.startTime'), duration = number(result.duration, 'result.duration', 1);
    requireThat(start >= runStart && start <= runEnd, 'result', 'case start outside claimed run interval');
    timeline.push({start, duration, worker: result.workerIndex});
    payloads.set(expected[1], attachment(result, expected[1], spec.title));
    durations.set(expected[1], duration);
  }
  requireThat(new Set(timeline.map((test) => test.worker)).size === 1, 'results', 'multiple worker processes');
  record(results.stats, 'stats');
  for (const [key, expected] of Object.entries({expected: 5, skipped: 0, unexpected: 0, flaky: 0})) same(results.stats[key], expected, `stats.${key}`);
  const statsStart = iso(results.stats.startTime, 'stats.startTime');
  const statsDuration = number(results.stats.duration, 'stats.duration', 1);
  requireThat(statsStart >= runStart && statsStart <= runEnd, 'stats', 'report start outside run interval');
  requireThat(timeline.every((test) => test.start >= statsStart), 'stats', 'report start follows a case start');
  // Playwright 1.59.1 records Date.now() starts but measures durations with
  // performance.now(). Adding them creates unobserved wall-clock ends when
  // the system clock adjusts. Its single worker awaits each test, so compare
  // accumulated case durations with the report and controller's monotonic
  // elapsed time. Wall timestamps above remain explicit freshness bounds.
  const caseDurationTotal = timeline.reduce((total, test) => total + test.duration, 0);
  requireThat(caseDurationTotal <= statsDuration, 'stats', 'case durations exceed report duration');
  requireThat(statsDuration <= runElapsed, 'stats', 'report duration exceeds controller elapsedMs');
  const arrival = ledger(payloads.get('arrival-bytes.json'), 'arrival');
  const hop = ledger(payloads.get('hop.json'), 'hop');
  const walk = motion(payloads.get('walk-look-frames.json'), trusted.renderer, 'walk', durations.get('walk-look-frames.json'));
  const orbit = motion(payloads.get('orbit-frames.json'), trusted.renderer, 'orbit', durations.get('orbit-frames.json'));
  return { schemaVersion: 1, verdict: 'offline-evidence-consistent', policyVersion: POLICY.version,
    commitSha: trusted.source.commitSha, treeSha: trusted.source.treeSha, runNonce: trusted.runNonce,
    resultsSha256: receipt.resultsSha256, sourceManifestSha256: sha256(canonical(trusted.source.sourceHashes)),
    casesPassedOnce: 5, renderer: trusted.renderer, arrival, hop, walk, orbit,
    limitations: ['No worker authentication, signature verification, nonce issuance/replay store, or GitHub status/check enforcement.',
      'Source SHA/tree/completeness, runtime, exclusivity, monotonic child elapsedMs and texture/effect declarations must be established by an independent trusted controller.',
      'Motion metrics are recomputed from returned renderer submissions and RAF, not GPU completion or physical presentation.',
      'Arrival/hop receipts contain aggregates, not raw network/Long Task entries; maxima and counts cannot be independently reconstructed.',
      'Empty-GLB dollhouse geometry, physical-device targets, reconstruction PSNR and aesthetic acceptance remain outside this evidence.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireThat(process.argv.length === 5, 'usage', 'node verify-receipt.mjs <trusted.json> <receipt.json> <results.json>');
    const read = (file) => { // Explicit caller paths only; receipt paths are never dereferenced.
      const info = statSync(file);
      requireThat(info.isFile() && info.size > 0 && info.size <= MAX_JSON_BYTES, 'input file', 'invalid file size/type');
      return readFileSync(file);
    };
    const trusted = parseJson(read(process.argv[2]), 'trusted'), receipt = parseJson(read(process.argv[3]), 'receipt');
    process.stdout.write(`${JSON.stringify(verifyReceipt({trusted, receipt, resultsBytes: read(process.argv[4])}), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`GPU receipt rejected: ${error instanceof Error ? error.message : 'invalid evidence'}\n`);
    process.exitCode = 1;
  }
}
