import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { POLICY, parseJson, sha256 } from './verify-receipt.mjs';
import { makeRequest, REPOSITORY } from './hosted-gate.mjs';
import { authenticateMetadata, compareRequestFiles, requestArtifact, validateWorkerEvidence, publishResult, githubClient } from './publish-result.mjs';

// Every GitHub identity/status/source envelope below is synthetic and all calls
// are injected. Retained renderer samples are not newly authenticated evidence.
const retained = readFileSync(new URL('./fixtures/retained-rtx4090-results.json', import.meta.url));
const profileBytes = readFileSync(new URL('./worker-profile.json', import.meta.url));
const profile = parseJson(profileBytes);
const verifierSha256 = sha256(readFileSync(new URL('./verify-receipt.mjs', import.meta.url)));
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function fixture() {
  const results = parseJson(retained), start = Date.parse(results.stats.startTime);
  const paths = ['package.json', 'pnpm-lock.yaml', 'packages/web/package.json', 'packages/web/playwright.config.ts',
    'packages/web/e2e/twin-performance.spec.ts', 'packages/web/src/twin/__fixtures__/twin-fixture.ts',
    'packages/web/src/twin/shell/twin-rooms.ts', 'packages/web/src/twin/twin-copy.ts',
    ...['run-worker.py', 'worker-inner.sh', 'probe-runtime.cjs', 'gpu-tests.txt'].map(name => `.github/gpu/${name}`)];
  const sourceHashes = Object.fromEntries(paths.map(path => [path, 'a'.repeat(64)]));
  sourceHashes['packages/web/e2e/twin-performance.spec.ts'] = POLICY.benchmarkSha256;
  const source = { repository: REPOSITORY, commitSha: '1'.repeat(40), treeSha: '2'.repeat(40), sourceHashes };
  const repository = { full_name: REPOSITORY, private: false, id: 123, owner: { id: 456, login: 'codemaker66', type: 'User' } };
  const user = { ...repository.owner };
  const run = { id: 12345, run_attempt: 2, head_sha: source.commitSha, repository: { id: 123 }, status: 'in_progress',
    event: 'pull_request', path: '.github/workflows/ci.yml' };
  const prepared = makeRequest({ source, profile, profileBytes, verifierSha256, repository,
    context: { runId: '12345', runAttempt: '2', commitSha: source.commitSha }, nowMs: start - 2000, nonce: 'S'.repeat(32) });
  const sourceCheck = { commitSha: source.commitSha, treeSha: source.treeSha, checkedFiles: paths.length, state: 'pass' };
  const runtime = { schemaVersion: 1, renderer: profile.renderer, runtime: profile.runtime };
  const worker = { sourceBefore: structuredClone(sourceCheck), sourceAfter: structuredClone(sourceCheck),
    runtimeBefore: structuredClone(runtime), runtimeAfter: structuredClone(runtime), resultsBytes: retained,
    execution: { schemaVersion: 1, requestSha256: sha256(prepared.requestBytes), runNonce: prepared.request.runNonce,
      source, exitCode: 0, startedAt: new Date(start - 1000).toISOString(),
      endedAt: new Date(Math.ceil(start + results.stats.duration + 1000)).toISOString(), elapsedMs: results.stats.duration + 2000,
      exclusiveBenchmarkLease: true, bwrapSha256: '52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712',
      runnerHashes: Object.fromEntries(['run-worker.py', 'worker-inner.sh', 'probe-runtime.cjs', 'gpu-tests.txt'].map(name => [name, 'a'.repeat(64)])) } };
  const local = { 'request.json': prepared.requestBytes, 'trusted.json': prepared.trustedBytes,
    'READY.json': encode({ schemaVersion: 1, requestSha256: sha256(prepared.requestBytes), trustedSha256: sha256(prepared.trustedBytes) }) };
  return { ...prepared, source, profile, worker, repository, user, run, local,
    admitted: { runId: '12345', attempt: '2', source: source.commitSha }, nowMs: start + 60_000 };
}

test('synthetic controller envelope retains five actual unchanged sample checks', () => {
  const result = validateWorkerEvidence(fixture());
  assert.equal(result.verification.casesPassedOnce, 5);
  assert.deepEqual(Buffer.from(parseJson(result.bundleBytes).resultsBase64, 'base64'), retained);
});
for (const [name, change, pattern] of [
  ['source-before count', f => { f.worker.sourceBefore.checkedFiles--; }, /source-before/u],
  ['source-after state', f => { f.worker.sourceAfter.state = 'fail'; }, /source-after/u],
  ['request nonce', f => { f.worker.execution.runNonce = 'T'.repeat(32); }, /assigned job/u],
  ['request digest', f => { f.worker.execution.requestSha256 = 'f'.repeat(64); }, /assigned job/u],
  ['nonzero process exit', f => { f.worker.execution.exitCode = 1; }, /assigned job/u],
  ['missing benchmark lease', f => { f.worker.execution.exclusiveBenchmarkLease = false; }, /assigned job/u],
  ['changed external runner', f => { f.worker.execution.runnerHashes['worker-inner.sh'] = 'f'.repeat(64); }, /helper/u],
  ['changed sandbox', f => { f.worker.execution.bwrapSha256 = 'f'.repeat(64); }, /sandbox/u],
  ['wrong actual browser', f => { f.worker.runtimeBefore.runtime.chromium = '1.2.3'; }, /initial runtime/u],
  ['changed final adapter', f => { f.worker.runtimeAfter.renderer = 'SwiftShader'; }, /final runtime/u],
  ['expired request', f => { f.nowMs = Date.parse(f.request.expiresAt); }, /lifetime/u],
  ['fabricated duration', f => { f.worker.execution.elapsedMs = 1; }, /elapsed|monotonic|duration/iu],
]) test(`rejects ${name}`, () => { const f = fixture(); change(f); assert.throws(() => validateWorkerEvidence(f), pattern); });
test('raw report tamper is rejected before publication', () => {
  const f = fixture(); const report = parseJson(retained); report.suites[0].specs.pop(); f.worker.resultsBytes = encode(report);
  assert.throws(() => validateWorkerEvidence(f), /exactly five/u);
});
test('metadata rejects different user, attempt and workflow', () => {
  const f = fixture(); authenticateMetadata(f);
  assert.throws(() => authenticateMetadata({ ...f, user: { ...f.user, id: 777 } }), /operator/u);
  assert.throws(() => authenticateMetadata({ ...f, run: { ...f.run, run_attempt: 3 } }), /attempt/u);
  assert.throws(() => authenticateMetadata({ ...f, run: { ...f.run, path: '.github/workflows/other.yml' } }), /attempt/u);
});
test('original hosted bytes must match all three local request files exactly', () => {
  const f = fixture(); compareRequestFiles(f.local, f.local);
  assert.throws(() => compareRequestFiles(f.local, { ...f.local, 'trusted.json': Buffer.from('{}') }), /hosted artifact/u);
  assert.throws(() => compareRequestFiles(f.local, { ...f.local, 'extra': Buffer.from('x') }), /fields/u);
});
test('artifact discovery rejects duplicates and another source', async () => {
  const f = fixture(); const artifact = { id: 42, name: 'gpu-request-12345-2', expired: false, size_in_bytes: 500,
    digest: `sha256:${'f'.repeat(64)}`, created_at: f.request.issuedAt,
    workflow_run: { id: 12345, repository_id: 123, head_sha: f.run.head_sha } };
  assert.equal((await requestArtifact({ get: async () => ({ artifacts: [artifact] }) }, f.request, f.run)).id, 42);
  await assert.rejects(requestArtifact({ get: async () => ({ artifacts: [artifact, artifact] }) }, f.request, f.run), /Exactly one/u);
  artifact.workflow_run.head_sha = '3'.repeat(40);
  await assert.rejects(requestArtifact({ get: async () => ({ artifacts: [artifact] }) }, f.request, f.run), /another source/u);
});
test('GitHub command injection sends structured bodies on stdin without shell interpolation', async () => {
  let captured;
  const api = githubClient(async (args, options) => { captured = { args, options }; return Buffer.from('{"ok":true}'); });
  await api.post(`/repos/${REPOSITORY}/git/blobs`, { content: '$(never execute)' });
  assert.equal(captured.args.includes('$(never execute)'), false);
  assert.equal(parseJson(captured.options.input).content, '$(never execute)');
});

async function temporary(testBody) {
  const parent = await mkdtemp(join(tmpdir(), 'venviewer-publisher-unit-'));
  try { await testBody(parent); } finally {
    assert.equal(dirname(resolve(parent)), resolve(tmpdir())); assert.ok(basename(parent).startsWith('venviewer-publisher-unit-'));
    await rm(parent, { recursive: true, force: true });
  }
}
async function publicationFixture(parent, { uncertain = false } = {}) {
  const f = fixture(), requestDir = join(parent, 'request'), workerOutput = join(parent, 'worker'), repo = join(parent, 'repo');
  for (const path of [requestDir, workerOutput, repo]) await mkdir(path);
  for (const [name, bytes] of Object.entries(f.local)) await writeFile(join(requestDir, name), bytes);
  for (const [field, name] of Object.entries({ sourceBefore: 'source-before.json', sourceAfter: 'source-after.json',
    runtimeBefore: 'runtime-before.json', runtimeAfter: 'runtime-after.json', execution: 'execution.json' })) await writeFile(join(workerOutput, name), encode(f.worker[field]));
  await writeFile(join(workerOutput, 'results.json'), retained);
  const archive = Buffer.from('SYNTHETIC ZIP; injected decoder only'); const posts = [];
  const api = { get: async (path) => {
    if (path === '/user') return f.user;
    if (path === `/repos/${REPOSITORY}`) return f.repository;
    if (path.endsWith('/artifacts?per_page=100&page=1')) return { artifacts: [{ id: 42, name: 'gpu-request-12345-2', expired: false,
      size_in_bytes: archive.length, digest: `sha256:${sha256(archive)}`, created_at: f.request.issuedAt,
      workflow_run: { id: 12345, repository_id: 123, head_sha: f.run.head_sha } }] };
    if (path.endsWith('/actions/runs/12345')) return f.run;
    if (path.includes('/actions/artifacts/')) return archive;
    if (path.includes('/commits/') && path.includes('/statuses?')) return [];
    if (path.includes('/commits/')) return { sha: f.source.commitSha, commit: { tree: { sha: f.source.treeSha } } };
    throw new Error('Unexpected test GET');
  }, post: async (path, body) => {
    posts.push({ path, body });
    if (uncertain) throw new Error('Synthetic uncertain network result');
    if (path.endsWith('/git/blobs')) {
      const bytes = Buffer.from(body.content, 'base64');
      const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      return { sha, url: `https://api.github.com/repos/${REPOSITORY}/git/blobs/${sha}` };
    }
    return { ...body, id: 900, creator: f.user, created_at: new Date(f.nowMs).toISOString() };
  } };
  return { f, posts, options: { requestDir, workerOutput, repo, runId: '12345', attempt: '2', source: f.source.commitSha },
    dependencies: { api, now: () => f.nowMs, independentSource: async () => ({ source: f.source, nonceDirectory: join(parent, 'nonces') }),
      decodeArchive: async () => f.local } };
}
test('mocked publication creates intent before two writes and retains raw authenticated receipts', () => temporary(async (parent) => {
  const f = await publicationFixture(parent); const result = await publishResult(f.options, f.dependencies);
  assert.equal(result.state, 'published'); assert.equal(f.posts.length, 2);
  const marker = parseJson(await readFile(join(parent, 'nonces', `12345-2-${'S'.repeat(32)}.json`)));
  assert.equal(marker.state, 'publication-started-inspect-before-retry');
  assert.equal(parseJson(await readFile(join(result.evidenceDir, 'published.json'))).statusId, 900);
}));
test('uncertain first POST retains intent and prevents blind retry', () => temporary(async (parent) => {
  const f = await publicationFixture(parent, { uncertain: true });
  await assert.rejects(publishResult(f.options, f.dependencies), /uncertain/u);
  const marker = await readFile(join(parent, 'nonces', `12345-2-${'S'.repeat(32)}.json`)); assert.ok(marker.length > 0);
  await assert.rejects(publishResult(f.options, f.dependencies), /Unknown worker output/u);
  assert.equal(f.posts.length, 1);
}));
test('archive reader accepts only exact regular request files and never extracts', () => {
  const helper = fileURLToPath(new URL('./read-request-zip.py', import.meta.url));
  const code = `import importlib.util,io,zipfile,stat,sys\ns=importlib.util.spec_from_file_location('reader',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef blob(names,symlink=False):\n b=io.BytesIO()\n with zipfile.ZipFile(b,'w') as z:\n  for n in names:\n   i=zipfile.ZipInfo(n);i.external_attr=((stat.S_IFLNK if symlink else stat.S_IFREG)|0o600)<<16;z.writestr(i,b'{}')\n return b.getvalue()\nassert set(m.read_request_zip(blob(['request.json','trusted.json','READY.json'])))==m.EXPECTED\nfor names,link in [(['../request.json','trusted.json','READY.json'],False),(['request.json','request.json','READY.json'],False),(['request.json','trusted.json','READY.json'],True)]:\n try:m.read_request_zip(blob(names,link));raise AssertionError('accepted unsafe archive')\n except ValueError:pass\nprint('4 archive cases passed')`;
  const result = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', code, helper], { encoding: 'utf8', timeout: 15_000 });
  assert.match(result, /4 archive cases passed/u);
});
