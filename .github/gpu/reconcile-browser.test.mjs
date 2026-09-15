import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BROWSER_POLICY, finalGpuExpectations, reconcileBrowser, requireSuccessfulJobs } from './reconcile-browser.mjs';
import { makeRequest, validateRequest } from './hosted-gate.mjs';

const baseline = JSON.parse(readFileSync(new URL('./browser-baseline.json', import.meta.url), 'utf8'));
const expected = { repository: 'codemaker66/omnitwin', runId: '12345', runAttempt: '2',
  commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), runUrl: 'https://github.com/codemaker66/omnitwin/actions/runs/12345' };

// Synthetic reports use the retained identities and expected statuses, but they
// are unit fixtures only. They never become hosted or hardware evidence.
function report(rows, shard, execution = false) {
  const root = { config: { version: BROWSER_POLICY.playwright, shard, workers: 1,
    updateSnapshots: 'none', projects: [{ id: 'chromium', repeatEach: 1 }],
    metadata: { ci: { commitHash: expected.commitSha, buildHref: expected.runUrl }, gitCommit: { hash: expected.commitSha } } },
  errors: [], suites: [], stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0 } };
  for (const row of rows) {
    let children = root.suites, parent;
    for (const title of row.suitePath) {
      parent = children.find((entry) => entry.title === title);
      if (!parent) { parent = { title, suites: [], specs: [] }; children.push(parent); }
      children = parent.suites;
    }
    const status = row.expectedStatus === 'skipped' ? 'skipped' : 'expected';
    parent.specs.push({ id: row.id, file: row.file, title: row.title,
      tests: [{ projectId: row.project, expectedStatus: row.expectedStatus,
        results: execution ? [{ status: row.expectedStatus, retry: 0, duration: 20 }] : [],
        status: execution ? status : 'skipped' }] });
    if (execution) root.stats[status]++;
  }
  return root;
}

function fixture() {
  const cpu = baseline.cases.filter((row) => row.file !== BROWSER_POLICY.gpuFile);
  const gpu = baseline.cases.filter((row) => row.file === BROWSER_POLICY.gpuFile);
  return { inventory: report(baseline.cases, null), baseline: structuredClone(baseline), expected: structuredClone(expected),
    gpuReport: report(gpu, null, true), cpuShards: [1, 2, 3, 4].map((shard) => {
      const rows = cpu.filter((_, index) => index % 4 === shard - 1);
      return { inventory: report(rows, { current: shard, total: 4 }),
        results: report(rows, { current: shard, total: 4 }, true), inventorySha256: 'c'.repeat(64), resultsSha256: 'd'.repeat(64),
        identity: { schemaVersion: 1, ...expected, shard, inventorySha256: 'c'.repeat(64), resultsSha256: 'd'.repeat(64) } };
    }) };
}

function specs(report) {
  const rows = [];
  function walk(suites) { for (const suite of suites) { rows.push(...suite.specs); walk(suite.suites ?? []); } }
  walk(report.suites); return rows;
}
function testRow(input, expectedStatus = 'passed') {
  for (const shard of input.cpuShards) {
    const spec = specs(shard.results).find((entry) => entry.tests[0].expectedStatus === expectedStatus);
    if (spec) return { shard, spec, test: spec.tests[0] };
  }
  throw new Error('fixture case not found');
}
function rejected(title, mutate, pattern) {
  test(title, () => { const input = fixture(); mutate(input); assert.throws(() => reconcileBrowser(input), pattern); });
}

test('full353 union requires348 CPU and all5 GPU with original42 skips and4 executed expected failures', () => {
  const result = reconcileBrowser(fixture());
  assert.equal(result.verdict, 'complete-browser-gate-passed');
  assert.deepEqual(result.totals, { inventory: 353, cpu: 348, gpu: 5, ordinaryPasses: 307,
    expectedFailures: 4, originalSkips: 42, failed: 0, flaky: 0, retries: 0,
    missing: 0, duplicated: 0, interrupted: 0, unrun: 0 });
});
rejected('missing CPU shard cannot pass', (input) => input.cpuShards.pop(), /four CPU/);
rejected('full inventory cannot silently omit a case', (input) => input.inventory.suites.shift(), /missing or extra/);
rejected('new test identity requires reviewed baseline update', (input) => specs(input.inventory)[0].id = 'new-case', /missing or extra/);
rejected('same ID cannot hide changed test title', (input) => specs(input.inventory)[0].title = 'different assertion', /identity changed/);
rejected('a CPU result cannot be missing while its inventory remains', (input) => {
  const { shard, spec } = testRow(input); function remove(suites) { for (const suite of suites) {
    suite.specs = suite.specs.filter((entry) => entry !== spec); remove(suite.suites ?? []); } }
  remove(shard.results.suites); shard.results.stats.expected--;
}, /missing or extra/);
rejected('a skipped original must not become an unrun ordinary case', (input) => {
  const { test } = testRow(input, 'skipped'); test.expectedStatus = 'passed';
}, /policy changed/);
rejected('new skips cannot replace successful execution', (input) => {
  const { test } = testRow(input); test.expectedStatus = 'skipped'; test.results[0].status = 'skipped'; test.status = 'skipped';
}, /policy changed/);
rejected('expected failure must actually execute and fail', (input) => {
  const { test } = testRow(input, 'failed'); test.results[0].status = 'skipped'; test.status = 'skipped';
}, /failed, flaky, interrupted, or unrun/);
rejected('unexpected pass does not erase expected-failure debt', (input) => testRow(input, 'failed').test.results[0].status = 'passed', /failed, flaky/);
rejected('failed first attempt and green retry stay unqualified', (input) => {
  const { test } = testRow(input); test.results.unshift({ status: 'failed', retry: 0, duration: 1 });
  test.results[1].retry = 1; test.status = 'flaky';
}, /retried or repeated/);
rejected('interrupted attempt is not a skip', (input) => testRow(input, 'skipped').test.results[0].status = 'interrupted', /interrupted/);
rejected('empty execution result is unrun', (input) => testRow(input).test.results = [], /missing, retried/);
rejected('forged aggregate cannot conceal a failure', (input) => input.cpuShards[0].results.stats.expected++, /aggregate/);
rejected('nonzero retry index cannot masquerade as a first try', (input) => testRow(input).test.results[0].retry = 1, /nonzero retry/);
rejected('wrong source SHA is rejected', (input) => input.cpuShards[0].identity.commitSha = 'e'.repeat(40), /source\/run identity/);
rejected('wrong GitHub run metadata is rejected', (input) => input.cpuShards[0].results.config.metadata.ci.buildHref += '1', /wrong hosted run/);
rejected('mixed rerun artifacts are rejected', (input) => input.cpuShards[0].identity.runAttempt = 1, /source\/run identity/);
rejected('altered raw report does not match its recorded hash', (input) => input.cpuShards[0].resultsSha256 = 'e'.repeat(64), /artifact hash/);
rejected('shard labels cannot be swapped', (input) => input.cpuShards.reverse(), /shard configuration/);
rejected('duplicate cases are rejected', (input) => input.cpuShards[0].results.suites.push(structuredClone(input.cpuShards[0].results.suites[0])), /duplicate case/);
rejected('missing GPU case cannot pass a green CPU union', (input) => {
  input.gpuReport.suites[0].specs.pop(); input.gpuReport.stats.expected--;
}, /missing or extra/);
rejected('GPU timing failure cannot be hidden behind authenticated transport', (input) => specs(input.gpuReport)[0].tests[0].results[0].status = 'failed', /failed, flaky/);
rejected('snapshot generation cannot count as visual qualification', (input) => input.cpuShards[0].results.config.updateSnapshots = 'missing', /snapshot updates/);
rejected('global browser error rejects otherwise green cases', (input) => input.gpuReport.errors.push({ message: 'worker died' }), /global browser error/);
rejected('a second browser project cannot silently enlarge scope', (input) => input.inventory.config.projects.push({ id: 'webkit' }), /browser project/);
rejected('inventory that already contains result attempts is not independent listing', (input) => specs(input.inventory)[0].tests[0].results.push({ status: 'passed' }), /inventory contains/);

test('final gate requires successful tooling, every CPU shard group and GPU job', () => {
  const green = { TOOLING_JOB_RESULT: 'success', CPU_JOB_RESULT: 'success', GPU_JOB_RESULT: 'success' };
  assert.doesNotThrow(() => requireSuccessfulJobs(green));
  for (const key of Object.keys(green)) {
    for (const status of ['skipped', 'failure', 'cancelled', undefined])
      assert.throws(() => requireSuccessfulJobs({ ...green, [key]: status }), /all required upstream/);
  }
});

function gpuIdentityFixture() {
  const profile = JSON.parse(readFileSync(new URL('./worker-profile.json', import.meta.url), 'utf8'));
  const repository = { full_name: 'codemaker66/omnitwin', private: false, id: 1234,
    owner: { type: 'User', login: 'codemaker66', id: 5678 } };
  const prepared = makeRequest({ source: { repository: repository.full_name, commitSha: expected.commitSha,
    treeSha: expected.treeSha, sourceHashes: {} }, profile, profileBytes: Buffer.from(JSON.stringify(profile)),
    verifierSha256: 'e'.repeat(64), repository,
    context: { runId: expected.runId, runAttempt: expected.runAttempt, commitSha: expected.commitSha } });
  return { profile, ...prepared, env: { GITHUB_REPOSITORY_ID: '1234', GITHUB_REPOSITORY_OWNER_ID: '5678' } };
}

test('final GPU identity uses automatic GitHub numeric IDs and committed runtime profile', () => {
  const input = gpuIdentityFixture();
  const actual = finalGpuExpectations(input);
  assert.deepEqual(actual, { repositoryId: 1234, operatorId: 5678 });
  assert.doesNotThrow(() => validateRequest({ ...input, expected: actual }));
  for (const key of ['GITHUB_REPOSITORY_ID', 'GITHUB_REPOSITORY_OWNER_ID']) {
    const changed = finalGpuExpectations({ ...input, env: { ...input.env, [key]: '9999' } });
    assert.throws(() => validateRequest({ ...input, expected: changed }), /Unexpected repositoryId|Unexpected operator/);
  }
});

test('missing or unsafe automatic GitHub IDs fail closed', () => {
  const input = gpuIdentityFixture();
  for (const key of ['GITHUB_REPOSITORY_ID', 'GITHUB_REPOSITORY_OWNER_ID']) {
    for (const value of [undefined, '', '0', '-1', '1.2', ' 1234', '01234', '9007199254740992'])
      assert.throws(() => finalGpuExpectations({ ...input, env: { ...input.env, [key]: value } }), /invalid automatic/);
  }
});

test('self-consistent request runtime must still match the committed worker profile', () => {
  const input = gpuIdentityFixture();
  assert.throws(() => finalGpuExpectations({ ...input,
    trusted: { ...input.trusted, renderer: 'ANGLE (different NVIDIA hardware)' } }), /trusted renderer differs/);
  for (const field of Object.keys(input.profile.runtime))
    assert.throws(() => finalGpuExpectations({ ...input, trusted: { ...input.trusted,
      runtime: { ...input.trusted.runtime, [field]: 'different' } } }), /differs from committed worker profile/);
  assert.throws(() => finalGpuExpectations({ ...input, trusted: { ...input.trusted,
    runtime: { ...input.trusted.runtime, unknown: 'extra' } } }), /profile fields differ/);
});
