import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CASES, POLICY, parseJson, sha256, verifyReceipt } from './verify-receipt.mjs';

// The raw browser report is retained evidence. All identity fields below are
// explicitly SYNTHETIC unit-fixture values, never a qualification of a real SHA.
// The controller elapsedMs below is also synthetic and derived only for these
// tests; no missing historical controller measurement is being reconstructed.
const retained = readFileSync(new URL('./fixtures/retained-rtx4090-results.json', import.meta.url));
const renderer = 'ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 4090), OpenGL 4.6)';
const copy = (value) => structuredClone(value);
function fixture() {
  const results = parseJson(retained);
  const paths = ['package.json', 'pnpm-lock.yaml', 'packages/web/package.json',
    'packages/web/playwright.config.ts', 'packages/web/e2e/twin-performance.spec.ts',
    'packages/web/src/twin/__fixtures__/twin-fixture.ts',
    'packages/web/src/twin/shell/twin-rooms.ts', 'packages/web/src/twin/twin-copy.ts'];
  const sourceHashes = Object.fromEntries(paths.map((path) => [path, 'c'.repeat(64)]));
  sourceHashes['packages/web/e2e/twin-performance.spec.ts'] = POLICY.benchmarkSha256;
  const trusted = { schemaVersion: 1,
    source: {repository: POLICY.repository, commitSha: '1'.repeat(40), treeSha: '2'.repeat(40), sourceHashes},
    runNonce: 'SYNTHETIC_TEST_NONCE_DO_NOT_PUBLISH', renderer,
    runtime: {node: '22.23.2', playwright: '1.59.1', chromium: '147.0.7727.15',
      os: 'synthetic-test-linux', driver: 'synthetic-test-driver'} };
  const start = Date.parse(results.stats.startTime);
  const receipt = {schemaVersion: 1, policyVersion: POLICY.version, source: copy(trusted.source),
    runNonce: trusted.runNonce, renderer, runtime: copy(trusted.runtime),
    quality: copy(POLICY.quality), budgets: copy(POLICY.budgets),
    run: {workers: 1, retries: 0, repeatEach: 1, exitCode: 0, exclusive: true,
      startedAt: new Date(start - 1000).toISOString(),
      endedAt: new Date(Math.ceil(start + results.stats.duration + 1000)).toISOString(),
      elapsedMs: results.stats.duration + 2000},
    resultsSha256: sha256(retained)};
  return {trusted, receipt, results, resultsBytes: retained};
}
function pack(f) {
  f.resultsBytes = Buffer.from(JSON.stringify(f.results));
  f.receipt.resultsSha256 = sha256(f.resultsBytes);
  return f;
}
const specs = (f) => f.results.suites[0].specs;
const result = (f, index) => specs(f)[index].tests[0].results[0];
function changeAttachment(f, index, change) {
  const attachment = result(f, index).attachments[0];
  const value = parseJson(Buffer.from(attachment.body, 'base64'));
  change(value);
  attachment.body = Buffer.from(JSON.stringify(value)).toString('base64');
}
function rejects(name, change, pattern) {
  test(name, () => { const f = fixture(); change(f); pack(f);
    assert.throws(() => verifyReceipt(f), pattern); });
}

test('retained hardware samples pass only with a separate synthetic trusted fixture contract', () => {
  const verdict = verifyReceipt(fixture());
  assert.equal(verdict.verdict, 'offline-evidence-consistent');
  assert.equal(verdict.casesPassedOnce, 5);
  assert.equal(verdict.walk.frameCount, 68);
  assert.equal(verdict.orbit.frameCount, 66);
  assert.ok(Math.abs(verdict.walk.p95Ms - 17.1) < 1e-6);
  assert.equal(verdict.orbit.p95Ms, 17.5);
  assert.equal(verdict.walk.longestSustainedStall, 1);
  assert.equal(verdict.orbit.longestSustainedStall, 1);
  assert.equal(verdict.limitations.length, 5);
});
test('historic JSON alone is not an exact-source receipt', () => {
  assert.throws(() => verifyReceipt({trusted: fixture().trusted, receipt: {}, resultsBytes: retained}), /receipt.*fields/u);
});
rejects('rejects different commit', f => { f.receipt.source.commitSha = '3'.repeat(40); }, /receipt.source.*mismatch/u);
rejects('rejects different tree', f => { f.receipt.source.treeSha = '3'.repeat(40); }, /receipt.source.*mismatch/u);
rejects('rejects changed source bytes', f => { f.receipt.source.sourceHashes['pnpm-lock.yaml'] = '4'.repeat(64); }, /receipt.source.*mismatch/u);
rejects('rejects absent required source', f => { delete f.receipt.source.sourceHashes['pnpm-lock.yaml']; }, /source manifest|missing reviewed source/u);
rejects('rejects unreviewed benchmark even when the two envelopes agree', f => {
  f.receipt.source.sourceHashes['packages/web/e2e/twin-performance.spec.ts'] = '5'.repeat(64);
  f.trusted.source.sourceHashes['packages/web/e2e/twin-performance.spec.ts'] = '5'.repeat(64);
}, /trusted.source.*mismatch/u);
rejects('rejects stale or different run nonce', f => { f.receipt.runNonce = 'DIFFERENT_NONCE_FROM_ANOTHER_RUN'; }, /runNonce.*mismatch/u);
rejects('rejects fifth case omitted', f => { specs(f).pop(); }, /exactly five/u);
rejects('rejects duplicate replacement case', f => { specs(f)[4] = copy(specs(f)[0]); }, /duplicate case/u);
rejects('rejects another file masquerading under the same title', f => { specs(f)[0].file = 'other.spec.ts'; }, /unexpected file/u);
rejects('rejects skipped case', f => { specs(f)[0].tests[0].status = 'skipped'; }, /mismatch/u);
rejects('rejects expected failure as a passing check', f => { specs(f)[0].tests[0].expectedStatus = 'failed'; }, /mismatch/u);
rejects('rejects hidden annotation', f => { result(f, 0).annotations.push({type: 'fail'}); }, /array length/u);
rejects('rejects retry success or extra attempts', f => { specs(f)[0].tests[0].results.push(copy(result(f, 0))); }, /array length/u);
rejects('rejects unexecuted listed case', f => { specs(f)[0].tests[0].results = []; }, /array length/u);
rejects('rejects flaky aggregate despite case claims', f => { f.results.stats.flaky = 1; }, /stats.flaky/u);
rejects('rejects missing named raw attachment', f => { result(f, 2).attachments = []; }, /attachments.*array length/u);
rejects('rejects attachment paths instead of embedded raw data', f => {
  result(f, 2).attachments[0] = {name: 'walk-look-frames.json', contentType: 'application/json', path: '/untrusted/path'};
}, /missing or unknown fields/u);
rejects('rejects invalid base64', f => { result(f, 2).attachments[0].body = '!!!'; }, /invalid string/u);
rejects('rejects software reported by either motion test', f => {
  changeAttachment(f, 3, m => { m.sample.renderer = 'ANGLE (Google, Vulkan SwiftShader Device, OpenGL ES 3.0)'; });
}, /software adapter/u);
rejects('rejects software even if caller accidentally approves its string', f => {
  f.trusted.renderer = f.receipt.renderer = 'ANGLE (Mesa, llvmpipe, OpenGL 4.5)';
}, /software adapter/u);
rejects('rejects two different hardware adapters', f => {
  changeAttachment(f, 3, m => { m.sample.renderer = 'ANGLE (NVIDIA GeForce RTX 3090, OpenGL 4.6)'; });
}, /orbit.renderer.*mismatch/u);
rejects('rejects reduced drawing resolution', f => {
  changeAttachment(f, 2, m => { m.sample.drawingBuffer = [720, 450]; });
}, /drawingBuffer.*mismatch/u);
rejects('rejects changed DPR', f => { changeAttachment(f, 2, m => { m.sample.pixelRatio = 0.5; }); }, /dpr.*mismatch/u);
rejects('rejects weaker declared budgets', f => { f.receipt.budgets.p95Ms = 21; }, /receipt.budgets/u);
rejects('rejects smaller declared panorama', f => { f.receipt.quality.panorama = [2048, 1024]; }, /receipt.quality/u);
rejects('rejects missing quarter of native input', f => {
  changeAttachment(f, 2, m => {
    const s = m.sample; const boundary = s.startedAtMs + (s.endedAtMs - s.startedAtMs) / 4;
    s.trustedPointerMoveTimesMs = s.trustedPointerMoveTimesMs.filter(t => t >= boundary);
    m.inputMovesPerQuarter[0] = 0;
  });
}, /inputMovesPerQuarter must cover all four/u);
rejects('rejects idle camera matrices', f => {
  changeAttachment(f, 2, m => { const matrix = m.sample.renders[0].cameraWorldMatrix;
    m.sample.renders.forEach(frame => { frame.cameraWorldMatrix = copy(matrix); });
    m.cameraChangeCount = 0; m.cameraChangesPerQuarter = [0, 0, 0, 0]; });
}, /cameraChangeCount must exceed/u);
rejects('rejects zero actual draws', f => { changeAttachment(f, 2, m => { m.sample.renders[0].drawCalls = 0; }); }, /drawCalls/u);
rejects('rejects cumulative or multiple renderer frame advances', f => { changeAttachment(f, 2, m => { m.sample.renders[0].frameAdvance = 2; }); }, /frameAdvance/u);
rejects('rejects missing camera components', f => { changeAttachment(f, 2, m => { m.sample.renders[0].cameraWorldMatrix.pop(); }); }, /cameraWorldMatrix/u);
rejects('rejects malformed nonfinite camera data', f => { changeAttachment(f, 2, m => { m.sample.renders[0].cameraWorldMatrix[0] = null; }); }, /camera component/u);
rejects('rejects returned renders before native pointerdown', f => { changeAttachment(f, 2, m => { m.sample.renders[0].atMs = m.sample.startedAtMs - 1; }); }, /render time.*invalid finite/u);
rejects('rejects too-short native drag', f => { changeAttachment(f, 2, m => { m.sample.endedAtMs = m.sample.startedAtMs + 1199; }); }, /too short/u);
rejects('rejects spoofed lower p95 summary', f => { changeAttachment(f, 2, m => { m.p95Ms = 1; }); }, /disagrees with raw/u);
rejects('rejects altered interval summary', f => { changeAttachment(f, 2, m => { m.renderIntervalsMs[0] += 1; }); }, /disagrees with raw/u);
rejects('rejects lost context', f => { changeAttachment(f, 2, m => { m.sample.contextLost = true; }); }, /mismatch/u);
rejects('rejects replaced canvas', f => { changeAttachment(f, 2, m => { m.sample.canvasReplaced = true; }); }, /mismatch/u);
rejects('rejects excess hop long task', f => { changeAttachment(f, 1, m => { m.longTaskCount = 1; m.longestTaskMs = 150.1; }); }, /hop.longestTaskMs/u);
rejects('rejects impossible zero-duration long task claim', f => { changeAttachment(f, 1, m => { m.longTaskCount = 1; m.longestTaskMs = 0; }); }, /inconsistent Long Tasks/u);
rejects('rejects excess imagery budget', f => { changeAttachment(f, 0, m => { m.imageryBytes = 140001; }); }, /arrival budget/u);
rejects('rejects missing measurement replaced by all zeroes', f => { changeAttachment(f, 0, m => { m.imageryBytes = 0; m.appBytes = 0; m.panoRequests = 0; }); }, /empty byte/u);
rejects('rejects concurrent worker configuration', f => { f.results.config.workers = 2; }, /config.workers/u);
rejects('rejects retry-enabled project', f => { f.results.config.projects[0].retries = 1; }, /project.retries/u);
rejects('rejects multiple worker processes despite single-worker configuration', f => {
  result(f, 1).workerIndex = result(f, 0).workerIndex + 1;
}, /multiple worker processes/u);
rejects('rejects report-level errors', f => { f.results.errors.push({message: 'worker terminated'}); }, /results.errors/u);
test('rejects digest mismatch before interpreting any result claims', () => {
  const f = fixture(); f.receipt.resultsSha256 = 'a'.repeat(64);
  assert.throws(() => verifyReceipt(f), /resultsSha256.*mismatch/u);
});
test('strict JSON rejects duplicate and escaped duplicate keys', () => {
  for (const raw of ['{"sha":1,"sha":2}', '{"nested":{"sha":1,"sh\\u0061":2}}'])
    assert.throws(() => parseJson(Buffer.from(raw)), /duplicate key/u);
});
test('strict JSON rejects invalid UTF-8, trailing data, deep nesting and oversized input', () => {
  assert.throws(() => parseJson(Buffer.from([0xc3, 0x28])));
  assert.throws(() => parseJson(Buffer.from('{} false')));
  assert.throws(() => parseJson(Buffer.from('['.repeat(65) + '0' + ']'.repeat(65))), /nesting/u);
  assert.throws(() => parseJson(Buffer.alloc(20 * 1024 * 1024 + 1)), /byte length/u);
});
test('fixed case contract retains all five distinct cases', () => {
  assert.equal(CASES.length, 5); assert.equal(new Set(CASES.map(row => row[0])).size, 5);
});

// Explicit finite sequences exercise the real threshold rather than just changing
// the claimed p95. These synthetic motion fixtures do not qualify any hardware.
function syntheticMotion(f, index, kind) {
  changeAttachment(f, index, measured => {
    const spiky = kind === 'two-stalls';
    const step = kind === 'p95-over' ? 25 : 20;
    const elapsed = Array.from({length: 81}, (_, i) => spiky
      ? (i === 0 ? 0 : i === 1 ? 40 : 80 + (i - 2) * 16) : i * step);
    const start = 100, duration = spiky ? 1328 : 80 * step;
    const frameIntervals = spiky ? [40, 40, ...Array(78).fill(16)] : Array(80).fill(step);
    const counts = spiky ? [18, 21, 21, 21] : [20, 20, 20, 21];
    const cameraCounts = spiky ? [17, 21, 21, 21] : [19, 20, 20, 21];
    const renders = elapsed.map((time, i) => ({atMs: start + time, frameAdvance: 1,
      drawCalls: 5, cameraWorldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i, 1.5, 0, 1]}));
    Object.assign(measured, {frameCount: 80, p95Ms: spiky ? 16 : step,
      maxMs: spiky ? 40 : step, droppedFrames: spiky ? 2 : 0,
      longestSustainedStall: spiky ? 2 : 0, rafFrameCount: 80,
      rafP95Ms: spiky ? 16 : step, rafLongestSustainedStall: spiky ? 2 : 0,
      activeDurationMs: duration, submittedRenderCount: 81, cameraChangeCount: 80,
      inputMovesPerQuarter: copy(counts), drawsPerQuarter: copy(counts),
      cameraChangesPerQuarter: cameraCounts, renderIntervalsMs: copy(frameIntervals),
      rafIntervalsMs: copy(frameIntervals), sample: {startedAtMs: start, endedAtMs: start + duration,
        rafTimesMs: renders.map(frame => frame.atMs), renders,
        trustedPointerMoveTimesMs: renders.map(frame => frame.atMs), renderer,
        pixelRatio: 1, drawingBuffer: [1440, 900], contextLost: false, canvasReplaced: false}});
  });
}
rejects('recomputed 25 ms p95 fails even when every summary agrees with its raw samples',
  f => { syntheticMotion(f, 2, 'p95-over'); }, /p95Ms exceeds unchanged 20 ms/u);
rejects('two consecutive 40 ms intervals fail although recomputed p95 is 16 ms',
  f => { syntheticMotion(f, 2, 'two-stalls'); }, /longestSustainedStall exceeds unchanged limit 1/u);
test('the unchanged 20 ms p95 boundary remains inclusive', () => {
  const f = fixture(); syntheticMotion(f, 2, 'boundary'); pack(f);
  const verdict = verifyReceipt(f); assert.equal(verdict.walk.p95Ms, 20);
});
rejects('rejects a non-affine camera matrix', f => {
  changeAttachment(f, 2, m => { m.sample.renders[0].cameraWorldMatrix[15] = 0; });
}, /camera matrix must be affine/u);
rejects('rejects a singular camera orientation', f => {
  changeAttachment(f, 2, m => { m.sample.renders[0].cameraWorldMatrix[0] = 0; });
}, /rigid orientation/u);

rejects('rejects fractional frame counts even within numeric reconciliation tolerance', f => {
  changeAttachment(f, 2, m => { m.frameCount += 0.0000001; });
}, /frameCount.*invalid finite number/u);
rejects('rejects impossible sample length outside the recorded case duration', f => {
  changeAttachment(f, 2, m => { m.sample.endedAtMs = m.sample.startedAtMs + 100000; });
}, /sample exceeds its test execution duration/u);

// Independent-review regressions. These are synthetic consistency fixtures,
// not new hardware evidence or permission to publish an authenticated receipt.
test('first same-frame RAF timestamp may precede pointerdown without discarding its interval', () => {
  const f = fixture(); syntheticMotion(f, 2, 'boundary');
  changeAttachment(f, 2, m => {
    m.sample.rafTimesMs[0] = m.sample.startedAtMs - 0.5;
    m.rafIntervalsMs[0] = 20.5;
  });
  pack(f);
  const verdict = verifyReceipt(f);
  assert.equal(verdict.walk.rafFrameCount, 80);
  assert.equal(verdict.walk.rafIntervalsMs[0], 20.5);
  assert.equal(verdict.walk.rafP95Ms, 20);
});
rejects('a second RAF timestamp cannot precede native pointerdown', f => {
  syntheticMotion(f, 2, 'boundary');
  changeAttachment(f, 2, m => {
    m.sample.rafTimesMs[0] = m.sample.startedAtMs - 0.5;
    m.sample.rafTimesMs[1] = m.sample.startedAtMs - 0.25;
  });
}, /rafTimesMs.*invalid finite/u);
rejects('RAF timestamps cannot follow native pointerup', f => {
  changeAttachment(f, 2, m => { m.sample.rafTimesMs[m.sample.rafTimesMs.length - 1] = m.sample.endedAtMs + 1; });
}, /rafTimesMs.*invalid finite/u);
rejects('native pointer moves cannot precede pointerdown', f => {
  changeAttachment(f, 2, m => { m.sample.trustedPointerMoveTimesMs[0] = m.sample.startedAtMs - 1; });
}, /input.*invalid finite/u);
rejects('native pointer moves cannot follow pointerup', f => {
  changeAttachment(f, 2, m => { m.sample.trustedPointerMoveTimesMs[m.sample.trustedPointerMoveTimesMs.length - 1] = m.sample.endedAtMs + 1; });
}, /input.*invalid finite/u);
rejects('duplicate RAF timestamps cannot inflate frame coverage', f => {
  changeAttachment(f, 2, m => { m.sample.rafTimesMs[1] = m.sample.rafTimesMs[0]; });
}, /rafTimesMs.*strictly increasing/u);
rejects('duplicate returned-render timestamps cannot inflate frame coverage', f => {
  changeAttachment(f, 2, m => { m.sample.renders[1].atMs = m.sample.renders[0].atMs; });
}, /renderTimes.*strictly increasing/u);
rejects('four duplicated bursts are rejected even when every claimed metric agrees', f => {
  changeAttachment(f, 2, m => {
    const frameTimes = Array.from({length: 120}, (_, i) => 200 + Math.floor(i / 30) * 300);
    const frameIntervals = frameTimes.slice(1).map((time, i) => time - frameTimes[i]);
    Object.assign(m, {frameCount: 119, p95Ms: 0, maxMs: 300, droppedFrames: 3,
      longestSustainedStall: 1, rafFrameCount: 119, rafP95Ms: 0, rafLongestSustainedStall: 1,
      activeDurationMs: 1200, submittedRenderCount: 120, cameraChangeCount: 119,
      inputMovesPerQuarter: [1, 1, 1, 1], drawsPerQuarter: [30, 30, 30, 30],
      cameraChangesPerQuarter: [29, 30, 30, 30], renderIntervalsMs: copy(frameIntervals),
      rafIntervalsMs: copy(frameIntervals), sample: {startedAtMs: 100, endedAtMs: 1300,
        rafTimesMs: frameTimes, renders: frameTimes.map((atMs, i) => ({atMs, frameAdvance: 1,
          drawCalls: 5, cameraWorldMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i, 1.5, 0, 1]})),
        trustedPointerMoveTimesMs: [200, 500, 800, 1100], renderer, pixelRatio: 1,
        drawingBuffer: [1440, 900], contextLost: false, canvasReplaced: false}});
  });
}, /rafTimesMs.*strictly increasing/u);
rejects('report duration must cover its recorded multi-second cases', f => {
  f.results.stats.duration = 1;
}, /case durations exceed report duration/u);
rejects('report start cannot follow the first recorded case start', f => {
  const firstStart = Math.min(...specs(f).map(spec => Date.parse(spec.tests[0].results[0].startTime)));
  f.results.stats.startTime = new Date(firstStart + 1).toISOString();
}, /report start follows a case start/u);

rejects('rejects a receipt without controller monotonic elapsed time', f => {
  delete f.receipt.run.elapsedMs;
}, /receipt.run.*missing or unknown fields/u);
test('rejects nonfinite or nonpositive controller monotonic elapsed time', () => {
  for (const elapsedMs of [NaN, Infinity, -Infinity, 0, -1]) {
    const f = fixture(); f.receipt.run.elapsedMs = elapsedMs;
    assert.throws(() => verifyReceipt(f), /receipt.run.elapsedMs.*invalid finite number/u);
  }
});
rejects('report duration cannot exceed controller monotonic elapsed time', f => {
  f.receipt.run.elapsedMs = f.results.stats.duration - 1;
}, /report duration exceeds controller elapsedMs/u);
rejects('serial case durations cannot collectively exceed report duration', f => {
  result(f, 0).duration = f.results.stats.duration;
}, /case durations exceed report duration/u);
rejects('a recorded case start cannot precede the wrapper wall-clock interval', f => {
  result(f, 0).startTime = new Date(Date.parse(f.receipt.run.startedAt) - 1).toISOString();
}, /case start outside claimed run interval/u);
rejects('a recorded case start cannot follow the wrapper wall-clock interval', f => {
  result(f, 4).startTime = new Date(Date.parse(f.receipt.run.endedAt) + 1).toISOString();
}, /case start outside claimed run interval/u);
rejects('a recorded report start cannot precede the wrapper wall-clock interval', f => {
  f.results.stats.startTime = new Date(Date.parse(f.receipt.run.startedAt) - 1).toISOString();
}, /report start outside run interval/u);
rejects('a recorded report start cannot follow the wrapper wall-clock interval', f => {
  f.results.stats.startTime = new Date(Date.parse(f.receipt.run.endedAt) + 1).toISOString();
}, /report start outside run interval/u);
test('wall-clock drift does not fabricate overlapping tests or a late report finish', () => {
  const f = fixture();
  // Synthetic wall-clock adjustments exercise the two invalid old comparisons.
  // Durations and raw performance samples remain untouched; elapsedMs is the
  // explicitly synthetic controller value from fixture(), never real evidence.
  const first = result(f, 0), second = result(f, 1);
  second.startTime = new Date(Date.parse(first.startTime) + first.duration - 36).toISOString();
  const derivedReportEnd = Date.parse(f.results.stats.startTime) + f.results.stats.duration;
  f.receipt.run.endedAt = new Date(Math.floor(derivedReportEnd - 110)).toISOString();
  assert.ok(Date.parse(second.startTime) < Date.parse(first.startTime) + first.duration);
  assert.ok(derivedReportEnd > Date.parse(f.receipt.run.endedAt));
  pack(f);
  assert.equal(verifyReceipt(f).casesPassedOnce, 5);
});
test('a monotonic case duration is not a wall-clock finish timestamp', () => {
  const f = fixture();
  const last = result(f, 4);
  f.receipt.run.endedAt = new Date(Date.parse(last.startTime) + 1).toISOString();
  assert.ok(Date.parse(last.startTime) + last.duration > Date.parse(f.receipt.run.endedAt));
  assert.equal(verifyReceipt(f).casesPassedOnce, 5);
});
