import { createHash } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { open, lstat, readdir, readFile, realpath, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parseJson, POLICY, sha256, verifyReceipt } from './verify-receipt.mjs';
import { REPOSITORY, validateProfile, validateRequest, validateStatus, matchingStatus } from './hosted-gate.mjs';

const execFile = promisify(execFileCallback);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAX = 20 * 1024 * 1024;
const FIXED_REQUEST = ['request.json', 'trusted.json', 'READY.json'];
const RUNNER_FILES = ['run-worker.py', 'worker-inner.sh', 'probe-runtime.cjs', 'gpu-tests.txt'];
const BWRAP_HASH = '52231e1caf55bcbc667b269f49c63599a6f7db4767ae6a039580d0ff853db712';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => assert(object(value)
  && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0'), 'Unexpected object fields');
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const hex = (value, width = 64) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${width}}$`, 'u').test(value);
const decimal = (value) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value);
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : object(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const same = (a, b, message) => assert(canonical(a) === canonical(b), message);
const date = (value) => { const result = Date.parse(value); assert(Number.isFinite(result), 'Invalid execution time'); return result; };

export async function regularBytes(path, limit = MAX) {
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit, 'Expected bounded regular evidence file');
  const bytes = await readFile(path); const after = await lstat(path);
  assert(after.isFile() && !after.isSymbolicLink() && before.ino === after.ino
    && before.size === after.size && bytes.length === before.size && before.mtimeMs === after.mtimeMs, 'Evidence file changed while reading');
  return bytes;
}
async function directory(path) {
  const info = await lstat(path);
  assert(info.isDirectory() && !info.isSymbolicLink(), 'Explicit regular directory required');
  return realpath(path);
}
async function writeExclusive(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}

/** The only GitHub command channel. Credentials remain in gh's trusted host environment. */
export function runGh(args, { input } = {}) {
  return new Promise((done, reject) => {
    const child = spawn('gh', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, finished = false;
    const timer = setTimeout(() => { child.kill(); finish(new Error('GitHub command timed out')); }, 30_000);
    function finish(error, bytes) { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : done(bytes); }
    child.on('error', () => finish(new Error('GitHub command could not start')));
    child.stdout.on('data', (chunk) => { size += chunk.length;
      if (size > MAX) { child.kill(); finish(new Error('GitHub response exceeds size limit')); } else chunks.push(chunk); });
    // Provider/CLI stderr is deliberately not copied into public qualification evidence.
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('close', (code) => finish(code === 0 ? null : new Error(`GitHub command failed (${code})`), Buffer.concat(chunks)));
    child.stdin.end(input);
  });
}

export function githubClient(command = runGh) {
  async function call(path, method = 'GET', body, raw = false) {
    assert(path === '/user' || path === `/repos/${REPOSITORY}` || path.startsWith(`/repos/${REPOSITORY}/`), 'Untrusted GitHub API path');
    assert(method === 'GET' || method === 'POST', 'Unexpected API method');
    const args = ['api', '--hostname', 'github.com', path, '--method', method,
      '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28'];
    if (body !== undefined) args.push('--input', '-');
    const bytes = await command(args, { input: body === undefined ? undefined : encode(body) });
    assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX, 'Invalid GitHub response bytes');
    return raw ? bytes : parseJson(bytes, 'GitHub response');
  }
  return { get: (path, raw = false) => call(path, 'GET', undefined, raw),
    post: (path, body) => call(path, 'POST', body) };
}

export function authenticateMetadata({ repository, user, run, request, admitted }) {
  assert(repository.full_name === REPOSITORY && repository.private === false && positive(repository.id)
    && repository.owner?.type === 'User' && repository.owner.login === 'codemaker66'
    && positive(repository.owner.id), 'Unexpected repository ownership');
  assert(user.type === 'User' && user.id === repository.owner.id && user.login === repository.owner.login,
    'Authenticated operator is not the repository owner');
  assert(request.repositoryId === repository.id && request.operator.id === user.id, 'Request owner/repository differs');
  assert(request.runId === admitted.runId && request.runAttempt === admitted.attempt
    && request.sourceCommit === admitted.source, 'Request differs from explicitly admitted job');
  assert(String(run.id) === admitted.runId && String(run.run_attempt) === admitted.attempt
    && run.repository?.id === repository.id && run.status === 'in_progress'
    && ['push', 'pull_request'].includes(run.event)
    && typeof run.path === 'string' && run.path.split('@')[0] === '.github/workflows/ci.yml', 'Wrong or inactive CI attempt');
}

export async function requestArtifact(api, request, run) {
  const name = `gpu-request-${request.runId}-${request.runAttempt}`; const matches = [];
  for (let page = 1; page <= 100; page++) {
    const response = await api.get(`/repos/${REPOSITORY}/actions/runs/${request.runId}/artifacts?per_page=100&page=${page}`);
    assert(Array.isArray(response.artifacts) && response.artifacts.length <= 100, 'Invalid artifact listing');
    matches.push(...response.artifacts.filter((artifact) => artifact.name === name));
    if (response.artifacts.length < 100) break;
    assert(page < 100, 'Artifact pagination limit exceeded');
  }
  assert(matches.length === 1, 'Exactly one original request artifact is required');
  const artifact = matches[0];
  assert(positive(artifact.id) && artifact.expired === false && positive(artifact.size_in_bytes)
    && artifact.size_in_bytes <= 8 * 1024 * 1024 && /^sha256:[0-9a-f]{64}$/u.test(artifact.digest), 'Invalid request artifact metadata');
  assert(String(artifact.workflow_run?.id) === request.runId && artifact.workflow_run.repository_id === request.repositoryId
    && artifact.workflow_run.head_sha === run.head_sha, 'Artifact belongs to another source/run');
  assert(date(artifact.created_at) >= Math.floor(date(request.issuedAt) / 1000) * 1000
    && date(artifact.created_at) <= date(request.expiresAt), 'Artifact lies outside request lifetime');
  return artifact;
}

export function compareRequestFiles(local, remote) {
  keys(remote, FIXED_REQUEST); keys(local, FIXED_REQUEST);
  for (const name of FIXED_REQUEST) assert(Buffer.isBuffer(remote[name]) && local[name].equals(remote[name]), 'Local request differs from original hosted artifact');
  const ready = parseJson(local['READY.json']); keys(ready, ['schemaVersion', 'requestSha256', 'trustedSha256']);
  assert(ready.schemaVersion === 1 && ready.requestSha256 === sha256(local['request.json'])
    && ready.trustedSha256 === sha256(local['trusted.json']), 'Request READY marker differs');
}

export function validateWorkerEvidence({ request, trusted, requestBytes, source, profile, worker, nowMs = Date.now() }) {
  validateProfile(profile);
  validateRequest({ request, trusted, requestBytes, expected: { source } });
  same(trusted.renderer, profile.renderer, 'Trusted renderer differs from committed profile');
  same(trusted.runtime, profile.runtime, 'Trusted runtime differs from committed profile');
  const expectedSource = { commitSha: source.commitSha, treeSha: source.treeSha,
    checkedFiles: Object.keys(source.sourceHashes).length, state: 'pass' };
  same(worker.sourceBefore, expectedSource, 'Worker source-before failed');
  same(worker.sourceAfter, expectedSource, 'Worker source-after failed');
  const expectedRuntime = { schemaVersion: 1, renderer: profile.renderer, runtime: profile.runtime };
  same(worker.runtimeBefore, expectedRuntime, 'Actual initial runtime differs');
  same(worker.runtimeAfter, expectedRuntime, 'Actual final runtime differs');
  const execution = worker.execution;
  keys(execution, ['schemaVersion', 'requestSha256', 'runNonce', 'source', 'exitCode', 'startedAt', 'endedAt',
    'elapsedMs', 'exclusiveBenchmarkLease', 'bwrapSha256', 'runnerHashes']);
  assert(execution.schemaVersion === 1 && execution.requestSha256 === sha256(requestBytes)
    && execution.runNonce === request.runNonce && execution.exitCode === 0 && execution.exclusiveBenchmarkLease === true,
    'Worker execution did not satisfy assigned job');
  same(execution.source, source, 'Worker execution source differs');
  assert(execution.bwrapSha256 === BWRAP_HASH, 'Unreviewed sandbox binary');
  keys(execution.runnerHashes, RUNNER_FILES);
  for (const name of RUNNER_FILES) assert(hex(execution.runnerHashes[name])
    && execution.runnerHashes[name] === source.sourceHashes[`.github/gpu/${name}`], 'Executed runner helper differs from committed source');
  assert(Number.isFinite(execution.elapsedMs) && execution.elapsedMs > 0 && execution.elapsedMs <= 190_000, 'Invalid worker monotonic elapsed time');
  assert(date(execution.startedAt) >= date(request.issuedAt) && date(execution.endedAt) > date(execution.startedAt)
    && date(execution.endedAt) <= nowMs && nowMs < date(request.expiresAt), 'Worker is outside the active request lifetime');
  const receipt = { schemaVersion: 1, policyVersion: POLICY.version, source,
    runNonce: request.runNonce, renderer: worker.runtimeBefore.renderer, runtime: worker.runtimeBefore.runtime,
    quality: POLICY.quality, budgets: POLICY.budgets,
    run: { workers: 1, retries: 0, repeatEach: 1, exitCode: execution.exitCode,
      exclusive: execution.exclusiveBenchmarkLease, startedAt: execution.startedAt, endedAt: execution.endedAt,
      elapsedMs: execution.elapsedMs }, resultsSha256: sha256(worker.resultsBytes) };
  const verification = verifyReceipt({ trusted, receipt, resultsBytes: worker.resultsBytes });
  const bundleBytes = encode({ schemaVersion: 1, requestSha256: sha256(requestBytes),
    receipt, resultsBase64: worker.resultsBytes.toString('base64') });
  return { receipt, verification, bundleBytes };
}

async function inspectWorkerOutput(path) {
  const allowed = new Set(['source-before.json', 'source-after.json', 'runtime-before.json', 'runtime-after.json',
    'execution.json', 'results.json', 'run.log', 'xvfb.log', 'test-results']);
  let files = 0, size = 0;
  async function walk(folder, depth) {
    assert(depth < 10, 'Worker output depth exceeded');
    for (const item of await readdir(folder, { withFileTypes: true })) {
      if (depth === 0) assert(allowed.has(item.name), 'Unknown worker output entry');
      const target = resolve(folder, item.name); const info = await lstat(target);
      assert(!info.isSymbolicLink(), 'Worker output symlink rejected');
      if (info.isDirectory()) { assert(depth > 0 || item.name === 'test-results', 'Unexpected worker output directory'); await walk(target, depth + 1); }
      else { assert(info.isFile(), 'Worker output must be regular'); size += info.size; files++;
        assert(info.size <= MAX && size <= 40 * 1024 * 1024 && files <= 1000, 'Worker output bounds exceeded'); }
    }
  }
  await walk(path, 0);
  const values = {};
  for (const [key, name] of Object.entries({ sourceBefore: 'source-before.json', sourceAfter: 'source-after.json',
    runtimeBefore: 'runtime-before.json', runtimeAfter: 'runtime-after.json', execution: 'execution.json' })) {
    values[key] = parseJson(await regularBytes(resolve(path, name)), name);
  }
  values.resultsBytes = await regularBytes(resolve(path, 'results.json'));
  return values;
}

const gitEnv = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' });
async function independentSource(repo, admittedSha) {
  const { stdout } = await execFile(process.platform === 'win32' ? 'python' : 'python3',
    [resolve(HERE, 'source_manifest.py'), '--repo', repo, '--commit', admittedSha], { env: gitEnv(), timeout: 75_000, maxBuffer: MAX });
  const source = parseJson(Buffer.from(stdout));
  const helpers = [...RUNNER_FILES, 'worker-profile.json', 'source_manifest.py', 'verify-receipt.mjs',
    'hosted-gate.mjs', 'publish-result.mjs', 'read-request-zip.py'];
  for (const name of helpers) assert(source.sourceHashes[`.github/gpu/${name}`] === sha256(await regularBytes(resolve(HERE, name))), 'Publisher/helper bytes differ from admitted commit');
  const { stdout: common } = await execFile('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { env: gitEnv(), timeout: 15_000 });
  return { source, nonceDirectory: resolve(repo, common.trim(), 'venviewer-gpu-publications') };
}
async function decodeArchive(path) {
  const { stdout } = await execFile(process.platform === 'win32' ? 'python' : 'python3', [resolve(HERE, 'read-request-zip.py'), path],
    { timeout: 15_000, maxBuffer: MAX });
  const encoded = parseJson(Buffer.from(stdout)); keys(encoded, FIXED_REQUEST);
  return Object.fromEntries(FIXED_REQUEST.map((name) => [name, Buffer.from(encoded[name], 'base64')]));
}

export async function publishResult(options, dependencies = {}) {
  const { runId, attempt, source: admittedSha } = options;
  assert(decimal(runId) && decimal(attempt) && hex(admittedSha, 40), 'Explicit run/attempt/exact admitted SHA required');
  const now = dependencies.now ?? Date.now;
  const api = dependencies.api ?? githubClient();
  const requestDir = await directory(resolve(options.requestDir));
  const output = await directory(resolve(options.workerOutput));
  const repo = await directory(resolve(options.repo));
  const local = {};
  for (const name of FIXED_REQUEST) local[name] = await regularBytes(resolve(requestDir, name), 2 * 1024 * 1024);
  const request = parseJson(local['request.json']), trusted = parseJson(local['trusted.json']);
  const admitted = { runId, attempt, source: admittedSha };
  const repository = await api.get(`/repos/${REPOSITORY}`), user = await api.get('/user');
  let run = await api.get(`/repos/${REPOSITORY}/actions/runs/${runId}`);
  authenticateMetadata({ repository, user, run, request, admitted });
  const independent = await (dependencies.independentSource ?? independentSource)(repo, admittedSha);
  const profileBytes = await regularBytes(resolve(HERE, 'worker-profile.json'));
  const profile = parseJson(profileBytes); validateProfile(profile);
  validateRequest({ request, trusted, requestBytes: local['request.json'], expected: {
    source: independent.source, runId, runAttempt: attempt, repositoryId: repository.id, operatorId: user.id,
    verifierSha256: sha256(await regularBytes(resolve(HERE, 'verify-receipt.mjs'))), profileSha256: sha256(profileBytes) } });
  const commit = await api.get(`/repos/${REPOSITORY}/commits/${admittedSha}`);
  assert(commit.sha === admittedSha && commit.commit?.tree?.sha === independent.source.treeSha, 'GitHub commit differs from independent source');
  assert(now() < date(request.expiresAt), 'Request expired before publication preparation');
  const artifact = await requestArtifact(api, request, run);
  const archiveBytes = await api.get(`/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`, true);
  assert(Buffer.isBuffer(archiveBytes) && archiveBytes.length <= 8 * 1024 * 1024
    && `sha256:${sha256(archiveBytes)}` === artifact.digest, 'Original artifact archive digest mismatch');
  const worker = await inspectWorkerOutput(output);
  // A new private receipt directory retains the downloaded challenge and every publication result.
  const evidenceDir = resolve(output, 'publisher-evidence'); await mkdir(evidenceDir, { mode: 0o700 });
  const archivePath = resolve(evidenceDir, 'original-request.zip'); await writeExclusive(archivePath, archiveBytes);
  const remoteFiles = await (dependencies.decodeArchive ?? decodeArchive)(archivePath);
  compareRequestFiles(local, remoteFiles);
  const verified = validateWorkerEvidence({ request, trusted, requestBytes: local['request.json'],
    source: independent.source, profile, worker, nowMs: now() });
  await writeExclusive(resolve(evidenceDir, 'bundle.json'), verified.bundleBytes);
  await writeExclusive(resolve(evidenceDir, 'verification.json'), encode(verified.verification));
  await writeExclusive(resolve(evidenceDir, 'authentication.json'), encode({ repositoryId: repository.id, operatorId: user.id,
    runId, attempt, source: admittedSha, artifactId: artifact.id, artifactDigest: artifact.digest }));
  assert(await matchingStatus(api, request) === null, 'This request already has a published status; inspect it instead of retrying');
  run = await api.get(`/repos/${REPOSITORY}/actions/runs/${runId}`);
  authenticateMetadata({ repository, user, run, request, admitted });
  assert(now() < date(request.expiresAt), 'Request expired before publication');
  await mkdir(independent.nonceDirectory, { recursive: true, mode: 0o700 });
  const nonceDirectory = await directory(independent.nonceDirectory);
  const intent = { schemaVersion: 1, state: 'publication-started-inspect-before-retry', repository: REPOSITORY,
    runId, attempt, source: admittedSha, runNonce: request.runNonce, requestSha256: sha256(local['request.json']),
    bundleSha256: sha256(verified.bundleBytes), startedAt: new Date(now()).toISOString(), evidenceDir };
  await writeExclusive(resolve(nonceDirectory, `${runId}-${attempt}-${request.runNonce}.json`), encode(intent));
  await writeExclusive(resolve(evidenceDir, 'publication-intent.json'), encode(intent));
  const blob = await api.post(`/repos/${REPOSITORY}/git/blobs`, { encoding: 'base64', content: verified.bundleBytes.toString('base64') });
  await writeExclusive(resolve(evidenceDir, 'blob-response.json'), encode(blob));
  const blobSha = createHash('sha1').update(`blob ${verified.bundleBytes.length}\0`).update(verified.bundleBytes).digest('hex');
  const targetUrl = `https://api.github.com/repos/${REPOSITORY}/git/blobs/${blobSha}`;
  assert(blob.sha === blobSha && blob.url === targetUrl, 'Created blob identity differs');
  run = await api.get(`/repos/${REPOSITORY}/actions/runs/${runId}`);
  authenticateMetadata({ repository, user, run, request, admitted });
  assert(now() < date(request.expiresAt), 'Request expired after blob upload; success was not published');
  const status = await api.post(`/repos/${REPOSITORY}/statuses/${admittedSha}`, { state: 'success',
    context: request.statusContext, description: `sha256:${sha256(verified.bundleBytes)}`, target_url: targetUrl });
  await writeExclusive(resolve(evidenceDir, 'status-response.json'), encode(status));
  validateStatus(status, request, now());
  await writeExclusive(resolve(evidenceDir, 'published.json'), encode({ schemaVersion: 1, state: 'published',
    source: admittedSha, runId, attempt, runNonce: request.runNonce, statusId: status.id,
    blobSha, bundleSha256: sha256(verified.bundleBytes) }));
  return { state: 'published', source: admittedSha, runId, attempt, statusId: status.id, evidenceDir };
}

function optionsFromArgs(args) {
  const names = new Map([['--request-dir', 'requestDir'], ['--worker-output', 'workerOutput'], ['--repo', 'repo'],
    ['--run-id', 'runId'], ['--attempt', 'attempt'], ['--source', 'source']]);
  assert(args.length === names.size * 2, 'Six explicit named publisher arguments required');
  const options = {};
  for (let at = 0; at < args.length; at += 2) {
    const name = names.get(args[at]); assert(name && !Object.hasOwn(options, name) && args[at + 1], 'Unknown or duplicate argument');
    options[name] = args[at + 1];
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  publishResult(optionsFromArgs(process.argv.slice(2))).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`GPU publication failed: ${error.message}\n`); process.exitCode = 1; });
}
