import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { POLICY, parseJson, sha256 } from './verify-receipt.mjs';
import { REPOSITORY, contextFromEnvironment, makeRequest, validateRequest, validateStatus,
  verifyEvidenceBundle, matchingStatus, waitForEvidence, GitHubReader, prepareDirectory } from './hosted-gate.mjs';

// Synthetic authentication/source envelopes around unchanged retained samples.
// No test publishes a status, calls GitHub, or establishes real qualification.
const retained = readFileSync(new URL('./fixtures/retained-rtx4090-results.json', import.meta.url));
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function fixture() {
  const results = parseJson(retained);
  const start = Date.parse(results.stats.startTime);
  const sourceHashes = Object.fromEntries(['package.json', 'pnpm-lock.yaml', 'packages/web/package.json',
    'packages/web/playwright.config.ts', 'packages/web/e2e/twin-performance.spec.ts',
    'packages/web/src/twin/__fixtures__/twin-fixture.ts', 'packages/web/src/twin/shell/twin-rooms.ts',
    'packages/web/src/twin/twin-copy.ts'].map((path) => [path, 'c'.repeat(64)]));
  sourceHashes['packages/web/e2e/twin-performance.spec.ts'] = POLICY.benchmarkSha256;
  const profile = { schemaVersion: 1, id: 'synthetic-unit-profile',
    renderer: 'ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 4090), OpenGL 4.6)',
    runtime: { node: '22.23.2', playwright: '1.59.1', chromium: '147.0.7727.15',
      os: 'SYNTHETIC TEST OS', driver: 'SYNTHETIC TEST DRIVER' } };
  const source = { repository: REPOSITORY, commitSha: '1'.repeat(40), treeSha: '2'.repeat(40), sourceHashes };
  const prepared = makeRequest({ source, profile, profileBytes: encode(profile), verifierSha256: 'e'.repeat(64),
    repository: { full_name: REPOSITORY, private: false, id: 123, owner: { id: 456, login: 'codemaker66', type: 'User' } },
    context: { runId: '12345', runAttempt: '2', commitSha: source.commitSha }, nowMs: start - 2000,
    nonce: 'S'.repeat(32) });
  const receipt = { schemaVersion: 1, policyVersion: POLICY.version, source: structuredClone(source),
    runNonce: prepared.request.runNonce, renderer: profile.renderer, runtime: structuredClone(profile.runtime),
    quality: structuredClone(POLICY.quality), budgets: structuredClone(POLICY.budgets),
    run: { workers: 1, retries: 0, repeatEach: 1, exitCode: 0, exclusive: true,
      startedAt: new Date(start - 1000).toISOString(), endedAt: new Date(Math.ceil(start + results.stats.duration + 1000)).toISOString(),
      elapsedMs: results.stats.duration + 2000 },
    resultsSha256: sha256(retained) };
  const bundle = { schemaVersion: 1, requestSha256: sha256(prepared.requestBytes), receipt, resultsBase64: retained.toString('base64') };
  const value = { ...prepared, source, profile, bundle, nowMs: start + 60_000 };
  return repack(value);
}
function repack(f) {
  f.bundleBytes = encode(f.bundle);
  f.blobSha = createHash('sha1').update(`blob ${f.bundleBytes.length}\0`).update(f.bundleBytes).digest('hex');
  f.status = { id: 789, state: 'success', context: f.request.statusContext,
    creator: { ...f.request.operator, type: 'User' }, created_at: new Date(f.nowMs - 1000).toISOString(),
    description: `sha256:${sha256(f.bundleBytes)}`,
    target_url: `https://api.github.com/repos/${REPOSITORY}/git/blobs/${f.blobSha}` };
  return f;
}
function fakeApi(f, status = f.status) {
  return { get: async (path) => {
    if (path.includes('/actions/runs/')) return { id: Number(f.request.runId), run_attempt: Number(f.request.runAttempt),
      repository: { id: f.request.repositoryId }, status: 'in_progress' };
    if (path.includes('/statuses?')) return status === null ? [] : [status];
    if (path.includes('/git/blobs/')) return f.bundleBytes;
    throw new Error('Unexpected API call');
  } };
}

test('request binds checkout, run attempt and exact independently generated trusted bytes', () => {
  const f = fixture();
  validateRequest({ ...f, expected: { source: f.source, runId: '12345', runAttempt: '2', operatorId: 456 } });
  assert.throws(() => validateRequest({ ...f, expected: { runAttempt: '1' } }), /runAttempt/u);
  assert.throws(() => validateRequest({ ...f, expected: { source: { ...f.source, commitSha: '3'.repeat(40) } } }), /Independent source/u);
});
test('requires explicit repository/SHA/run/attempt from hosted environment', () => {
  const env = { GITHUB_REPOSITORY: REPOSITORY, GITHUB_SHA: '1'.repeat(40), GITHUB_RUN_ID: '2', GITHUB_RUN_ATTEMPT: '1' };
  assert.equal(contextFromEnvironment(env).runAttempt, '1');
  for (const field of Object.keys(env)) assert.throws(() => contextFromEnvironment({ ...env, [field]: '' }));
});
test('authenticated synthetic envelope verifies all five raw cases and preserves exact report bytes', () => {
  const f = fixture(); const result = verifyEvidenceBundle(f);
  assert.equal(result.verification.casesPassedOnce, 5);
  assert.deepEqual(result.resultsBytes, retained);
});
test('historical evidence re-verifies after expiry but cannot be newly accepted', () => {
  const f = fixture(); f.nowMs = Date.parse(f.request.expiresAt) + 60_000;
  assert.equal(verifyEvidenceBundle(f).verification.casesPassedOnce, 5);
  assert.throws(() => verifyEvidenceBundle({ ...f, allowExpired: false }), /expired/u);
});
for (const [name, change, pattern] of [
  ['wrong operator', f => { f.status.creator.id++; }, /creator/u],
  ['bot reusing login', f => { f.status.creator.type = 'Bot'; }, /creator/u],
  ['another attempt', f => { f.status.context = f.status.context.replace('/2/', '/1/'); }, /context/u],
  ['stale status', f => { f.status.created_at = '2020-01-01T00:00:00Z'; }, /Stale/u],
  ['future status', f => { f.status.created_at = new Date(f.nowMs + 1000).toISOString(); }, /future/u],
  ['worker failure', f => { f.status.state = 'failure'; }, /failure/u],
  ['missing hash', f => { f.status.description = '5 passed'; }, /digest/u],
  ['changed bytes', f => { f.bundleBytes = Buffer.concat([f.bundleBytes, Buffer.from(' ')]); }, /digest/u],
  ['arbitrary URL', f => { f.status.target_url = 'https://example.com/receipt'; }, /URL/u],
  ['same host other repo', f => { f.status.target_url = f.status.target_url.replace('/omnitwin/', '/evil/'); }, /URL/u],
  ['URL query', f => { f.status.target_url += '?redirect=evil'; }, /URL/u],
]) test(`rejects ${name}`, () => { const f = fixture(); change(f); assert.throws(() => verifyEvidenceBundle(f), pattern); });
test('rejects a rehashed bundle bound to another request', () => {
  const f = fixture(); f.bundle.requestSha256 = 'f'.repeat(64); repack(f);
  assert.throws(() => verifyEvidenceBundle(f), /request binding/u);
});
test('rejects raw report omissions even with authentic status and matching digest', () => {
  const f = fixture(); const report = parseJson(retained); report.suites[0].specs.pop();
  const bytes = encode(report); f.bundle.resultsBase64 = bytes.toString('base64');
  f.bundle.receipt.resultsSha256 = sha256(bytes); repack(f);
  assert.throws(() => verifyEvidenceBundle(f), /exactly five/u);
});
test('rejects an execution predating its fresh challenge', () => {
  const f = fixture(); f.bundle.receipt.run.startedAt = new Date(Date.parse(f.request.issuedAt) - 1).toISOString(); repack(f);
  assert.throws(() => verifyEvidenceBundle(f), /request lifetime/u);
});
test('paginates statuses and does not fall back from a later failure', async () => {
  const f = fixture(); let calls = 0;
  const status = await matchingStatus({ get: async () => ++calls === 1
    ? Array.from({ length: 100 }, () => ({ context: 'other' })) : [{ ...f.status, state: 'failure' }, f.status] }, f.request);
  assert.equal(calls, 2); assert.equal(status.state, 'failure');
  assert.throws(() => validateStatus(status, f.request, f.nowMs), /failure/u);
});
test('fully missing evidence expires without success or arbitrary repeated execution', async () => {
  const f = fixture(); let now = Date.parse(f.request.expiresAt) - 1;
  await assert.rejects(waitForEvidence({ ...f, api: fakeApi(f, null), now: () => now, sleep: async () => { now += 2; } }), /not received/u);
});
test('changed or cancelled hosted attempt rejects before receipt download', async () => {
  const f = fixture();
  await assert.rejects(waitForEvidence({ ...f, api: { get: async () => ({ id: 12345, run_attempt: 3,
    repository: { id: 123 }, status: 'in_progress' }) }, now: () => f.nowMs }), /active assigned attempt/u);
});
test('wait accepts only fetched content-addressed raw evidence while the attempt is live', async () => {
  const f = fixture(); const result = await waitForEvidence({ ...f, api: fakeApi(f), now: () => f.nowMs });
  assert.equal(result.verification.casesPassedOnce, 5); assert.deepEqual(result.bundleBytes, f.bundleBytes);
});
test('reader forbids arbitrary hosts/redirect following and does not expose token in failures', async () => {
  let options;
  const reader = new GitHubReader('SYNTHETIC_SECRET', async (_url, init) => { options = init; return new Response('denied', { status: 403 }); });
  await assert.rejects(reader.get('/repos/other/other'), /Untrusted API/u);
  await assert.rejects(reader.get(`/repos/${REPOSITORY}`), /^Error: GitHub read failed \(403\)$/u);
  assert.equal(options.redirect, 'error');
});
test('fresh preparation never overwrites an existing job and seals exact bytes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'venviewer-hosted-gpu-unit-'));
  try {
    const f = fixture(); const path = join(parent, 'job'); await prepareDirectory(path, f);
    const ready = JSON.parse(await readFile(join(path, 'READY.json'), 'utf8'));
    assert.equal(ready.requestSha256, sha256(f.requestBytes));
    await assert.rejects(prepareDirectory(path, f), /EEXIST/u);
    assert.deepEqual(await readFile(join(path, 'request.json')), f.requestBytes);
  } finally {
    assert.equal(dirname(resolve(parent)), resolve(tmpdir()));
    assert.ok(basename(parent).startsWith('venviewer-hosted-gpu-unit-'));
    await rm(parent, { recursive: true, force: true });
  }
});
