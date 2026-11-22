# Railway settings from GitHub (T-751) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merged change to `.railway/` reaches Railway's production settings from GitHub on two approvals by
the founder, and by no other route.

**Architecture:** One workflow, three jobs. The first holds no secret: it reads the gate's four rules back
from GitHub, checks the run is current and shows what the approvals trust. The other two wait on a protected
environment, and each gives the token to one step. Every judgement (the lines, the refusals, the gate, the look
at other deploys, the words) is a small pure module under `.github/railway-settings/`, tested on made-up plans
with Node's own test runner. Railway's tool is started from one function that accepts an exact list of
commands and nothing else.

**Tech Stack:** GitHub Actions on `ubuntu-24.04`. Node 22 with built-ins only (`node:test`, `node:crypto`,
`fetch`) in everything the workflow runs. One locked package, `yaml`, for the CI check alone. Railway's tool
5.74.0 as a release file checked against a SHA-256. Railway's kit 3.17.0 from `.railway/package-lock.json`.

**Spec:** `docs/superpowers/specs/2026-11-22-railway-settings-apply-from-ci-design.md` (sections 6, 8, 9 and
12). Read it with this plan: the plan argues from it. The founder approved it on 22 November 2026.

Written 22 November 2026. Nothing here is built yet.

## The whole build, in order

| Part | What it holds | Who | A token exists |
|---|---|---|---|
| **1. Pull request 1** (Tasks 1 to 15) | The modules and their tests, the CI check, two proofs that need no token, the workflow in rehearsal form | The builder | No |
| **2. Set-up and rehearsal** (Tasks 16 to 18) | The environment and its four rules, the rehearsal, three read-only reads of Railway by hand | The founder, with the builder reading | No |
| **3. Pull request 2** (Tasks 19 to 24) | The two steps that hold the token, then the token itself and the first check with it | The builder, then the founder | From Task 23 |
| **4. Pull request 3** (Tasks 25 to 27) | The folder holds only what a plan reads, the operations page, the new rule, the first run a push starts, the first real change | The builder, the founder, a person watching | Yes |

Each pull request goes to the release lead for review before it merges. Until Task 25 merges, the rule is
unchanged: a reviewed pull request to `.railway/railway.ts`, then an apply by hand with the founder's yes.

## What the design left to the builder (its section 12), decided

| Left open | Decision | Why |
|---|---|---|
| How the tool is installed at an exact, verified version | The Linux release file Railway publishes on GitHub for 5.74.0, fetched with `curl` and checked against a SHA-256 kept in `.github/railway-settings/tool-pin.json` | Railway's CLI page lists pre-built files from its releases as an official way to install. GitHub's release record gives a SHA-256 for each file and marks that release immutable. Railway's CLI page describes no way for its install script to pin a version or to check a sum. The npm route was ruled out earlier (`.railway/README.md`, "Install the kit"): it brings an installer's dependencies into a public lockfile. 5.74.0 is the version the hand apply of 22 November used, so its plan file's shape is the one seen |
| How "the last change that was applied" is found without a token | From this workflow's own run history, read through GitHub's API with the run's read-only token: the newest run on `master` whose step `Nothing is left to change` or `Already up to date` succeeded. Before any such run, the commit `master` was at when the hand apply ran on 22 November | A run that ended either way is a moment when Railway and the file agreed. Nothing has to be written back to the repository, so the approved jobs stay read-only |
| Where the renderer and its tests live | `.github/railway-settings/`, tested by `node --test` in CI's tooling job | That job already runs `node --test .github/gpu/*.test.mjs` on Node 22 with no install (`ci.yml:612-619`). The folder is outside the pnpm workspace (`packages/*`, `tools/*`), so no manifest or lockfile on a watched path changes |
| How step 3 reads other workflows' executing jobs and Railway's state | Jobs: GitHub's API, for the workflow files in a fixed list. Railway: `railway deployment list --json`, through the one tool entry, written to a file on the runner; only a verdict is printed. The running build: the production receipt's method (`production-receipt.yml:85-96` and `117-132`) | Each reader is the narrowest one that answers the question. The list of workflows is checked by CI, so a new migration workflow cannot be forgotten |
| The rehearsal mode | Pull request 1's workflow is the rehearsal. Its two approved jobs name the environment, install and verify everything, read nothing from Railway and hold no reference to the secret. Going live is pull request 2, a reviewed change | A rehearsal that cannot touch a token needs no switch to trust. The release lead reviews the token steps with the rehearsal's results in hand |
| The exact words of the summaries | The table in Task 10, tested word for word | One place to read and to change them |
| The README's new home, and "After the move" | `docs/operations/railway-settings.md`, moved in pull request 3. The same pull request edits "After the move" | Its merge changes `.railway/` without changing a setting, so it is the first run a push starts, read-only, with the founder watching |

## Where this plan departs from the design's letter, and why

1. **One more command of the tool.** Design 6.7 allows "the exact commands of 6.2". Design 6.5 also needs
   Railway's own state, read with the token. That is a fourth command, `railway deployment list`, read-only,
   through the same single entry and the same exact list.
2. **The run's name carries the commit and its message, not a looked-up pull request number.** A run name can
   use only the `github` and `inputs` contexts and has no way to cut text. A merge commit's message names its
   pull request. Step 1's summary looks the number up and prints it.
3. **Step 1 also shows changes to `.github/railway-settings/`.** The design names the settings folder and the
   workflow. The approved steps also run this folder's scripts, so its changes belong in what the first
   approval trusts.
4. **An effect the workflow does not know is refused.** Every change seen so far says `deployEffect: "deploy"`.
   Step 3 must know whether to wait for a redeploy, so any other value is applied by hand until it is added.
5. **A refusal prints its one sentence and then fixed reasons.** The reasons are chosen from a short list and
   name settings only, never a value from Railway.
6. **A redeploy that cannot be confirmed fails the run.** Design 6.6 gives the words. A production redeploy
   nobody confirmed should not show green.
7. **The bypass rule is read from a field GitHub's REST page does not list.** The live answer has
   `can_admins_bypass`; the page's schema for "Get an environment" does not. A missing field is a refusal.

## Not in this plan

Any change to the Deploy workflow. Railway variables. An unattended drift check. A second Railway environment
to test against. A second GitHub account for automated tools (design section 11). A real settings change: the
first one is someone's later pull request, and Task 27 says how it is watched.

## Global Constraints

- **No task touches a watched path.** A merge that changes one deploys production. They are exactly:
  `/Dockerfile`, `/.railwayignore`, `/railway.json`, `/package.json`, `/pnpm-lock.yaml`,
  `/pnpm-workspace.yaml`, `/tsconfig.base.json`, `/packages/api/**`, `/packages/types/**`,
  `/packages/reconstruction-foundry/**`, `/tools/reconstruction-foundry/**`, `/tools/capture-factory/**`,
  `/tools/twin-forge/**`. Each pull request proves it with
  `git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings/cli.mjs watched`,
  which must print `No watched path is touched.`
- **No new dependency in the root `package.json` or `pnpm-lock.yaml`.** Never a `package.json` under `tools/`
  or `packages/`: both are workspace globs, so it would change the lockfile.
- **The approvals are the founder's.** No automated tool approves a `railway-settings` review, creates or
  changes that environment, or sees, creates, pastes or prints the token. Tasks that need him say so in their
  title.
- **In the two approved jobs:** no action but `actions/checkout` pinned to a full commit id, with
  `persist-credentials: false`; no cache; no artifact; read-only permissions (`contents`, `actions`,
  `deployments`); `secrets.RAILWAY_SETTINGS_TOKEN` in the `env` of exactly one step per job, and in no other
  job or workflow.
- **The tool is started from one function,** `runTool` in `tool.mjs`, with one of the exact argument lists of
  Task 3. Never `--confirm-destructive`, `--show-values`, `--decrypt-variables` or `--include-variables`.
- **Nothing the tool writes reaches a log, a summary, an output or a file name.** Its output goes to files in
  `$RUNNER_TEMP/railway-settings/`. A failure prints a fixed sentence and the exit code.
- **Every check is an allow-list.** What is not known to be allowed is refused, and the refusal says the
  change is applied by hand.
- **Fail closed.** A read of GitHub or Railway that fails, or returns a shape the code does not know, is a
  refusal, never a pass.
- **The repository is public.** No address, local path, account or session name, Railway id, hash or project
  name, and no Railway variable name, in code, tests, fixtures, logs, commit messages or pull request text.
  Fixtures use made-up values. Before each push, search the diff for an email address, a drive or user
  folder, and a UUID that does not begin `00000000-0000-`; none may match.
- **Tests never contact Railway or GitHub.** They read fixtures. Only the proof tasks read the real services,
  and they say exactly which reads.
- **No skipped test.** A test that needs Railway's kit fails with a plain message when it is missing.
- **Plain modules:** `.mjs`, Node built-ins only, relative imports with their extension. Only
  `check-workflows.mjs` may import `yaml`. Only `tool.mjs` may import `node:child_process`.
- **Commits** name their files explicitly and end with the project's co-author line.

## Review Focus

Inputs and failures the design implies but does not test, most likely first. Each has its test in the task
that owns the code.

1. **A detail line in a wording Railway has not used before, or one that can be split in more than one way.**
   It must be refused, never guessed. A value that merely holds an arrow or a bracket must still be read
   whole. (Task 2: "a line the reader cannot parse is refused" and "a new value that itself holds an arrow and
   a bracket is read whole".)
2. **The tool fails, hangs or writes no plan file.** The log must hold a fixed sentence and an exit code, and
   nothing the tool wrote. (Task 9: "nothing the tool wrote is in what the flow says".)
3. **GitHub answers the gate's read with an error, or without the bypass field.** The gate must refuse, not
   pass. (Task 5: "refuses: the bypass answer missing"; Task 12: the wiring treats any failed read as a
   refusal.)
4. **Step 3 is run again by itself, days later, with step 2's old outputs.** It must refuse before it calls
   the tool. (Task 9: "step 3 refuses a first plan older than six hours before calling the tool".)
5. **The environment's name written in other letters in another workflow** (`Railway-Settings`). GitHub
   treats it as the same environment, so the check must too. (Task 11: "so does the same name in other
   letters".)

---

## File Structure

| File | Responsibility |
|---|---|
| `.github/railway-settings/plan-lines.mjs` | Read a pinned plan; build the lines (design 6.4); work out the refusals (design 6.3) |
| `.github/railway-settings/tool.mjs` | The one place a process is started: the tool, by exact command, and Node, to evaluate the settings file with no token |
| `.github/railway-settings/evaluate-settings.mjs` | The script Node runs to evaluate `.railway/railway.ts` |
| `.github/railway-settings/declared.mjs` | What the file declares, in the names Railway stores; the settings file's own check |
| `.github/railway-settings/gate.mjs` | The four rules; "this run is current"; the last commit at which Railway and the file agreed |
| `.github/railway-settings/look.mjs` | The look of design 6.5: executing jobs, Railway's state, the running build |
| `.github/railway-settings/redeploy.mjs` | The verdict of design 6.6 from GitHub's deployment records |
| `.github/railway-settings/flow.mjs` | The order of the two approved steps, with everything outside injected |
| `.github/railway-settings/words.mjs` | Every sentence and summary |
| `.github/railway-settings/check-workflows.mjs` | The CI check of design 6.7, over every workflow file |
| `.github/railway-settings/cli.mjs` | Wiring only: reads the environment, calls the modules, writes outputs and summaries |
| `.github/railway-settings/install-tool.sh`, `since-last.sh` | Fetch and verify the tool; fetch the last agreed commit's folder |
| `.github/railway-settings/tool-pin.json` | The tool's version, file name and SHA-256 |
| `.github/railway-settings/package.json`, `package-lock.json` | `yaml`, pinned, for the CI check alone |
| `.github/railway-settings/fixtures.mjs` | Made-up plans, shaped like the one seen on 22 November |
| `.github/workflows/railway-settings.yml` | The workflow |
| `.github/workflows/ci.yml` | The tooling job runs the tests and the check; the idle watch-list step is replaced |
| `docs/operations/railway-settings.md` | The README's new home (pull request 3) |

**Names every task uses.** The environment is `railway-settings`. The secret is `RAILWAY_SETTINGS_TOKEN`. The
jobs are `gate` ("Check the gate, show the change"), `plan` ("Read Railway's plan") and `apply` ("Apply this
plan"). The work folder on a runner is `$RUNNER_TEMP/railway-settings/`, called WORK below; the pinned plan is
`WORK/plan.json`. The refusal sentence is `This change is applied by hand.`

---

# Part one: pull request 1 (everything that needs no token)

Tasks 1 to 15. After it merges, a "Railway settings" workflow exists whose approved jobs do nothing with
Railway, CI checks every workflow file on every change, and nothing on Railway or in production has changed.

### Task 1: Read a plan and write its lines

**Files:**
- Create: `.github/railway-settings/plan-lines.mjs`, `.github/railway-settings/fixtures.mjs`
- Test: `.github/railway-settings/plan-lines.test.mjs`
- Modify: `.gitattributes` (add `.github/railway-settings/** text eol=lf`, beside the line for `.github/gpu/**`)
- Modify: `.github/workflows/ci.yml` (`gate-tooling`, after the step at lines 621-631: a step
  `Railway settings from GitHub: the modules` running `node --test .github/railway-settings/*.test.mjs`)

**Interfaces:**
- Produces:
  - `HAND = 'This change is applied by hand.'`
  - `readPlan(text: string): Plan`. Parses, then checks the shape: `kind === 'railway.config.plan'`,
    `version === 1`, `cliVersion` a string, `sourceTree` 40 hex characters, `destructive` a boolean,
    `changeSet.changes` and `changeSet.diagnostics` arrays. Anything else throws an `Error` whose message is
    exactly `Railway's plan could not be read.`
  - `renderPlan(plan, ctx): { pending: boolean, lines: string[], refusals: string[], deploys: boolean }`,
    where `ctx = { service, sourceTree, toolVersion, declaredLast, declaredNow }`. `declaredLast` and
    `declaredNow` are `{ build: object, deploy: object }` in the names Railway stores (Task 4), or `null`.
  - `digestLines(lines: string[]): string`, the SHA-256 of `JSON.stringify(lines)` in hex.
  - `planIds(plan): string[]`, the values to mask: `environmentId`, `configEtag`, `changeSetHash`.
  - In `fixtures.mjs`: `plan(changes, overrides?)`, `change(overrides?)` and `CTX`.

**The shape seen on 22 November,** which the fixtures copy with made-up values. A plan has `kind`, `version`,
`cliVersion`, `sourceTree`, `environmentId`, `configEtag`, `changeSetHash`, `changeSet`, `diff`, `destructive`
and `claim`. `changeSet` has `changes`, `declared`, `diagnostics`, `telemetry` and `version`. A change has
`address` (`service.<name>`), `kind` (`resource.update`), `field` (`build` or `deploy`), `path`
(`resources.service.<name>.<field>`), `severity` (`safe`), `deployEffect` (`deploy`), `summary`, `details`,
`before` and `after`. A detail is one string: `deploy.healthcheckTimeout (2700 → 3000)`, with JSON on both
sides of the arrow and `null` for "not set". `after` holds what the file declares for that group. `before`
holds what Railway runs with, including settings the file does not declare and defaults Railway fills in: one
detail that day said `null` where `before` held a default. Two things follow: a key that is in `before` and
not in `after` is not a change, and the details, not `before`, say what changes and what the old value was.

`change()` is the update above for the service `example-api`, with `before` and `after` each holding
`healthcheckPath`, `healthcheckTimeout`, `startCommand` and `multiRegionConfig` (one made-up region, one
replica), and `before` also holding `runtime`. `plan(changes)` wraps them with `cliVersion: '5.74.0'`, a
`sourceTree` of forty `1`s, `environmentId: '00000000-0000-4000-8000-000000000001'`, `destructive: false`,
`declared: ['service.example-api']` and no diagnostics. `CTX` is `{ service: 'example-api', sourceTree: <the
same forty 1s>, toolVersion: '5.74.0', declaredLast: { build: {}, deploy: <change().before without runtime> },
declaredNow: { build: {}, deploy: <change().after> } }`.

**How a line is built.** For each detail of each allowed change (Task 2 says which are allowed):

1. Read it as `<name> (<old> → <new>)`. `<name>` is `build` or `deploy` followed by one or more dotted parts.
   Split the bracket's contents at an arrow so that both sides are JSON; exactly one split must work.
2. The new value is `after` at that name. It must equal `<new>` (deep, key order ignored).
3. The old value is shown only when it equals `declaredLast` at that name (`null` and missing are equal).
   Otherwise the line says Railway holds something else.
4. When `ctx.declaredNow[field]` does not equal the change's `after`, the kit and the tool read the file
   differently: every old value of that change is hidden and one line says so.

The lines, sorted by name, then one last line binding everything the file declares for the changed groups:

```
deploy.drainingSeconds: (not set) -> 30
deploy.healthcheckTimeout: 2700 -> 3000
deploy.startCommand: (Railway holds something else) -> "node server.js"
1 change is outside what this workflow applies.
(old values hidden: the kit and the tool read the file differently)
declared: 3f9a0c1e5b7d2a46
```

Values are compact JSON. `declared:` is the first 16 hex characters of the SHA-256 of the changes' `after`
objects, keys sorted. A change that is not allowed is counted, never described.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlan, renderPlan, digestLines, planIds } from './plan-lines.mjs';
import { plan, change, CTX } from './fixtures.mjs';

test('a plan with no change is not pending and has no lines', () => {
  assert.deepEqual(renderPlan(plan([]), CTX), { pending: false, lines: [], refusals: [], deploys: false });
});
test('a safe update reads as the design writes it', () => {
  const r = renderPlan(plan([change()]), CTX);
  assert.equal(r.lines[0], 'deploy.healthcheckTimeout: 2700 -> 3000');
  assert.match(r.lines.at(-1), /^declared: [0-9a-f]{16}$/);
  assert.deepEqual([r.pending, r.deploys, r.refusals], [true, true, []]);
});
test('an old value the file never declared is not shown', () => {
  const drifted = change({ details: ['deploy.startCommand ("node made-up-old.js" → "node server.js")'] });
  const r = renderPlan(plan([drifted]), CTX);
  assert.equal(r.lines[0], 'deploy.startCommand: (Railway holds something else) -> "node server.js"');
  assert.ok(!JSON.stringify(r).includes('made-up-old'));
});
test('a setting Railway did not hold, and the file did not declare, reads as not set', () => { /* null → 30 */ });
test('settings only Railway stores are not lines', () => { /* before.runtime never appears */ });
test('when the kit and the tool read the file differently, old values are hidden and a line says so', () => { /* declaredNow.deploy differs from after */ });
test('with no last agreed declaration every old value is hidden', () => { /* declaredLast: null */ });
test('the same plan gives the same lines and digest; a different after gives a different last line', () => { /* digestLines */ });
test('the ids to mask are the three the plan holds, and none of them is in a line', () => { /* planIds */ });
test('a file that is not a plan cannot be read', () => {
  for (const text of ['', '{}', '[]', JSON.stringify({ ...plan([]), kind: 'something.else' }), 'not json'])
    assert.throws(() => readPlan(text), { message: "Railway's plan could not be read." });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test .github/railway-settings/plan-lines.test.mjs`
Expected: FAIL, `Cannot find module` for `plan-lines.mjs`.

- [ ] **Step 3: Write `fixtures.mjs` and `plan-lines.mjs`** with the exports above. In this task every change
  is treated as allowed; Task 2 adds the refusals.

- [ ] **Step 4: Run the tests**

Run: `node --test .github/railway-settings/plan-lines.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/plan-lines.mjs .github/railway-settings/fixtures.mjs .github/railway-settings/plan-lines.test.mjs .gitattributes .github/workflows/ci.yml
git commit -m "feat(ci): read a Railway plan and write its lines (T-751)"
```

**What a person sees:** nothing yet. CI's tooling job runs ten more tests.

### Task 2: What step 3 refuses

**Files:**
- Modify: `.github/railway-settings/plan-lines.mjs`
- Test: `.github/railway-settings/plan-refusals.test.mjs`

**Interfaces:**
- Produces: `renderPlan(...).refusals`, a list of fixed reasons, empty when the plan may be applied. The
  reasons, each at most once, in this order:
  - `the plan is for another version of the tool` (`cliVersion !== ctx.toolVersion`)
  - `the plan is for another copy of the settings folder` (`sourceTree !== ctx.sourceTree`)
  - `Railway marks the plan as destructive` (`destructive !== false`)
  - `Railway attached a note to the plan` (`diagnostics` not empty)
  - `it is not an update to this service's build or deploy settings` (a change whose `kind` is not
    `resource.update`, whose `field` is not `build` or `deploy`, whose `address` is not
    `service.<ctx.service>`, or whose `path` is not `resources.service.<ctx.service>.<field>`; or `declared`
    is not exactly `['service.<ctx.service>']`)
  - `Railway does not mark it safe` (`severity !== 'safe'`)
  - `it has an effect this workflow does not know` (`deployEffect !== 'deploy'`)
  - `a line could not be read` (step 1 or 2 of Task 1's rule fails)
  - `it empties <name>` (the new value is `null`, `''`, `[]`, `{}` or missing from `after`), once per name
  - `it lowers the number of replicas` (the sum of `numReplicas` over `after.multiRegionConfig` is below the
    sum over `before.multiRegionConfig`, or `after` has no `multiRegionConfig` and `before` has)
- A change that fails the fifth reason is never rendered: it adds one to the line
  `<n> change(s) is/are outside what this workflow applies.` Its address, summary and details are never read
  into a line.

- [ ] **Step 1: Write the failing tests**

```js
const refusals = (changes, over) => renderPlan(plan(changes, over), CTX).refusals;
const text = (changes, over) => JSON.stringify(renderPlan(plan(changes, over), CTX));

test('a safe update is not refused', () => assert.deepEqual(refusals([change()]), []));
test('an emptied setting is refused by name', () => {
  const emptied = change({ details: ['deploy.preDeployCommand (["node migrate.js"] → null)'],
    before: { preDeployCommand: ['node migrate.js'] }, after: {} });
  assert.deepEqual(refusals([emptied]), ['it empties deploy.preDeployCommand']);
});
test('a removed domain is refused, however Railway words it', () => {
  for (const c of [change({ field: 'domains', path: 'resources.service.example-api.domains' }),
                   change({ field: 'networking', path: 'resources.service.example-api.networking' }),
                   change({ kind: 'resource.delete', address: 'domain.made-up.example' })])
    assert.deepEqual(refusals([c]), ["it is not an update to this service's build or deploy settings"]);
});
test('an added service is refused and its name is never printed', () => {
  const added = change({ kind: 'resource.create', address: 'service.made-up-worker', summary: 'Create service made-up-worker' });
  assert.ok(refusals([added]).length > 0);
  assert.ok(!text([added]).includes('made-up-worker'));
});
test('anything under variables is refused and nothing of it is rendered', () => {
  for (const c of [change({ kind: 'variable.set', address: 'service.example-api', path: 'resources.service.example-api.variables.MADE_UP_NAME', summary: 'Set variable MADE_UP_NAME' }),
                   change({ kind: 'variable.delete', path: 'resources.service.example-api.variables.MADE_UP_NAME' })]) {
    assert.ok(refusals([c]).length > 0);
    assert.ok(!text([c]).includes('MADE_UP_NAME'));
  }
});
test('fewer replicas are refused; more are not', () => { /* 2 → 1 refused, 1 → 2 allowed, the map removed refused */ });
test('a change Railway does not mark safe, or a plan it marks destructive, is refused', () => { /* severity, destructive */ });
test('an effect this workflow does not know is refused', () => { /* deployEffect: 'restart' */ });
test('a plan made by another version of the tool, or for another copy of the folder, is refused', () => { /* cliVersion, sourceTree */ });
test('a line the reader cannot parse is refused', () => {
  for (const d of ['deploy.startCommand changed', 'deploy.startCommand ("a" → "b" → "c")', 'source.branch ("a" → "b")',
                   'deploy.healthcheckTimeout (2700 → 9999)' /* disagrees with after */])
    assert.ok(refusals([change({ details: [d] })]).includes('a line could not be read'));
});
test('a new value that itself holds an arrow and a bracket is read whole', () => {
  const c = change({ details: ['deploy.startCommand ("old" → "run (a → b)")'], after: { startCommand: 'run (a → b)' } });
  assert.deepEqual(refusals([c]), []);
});
test('a safe update beside a refused change: the safe one is rendered, the other only counted', () => { /* two changes */ });
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings/plan-refusals.test.mjs`.
  Expected: FAIL, every `refusals` is `[]`.
- [ ] **Step 3: Add the refusals to `renderPlan`.**
- [ ] **Step 4: Run both test files.** `node --test .github/railway-settings/plan-*.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/plan-lines.mjs .github/railway-settings/plan-refusals.test.mjs
git commit -m "feat(ci): the changes the Railway settings workflow refuses to apply (T-751)"
```

**What a person sees:** nothing yet.

### Task 3: The one place a process is started

**Files:**
- Create: `.github/railway-settings/tool.mjs`, `.github/railway-settings/evaluate-settings.mjs`
- Test: `.github/railway-settings/tool.test.mjs`

**Interfaces:**
- Produces:
  - `allowedCommands(workdir, service): string[][]`, exactly these five:

```
--version
config plan --out <workdir>/plan.json
config apply --plan <workdir>/plan.json --yes
config plan --detailed-exit-code
deployment list --service <service> --json --limit 5
```

  - `assertAllowed(argv, workdir, service): void`. Throws `not an allowed command` unless `argv` equals one of
    the five, element for element. `service` must match `^[@A-Za-z0-9._/-]+$`.
  - `runTool(argv, { toolPath, token, workdir, service, timeoutMs }): Promise<{ code: number }>`. It calls
    `assertAllowed` first. It starts `toolPath` with no shell, `stdin` closed, and standard output and error
    written to `tool-<n>.out` and `tool-<n>.err` in `workdir`. The child's environment is built from nothing:
    `PATH` (the tool's folder first), `HOME`, `_` set to `toolPath`, `RAILWAY_NO_AUTO_UPDATE=1`, `CI=true`,
    `NO_COLOR=1`, and `RAILWAY_TOKEN` set to `token` for every command but `--version`. On a timeout it kills
    the child and returns `{ code: 124 }`. It returns the exit code and nothing else.
  - `evaluateSettings(file): Promise<{ project: object, partial: string | null, takesContext: boolean }>`. It
    starts `process.execPath --experimental-strip-types --disable-warning=ExperimentalWarning
    evaluate-settings.mjs <file>` with an environment that holds `PATH` only, and parses what it prints.

**Why `_` and `PATH` are set.** The kit checks the tool's version by running the program named in `_`, or
`railway` from `PATH` (`.railway/node_modules/railway/dist/iac/index.js`, `assertMinimumIacCliVersion`). Both
must reach the pinned tool. `RAILWAY_NO_AUTO_UPDATE=1` is the tool's own switch for its update check (its
README).

**What `evaluate-settings.mjs` does.** The same as the tool does when it plans: the tool starts Node on a
short script that imports the file, takes its default export, calls it when it is a function, and prints the
result as JSON (the same file's `isNativeCliEvaluation` names that script's marks). This script prints
`{ project, partial, takesContext }`, where `takesContext` is true when the function declares a parameter. It
passes the context `{ environment: 'production', environmentName: 'production' }` through
`createRailwayContext` from `railway/iac`. It needs the kit installed in the file's folder.

- [ ] **Step 1: Write the failing tests**

```js
const W = '/work', S = 'example-api', P = '/work/plan.json';
test('the five commands are allowed, exactly', () => {
  for (const argv of allowedCommands(W, S)) assert.doesNotThrow(() => assertAllowed(argv, W, S));
  assert.equal(allowedCommands(W, S).length, 5);
});
for (const argv of [
  ['config', 'apply', '--yes'],
  ['config', 'apply', '--plan', P, '--yes', '--confirm-destructive'],
  ['config', 'plan', '--out', P, '--show-values'],
  ['config', 'plan', '--out', P, '--decrypt-variables'],
  ['config', 'pull', '--include-variables'],
  ['config', 'plan', '--json'],
  ['config', 'plan', '--out', '/elsewhere/plan.json'],
  ['config', 'plan', '--out', P, '--environment', 'other'],
  ['deployment', 'list', '--service', 'another', '--json', '--limit', '5'],
  ['up'], ['redeploy'], ['variables'], ['config', 'migrate', '--apply'], [],
]) test(`refuses: ${argv.join(' ') || '(nothing)'}`, () => assert.throws(() => assertAllowed(argv, W, S), /not an allowed command/));

test('the tool gets the token under its own name, and nothing else from this process', async () => {
  // A stand-in tool: a script that writes its environment's key names to the file given in STAND_IN_OUT.
  // Assert: the keys are exactly PATH, HOME, _, RAILWAY_NO_AUTO_UPDATE, CI, NO_COLOR, RAILWAY_TOKEN;
  // GITHUB_TOKEN set in this process does not arrive; for --version, RAILWAY_TOKEN does not arrive either.
});
test('what the tool prints goes to files and is not returned', async () => { /* result is { code: 0 } and nothing more */ });
test('a tool that does not finish is stopped and reported as 124', async () => { /* timeoutMs: 200 */ });
test('a command that is not allowed never starts a process', async () => { /* the stand-in leaves no file */ });
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings/tool.test.mjs`. Expected: FAIL,
  module not found.
- [ ] **Step 3: Write `tool.mjs` and `evaluate-settings.mjs`.** The stand-in tool in the tests is a small Node
  script the test writes to a temporary folder and starts through `process.execPath`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/tool.mjs .github/railway-settings/evaluate-settings.mjs .github/railway-settings/tool.test.mjs
git commit -m "feat(ci): one entry for Railway's tool, by exact command (T-751)"
```

**What a person sees:** nothing yet.

### Task 4: What the file declares, read with no token

**Files:**
- Create: `.github/railway-settings/declared.mjs`
- Test: `.github/railway-settings/declared.test.mjs`
- Modify: `.github/workflows/ci.yml` (`gate-tooling`: before the step added in Task 1, a step
  `Install Railway's kit, without scripts` running `npm ci --ignore-scripts --prefix .railway`)

**Interfaces:**
- Consumes: `evaluateSettings(file)` from Task 3.
- Produces:
  - `storedSettings(project): { service: string, build: object, deploy: object }`. It reads the one resource
    of type `service` and returns its `name`, `build` and `deploy`. No table of names is written here: the kit
    already turns the file into the names Railway stores (`normalizeBuild` and `normalizeDeploy` in
    `.railway/node_modules/railway/dist/iac/index.js`: `start` becomes `deploy.startCommand`, `healthcheck`
    becomes `deploy.healthcheckPath`, `preDeploy` becomes the list `deploy.preDeployCommand`, `replicas`
    becomes `deploy.multiRegionConfig`). Those are the names in the `after` objects of the plan of
    22 November. Rule 4 of Task 1 catches a kit that stops matching the tool.
  - `checkSettingsProject(evaluated): string[]`. Problems in plain words, empty when the file may be applied
    from GitHub: variables are not `{ managed: false }`; the project does not declare exactly one resource;
    that resource is not a service; the file exports a partial; the file's function takes the context (the
    token-free evaluation could then differ from the tool's).
  - `expectedLines(last, now): string[]`. The lines Task 1 would write if Railway still held `last`: one per
    name whose value differs between the two declarations, in the same format.

- [ ] **Step 1: Write the failing tests**

```js
// The shape the kit's project() and service() return, with made-up values.
const SERVICE = { address: 'service.example-api', type: 'service', kind: 'github', name: 'example-api',
  build: { builder: 'DOCKERFILE', watchPatterns: ['/a/**'] },
  deploy: { startCommand: 'node server.js', healthcheckPath: '/ready', healthcheckTimeout: 2700,
    preDeployCommand: ['node migrate.js'], multiRegionConfig: { 'made-up-region-1': { numReplicas: 1 } },
    drainingSeconds: 30 } };
const PROJECT = { name: 'made-up', variables: { managed: false }, resources: [SERVICE] };
const evaluated = (over) => ({ project: PROJECT, partial: null, takesContext: false, ...over });

test('what the file declares is its one service\'s build and deploy groups', () => {
  assert.deepEqual(storedSettings(PROJECT), { service: 'example-api', build: SERVICE.build, deploy: SERVICE.deploy });
});
test('the committed file evaluates with no token, passes its own check, and uses the names the plan of 22 November used', async () => {
  const real = await evaluateSettings('.railway/railway.ts');   // fails with a plain message if the kit is not installed
  assert.deepEqual(checkSettingsProject(real), []);
  const { build, deploy } = storedSettings(real.project);
  assert.deepEqual(Object.keys(build).sort(), ['buildCommand', 'buildEnvironment', 'builder', 'dockerfilePath', 'watchPatterns']);
  assert.deepEqual(Object.keys(deploy).sort(), ['drainingSeconds', 'healthcheckPath', 'healthcheckTimeout', 'multiRegionConfig',
    'preDeployCommand', 'preDeployTimeoutSeconds', 'restartPolicyMaxRetries', 'restartPolicyType', 'sleepApplication', 'startCommand']);
  assert.ok(Array.isArray(deploy.preDeployCommand));
});
for (const [name, bad] of [
  ['variables managed', evaluated({ project: { ...PROJECT, variables: { managed: true } } })],
  ['variables left out', evaluated({ project: { ...PROJECT, variables: undefined } })],
  ['a second resource', evaluated({ project: { ...PROJECT, resources: [SERVICE, { ...SERVICE, name: 'second', address: 'service.second' }] } })],
  ['a resource that is not a service', evaluated({ project: { ...PROJECT, resources: [{ ...SERVICE, type: 'database' }] } })],
  ['a partial', evaluated({ partial: 'made-up' })],
  ['a function that takes the context', evaluated({ takesContext: true })],
]) test(`the settings file is refused: ${name}`, () => assert.notDeepEqual(checkSettingsProject(bad), []));
test('the expected lines are the file\'s own change', () => {
  const last = storedSettings(PROJECT);
  const now = { ...last, deploy: { ...last.deploy, healthcheckTimeout: 3000 } };
  assert.deepEqual(expectedLines(last, now), ['deploy.healthcheckTimeout: 2700 -> 3000']);
  assert.deepEqual(expectedLines(last, last), []);
});
```

  The two lists of keys in the second test are what `.railway/railway.ts` declares today. A pull request that
  adds or removes a setting changes them in the same commit.

- [ ] **Step 2: Run it to see it fail.** `npm ci --ignore-scripts --prefix .railway`, then
  `node --test .github/railway-settings/declared.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Write `declared.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS. Also run
  `node --experimental-strip-types --disable-warning=ExperimentalWarning .github/railway-settings/evaluate-settings.mjs .railway/railway.ts`
  and read what it prints: one service, variables unmanaged, no value that is not already in the file.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/declared.mjs .github/railway-settings/declared.test.mjs .github/workflows/ci.yml
git commit -m "feat(ci): what the Railway settings file declares, read with no token (T-751)"
```

**What a person sees:** nothing yet.

### Task 5: The gate

**Files:**
- Create: `.github/railway-settings/gate.mjs`
- Test: `.github/railway-settings/gate.test.mjs`

**Interfaces:**
- Produces:
  - `ENVIRONMENT = 'railway-settings'`
  - `AGREED_STEPS = { plan: 'Already up to date', apply: 'Nothing is left to change' }`
  - `checkEnvironmentRules({ environment, branchPolicies, owner }): string[]`. `environment` is the answer of
    `GET /repos/{owner}/{repo}/environments/railway-settings`, or `null` for a 404. `branchPolicies` is the
    answer of `GET .../environments/railway-settings/deployment-branch-policies`. `owner` is the repository
    owner's login. It returns problems in plain words, empty when all four rules are as design 6.1:
    1. `protection_rules` holds exactly one rule of type `required_reviewers`, with exactly one reviewer, of
       type `User`, whose login equals `owner` without regard to case;
    2. that rule's `prevent_self_review` is exactly `false`;
    3. `deployment_branch_policy` is `{ protected_branches: false, custom_branch_policies: true }`, and
       `branchPolicies.branch_policies` is exactly one entry, `{ name: 'master', type: 'branch' }`;
    4. `can_admins_bypass` is exactly `false`.
    A rule of any type other than `required_reviewers` and `branch_policy` is a problem too.
  - `checkRunIsCurrent({ ref, treeAtRun, treeAtMasterHead }): string[]`. Empty when `ref` is
    `refs/heads/master` and the two tree ids of `.railway` are equal 40-character ids.
  - `lastAgreedCommit({ runs, jobsByRunId, currentRunId, baselineSha }): { sha: string, runId: number | null }`.
    `runs` is `workflow_runs` from `GET .../actions/workflows/railway-settings.yml/runs?branch=master`, newest
    first. `jobsByRunId[id]` is `jobs` from `GET .../actions/runs/{id}/jobs?filter=latest`. The answer is the
    newest run, other than the current one, with `head_branch === 'master'`, in which the job named
    `Apply this plan` has a step named `Nothing is left to change` with conclusion `success`, or the job
    named `Read Railway's plan` has a step named `Already up to date` with conclusion `success`. With none,
    `{ sha: baselineSha, runId: null }`.

The fields of rules 1 to 3 are in GitHub's REST pages "Get an environment" and "List deployment branch
policies". The jobs endpoint is on the page "REST API endpoints for workflow jobs"
(`docs.github.com/en/rest/actions/workflow-jobs`): read it before writing the fixture.

- [ ] **Step 1: Write the failing tests**

```js
const good = () => ({ owner: 'The-Owner',
  environment: { name: 'railway-settings', can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'the-owner' } }] },
                       { type: 'branch_policy' }] },
  branchPolicies: { total_count: 1, branch_policies: [{ name: 'master', type: 'branch' }] } });
const reviewers = (g) => g.environment.protection_rules[0];

test('the four rules as the design sets them pass', () => assert.deepEqual(checkEnvironmentRules(good()), []));
for (const [name, spoil] of [
  ['no environment', (g) => { g.environment = null; }],
  ['no reviewer rule', (g) => { g.environment.protection_rules.shift(); }],
  ['a second reviewer', (g) => { reviewers(g).reviewers.push({ type: 'User', reviewer: { login: 'another' } }); }],
  ['a team as the reviewer', (g) => { reviewers(g).reviewers[0].type = 'Team'; }],
  ['a reviewer who is not the owner', (g) => { reviewers(g).reviewers[0].reviewer.login = 'another'; }],
  ['self-review prevented', (g) => { reviewers(g).prevent_self_review = true; }],
  ['the self-review answer missing', (g) => { delete reviewers(g).prevent_self_review; }],
  ['any branch may deploy', (g) => { g.environment.deployment_branch_policy = null; }],
  ['protected branches, not a named one', (g) => { g.environment.deployment_branch_policy = { protected_branches: true, custom_branch_policies: false }; }],
  ['a second branch rule', (g) => { g.branchPolicies.branch_policies.push({ name: 'release/*', type: 'branch' }); }],
  ['a tag named master', (g) => { g.branchPolicies.branch_policies[0].type = 'tag'; }],
  ['the branch rules could not be read', (g) => { g.branchPolicies = null; }],
  ['administrators may bypass', (g) => { g.environment.can_admins_bypass = true; }],
  ['the bypass answer missing', (g) => { delete g.environment.can_admins_bypass; }],
  ['a wait timer nobody asked for', (g) => { g.environment.protection_rules.push({ type: 'wait_timer', wait_timer: 5 }); }],
]) test(`refuses: ${name}`, () => { const g = good(); spoil(g); assert.notDeepEqual(checkEnvironmentRules(g), []); });

test('a run is current only on master, with master\'s own settings folder', () => { /* another ref; another tree; an empty tree id */ });
test('the last agreed commit is the newest run whose apply left nothing to change', () => { /* ... */ });
test('a run that said already up to date counts', () => { /* ... */ });
test('a rehearsal, a failed apply, a run on another branch and this run itself do not count', () => { /* ... */ });
test('with no such run the baseline is used', () => { /* { sha: baselineSha, runId: null } */ });
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings/gate.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write `gate.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/gate.mjs .github/railway-settings/gate.test.mjs
git commit -m "feat(ci): read the Railway settings gate's four rules back (T-751)"
```

**What a person sees:** nothing yet.

### Task 6: Proof, with no token: Railway's record of a redeploy that an apply starts

Design section 9, third item. Design 6.6 relies on it, and Task 7 builds on its shape.

**Files:** none in the repository. The result goes into Task 7's fixture and the day's session log.

- [ ] **Step 1: Read the public records of 22 November.** The hand apply ran at 14:09 UTC that day
  (`docs/operations/railway-config-move.md`, "The outcome"). Nothing merged in that minute, so a record made
  then, for the commit `master` was already at, can only be the apply's redeploy.

```bash
gh api "repos/{owner}/{repo}/deployments?per_page=100" \
  --jq '.[] | select(.created_at | startswith("2026-11-22T14:09")) | [.id, .created_at, .sha[0:9], .creator.type, .task] | @tsv'
```

Expected: one line, made by a `Bot`, with the task `deploy`, for the commit `master` was at.

- [ ] **Step 2: Read its statuses.**

```bash
gh api "repos/{owner}/{repo}/deployments/<the id from step 1>/statuses" --jq '.[] | [.created_at, .state] | @tsv'
```

Expected: `in_progress` in the same second as the record, `success` about a minute later, and a later
`inactive` when the next deployment replaced it.

- [ ] **Step 3: Write down what Task 7 needs:** the creator's login (the constant `RAILWAY_APP_LOGIN`), the
  three states and their order, and that the record's commit is `master`'s head at the apply, not the commit
  of the run that applied. No id goes into the repository.

**If it is false** (no such record, or it was not made by Railway's app): design 6.6's own fallback. Step 3
reads the deployment's state with the token, through the fourth command of Task 3, and prints only the
verdict. Task 7's `railwayBusy` and Task 9's flow already carry that read, so the change is to make it the
first source, not the second.

**What a person sees:** a paragraph in the session log saying what the record showed.

### Task 7: Other deploys, and the redeploy: the verdicts

**Files:**
- Create: `.github/railway-settings/look.mjs`, `.github/railway-settings/redeploy.mjs`
- Test: `.github/railway-settings/look.test.mjs`, `.github/railway-settings/redeploy.test.mjs`

**Interfaces:**
- Produces, in `look.mjs`:
  - `MIGRATION_WORKFLOWS = ['deploy.yml', 'apply-migration-0018.yml']` (the Deploy workflow's job at
    `deploy.yml:49-106`, and the one other workflow that applies a migration).
  - `executingJobs(jobsByRunId): number`. The number of jobs whose `status` is `in_progress` or `queued`. A job
    that is `waiting` is waiting for a review and does not count.
  - `railwayBusy(list): 'idle' | 'busy' | 'unreadable'`. `list` is the parsed output of the fourth command.
    Busy when any entry's `status` is `BUILDING`, `DEPLOYING`, `INITIALIZING`, `WAITING` or `QUEUED`. Idle when
    every status is `SUCCESS`, `FAILED`, `CRASHED`, `REMOVED` or `REMOVING`. Anything else, including an input
    that is not a list of objects with a `status`, is unreadable. The words are those on Railway's CLI page
    for `railway deployment`; the field's name is confirmed in Task 18.
  - `watchedPathChanged(patterns, files): boolean`. The production receipt's rule
    (`production-receipt.yml:93`): drop the leading `/`, a dot is a dot, `**` is anything, and the whole path
    must match.
  - `buildContainsHead({ relation, patterns, files }): 'contains' | 'unchanged' | 'behind' | 'unknown'`.
    `relation` is the `status` of GitHub's `compare/<master's head>...<the commit the API reports>`.
    `identical` or `ahead` is `contains`. `files` are the names, old names included, that differ from the
    reported commit to `master`'s head. `behind` with no watched path among them is `unchanged`; with one it
    is `behind`. `files` of 300 or more, or `null`, or any other relation, is `unknown`. This is
    `production-receipt.yml:117-132` and `85-96`.
- Produces, in `redeploy.mjs`:
  - `RAILWAY_APP_LOGIN`, from Task 6.
  - `redeployVerdict(records, { appliedAt }): { state: 'none' | 'waiting' | 'live' | 'failed', sha: string | null }`.
    `records` is a list of `{ created_at, sha, creator: { login }, statuses: [{ state, created_at }] }`. Only
    records made by Railway's app at or after `appliedAt` less 30 seconds count; the oldest of them decides.
    Any `failure` or `error` status is `failed`. Otherwise any `success` is `live`, even when a later
    `inactive` follows. Otherwise `waiting`. No such record is `none`.

- [ ] **Step 1: Write the failing tests**

```js
const PATTERNS = ['/Dockerfile', '/.railwayignore', '/railway.json', '/package.json', '/pnpm-lock.yaml', '/pnpm-workspace.yaml',
  '/tsconfig.base.json', '/packages/api/**', '/packages/types/**', '/packages/reconstruction-foundry/**',
  '/tools/reconstruction-foundry/**', '/tools/capture-factory/**', '/tools/twin-forge/**'];

test('watched paths are matched as the production receipt matches them', () => {
  for (const f of ['Dockerfile', 'package.json', 'packages/api/src/index.ts', 'tools/twin-forge/a/b.py'])
    assert.equal(watchedPathChanged(PATTERNS, [f]), true, f);
  for (const f of ['.railway/railway.ts', '.github/workflows/ci.yml', 'docs/a.md', 'packages/web/src/a.ts',
                   'packages/apiary/a.ts', 'tools/package.json', 'xDockerfile', 'Dockerfile.dev'])
    assert.equal(watchedPathChanged(PATTERNS, [f]), false, f);
});
test('the committed watch list is the thirteen paths this plan was written against', () => {
  assert.deepEqual(JSON.parse(readFileSync('.railway/watch-patterns.json', 'utf8')), PATTERNS);
});
test('a Deploy job that is executing counts; one that waits for review does not', () => {
  assert.equal(executingJobs({ 1: [{ status: 'waiting' }, { status: 'completed' }] }), 0);
  assert.equal(executingJobs({ 1: [{ status: 'in_progress' }], 2: [{ status: 'queued' }] }), 2);
});
test('Railway is busy while it builds or deploys, idle otherwise, and unreadable when the shape is not known', () => {
  assert.equal(railwayBusy([{ status: 'SUCCESS' }, { status: 'REMOVED' }]), 'idle');
  for (const s of ['BUILDING', 'DEPLOYING', 'INITIALIZING', 'WAITING', 'QUEUED']) assert.equal(railwayBusy([{ status: 'SUCCESS' }, { status: s }]), 'busy');
  for (const bad of [null, {}, 'SUCCESS', [{}], [{ status: 'A_NEW_WORD' }], [{ state: 'SUCCESS' }]]) assert.equal(railwayBusy(bad), 'unreadable');
});
test('the running build contains master, or nothing the API is built from changed since', () => {
  assert.equal(buildContainsHead({ relation: 'identical', patterns: PATTERNS, files: [] }), 'contains');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: ['docs/a.md'] }), 'unchanged');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: ['packages/api/a.ts'] }), 'behind');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: Array(300).fill('docs/a.md') }), 'unknown');
  assert.equal(buildContainsHead({ relation: 'diverged', patterns: PATTERNS, files: [] }), 'unknown');
});
// redeploy.test.mjs: records shaped as Task 6 found them, with made-up ids and commits.
test('the record Railway\'s app makes after the apply decides', () => { /* in_progress, success → live, with its sha */ });
test('a record made before the apply, or by another app, is ignored', () => { /* → none */ });
test('in progress is waiting; a failure is failed', () => { /* ... */ });
test('a deployment later replaced still counts as live', () => { /* in_progress, success, inactive → live */ });
```

- [ ] **Step 2: Run them to see them fail.** `node --test .github/railway-settings/look.test.mjs
  .github/railway-settings/redeploy.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the two modules.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/look.mjs .github/railway-settings/redeploy.mjs .github/railway-settings/look.test.mjs .github/railway-settings/redeploy.test.mjs
git commit -m "feat(ci): verdicts on other deploys and on the redeploy an apply starts (T-751)"
```

**What a person sees:** nothing yet.

### Task 8: The watched-path check as a command

**Files:**
- Create: `.github/railway-settings/cli.mjs` (the `watched` command only, for now)
- Test: `.github/railway-settings/cli.test.mjs`

**Interfaces:**
- Consumes: `watchedPathChanged` from Task 7.
- Produces: `node .github/railway-settings/cli.mjs watched`. It reads file names from standard input, one a
  line, and the list from `.railway/watch-patterns.json`. With none watched it prints
  `No watched path is touched.` and exits 0. Otherwise it prints each watched name and exits 1.

- [ ] **Step 1: Write the failing test:** start the command with `docs/a.md` and `.railway/railway.ts` on
  standard input and expect the sentence and exit 0; with `packages/api/a.ts` among them expect that name and
  exit 1. The test starts it through `process.execPath` with `node:child_process` imported in the test file
  only.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL, no `cli.mjs`.
- [ ] **Step 3: Write `cli.mjs`** with a command table that holds `watched`.
- [ ] **Step 4: Run it, then use it on this branch.**

Run: `git fetch origin master && git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings/cli.mjs watched`
Expected: `No watched path is touched.`

- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/cli.mjs .github/railway-settings/cli.test.mjs
git commit -m "feat(ci): a command that says whether a change touches a watched path (T-751)"
```

**What a person sees:** a builder can check any branch against the watch list with one command.

### Task 9: The two approved steps as one tested sequence

**Files:**
- Create: `.github/railway-settings/flow.mjs`
- Test: `.github/railway-settings/flow.test.mjs`

**Interfaces:**
- Consumes: `renderPlan`, `readPlan`, `digestLines` (Tasks 1 and 2); `allowedCommands` (Task 3);
  `executingJobs`, `railwayBusy`, `buildContainsHead` (Task 7).
- Produces:
  - `SIX_HOURS = 21600`
  - `planStep(deps): Promise<{ ok: boolean, key: string, code?: number }>`
  - `applyStep(deps, { lines, plannedAt }): Promise<{ outcome: 'applied' | 'refused' | 'failed' | 'left-over', key: string, code?: number, appliedAt?: number, reasons?: string[] }>`.
    `reasons` are Task 2's, given with the key `hand`.
  - `deps = { token, tool, readText, context, github, probe, now }`. `tool(argv)` returns `{ code }`.
    `readText(name)` reads a file in WORK. `context` is Task 1's `ctx`. `github.executing()` returns
    `jobsByRunId` for the runs in progress of `MIGRATION_WORKFLOWS`. `probe()` returns
    `{ relation, patterns, files }`. `now()` is seconds. `key` names a sentence of Task 10.

**The order, which the tests pin.**

`planStep`: with an empty `token`, call nothing and return `noToken`. Otherwise `config plan --out`, then
`deployment list`. A non-zero exit of the first returns `planFailed` with the code. The second's result is
kept for the summary and never fails the step.

`applyStep`, stopping at the first that fails:

1. `plannedAt` is a whole number, not in the future by more than 300 seconds, and at most `SIX_HOURS` old.
   Else `refused`, `stale`. No tool call yet.
2. An empty `token`: `refused`, `noToken`.
3. `config plan --out`. Non-zero: `failed`, `planFailed`.
4. Render it. Its lines must equal `lines` exactly. Else `refused`, `linesDiffer`.
5. It must be pending with no refusals. Not pending: `refused`, `upToDate`. Refusals: `refused`, `hand`.
6. The look. `executingJobs(await github.executing()) > 0`, or `railwayBusy` is `busy`: `refused`, `busy`.
   `buildContainsHead(await probe())` is `behind`: `refused`, `behind`. Anything that could not be read
   (`github.executing` or `probe` throws, `deployment list` exits non-zero, `railwayBusy` is `unreadable`,
   `buildContainsHead` is `unknown`): `refused`, `unread`.
7. `config apply --plan ... --yes`, recording `appliedAt = now()` just before. Non-zero: `failed`,
   `applyFailed`, with the code.
8. `config plan --detailed-exit-code`. `0`: `applied`. `2`: `left-over`, `leftOver`. Other: `failed`,
   `planFailed`.

- [ ] **Step 1: Write the failing tests.** A fake `tool` records each `argv` and answers from a script; a fake
  `readText` returns a plan from `fixtures.mjs`.

```js
const calls = (run) => run.tool.calls.map((argv) => argv.slice(0, 3).join(' '));

test('step 2 with no token stored calls nothing', async () => { /* key 'noToken', calls [] */ });
test('step 2 plans once, then reads Railway\'s state once', async () => {
  assert.deepEqual(calls(run), ['config plan --out', 'deployment list --service']);
});
test('step 3 refuses a first plan older than six hours before calling the tool', async () => {
  const r = await applyStep(run.deps, { lines, plannedAt: run.deps.now() - SIX_HOURS - 1 });
  assert.deepEqual([r.outcome, r.key, calls(run)], ['refused', 'stale', []]);
});
test('step 3 refuses a time from the future, or one that is not a number', async () => { /* ... */ });
test('step 3 does not apply when its own lines differ from step 2\'s', async () => {
  // step 2 read 2700 -> 3000; Railway now plans 2700 -> 3000 and one more line
  assert.deepEqual([r.outcome, r.key, calls(run)], ['refused', 'linesDiffer', ['config plan --out']]);
});
test('step 3 does not apply a plan it refuses', async () => { /* an emptied setting: key 'hand', no apply */ });
for (const [name, spoil] of [['a Deploy job is executing', /* ... */], ['Railway is building', /* ... */],
  ['Railway\'s state cannot be read', /* ... */], ['production is behind master\'s API code', /* ... */],
  ['the running build cannot be placed', /* ... */]])
  test(`step 3 does not apply when ${name}`, async () => { /* no 'config apply' among calls */ });
test('step 3 applies, then plans again, and that is all', async () => {
  assert.deepEqual(calls(run), ['config plan --out', 'deployment list --service', 'config apply --plan', 'config plan --detailed-exit-code']);
  assert.equal(r.outcome, 'applied');
});
test('a second plan that is not empty is left-over, not applied', async () => { /* exit 2 */ });
test('a failed apply never reaches the second plan, and reports its exit code', async () => { /* ... */ });
test('every command the flow gives the tool is one of the five', async () => {
  for (const argv of run.tool.calls) assert.doesNotThrow(() => assertAllowed(argv, W, S));
});
test('nothing the tool wrote is in what the flow says', async () => {
  // the fake tool writes the text MADE-UP-TOOL-OUTPUT to its output files and into plan.json's summary fields
  assert.ok(!JSON.stringify(r).includes('MADE-UP-TOOL-OUTPUT'));
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings/flow.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write `flow.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/flow.mjs .github/railway-settings/flow.test.mjs
git commit -m "feat(ci): the order of the two approved Railway settings steps (T-751)"
```

**What a person sees:** nothing yet.

### Task 10: The words

**Files:**
- Create: `.github/railway-settings/words.mjs`
- Test: `.github/railway-settings/words.test.mjs`

**Interfaces:**
- Produces: `SENTENCES`, by key, and three functions that each return the lines of one summary:
  `gateWords(facts)`, `planWords(facts)`, `applyWords(facts)`.

| Key | The sentence |
|---|---|
| `noEnvironment` | The environment railway-settings does not exist yet. Nothing was started. |
| `gateWrong` | The environment's rules are not as they should be. Nothing was started. |
| `notCurrent` | This run is not for master's settings folder as it is now. Approve the newer run. |
| `trust` | Approving "Read Railway's plan" gives this commit's code the Railway token. |
| `rehearsal` | Rehearsal. No token is stored. Nothing was read from Railway. This step waited for its own approval. |
| `noToken` | No token is stored in the environment. Nothing was read from Railway. |
| `planFailed` | Railway's plan could not be read. Exit code {code}. |
| `upToDate` | Already up to date. Railway holds what the file declares. |
| `redeploys` | Applying this redeploys the API at commit {sha}, with its migration step. |
| `staged` | Before the second approval, look at Railway's dashboard. If it shows staged changes, do not approve. |
| `deployRun` | Do not approve a Deploy run until "Apply this plan" has finished. |
| `hand` | This change is applied by hand. |
| `stale` | The plan was read more than six hours ago. Start a new run. |
| `linesDiffer` | Railway changed since the plan was read. Nothing was applied. Start a new run. |
| `busy` | A deploy or a migration is under way. Nothing was applied. Start a new run later. |
| `behind` | Production does not yet run master's API code. Nothing was applied. |
| `unread` | Something this step must read before it applies could not be read. Nothing was applied. |
| `applyFailed` | The apply failed. Exit code {code}. "Check now" shows what Railway holds. |
| `leftOver` | Applied, but something still differs. A person looks. |
| `applied` | Applied. Nothing is left to change. |
| `headMoved` | master moved while this ran. If the newer commit changed the settings, it has its own run. |
| `live` | Railway reports the new deployment live at commit {sha}. |
| `redeployFailed` | Applied, but Railway reports that the new deployment failed. The previous deployment keeps serving. |
| `notConfirmed` | Applied. The redeploy is not confirmed: no record of it reached GitHub. |

**The three summaries.** Each is a heading and plain lines.

Step 1, `gateWords({ sha, pullRequest, rules, lastAgreed, changed, expected, versions })`:

```
## Railway settings: what this run trusts
Commit abc1234 (pull request #123), on master.
The gate: one reviewer, the repository's owner. Self-review allowed. master only. Administrators cannot bypass.
Railway and the file last agreed at commit def5678 (run 456).
Changed since then, in what the next steps run:
- .railway/railway.ts
What the file changes, in Railway's names:
deploy.healthcheckTimeout: 2700 -> 3000
Railway's tool 5.74.0, kit 3.17.0, Node v22.18.0.
Approving "Read Railway's plan" gives this commit's code the Railway token.
```

With no run to name it says `(the hand apply of 22 November 2026)`. With nothing changed it says
`Nothing changed in what the next steps run.` and `The file declares what it declared then.`

Step 2, `planWords({ render, sha, expected, railway })`: the heading `## Railway's plan`, then the lines of
Task 1. Then one of: `This is what the file's change predicts.` when the lines without their last equal
`expected`; or `Railway differs from the last agreed state in more than the file's change.` Then `redeploys`,
then `Railway is not building or deploying now.` or `Railway is building or deploying now.` or
`Railway's own state could not be read.`, then `staged` and `deployRun`. For a plan with refusals: the lines,
then `hand`, then `Why:` and each reason. For a plan that is not pending: `upToDate` alone.

Step 3, `applyWords({ result, redeploy, headMoved })`: the heading `## Apply this plan`, the sentence for
`result.key`, then for `hand` the line `Why:` and each of `result.reasons`, then for an applied plan the
sentence for the redeploy's state, then `headMoved` when true.

In `redeploys` and `live` the commit is `master`'s head, because that is what Railway deploys. It can be
newer than the run's commit when the settings folder is the same in both.

- [ ] **Step 1: Write the failing tests:** one that holds the table above as data and compares every key; one
  for each summary comparing the whole text for the examples above; one for each row of design 6.8 that
  `applyWords` or `planWords` gives the sentence that row calls for; one that no sentence holds a `{` once its
  values are filled.
- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings/words.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write `words.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/words.mjs .github/railway-settings/words.test.mjs
git commit -m "feat(ci): every sentence the Railway settings workflow says (T-751)"
```

**What a person sees:** nothing yet. These are the words the founder will read on the run's page.

### Task 11: The CI check, and the idle step retired

Design 6.7. It reads every workflow file as YAML and checks structure. It holds no list of banned words.

**Files:**
- Create: `.github/railway-settings/check-workflows.mjs`, `.github/railway-settings/package.json`,
  `.github/railway-settings/package-lock.json`
- Test: `.github/railway-settings/check-workflows.test.mjs`, `.github/railway-settings/hygiene.test.mjs`
- Modify: `.github/workflows/ci.yml`: the header comment at lines 13-15; `gate-tooling`'s `timeout-minutes`
  from 5 to 10; the kit step of Task 4 also runs `npm ci --ignore-scripts --prefix .github/railway-settings`;
  the step at lines 633-672 is replaced by `Railway settings: every workflow file, the settings file, the
  watch list`, running `node .github/railway-settings/check-workflows.mjs`

**What parses YAML.** The `yaml` package, in this folder's own `package.json` and `package-lock.json`,
installed with `npm ci --ignore-scripts`. It is not a root dependency and the folder is outside the pnpm
workspace, so no watched path changes. It reads YAML 1.2, so the key `on` stays a string, and it reports
duplicate keys. `package.json` is `private`, with `yaml` as its one `devDependency` at an exact version: the
newest 2.x release on the day. Only CI's tooling job installs it. The approved jobs never do.

**What becomes of the idle step** ("Railway watch list is valid, and equals railway.json's if that file
exists", `ci.yml:633-672`). `railway.json` was deleted on 22 November, so the step compares nothing. Its two
duties move into the new check: the watch list must be a non-empty list of paths that each begin with `/`
(the production receipt and Task 7 read it), and `railway.json` must not exist at the repository's root. A
file that came back would be read by Railway until 1 December 2026 and ignored after; either is a mistake.

**Interfaces:**
- Produces:
  - `checkWorkflows(files: { [name: string]: string }): string[]`, problems as `file: what is wrong`.
  - `checkWatchList(list: unknown): string[]` and `checkNoOldFile(names: string[]): string[]`.
  - Run as a program, it reads `.github/workflows/*.yml` and `*.yaml`, evaluates `.railway/railway.ts`
    (Tasks 3 and 4), reads the watch list, prints each problem as `::error file=<file>::<problem>` and exits
    1 when there is any. With none it prints `Railway settings: <n> workflow files checked.`

**The rules.** In every workflow file:

1. It parses with no error, and its top level is a map with `jobs`.
2. Every job's `environment`, when present, is a plain string or a map whose `name` is a plain string. A
   value holding `${{` is refused.
3. An environment name that equals `railway-settings`, ignoring case and outer spaces, is allowed only in
   `railway-settings.yml`.
4. No job calls a reusable workflow (`jobs.<id>.uses`) from outside `./.github/workflows/`.
5. The text `secrets.RAILWAY_TOKEN` appears nowhere. The text `RAILWAY_SETTINGS_TOKEN` appears only in
   `railway-settings.yml`.
6. A file whose `run` text holds `db:migrate`, `drizzle-kit migrate` or `apply-migration-` is in
   `MIGRATION_WORKFLOWS` (Task 7).

In `railway-settings.yml`, also:

7. `on` is exactly `push` with `branches: [master]` and `paths: ['.railway/**']`, and `workflow_dispatch` with
   no inputs. No other key.
8. The top-level `permissions` are exactly `contents: read`, `actions: read`, `deployments: read`. No job sets
   its own. There is no top-level `concurrency`.
9. The jobs are exactly `gate`, `plan` and `apply`, named as in "Names every task uses". `gate` has no
   `environment`. `plan` and `apply` have `environment: railway-settings`, as a plain string. `plan` needs
   `gate`; `apply` needs `gate` and `plan`. Each runs on `ubuntu-24.04` and has `timeout-minutes`. None has
   `container`, `services`, `strategy` or `continue-on-error`.
10. Every `uses` is `actions/checkout@` followed by 40 hex characters, with `persist-credentials: false`.
11. Every `run` is, after trimming, one of the lines in `RUN_LINES`, a list held in the check. A step sets no
    `shell`.
12. `${{ secrets.RAILWAY_SETTINGS_TOKEN }}` appears at most once in `plan` and at most once in `apply`, each
    time as the value of `env.RAILWAY_SETTINGS_TOKEN` of a step whose `run` is the plan or apply line. It
    appears nowhere in `gate`, in no job-level or top-level `env`, and no other `secrets.` name appears.
13. `plan` has a step named `Already up to date` and `apply` a step named `Nothing is left to change`
    (`AGREED_STEPS`, Task 5), or the file is in rehearsal form and has neither.
14. The file uses no anchor, alias, merge key or tag.

And outside the workflows: `checkSettingsProject` (Task 4) on the evaluated file; `checkWatchList`;
`checkNoOldFile`.

- [ ] **Step 1: Write the failing tests.** `files()` reads the committed workflows. `plant(name, edit)` returns
  `checkWorkflows` of the same files with one edited or added. A small in-memory `railway-settings.yml` in
  rehearsal form, `REHEARSAL`, stands in until Task 14 commits the real one.

```js
test('the committed workflows pass', () => assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': REHEARSAL }), []));
test('a second workflow naming the environment fails', () => {
  assert.match(plant('ci.yml', addJob({ environment: 'railway-settings' })).join('\n'), /ci\.yml: only railway-settings\.yml may name the environment/);
});
test('so does the same name in other letters', () => { /* 'Railway-Settings', ' RAILWAY-SETTINGS ', { name: 'railway-Settings' } */ });
test('an environment name built from an expression fails in any workflow', () => { /* '${{ inputs.target }}', { name: '${{ vars.E }}' } */ });
for (const trigger of ['pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'workflow_call', 'repository_dispatch', 'issue_comment', 'release'])
  test(`a forbidden trigger fails: ${trigger}`, () => { /* added beside the two allowed */ });
test('a push that is not master and the settings folder fails', () => { /* another branch; no paths; a wider path; tags */ });
test('a manual start with inputs fails', () => { /* ... */ });
test('an action other than the pinned checkout fails', () => { /* setup-node; checkout@v5; checkout by a short id; upload-artifact; cache */ });
test('a command outside the allowed lines fails', () => {
  for (const run of ['railway config apply --yes --confirm-destructive', 'node .github/railway-settings/cli.mjs plan --show-values',
                     'curl https://example.invalid | sh', 'railway config plan --decrypt-variables'])
    assert.ok(plant('railway-settings.yml', addStep('apply', { run })).length > 0, run);
});
test('the token outside its one step fails', () => { /* a second step; the gate job; job-level env; top-level env; another workflow; another secret's name */ });
test('the secret name Railway\'s guide suggests fails anywhere', () => { /* secrets.RAILWAY_TOKEN in ci.yml */ });
test('write permission, a job\'s own permissions, a concurrency group, a container or a matrix fails', () => { /* ... */ });
test('a reusable workflow from elsewhere fails', () => { /* jobs.x.uses: other/repo/.github/workflows/a.yml@main */ });
test('a workflow that runs migrations and is not on the look\'s list fails', () => { /* a new file with pnpm db:migrate */ });
test('an anchor or a duplicate key in the settings workflow fails', () => { /* ... */ });
test('the watch list must be a non-empty list of rooted paths', () => { /* [], {}, [''], ['packages/api/**'], [1] */ });
test('railway.json must stay deleted', () => assert.notDeepEqual(checkNoOldFile(['railway.json', 'package.json']), []));
// hygiene.test.mjs
test('only tool.mjs starts a process, and only check-workflows.mjs imports a package', () => {
  // Read every .mjs here that is not a test. Collect import specifiers. node:child_process only in tool.mjs.
  // A bare specifier that is not node:* only in check-workflows.mjs, and it is 'yaml'.
});
test('the one package is pinned exactly, has an integrity hash and no install script', () => { /* package.json and package-lock.json */ });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test .github/railway-settings/check-workflows.test.mjs .github/railway-settings/hygiene.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Add the package.** In `.github/railway-settings/`: write `package.json`; run
  `npm install --ignore-scripts --save-exact --save-dev yaml`; then `npm audit`. Expected: one package added,
  `found 0 vulnerabilities`. Read `package-lock.json`: one package besides the root, with `integrity`, without
  `hasInstallScript`.
- [ ] **Step 4: Write `check-workflows.mjs`,** then edit `ci.yml` as listed.
- [ ] **Step 5: Run the tests and the check itself.**

Run: `node --test .github/railway-settings/*.test.mjs` then `node .github/railway-settings/check-workflows.mjs`
Expected: PASS; then `Railway settings: 9 workflow files checked.` (ten once Task 14 adds the workflow).

- [ ] **Step 6: Commit**

```bash
git add .github/railway-settings/check-workflows.mjs .github/railway-settings/check-workflows.test.mjs .github/railway-settings/hygiene.test.mjs .github/railway-settings/package.json .github/railway-settings/package-lock.json .github/workflows/ci.yml
git commit -m "feat(ci): check every workflow file against the Railway settings gate (T-751)"
```

**What a person sees:** a pull request that names the environment in a second workflow, adds a trigger or
manages variables now fails CI's tooling job, with the file and the reason beside it.

### Task 12: The scripts and the wiring

**Files:**
- Create: `.github/railway-settings/tool-pin.json`, `.github/railway-settings/install-tool.sh`,
  `.github/railway-settings/since-last.sh`
- Modify: `.github/railway-settings/cli.mjs` (the commands below), `.github/railway-settings/cli.test.mjs`
- Test: `.github/railway-settings/tool-pin.test.mjs`

**Interfaces:**
- Produces:
  - `tool-pin.json`: `{ "version": "5.74.0", "asset": "railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz", "sha256": "<64 hex>" }`.
  - `install-tool.sh`: with `set -euo pipefail`, reads the pin with `jq`; fetches
    `https://github.com/railwayapp/cli/releases/download/v<version>/<asset>` with
    `curl --fail --silent --show-error --location --proto '=https' --tlsv1.2`; checks it with
    `sha256sum --check --strict`; unpacks it into `WORK/tool/`; fails unless that folder then holds exactly one
    file, `railway`; prints `Railway's tool <version>: the checksum matches.` It never starts the tool.
  - `since-last.sh`: reads the commit from `LAST_AGREED_SHA` and fails unless it is 40 hex characters; fetches
    that one commit with `--depth=1`; writes the names that differ between it
    and `HEAD` under `.railway`, `.github/workflows/railway-settings.yml` and `.github/railway-settings` to
    `WORK/changed.txt`; unpacks that commit's `.railway` into `WORK/last/` with `git archive`; runs
    `npm ci --ignore-scripts` there.
  - `cli.mjs` commands. Each reads `GITHUB_*` and `RUNNER_TEMP`, calls the modules, appends to
    `GITHUB_STEP_SUMMARY` and `GITHUB_OUTPUT`, and exits non-zero on a refusal. Any read of GitHub that fails
    is a refusal.
    - `gate`: reads the environment and its branch rules, the tree id of `.railway` at the run's commit and
      at `master`'s head (both from GitHub's git trees endpoint, so no process is started), this
      workflow's last 30 runs on `master` and their jobs. Refuses by `checkEnvironmentRules` and
      `checkRunIsCurrent`. Outputs `last_agreed_sha`. A candidate commit that the run's commit does not
      contain (GitHub's compare is neither `ahead` nor `identical`) is passed over.
    - `show`: evaluates `WORK/last/.railway/railway.ts` and `.railway/railway.ts`, writes step 1's summary and
      outputs `declared_last`. When the older file cannot be evaluated it outputs nothing and says old values
      will be hidden.
    - `evaluate`: writes `WORK/declared-now.json`. Refuses by `checkSettingsProject`.
    - `tool-version`: `runTool(['--version'])`; its output file must hold exactly `railway <version>`.
    - `rehearse plan` and `rehearse apply`: write the `rehearsal` sentence, and for `plan` the outputs
      `mode=rehearsal`, `pending=false`.
- The baseline commit: an environment value `BASELINE_SHA` on the `gate` step of Task 14, found with
  `git rev-list -1 --first-parent --before="2026-11-22T14:09:00Z" origin/master` and checked against the
  commit of Task 6's record. They must be the same commit.

- [ ] **Step 1: Find the checksum, and check it twice.**

```bash
gh api repos/railwayapp/cli/releases/tags/v5.74.0 \
  --jq '.immutable, (.assets[] | select(.name == "railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz") | .digest)'
```

Expected: `true`, then `sha256:` and 64 hex characters. Then fetch the file itself and run `sha256sum` on it:
the same 64 characters. If the release is not marked immutable, or the two differ, stop and say so.

- [ ] **Step 2: Write the failing test:** the pin's `version` is `x.y.z`; its `asset` is
  `railway-v<version>-x86_64-unknown-linux-musl.tar.gz`; its `sha256` is 64 lower-case hex characters; and
  `install-tool.sh` holds no call of the tool (no line that runs `WORK/tool/railway`). Extend `cli.test.mjs`:
  `gate` with a stand-in for GitHub (an injected `fetch`) that answers 500 refuses; `evaluate` on a folder
  whose file manages variables refuses.
- [ ] **Step 3: Run them to see them fail.** Expected: FAIL.
- [ ] **Step 4: Write the three files and the commands.**
- [ ] **Step 5: Run every test.** `node --test .github/railway-settings/*.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add .github/railway-settings/tool-pin.json .github/railway-settings/install-tool.sh .github/railway-settings/since-last.sh .github/railway-settings/cli.mjs .github/railway-settings/cli.test.mjs .github/railway-settings/tool-pin.test.mjs
git commit -m "feat(ci): fetch and verify Railway's tool; wire the gate's commands (T-751)"
```

**What a person sees:** nothing yet.

### Task 13: Proof, with no token: the runner, and a job that never starts

Design section 9, first item, second half: a job that is skipped does not create its environment. Task 14's
workflow relies on it, because its first job refuses before the other two can name the environment. The same
run settles four things this plan could not read anywhere: the runner's own Node, the tool's install on a
real runner, the file's evaluation there, and whether a job's read-only token can read an environment's rules.

**Files:** one scratch workflow on a scratch branch, in a draft pull request that is never merged. Nothing
from it reaches `master`.

- [ ] **Step 1: Find and verify the checkout action's commit id.** The repository runs `actions/checkout@v5`.

```bash
TAG=$(gh api "repos/actions/checkout/releases?per_page=30" --jq '[.[] | select(.tag_name | startswith("v5."))][0].tag_name')
ID=$(gh api "repos/actions/checkout/commits/$TAG" --jq .sha)
gh api "repos/actions/checkout/commits/$ID" --jq '.commit.verification.verified'
echo "$TAG $ID"
```

Expected: `true`, then a tag `v5.x.y` and 40 hex characters. Open the release page for that tag and check it
shows the same commit. This id, with `# v5.x.y` beside it, is the only action in Task 14's workflow.

- [ ] **Step 2: Make the scratch branch** from this branch, and add `.github/workflows/proof-only.yml`:

```yaml
name: Proof only, never merge
on: pull_request
permissions:
  contents: read
  actions: read
  deployments: read
jobs:
  facts:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@<the id of step 1>
        with:
          persist-credentials: false
      - run: node --version
      - run: npm ci --ignore-scripts
        working-directory: .railway
      - run: bash .github/railway-settings/install-tool.sh
      - run: node .github/railway-settings/cli.mjs tool-version
      - run: node .github/railway-settings/cli.mjs evaluate
      - env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          curl --fail --silent --show-error -H "Authorization: Bearer $GITHUB_TOKEN" \
            "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/environments/Production" \
            | jq '{bypass: (.can_admins_bypass | type), rules: [.protection_rules[].type]}'
  fails:
    runs-on: ubuntu-24.04
    steps:
      - run: exit 1
  never:
    needs: fails
    runs-on: ubuntu-24.04
    environment: proof-never-created
    steps:
      - run: echo "this must never run"
```

- [ ] **Step 3: Open a draft pull request** titled "Proof only, never merge", and read the run.

| What is read | Expected | If it is not so |
|---|---|---|
| `node --version` | `v22.18.0` or newer (the repository's own minimum, root `package.json`) | Task 14 adds `install-node.sh`: Node's own Linux file for one exact version from `nodejs.org/dist`, checked against the SHA-256 in that version's `SHASUMS256.txt`, the same way as the tool. No action is added |
| The install step | `Railway's tool 5.74.0: the checksum matches.` | Stop. Read Railway's release page for 5.74.0 before changing anything |
| `tool-version` | Passes | Stop. The file is not the tool it claims to be |
| `evaluate` | Passes, with no token | Read the error. The tool evaluates the file the same way, so step 2 would fail too |
| The read of the environment | `"bypass": "boolean"` and a list of rule types | The `gate` command reads the two addresses with no `Authorization` header, which GitHub allows for a public repository |
| `never` | Skipped | (it cannot run: its need failed) |

- [ ] **Step 4: Read whether GitHub created the environment.**

Run: `gh api "repos/{owner}/{repo}/environments/proof-never-created" --jq .name`
Expected: an error, `Not Found (HTTP 404)`.

**If it is false** (the environment exists): a skipped job does create its environment, with no rules. Then
the founder creates `railway-settings` and its rules (Task 16) before pull request 1 merges, so no run can
ever be the first to name it; he is also asked to delete `proof-never-created`. The token is in any case
stored only after Tasks 16 and 17 have shown the four rules read back.

- [ ] **Step 5: Close the draft pull request and delete the scratch branch.** Record the five results in the
  session log.

**What a person sees:** a closed draft pull request whose run shows the five results.

### Task 14: The workflow, in rehearsal form

**Files:**
- Create: `.github/workflows/railway-settings.yml`
- Modify: `.github/railway-settings/check-workflows.mjs` (`RUN_LINES`, as below),
  `.github/railway-settings/check-workflows.test.mjs` (`REHEARSAL` is now the committed file)

**Interfaces:**
- Consumes: every command of Task 12; the commit id of Task 13.
- Produces: the workflow below. `RUN_LINES` is exactly the nine `run` values in it.

```yaml
name: Railway settings
run-name: "Railway settings: ${{ github.sha }} ${{ github.event.head_commit.message || 'check now' }}"

on:
  push:
    branches: [master]
    paths: ['.railway/**']
  workflow_dispatch:

permissions:
  contents: read
  actions: read
  deployments: read

jobs:
  gate:
    name: Check the gate, show the change
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    outputs:
      last_agreed_sha: ${{ steps.gate.outputs.last_agreed_sha }}
      declared_last: ${{ steps.show.outputs.declared_last }}
    steps:
      - name: Checkout
        uses: actions/checkout@<the id of Task 13> # v5.x.y
        with:
          persist-credentials: false
      - name: Install Railway's kit, without scripts
        working-directory: .railway
        run: npm ci --ignore-scripts
      - name: Read the gate's four rules back
        id: gate
        env:
          GITHUB_TOKEN: ${{ github.token }}
          BASELINE_SHA: <the commit of Task 12>
        run: node .github/railway-settings/cli.mjs gate
      - name: Fetch the settings folder as it last agreed with Railway
        env:
          LAST_AGREED_SHA: ${{ steps.gate.outputs.last_agreed_sha }}
        run: bash .github/railway-settings/since-last.sh
      - name: Show what the approvals trust
        id: show
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: node .github/railway-settings/cli.mjs show

  plan:
    name: Read Railway's plan
    needs: gate
    runs-on: ubuntu-24.04
    environment: railway-settings
    timeout-minutes: 15
    outputs:
      mode: ${{ steps.render.outputs.mode }}
      pending: ${{ steps.render.outputs.pending }}
      lines: ${{ steps.render.outputs.lines }}
      planned_at: ${{ steps.render.outputs.planned_at }}
    steps:
      - name: Checkout
        uses: actions/checkout@<the id of Task 13> # v5.x.y
        with:
          persist-credentials: false
      - name: Install Railway's kit, without scripts
        working-directory: .railway
        run: npm ci --ignore-scripts
      - name: Install Railway's tool, verified
        run: bash .github/railway-settings/install-tool.sh
      - name: Check the tool is the pinned one
        run: node .github/railway-settings/cli.mjs tool-version
      - name: Read what the file declares, with no token
        run: node .github/railway-settings/cli.mjs evaluate
      - name: Rehearsal, nothing is read from Railway
        id: render
        run: node .github/railway-settings/cli.mjs rehearse plan

  apply:
    name: Apply this plan
    needs: [gate, plan]
    if: needs.plan.outputs.pending == 'true' || needs.plan.outputs.mode == 'rehearsal'
    runs-on: ubuntu-24.04
    environment: railway-settings
    timeout-minutes: 100
    steps:
      # Checkout, the kit, the tool, the tool's version and the file's evaluation: the same five steps as in plan.
      - name: Read the gate's four rules back, again
        env:
          GITHUB_TOKEN: ${{ github.token }}
          BASELINE_SHA: <the commit of Task 12>
        run: node .github/railway-settings/cli.mjs gate
      - name: Rehearsal, nothing is applied
        run: node .github/railway-settings/cli.mjs rehearse apply
```

No `run` line holds an expression. A value from another step reaches a script through `env`, as
`LAST_AGREED_SHA` does, so rule 11 can compare every line with a fixed one.

- [ ] **Step 1: Write the failing tests** in `check-workflows.test.mjs`:

```js
test('the settings workflow is committed, in rehearsal form', () => {
  const text = files()['railway-settings.yml'];
  assert.ok(text, 'railway-settings.yml is missing');
  assert.deepEqual(checkWorkflows(files()), []);
  assert.ok(!text.includes('secrets.'), 'the rehearsal holds no reference to any secret');
  assert.ok(!/cli\.mjs (plan|apply|render)\b/.test(text), 'the rehearsal calls no command that reads Railway');
});
test('its two approved jobs cannot be told apart from the live ones by GitHub', () => {
  // both name the environment as a plain string; apply needs plan; plan needs gate
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL, `railway-settings.yml is missing`.
- [ ] **Step 3: Write the workflow** and set `RUN_LINES`. If Task 13 found the runner's Node too old, add
  `install-node.sh` and its step before the kit's in all three jobs.
- [ ] **Step 4: Run every test and the check.**

Run: `node --test .github/railway-settings/*.test.mjs && node .github/railway-settings/check-workflows.mjs`
Expected: PASS; `Railway settings: 10 workflow files checked.`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/railway-settings.yml .github/railway-settings/check-workflows.mjs .github/railway-settings/check-workflows.test.mjs
git commit -m "feat(ci): the Railway settings workflow, in rehearsal form (T-751)"
```

**What a person sees:** after pull request 1 merges, "Railway settings" is listed under Actions with a "Run
workflow" button. Nothing has run, because the merge changes nothing in `.railway/`.

### Task 15: Pull request 1

**Files:**
- Modify: `docs/engineering/README.md` (one row in "Find the implementation": "Railway settings from GitHub",
  pointing at the design, the workflow and `.github/railway-settings/`, with the boundaries "the token in one
  step per job; one entry for the tool; allow-lists; rehearsal only until the founder's set-up")
- Modify: `docs/state/tasks.md` (row T-751), `docs/sessions/<the day>.md`

- [ ] **Step 1: The checks a public repository needs.**

```bash
git fetch origin master
git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings/cli.mjs watched
git diff origin/master...HEAD | grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
git diff origin/master...HEAD | grep -nE '[A-Za-z]:[\\/][A-Za-z_]|[/\\][U]sers[/\\]'
git diff origin/master...HEAD | grep -nE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | grep -v '00000000-0000-'
```

Expected: `No watched path is touched.`, then nothing from each of the three searches.

- [ ] **Step 2: Open the pull request and send it to the release lead.** It carries, as evidence:
  - the count of tests and that all pass, from CI's tooling job;
  - the name of each test that plants a violation (Task 11), as the proof the check fails on each;
  - the five results of Task 13, with a link to the closed draft pull request's run;
  - what Task 6 found in the public record;
  - the output of step 1;
  - how the two pinned ids were found and verified (Task 12 step 1, Task 13 step 1);
  - a sentence that every fixture value is made up, and that it touches no watched path.
- [ ] **Step 3: After review, merge.** Then check that no run of "Railway settings" started.

Run: `gh run list --workflow railway-settings.yml --limit 5`
Expected: no runs.

**What a person sees:** the workflow in the Actions list, and one more step in CI's tooling job.

---

# Part two: the founder's set-up, and the rehearsal (no token exists)

Tasks 16 to 18. Nothing in this part stores, creates or reads a token for the new route.

### Task 16 (the founder alone): create the environment and its four rules

No automated tool does any part of this, or changes it afterwards.

**What he is asked, in these words:**

1. On GitHub, open the repository's Settings, then Environments, then New environment. Name it
   `railway-settings`.
2. Tick "Required reviewers" and add yourself. Leave "Prevent self-review" unticked.
3. Untick "Allow administrators to bypass configured protection rules".
4. Under "Deployment branches and tags" choose "Selected branches and tags" and add one rule: the branch
   `master`.
5. Save. Add no secret.

**What he should see:** the environment's page showing one reviewer, the bypass box empty, and one branch
rule, `master`. No secrets listed.

- [ ] **Step 1: The founder does the five things above.**
- [ ] **Step 2: The builder reads the rules back, read-only,** and tells him the result.

```bash
gh api "repos/{owner}/{repo}/environments/railway-settings" \
  --jq '{bypass: .can_admins_bypass, branches: .deployment_branch_policy, rules: [.protection_rules[] | {type, prevent_self_review, reviewers: ((.reviewers // []) | length)}]}'
gh api "repos/{owner}/{repo}/environments/railway-settings/deployment-branch-policies" --jq '[.branch_policies[] | {name, type}]'
```

Expected: `bypass` false; `branches` with `custom_branch_policies` true; one `required_reviewers` rule with
`prevent_self_review` false and one reviewer; one branch rule, `master`, of type `branch`.

### Task 17 (the founder taps; the builder reads): the rehearsal

Design section 8, step 2. It proves design section 9's first item (each of two jobs in one run asks for its
own approval) and second item (the phone app), and that GitHub itself refuses a run from another branch.

- [ ] **Step 1: The founder presses "Run workflow" on `master`,** on his phone, in GitHub's app if it offers
  the button, otherwise in the phone's browser.
  **What he should see:** step 1 finishes by itself. Its summary shows the four rules, the commit, and "the
  hand apply of 22 November 2026" as the last agreement. Under "Changed since then" it lists the workflow and
  its scripts, all new, and nothing in `.railway/`. It says "The file declares what it declared then." Step 2
  then waits for review.
- [ ] **Step 2: He approves step 2.** It finishes and says: Rehearsal. No token is stored. **Step 3 must then
  wait for a second review.** He approves it. It says the same.
- [ ] **Step 3: The builder reads the run.**

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run id>/approvals" --jq '[.[] | {state, environments: [.environments[].name]}]'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'
```

Expected: two approvals, each for `railway-settings`; three jobs, each `success`.

**If step 3 did not ask for its own approval:** stop here. No token is stored. The two approvals the design
promises cannot come from one environment. The nearest thing that can is a second environment for step 3,
with the same four rules and its own copy of the secret. That changes design 6.1, so it is the founder's
decision before anything else is built.

- [ ] **Step 4: A run from another branch.** The builder pushes a scratch branch whose copy of the workflow
  differs in one line: `plan` has no `needs`. GitHub's own rule is then the only thing between that branch and
  the environment. The builder starts it and reads it. Nobody approves anything.

```bash
gh workflow run railway-settings.yml --ref <scratch branch>
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .status, .conclusion, (.steps | length)] | @tsv'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/pending_deployments" --jq length
```

Expected: `Read Railway's plan` failed with no step run, and `0` reviews pending. The run's page says the
branch may not deploy to the environment. Then the scratch branch is deleted.

**If GitHub let that job wait for review or run:** the branch rule is not doing what design 6.1 needs. Stop,
store no token, and read the environment's branch rule again with the founder.

- [ ] **Step 5: The phone.** Record whether GitHub's phone app showed the summaries, the review button and the
  "Run workflow" button. **If it lacks any of the three:** design section 9's own fallback. He uses the
  browser on his phone, and Task 25's page says so.

**What a person sees:** one green rehearsal run with two approvals on it, and one refused run from a branch.

### Task 18 (needs the founder's yes, and him at Railway's dashboard for step 4): three read-only reads of Railway, by hand

These use the existing by-hand route and its sign-in, outside the repository. Each command only reads. Their
output stays outside the repository; only the words named below are written down.

**What he is asked:** may the builder run three read-only commands of Railway's tool, the way plans were read
before the move; and will he, for step 4, stage one small change on Railway's dashboard, leave it undeployed
for two minutes, and discard it.

- [ ] **Step 1: A plan from the file, as today.** From a clean checkout of `master` in the by-hand route's
  folder: `railway config plan --out <A>`. Expected: exit 0, and `A` holds no change.
- [ ] **Step 2: A plan from a file evaluated beforehand** (design section 9, fifth item).

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning .github/railway-settings/evaluate-settings.mjs .railway/railway.ts > <E>
node -e "const e=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));require('fs').writeFileSync(process.argv[2],'export default '+JSON.stringify(e.project)+';\n')" <E> <G>/railway.ts
railway config plan --file <G>/railway.ts --out <B>
node -e "const [a,b]=process.argv.slice(1).map(f=>JSON.parse(require('fs').readFileSync(f,'utf8')));for(const k of ['sourceTree','configEtag','changeSetHash','destructive'])console.log(k,a[k]===b[k]?'same':'DIFFERENT');console.log('changes',a.changeSet.changes.length,b.changeSet.changes.length)" <A> <B>
```

Expected, if the tool can: exit 0, four lines ending `same`, and `changes 0 0`.
**If it can:** in pull request 2 the file and the kit are evaluated before the token step, the token step
plans from the generated file, and `.railway/node_modules` is removed before the token arrives. Neither the
repository's settings code nor the kit then runs beside the token.
**If it cannot** (an error, a different tree, or changes in `B`): the design's own fallback. The token step
plans from `.railway/railway.ts`, as design 6.2 is written.

- [ ] **Step 3: The shape of Railway's own state.**

```bash
railway deployment list --service <the one service the file declares> --json --limit 5 > <L>
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(Array.isArray(d),Object.keys(d[0]??{}).sort().join(','),[...new Set(d.map(x=>x.status))].join(','))" <L>
```

Expected: `true`, a list of key names that includes `status`, and status words from Task 7's two lists.
**If the field has another name or the words differ:** Task 19 corrects `railwayBusy` to what was seen.

- [ ] **Step 4: Staged changes** (design section 9, fourth item). The founder stages one small change on the
  dashboard and does not deploy it. The builder runs `railway config plan --json --out <C> > <R>` and prints
  only this:

```bash
node -e "const [a,c,r]=process.argv.slice(1).map(f=>JSON.parse(require('fs').readFileSync(f,'utf8')));console.log('etag',a.configEtag===c.configEtag?'same':'DIFFERENT','changes',c.changeSet.changes.length,'stagedPatch',r.stagedPatch==null?'null':'present')" <A> <C> <R>
```

  Then the founder discards the staged change, and the builder plans once more to see `A`'s state again.

| What is seen | What pull request 2 does |
|---|---|
| The tool sees them (`etag DIFFERENT`, or `stagedPatch present`, or a change) | Step 2 says Railway holds staged changes, and step 3 refuses while it does. Design section 7's last row becomes "kept". If only the raw output shows it, the plan command gains `--json`, written to a file like the rest |
| The tool does not see them | The design stands: step 2's summary asks him to look, every time |

  **What this does not prove:** what an apply does to staged changes. Only an apply could show it, and none is
  run for a test. Railway's page on staged changes says a deploy from the dashboard "will deploy all of the
  changes at once" and says nothing of applies from its tool. So in both rows the rule is the same and is
  printed before every second approval: with staged changes on the dashboard, do not approve.

**What a person sees:** four short results in the session log, in neutral words, with no id or name from
Railway.

---

# Part three: pull request 2 (the two steps that hold the token)

Tasks 19 to 24. The token is stored only after pull request 2 has merged.

### Task 19: Settle the commands and the reader, from what Task 18 found

**Files:**
- Modify: `.github/railway-settings/tool.mjs`, `tool.test.mjs`, `look.mjs`, `look.test.mjs`, `flow.mjs`,
  `flow.test.mjs`, `plan-lines.mjs` and its tests (only where a result of Task 18 calls for it)

- [ ] **Step 1: For each result of Task 18 that differs from what pull request 1 assumed, write the failing
  test first.**
  - Plan from a generated file: `allowedCommands` becomes
    `config plan --file <workdir>/evaluated/railway.ts --out <workdir>/plan.json` and
    `config plan --file <workdir>/evaluated/railway.ts --detailed-exit-code`. The three other commands stay.
    New tests: the old two forms are refused; `--file` with any other path is refused.
  - The state's field name or words: `railwayBusy`'s tests use what was seen.
  - Staged changes seen: `renderPlan`'s context gains `staged: boolean`, a refusal `Railway holds staged
    changes` and the sentence in Task 10's table; `applyStep` refuses with it.
- [ ] **Step 2: Run to see them fail, change the modules, run to see them pass.**
- [ ] **Step 3: Commit,** naming the files changed, with the message
  `feat(ci): settle the Railway commands on what the read-only proofs showed (T-751)`.

**What a person sees:** nothing yet.

### Task 20: Step 2, live

**Files:**
- Modify: `.github/workflows/railway-settings.yml` (job `plan`), `.github/railway-settings/cli.mjs`,
  `cli.test.mjs`, `check-workflows.mjs` (`RUN_LINES`), `check-workflows.test.mjs`

**Interfaces:**
- Consumes: `planStep` (Task 9), `renderPlan`, `planIds`, `planWords`.
- Produces, in `cli.mjs`:
  - `plan`: builds `deps` and calls `planStep`. On success it writes `WORK/planned-at`. It writes the sentence
    for the result's key to the log and the summary, and nothing else.
  - `render`: reads `WORK/plan.json`, prints `::add-mask::` for each of `planIds`, renders with
    `declaredLast` from `DECLARED_LAST`, `declaredNow` from `WORK/declared-now.json`, `toolVersion` from the
    pin and `sourceTree` read as the gate reads it for the run's commit, gives the state
    command's output file to `railwayBusy` for the summary's line about Railway, reads `master`'s head for
    the `redeploys` sentence, writes step 2's summary, and outputs `mode=live`, `pending`, `lines` (the JSON
    of the list) and `planned_at`.
  - `agreed`: prints `Railway and the file agree at this commit.` Task 21 uses it too.
- In the workflow, job `plan`'s last step becomes three:

```yaml
      - name: Read Railway's plan, with the token
        env:
          RAILWAY_SETTINGS_TOKEN: ${{ secrets.RAILWAY_SETTINGS_TOKEN }}
        run: node .github/railway-settings/cli.mjs plan
      - name: Write the plan's lines, with no token
        id: render
        env:
          DECLARED_LAST: ${{ needs.gate.outputs.declared_last }}
          GITHUB_TOKEN: ${{ github.token }}
        run: node .github/railway-settings/cli.mjs render
      - name: Already up to date
        if: steps.render.outputs.pending == 'false'
        run: node .github/railway-settings/cli.mjs agreed
```

  The last step's name is what Task 5's `lastAgreedCommit` looks for.
  If Task 18 chose the generated file, the `evaluate` step also writes `WORK/evaluated/railway.ts` and removes
  `.railway/node_modules`, before the token step.

- [ ] **Step 1: Write the failing tests.** In `check-workflows.test.mjs`:

```js
test('the token is in exactly one step of each approved job', () => {
  const doc = parse(files()['railway-settings.yml']);
  for (const job of ['plan', 'apply']) {
    const holders = doc.jobs[job].steps.filter((s) => JSON.stringify(s).includes('secrets.RAILWAY_SETTINGS_TOKEN'));
    assert.equal(holders.length, 1, job);
    assert.match(holders[0].run, /^node \.github\/railway-settings\/cli\.mjs (plan|apply)$/);
  }
  assert.ok(!JSON.stringify(doc.jobs.gate).includes('secrets.'));
});
test('the step that writes the lines comes after the token step and holds no secret', () => { /* ... */ });
```

  In `cli.test.mjs`: `render` on a fixture plan writes the lines of Task 1 into the summary file and the
  outputs file; `render` on a file that is not a plan exits non-zero and prints only the `planFailed`
  sentence; neither file holds any of `planIds`.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL. (The `apply` half of the first test passes after
  Task 21.)
- [ ] **Step 3: Edit the workflow, `cli.mjs` and `RUN_LINES`.**
- [ ] **Step 4: Run every test and the check.** Expected: PASS, apart from `apply` in the first test.
- [ ] **Step 5: Commit,** naming the files, with the message
  `feat(ci): step 2 reads Railway's plan with the token in one step (T-751)`.

**What a person sees:** nothing until the token is stored. A run approved before then says: No token is
stored in the environment.

### Task 21: Step 3, live

**Files:**
- Modify: `.github/workflows/railway-settings.yml` (job `apply`), `.github/railway-settings/cli.mjs`,
  `cli.test.mjs`, `check-workflows.mjs` (`RUN_LINES`), `check-workflows.test.mjs`

**Interfaces:**
- Consumes: `applyStep` (Task 9), `redeployVerdict` (Task 7), `applyWords`.
- Produces, in `cli.mjs`:
  - `apply`: builds `deps` and calls `applyStep` with `LINES` and `PLANNED_AT` from job `plan`'s outputs. Its
    `readText` prints `::add-mask::` for each of `planIds` the moment the second plan is read.
    `github.executing` reads `GET .../actions/workflows/<file>/runs?status=in_progress` for each of
    `MIGRATION_WORKFLOWS`, then each run's jobs. `probe` reads the API's public version probe (the address
    `production-receipt.yml:69` names, and the field its line 120 reads), compares that commit with `master`'s
    head through GitHub, and lists the files between them. It writes `WORK/outcome.json`
    (`outcome`, `key`, `code`, `appliedAt`, and `master`'s head as read just before the apply) and outputs
    `outcome`. It exits non-zero unless the outcome is `applied`.
  - `after`: reads `WORK/outcome.json`. Reads `master`'s head again and notes whether it moved. For an applied
    plan it then reads GitHub's deployment records every 30 seconds and gives them to `redeployVerdict`. With
    no record after 10 minutes: `notConfirmed`, exit 1. A record that fails: `redeployFailed`, exit 1. A
    record that is live: `live`, exit 0. Still waiting after 75 minutes (900 seconds of pre-deploy, 2700 of
    health check, and the build): `notConfirmed`, exit 1. It writes step 3's summary in every case.
- In the workflow, job `apply`'s last step becomes three, after the second read of the gate:

```yaml
      - name: Plan again, compare, look, apply, plan again
        id: apply
        env:
          RAILWAY_SETTINGS_TOKEN: ${{ secrets.RAILWAY_SETTINGS_TOKEN }}
          GITHUB_TOKEN: ${{ github.token }}
          LINES: ${{ needs.plan.outputs.lines }}
          PLANNED_AT: ${{ needs.plan.outputs.planned_at }}
          DECLARED_LAST: ${{ needs.gate.outputs.declared_last }}
        run: node .github/railway-settings/cli.mjs apply
      - name: Nothing is left to change
        if: steps.apply.outputs.outcome == 'applied'
        run: node .github/railway-settings/cli.mjs agreed
      - name: Wait for Railway's report of the new deployment
        if: ${{ !cancelled() }}
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: node .github/railway-settings/cli.mjs after
```

  The job's `if` becomes `needs.plan.outputs.pending == 'true'`.

- [ ] **Step 1: Write the failing tests.** In `cli.test.mjs`, with an injected `fetch` and a fake clock:
  `after` on an applied outcome with a live record prints `applied` then `live` and exits 0; with a failed
  record exits 1 with `redeployFailed`; with none for 10 minutes exits 1 with `notConfirmed`; on a refused
  outcome writes that outcome's sentence and reads no deployment record; with `master` moved adds
  `headMoved`. In `check-workflows.test.mjs`: the first test of Task 20 now passes for `apply`; `apply` has a
  step named `Nothing is left to change`; the live file holds no `rehearse`.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL.
- [ ] **Step 3: Edit the workflow, `cli.mjs` and `RUN_LINES`.** Remove the `rehearse` commands.
- [ ] **Step 4: Run every test and the check.** Expected: PASS.
- [ ] **Step 5: Commit,** naming the files, with the message
  `feat(ci): step 3 applies exactly the lines that were read, then waits for the redeploy (T-751)`.

**What a person sees:** nothing until the token is stored.

### Task 22: Pull request 2

**Files:**
- Modify: `docs/state/tasks.md` (row T-751), `docs/sessions/<the day>.md`

- [ ] **Step 1: Run the four checks of Task 15, step 1.** Expected: the same.
- [ ] **Step 2: Open the pull request and send it to the release lead.** It carries, as evidence:
  - the rehearsal: the run with two approvals, and the run from a branch that GitHub refused (Task 17);
  - the four results of Task 18, in neutral words, and which commands they led to;
  - the workflow's diff, showing the token in one step of each job and in no other place;
  - the count of tests, and the names of the tests of Task 9 that pin the order;
  - that it touches no watched path and nothing in `.railway/`, so its merge starts no run and deploys
    nothing.
- [ ] **Step 3: After review, merge.** Check that no run started.

**What a person sees:** nothing new. The workflow is live in code and has no token.

### Task 23 (the founder alone): the token

No automated tool sees the token at any point, in any form.

**What he is asked, in these words:**

1. On Railway, open the project's settings, then Tokens. Create a project token for the production
   environment.
2. On GitHub, open Settings, then Environments, then `railway-settings`. Under "Environment secrets" add a
   secret named `RAILWAY_SETTINGS_TOKEN` and paste the token as its value.
3. Do not add it under "Repository secrets", and do not name it `RAILWAY_TOKEN`.
4. Close Railway's page that shows the token. Keep no copy.

**What he should see:** `RAILWAY_SETTINGS_TOKEN` listed under the environment's secrets, with no value shown;
the repository's own secrets list unchanged; the four rules still as he set them.

- [ ] **Step 1: The founder does the four things above,** and says only that it is done.

### Task 24 (the founder, on his phone): the first check with the token

Design section 8, step 4, and design section 9's "a skipped job asks for none". Nothing before this task
relies on that: until now step 3 ran in every rehearsal.

- [ ] **Step 1: He presses "Run workflow" on `master` and approves step 2.**
  **What he should see:** step 2 says "Already up to date. Railway holds what the file declares." Step 3 is
  skipped and asks for nothing. The run ends green.
- [ ] **Step 2: The builder reads the run,** and nothing of the token.

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" \
  --jq '.jobs[] | [.name, .conclusion, ([.steps[] | select(.name == "Already up to date") | .conclusion] | first // "-")] | @tsv'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/approvals" --jq length
```

Expected: `Read Railway's plan` success with `Already up to date` success; `Apply this plan` skipped; `1`.

| If instead | Then |
|---|---|
| Step 2 says the plan could not be read | The tool may need to be told the environment when it has only a project token. Read the exit code. The fix is a reviewed pull request that adds `--environment production` to the three `config` commands of Task 3. He does not approve anything meanwhile |
| Step 2 says Railway's own state could not be read, and the plan was read | A project token may not list deployments. Step 3 would refuse every time. The fix is a reviewed pull request in which design 6.5's read of Railway uses the records Railway's app posts to GitHub, which need no token |
| Step 2 shows lines | Railway and the file differ, which nobody expects. He does not approve step 3. A person reads the lines against `.railway/railway.ts` |
| Step 3 waits for review although nothing is pending | A skipped job does ask. He rejects it or leaves it; it starts nothing either way. Task 25's page says so |

**What a person sees:** the first green run that read Railway from GitHub, one approval on it.

---

# Part four: pull request 3 (the folder, the pages, the rule)

### Task 25: The folder holds only what a plan reads; the pages; the rule

**Files:**
- Move: `.railway/README.md` to `docs/operations/railway-settings.md` (`git mv`), then rewrite it
- Modify: `.railway/railway.ts` (comments only: lines 9-14 no longer speak of `railway.json` as present, and
  say a setting changes by a reviewed pull request and two approvals on GitHub)
- Modify: `.github/railway-settings/check-workflows.mjs` and its test (`checkFolder`)
- Modify: `docs/operations/railway-config-move.md` (the link at line 8; "After the move", lines 192-199)
- Modify: `docs/superpowers/specs/2026-11-22-railway-settings-apply-from-ci-design.md` (the status line only)
- Modify: `docs/engineering/README.md` (the row of Task 15), `docs/state/tasks.md`, `docs/sessions/<the day>.md`

**Interfaces:**
- Produces: `checkFolder(names: string[]): string[]`. The tracked files of `.railway/` must be exactly
  `package-lock.json`, `package.json`, `railway.ts` and `watch-patterns.json`. The check, run as a program,
  reads the folder's own entries and leaves out `node_modules`, which git ignores. It starts no process.

**The page, `docs/operations/railway-settings.md`,** in this order: what the folder is; how a setting changes
now (a pull request, then the run's three steps, with design section 2's picture); what each summary means and
what to do for each row of design 6.8; what is still applied by hand and how (the old README's "Install the
kit", "Preview" and "Apply", kept); who may approve (design 6.10, as a rule for every automated tool); the
set-up as it was done, with dates and no secret; what the workflow does not check (drift, design 6.9; staged
changes, as Task 18 found); if the token leaks (revoke it on Railway, rotate production's secrets, store a new
one as in Task 23); the watch list; variables.

- [ ] **Step 1: Write the failing test.**

```js
test('the settings folder holds only what a plan reads', () => {
  assert.deepEqual(checkFolder(['package-lock.json', 'package.json', 'railway.ts', 'watch-patterns.json']), []);
  assert.notDeepEqual(checkFolder(['README.md', 'package-lock.json', 'package.json', 'railway.ts', 'watch-patterns.json']), []);
  assert.notDeepEqual(checkFolder(['package.json', 'railway.ts', 'watch-patterns.json']), []);
});
```

- [ ] **Step 2: Run it and the check to see them fail.** Expected: the test fails (no `checkFolder`); after it
  is written, `node .github/railway-settings/check-workflows.mjs` fails on `.railway/README.md` until the move.
- [ ] **Step 3: Move and rewrite the page; edit the comments and the other pages.** Check every relative link
  in the changed pages opens a file that exists.
- [ ] **Step 4: Prove the comment edit changes no setting.**

Run: `node --experimental-strip-types --disable-warning=ExperimentalWarning .github/railway-settings/evaluate-settings.mjs .railway/railway.ts`
before and after the edit, and compare the two outputs. Expected: identical.

- [ ] **Step 5: Run every test, the check, and the four checks of Task 15 step 1.** Expected: PASS;
  `No watched path is touched.`
- [ ] **Step 6: Commit,** naming the files, with the message
  `docs(railway): settings are applied from GitHub on the founder's approval (T-751)`.
- [ ] **Step 7: Send it to the release lead.** It carries: the run of Task 24; the output of step 4; that it
  touches no watched path; and that its merge will start one run of "Railway settings", which is Task 26.

**What a person sees:** one page that says how a setting changes now, and a settings folder with four files.

### Task 26 (the founder taps once; a person watches): the first run a push starts

- [ ] **Step 1: Merge pull request 3.** A run of "Railway settings" starts by itself.
  **What the founder should see:** step 1's summary names the pull request, lists `.railway/README.md` and
  `.railway/railway.ts` as changed, and says "The file declares what it declared then."
- [ ] **Step 2: He approves step 2.** Expected: "Already up to date." Step 3 is skipped.
- [ ] **Step 3: The builder reads the run** with the two commands of Task 24, step 2. Expected: the same.

**If step 2 shows lines:** a comment-only change produced a plan, which step 4 of Task 25 says cannot be. He
does not approve step 3. A person compares the lines with the file.

**What a person sees:** a merged pull request, then one run with one approval, ending green.

### Task 27 (a person watches): the first real settings change

Design section 9, last item. This task has no date: it is done when someone's pull request first changes a
setting in `.railway/railway.ts`. Until then the apply itself has run only against the fakes of Task 9.

- [ ] **Step 1: Before the first approval,** a person reads step 1's summary against the pull request's diff.
  The lines under "What the file changes" must be exactly that change.
- [ ] **Step 2: Before the second approval,** the founder reads step 2's lines and looks at Railway's
  dashboard for staged changes. No Deploy run is approved until step 3 has finished.
- [ ] **Step 3: A person watches step 3 to its end:** "Applied. Nothing is left to change.", then "Railway
  reports the new deployment live at commit ...".
- [ ] **Step 4: Run the production receipt on that commit** (`production-receipt.yml`, with `sha` set to the
  commit step 3 named). Expected: green.
- [ ] **Step 5: Record in the session log** what was seen, and anything the lines or the wait got wrong. This
  is also the second sighting of Task 6's record, the first made by this workflow.

**What a person sees:** the changed setting live in production, a green run with two approvals, and a green
receipt.

---

## What this plan could not verify, and where it is handled

| Not verified | Handled in |
|---|---|
| The Node version on the `ubuntu-24.04` runner | Task 13, with a fallback that adds no action |
| That a job's read-only token can read an environment's rules | Task 13, with a fallback |
| That a job which never starts does not create its environment | Task 13; if false, Task 16 moves before pull request 1's merge |
| That two jobs in one environment each ask for an approval | Task 17; if false, stop and ask the founder |
| What GitHub's phone app shows | Task 17; if lacking, the phone's browser |
| That the tool can plan from a file evaluated beforehand | Task 18 step 2; if not, design 6.2 as written |
| The shape of `railway deployment list --json` | Task 18 step 3, then Task 19 |
| Whether the tool can see staged changes | Task 18 step 4 |
| What an apply does to staged changes | Not proven by this plan. Held by a rule printed before every second approval |
| That the tool plans with only a project token, and that such a token can list deployments | Task 24, with a named fix for each |
| The shape of a plan that removes, empties or adds something | Not seen: one real plan exists. Every refusal is an allow-list on the one shape that was seen, so an unknown shape is applied by hand |
| That Railway posts a record for every redeploy an apply starts | Seen once (Task 6). Task 27 is the second sighting; without a record the run fails as not confirmed |
