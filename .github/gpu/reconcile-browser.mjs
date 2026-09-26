import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseJson, sha256 } from './verify-receipt.mjs';
import { validateProfile } from './hosted-gate.mjs';
import { GPU_SCOPE_POLICY } from './gpu-scope.mjs';

// A reviewed inventory is deliberately explicit. Changes to the suite or its
// skip/expected-failure policy require an equally reviewable baseline update.
export const BROWSER_POLICY = Object.freeze({ version: 'venviewer-browser-partition-v1',
  playwright: '1.59.1', project: 'chromium', total: 359, cpu: 354, gpu: 5,
  skipped: 42, expectedFailures: 4, gpuFile: 'twin-performance.spec.ts' });
const HERE = dirname(fileURLToPath(import.meta.url));
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b, message) => requireThat(JSON.stringify(a) === JSON.stringify(b), message);
const read = (file) => { const bytes = readFileSync(file); return { bytes, value: parseJson(bytes, file) }; };
const identity = (row) => ({ id: row.id, file: row.file, title: row.title,
  suitePath: row.suitePath, project: row.project });
const mapUnique = (rows, label) => {
  const mapped = new Map();
  for (const row of rows) {
    requireThat(!mapped.has(row.id), `${label}: duplicate case ${row.id}`);
    mapped.set(row.id, row);
  }
  return mapped;
};
const exactSet = (actual, expected, label) => same([...actual].sort(), [...expected].sort(), `${label}: missing or extra case identities`);

export function flattenReport(report) {
  requireThat(object(report) && Array.isArray(report.suites), 'report suites missing');
  const rows = [];
  function walk(suites, ancestors = [], depth = 0) {
    requireThat(Array.isArray(suites) && depth < 32, 'invalid report suite hierarchy');
    for (const suite of suites) {
      requireThat(object(suite) && typeof suite.title === 'string', 'invalid suite');
      const suitePath = [...ancestors, suite.title];
      requireThat(Array.isArray(suite.specs), 'suite specs missing');
      for (const spec of suite.specs) {
        requireThat(object(spec) && typeof spec.id === 'string' && spec.id.length > 0
          && typeof spec.file === 'string' && typeof spec.title === 'string', 'invalid case identity');
        requireThat(Array.isArray(spec.tests) && spec.tests.length === 1, `one Chromium test required for ${spec.id}`);
        const test = spec.tests[0];
        requireThat(test.projectId === BROWSER_POLICY.project && Array.isArray(test.results), `invalid project or results for ${spec.id}`);
        rows.push({ id: spec.id, file: spec.file, title: spec.title, suitePath,
          project: test.projectId, test });
      }
      walk(suite.suites ?? [], suitePath, depth + 1);
    }
  }
  walk(report.suites);
  requireThat(rows.length <= 20000, 'report case bound exceeded');
  mapUnique(rows, 'report');
  return rows;
}

function checkConfig(report, shard, inventory = false) {
  const config = report.config;
  requireThat(object(config) && config.version === BROWSER_POLICY.playwright, 'Playwright version changed');
  same(config.shard, shard, 'unexpected shard configuration');
  requireThat(Array.isArray(report.errors) && report.errors.length === 0, 'global browser error');
  requireThat(Array.isArray(config.projects) && config.projects.length === 1
    && config.projects[0].id === BROWSER_POLICY.project, 'unexpected browser project');
  if (!inventory) {
    requireThat(config.workers === 1 && config.projects[0].repeatEach === 1, 'worker or repetition policy changed');
    requireThat(config.updateSnapshots === 'none', 'snapshot updates must be disabled');
  }
}

function inventoryRows(report, shard, label) {
  checkConfig(report, shard, true);
  const rows = flattenReport(report);
  requireThat(rows.every((row) => row.test.results.length === 0), `${label}: inventory contains execution results`);
  return rows;
}

function executionRows(report, shard, baseline, label) {
  checkConfig(report, shard);
  const rows = flattenReport(report);
  const counted = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  for (const row of rows) {
    const original = baseline.get(row.id);
    requireThat(original, `${label}: unknown case ${row.id}`);
    same(identity(row), identity(original), `${label}: case identity changed ${row.id}`);
    requireThat(row.test.expectedStatus === original.expectedStatus, `${label}: skip/expected-failure policy changed ${row.id}`);
    const results = row.test.results;
    requireThat(results.length === 1, `${label}: missing, retried or repeated case ${row.id}`);
    const attempt = results[0];
    requireThat(attempt.retry === 0, `${label}: nonzero retry ${row.id}`);
    requireThat(attempt.status === original.expectedStatus, `${label}: failed, flaky, interrupted, or unrun case ${row.id}`);
    const expectedOutcome = original.expectedStatus === 'skipped' ? 'skipped' : 'expected';
    requireThat(row.test.status === expectedOutcome, `${label}: outcome mismatch ${row.id}`);
    requireThat(Number.isFinite(attempt.duration) && attempt.duration >= 0, `${label}: invalid duration`);
    counted[expectedOutcome]++;
  }
  for (const [key, count] of Object.entries(counted))
    requireThat(report.stats?.[key] === count, `${label}: forged or inconsistent ${key} aggregate`);
  return rows;
}

// A change outside the GPU scope (gpu-scope.mjs) is reconciled on the complete
// CPU partition alone; its five GPU cases are recorded as not in scope, never
// as passed. Inside the scope, the authenticated GPU report remains required.
export function reconcileBrowser({ inventory, cpuShards, gpuReport, baseline, expected, gpuRequired = true }) {
  requireThat(baseline.schemaVersion === 1 && baseline.policyVersion === BROWSER_POLICY.version, 'baseline policy mismatch');
  requireThat(Array.isArray(baseline.cases) && baseline.cases.length === BROWSER_POLICY.total, 'baseline count changed');
  const original = mapUnique(baseline.cases, 'baseline');
  requireThat(baseline.cases.filter((row) => row.expectedStatus === 'skipped').length === BROWSER_POLICY.skipped, 'baseline skips changed');
  requireThat(baseline.cases.filter((row) => row.expectedStatus === 'failed').length === BROWSER_POLICY.expectedFailures, 'baseline expected failures changed');
  requireThat(baseline.cases.every((row) => ['passed', 'failed', 'skipped'].includes(row.expectedStatus)), 'invalid baseline expected status');
  const complete = inventoryRows(inventory, null, 'complete inventory');
  exactSet(complete.map((row) => row.id), original.keys(), 'complete reviewed inventory');
  for (const row of complete) same(identity(row), identity(original.get(row.id)), `complete inventory identity changed ${row.id}`);
  const gpuIds = complete.filter((row) => row.file === BROWSER_POLICY.gpuFile).map((row) => row.id);
  requireThat(gpuIds.length === BROWSER_POLICY.gpu, 'GPU file case count changed');
  const cpuIds = complete.filter((row) => row.file !== BROWSER_POLICY.gpuFile).map((row) => row.id);
  requireThat(cpuIds.length === BROWSER_POLICY.cpu, 'CPU case count changed');
  requireThat(Array.isArray(cpuShards) && cpuShards.length === 4, 'four CPU shard artifacts required');
  const scheduled = [], executed = [], shards = [];
  for (let index = 0; index < 4; index++) {
    const shard = index + 1, input = cpuShards[index], label = `CPU shard ${shard}`;
    const expectedShard = { current: shard, total: 4 };
    const listed = inventoryRows(input.inventory, expectedShard, label);
    const results = executionRows(input.results, expectedShard, original, label);
    exactSet(results.map((row) => row.id), listed.map((row) => row.id), label);
    for (const row of listed) same(identity(row), identity(original.get(row.id) ?? {}), `${label}: inventory identity changed`);
    const ci = input.results.config.metadata?.ci;
    requireThat(ci?.buildHref === expected.runUrl && ci.commitHash === expected.commitSha
      && input.results.config.metadata?.gitCommit?.hash === expected.commitSha, `${label}: wrong hosted run or checkout`);
    const receipt = input.identity;
    requireThat(receipt?.schemaVersion === 1 && receipt.repository === expected.repository
      && receipt.runId === expected.runId && receipt.runAttempt === expected.runAttempt
      && receipt.commitSha === expected.commitSha && receipt.treeSha === expected.treeSha
      && receipt.shard === shard, `${label}: source/run identity mismatch`);
    requireThat(receipt.inventorySha256 === input.inventorySha256
      && receipt.resultsSha256 === input.resultsSha256, `${label}: artifact hash mismatch`);
    scheduled.push(...listed); executed.push(...results);
    shards.push({ shard, cases: results.length });
  }
  mapUnique(scheduled, 'CPU scheduled union'); mapUnique(executed, 'CPU executed union');
  exactSet(scheduled.map((row) => row.id), cpuIds, 'CPU partition');
  requireThat(typeof gpuRequired === 'boolean', 'GPU scope decision missing');
  let gpu = [];
  if (gpuRequired) {
    requireThat(object(gpuReport), 'an authenticated GPU report is required inside the GPU scope');
    gpu = executionRows(gpuReport, null, original, 'authenticated GPU report');
    exactSet(gpu.map((row) => row.id), gpuIds, 'GPU partition');
    const union = mapUnique([...executed, ...gpu], 'complete execution union');
    exactSet(union.keys(), original.keys(), 'complete execution union');
  } else {
    requireThat(gpuReport === null, 'a GPU report cannot stand in for a change outside the GPU scope');
    exactSet(executed.map((row) => row.id), cpuIds, 'complete CPU execution');
  }
  const ran = [...executed, ...gpu];
  const limits = ['This browser gate does not assert overall CI, deployment, physical-device performance, or aesthetic acceptance.'];
  if (!gpuRequired) limits.push('No renderer, tour or benchmark file changed, so the five GPU benchmark cases did not run for this change; they are not in scope, not passed.');
  return { schemaVersion: 1, policyVersion: BROWSER_POLICY.version,
    verdict: gpuRequired ? 'complete-browser-gate-passed' : 'cpu-browser-gate-passed-gpu-not-in-scope',
    source: { commitSha: expected.commitSha, treeSha: expected.treeSha },
    run: { repository: expected.repository, runId: expected.runId, runAttempt: expected.runAttempt },
    gpuScope: { required: gpuRequired, cases: gpuIds.length, executed: gpu.length },
    totals: { inventory: complete.length, cpu: executed.length, gpu: gpu.length,
      ordinaryPasses: ran.filter((row) => original.get(row.id).expectedStatus === 'passed').length,
      expectedFailures: BROWSER_POLICY.expectedFailures, originalSkips: BROWSER_POLICY.skipped,
      failed: 0, flaky: 0, retries: 0, missing: 0, duplicated: 0, interrupted: 0, unrun: 0 }, shards,
    limits };
}

export function requireSuccessfulJobs(env, gpuRequired = true) {
  requireThat(env.TOOLING_JOB_RESULT === 'success' && env.CPU_JOB_RESULT === 'success'
    && env.GPU_SCOPE_JOB_RESULT === 'success', 'all required upstream browser jobs must succeed');
  requireThat(env.GPU_SCOPE_OUTPUT === String(gpuRequired), 'the GPU scope job and the independent scope decision disagree');
  requireThat(env.GPU_JOB_RESULT === (gpuRequired ? 'success' : 'skipped'),
    gpuRequired ? 'all required upstream browser jobs must succeed' : 'a GPU job outside the GPU scope must be skipped');
}

export function readGpuScope(scope, expected) {
  requireThat(object(scope) && scope.schemaVersion === 1 && scope.policy === GPU_SCOPE_POLICY
    && typeof scope.required === 'boolean' && Array.isArray(scope.reasons), 'invalid GPU scope decision');
  requireThat(scope.head === expected.commitSha, 'GPU scope decision is for another commit');
  requireThat(scope.required === (scope.reasons.length > 0), 'GPU scope decision is inconsistent with its reasons');
  return scope.required;
}

export function finalGpuExpectations({ env, profile, trusted }) {
  validateProfile(profile);
  function githubId(value, name) {
    requireThat(typeof value === 'string' && /^[1-9]\d*$/u.test(value)
      && Number.isSafeInteger(Number(value)), `invalid automatic ${name}`);
    return Number(value);
  }
  const repositoryId = githubId(env.GITHUB_REPOSITORY_ID, 'repository ID');
  const operatorId = githubId(env.GITHUB_REPOSITORY_OWNER_ID, 'repository owner ID');
  requireThat(trusted.renderer === profile.renderer, 'trusted renderer differs from committed worker profile');
  requireThat(object(trusted.runtime), 'trusted runtime missing');
  same(Object.keys(trusted.runtime).sort(), Object.keys(profile.runtime).sort(), 'trusted runtime profile fields differ');
  for (const field of Object.keys(profile.runtime))
    requireThat(trusted.runtime[field] === profile.runtime[field], `trusted runtime ${field} differs from committed worker profile`);
  return { repositoryId, operatorId };
}

function context(env = process.env) {
  const repository = env.GITHUB_REPOSITORY, runId = env.GITHUB_RUN_ID, runAttempt = env.GITHUB_RUN_ATTEMPT;
  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const treeSha = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  requireThat(repository === 'codemaker66/omnitwin' && /^[1-9]\d*$/u.test(runId ?? '')
    && /^[1-9]\d*$/u.test(runAttempt ?? ''), 'hosted GitHub run identity missing');
  requireThat(/^[0-9a-f]{40}$/u.test(commitSha) && commitSha === env.GITHUB_SHA
    && /^[0-9a-f]{40}$/u.test(treeSha), 'checkout differs from hosted source');
  return { repository, runId, runAttempt, commitSha, treeSha,
    runUrl: `https://github.com/${repository}/actions/runs/${runId}` };
}

function args(argv) {
  const values = new Map();
  requireThat(argv.length % 2 === 0, 'options require values');
  for (let i = 0; i < argv.length; i += 2) {
    requireThat(argv[i].startsWith('--') && !values.has(argv[i]), 'invalid or duplicate option');
    values.set(argv[i], argv[i + 1]);
  }
  return values;
}
function option(values, name) { const value = values.get(name); requireThat(value, `missing ${name}`); values.delete(name); return value; }

async function main() {
  const command = process.argv[2], values = args(process.argv.slice(3));
  const expected = context();
  if (command === 'record-cpu') {
    const directory = resolve(option(values, '--directory')), shard = Number(option(values, '--shard'));
    requireThat(values.size === 0 && Number.isInteger(shard) && shard >= 1 && shard <= 4, 'invalid record-cpu options');
    const inventory = read(resolve(directory, 'inventory.json')), results = read(resolve(directory, 'results.json'));
    const receipt = { schemaVersion: 1, ...expected, shard,
      inventorySha256: sha256(inventory.bytes), resultsSha256: sha256(results.bytes) };
    writeFileSync(resolve(directory, 'identity.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    return;
  }
  requireThat(command === 'verify', 'expected record-cpu or verify');
  const directory = resolve(option(values, '--artifacts-root'));
  const inventory = read(resolve(option(values, '--inventory')));
  const gpuDirectory = resolve(option(values, '--gpu-directory'));
  const source = read(resolve(option(values, '--source'))).value;
  const scopeFile = read(resolve(option(values, '--gpu-scope')));
  const output = resolve(option(values, '--output'));
  requireThat(values.size === 0, 'unknown verification options');
  const gpuRequired = readGpuScope(scopeFile.value, expected);
  requireSuccessfulJobs(process.env, gpuRequired);
  requireThat(source.repository === expected.repository && source.commitSha === expected.commitSha
    && source.treeSha === expected.treeSha, 'independent source manifest differs from checkout');
  const cpuShards = [1, 2, 3, 4].map((shard) => {
    const base = resolve(directory, `playwright-results-${expected.runId}-${expected.runAttempt}-shard-${shard}`, 'playwright-report');
    const listed = read(resolve(base, 'inventory.json')), results = read(resolve(base, 'results.json'));
    return { inventory: listed.value, results: results.value, identity: read(resolve(base, 'identity.json')).value,
      inventorySha256: sha256(listed.bytes), resultsSha256: sha256(results.bytes) };
  });
  const baselineBytes = readFileSync(resolve(HERE, 'browser-baseline.json'));
  if (!gpuRequired) {
    const report = reconcileBrowser({ inventory: inventory.value, cpuShards, gpuReport: null,
      baseline: parseJson(baselineBytes, 'browser-baseline.json'), expected, gpuRequired });
    report.evidence = { fullInventorySha256: sha256(inventory.bytes), gpuScopeSha256: sha256(scopeFile.bytes),
      baselineSha256: sha256(baselineBytes) };
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const { validateRequest, verifyEvidenceBundle } = await import('./hosted-gate.mjs');
  const request = read(resolve(gpuDirectory, 'request.json')), trusted = read(resolve(gpuDirectory, 'trusted.json'));
  const profile = read(resolve(HERE, 'worker-profile.json'));
  const gpuIdentity = finalGpuExpectations({ env: process.env, profile: profile.value, trusted: trusted.value });
  const status = read(resolve(gpuDirectory, 'accepted-status.json'));
  const bundle = read(resolve(gpuDirectory, 'accepted-bundle.json'));
  validateRequest({ request: request.value, trusted: trusted.value, requestBytes: request.bytes,
    expected: { source, runId: expected.runId, runAttempt: expected.runAttempt, ...gpuIdentity,
      verifierSha256: sha256(readFileSync(resolve(HERE, 'verify-receipt.mjs'))),
      profileSha256: sha256(profile.bytes) } });
  const verifiedGpu = verifyEvidenceBundle({ request: request.value, requestBytes: request.bytes,
    trusted: trusted.value, status: status.value, bundleBytes: bundle.bytes, nowMs: Date.now() });
  const resultFile = read(resolve(gpuDirectory, 'results.json'));
  requireThat(resultFile.bytes.equals(verifiedGpu.resultsBytes), 'GPU artifact raw report differs from authenticated bundle');
  const report = reconcileBrowser({ inventory: inventory.value, cpuShards, gpuReport: resultFile.value,
    baseline: parseJson(baselineBytes, 'browser-baseline.json'), expected, gpuRequired });
  report.evidence = { fullInventorySha256: sha256(inventory.bytes), gpuScopeSha256: sha256(scopeFile.bytes),
    gpuBundleSha256: verifiedGpu.bundleSha256, gpuResultsSha256: sha256(resultFile.bytes), baselineSha256: sha256(baselineBytes) };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => { process.stderr.write(`Browser gate rejected: ${error.message}\n`); process.exitCode = 1; });
