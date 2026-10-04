import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BROWSER_POLICY, finalGpuExpectations, readGpuScope, reconcileBrowser, requireSuccessfulJobs } from './reconcile-browser.mjs';
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

test('full379 union requires374 CPU and all5 GPU with original42 skips and4 executed expected failures', () => {
  const result = reconcileBrowser(fixture());
  assert.equal(result.verdict, 'complete-browser-gate-passed');
  assert.deepEqual(result.gpuScope, { required: true, cases: 5, executed: 5 });
  assert.deepEqual(result.totals, { inventory: 379, cpu: 374, gpu: 5, ordinaryPasses: 333,
    expectedFailures: 4, originalSkips: 42, failed: 0, flaky: 0, retries: 0,
    missing: 0, duplicated: 0, interrupted: 0, unrun: 0 });
});

test('outside the GPU scope the complete CPU partition passes and the five GPU cases are not in scope, not passed', () => {
  const input = fixture();
  const result = reconcileBrowser({ ...input, gpuReport: null, gpuRequired: false });
  assert.equal(result.verdict, 'cpu-browser-gate-passed-gpu-not-in-scope');
  assert.deepEqual(result.gpuScope, { required: false, cases: 5, executed: 0 });
  assert.equal(result.totals.cpu, 374);
  assert.equal(result.totals.gpu, 0);
  assert.equal(result.totals.ordinaryPasses, 328);
  assert.match(result.limits.at(-1), /not in scope, not passed/);
});
rejected('outside the GPU scope a missing CPU case still fails', (input) => {
  input.gpuReport = null; input.gpuRequired = false;
  input.cpuShards[0].inventory.suites.shift();
}, /missing or extra/);
rejected('outside the GPU scope a GPU report cannot stand in for the decision', (input) => { input.gpuRequired = false; }, /cannot stand in/);
rejected('inside the GPU scope a missing GPU report fails', (input) => { input.gpuReport = null; }, /authenticated GPU report is required/);
rejected('a missing GPU scope decision fails', (input) => { input.gpuRequired = 'false'; }, /GPU scope decision missing/);

test('the GPU scope decision must be well formed, for this commit and consistent with its reasons', () => {
  const scope = { schemaVersion: 1, policy: 'venviewer-gpu-scope-v1', head: expected.commitSha, required: false, reasons: [] };
  assert.equal(readGpuScope(scope, expected), false);
  assert.equal(readGpuScope({ ...scope, required: true, reasons: [{ path: 'packages/web/src/twin/TwinViewer.tsx', rule: 'tour' }] }, expected), true);
  assert.throws(() => readGpuScope({ ...scope, policy: 'other' }, expected), /invalid GPU scope/);
  assert.throws(() => readGpuScope({ ...scope, head: 'e'.repeat(40) }, expected), /another commit/);
  assert.throws(() => readGpuScope({ ...scope, reasons: [{ path: 'x', rule: 'tour' }] }, expected), /inconsistent/);
  assert.throws(() => readGpuScope({ ...scope, required: true }, expected), /inconsistent/);
});

const approvedSheetAdditions = [
  'd04ac5b0eb52f15c1dda-b7dfb525a73709529c30',
  'd04ac5b0eb52f15c1dda-78f7a968c6554c1a7848',
  'd04ac5b0eb52f15c1dda-3381bf636d92993e3b62',
];
test('the approved-sheet inventory admission adds exactly three ordinary Hallkeeper cases', () => {
  assert.equal(baseline.inventoryAdmissions.length, 36);
  assert.deepEqual(baseline.inventoryAdmissions[0].caseIds, [...approvedSheetAdditions].sort());
  for (const id of approvedSheetAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'hallkeeper.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
});
for (const id of approvedSheetAdditions) {
  rejected(`new approved-sheet case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const enquiriesDeskAdditions = [
  '56d246b2b7e3b26e1a5b-a722a3056e8d7fb868a8',
  '56d246b2b7e3b26e1a5b-d947bd593a7261e63c26',
  '56d246b2b7e3b26e1a5b-2ee24d7db2e8644a450f',
];
test('the Enquiries desk inventory admission adds exactly three ordinary paging and triage cases', () => {
  const admission = baseline.inventoryAdmissions[1];
  assert.equal(admission.date, '2026-09-26');
  assert.equal(admission.sourceFile, 'packages/web/e2e/enquiries-list-paging.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [...enquiriesDeskAdditions].sort());
  for (const id of enquiriesDeskAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'enquiries-list-paging.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
});
for (const id of enquiriesDeskAdditions) {
  rejected(`new Enquiries desk case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const managerRestatement = '2a7be7d54f62686846cb-58cc5679eec69ffec6a7';
const retiredExecutiveCase = '2a7be7d54f62686846cb-8265ef7314e9066c80fb';
test('the role vocabulary admission replaces the retired executive case one for one', () => {
  const admission = baseline.inventoryAdmissions[2];
  assert.equal(admission.date, '2026-09-26');
  assert.equal(admission.sourceFile, 'packages/web/e2e/button-action-audit.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [managerRestatement]);
  assert.equal(baseline.cases.some((entry) => entry.id === retiredExecutiveCase), false);
  const row = baseline.cases.find((entry) => entry.id === managerRestatement);
  assert.equal(row?.file, 'button-action-audit.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the manager restatement cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === managerRestatement);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
rejected('the retired executive identity cannot come back', (input) => {
  specs(input.inventory).find((row) => row.id === managerRestatement).id = retiredExecutiveCase;
}, /missing or extra/);
const frontDoorAdditions = [
  '87761e13124b3ec60b88-54331050a4e4e5daa3ad',
  '87761e13124b3ec60b88-5dafcbe99c38ba7d6fa4',
  '87761e13124b3ec60b88-5ef777fb2ff1af133fa7',
  '87761e13124b3ec60b88-b156cb90e948bf3e6bb0',
  '87761e13124b3ec60b88-b366ac1306fa98f80f89',
  '87761e13124b3ec60b88-cfc541647b682352b7b0',
];
const retiredRiteCases = [
  '9c15d4faad25ce62ae44-292eb8734eeaf3aa8b29',
  '9c15d4faad25ce62ae44-47b818eb1a47a7096fef',
  '9c15d4faad25ce62ae44-59443cffc153ce0d39b9',
  '9c15d4faad25ce62ae44-5a8986d3b416c37c0306',
  '9c15d4faad25ce62ae44-9e802feeec6712050fbb',
  '9c15d4faad25ce62ae44-a1d49f20f71860af2d42',
];
test('the front door admission replaces the Rite responsive cases one for one', () => {
  const admission = baseline.inventoryAdmissions[3];
  assert.equal(admission.date, '2026-09-26');
  assert.equal(admission.sourceFile, 'packages/web/e2e/front-door-responsive.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [...frontDoorAdditions].sort());
  for (const id of frontDoorAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'front-door-responsive.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  for (const id of retiredRiteCases) assert.equal(baseline.cases.some((entry) => entry.id === id), false);
  assert.equal(baseline.cases.filter((entry) => entry.file === 'landing-rite-responsive.spec.ts').length, 0);
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of frontDoorAdditions) {
  rejected(`new front door case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
rejected('a retired Rite identity cannot come back', (input) => {
  specs(input.inventory).find((row) => row.id === frontDoorAdditions[0]).id = retiredRiteCases[0];
}, /missing or extra/);
const composerRestatement = '2a7be7d54f62686846cb-b5882cfaa717d60c4bb7';
const retiredShowcaseCase = '2a7be7d54f62686846cb-86e7512f5819faee972d';
test('the composer restatement replaces the retired room showcase case one for one', () => {
  const admission = baseline.inventoryAdmissions[4];
  assert.equal(admission.date, '2026-09-26');
  assert.equal(admission.sourceFile, 'packages/web/e2e/button-action-audit.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [composerRestatement]);
  assert.equal(baseline.cases.some((entry) => entry.id === retiredShowcaseCase), false);
  const row = baseline.cases.find((entry) => entry.id === composerRestatement);
  assert.equal(row?.file, 'button-action-audit.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the composer restatement cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === composerRestatement);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
rejected('the retired room showcase identity cannot come back', (input) => {
  specs(input.inventory).find((row) => row.id === composerRestatement).id = retiredShowcaseCase;
}, /missing or extra/);
const diaryTimetableAdditions = [
  '7bffe49ce87053aabb53-e28d53e66163015b7bc1',
  '7bffe49ce87053aabb53-0c089f96b25fad709433',
];
test('the Diary timetable inventory admission adds exactly two ordinary Diary cases', () => {
  const admission = baseline.inventoryAdmissions[5];
  assert.equal(admission.date, '2026-09-26');
  assert.equal(admission.sourceFile, 'packages/web/e2e/diary-timetable.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [...diaryTimetableAdditions].sort());
  for (const id of diaryTimetableAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'diary-timetable.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of diaryTimetableAdditions) {
  rejected(`new Diary timetable case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const dashboardPhoneAddition = '2a7be7d54f62686846cb-ac2aff39c47cf155b19e';
test('the dashboard phone admission adds exactly one ordinary button-audit case', () => {
  const admission = baseline.inventoryAdmissions[6];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/button-action-audit.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [dashboardPhoneAddition]);
  const row = baseline.cases.find((entry) => entry.id === dashboardPhoneAddition);
  assert.equal(row?.file, 'button-action-audit.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the dashboard phone case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === dashboardPhoneAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const loadoutCaptionAddition = '2a7be7d54f62686846cb-3c8558010ac96be320bd';
test('the loadout caption admission adds exactly one ordinary button-audit case', () => {
  const admission = baseline.inventoryAdmissions[7];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/button-action-audit.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [loadoutCaptionAddition]);
  const row = baseline.cases.find((entry) => entry.id === loadoutCaptionAddition);
  assert.equal(row?.file, 'button-action-audit.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the loadout caption case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === loadoutCaptionAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const diarySteadyAddition = '7bffe49ce87053aabb53-e85128afb7e7ef756469';
test('the steady Diary admission adds exactly one ordinary timetable case', () => {
  const admission = baseline.inventoryAdmissions[8];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/diary-timetable.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [diarySteadyAddition]);
  const row = baseline.cases.find((entry) => entry.id === diarySteadyAddition);
  assert.equal(row?.file, 'diary-timetable.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the steady Diary case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === diarySteadyAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const diaryReadableAddition = '7bffe49ce87053aabb53-1976117654afc8f112b7';
test('the readable Diary admission adds exactly one ordinary timetable case', () => {
  const admission = baseline.inventoryAdmissions[9];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/diary-timetable.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [diaryReadableAddition]);
  const row = baseline.cases.find((entry) => entry.id === diaryReadableAddition);
  assert.equal(row?.file, 'diary-timetable.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the readable Diary case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === diaryReadableAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const diaryGoToAddition = '7bffe49ce87053aabb53-6009b1633e255c3a44d8';
test('the Go to date admission adds exactly one ordinary timetable case', () => {
  const admission = baseline.inventoryAdmissions[10];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/diary-timetable.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [diaryGoToAddition]);
  const row = baseline.cases.find((entry) => entry.id === diaryGoToAddition);
  assert.equal(row?.file, 'diary-timetable.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the Go to date case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === diaryGoToAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const sheetOnAPhoneAddition = 'd04ac5b0eb52f15c1dda-3671875dd8bd93721565';
test('the sheet-on-a-phone admission adds exactly one ordinary Hallkeeper case', () => {
  const admission = baseline.inventoryAdmissions[11];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/hallkeeper.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [sheetOnAPhoneAddition]);
  const row = baseline.cases.find((entry) => entry.id === sheetOnAPhoneAddition);
  assert.equal(row?.file, 'hallkeeper.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the sheet-on-a-phone case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === sheetOnAPhoneAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const factsInViewAddition = 'd04ac5b0eb52f15c1dda-0f82e100d17e356ec5b9';
test('the facts-in-view admission adds exactly one ordinary Hallkeeper case', () => {
  const admission = baseline.inventoryAdmissions[12];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/hallkeeper.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [factsInViewAddition]);
  const row = baseline.cases.find((entry) => entry.id === factsInViewAddition);
  assert.equal(row?.file, 'hallkeeper.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the facts-in-view case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === factsInViewAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const phoneTurnsAddition = 'd04ac5b0eb52f15c1dda-b094ea32fb1c7d2f42d1';
test('the phone-turns admission adds exactly one ordinary Hallkeeper case', () => {
  const admission = baseline.inventoryAdmissions[13];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/hallkeeper.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [phoneTurnsAddition]);
  const row = baseline.cases.find((entry) => entry.id === phoneTurnsAddition);
  assert.equal(row?.file, 'hallkeeper.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the phone-turns case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === phoneTurnsAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const rejectedBandAddition = 'd04ac5b0eb52f15c1dda-2223fe6b81fd757ce5e7';
test('the rejected-band admission adds exactly one ordinary Hallkeeper case', () => {
  const admission = baseline.inventoryAdmissions[14];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/hallkeeper.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [rejectedBandAddition]);
  const row = baseline.cases.find((entry) => entry.id === rejectedBandAddition);
  assert.equal(row?.file, 'hallkeeper.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the rejected-band case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === rejectedBandAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const dayBoardAddition = '1b07f1b6eeb3a7bdbe8c-1030efa1e1333500384f';
test('the Day Board admission adds exactly one ordinary case in its own spec', () => {
  const admission = baseline.inventoryAdmissions[15];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/day-board.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [dayBoardAddition]);
  const row = baseline.cases.find((entry) => entry.id === dayBoardAddition);
  assert.equal(row?.file, 'day-board.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the Day Board case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === dayBoardAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const missionControlAddition = '02d795642a60b2700198-a0dbff5f707516a8cab6';
test('the Mission Control admission adds exactly one ordinary case in its own spec', () => {
  const admission = baseline.inventoryAdmissions[16];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/mission-control.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [missionControlAddition]);
  const row = baseline.cases.find((entry) => entry.id === missionControlAddition);
  assert.equal(row?.file, 'mission-control.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the Mission Control case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === missionControlAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const handoffPrintAddition = '5c1048b22e59bfa551de-71d5d61e86d22ce7f309';
test('the handoff print admission adds exactly one ordinary case in its own spec', () => {
  const admission = baseline.inventoryAdmissions[17];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/ops-handoff-print.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [handoffPrintAddition]);
  const row = baseline.cases.find((entry) => entry.id === handoffPrintAddition);
  assert.equal(row?.file, 'ops-handoff-print.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the handoff print case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === handoffPrintAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const sheetProgressAddition = '1b07f1b6eeb3a7bdbe8c-542cfb6aca0a4807d9ce';
test('the Day Board progress admission adds exactly one ordinary case to its spec', () => {
  const admission = baseline.inventoryAdmissions[18];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/day-board.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [sheetProgressAddition]);
  const row = baseline.cases.find((entry) => entry.id === sheetProgressAddition);
  assert.equal(row?.file, 'day-board.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the Day Board progress case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === sheetProgressAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const offlineAddition = '02e2c49c5135f0c0642b-6b5e71904176cd01affe';
test('the event-day offline admission adds exactly one ordinary case in its own spec', () => {
  const admission = baseline.inventoryAdmissions[19];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/event-day-offline.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [offlineAddition]);
  const row = baseline.cases.find((entry) => entry.id === offlineAddition);
  assert.equal(row?.file, 'event-day-offline.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the event-day offline case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === offlineAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const deskTruthAdditions = ['b67e2c2a64ecdcab9584-9267af156c6688670414', 'b67e2c2a64ecdcab9584-2cea25214bef25cb31ce'];
test('the Enquiries desk truth admission adds exactly two ordinary cases in their own spec', () => {
  const admission = baseline.inventoryAdmissions[20];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/enquiries-desk-truth.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [...deskTruthAdditions].sort());
  for (const id of deskTruthAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'enquiries-desk-truth.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('an Enquiries desk truth case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === deskTruthAdditions[1]);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const handOffAddition = '7b9624289ed6d12b445b-6fa162adff4dadf1f357';
test('the Enquiries hand-off admission adds exactly one ordinary case in its own spec', () => {
  const admission = baseline.inventoryAdmissions[21];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/enquiries-hand-offs.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [handOffAddition]);
  const row = baseline.cases.find((entry) => entry.id === handOffAddition);
  assert.equal(row?.file, 'enquiries-hand-offs.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the Enquiries hand-off case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === handOffAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const holdDateAddition = '7b9624289ed6d12b445b-b6702d3165727e31079f';
test('the Enquiries hold-a-date admission adds exactly one ordinary case beside the hand-off', () => {
  const admission = baseline.inventoryAdmissions[22];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/enquiries-hand-offs.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [holdDateAddition]);
  const row = baseline.cases.find((entry) => entry.id === holdDateAddition);
  assert.equal(row?.file, 'enquiries-hand-offs.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the Enquiries hold-a-date case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === holdDateAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const staffShellAddition = 'a7170f42603661c54e53-e871335c788cdc8a4191';
test('the staff shell admission adds exactly one ordinary case in its own spec', () => {
  const admission = baseline.inventoryAdmissions[23];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/staff-shell.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [staffShellAddition]);
  const row = baseline.cases.find((entry) => entry.id === staffShellAddition);
  assert.equal(row?.file, 'staff-shell.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected('the staff shell case cannot become a skip', (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === staffShellAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const reviewsDeskAdditions = [
  '9e9155fe8db93c902ffe-1330379a89a6caa01005',
  '9e9155fe8db93c902ffe-74252d0053cd3be8de8a',
];
test('the reviews desk admission adds exactly two ordinary cases in its own spec', () => {
  const admission = baseline.inventoryAdmissions[24];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/reviews-desk.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(admission.caseIds, [...reviewsDeskAdditions].sort());
  for (const id of reviewsDeskAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'reviews-desk.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of reviewsDeskAdditions) {
  rejected(`new reviews desk case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const inlineReviewRestatements = [
  { index: 25, file: 'keyboard-focus-performance.spec.ts', id: '203e5a905de9618d8ebf-709cc8aeff438810fed0',
    retired: '203e5a905de9618d8ebf-53d6b74a46fa0a60a244' },
  { index: 26, file: 'button-action-audit.spec.ts', id: '2a7be7d54f62686846cb-2984429f06c00d2a846c',
    retired: '2a7be7d54f62686846cb-0e87fb2d72252c5333b7' },
];
for (const restatement of inlineReviewRestatements) {
  test(`the inline review confirmation replaces the ${restatement.file} dialog case one for one`, () => {
    const admission = baseline.inventoryAdmissions[restatement.index];
    assert.equal(admission.date, '2026-09-27');
    assert.equal(admission.sourceFile, `packages/web/e2e/${restatement.file}`);
    assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
    assert.deepEqual(admission.caseIds, [restatement.id]);
    assert.equal(baseline.cases.some((entry) => entry.id === restatement.retired), false);
    const row = baseline.cases.find((entry) => entry.id === restatement.id);
    assert.equal(row?.file, restatement.file);
    assert.equal(row?.expectedStatus, 'passed');
    assert.equal(baseline.cases.length, BROWSER_POLICY.total);
  });
  rejected(`the ${restatement.file} restatement cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === restatement.id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
  rejected(`the retired ${restatement.file} dialog identity cannot come back`, (input) => {
    specs(input.inventory).find((row) => row.id === restatement.id).id = restatement.retired;
  }, /missing or extra/);
}
const clientsDeskAdditions = [
  '3e3b1414eeabcd03b8d4-72b37e7c867bb61f775e',
  '3e3b1414eeabcd03b8d4-a70e2bf62e1742711c92',
  '3e3b1414eeabcd03b8d4-f5c507da60e26d87789d',
];
test('the Clients desk admission adds exactly three ordinary cases in its own spec', () => {
  const admission = baseline.inventoryAdmissions[27];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/clients-desk.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.match(admission.sourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(admission.caseIds, [...clientsDeskAdditions].sort());
  for (const id of clientsDeskAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'clients-desk.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of clientsDeskAdditions) {
  rejected(`new Clients desk case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const pipelineDeskAdditions = [
  '67f30a9724b64d86d09f-8fb152b8a91570f92f2e',
  '67f30a9724b64d86d09f-ad667d25db293381c83e',
  '67f30a9724b64d86d09f-323b4fbf0e740285809a',
];
test('the Pipeline desk admission adds exactly three ordinary cases in its own spec', () => {
  const admission = baseline.inventoryAdmissions[28];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/pipeline-desk.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.match(admission.sourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(admission.caseIds, [...pipelineDeskAdditions].sort());
  for (const id of pipelineDeskAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'pipeline-desk.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of pipelineDeskAdditions) {
  rejected(`new Pipeline desk case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const proposalsDeskAdditions = [
  '3d60696039542bd5f8df-d8c8ae0c14d4217057eb',
  '3d60696039542bd5f8df-7ee0a30779e97cef074d',
  '3d60696039542bd5f8df-d7ae8773cfedf792d352',
];
test('the Proposals desk admission adds exactly three ordinary cases in its own spec', () => {
  const admission = baseline.inventoryAdmissions[29];
  assert.equal(admission.date, '2026-09-27');
  assert.equal(admission.sourceFile, 'packages/web/e2e/proposals-desk.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.match(admission.sourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(admission.caseIds, [...proposalsDeskAdditions].sort());
  for (const id of proposalsDeskAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'proposals-desk.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of proposalsDeskAdditions) {
  rejected(`new Proposals desk case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const clientPageAdditions = [
  ['packages/web/e2e/proposal-share-link.spec.ts', 'proposal-share-link.spec.ts', 30, [
    '15e01bc256dfab8f74e3-a3bc29d68edd9824f700',
    '15e01bc256dfab8f74e3-d29553f4335cccadbfd8',
  ]],
  ['packages/web/e2e/proposals-desk.spec.ts', 'proposals-desk.spec.ts', 31, [
    '3d60696039542bd5f8df-2ea22200879023ac08bc',
  ]],
];
test('the client page admissions add exactly three ordinary cases, each in its own spec', () => {
  for (const [sourceFile, file, index, ids] of clientPageAdditions) {
    const admission = baseline.inventoryAdmissions[index];
    assert.equal(admission.date, '2026-09-27');
    assert.equal(admission.sourceFile, sourceFile);
    assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
    assert.match(admission.sourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(admission.caseIds, [...ids].sort());
    for (const id of ids) {
      const row = baseline.cases.find((entry) => entry.id === id);
      assert.equal(row?.file, file);
      assert.equal(row?.expectedStatus, 'passed');
    }
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of clientPageAdditions.flatMap(([, , , ids]) => ids)) {
  rejected(`new client page case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
const proposalLayoutAddition = '3d60696039542bd5f8df-0244d81e64a8c4718988';
test('the proposal layout admission adds exactly one ordinary Proposals desk case', () => {
  const admission = baseline.inventoryAdmissions[32];
  assert.equal(admission.date, '2026-09-28');
  assert.equal(admission.sourceFile, 'packages/web/e2e/proposals-desk.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.match(admission.sourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(admission.caseIds, [proposalLayoutAddition]);
  const row = baseline.cases.find((entry) => entry.id === proposalLayoutAddition);
  assert.equal(row?.file, 'proposals-desk.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected(`new proposal layout case ${proposalLayoutAddition} cannot become a skip`, (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === proposalLayoutAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const priceListAddition = '3d60696039542bd5f8df-1c84e283bfd91fd18132';
test('the price list admission adds exactly one ordinary Proposals desk case', () => {
  const admission = baseline.inventoryAdmissions[33];
  assert.equal(admission.date, '2026-09-29');
  assert.equal(admission.sourceFile, 'packages/web/e2e/proposals-desk.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.match(admission.sourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(admission.caseIds, [priceListAddition]);
  const row = baseline.cases.find((entry) => entry.id === priceListAddition);
  assert.equal(row?.file, 'proposals-desk.spec.ts');
  assert.equal(row?.expectedStatus, 'passed');
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
rejected(`new price list case ${priceListAddition} cannot become a skip`, (input) => {
  const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === priceListAddition);
  spec.tests[0].expectedStatus = 'skipped';
  spec.tests[0].results[0].status = 'skipped';
  spec.tests[0].status = 'skipped';
}, /policy changed/);
const amissingBookAdditions = [
  '14142275415b11e2c874-154e2ed4b2c70d3b3e21',
  '14142275415b11e2c874-23704f2eeca4af15d0bc',
  '14142275415b11e2c874-5d46ce620e17e6acfbc6',
  '14142275415b11e2c874-8c21765e28e540c79f99',
  '14142275415b11e2c874-93ca956a6b8f7b0f401f',
  '14142275415b11e2c874-c7058662ae54480e5136',
  '14142275415b11e2c874-d03fe4fea92538ad6afb',
];
test('the Amissing Book admission replaces only the retired quiz with seven ordinary game cases', () => {
  const admission = baseline.inventoryAdmissions[34];
  assert.equal(admission.date, '2026-09-30');
  assert.equal(admission.sourceFile, 'packages/web/e2e/amissing-book-integration.spec.ts');
  assert.match(admission.sourceBaseCommit, /^[0-9a-f]{40}$/u);
  assert.match(admission.sourceFileSha256, /^[0-9a-f]{64}$/u);
  assert.equal(admission.retiredSourceFile, 'packages/web/e2e/trades-house-craft-quiz-responsive.spec.ts');
  assert.match(admission.retiredSourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(admission.caseIds, amissingBookAdditions);
  assert.equal(admission.expectedStatus, 'passed');
  assert.equal(admission.retiredCaseIds.length, 26);
  assert.equal(new Set(admission.retiredCaseIds).size, 26);
  for (const id of admission.retiredCaseIds) {
    assert.match(id, /^8729f5c7952d2ababb60-/u);
    assert.equal(baseline.cases.some((entry) => entry.id === id), false);
  }
  assert.equal(baseline.cases.some((entry) => entry.file === 'trades-house-craft-quiz-responsive.spec.ts'), false);
  assert.equal(baseline.cases.filter((entry) => entry.file === 'amissing-book-integration.spec.ts').length, 7);
  for (const id of amissingBookAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'amissing-book-integration.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
});
for (const id of amissingBookAdditions) {
  rejected(`new Amissing Book case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
rejected('a retired quiz identity cannot replace a current game case', (input) => {
  specs(input.inventory).find((row) => row.id === amissingBookAdditions[0]).id =
    '8729f5c7952d2ababb60-06dc7448310920144e6a';
}, /missing or extra/);

const templateAdditions = [
  '3d60696039542bd5f8df-610a694deacee71e83fe',
  '3d60696039542bd5f8df-c5e643ce945c7965e556',
];
test('the proposal template admission adds exactly two ordinary Proposals desk cases', () => {
  const admission = baseline.inventoryAdmissions[35];
  assert.equal(admission.date, '2026-10-03');
  assert.equal(admission.sourceFile, 'packages/web/e2e/proposals-desk.spec.ts');
  assert.match(admission.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.match(admission.sourceFileGitBlobSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(admission.caseIds, templateAdditions);
  for (const id of templateAdditions) {
    const row = baseline.cases.find((entry) => entry.id === id);
    assert.equal(row?.file, 'proposals-desk.spec.ts');
    assert.equal(row?.expectedStatus, 'passed');
  }
  assert.equal(baseline.cases.length, BROWSER_POLICY.total);
});
for (const id of templateAdditions) {
  rejected(`new proposal template case ${id} cannot become a skip`, (input) => {
    const spec = input.cpuShards.flatMap((shard) => specs(shard.results)).find((row) => row.id === id);
    spec.tests[0].expectedStatus = 'skipped';
    spec.tests[0].results[0].status = 'skipped';
    spec.tests[0].status = 'skipped';
  }, /policy changed/);
}
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

test('final gate requires successful tooling, every CPU shard group, the scope job and the GPU job in scope', () => {
  const green = { TOOLING_JOB_RESULT: 'success', CPU_JOB_RESULT: 'success', GPU_SCOPE_JOB_RESULT: 'success',
    GPU_SCOPE_OUTPUT: 'true', GPU_JOB_RESULT: 'success' };
  assert.doesNotThrow(() => requireSuccessfulJobs(green, true));
  for (const key of ['TOOLING_JOB_RESULT', 'CPU_JOB_RESULT', 'GPU_SCOPE_JOB_RESULT', 'GPU_JOB_RESULT']) {
    for (const status of ['skipped', 'failure', 'cancelled', undefined])
      assert.throws(() => requireSuccessfulJobs({ ...green, [key]: status }, true), /all required upstream/);
  }
  assert.throws(() => requireSuccessfulJobs({ ...green, GPU_SCOPE_OUTPUT: 'false' }, true), /disagree/);
});

test('outside the GPU scope the GPU job must have been skipped, and the scope job must agree', () => {
  const quiet = { TOOLING_JOB_RESULT: 'success', CPU_JOB_RESULT: 'success', GPU_SCOPE_JOB_RESULT: 'success',
    GPU_SCOPE_OUTPUT: 'false', GPU_JOB_RESULT: 'skipped' };
  assert.doesNotThrow(() => requireSuccessfulJobs(quiet, false));
  for (const status of ['success', 'failure', 'cancelled', undefined])
    assert.throws(() => requireSuccessfulJobs({ ...quiet, GPU_JOB_RESULT: status }, false), /must be skipped/);
  assert.throws(() => requireSuccessfulJobs({ ...quiet, GPU_SCOPE_OUTPUT: 'true' }, false), /disagree/);
  for (const key of ['TOOLING_JOB_RESULT', 'CPU_JOB_RESULT', 'GPU_SCOPE_JOB_RESULT'])
    assert.throws(() => requireSuccessfulJobs({ ...quiet, [key]: 'failure' }, false), /all required upstream/);
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
