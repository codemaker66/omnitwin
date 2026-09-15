import { createHash, randomBytes } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { parseJson, sha256, verifyReceipt } from './verify-receipt.mjs';

const execFile = promisify(execFileCallback);
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY = 'codemaker66/omnitwin';
const API = 'https://api.github.com';
const MAX_BYTES = 20 * 1024 * 1024;
const REQUEST_KEYS = ['schemaVersion', 'repository', 'repositoryId', 'operator', 'sourceCommit',
  'sourceTree', 'runId', 'runAttempt', 'runNonce', 'issuedAt', 'expiresAt', 'statusContext',
  'trustedSha256', 'verifierSha256', 'profileSha256'];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => assert(object(value)
  && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0'), 'Unexpected object fields');
const digest = (value, width = 64) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${width}}$`, 'u').test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const decimal = (value) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value);
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : object(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const same = (a, b, message) => assert(canonical(a) === canonical(b), message);
const instant = (value) => {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value), 'Invalid request timestamp');
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, 'Invalid request timestamp');
  return parsed;
};

export function contextFromEnvironment(env) {
  assert(env.GITHUB_REPOSITORY === REPOSITORY, 'Unexpected repository');
  assert(decimal(env.GITHUB_RUN_ID) && decimal(env.GITHUB_RUN_ATTEMPT), 'Run ID and attempt are required');
  assert(digest(env.GITHUB_SHA, 40), 'Exact GITHUB_SHA is required');
  return { runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, commitSha: env.GITHUB_SHA };
}

export function validateProfile(profile) {
  keys(profile, ['schemaVersion', 'id', 'renderer', 'runtime']);
  assert(profile.schemaVersion === 1 && typeof profile.id === 'string'
    && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(profile.id), 'Invalid worker profile');
  assert(typeof profile.renderer === 'string' && profile.renderer.length < 513
    && /nvidia|radeon|\bamd\b|\bintel\b|apple/iu.test(profile.renderer)
    && !/swiftshader|llvmpipe|softpipe|software|\bwarp\b|microsoft basic|lavapipe/iu.test(profile.renderer), 'Invalid hardware profile');
  keys(profile.runtime, ['node', 'playwright', 'chromium', 'os', 'driver']);
  for (const field of ['node', 'playwright', 'chromium']) assert(typeof profile.runtime[field] === 'string'
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?$/u.test(profile.runtime[field]), 'Invalid runtime version');
  for (const field of ['os', 'driver']) assert(typeof profile.runtime[field] === 'string'
    && /^[^\x00-\x1f]{1,512}$/u.test(profile.runtime[field]), 'Invalid runtime identity');
}

export function validateRequest({ request, trusted, requestBytes, expected = {} }) {
  keys(request, REQUEST_KEYS);
  keys(request.operator, ['id', 'login']);
  assert(request.schemaVersion === 1 && request.repository === REPOSITORY, 'Unexpected request repository/schema');
  assert(positive(request.repositoryId) && positive(request.operator.id)
    && request.operator.login === 'codemaker66', 'Invalid repository/operator identity');
  assert(decimal(request.runId) && decimal(request.runAttempt), 'Invalid run identity');
  assert(typeof request.runNonce === 'string' && /^[A-Za-z0-9_-]{32}$/u.test(request.runNonce), 'Invalid nonce');
  assert(digest(request.sourceCommit, 40) && digest(request.sourceTree, 40), 'Invalid source identity');
  for (const field of ['trustedSha256', 'verifierSha256', 'profileSha256']) assert(digest(request[field]), 'Invalid request digest');
  assert(request.statusContext === `venviewer-gpu/${request.runId}/${request.runAttempt}/${request.runNonce}`, 'Wrong status context');
  const start = instant(request.issuedAt), end = instant(request.expiresAt);
  assert(end > start && end - start <= 30 * 60_000, 'Invalid request lifetime');
  keys(trusted, ['schemaVersion', 'source', 'runNonce', 'renderer', 'runtime']);
  assert(trusted.schemaVersion === 1 && object(trusted.source), 'Invalid trusted input');
  assert(trusted.runNonce === request.runNonce && trusted.source.repository === REPOSITORY
    && trusted.source.commitSha === request.sourceCommit && trusted.source.treeSha === request.sourceTree, 'Trusted source/nonce mismatch');
  assert(sha256(encode(trusted)) === request.trustedSha256, 'Trusted input digest mismatch');
  if (requestBytes !== undefined) same(parseJson(requestBytes), request, 'Request bytes mismatch');
  for (const field of ['runId', 'runAttempt', 'repositoryId', 'verifierSha256', 'profileSha256']) {
    if (expected[field] !== undefined) same(request[field], expected[field], `Unexpected ${field}`);
  }
  if (expected.operatorId !== undefined) same(request.operator.id, expected.operatorId, 'Unexpected operator');
  if (expected.source !== undefined) same(trusted.source, expected.source, 'Independent source mismatch');
  return request;
}

export function makeRequest({ source, profile, profileBytes, verifierSha256, repository, context,
  nowMs = Date.now(), nonce = randomBytes(24).toString('base64url'), lifetimeMs = 25 * 60_000 }) {
  assert(repository.full_name === REPOSITORY && repository.private === false && positive(repository.id)
    && repository.owner?.type === 'User' && repository.owner.login === 'codemaker66'
    && positive(repository.owner.id), 'Repository must be the expected public personal repository');
  assert(source.commitSha === context.commitSha, 'Checkout does not match requested SHA');
  validateProfile(profile);
  const trusted = { schemaVersion: 1, source, runNonce: nonce, renderer: profile.renderer, runtime: profile.runtime };
  const request = { schemaVersion: 1, repository: REPOSITORY, repositoryId: repository.id,
    operator: { id: repository.owner.id, login: repository.owner.login }, sourceCommit: source.commitSha,
    sourceTree: source.treeSha, runId: context.runId, runAttempt: context.runAttempt, runNonce: nonce,
    issuedAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + lifetimeMs).toISOString(),
    statusContext: `venviewer-gpu/${context.runId}/${context.runAttempt}/${nonce}`,
    trustedSha256: sha256(encode(trusted)), verifierSha256, profileSha256: sha256(profileBytes) };
  validateRequest({ request, trusted });
  return { request, trusted, requestBytes: encode(request), trustedBytes: encode(trusted) };
}

export function validateStatus(status, request, nowMs, { allowExpired = false } = {}) {
  assert(object(status) && positive(status.id), 'Invalid status');
  assert(status.context === request.statusContext, 'Wrong status context');
  assert(status.creator?.id === request.operator.id && status.creator?.login === request.operator.login
    && status.creator?.type === 'User', 'Status creator is not the trusted operator');
  const created = Date.parse(status.created_at);
  assert(Number.isFinite(created) && created >= Math.floor(instant(request.issuedAt) / 1000) * 1000
    && created <= instant(request.expiresAt) && created <= nowMs, 'Stale or future status');
  assert(allowExpired || nowMs <= instant(request.expiresAt), 'GPU request expired');
  assert(['pending', 'success', 'failure', 'error'].includes(status.state), 'Unknown status state');
  assert(!['failure', 'error'].includes(status.state), 'GPU worker reported failure');
  if (status.state === 'pending') return null;
  assert(typeof status.description === 'string' && /^sha256:[0-9a-f]{64}$/u.test(status.description), 'Missing evidence digest');
  const prefix = `${API}/repos/${REPOSITORY}/git/blobs/`;
  assert(typeof status.target_url === 'string' && status.target_url.startsWith(prefix)
    && digest(status.target_url.slice(prefix.length), 40), 'Untrusted evidence URL');
  return { blobSha: status.target_url.slice(prefix.length), bundleSha256: status.description.slice(7) };
}

export function verifyEvidenceBundle({ request, requestBytes, trusted, status, bundleBytes, nowMs = Date.now(), allowExpired = true }) {
  validateRequest({ request, trusted, requestBytes });
  const pointer = validateStatus(status, request, nowMs, { allowExpired });
  assert(pointer !== null, 'GPU evidence is still pending');
  assert(sha256(bundleBytes) === pointer.bundleSha256, 'Evidence bundle digest mismatch');
  const bundle = parseJson(bundleBytes, 'GPU evidence bundle');
  keys(bundle, ['schemaVersion', 'requestSha256', 'receipt', 'resultsBase64']);
  assert(bundle.schemaVersion === 1 && bundle.requestSha256 === sha256(requestBytes), 'Evidence request binding mismatch');
  assert(instant(bundle.receipt?.run?.startedAt) >= instant(request.issuedAt)
    && instant(bundle.receipt?.run?.endedAt) <= instant(request.expiresAt), 'Worker execution is outside the request lifetime');
  assert(typeof bundle.resultsBase64 === 'string' && bundle.resultsBase64.length <= MAX_BYTES
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(bundle.resultsBase64), 'Invalid report encoding');
  const resultsBytes = Buffer.from(bundle.resultsBase64, 'base64');
  assert(resultsBytes.toString('base64') === bundle.resultsBase64, 'Non-canonical report encoding');
  const verification = verifyReceipt({ trusted, receipt: bundle.receipt, resultsBytes });
  return { ...pointer, resultsBytes, receipt: bundle.receipt, verification };
}

export class GitHubReader {
  constructor(token, fetcher = fetch) { assert(typeof token === 'string' && token.length > 0, 'GitHub read token required'); this.token = token; this.fetcher = fetcher; }
  async get(path, raw = false) {
    assert(path.startsWith(`/repos/${REPOSITORY}/`) || path === `/repos/${REPOSITORY}`, 'Untrusted API path');
    const response = await this.fetcher(`${API}${path}`, { method: 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20_000) });
    assert(response.ok, `GitHub read failed (${response.status})`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; assert(size <= MAX_BYTES, 'GitHub response exceeds size limit'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    return raw ? bytes : parseJson(bytes, 'GitHub response');
  }
}

export async function matchingStatus(api, request) {
  for (let page = 1; page <= 100; page++) {
    const statuses = await api.get(`/repos/${REPOSITORY}/commits/${request.sourceCommit}/statuses?per_page=100&page=${page}`);
    assert(Array.isArray(statuses) && statuses.length <= 100, 'Invalid status page');
    // GitHub returns newest first. Never fall back to an older success after a failure.
    const matching = statuses.find((status) => typeof status.context === 'string'
      && status.context.toLowerCase() === request.statusContext.toLowerCase());
    if (matching !== undefined) return matching;
    if (statuses.length < 100) return null;
  }
  throw new Error('Status pagination limit exceeded');
}

const gitEnvironment = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' });
async function independentInputs(context) {
  const gitOptions = { env: gitEnvironment(), timeout: 15_000, maxBuffer: MAX_BYTES };
  const repo = (await execFile('git', ['-c', 'core.fsmonitor=false', 'rev-parse', '--show-toplevel'], gitOptions)).stdout.trim();
  const head = (await execFile('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'], gitOptions)).stdout.trim();
  assert(head === context.commitSha, 'GITHUB_SHA does not match checkout HEAD');
  const { stdout } = await execFile(process.platform === 'win32' ? 'python' : 'python3',
    [resolve(HERE, 'source_manifest.py'), '--repo', repo, '--commit', head], { timeout: 75_000, maxBuffer: MAX_BYTES, env: gitEnvironment() });
  const source = parseJson(Buffer.from(stdout), 'independent source');
  const profileBytes = await readFile(resolve(HERE, 'worker-profile.json'));
  const profile = parseJson(profileBytes, 'worker profile'); validateProfile(profile);
  const verifierBytes = await readFile(resolve(HERE, 'verify-receipt.mjs'));
  for (const name of ['source_manifest.py', 'worker-profile.json', 'verify-receipt.mjs', 'hosted-gate.mjs']) {
    assert(source.sourceHashes[`.github/gpu/${name}`] === sha256(await readFile(resolve(HERE, name))), `Uncommitted gate input: ${name}`);
  }
  return { source, profile, profileBytes, verifierSha256: sha256(verifierBytes) };
}

async function checkRun(api, request) {
  const run = await api.get(`/repos/${REPOSITORY}/actions/runs/${request.runId}`);
  assert(String(run.id) === request.runId && String(run.run_attempt) === request.runAttempt
    && run.repository?.id === request.repositoryId && run.status === 'in_progress', 'CI run is no longer the active assigned attempt');
}

export async function prepareDirectory(directory, prepared) {
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await writeFile(resolve(directory, 'request.json'), prepared.requestBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(directory, 'trusted.json'), prepared.trustedBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(directory, 'READY.json'), encode({ schemaVersion: 1,
    requestSha256: sha256(prepared.requestBytes), trustedSha256: sha256(prepared.trustedBytes) }), { flag: 'wx', mode: 0o600 });
}

export async function waitForEvidence({ api, request, requestBytes, trusted, now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  while (now() <= instant(request.expiresAt)) {
    await checkRun(api, request);
    const status = await matchingStatus(api, request);
    if (status !== null) {
      const pointer = validateStatus(status, request, now());
      if (pointer !== null) {
        const bundleBytes = await api.get(`/repos/${REPOSITORY}/git/blobs/${pointer.blobSha}`, true);
        const gitBlobSha = createHash('sha1').update(`blob ${bundleBytes.length}\0`).update(bundleBytes).digest('hex');
        assert(gitBlobSha === pointer.blobSha, 'Git blob identity mismatch');
        const verified = verifyEvidenceBundle({ request, requestBytes, trusted, status, bundleBytes, nowMs: now(), allowExpired: false });
        await checkRun(api, request);
        assert(now() <= instant(request.expiresAt), 'GPU request expired before acceptance');
        return { ...verified, status, bundleBytes };
      }
    }
    await sleep(Math.min(20_000, Math.max(1, instant(request.expiresAt) - now())));
  }
  throw new Error('GPU evidence was not received before expiry');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  assert(argv.length === 3 && ['prepare', 'wait'].includes(argv[0]) && argv[1] === '--output-dir', 'Usage: hosted-gate.mjs prepare|wait --output-dir PATH');
  const directory = resolve(argv[2]); const context = contextFromEnvironment(env);
  const api = new GitHubReader(env.GH_TOKEN || env.GITHUB_TOKEN);
  const inputs = await independentInputs(context);
  const repository = await api.get(`/repos/${REPOSITORY}`);
  if (argv[0] === 'prepare') {
    const prepared = makeRequest({ ...inputs, repository, context });
    await checkRun(api, prepared.request);
    await prepareDirectory(directory, prepared);
    process.stdout.write(`GPU request prepared for ${context.commitSha}; local GPU execution remains separate.\n`);
    return;
  }
  const requestBytes = await readFile(resolve(directory, 'request.json'));
  const trustedBytes = await readFile(resolve(directory, 'trusted.json'));
  const ready = parseJson(await readFile(resolve(directory, 'READY.json')));
  keys(ready, ['schemaVersion', 'requestSha256', 'trustedSha256']);
  assert(ready.schemaVersion === 1 && ready.requestSha256 === sha256(requestBytes)
    && ready.trustedSha256 === sha256(trustedBytes), 'Prepared files changed');
  const request = parseJson(requestBytes), trusted = parseJson(trustedBytes);
  // Re-derive expectations from the current checkout and authenticated repository metadata.
  const expected = makeRequest({ ...inputs, repository, context, nonce: request.runNonce });
  validateRequest({ request, trusted, requestBytes, expected: { source: inputs.source, ...context,
    repositoryId: expected.request.repositoryId, operatorId: expected.request.operator.id,
    verifierSha256: inputs.verifierSha256, profileSha256: sha256(inputs.profileBytes) } });
  same(trusted.renderer, inputs.profile.renderer, 'Worker renderer expectation changed');
  same(trusted.runtime, inputs.profile.runtime, 'Worker runtime expectation changed');
  const result = await waitForEvidence({ api, request, requestBytes, trusted });
  const verificationBytes = encode(result.verification);
  const files = { 'accepted-bundle.json': result.bundleBytes, 'accepted-status.json': encode(result.status),
    'results.json': result.resultsBytes, 'receipt.json': encode(result.receipt), 'verification.json': verificationBytes };
  for (const [name, bytes] of Object.entries(files)) await writeFile(resolve(directory, name), bytes, { flag: 'wx', mode: 0o600 });
  await writeFile(resolve(directory, 'authenticated-result.json'), encode({ schemaVersion: 1,
    verdict: 'hosted-gpu-evidence-verified', repository: REPOSITORY, repositoryId: request.repositoryId,
    sourceCommit: request.sourceCommit, sourceTree: request.sourceTree, runId: request.runId,
    runAttempt: request.runAttempt, runNonce: request.runNonce, requestSha256: sha256(requestBytes),
    trustedSha256: request.trustedSha256, bundleSha256: result.bundleSha256, blobSha: result.blobSha,
    statusId: result.status.id, operatorId: request.operator.id, statusCreatedAt: result.status.created_at,
    resultsSha256: sha256(result.resultsBytes), verificationSha256: sha256(verificationBytes) }), { flag: 'wx', mode: 0o600 });
  process.stdout.write('Hosted gate verified five local GPU cases and retained their source-bound raw evidence.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`GPU gate failed: ${error.message}\n`); process.exitCode = 1; });
}
