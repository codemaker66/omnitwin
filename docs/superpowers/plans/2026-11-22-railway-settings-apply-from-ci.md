# Railway settings from GitHub (T-751) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merged change to the settings folder reaches Railway's production settings from GitHub on two
approvals by the founder, and by no other route.

**Architecture:** One workflow, three jobs. The first holds no secret: it reads the gate's rules back from
GitHub, checks the run is current and shows what the approvals trust. The other two wait on a protected
environment, and each gives the token to one step. Everything those two jobs run or read lives in three
trusted places: `.railway/`, `.github/railway-settings/` and the workflow file. Every judgement (the lines,
the refusals, the gate, the look at other deploys, the words) is a small pure module in that folder. Its
tests, on made-up plans, and the CI check live beside it in `.github/railway-settings-check/`, which no
approved job reads. Railway's tool is started from one function that accepts an exact list of commands.

**Tech Stack:** GitHub Actions on `ubuntu-24.04`. Node 22 as one release file checked against a SHA-256, with
built-ins only (`node:crypto`, `fetch`) in everything the workflow runs. `node:test` for the tests. One locked
package, `yaml`, for the CI check alone. Railway's tool 5.74.0 as a release file checked against a SHA-256.
Railway's kit 3.17.0 from `.railway/package-lock.json`.

**Spec:** `docs/superpowers/specs/2026-11-22-railway-settings-apply-from-ci-design.md` (sections 6, 8, 9 and
12; section 14 lists what the release lead's two review passes changed). Read it with this plan: the plan
argues from it. The founder approved it on 22 November 2026.

Written 22 November 2026, and amended to follow the design's two review rounds and what the build of Tasks 1
to 5 found. Each of those five tasks ends with an "As built" note: what the code holds beyond this plan's
first wording, so that the plan matches the code a reviewer reads.

## The whole build, in order

| Part | What it holds | Who | A token exists |
|---|---|---|---|
| **1. Pull request 1** (Tasks 1 to 15) | The modules and their tests, the CI check, two proofs that need no token, the workflow in rehearsal form | The builder | No |
| **2. Set-up and rehearsal** (Tasks 16 to 18) | The environment and its four rules, the founder's two checks, the rehearsal, three read-only reads of Railway by hand | The founder, with the builder reading | No |
| **3. Pull request 2** (Tasks 19 to 24) | The two steps that hold the token, the Deploy workflow's header comment, then the token itself and the first check with it | The builder, then the founder | From Task 23 |
| **4. Pull request 3** (Tasks 25 to 27) | The folder holds only what a plan reads, the operations page, the new rule, the first real change | The builder, the founder, a person watching | Yes |

Each pull request goes to the release lead for review before it merges. Until Task 25 merges, the rule is
unchanged: a reviewed pull request to `.railway/railway.ts`, then an apply by hand with the founder's yes.

**Each of the three merges starts a run.** The workflow starts on any change to a trusted place, and each
pull request changes one. What that run does is said in Tasks 15, 22 and 26. None of them can reach a token
without the founder's approval on GitHub.

## What the design left to the builder (its section 12), decided

| Left open | Decision | Why |
|---|---|---|
| Which of Railway's release files is the tool, and how the runtime is pinned | The tool: `railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz` from Railway's releases on GitHub. The runtime: Node's own Linux file for one exact version, the one the API's image pins on the day (22.23.2 on 22 November). Each is fetched with `curl` and checked against a SHA-256 kept in `.github/railway-settings/pins.json`, which also holds the SHA-256 of the program inside | Railway's CLI page lists pre-built files as an official way to install and describes no way for its install script to pin a version or check a sum. The npm route brings an installer's dependencies into a public lockfile (`.railway/README.md`). GitHub's release record gives a SHA-256 for each file and marks that release immutable. 5.74.0 made the plan seen on 22 November. No action but checkout is allowed, so the runtime cannot come from `setup-node` |
| How the history of runs is read for the last change applied | GitHub's API, with the run's own token: this workflow's runs, newest first, then a candidate's jobs and its review history. Only one kind of run counts (design 6.2): on `master`, started by a push or by hand, in this repository and not a fork, whose step `Nothing is left to change` succeeded in the job "Apply this plan", after an approval its review history records for `railway-settings`. A run that only found Railway up to date does not count. With none, or when the read fails, step 1 shows the trusted places in full and old values are hidden | A step's name and result, and a review's record, are written by GitHub, not by the commit being run |
| The files inside `.github/railway-settings/`, and how their tests run in CI | That folder holds only what an approved job runs or reads: ten modules, four scripts and the pins. The tests, the fixtures, the CI check and its YAML reader live in `.github/railway-settings-check/`. CI's tooling job runs them with `node --test`, as it runs `.github/gpu/*.test.mjs` (`ci.yml:612-619`) | A test or a CI rule is not code the approvals trust, so changing one should not start a run or be shown in step 1. Both folders are outside the pnpm workspace (`packages/*`, `tools/*`), so no manifest or lockfile on a watched path changes |
| The comment at the top of the Deploy workflow | Rewritten in pull request 2, where the token steps land (`deploy.yml:18-21`). It says that a Railway token now lives in one protected environment, and points at the design | A comment-only change, in a file that is not a watched path and not a trusted place |
| How step 3 reads other workflows' executing jobs | GitHub's API, for the workflow files in a fixed list. (Railway's own state is the design's now: `railway deployment list --service <name> --json`, through the one tool entry, to a file on the runner, in step 2 and again in step 3; only a verdict is printed.) The running build: the production receipt's method (`production-receipt.yml:85-96` and `117-132`), with the address held in the trusted folder | Each reader is the narrowest one that answers the question. The list of workflows is checked by CI, so a new migration workflow cannot be forgotten |
| The rehearsal mode | Pull request 1's workflow is the rehearsal. Its two approved jobs name the environment, install and verify everything, read nothing from Railway and hold no reference to a secret. Going live is pull request 2, a reviewed change | A rehearsal that cannot touch a token needs no switch to trust |
| The exact words of the summaries | The table in Task 10, tested word for word | One place to read and to change them |
| The README's new home, and "After the move" | `docs/operations/railway-settings.md`, moved in pull request 3. The same pull request edits "After the move" | Its merge changes `.railway/` without changing a setting, so the run it starts is read-only, with the founder watching |

## Where this plan departs from the design's letter, and why

1. **An effect the workflow does not know is refused.** Every change seen so far says `deployEffect: "deploy"`.
   Step 3 must know whether to wait for a redeploy, so any other value is applied by hand until it is added.
2. **A refusal prints its one sentence and then fixed reasons.** The reasons are chosen from a short list and
   name settings only, never a value from Railway.
3. **The reviewer is matched by user id, not by name.** Design 6.1 asks for exactly the founder's user. A name
   can be changed; the id GitHub gives the repository's owner cannot.
4. **The reader refuses more than design 6.3 lists.** The build kept refusals for shapes that could be read
   in more than one way or that would be applied with no line to read: a group or a setting named twice, an
   update with no detail, an empty value anywhere in what the file declares for a changed group, a count of
   replicas it cannot count. Task 2's "As built" note lists them. Each is applied by hand.
5. **An empty plan that the reader refuses is not called up to date.** Design section 2 says a plan with no
   change says "already up to date". A plan with no change but made for another copy of the folder, or by
   another version of the tool, proves nothing about this commit. Step 2 fails with the reason, and step 3
   checks the refusals before it looks at whether anything is pending.
6. **A read of Railway's state that returns no deployment at all is unreadable, not quiet.** The service has
   deployments, so an empty list means the read did not see them.

## Not in this plan

Any change to what the Deploy workflow does. Railway variables. An unattended drift check. A read of the
gate's rules between runs (design 6.1 says the read-back is not a guard between runs). A second Railway
environment to test against. A second GitHub account for automated tools (design section 11). A real settings
change: the first one is someone's later pull request, and Task 27 says how it is watched.

## Global Constraints

- **No task touches a watched path.** A merge that changes one deploys production. They are exactly:
  `/Dockerfile`, `/.railwayignore`, `/railway.json`, `/package.json`, `/pnpm-lock.yaml`,
  `/pnpm-workspace.yaml`, `/tsconfig.base.json`, `/packages/api/**`, `/packages/types/**`,
  `/packages/reconstruction-foundry/**`, `/tools/reconstruction-foundry/**`, `/tools/capture-factory/**`,
  `/tools/twin-forge/**`. Each pull request proves it with
  `git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings-check/watched.mjs`,
  which must print `No watched path is touched.`
- **No new dependency in the root `package.json` or `pnpm-lock.yaml`.** Never a `package.json` under `tools/`
  or `packages/`: both are workspace globs, so it would change the lockfile.
- **The trusted places are three:** `.railway/`, `.github/railway-settings/` and
  `.github/workflows/railway-settings.yml`. They are the trigger's paths, what step 1 shows, and what the
  currency check compares. Everything an approved job runs or reads is in them. `.github/railway-settings/`
  holds no test, no fixture, no third-party package and no file that is not on Task 11's list.
- **The approvals are the founder's.** No automated tool approves a `railway-settings` review, creates or
  changes that environment, or sees, creates, pastes or prints the token. His yes in a chat lets nothing else
  approve: the approval is his own, on GitHub's review page. Tasks that need him say so in their title.
- **In the two approved jobs:** no action but `actions/checkout` pinned to a full commit id, with
  `persist-credentials: false`; no cache; no artifact; no deployment record of their own; their own read-only
  permissions; their own condition (this repository, `master`).
- **One step holds the token in each approved job.** In `plan` it is the step "Read Railway's plan, with the
  token". In `apply` it is the step "Plan again, look, apply, plan again, with the token". No other step, job
  or workflow names a secret whose name begins `RAILWAY`.
- **The tool is started from one function,** `runTool` in `tool.mjs`, with one of the exact argument lists of
  Task 3. Never `--confirm-destructive`, `--show-values`, `--decrypt-variables` or `--include-variables`.
- **Nothing the tool writes reaches a log, a summary, an output or a file name.** Every call's output goes to
  a file in `$RUNNER_TEMP/railway-settings/`. A failure prints a fixed sentence and the exit code. This holds
  for every call in both approved jobs.
- **The gate is read with the run's own token and no other.** Never a stronger token, and never no token.
- **No step changes a later step except through a file in the work folder or a step output.** Nothing in the
  trusted folder writes to the job's environment file or its path file.
- **Every check is an allow-list.** What is not known to be allowed is refused, and the refusal says the
  change is applied by hand.
- **Fail closed.** A read of GitHub or Railway that fails, or returns a shape the code does not know, is a
  refusal, never a pass. Two exceptions are the design's own: an unreadable history of runs means the trusted
  places are shown in full, and the bypass field as Task 5 says.
- **The repository is public.** No address, local path, account or session name, Railway id, hash or project
  name, and no Railway variable name, in code, tests, fixtures, logs, commit messages or pull request text.
  The one name the design itself gives, for the leak steps of its section 8, is repeated in Task 25's page
  and nowhere else. Fixtures use made-up values. Before each push, search the diff for an email address, a
  drive or user folder, and a UUID that does not begin `00000000-0000-`; none may match.
- **Tests never contact Railway or GitHub.** They read fixtures. Only the proof tasks read the real services,
  and they say exactly which reads.
- **No skipped test.** A test that needs Railway's kit fails with a plain message when it is missing.
- **Plain modules:** `.mjs`, Node built-ins only, relative imports with their extension. In the trusted
  folder a module imports only built-ins and its neighbours, and only `tool.mjs` may import
  `node:child_process`. Only `check-workflows.mjs`, in the check folder, may import `yaml`.
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
3. **GitHub answers the gate's read with an error, with a second page, or with a field missing.** The gate
   must refuse, not pass. (Task 5: "refuses: the branch rules run to a second page" and its neighbours;
   Task 12: the wiring treats any failed read of the rules as a refusal.)
4. **Step 3 is run again by itself, days later, with step 2's old outputs.** It must refuse before it calls
   the tool. (Task 9: "step 3 refuses a first plan older than six hours before calling the tool".)
5. **A deployment record that is not Railway's own for this apply** (the job's own record, the Deploy
   workflow's, one for another commit, one made before the apply). It must not confirm a redeploy. (Task 7:
   "a record counts only when all four hold".)

---

## File Structure

| File | Responsibility |
|---|---|
| `.github/railway-settings/plan-lines.mjs` | Read a pinned plan; build the lines (design 6.4); work out the refusals (design 6.3); say which lines to mark |
| `.github/railway-settings/tool.mjs` | The one place a process is started: the tool, by exact command; the runtime, to evaluate the settings file and to install the kit, with no token. Also the check of what was installed |
| `.github/railway-settings/evaluate-settings.mjs` | The script the runtime runs to evaluate `.railway/railway.ts` |
| `.github/railway-settings/declared.mjs` | What the file declares, in the names Railway stores; the settings file's own check |
| `.github/railway-settings/gate.mjs` | The rules of design 6.1; the currency check; the last change this workflow applied |
| `.github/railway-settings/look.mjs` | The look of design 6.5: executing jobs, Railway's state, the running build |
| `.github/railway-settings/redeploy.mjs` | The verdict of design 6.6 from GitHub's deployment records |
| `.github/railway-settings/flow.mjs` | The order of the two token steps, with everything outside injected |
| `.github/railway-settings/words.mjs` | Every sentence and summary |
| `.github/railway-settings/cli.mjs` | Wiring only: reads the environment, calls the modules, writes outputs and summaries |
| `.github/railway-settings/install-runtime.sh`, `install-tool.sh`, `since-last.sh`, `run.sh` | Fetch and verify the runtime and the tool; fetch the trusted places as they were at the last change applied; start `cli.mjs` under the pinned runtime |
| `.github/railway-settings/pins.json` | The tool's and the runtime's version, file name and two SHA-256 sums each |
| `.github/railway-settings-check/*.test.mjs`, `fixtures.mjs` | The tests, and made-up plans shaped like the one seen on 22 November |
| `.github/railway-settings-check/check-workflows.mjs` | The CI check of design 6.7 |
| `.github/railway-settings-check/watched.mjs` | Says whether a change touches a watched path |
| `.github/railway-settings-check/package.json`, `package-lock.json` | `yaml`, pinned, for the CI check alone |
| `.github/workflows/railway-settings.yml` | The workflow |
| `.github/workflows/ci.yml` | The tooling job runs the tests and the check; the idle watch-list step is replaced |
| `.github/workflows/deploy.yml` | Its header comment only (pull request 2) |
| `docs/operations/railway-settings.md` | The README's new home (pull request 3) |

**Names every task uses.** The environment is `railway-settings`. The secret is `RAILWAY_SETTINGS_TOKEN`. The
jobs are `gate` ("Check the gate, show the change"), `plan` ("Read Railway's plan") and `apply` ("Apply this
plan"). The trusted folder is `.github/railway-settings/`; the check folder is
`.github/railway-settings-check/`. A test imports a module as `../railway-settings/<name>.mjs`. The work
folder on a runner is `$RUNNER_TEMP/railway-settings/`, called WORK below; the pinned plan is
`WORK/plan.json`. The refusal sentence is `This change is applied by hand.`

---

# Part one: pull request 1 (everything that needs no token)

Tasks 1 to 15. After it merges, a "Railway settings" workflow exists whose approved jobs do nothing with
Railway, CI checks every workflow file on every change, and nothing on Railway or in production has changed.

### Task 1: Read a plan and write its lines

**Files:**
- Create: `.github/railway-settings/plan-lines.mjs`, `.github/railway-settings-check/fixtures.mjs`
- Test: `.github/railway-settings-check/plan-lines.test.mjs`
- Modify: `.gitattributes` (add `.github/railway-settings/** text eol=lf` and
  `.github/railway-settings-check/** text eol=lf`, beside the line for `.github/gpu/**`)
- Modify: `.github/workflows/ci.yml` (`gate-tooling`, after the step at lines 621-631: a step
  `Railway settings from GitHub: the modules` running `node --test .github/railway-settings-check/*.test.mjs`)

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
  - `lineMark(line: string): 'the pre-deploy command' | 'the health check' | 'the region' | 'sleep' | null`.
    By the line's name: `deploy.preDeploy...` is the pre-deploy command; `deploy.healthcheckPath` and
    `deploy.healthcheckTimeout` are the health check; `deploy.multiRegionConfig` and anything under it is
    the region; `deploy.sleepApplication` is sleep. The mark is added to what is shown (Task 10), never to
    the lines themselves, so the lines the two steps compare are unchanged by it.
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
   When `declaredLast` is known and differs, the line says `(Railway holds something else)`. When there is
   no `declaredLast` at all, the old value reads `(hidden)`: nothing is known to compare it with.
4. When `ctx.declaredNow[field]` does not equal the change's `after`, the kit and the tool read the file
   differently: every old value of that change reads `(hidden)` and one line says so.

The lines, sorted by name, then one last line binding everything the file declares for the changed groups:

```
deploy.drainingSeconds: (not set) -> 30
deploy.healthcheckTimeout: 2700 -> 3000
deploy.sleepApplication: (hidden) -> false
deploy.startCommand: (Railway holds something else) -> "node server.js"
1 change is outside what this workflow applies.
(old values hidden: the kit and the tool read the file differently)
declared: 3f9a0c1e5b7d2a46
```

(The lines above show every form at once. One plan would not hold `(hidden)` beside a shown old value for
the same group.)

Values are compact JSON. `declared:` is the first 16 hex characters of the SHA-256 of the changes' `after`
objects, keys sorted. A change that is not allowed is counted, never described.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlan, renderPlan, digestLines, planIds, lineMark } from '../railway-settings/plan-lines.mjs';
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
test('the four kinds of line whose meaning matters most are marked, and no other', () => {
  assert.equal(lineMark('deploy.preDeployCommand: ["a"] -> ["b"]'), 'the pre-deploy command');
  assert.equal(lineMark('deploy.preDeployTimeoutSeconds: 900 -> 1'), 'the pre-deploy command');
  assert.equal(lineMark('deploy.healthcheckPath: "/a" -> "/b"'), 'the health check');
  assert.equal(lineMark('deploy.healthcheckTimeout: 2700 -> 3000'), 'the health check');
  assert.equal(lineMark('deploy.multiRegionConfig.made-up-region-1.numReplicas: 1 -> 2'), 'the region');
  assert.equal(lineMark('deploy.sleepApplication: false -> true'), 'sleep');
  for (const line of ['deploy.drainingSeconds: 30 -> 40', 'build.builder: (not set) -> "DOCKERFILE"',
                      'declared: 3f9a0c1e5b7d2a46', '1 change is outside what this workflow applies.'])
    assert.equal(lineMark(line), null, line);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test .github/railway-settings-check/plan-lines.test.mjs`
Expected: FAIL, `Cannot find module` for `plan-lines.mjs`.

- [ ] **Step 3: Write `fixtures.mjs` and `plan-lines.mjs`** with the exports above. In this task every change
  is treated as allowed; Task 2 adds the refusals.

- [ ] **Step 4: Run the tests**

Run: `node --test .github/railway-settings-check/plan-lines.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/plan-lines.mjs .github/railway-settings-check/fixtures.mjs .github/railway-settings-check/plan-lines.test.mjs .gitattributes .github/workflows/ci.yml
git commit -m "feat(ci): read a Railway plan and write its lines (T-751)"
```

**As built.** Beyond the interfaces above, `plan-lines.mjs` holds:
- two more exports, used by Task 4 so that both modules write a line the same way: `showValue(value)`
  (compact JSON with keys sorted, `(not set)` for `null` or missing) and `writeLine(name, oldText, newValue)`;
- `readPlan` also requires `changeSet.version === 1` and every change to be an object, and its one sentence
  never quotes the text it was given;
- a name is `build` or `deploy` and then dotted parts of letters, digits, `_` and `-`. A name every object
  answers to (`constructor`, say) is read as a setting's own key or not at all;
- the old value reads `(hidden)` in the two cases of rules 3 and 4;
- the lines are ordered by name, whatever order Railway gives them.
Its test file holds 19 tests: the 11 above and 8 for these.

**What a person sees:** nothing yet. CI's tooling job runs these tests.

### Task 2: What step 3 refuses

**Files:**
- Modify: `.github/railway-settings/plan-lines.mjs`
- Test: `.github/railway-settings-check/plan-refusals.test.mjs`

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
- "Resources" in design 6.3 means what the file's project holds: services, databases and volumes. The fifth
  reason covers them: the file declares one service, so a plan that adds, removes or touches any other
  resource is not "an update to this service".
- The refusals are worked out for a plan with no change too. A plan for another copy of the folder holds no
  line and one reason, and Task 9 reads the reasons before it asks whether anything is pending.

**As built.** The build kept these refusals beyond the list above. Each uses one of the ten sentences, so
none adds words:
- `a line could not be read` also when: a group (`build`, `deploy`) is updated twice in one plan; a setting
  is named twice; a detail names another group than its change's `field`; an update has no detail at all;
  `before` or `after` is not an object; a count of replicas cannot be counted;
- `it empties <name>` also for an empty value anywhere in `after`, whether or not a detail names it. Empty
  means not set, blank text, or a list or map that holds nothing but empty values. Nought and `false` are
  values;
- `it lowers the number of replicas` also when replicas are given as one number (`numReplicas`), and when a
  detail's own old value says there were more than `before` shows;
- `it is not an update to this service's build or deploy settings` also when the run names no service;
- `the plan is for another version of the tool` and `... another copy of the settings folder` also when the
  context holds no version or no tree to compare with.
Its test file holds 32 tests: the 13 below and 19 for these.

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
test('an added service, database or volume is refused and its name is never printed', () => {
  for (const address of ['service.made-up-worker', 'database.made-up-worker', 'volume.made-up-worker']) {
    const added = change({ kind: 'resource.create', address, summary: 'Create made-up-worker' });
    assert.ok(refusals([added]).length > 0, address);
    assert.ok(!text([added]).includes('made-up-worker'), address);
  }
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
test('a change of meaning only is not refused: a pre-deploy command that does nothing passes, and is marked', () => {
  const c = change({ details: ['deploy.preDeployCommand (["node migrate.js"] → ["true"])'],
    before: { preDeployCommand: ['node migrate.js'] }, after: { preDeployCommand: ['true'] } });
  const r = renderPlan(plan([c]), CTX);
  assert.deepEqual(r.refusals, []);
  assert.equal(lineMark(r.lines[0]), 'the pre-deploy command');
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/plan-refusals.test.mjs`.
  Expected: FAIL, every `refusals` is `[]`.
- [ ] **Step 3: Add the refusals to `renderPlan`.**
- [ ] **Step 4: Run both test files.** `node --test .github/railway-settings-check/plan-*.test.mjs`. Expected:
  PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/plan-lines.mjs .github/railway-settings-check/plan-refusals.test.mjs
git commit -m "feat(ci): the changes the Railway settings workflow refuses to apply (T-751)"
```

**What a person sees:** nothing yet.

### Task 3: The one place a process is started

**Files:**
- Create: `.github/railway-settings/tool.mjs`, `.github/railway-settings/evaluate-settings.mjs`
- Test: `.github/railway-settings-check/tool.test.mjs`

**Interfaces:**
- Produces:
  - `allowedCommands(workdir, service): string[][]`, exactly these five. The last four are every call to
    Railway that design 6.2 lists; the first contacts nothing.

```
--version
config plan --out <workdir>/plan.json
config apply --plan <workdir>/plan.json --yes
config plan --detailed-exit-code
deployment list --service <service> --json
```

    The last is written as design 6.2 writes it. Its flags are the tool's own (`railway deployment list
    --help`: `-s, --service`, `--json`). It takes no `--limit`: the tool's default of 20 is more than the look
    needs, and a flag the design does not write is a flag the list does not allow.
  - `commandsFor(step, workdir, service): string[][]`, the calls to Railway each approved job may make
    (design 6.2). For `'plan'`: `config plan --out`, then `deployment list`. For `'apply'`: `config plan --out`,
    `deployment list`, `config apply --plan ... --yes`, `config plan --detailed-exit-code`. So step 2 cannot
    apply, whatever calls it.
  - `assertAllowed(argv, workdir, service, step?): void`. Throws `not an allowed command` unless `argv` equals
    one of the five, element for element. With a `step` it must also be `--version` or one of
    `commandsFor(step, ...)`. `service` must match `^[@A-Za-z0-9._/-]+$`.
  - `runTool(argv, { toolPath, runtimeDir, token, workdir, service, timeoutMs, step, standIn? }): Promise<{ code: number }>`.
    It calls `assertAllowed` first, with `step`. A call to Railway must say which step makes it: with no
    `step` it is refused, and only `--version`, which contacts nothing and gets no token, needs none. It
    also requires `toolPath`, `runtimeDir` (without it the tool would evaluate the settings file with
    whatever `node` the runner has), a time limit, and a token for every call to Railway (without one the
    tool could fall back to a sign-in it finds in the home folder); it starts nothing when one is missing.
    It starts `toolPath` with no shell, `stdin` closed, and standard output and error written to
    `tool-<n>.out` and `tool-<n>.err` in `workdir`, where `n` is the command's place among the five, from 1
    (`toolOutputPaths(argv, workdir, service)` gives the two paths; a command run again writes over its own
    files). The child's environment is built from nothing: `PATH` (the pinned runtime's `bin` first, then
    the tool's folder, then this process's own), `HOME`, `_` set to `toolPath`, `RAILWAY_NO_AUTO_UPDATE=1`,
    `CI=true`, `NO_COLOR=1`, and `RAILWAY_TOKEN` set to `token` for every command but `--version`. It returns
    the exit code and nothing else: `124` when the child was stopped at the time limit, `127` when it could
    not be started, `125` when it ended without a code. `standIn` is for the tests alone: a Node script
    started in the tool's place with the same arguments and environment. `cli.mjs` never passes it, and
    Task 11's check refuses the word in `cli.mjs`.
  - `evaluateSettings(file, { runtimePath }?): Promise<{ project: object, partial: string | null, takesContext: boolean }>`.
    It starts `runtimePath` (or `process.execPath` when none is given, as in tests) with
    `--experimental-strip-types --disable-warning=ExperimentalWarning evaluate-settings.mjs <file>` and an
    environment that holds `PATH` only, and parses what it prints.
  - `reinstallKit(dir, { runtimeDir, runtimePath? }): Promise<{ code: number }>`. It starts the pinned
    runtime on its own npm (`<runtimeDir>/lib/node_modules/npm/bin/npm-cli.js`) with `ci --ignore-scripts` in
    `dir`, with an environment that holds `PATH` and `HOME` only. npm checks every package against the
    lockfile's hash, so this is both the install and design 6.2's "checked against its lockfile". The
    runtime's program is `<runtimeDir>/bin/node` unless `runtimePath` names another: the tests give the Node
    that runs them, with a stand-in for npm under a made-up `runtimeDir`. npm's own words go to the log; it
    holds no token, and they say why an install failed.
  - `verifyPinned({ toolPath, runtimePath, pins }): Promise<string[]>`. The SHA-256 of each of the two
    programs must equal `binarySha256` of its entry in `pins` (Task 12). It returns plain problems, empty
    when both match. It starts no process.

**Why `_` and `PATH` are set.** The kit checks the tool's version by running the program named in `_`, or
`railway` from `PATH` (`.railway/node_modules/railway/dist/iac/index.js`, `assertMinimumIacCliVersion`). Both
must reach the pinned tool. The tool starts `node` from `PATH` to evaluate the settings file, so the pinned
runtime comes first: that is how "the runtime that evaluates the settings file is pinned" (design 6.2).
`RAILWAY_NO_AUTO_UPDATE=1` is the tool's own switch for its update check (its README).

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
  ['deployment', 'list', '--service', 'another', '--json'],
  ['deployment', 'list', '--service', S, '--json', '--limit', '5'],
  ['deployment', 'list', '--json'],
  ['up'], ['redeploy'], ['variables'], ['config', 'migrate', '--apply'], [],
]) test(`refuses: ${argv.join(' ') || '(nothing)'}`, () => assert.throws(() => assertAllowed(argv, W, S), /not an allowed command/));
test('step 2 may read the plan and the state, and nothing else', () => {
  assert.deepEqual(commandsFor('plan', W, S).map((a) => a.slice(0, 2).join(' ')), ['config plan', 'deployment list']);
  for (const argv of commandsFor('plan', W, S)) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'plan'));
  assert.doesNotThrow(() => assertAllowed(['--version'], W, S, 'plan'));
  for (const argv of [['config', 'apply', '--plan', P, '--yes'], ['config', 'plan', '--detailed-exit-code']])
    assert.throws(() => assertAllowed(argv, W, S, 'plan'), /not an allowed command/);
});
test('step 3 may make the four calls of design 6.2; a step this workflow does not have gets none', () => {
  assert.equal(commandsFor('apply', W, S).length, 4);
  for (const argv of commandsFor('apply', W, S)) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'apply'));
  assert.throws(() => commandsFor('another', W, S));
});

test('the tool gets the token under its own name, and nothing else from this process', async () => {
  // A stand-in tool: a script that writes its environment's key names to the file given in STAND_IN_OUT.
  // Assert: the keys are exactly PATH, HOME, _, RAILWAY_NO_AUTO_UPDATE, CI, NO_COLOR, RAILWAY_TOKEN;
  // GITHUB_TOKEN set in this process does not arrive; for --version, RAILWAY_TOKEN does not arrive either.
});
test('the tool finds the pinned runtime before any other node', async () => { /* PATH begins with <runtimeDir>/bin, then the tool's folder */ });
test('what the tool prints goes to files and is not returned', async () => { /* result is { code: 0 } and nothing more */ });
test('a tool that does not finish is stopped and reported as 124', async () => { /* timeoutMs: 200 */ });
test('a command that is not allowed never starts a process', async () => { /* the stand-in leaves no file */ });
test('installing the kit gets no token and runs no script', async () => {
  // A stand-in npm-cli.js under a made-up runtimeDir records its arguments and its environment's key names.
  // Assert: arguments are exactly ci --ignore-scripts; keys are exactly PATH and HOME.
});
test('a program that is not the pinned one is found out', async () => {
  // Two small files stand in for the tool and the runtime. With pins made from them: []. Change one byte of either: a problem.
});
test('a call to Railway that does not say which step makes it is not started', async () => {
  for (const argv of allowedCommands(W, S).slice(1))
    await assert.rejects(runTool(argv, { ...options, step: undefined }), /not an allowed command/);
  assert.deepEqual(await runTool(['--version'], { ...options, step: undefined, token: undefined }), { code: 0 });
});
test('a tool with no time limit, no path, no pinned runtime or no token is not started', async () => { /* each rejects; the stand-in leaves no file */ });
test('each of the five commands writes to files of its own', async () => {
  // toolOutputPaths gives tool-1 ... tool-5 for the five, in the order of allowedCommands
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/tool.test.mjs`. Expected:
  FAIL, module not found.
- [ ] **Step 3: Write `tool.mjs` and `evaluate-settings.mjs`.** The stand-ins in the tests are small Node
  scripts the test writes to a temporary folder. The tool's stand-in is started through `runTool`'s
  `standIn`; npm's through `reinstallKit`'s `runtimePath`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/tool.mjs .github/railway-settings/evaluate-settings.mjs .github/railway-settings-check/tool.test.mjs
git commit -m "feat(ci): one entry for Railway's tool, by exact command (T-751)"
```

**As built.** Beyond the first wording of this task, `tool.mjs` holds:
- `toolOutputPaths` and the numbered output files: `tool-1` is `--version`, `tool-2` the plan with `--out`,
  `tool-3` the apply, `tool-4` the closing plan, `tool-5` the list of deployments. Tasks 20 and 21 read
  Railway's state from `tool-5.out` and nothing else from these files;
- the tests-only `standIn`, and `reinstallKit`'s `runtimePath`;
- a work folder or a service name that begins with `-` allows no command at all: it could be read as a flag;
- a step that is not `'plan'` or `'apply'` gets no command, not even the version;
- `evaluateSettings` rejects with one plain sentence, the script's own or
  `The settings file could not be evaluated.`, and never with anything else the script printed. A runtime
  that is named and cannot be started is never replaced by another;
- `verifyPinned` treats a pin that is not a checksum, or a program that cannot be read, as a problem.
`evaluate-settings.mjs` notes any use of the context, not only a declared parameter: a parameter with a
default, or `arguments`, does not show in a function's length. It loads the kit from beside the settings
file, and it is the one module that imports a path it is given (Task 11, rule 18).
One change is still to make there: the list of deployments loses `--limit 5`, as written above.
Its test file holds 33 tests.

**What a person sees:** nothing yet.

### Task 4: What the file declares, read with no token

**Files:**
- Create: `.github/railway-settings/declared.mjs`
- Test: `.github/railway-settings-check/declared.test.mjs`
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
  `node --test .github/railway-settings-check/declared.test.mjs`. Expected: FAIL, module not found.
- [ ] **Step 3: Write `declared.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS. Also run
  `node --experimental-strip-types --disable-warning=ExperimentalWarning .github/railway-settings/evaluate-settings.mjs .railway/railway.ts`
  and read what it prints: one service, variables unmanaged, no value that is not already in the file.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/declared.mjs .github/railway-settings-check/declared.test.mjs .github/workflows/ci.yml
git commit -m "feat(ci): what the Railway settings file declares, read with no token (T-751)"
```

**As built.** Beyond the interfaces above, `declared.mjs` holds:
- `checkSettingsProject` also refuses: a `variables` map with any key beside `managed: false`; a service
  whose name `tool.mjs` would not give to Railway's tool; a service that declares variables of its own; a
  `build` or `deploy` that is not a map. A problem never names a variable;
- `storedSettings` throws when the project is not exactly one service, and gives an empty map for a group the
  file leaves out;
- `expectedLines` writes its lines with Task 1's `showValue` and `writeLine`, in the order Task 1 orders them.
Its test file holds 10 tests.

**What a person sees:** nothing yet.

### Task 5: The gate

**Files:**
- Create: `.github/railway-settings/gate.mjs`
- Test: `.github/railway-settings-check/gate.test.mjs`

**Interfaces:**
- Produces:
  - `ENVIRONMENT = 'railway-settings'`
  - `TRUSTED_PLACES = ['.railway', '.github/railway-settings', '.github/workflows/railway-settings.yml']`
  - `BYPASS_VISIBLE`, a constant `true` or `false`. Task 13 proves which and Task 14 sets it. Until then it
    is `true`.
  - `AGREED_JOBS = { plan: "Read Railway's plan", apply: 'Apply this plan' }`, the two approved jobs' names
    as the workflow file writes them.
  - `AGREED_STEPS = { apply: 'Nothing is left to change' }`, the one step whose success means a change was
    applied and nothing was left.
  - `checkEnvironmentRules({ environment, branchPolicies, ownerId, bypassVisible }): string[]`. `environment`
    is the answer of `GET /repos/{owner}/{repo}/environments/railway-settings`, or `null` when the answer was
    not a success. `branchPolicies` is the answer of
    `GET .../environments/railway-settings/deployment-branch-policies`, or `null` when that answer was not a
    success or had a further page. `ownerId` is the user id of the repository's owner, as a whole number
    above nought: text never matches, so the caller converts it (Task 12). It returns problems in plain
    words, empty when the rules are as design 6.1. It refuses on each of these:
    1. `environment` or `branchPolicies` is `null`, or the answer's `name` is not the environment's;
    2. a field it reads is missing or of the wrong kind: `protection_rules`, a reviewers rule's `reviewers`
       and `prevent_self_review`, `deployment_branch_policy` and its two booleans, `total_count`,
       `branch_policies`. The bypass field is the only exemption, and only as refusal 8 says;
    3. more than one page: `total_count` is not the number of `branch_policies` returned;
    4. reviewers other than exactly the founder's user: not exactly one rule of type `required_reviewers`,
       or not exactly one reviewer in it, or that reviewer's `type` is not `User`, or its `reviewer.id` is
       not `ownerId`;
    5. "prevent self-review" on: `prevent_self_review` is not exactly `false`;
    6. a branch rule in any mode but chosen branches: `deployment_branch_policy` is `null` (no branch policy
       at all), or its `protected_branches` is not exactly `false`, or its `custom_branch_policies` is not
       exactly `true`, or it holds any other key;
    7. branch policies other than exactly one, of type branch, named `master`: `branch_policies` is not one
       entry whose `name` is `master` and whose `type` is `branch`;
    8. a bypass answer other than "no": `can_admins_bypass` is present and is not exactly `false` (an
       explicit `null` is present, and refuses); or it is missing and `bypassVisible` is not `false`.
    A rule of another type (a wait timer, say) is not a refusal: design 6.1 does not list one, and it can
    only add a wait.
  - `bypassChecked(environment): boolean`. True when the answer holds the key `can_admins_bypass`, whatever
    its value. When it is false the summaries say so (Task 10).
  - `checkRunIsCurrent({ ref, placesAtRun, placesAtMasterHead }): string[]`. The currency check. Each
    `places` is `{ settings, code, workflow }`: the git id of each trusted place, in `TRUSTED_PLACES`' order,
    two tree ids and one file id. Empty when `ref` is `refs/heads/master` and all three ids are 40 hex
    characters and equal on both sides.
  - `lastAgreedCommit({ runs, jobsByRunId, approvalsByRunId, currentRunId, repository }): { sha: string, runId: number } | null`.
    The last change applied (design 6.2, step 1). The function keeps its first name; what it means is "the
    newest run that applied". `runs` is `workflow_runs` from
    `GET .../actions/workflows/railway-settings.yml/runs`, newest first. `jobsByRunId[id]` is `jobs` from
    `GET .../actions/runs/{id}/jobs?filter=latest`. `approvalsByRunId[id]` is the answer of
    `GET .../actions/runs/{id}/approvals`, the run's review history. `repository` is this repository's full
    name. Only one kind of run counts. All of these must hold:
    1. it is not the current run;
    2. its `path` is `.github/workflows/railway-settings.yml`;
    3. its `event` is `push` or `workflow_dispatch`;
    4. its `head_branch` is `master`;
    5. it ran in this repository and not in a fork: `repository.full_name` and `head_repository.full_name`
       both equal `repository`;
    6. its `head_sha` is 40 hex characters;
    7. its step 3 applied: the job named `Apply this plan` has conclusion `success`, and its step named
       `Nothing is left to change` has conclusion `success`;
    8. after an approval: its review history holds an entry whose `state` is `approved` and whose
       `environments` name `railway-settings` (any letter case).
    Every other run is ignored: a run that only found Railway up to date, a rehearsal, a refused or failed
    apply, a pull-request run from a fork under the same workflow path. With none it is `null`. There is no
    fixed commit to fall back on: a commit could rewrite one. A history that was not read in a shape this
    code knows is `null` too, and so is a run that passes 1 to 6 whose jobs were not read, or one that
    passes 7 whose review history was not read: an older run is never given in a newer one's place.
    **A tag named `master`.** GitHub's run object gives `head_branch: "master"` for a tag of that name as
    for the branch, so this function cannot tell them apart. The caller's containment check carries it
    (Task 12): the run's own commit must contain the commit this returns, or the answer is dropped.

**The bypass field's special case** (design 6.1). GitHub's REST page "Get an environment" does not list
`can_admins_bypass` in its answer, though the answer to the owner's sign-in has it. Task 13 proves once
whether a run's own token sees it. If it does, `BYPASS_VISIBLE` stays `true` and a missing field is a refusal
like any other. If the key is not in the answer at all, `BYPASS_VISIBLE` becomes `false`: the workflow does
not check that rule, every summary says so, and the rule rests on the founder's own look at the box
(Task 16). It is the only field exempt from "a missing field", and only then. A key that is there with the
value `null` is not missing: it refuses, and Task 13 says what follows if that is what a run's token is
given. No stronger token is ever used to read it.

The fields of refusals 2 to 7 are in GitHub's REST pages "Get an environment" and "List deployment branch
policies". The review history is "Get the review history for a workflow run", on the page "REST API endpoints
for workflow runs"; its answer is a list of `{ state, environments: [{ name }], user, comment }`, and
`state` is `approved`, `rejected` or `pending`. The jobs endpoint is on the page "REST API endpoints for
workflow jobs" (`docs.github.com/en/rest/actions/workflow-jobs`): read it before writing the fixture.

- [ ] **Step 1: Write the failing tests**

```js
const good = () => ({ ownerId: 1001, bypassVisible: true,
  environment: { name: 'railway-settings', can_admins_bypass: false,
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { id: 1001, login: 'the-owner' } }] },
                       { type: 'branch_policy' }] },
  branchPolicies: { total_count: 1, branch_policies: [{ id: 7, name: 'master', type: 'branch' }] } });
const reviewers = (g) => g.environment.protection_rules[0];

test('the rules as the design sets them pass', () => assert.deepEqual(checkEnvironmentRules(good()), []));
for (const [name, spoil] of [
  ['the environment could not be read', (g) => { g.environment = null; }],
  ['the branch rules could not be read', (g) => { g.branchPolicies = null; }],
  ['the branch rules run to a second page', (g) => { g.branchPolicies.total_count = 31; }],
  ['the list of rules is missing', (g) => { delete g.environment.protection_rules; }],
  ['no reviewer rule', (g) => { g.environment.protection_rules.shift(); }],
  ['a second reviewer', (g) => { reviewers(g).reviewers.push({ type: 'User', reviewer: { id: 2002, login: 'another' } }); }],
  ['a team as the reviewer', (g) => { reviewers(g).reviewers[0].type = 'Team'; }],
  ['a reviewer who is not the owner', (g) => { reviewers(g).reviewers[0].reviewer.id = 2002; }],
  ['a reviewer with the owner\'s name and another id', (g) => { reviewers(g).reviewers[0].reviewer = { id: 2002, login: 'the-owner' }; }],
  ['self-review prevented', (g) => { reviewers(g).prevent_self_review = true; }],
  ['the self-review answer missing', (g) => { delete reviewers(g).prevent_self_review; }],
  ['no branch policy at all: any branch may deploy', (g) => { g.environment.deployment_branch_policy = null; }],
  ['the branch policy missing from the answer', (g) => { delete g.environment.deployment_branch_policy; }],
  ['the protected-branches mode on', (g) => { g.environment.deployment_branch_policy = { protected_branches: true, custom_branch_policies: false }; }],
  ['the protected-branches mode on beside custom policies', (g) => { g.environment.deployment_branch_policy.protected_branches = true; }],
  ['custom policies off', (g) => { g.environment.deployment_branch_policy = { protected_branches: false, custom_branch_policies: false }; }],
  ['a branch mode this code does not know', (g) => { g.environment.deployment_branch_policy.made_up_mode = true; }],
  ['a second branch rule', (g) => { g.branchPolicies = { total_count: 2, branch_policies: [{ name: 'master', type: 'branch' }, { name: 'release/*', type: 'branch' }] }; }],
  ['a tag named master', (g) => { g.branchPolicies.branch_policies[0].type = 'tag'; }],
  ['a branch rule with no type', (g) => { delete g.branchPolicies.branch_policies[0].type; }],
  ['administrators may bypass', (g) => { g.environment.can_admins_bypass = true; }],
  ['the bypass answer missing, when a run can see it', (g) => { delete g.environment.can_admins_bypass; }],
  ['the bypass answer given as null', (g) => { g.environment.can_admins_bypass = null; }],
  ['the bypass answer given as null, when the build proved a run cannot see it', (g) => { g.environment.can_admins_bypass = null; g.bypassVisible = false; }],
  ['the owner\'s id given as text', (g) => { g.ownerId = '1001'; }],
  ['no owner\'s id given', (g) => { g.ownerId = undefined; }],
  ['the answer is for another environment', (g) => { g.environment.name = 'production'; }],
]) test(`refuses: ${name}`, () => { const g = good(); spoil(g); assert.notDeepEqual(checkEnvironmentRules(g), []); });

test('when the build has proven a run cannot see the bypass answer, its absence is not a refusal', () => {
  const g = good(); delete g.environment.can_admins_bypass; g.bypassVisible = false;
  assert.deepEqual(checkEnvironmentRules(g), []);
  assert.equal(bypassChecked(g.environment), false);
});
test('a bypass answer that is there and is not "no" refuses whatever the build proved', () => {
  const g = good(); g.environment.can_admins_bypass = true; g.bypassVisible = false;
  assert.notDeepEqual(checkEnvironmentRules(g), []);
});
test('a wait timer beside the two rules is not a refusal', () => {
  const g = good(); g.environment.protection_rules.push({ type: 'wait_timer', wait_timer: 5 });
  assert.deepEqual(checkEnvironmentRules(g), []);
});
const places = (over) => ({ settings: 'a'.repeat(40), code: 'b'.repeat(40), workflow: 'c'.repeat(40), ...over });
test('a run is current only on master, with all three trusted places as master has them', () => {
  assert.deepEqual(checkRunIsCurrent({ ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places() }), []);
  for (const bad of [{ ref: 'refs/heads/other', placesAtRun: places(), placesAtMasterHead: places() },
                     { ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places({ settings: 'd'.repeat(40) }) },
                     { ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places({ code: 'd'.repeat(40) }) },
                     { ref: 'refs/heads/master', placesAtRun: places(), placesAtMasterHead: places({ workflow: 'd'.repeat(40) }) },
                     { ref: 'refs/heads/master', placesAtRun: places({ code: '' }), placesAtMasterHead: places({ code: '' }) }])
    assert.notDeepEqual(checkRunIsCurrent(bad), []);
});

// The last change applied. Made-up runs, jobs and review histories, in GitHub's shapes.
const REPO = 'made-up-owner/made-up-repo';
const applied = (id, over) => ({ id, path: '.github/workflows/railway-settings.yml', event: 'push', head_branch: 'master',
  head_sha: String(id % 10).repeat(40), repository: { full_name: REPO }, head_repository: { full_name: REPO }, ...over });
const jobsApplied = [{ name: "Read Railway's plan", conclusion: 'success', steps: [] },
  { name: 'Apply this plan', conclusion: 'success', steps: [{ name: 'Nothing is left to change', conclusion: 'success' }] }];
const approved = [{ state: 'approved', environments: [{ name: 'railway-settings' }] }];
const last = (runs, jobs = {}, approvals = {}) => lastAgreedCommit({ runs, currentRunId: 99, repository: REPO,
  jobsByRunId: Object.fromEntries(runs.map((r) => [r.id, jobs[r.id] ?? jobsApplied])),
  approvalsByRunId: Object.fromEntries(runs.map((r) => [r.id, approvals[r.id] ?? approved])) });

test('the last change applied is the newest run on master that applied after a recorded approval', () => {
  assert.deepEqual(last([applied(3), applied(2)]), { sha: '3'.repeat(40), runId: 3 });
  assert.deepEqual(last([applied(4, { event: 'workflow_dispatch' })]), { sha: '4'.repeat(40), runId: 4 });
});
// Design 6.2 names these four. Each is ignored, and the older run that applied is the answer.
test('a pull-request run from a fork, under the same workflow path, is ignored', () => {
  const fork = applied(5, { event: 'pull_request', head_repository: { full_name: 'another-owner/made-up-repo' } });
  assert.equal(last([fork, applied(2)]).runId, 2);
  // and a fork that names itself a push on master, under the same path
  assert.equal(last([applied(6, { head_repository: { full_name: 'another-owner/made-up-repo' } }), applied(2)]).runId, 2);
});
test('a run on another branch is ignored', () => assert.equal(last([applied(5, { head_branch: 'other' }), applied(2)]).runId, 2));
test('a run whose apply was skipped is ignored: finding Railway up to date applies nothing', () => {
  const skipped = [{ name: "Read Railway's plan", conclusion: 'success', steps: [{ name: 'Already up to date', conclusion: 'success' }] },
                   { name: 'Apply this plan', conclusion: 'skipped', steps: [] }];
  assert.equal(last([applied(5), applied(2)], { 5: skipped }).runId, 2);
});
test('a run with no recorded approval is ignored', () => {
  for (const history of [[], [{ state: 'rejected', environments: [{ name: 'railway-settings' }] }],
                         [{ state: 'approved', environments: [{ name: 'production' }] }], [{ state: 'pending', environments: [{ name: 'railway-settings' }] }]])
    assert.equal(last([applied(5), applied(2)], {}, { 5: history }).runId, 2);
});
test('a rehearsal, a refused or failed apply, another workflow\'s path, another kind of start and this run itself are ignored', () => { /* ... */ });
test('an approval for the environment in other letters still counts', () => { /* 'Railway-Settings' */ });
test('with no run that applied there is no last change applied', () => assert.equal(last([applied(5, { head_branch: 'other' })]), null));
test('a history that could not be read gives none: never an older run in a newer one\'s place, never an error', () => {
  // runs not a list; a candidate's jobs missing; a run that applied whose review history is missing
});
test('no commit is fixed in the code to fall back on', () => { /* the module's text holds no 40 hex characters */ });
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/gate.test.mjs`. Expected:
  FAIL.
- [ ] **Step 3: Write `gate.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/gate.mjs .github/railway-settings-check/gate.test.mjs
git commit -m "feat(ci): read the Railway settings gate's rules back (T-751)"
```

**As built, and what this round changes.** The code of this task holds, beyond the first wording:
- `AGREED_JOBS`; a refusal when the answer's `name` is not the environment's (other letters are the same
  environment to GitHub, so the name is compared without regard to case); a refusal when `protection_rules`
  is not a list of typed rules, or holds more than one `branch_policy` rule; `deployment_branch_policy` must
  hold exactly its two booleans;
- a bypass answer that is present must be exactly `false`: `true` and any other value, `null` included, each
  refuse with their own plain sentence;
- `ownerId` must be a whole number above nought. The code never converts text;
- `checkRunIsCurrent` never takes an id that could not be read as unchanged, even when both sides hold the
  same unreadable value;
- `lastAgreedCommit` needs this run's own number, so that it cannot take itself for an earlier run.
Still to change there, from the design's second review round: `lastAgreedCommit` as written above. A run
that found Railway already up to date counted in the first build; it no longer does. `AGREED_STEPS` loses
its `plan` key. The function gains `approvalsByRunId` and `repository`, and reads a run's `path`,
`repository` and `head_repository`. Its tests "a run that said already up to date counts" and its
neighbours give way to the ones above.

**What a person sees:** nothing yet.

### Task 6: Proof, with no token: Railway's record of a redeploy that an apply starts

Design section 9, not yet proven: that Railway posts a deployment record to GitHub for a redeploy an apply
starts. Design 6.6 relies on it, and Task 7 builds on its shape.

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

- [ ] **Step 3: Write down what Task 7 needs,** the four things design 6.6 tests:
  - the record's `environment`. It should read as the project's name as `.railway/railway.ts` declares it,
    then ` / `, then Railway's name for the environment;
  - the creator's login and that its `type` is `Bot` (the constant `RAILWAY_APP_LOGIN`);
  - that the record's commit is `master`'s head at the apply;
  - that it was created after the apply began;
  and the three states and their order. No id goes into the repository.

**If it is false** (no such record, or it was not made by Railway's app): design 6.6's own fallback.
`FALLBACK_READ` of Task 7 is set to `true`: step 3 reads the tool's list of deployments again, through the
fifth call of design 6.2, counts it by `listVerdict` (Task 7), and prints only the verdict. If that list
cannot show all four things design 6.6 asks of it, the fallback cannot confirm, and every apply ends as not
confirmed: say so to the release lead and the founder before pull request 2.

**What a person sees:** a paragraph in the session log saying what the record showed.

### Task 7: Other deploys, and the redeploy: the verdicts

**Files:**
- Create: `.github/railway-settings/look.mjs`, `.github/railway-settings/redeploy.mjs`
- Test: `.github/railway-settings-check/look.test.mjs`, `.github/railway-settings-check/redeploy.test.mjs`

**Interfaces:**
- Produces, in `look.mjs`:
  - `MIGRATION_WORKFLOWS = ['deploy.yml', 'apply-migration-0018.yml']` (the Deploy workflow's job at
    `deploy.yml:49-106`, and the one other workflow that applies a migration).
  - `VERSION_PROBE`, the address of the API's public version probe: the one `production-receipt.yml:69` and
    `119` build. It is written here because an approved job reads nothing outside the trusted places.
  - `executingJobs(jobsByRunId): number`. The number of jobs whose `status` is `in_progress` or `queued`. A job
    that is `waiting` is waiting for a review and does not count.
  - `railwayBusy(list): 'idle' | 'busy' | 'unreadable'`. `list` is the parsed output of `deployment list`.
    Steps 2 and 3 both use it: step 2 to tell him before the second approval, step 3 just before the apply.
    Every status that is not final counts as busy (design 6.5). The final ones are `FINAL_STATUSES`:
    `SUCCESS`, `FAILED`, `CRASHED` and `REMOVED`. So `BUILDING`, `DEPLOYING`, `INITIALIZING`, `WAITING`,
    `QUEUED` and `REMOVING` are busy, and so is a word this code has never seen. Idle only when every entry's
    status is final. Unreadable when the input is not a list, is an empty list, or holds an entry that is
    not an object with a `status` of text. The words are those on Railway's CLI page for
    `railway deployment`; the field's name is confirmed in Task 18.
  - `LIST_FIELDS = { service, createdAt, status, commit }`, the names of the fields of one entry of that list
    that carry its service, its time of creation, its status and its commit. Each is `null` until Task 18 has
    seen it and Task 19 has written it; `status` starts as `'status'`.
  - `listVerdict(list, { service, head, appliedAt, fields = LIST_FIELDS }): 'live' | 'failed' | 'waiting' | 'cannot'`.
    The fallback's counting rule (design 6.6). An entry counts only when all four hold: it is of the one
    service; it was created after `appliedAt`; it is for `head`, `master`'s head as read just before the
    apply; and then its status decides. `SUCCESS` is `live`. Another final status is `failed`. A status that
    is not final is `waiting`, and so is a list in which no entry counts yet. `cannot` when any of the four
    field names is `null`, when the list is unreadable as `railwayBusy` reads it, or when an entry lacks one
    of the four fields: the output cannot show all four, so the fallback cannot confirm, and the job fails.
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
  - `FALLBACK_READ`, `false` unless Task 6 turned out false. It is the switch of design 6.2's fifth call.
  - `railwayEnvironmentOnGitHub(projectName, environmentName = 'production'): string`, the name Task 6 read:
    `<projectName> / <environmentName>`. The project's name comes from the evaluated settings file, so it is
    not written a second time.
  - `redeployVerdict(records, { environment, head, appliedAt }): { state: 'none' | 'waiting' | 'live' | 'failed' }`.
    `records` is a list of `{ environment, created_at, sha, creator: { login, type }, statuses: [{ state, created_at }] }`.
    A record counts only when all four hold (design 6.6):
    1. its `environment` equals `environment`;
    2. its creator's `login` is `RAILWAY_APP_LOGIN` and its `type` is `Bot`;
    3. its `sha` equals `head`, `master`'s head as read just before the apply;
    4. its `created_at` is later than `appliedAt`. Both are GitHub's clock: `appliedAt` is the `Date` header
       of the read that gave `head`.
    The oldest record that counts decides. Any `failure` or `error` status is `failed`. Otherwise any
    `success` is `live`, even when a later `inactive` follows. Otherwise `waiting`. None that counts is
    `none`.

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
test('every status that is not final counts as busy', () => {
  assert.equal(railwayBusy([{ status: 'SUCCESS' }, { status: 'REMOVED' }, { status: 'FAILED' }, { status: 'CRASHED' }]), 'idle');
  for (const s of ['BUILDING', 'DEPLOYING', 'INITIALIZING', 'WAITING', 'QUEUED', 'REMOVING', 'A_NEW_WORD'])
    assert.equal(railwayBusy([{ status: 'SUCCESS' }, { status: s }]), 'busy', s);
});
test('a state that cannot be read is unreadable, never quiet', () => {
  for (const bad of [null, {}, 'SUCCESS', [], [{}], [{ status: 7 }], [{ state: 'SUCCESS' }], [{ status: 'SUCCESS' }, null]])
    assert.equal(railwayBusy(bad), 'unreadable');
});
// The fallback's counting rule, with made-up field names in place of the ones Task 18 will see.
const F = { service: 'made_up_service', createdAt: 'made_up_created', status: 'status', commit: 'made_up_commit' };
const entry = (over) => ({ made_up_service: 'example-api', made_up_created: '2026-01-01T10:00:05Z', status: 'SUCCESS', made_up_commit: 'e'.repeat(40), ...over });
const listed = (list, fields = F) => listVerdict(list, { service: 'example-api', head: 'e'.repeat(40), appliedAt: '2026-01-01T10:00:00Z', fields });
test('the fallback counts only a deployment of the one service, made after the apply, for master\'s head', () => {
  assert.equal(listed([entry()]), 'live');
  assert.equal(listed([entry({ status: 'FAILED' })]), 'failed');
  assert.equal(listed([entry({ status: 'DEPLOYING' })]), 'waiting');
  for (const over of [{ made_up_service: 'another' }, { made_up_created: '2026-01-01T09:59:59Z' }, { made_up_commit: 'f'.repeat(40) }])
    assert.equal(listed([entry(over)]), 'waiting', JSON.stringify(over));   // it does not count, so nothing is confirmed yet
});
test('when the list cannot show all four, the fallback cannot confirm', () => {
  assert.equal(listed([entry()], { ...F, commit: null }), 'cannot');           // the documented list carries no commit
  assert.equal(listVerdict([entry()], { service: 'example-api', head: 'e'.repeat(40), appliedAt: '2026-01-01T10:00:00Z' }), 'cannot');   // nothing seen yet
  for (const key of ['made_up_service', 'made_up_created', 'status', 'made_up_commit']) {
    const lacking = entry(); delete lacking[key];
    assert.equal(listed([lacking]), 'cannot', key);
  }
  assert.equal(listed([]), 'cannot');
});
test('the running build contains master, or nothing the API is built from changed since', () => {
  assert.equal(buildContainsHead({ relation: 'identical', patterns: PATTERNS, files: [] }), 'contains');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: ['docs/a.md'] }), 'unchanged');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: ['packages/api/a.ts'] }), 'behind');
  assert.equal(buildContainsHead({ relation: 'behind', patterns: PATTERNS, files: Array(300).fill('docs/a.md') }), 'unknown');
  assert.equal(buildContainsHead({ relation: 'diverged', patterns: PATTERNS, files: [] }), 'unknown');
});

// redeploy.test.mjs: records shaped as Task 6 found them, with made-up ids, names and commits.
const HEAD = 'e'.repeat(40), ENV = railwayEnvironmentOnGitHub('made-up');
const AT = '2026-01-01T10:00:00Z';
const record = (over) => ({ environment: ENV, sha: HEAD, created_at: '2026-01-01T10:00:05Z',
  creator: { login: RAILWAY_APP_LOGIN, type: 'Bot' }, statuses: [{ state: 'in_progress' }, { state: 'success' }], ...over });
const verdict = (records) => redeployVerdict(records, { environment: ENV, head: HEAD, appliedAt: AT }).state;

test('Railway\'s environment on GitHub is the project\'s name, a slash, the environment\'s name', () => assert.equal(ENV, 'made-up / production'));
test('Railway\'s own record for this apply decides', () => assert.equal(verdict([record()]), 'live'));
test('a record counts only when all four hold', () => {
  for (const [name, over] of [
    ['the job\'s own environment', { environment: 'railway-settings' }],
    ['the Deploy workflow\'s environment', { environment: 'production' }],
    ['made by a person', { creator: { login: 'the-owner', type: 'User' } }],
    ['made by another app', { creator: { login: 'another-app[bot]', type: 'Bot' } }],
    ['for another commit', { sha: 'f'.repeat(40) }],
    ['made before the apply', { created_at: '2026-01-01T09:59:59Z' }],
    ['made in the same second as the read before the apply', { created_at: AT }],
  ]) assert.equal(verdict([record(over)]), 'none', name);
});
test('in progress is waiting; a failure or an error is failed', () => { /* ... */ });
test('a deployment later replaced still counts as live', () => { /* in_progress, success, inactive → live */ });
test('a record that does not count beside one that does changes nothing', () => { /* the wrong one says success, the right one in_progress → waiting */ });
```

- [ ] **Step 2: Run them to see them fail.** `node --test .github/railway-settings-check/look.test.mjs
  .github/railway-settings-check/redeploy.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the two modules.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/look.mjs .github/railway-settings/redeploy.mjs .github/railway-settings-check/look.test.mjs .github/railway-settings-check/redeploy.test.mjs
git commit -m "feat(ci): verdicts on other deploys and on the redeploy an apply starts (T-751)"
```

**What a person sees:** nothing yet.

### Task 8: The watched-path check as a command

**Files:**
- Create: `.github/railway-settings-check/watched.mjs`
- Test: `.github/railway-settings-check/watched.test.mjs`

**Interfaces:**
- Consumes: `watchedPathChanged` from Task 7.
- Produces: `node .github/railway-settings-check/watched.mjs`. It reads file names from standard input, one a
  line, and the list from `.railway/watch-patterns.json`. With none watched it prints
  `No watched path is touched.` and exits 0. Otherwise it prints each watched name and exits 1. It is a
  builder's tool. No approved job runs it, so it is not in the trusted folder.

- [ ] **Step 1: Write the failing test:** start the command with `docs/a.md` and `.railway/railway.ts` on
  standard input and expect the sentence and exit 0; with `packages/api/a.ts` among them expect that name and
  exit 1.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL, no `watched.mjs`.
- [ ] **Step 3: Write `watched.mjs`.**
- [ ] **Step 4: Run it, then use it on this branch.**

Run: `git fetch origin master && git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings-check/watched.mjs`
Expected: `No watched path is touched.`

- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings-check/watched.mjs .github/railway-settings-check/watched.test.mjs
git commit -m "feat(ci): a command that says whether a change touches a watched path (T-751)"
```

**What a person sees:** a builder can check any branch against the watch list with one command.

### Task 9: The two token steps as one tested sequence

**Files:**
- Create: `.github/railway-settings/flow.mjs`
- Test: `.github/railway-settings-check/flow.test.mjs`

**Interfaces:**
- Consumes: `renderPlan`, `readPlan` (Tasks 1 and 2); `commandsFor` (Task 3); `executingJobs`,
  `railwayBusy`, `buildContainsHead` (Task 7).
- Produces:
  - `SIX_HOURS = 21600`
  - `planStep(deps): Promise<{ ok: boolean, key: string, code?: number }>`. When `ok` is true the key is
    `stateQuiet` or `stateBusy`, the sentence step 2's summary will carry.
  - `applyStep(deps, { lines, plannedAt }): Promise<{ outcome: 'applied' | 'refused' | 'failed' | 'left-over', key: string, code?: number, appliedAt?: string, head?: string, reasons?: string[], after?: 'live' | 'failed' | 'cannot' }>`.
    `reasons` are Task 2's, given with the key `hand`.
  - `deps = { token, tool, readText, context, github, probe, recheck, now, fallbackRead, afterVerdict }`.
    `afterVerdict(text, { head, appliedAt })` is Task 7's `listVerdict` on the parsed text, for the one
    service.
    `tool(argv)` returns `{ code }`. `readText(name)` reads a file in WORK. `context` is Task 1's `ctx`.
    `github.executing()` returns `jobsByRunId` for the runs in progress of `MIGRATION_WORKFLOWS`.
    `github.head()` returns `{ sha, at }`: `master`'s head and GitHub's own time for that read. `probe()`
    returns `{ relation, patterns, files }`. `recheck()` returns a list of problems (Task 21 wires it to
    `reinstallKit` and `verifyPinned`). `now()` is seconds. `fallbackRead` is the switch of design 6.2's
    fifth call; `afterVerdict` reads its output. `key` names a sentence of Task 10.

**The order, which the tests pin.** It is design 6.2's.

`planStep`: with an empty `token`, call nothing and return `noToken`. Otherwise two calls to Railway and no
others, in this order, each with its output in a file:

1. `config plan --out`. A non-zero exit returns `planFailed` with the code, and the second call is not made.
2. `deployment list`. A non-zero exit returns `stateFailed` with the code. Its output is read from its file
   and given to `railwayBusy`: `unreadable` returns `stateUnknown`; `busy` returns `ok` with `stateBusy`;
   `idle` returns `ok` with `stateQuiet`. A state that cannot be read fails the step. It is never guessed.

So every run, a check included, proves the token can make both reads before a real change depends on them
(design 6.2). A busy Railway does not fail step 2: the summary says so, and step 3 looks again.

`applyStep`, stopping at the first that fails:

1. `plannedAt` is a whole number, not in the future by more than 300 seconds, and at most `SIX_HOURS` old.
   Else `refused`, `stale`. No tool call yet.
2. An empty `token`: `refused`, `noToken`.
3. **First call:** `config plan --out`. Non-zero: `failed`, `planFailed`.
4. Render it. Its lines must equal `lines` exactly. Else `refused`, `linesDiffer`.
5. It must have no refusals, and then it must be pending, in that order. Refusals: `refused`, `hand`, with
   the reasons. Only then, not pending: `refused`, `upToDate`. The order matters: a plan with no change that
   was made for another copy of the folder holds a refusal and nothing pending, and it must never read as
   up to date.
6. **Second call:** `deployment list`. Then the look. `executingJobs(await github.executing()) > 0`, or
   `railwayBusy` is `busy`: `refused`, `busy`. `buildContainsHead(await probe())` is `behind`: `refused`,
   `behind`. Anything that could not be read (`github.executing` or `probe` throws, `deployment list` exits
   non-zero, `railwayBusy` is `unreadable`, `buildContainsHead` is `unknown`): `refused`, `unread`.
7. `recheck()`. Any problem: `refused`, `notAsInstalled`.
8. `github.head()`, kept as `head` and `appliedAt`. It throws: `refused`, `unread`.
9. **Third call:** `config apply --plan ... --yes`. Non-zero: `failed`, `applyFailed`, with the code.
10. **Fourth call:** `config plan --detailed-exit-code`. `0`: `applied`. `2`: `left-over`, `leftOver`. Other:
    `left-over`, `closingUnread`, with the code.
11. **Fifth call, only when `fallbackRead` is true and the outcome is `applied`:** the same list of
    deployments again, every 30 seconds until `afterVerdict` says `live`, `failed` or `cannot`, for at most
    75 minutes. The answer is `after`; still `waiting` at the end is `cannot`. A call that exits non-zero is
    `cannot` at once. Anything but `live` fails the job in Task 21.

- [ ] **Step 1: Write the failing tests.** A fake `tool` records each `argv` and answers from a script; a fake
  `readText` returns a plan from `fixtures.mjs`.

```js
const calls = (run) => run.tool.calls.map((argv) => argv.slice(0, 3).join(' '));

test('step 2 with no token stored calls nothing', async () => { /* key 'noToken', calls [] */ });
test('step 2 makes two calls to Railway and no others: the plan, then the state', async () => {
  assert.deepEqual(calls(run), ['config plan --out', 'deployment list --service']);
  assert.deepEqual([r.ok, r.key], [true, 'stateQuiet']);
});
test('step 2 does not read the state when the plan could not be read', async () => {
  assert.deepEqual([r.ok, r.key, r.code, calls(run)], [false, 'planFailed', 1, ['config plan --out']]);
});
test('step 2 says Railway is busy without failing; step 3 will look again', async () => { /* a BUILDING entry: ok true, key 'stateBusy' */ });
test('step 2 fails, and does not guess, when the state cannot be read', async () => {
  // the state call exits 1: ok false, key 'stateFailed', code 1
  // the state call exits 0 with a shape railwayBusy does not know: ok false, key 'stateUnknown'
});
test('nothing the state call wrote is in what step 2 says', async () => {
  // the fake tool writes [{ "status": "SUCCESS", "id": "MADE-UP-STATE-OUTPUT" }] to the state's output file
  assert.ok(!JSON.stringify(r).includes('MADE-UP-STATE-OUTPUT'));
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
test('step 3 does not apply a plan it refuses, and says why', async () => { /* an emptied setting: key 'hand', reasons, no apply */ });
test('an empty plan for another copy of the folder is refused, never called up to date', async () => {
  // step 2 passed on no lines; step 3's own plan holds no change and a sourceTree that is not this commit's
  assert.deepEqual([r.outcome, r.key, r.reasons], ['refused', 'hand', ['the plan is for another copy of the settings folder']]);
});
test('an empty plan with nothing against it is up to date, and nothing is applied', async () => {
  assert.deepEqual([r.outcome, r.key, calls(run)], ['refused', 'upToDate', ['config plan --out']]);
});
for (const [name, spoil] of [['a Deploy job is executing', /* ... */], ['Railway is building', /* ... */],
  ['Railway\'s state cannot be read', /* ... */], ['production is behind master\'s API code', /* ... */],
  ['the running build cannot be placed', /* ... */], ['master\'s head cannot be read', /* ... */]])
  test(`step 3 does not apply when ${name}`, async () => { /* no 'config apply' among calls */ });
test('step 3 does not apply when the kit, the tool or the runtime is not as installed', async () => {
  // recheck returns one problem
  assert.deepEqual([r.outcome, r.key], ['refused', 'notAsInstalled']);
  assert.ok(!calls(run).includes('config apply --plan'));
});
test('the check of what was installed comes after the look and just before the apply', async () => {
  // the fakes share one log of events
  assert.deepEqual(run.events, ['tool:config plan --out', 'tool:deployment list --service', 'recheck', 'head', 'tool:config apply --plan', 'tool:config plan --detailed-exit-code']);
});
test('step 3 makes four calls to Railway, in the design\'s order, and that is all', async () => {
  assert.deepEqual(calls(run), ['config plan --out', 'deployment list --service', 'config apply --plan', 'config plan --detailed-exit-code']);
  assert.deepEqual([r.outcome, r.head, r.appliedAt], ['applied', HEAD, AT]);
});
test('with the fallback switched on, the fifth call is the state read again, after the closing plan', async () => {
  assert.deepEqual(calls(run).slice(4), ['deployment list --service']);
  assert.equal(r.after, 'live');
});
test('the fallback read is not made when the apply did not succeed', async () => { /* a failed apply; a left-over plan */ });
test('a fallback that cannot confirm says so, and does not go on asking', async () => {
  // afterVerdict answers 'cannot' at the first read: one fifth call, r.after 'cannot'
  // the fifth call exits 1: r.after 'cannot'; still 'waiting' when the 75 minutes of the fake clock run out: 'cannot'
});
test('a closing plan that is not empty is left-over, not applied', async () => { /* exit 2: leftOver; exit 1: closingUnread */ });
test('a failed apply never reaches the closing plan, and reports its exit code', async () => { /* ... */ });
test('every command the flow gives the tool is one its own step may make', async () => {
  for (const argv of planRun.tool.calls) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'plan'));
  for (const argv of applyRun.tool.calls) assert.doesNotThrow(() => assertAllowed(argv, W, S, 'apply'));
});
test('nothing the tool wrote is in what the flow says', async () => {
  // the fake tool writes the text MADE-UP-TOOL-OUTPUT to its output files and into plan.json's summary fields
  assert.ok(!JSON.stringify(r).includes('MADE-UP-TOOL-OUTPUT'));
});
```

- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/flow.test.mjs`. Expected:
  FAIL.
- [ ] **Step 3: Write `flow.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/flow.mjs .github/railway-settings-check/flow.test.mjs
git commit -m "feat(ci): the order of the two Railway settings token steps (T-751)"
```

**What a person sees:** nothing yet.

### Task 10: The words

**Files:**
- Create: `.github/railway-settings/words.mjs`
- Test: `.github/railway-settings-check/words.test.mjs`

**Interfaces:**
- Consumes: `lineMark` (Task 1).
- Produces: `SENTENCES`, by key, and three functions that each return the lines of one summary:
  `gateWords(facts)`, `planWords(facts)`, `applyWords(facts)`.

| Key | The sentence |
|---|---|
| `noEnvironment` | The environment railway-settings could not be read. Nothing was started. |
| `gateWrong` | The environment's rules are not as they should be. Nothing was started. |
| `notCurrent` | This run is not for master's trusted places as they are now. Approve the newer run. |
| `bypassUnseen` | This run cannot see whether administrators may bypass the gate. That rule rests on the founder's own check. |
| `vouch` | This step cannot vouch for the workflow file itself: a changed workflow file is the code that ran this step. |
| `trust` | Approving "Read Railway's plan" gives this commit's code the Railway token. |
| `noHistory` | No earlier run of this workflow applied a change. Everything the next steps run or read is shown in full. |
| `rehearsal` | Rehearsal. No token is stored. Nothing was read from Railway. This step waited for its own approval. |
| `noToken` | No token is stored in the environment. Nothing was read from Railway. |
| `planFailed` | Railway's plan could not be read. Exit code {code}. |
| `stateFailed` | Railway's own state could not be read. Exit code {code}. |
| `stateUnknown` | Railway answered about its own state in a shape this workflow does not know. |
| `stateQuiet` | Railway is not building or deploying just now. |
| `stateBusy` | Railway is building or deploying just now. Wait for it to finish before the second approval. |
| `upToDate` | Already up to date. Railway holds what the file declares. |
| `redeploys` | Applying this redeploys the API at commit {sha}, with its migration step. |
| `shape` | The workflow judges the shape of a change, not its meaning. What the marked lines mean is yours to judge. |
| `staged` | Before the second approval, look at Railway's dashboard. If it shows staged changes, do not approve. |
| `deployRun` | Do not approve a Deploy run until "Apply this plan" has finished. |
| `hand` | This change is applied by hand. |
| `stale` | The plan was read more than six hours ago. Start a new run. |
| `linesDiffer` | Railway changed since the plan was read. Nothing was applied. Start a new run. |
| `busy` | A deploy or a migration is under way. Nothing was applied. Start a new run later. |
| `behind` | Production does not yet run master's API code. Nothing was applied. |
| `unread` | Something this step must read before it applies could not be read. Nothing was applied. |
| `notAsInstalled` | The kit, the tool or the runtime on the runner is not what was installed. Nothing was applied. |
| `applyFailed` | The apply failed. Exit code {code}. "Check now" shows what Railway holds. |
| `leftOver` | Applied, but something still differs. A person looks. |
| `closingUnread` | Applied, but the plan that should now be empty could not be read. Exit code {code}. A person looks. |
| `applied` | Applied. Nothing is left to change. |
| `headMoved` | master moved while this ran. If the newer commit changed a trusted place, it has its own run. |
| `live` | Railway reports the new deployment live at commit {sha}. |
| `redeployFailed` | Applied, but Railway reports that the new deployment failed. The previous deployment keeps serving. |
| `notConfirmed` | Applied. The redeploy is not confirmed: no record of it by Railway, for master's head, reached GitHub. |
| `cannotConfirm` | Applied. The redeploy is not confirmed: Railway's own list could not show that it is live. |

**The three summaries.** Each is a heading and plain lines. Each ends with `bypassUnseen` when the gate could
not see the bypass answer (`bypassChecked` of Task 5 is false).

Step 1, `gateWords({ sha, pullRequest, rules, lastAgreed, changed, expected, versions, full, bypassChecked })`:

```
## Railway settings: what this run trusts
Commit abc1234 (pull request #123), on master.
The gate: one reviewer, the repository's owner. Self-review allowed. master only. Administrators cannot bypass.
This workflow last applied a change at commit def5678 (run 456).
Changed since then, in what the next steps run or read:
- .railway/railway.ts
What the file changes, in Railway's names:
deploy.healthcheckTimeout: 2700 -> 3000
Railway's tool 5.74.0, kit 3.17.0, runtime v22.23.2.
This step cannot vouch for the workflow file itself: a changed workflow file is the code that ran this step.
Approving "Read Railway's plan" gives this commit's code the Railway token.
```

With nothing changed it says `Nothing changed in what the next steps run or read.` and
`The file declares what it declared then.` With `lastAgreed` null it says `noHistory` in place of the two
"last applied" and "changed since" lines, leaves out "What the file changes", and then shows every file of
`full` (a list of `{ path, text }` for the trusted places): the path, its number of lines, and its text in a
folded block. That is every run until this workflow has applied its first change: a run that only finds
Railway up to date does not count as one (design 6.2). With no pull request found it names the commit alone. When the bypass answer was not seen, the
gate's line ends `Whether administrators can bypass: not seen by this run.`

Step 2, `planWords({ render, sha, expected, state, bypassChecked })`: the heading `## Railway's plan`, then
the lines of Task 1. A line that `lineMark` marks is followed on the same line by
`   [yours to judge: <the mark>]`. Then, when `expected` is known, one of:
`This is what the file's change predicts.` when the lines without their last equal `expected`; or
`Railway differs from what was last applied in more than the file's change.` Then `redeploys`, then `shape`
when any line is marked, then the sentence for `state` (`stateQuiet` or `stateBusy`), then `staged` and
`deployRun`. For a plan with refusals, whether or not it holds a change: the lines, then `hand`, then `Why:`
and each reason, then the sentence for `state`. Only for a plan with no refusals and nothing pending:
`upToDate`, then the sentence for `state`. The refusals are looked at first, as in Task 9.

Step 3, `applyWords({ result, redeploy, headMoved, bypassChecked })`: the heading `## Apply this plan`, the
sentence for `result.key`, then for `hand` the line `Why:` and each of `result.reasons`, then for an applied
plan the sentence for the redeploy's state (`live`, `redeployFailed`, `notConfirmed`, or `cannotConfirm` when
the fallback's list could not show it), then `headMoved` when true.

In `redeploys` and `live` the commit is `master`'s head, because that is what Railway deploys. It can be
newer than the run's commit when the trusted places are the same in both.

- [ ] **Step 1: Write the failing tests:** one that holds the table above as data and compares every key; one
  for each summary comparing the whole text for the examples above; one for each row of design 6.8 that
  `applyWords` or `planWords` gives the sentence that row calls for; one that a summary with no last
  agreement shows each file's path and text and no "What the file changes"; one that each of the four marks
  appears on its line and brings `shape`, and that a plan with no marked line has neither; one that step 2's
  summary carries `stateQuiet` or `stateBusy`, word for word, in each of its three forms (a plan to apply, a
  refused plan, already up to date), and never both; one that a plan with no change and one refusal reads
  `hand` and its reason, and never `upToDate`; one that all three
  summaries end with `bypassUnseen` when the answer was not seen, and none does when it was; one that no
  sentence holds a `{` once its values are filled.
- [ ] **Step 2: Run it to see it fail.** `node --test .github/railway-settings-check/words.test.mjs`.
  Expected: FAIL.
- [ ] **Step 3: Write `words.mjs`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add .github/railway-settings/words.mjs .github/railway-settings-check/words.test.mjs
git commit -m "feat(ci): every sentence the Railway settings workflow says (T-751)"
```

**What a person sees:** nothing yet. These are the words the founder will read on the run's page.

### Task 11: The CI check, and the idle step retired

Design 6.7. It reads every workflow file as YAML and checks structure. It holds no list of banned words.

**Files:**
- Create: `.github/railway-settings-check/check-workflows.mjs`, `.github/railway-settings-check/package.json`,
  `.github/railway-settings-check/package-lock.json`
- Test: `.github/railway-settings-check/check-workflows.test.mjs`,
  `.github/railway-settings-check/trusted-folder.test.mjs`
- Modify: `.github/workflows/ci.yml`: the header comment at lines 13-15; `gate-tooling`'s `timeout-minutes`
  from 5 to 10; the kit step of Task 4 also runs
  `npm ci --ignore-scripts --prefix .github/railway-settings-check`; the step at lines 633-672 is replaced by
  `Railway settings: every workflow file, the trusted places, the watch list`, running
  `node .github/railway-settings-check/check-workflows.mjs`

**What parses YAML.** The `yaml` package, in the check folder's own `package.json` and `package-lock.json`,
installed with `npm ci --ignore-scripts`. It is not a root dependency and the folder is outside the pnpm
workspace, so no watched path changes. It is not in a trusted place: only CI's tooling job installs it, and
no approved job reads that folder. It reads YAML 1.2, so the key `on` stays a string, and it reports
duplicate keys. `package.json` is `private`, with `yaml` as its one `devDependency` at an exact version: the
newest 2.x release on the day.

**What becomes of the idle step** ("Railway watch list is valid, and equals railway.json's if that file
exists", `ci.yml:633-672`). `railway.json` was deleted on 22 November, so the step compares nothing. Its two
duties move into the new check: the watch list must be a non-empty list of paths that each begin with `/`
(the production receipt and Task 7 read it), and `railway.json` must not exist at the repository's root. A
file that came back would be read by Railway until 1 December 2026 and ignored after; either is a mistake.

**Interfaces:**
- Produces:
  - `checkWorkflows(files: { [name: string]: string }): string[]`, problems as `file: what is wrong`.
  - `TRUSTED_FILES`, the names the trusted folder may hold: `cli.mjs`, `declared.mjs`,
    `evaluate-settings.mjs`, `flow.mjs`, `gate.mjs`, `install-runtime.sh`, `install-tool.sh`, `look.mjs`,
    `pins.json`, `plan-lines.mjs`, `redeploy.mjs`, `run.sh`, `since-last.sh`, `tool.mjs`, `words.mjs`.
  - `checkTrustedFolder(entries: { [name: string]: string }): string[]`, over the folder's names and texts.
  - `checkSettingsImports(source: string): string[]`, over the text of `.railway/railway.ts`.
  - `checkWatchList(list: unknown): string[]` and `checkNoOldFile(names: string[]): string[]`.
  - Run as a program, it reads `.github/workflows/*.yml` and `*.yaml`, the trusted folder, and
    `.railway/railway.ts`; evaluates that file (Tasks 3 and 4); reads the watch list; prints each problem as
    `::error file=<file>::<problem>` and exits 1 when there is any. With none it prints
    `Railway settings: <n> workflow files checked.`

**The rules.** In every workflow file:

1. It parses with no error, and its top level is a map with `jobs`.
2. Every job's `environment`, when present, is a plain string or a map whose `name` is a plain string. A
   value holding `${{` is refused.
3. An environment name that equals `railway-settings`, ignoring case and outer spaces, is allowed only in
   `railway-settings.yml`.
4. No job calls a reusable workflow (`jobs.<id>.uses`) from outside `./.github/workflows/`.
5. No workflow but `railway-settings.yml` names a secret that begins `RAILWAY`, in any letter case and in
   either way of writing it (`secrets.NAME`, `secrets['NAME']`). No workflow reads the `secrets` context
   whole (`toJSON(secrets)`) or by a computed name, and no job passes `secrets: inherit`: any of those could
   name such a secret without writing it.
6. A file whose `run` text holds `db:migrate`, `drizzle-kit migrate` or `apply-migration-` is in
   `MIGRATION_WORKFLOWS` (Task 7).

In `railway-settings.yml`, also:

7. `on` is exactly `push` with `branches: [master]` and `paths` equal to the three trusted places
   (`.railway/**`, `.github/railway-settings/**`, `.github/workflows/railway-settings.yml`), and
   `workflow_dispatch` with no inputs. No other key.
8. The top-level `permissions` is the empty map. There is no top-level `concurrency`, `env` or `defaults`.
9. The jobs are exactly `gate`, `plan` and `apply`, named as in "Names every task uses". `plan` needs `gate`;
   `apply` needs `gate` and `plan`. Each runs on `ubuntu-24.04` and has `timeout-minutes`. None has
   `container`, `services`, `strategy`, `continue-on-error`, `concurrency` or `env`.
10. Every job states its own condition and its own permissions. Its `if`, with spaces squeezed, is the fixed
    text `github.repository == '<this repository>' && github.ref == 'refs/heads/master'`, with the same full
    name in all three jobs; when CI runs the check, that name must be the one in `GITHUB_REPOSITORY`. For
    `apply` the text is followed by `&&` and the bracketed test of `needs.plan.outputs`. Its `permissions` is
    a map whose keys are among `contents`, `actions` and `deployments` and whose values are all `read`.
11. `gate` has no `environment`. `plan` and `apply` each have exactly
    `environment: { name: railway-settings, deployment: false }`, so they make no deployment record.
12. Everything a job runs or reads is in the trusted places. Every `uses` is `actions/checkout@` followed by
    40 hex characters, with `persist-credentials: false` and a sparse checkout of exactly the three trusted
    places. Every `run` is, after trimming, one of the lines in `RUN_LINES`, a list held in the check; every
    such line begins `bash .github/railway-settings/` and holds no `${{`. No step sets `shell` or
    `working-directory`.
13. The `secrets` context appears in this file in two ways only, each written as a literal (design 6.7).
    `secrets.RAILWAY_SETTINGS_TOKEN`: at most once in `plan` and at most once in `apply`, each time as the
    whole value `${{ secrets.RAILWAY_SETTINGS_TOKEN }}` of `env.RAILWAY_SETTINGS_TOKEN` of the step whose
    `run` is the plan or apply line. `secrets.GITHUB_TOKEN`: only as the whole value of a step's
    `env.GITHUB_TOKEN`, where a step needs it. Index syntax (`secrets[`, with any spacing) and
    `toJSON(secrets)` appear nowhere in the file, in any letter case, in an expression or outside one, not
    even for the allowed names. The check reads the file's text for these, not only its parsed values.
14. The two approved jobs are named as `AGREED_JOBS` names them, and `apply` has a step named
    `Nothing is left to change` (`AGREED_STEPS`, Task 5), or the file is in rehearsal form and has none.
15. The file uses no anchor, alias, merge key or tag.
16. Each step is held to its own calls (design 6.7). The check, run as a program, asks `tool.mjs` itself:
    `commandsFor('plan', ...)` must be exactly the plan with `--out` and the list of deployments, and
    `commandsFor('apply', ...)` exactly design 6.2's four. And in `cli.mjs` every call of `runTool` passes a
    `step`, and none passes `standIn`.

In the trusted folder (`checkTrustedFolder`):

17. It holds no name that is not in `TRUSTED_FILES`, and no folder.
18. Each `.mjs` imports only `node:` built-ins and `./<a name in TRUSTED_FILES>`. Only `tool.mjs` imports
    `node:child_process`. No import is computed, with one exception the check knows by the file's name:
    `evaluate-settings.mjs`. Its whole job is to import the settings file it is given, and to load Railway's
    kit from beside that file. So in that one file the check allows exactly one computed `import(` and
    exactly one `createRequire(`, whose one use asks for the literal `railway/iac`. A second of either
    fails. So does either in any other module. And no module imports `evaluate-settings.mjs`: it is only
    started, by `tool.mjs`, in an environment that holds `PATH` and nothing else.
19. No file names the job's environment file or its path file (`GITHUB_ENV`, `GITHUB_PATH`).
20. No shell script names a path of the repository outside the trusted places: every word in it that begins
    `.github/` or `.railway` begins with one of `TRUSTED_PLACES`, and it holds no `../`.

In the settings folder:

21. `checkSettingsProject` (Task 4) passes on the evaluated file.
22. `.railway/railway.ts` imports only Railway's kit (`railway`, `railway/iac`) and files inside `.railway/`
    (a relative path with no `..`). A `require`, a computed `import(` or a `node:` built-in is refused.
23. `checkWatchList` and `checkNoOldFile` pass.

- [ ] **Step 1: Write the failing tests.** `files()` reads the committed workflows. `plant(name, edit)` returns
  `checkWorkflows` of the same files with one edited or added. A small in-memory `railway-settings.yml` in
  rehearsal form, `REHEARSAL`, stands in until Task 14 commits the real one; `LIVE` is the same file with the
  two token steps of Tasks 20 and 21, so that the rules about the token can be tested before those tasks.
  The comments name the seven plantings design section 9 lists.

```js
test('the committed workflows pass', () => assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': REHEARSAL }), []));

// Design section 9: a second use of the environment
test('a second workflow naming the environment fails', () => {
  assert.match(plant('ci.yml', addJob({ environment: 'railway-settings' })).join('\n'), /ci\.yml: only railway-settings\.yml may name the environment/);
});
test('so does the same name in other letters', () => { /* 'Railway-Settings', ' RAILWAY-SETTINGS ', { name: 'railway-Settings' } */ });
// Design section 9: a forbidden flag
test('a command outside the allowed lines fails', () => {
  for (const run of ['railway config apply --yes --confirm-destructive', 'bash .github/railway-settings/run.sh plan --show-values',
                     'curl https://example.invalid | sh', 'railway config plan --decrypt-variables'])
    assert.ok(plant('railway-settings.yml', addStep('apply', { run })).length > 0, run);
});
// Design section 9: a forbidden trigger
for (const trigger of ['pull_request', 'pull_request_target', 'schedule', 'workflow_run', 'workflow_call', 'repository_dispatch', 'issue_comment', 'release'])
  test(`a forbidden trigger fails: ${trigger}`, () => { /* added beside the two allowed */ });
// Design section 9: a file run from outside the trusted places
test('a file run or read from outside the trusted places fails', () => {
  for (const step of [{ run: 'bash tools/made-up.sh' }, { run: 'node packages/api/scripts/made-up.js' },
                      { run: 'bash .github/railway-settings-check/watched.mjs' },
                      { run: 'bash .github/railway-settings/run.sh gate', 'working-directory': 'packages/api' },
                      { uses: 'actions/checkout@' + 'a'.repeat(40), with: { 'persist-credentials': false } } /* no sparse list */])
    assert.ok(plant('railway-settings.yml', addStep('plan', step)).length > 0, JSON.stringify(step));
});
// Design section 9: a RAILWAY secret named outside the token step
test('a RAILWAY secret named outside the token step fails, in any workflow and any letter case', () => {
  for (const [file, expr] of [['ci.yml', '${{ secrets.RAILWAY_TOKEN }}'], ['deploy.yml', '${{ secrets.RAILWAY_SETTINGS_TOKEN }}'],
                              ['cleanup.yml', '${{ secrets.railway_api_token }}'], ['ci.yml', "${{ secrets['RAILWAY_TOKEN'] }}"],
                              ['ci.yml', '${{ toJSON(secrets) }}'], ['ci.yml', "${{ secrets[format('RAILWAY_{0}', 'TOKEN')] }}"]])
    assert.ok(plant(file, addEnvSomewhere(expr)).length > 0, `${file}: ${expr}`);
});
test('the token outside its one step fails inside the settings workflow too', () => { /* a second step; the gate job; a step whose run is not the plan or apply line; another secret's name */ });
test('the two literal ways of naming a secret pass in the live form', () => {
  assert.deepEqual(checkWorkflows({ ...files(), 'railway-settings.yml': LIVE }), []);
  // and with ${{ secrets.GITHUB_TOKEN }} in place of ${{ github.token }} as a step's env.GITHUB_TOKEN
});
// Design section 9: a secret read by index syntax
test('a secret read by index syntax fails in the settings workflow, even the allowed one in its own step', () => {
  for (const expr of ["${{ secrets['RAILWAY_SETTINGS_TOKEN'] }}", '${{ secrets["RAILWAY_SETTINGS_TOKEN"] }}', "${{ secrets [ 'GITHUB_TOKEN' ] }}",
                      "${{ secrets[format('RAILWAY_{0}_TOKEN', 'SETTINGS')] }}", '${{ SECRETS[env.NAME] }}'])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': LIVE.replace('${{ secrets.RAILWAY_SETTINGS_TOKEN }}', () => expr) }).length > 0, expr);
});
// Design section 9: toJSON(secrets)
test('toJSON(secrets) fails anywhere in the settings workflow', () => {
  for (const [job, step] of [['gate', { run: RUN_LINES[0], env: { ALL: '${{ toJSON(secrets) }}' } }],
                             ['plan', { run: RUN_LINES[0], env: { ALL: '${{ tojson( secrets ) }}' } }],
                             ['apply', { name: 'a step named toJSON(secrets)', run: RUN_LINES[0] }]])
    assert.ok(checkWorkflows({ ...files(), 'railway-settings.yml': withStep(LIVE, job, step) }).length > 0, job);
});
test('a secret that is neither of the two fails in the settings workflow', () => { /* secrets.MADE_UP_NAME; secrets.GITHUB_TOKEN as anything but env.GITHUB_TOKEN */ });
test('each step is held to its own calls', () => {
  // the check fails when commandsFor('plan') holds the apply; when cli.mjs calls runTool with no step; when cli.mjs names standIn
});

test('an environment name built from an expression fails in any workflow', () => { /* '${{ inputs.target }}', { name: '${{ vars.E }}' } */ });
test('a push that is not master and the three trusted places fails', () => { /* another branch; no paths; one place missing; a fourth path; tags */ });
test('a manual start with inputs fails', () => { /* ... */ });
test('a job without its own condition, or with another one, fails', () => { /* no if; only the master test; an || added; another repository's name in one job */ });
test('a job without its own permissions, or with a write, fails; so do top-level permissions', () => { /* ... */ });
test('an approved job that would make a deployment record fails', () => { /* environment: railway-settings as a plain string; deployment: true; deployment built from an expression */ });
test('an action other than the pinned checkout fails', () => { /* setup-node; checkout@v5; checkout by a short id; upload-artifact; cache */ });
test('a concurrency group, a container or a matrix fails', () => { /* ... */ });
test('a reusable workflow from elsewhere fails', () => { /* jobs.x.uses: other/repo/.github/workflows/a.yml@main */ });
test('a workflow that runs migrations and is not on the look\'s list fails', () => { /* a new file with pnpm db:migrate */ });
test('an anchor or a duplicate key in the settings workflow fails', () => { /* ... */ });

// trusted-folder.test.mjs
test('the trusted folder as committed passes', () => assert.deepEqual(checkTrustedFolder(trustedFolder()), []));
test('a file that is not on the list fails', () => { /* a test file; a package.json; a node_modules folder */ });
test('a module that reaches outside its folder fails', () => {
  for (const line of ["import x from '../railway-settings-check/fixtures.mjs';", "import y from '../../packages/api/src/a.js';",
                      "import z from 'yaml';", "const m = await import(name);", "import { spawn } from 'node:child_process';" /* in flow.mjs */])
    assert.ok(checkTrustedFolder({ ...trustedFolder(), 'flow.mjs': trustedFolder()['flow.mjs'] + '\n' + line }).length > 0, line);
});
test('only evaluate-settings.mjs may import a path it is given, and only once', () => {
  const folder = trustedFolder(), script = folder['evaluate-settings.mjs'];
  assert.deepEqual(checkTrustedFolder(folder), []);   // as committed: one computed import, one createRequire for 'railway/iac'
  for (const more of ["await import(process.argv[3]);", "createRequire(fileUrl)('made-up-package');", "createRequire(import.meta.url)(name);"])
    assert.ok(checkTrustedFolder({ ...folder, 'evaluate-settings.mjs': script + '\n' + more }).length > 0, more);
  assert.ok(checkTrustedFolder({ ...folder, 'cli.mjs': folder['cli.mjs'] + "\nimport './evaluate-settings.mjs';" }).length > 0);
});
test('a file that writes to the job\'s environment file or path file fails', () => { /* GITHUB_ENV in run.sh; GITHUB_PATH in cli.mjs */ });
test('a script that names a repository path outside the trusted places fails', () => { /* cat .github/workflows/deploy.yml; cat ../x; cat .github/railway-settings-check/a */ });
test('the settings file may import only the kit and its own folder', () => {
  assert.deepEqual(checkSettingsImports(readFileSync('.railway/railway.ts', 'utf8')), []);
  for (const line of ['import a from "../packages/api/src/a.js";', 'import fs from "node:fs";', 'import b from "made-up-package";',
                      'const c = await import(name);', 'const d = require("./watch-patterns.json");'])
    assert.ok(checkSettingsImports(line).length > 0, line);
});
test('the watch list must be a non-empty list of rooted paths', () => { /* [], {}, [''], ['packages/api/**'], [1] */ });
test('railway.json must stay deleted', () => assert.notDeepEqual(checkNoOldFile(['railway.json', 'package.json']), []));
test('the one package is pinned exactly, has an integrity hash and no install script', () => { /* the check folder's package.json and package-lock.json */ });
```

- [ ] **Step 2: Run them to see them fail.**

Run: `node --test .github/railway-settings-check/check-workflows.test.mjs .github/railway-settings-check/trusted-folder.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Add the package.** In `.github/railway-settings-check/`: write `package.json`; run
  `npm install --ignore-scripts --save-exact --save-dev yaml`; then `npm audit`. Expected: one package added,
  `found 0 vulnerabilities`. Read `package-lock.json`: one package besides the root, with `integrity`, without
  `hasInstallScript`.
- [ ] **Step 4: Write `check-workflows.mjs`,** then edit `ci.yml` as listed.
- [ ] **Step 5: Run the tests and the check itself.**

Run: `node --test .github/railway-settings-check/*.test.mjs` then `node .github/railway-settings-check/check-workflows.mjs`
Expected: PASS; then `Railway settings: 9 workflow files checked.` (ten once Task 14 adds the workflow).

- [ ] **Step 6: Commit**

```bash
git add .github/railway-settings-check/check-workflows.mjs .github/railway-settings-check/check-workflows.test.mjs .github/railway-settings-check/trusted-folder.test.mjs .github/railway-settings-check/package.json .github/railway-settings-check/package-lock.json .github/workflows/ci.yml
git commit -m "feat(ci): check every workflow file and the trusted places against the Railway settings gate (T-751)"
```

**What a person sees:** a pull request that names the environment in a second workflow, names a Railway
secret anywhere else, adds a trigger, runs a file from outside the trusted places or manages variables now
fails CI's tooling job, with the file and the reason beside it.

### Task 12: The scripts and the wiring

**Files:**
- Create: `.github/railway-settings/pins.json`, `.github/railway-settings/install-runtime.sh`,
  `.github/railway-settings/install-tool.sh`, `.github/railway-settings/since-last.sh`,
  `.github/railway-settings/run.sh`, `.github/railway-settings/cli.mjs`
- Test: `.github/railway-settings-check/pins.test.mjs`, `.github/railway-settings-check/cli.test.mjs`

**Interfaces:**
- Produces:
  - `pins.json`, two entries of one shape:
    `{ "tool": { "version": "5.74.0", "asset": "railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz", "sha256": "<64 hex>", "binarySha256": "<64 hex>" }, "runtime": { "version": "<x.y.z>", "asset": "node-v<x.y.z>-linux-x64.tar.xz", "sha256": "<64 hex>", "binarySha256": "<64 hex>" } }`.
    `sha256` is of the file fetched. `binarySha256` is of the one program inside it: `railway`, and
    `bin/node`.
  - `install-runtime.sh` and `install-tool.sh`: each, with `set -euo pipefail`, reads its entry with `jq`;
    fetches the file (`https://nodejs.org/dist/v<version>/<asset>`, and
    `https://github.com/railwayapp/cli/releases/download/v<version>/<asset>`) with
    `curl --fail --silent --show-error --location --proto '=https' --tlsv1.2`; checks it with
    `sha256sum --check --strict`; unpacks it into `WORK/runtime/` or `WORK/tool/`; checks the program inside
    against `binarySha256`; prints `Runtime <version>: the checksum matches.` or
    `Railway's tool <version>: the checksum matches.` Neither starts what it installs.
  - `run.sh <command...>`: starts `WORK/runtime/bin/node` on `cli.mjs` with its arguments. It is how every
    step after the first runs the workflow's own code under the pinned runtime.
  - `since-last.sh`: reads the commit from `LAST_AGREED_SHA`. When it is empty it does nothing. Otherwise it
    fails unless it is 40 hex characters; fetches that one commit with `--depth=1`; writes the names that
    differ between it and `HEAD` under the three trusted places to `WORK/changed.txt`; and unpacks that
    commit's three trusted places into `WORK/last/` with `git archive`.
  - `cli.mjs` commands. Each reads `GITHUB_*` and `RUNNER_TEMP`, calls the modules, appends to
    `GITHUB_STEP_SUMMARY` and `GITHUB_OUTPUT`, and exits non-zero on a refusal. It reads GitHub with the
    run's own token (`GITHUB_TOKEN`) and no other.
    - `kit`: `reinstallKit('.railway')`.
    - `gate`: reads the environment and its branch rules, both with their status and any further page; the
      git id of each trusted place at the run's commit and at `master`'s head, by walking GitHub's git trees
      endpoint down from each commit, so no process is started. Refuses by `checkEnvironmentRules`, with
      `bypassVisible` from `BYPASS_VISIBLE`, and by `checkRunIsCurrent`. Any failed read here is a refusal.
      **The owner's id** arrives as text, in `GITHUB_REPOSITORY_OWNER_ID`, and `checkEnvironmentRules` takes
      a number. The conversion is here and nowhere else: text that is one or more digits with no leading
      nought becomes that number; anything else (empty, a sign, a space, a letter) is a refusal before any
      rule is read. `cli.test.mjs` tests both.
      It then reads this workflow's last 30 runs and, newest first, each candidate's jobs, and the review
      history of a candidate whose apply succeeded; it gives them to `lastAgreedCommit` with `repository`
      from `GITHUB_REPOSITORY`, and outputs `last_agreed_sha`. The output is empty when `lastAgreedCommit` is
      `null`, when any of those reads fails, or when the run's own commit does not contain the candidate
      (GitHub's compare is neither `ahead` nor `identical`). **That containment check is also what carries a
      tag named `master`:** GitHub's run object cannot tell such a tag from the branch, so
      `lastAgreedCommit` cannot (Task 5). A commit that only a tag reached is not in `master`'s history, so
      it is not contained in a run on `master`, and it is dropped here. `gate again` does the two refusals
      and skips the history.
    - `show`: with a last agreed commit, installs that commit's kit in `WORK/last/.railway`, evaluates its
      file and the current one, and writes step 1's summary with the changed names and the expected lines.
      With none, it writes the summary with every file of the trusted places in full. It outputs
      `declared_last`, empty when there is none or the older file cannot be evaluated; old values are then
      hidden. If the summary would pass GitHub's size limit for one step, it refuses and says so.
    - `evaluate`: writes `WORK/declared-now.json`. Refuses by `checkSettingsProject`.
    - `tool-version`: `runTool(['--version'])`; its output file must hold exactly `railway <version>`.
    - `rehearse plan` and `rehearse apply`: write the `rehearsal` sentence, and for `plan` the outputs
      `mode=rehearsal`, `pending=false`.

- [ ] **Step 1: Find the four sums, and check each twice.**

```bash
gh api repos/railwayapp/cli/releases/tags/v5.74.0 \
  --jq '.immutable, (.assets[] | select(.name == "railway-v5.74.0-x86_64-unknown-linux-musl.tar.gz") | .digest)'
grep -E '^ARG NODE_VERSION=' Dockerfile
curl --fail --silent --show-error "https://nodejs.org/dist/v<that version>/SHASUMS256.txt" | grep 'linux-x64.tar.xz'
```

Expected: `true`, then `sha256:` and 64 hex characters; the version the API's image pins; one line with 64
hex characters. Then fetch both files and run `sha256sum` on each: the same sums. Unpack each and run
`sha256sum` on `railway` and on `bin/node`: these are the two `binarySha256`. If Railway's release is not
marked immutable, or any pair differs, stop and say so.

- [ ] **Step 2: Write the failing tests.** `pins.test.mjs`: each entry's `version` is `x.y.z`; the tool's
  `asset` is `railway-v<version>-x86_64-unknown-linux-musl.tar.gz` and the runtime's is
  `node-v<version>-linux-x64.tar.xz`; all four sums are 64 lower-case hex characters; neither install script
  holds a line that starts what it installed. `cli.test.mjs`, with an injected `fetch`: `gate` refuses when
  the environment's read answers 500, when the branch rules have a further page, and when a trusted place
  differs from `master`'s; `gate` still passes, with an empty `last_agreed_sha`, when only the history's read
  fails, or only a review history's; with `GITHUB_REPOSITORY_OWNER_ID` set to the text `1001` it passes
  against a reviewer whose id is the number 1001, and with it empty, `01001`, `1001x`, ` 1001` or `-1` it
  refuses and reads no rule; a run that applied after an approval gives its commit as `last_agreed_sha`
  only when GitHub's compare says this run's commit contains it, so a commit that only a tag named `master`
  reached gives none; it sends the run's own token and no other header of authority; `show` with no last
  agreed commit writes each trusted file's path and text; `evaluate` on a folder whose file manages
  variables refuses.
- [ ] **Step 3: Run them to see them fail.** Expected: FAIL.
- [ ] **Step 4: Write the six files.**
- [ ] **Step 5: Run every test.** `node --test .github/railway-settings-check/*.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git add .github/railway-settings/pins.json .github/railway-settings/install-runtime.sh .github/railway-settings/install-tool.sh .github/railway-settings/since-last.sh .github/railway-settings/run.sh .github/railway-settings/cli.mjs .github/railway-settings-check/pins.test.mjs .github/railway-settings-check/cli.test.mjs
git commit -m "feat(ci): fetch and verify the runtime and Railway's tool; wire the gate's commands (T-751)"
```

**What a person sees:** nothing yet.

### Task 13: Proof, with no token: the runner, the run's own token, and a job that never starts

Design section 9, not yet proven: that a job which is skipped does not create its environment, and whether a
run's own token can read the environment's bypass rule. Task 14's workflow relies on both. The same run
settles what this plan could not read anywhere: that the pinned runtime and the tool install on a real
runner, that the file evaluates there, that the checkout can be held to the trusted places, and which
permissions the gate's reads need.

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
permissions: {}
jobs:
  facts:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<the id of step 1>
        with:
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: |
            .railway
            .github/railway-settings
            .github/workflows/railway-settings.yml
      - run: ls -A . .github .github/workflows
      - run: bash .github/railway-settings/install-runtime.sh
      - run: bash .github/railway-settings/run.sh kit
      - run: bash .github/railway-settings/install-tool.sh
      - run: bash .github/railway-settings/run.sh tool-version
      - run: bash .github/railway-settings/run.sh evaluate
      - env:
          LAST_AGREED_SHA: ${{ github.event.pull_request.base.sha }}
        run: bash .github/railway-settings/since-last.sh && cat "$RUNNER_TEMP/railway-settings/changed.txt"
      - env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          for path in environments/Production environments/Production/deployment-branch-policies; do
            curl --silent --show-error --output "$RUNNER_TEMP/answer.json" --write-out "$path %{http_code}\n" \
              -H "Authorization: Bearer $GITHUB_TOKEN" "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/$path"
          done
          curl --silent --show-error -H "Authorization: Bearer $GITHUB_TOKEN" \
            "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/environments/Production" \
            | jq '{present: has("can_admins_bypass"), kind: (.can_admins_bypass | type), rules: [.protection_rules[]?.type]}'
  fails:
    runs-on: ubuntu-24.04
    permissions: {}
    steps:
      - run: exit 1
  never:
    needs: fails
    runs-on: ubuntu-24.04
    permissions: {}
    environment:
      name: proof-never-created
      deployment: false
    steps:
      - run: echo "this must never run"
```

  The reads are of the existing `Production` environment, because `railway-settings` does not exist yet. They
  use the run's own token, as the gate will.

- [ ] **Step 3: Open a draft pull request** titled "Proof only, never merge", and read the run.

| What is read | Expected | If it is not so |
|---|---|---|
| The listing after checkout | Only `.railway`, `.github/railway-settings` and the one workflow file | The checkout action does not narrow as asked. Task 14 uses a plain checkout, rule 12 of Task 11 drops the sparse list, and the other rules of the trusted places stand |
| The runtime's install | `Runtime <version>: the checksum matches.` | Stop. Read Node's release page for that version before changing anything |
| `kit` | Passes, under the pinned runtime | Read the error; npm in the pinned runtime is what installs the kit in every job |
| The tool's install and `tool-version` | `Railway's tool 5.74.0: the checksum matches.`, then a pass | Stop. The file is not the tool it claims to be |
| `evaluate` | Passes, with no token | Read the error. The tool evaluates the file the same way, so step 2 would fail too |
| `since-last.sh` | The names this pull request changed in the trusted places | Read the error: with no saved credentials the fetch of a public commit must still work |
| The two reads of the environment | `200` twice | Add `actions: read` to the job, then `deployments: read`, and run again. The least set that gives `200` twice becomes the permissions of `gate` and of the second gate reads. **If no read-only set gives it:** stop. Design 6.1's read-back cannot be built with the run's own token. Take it back to the release lead and the founder; no stronger token and no read without a token is used |
| The bypass field. `jq`'s `type` says `null` for a key that is missing and for one that holds `null`, so the proof prints `present` beside it to tell them apart | `"present": true, "kind": "boolean"`: a run's token sees the answer | `"present": false`: a run's token cannot see it. Task 14 sets `BYPASS_VISIBLE` to `false`. The workflow then does not check that rule, says so in every summary, and the rule rests on the founder's own look (Task 16). `"present": true, "kind": "null"`: the key is there with no answer in it. The gate refuses that on every run (Task 5), and the design's exemption is for a missing field only. Stop, and take it to the release lead: the choice is between treating an explicit `null` as "cannot see" and not building the read-back of that rule at all |
| `never` | Skipped | (it cannot run: its need failed) |

- [ ] **Step 4: Read whether GitHub created the environment.**

Run: `gh api "repos/{owner}/{repo}/environments/proof-never-created" --jq .name`
Expected: an error, `Not Found (HTTP 404)`.

**If it is false** (the environment exists): a skipped job does create its environment, with no rules. Then
the founder creates `railway-settings` and its rules (Task 16) before pull request 1 merges, so no run can
ever be the first to name it; he is also asked to delete `proof-never-created`. The token is in any case
stored only after Tasks 16 and 17.

- [ ] **Step 5: Close the draft pull request and delete the scratch branch.** Record the results in the
  session log.

**What a person sees:** a closed draft pull request whose run shows the results.

### Task 14: The workflow, in rehearsal form

**Files:**
- Create: `.github/workflows/railway-settings.yml`
- Modify: `.github/railway-settings/gate.mjs` (`BYPASS_VISIBLE`, as Task 13 found)
- Modify: `.github/railway-settings-check/check-workflows.mjs` (`RUN_LINES`, as below),
  `.github/railway-settings-check/check-workflows.test.mjs` (`REHEARSAL` is now the committed file)

**Interfaces:**
- Consumes: every command of Task 12; the commit id, the permissions and the bypass answer of Task 13.
- Produces: the workflow below. `RUN_LINES` is exactly the eleven different `run` values in it.

```yaml
name: Railway settings
run-name: "Railway settings: ${{ github.sha }}"

on:
  push:
    branches: [master]
    paths:
      - '.railway/**'
      - '.github/railway-settings/**'
      - '.github/workflows/railway-settings.yml'
  workflow_dispatch:

permissions: {}

jobs:
  gate:
    name: Check the gate, show the change
    if: github.repository == '<this repository>' && github.ref == 'refs/heads/master'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
      actions: read
    outputs:
      last_agreed_sha: ${{ steps.gate.outputs.last_agreed_sha }}
      declared_last: ${{ steps.show.outputs.declared_last }}
    steps:
      - name: Checkout the trusted places
        uses: actions/checkout@<the id of Task 13> # v5.x.y
        with:
          persist-credentials: false
          sparse-checkout-cone-mode: false
          sparse-checkout: |
            .railway
            .github/railway-settings
            .github/workflows/railway-settings.yml
      - name: Install the pinned runtime, verified
        run: bash .github/railway-settings/install-runtime.sh
      - name: Install Railway's kit, without scripts
        run: bash .github/railway-settings/run.sh kit
      - name: Read the gate's rules back, and check this run is current
        id: gate
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh gate
      - name: Fetch the trusted places as they were at the last change applied
        env:
          LAST_AGREED_SHA: ${{ steps.gate.outputs.last_agreed_sha }}
        run: bash .github/railway-settings/since-last.sh
      - name: Show what the approvals trust
        id: show
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh show

  plan:
    name: Read Railway's plan
    needs: gate
    if: github.repository == '<this repository>' && github.ref == 'refs/heads/master'
    runs-on: ubuntu-24.04
    environment:
      name: railway-settings
      deployment: false
    timeout-minutes: 15
    permissions:
      contents: read
    outputs:
      mode: ${{ steps.render.outputs.mode }}
      pending: ${{ steps.render.outputs.pending }}
      lines: ${{ steps.render.outputs.lines }}
      planned_at: ${{ steps.render.outputs.planned_at }}
    steps:
      # Checkout, the runtime and the kit: the same three steps as in gate.
      - name: Read the gate's rules back, and check this run is current, again
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh gate again
      - name: Install Railway's tool, verified
        run: bash .github/railway-settings/install-tool.sh
      - name: Check the tool is the pinned one
        run: bash .github/railway-settings/run.sh tool-version
      - name: Read what the file declares, with no token
        run: bash .github/railway-settings/run.sh evaluate
      - name: Rehearsal, nothing is read from Railway
        id: render
        run: bash .github/railway-settings/run.sh rehearse plan

  apply:
    name: Apply this plan
    needs: [gate, plan]
    if: github.repository == '<this repository>' && github.ref == 'refs/heads/master' && (needs.plan.outputs.pending == 'true' || needs.plan.outputs.mode == 'rehearsal')
    runs-on: ubuntu-24.04
    environment:
      name: railway-settings
      deployment: false
    timeout-minutes: 100
    permissions:
      contents: read
      actions: read
      deployments: read
    steps:
      # The same seven steps as in plan, down to the file's evaluation.
      - name: Rehearsal, nothing is applied
        run: bash .github/railway-settings/run.sh rehearse apply
```

`<this repository>` is the repository's full name, written out. Each job's permissions are the least Task 13
found: where the gate's reads need more than `contents: read`, that is added to the three jobs and to
nothing else. No `run` line holds an expression. A value from another step reaches a script through `env`,
as `LAST_AGREED_SHA` does, so rule 12 can compare every line with a fixed one. `plan` repeats the gate's two
refusals because it is the first job to hold the token (design 6.2); `apply` repeats them as design 6.2 says.

- [ ] **Step 1: Write the failing tests** in `check-workflows.test.mjs`:

```js
test('the settings workflow is committed, in rehearsal form', () => {
  const text = files()['railway-settings.yml'];
  assert.ok(text, 'railway-settings.yml is missing');
  assert.deepEqual(checkWorkflows(files()), []);
  assert.ok(!text.includes('secrets'), 'the rehearsal holds no reference to any secret');
  assert.ok(!/run\.sh (plan|apply|render|after)\b/.test(text), 'the rehearsal calls no command that reads Railway');
});
test('its two approved jobs are gated exactly as the live ones will be', () => {
  // both have environment { name: railway-settings, deployment: false }; apply needs plan; plan needs gate;
  // both run the second gate read before anything else of their own
});
test('the trusted folder holds every file on the list, and no other', () => { /* TRUSTED_FILES equals the folder's names */ });
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL, `railway-settings.yml is missing`.
- [ ] **Step 3: Write the workflow,** set `RUN_LINES` and `BYPASS_VISIBLE`.
- [ ] **Step 4: Run every test and the check.**

Run: `node --test .github/railway-settings-check/*.test.mjs && node .github/railway-settings-check/check-workflows.mjs`
Expected: PASS; `Railway settings: 10 workflow files checked.`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/railway-settings.yml .github/railway-settings/gate.mjs .github/railway-settings-check/check-workflows.mjs .github/railway-settings-check/check-workflows.test.mjs
git commit -m "feat(ci): the Railway settings workflow, in rehearsal form (T-751)"
```

**What a person sees:** after pull request 1 merges, "Railway settings" is listed under Actions with a "Run
workflow" button, and one run of it, refused at its first step (Task 15).

### Task 15: Pull request 1

**Files:**
- Modify: `docs/engineering/README.md` (one row in "Find the implementation": "Railway settings from GitHub",
  pointing at the design, the workflow and the two folders, with the boundaries "three trusted places; the
  token in one step per job; one entry for the tool; allow-lists; rehearsal only until the founder's set-up")
- Modify: `docs/state/tasks.md` (row T-751), `docs/sessions/<the day>.md`

- [ ] **Step 1: The checks a public repository needs.**

```bash
git fetch origin master
git diff --name-only --no-renames origin/master...HEAD | node .github/railway-settings-check/watched.mjs
git diff origin/master...HEAD | grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
git diff origin/master...HEAD | grep -nE '[A-Za-z]:[\\/][A-Za-z_]|[/\\][U]sers[/\\]'
git diff origin/master...HEAD | grep -nE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | grep -v '00000000-0000-'
```

Expected: `No watched path is touched.`, then nothing from each of the three searches.

- [ ] **Step 2: Open the pull request and send it to the release lead.** It carries, as evidence:
  - the count of tests and that all pass, from CI's tooling job;
  - the name of each test that plants a violation (Task 11), with the seven of design section 9 named first;
  - the results of Task 13, with a link to the closed draft pull request's run, and what they decided: the
    jobs' permissions, and whether the bypass rule is checked;
  - what Task 6 found in the public record;
  - the output of step 1;
  - how the checkout's id and the four sums were found and verified (Task 13 step 1, Task 12 step 1);
  - a sentence that every fixture value is made up, and that it touches no watched path;
  - a sentence that the merge will start one run, and what it will do (step 3).
- [ ] **Step 3: After review, merge. The merge starts one run,** because it adds the trusted places. Its
  first step must refuse: the environment does not exist yet.

Run: `gh run list --workflow railway-settings.yml --limit 5`, then
`gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'`, then
`gh api "repos/{owner}/{repo}/environments/railway-settings" --jq .name`
Expected: one run; `Check the gate, show the change` failed and the other two skipped; `Not Found (HTTP 404)`.
The run's page says "The environment railway-settings could not be read. Nothing was started."

  This is the gate's first refusal on a real run. If Task 13 found that a skipped job creates its
  environment, Task 16 came first and this run instead waits for a review that the founder may use as
  Task 17's.

**What a person sees:** the workflow in the Actions list with one refused run, and more steps in CI's
tooling job.

---

# Part two: the founder's set-up, and the rehearsal (no token exists)

Tasks 16 to 18. Nothing in this part stores, creates or reads a token for the new route.

### Task 16 (the founder alone): create the environment and its four rules, and make his two checks

Design section 8, steps 1 and 2. No automated tool does any part of this, changes it afterwards, or reads
the rules with the owner's sign-in in his place. The rules are read back by the run's own token in Task 17.

**What he is asked, in these words:**

1. On GitHub, open the repository's Settings, then Environments, then New environment. Name it
   `railway-settings`.
2. Tick "Required reviewers" and add yourself. Leave "Prevent self-review" unticked.
3. Untick "Allow administrators to bypass configured protection rules". Then look at that box once more
   yourself: it must be empty.
4. Under "Deployment branches and tags" choose "Selected branches and tags" and add one rule: the branch
   `master`.
5. Save. Add no secret.
6. Open Settings, then "Secrets and variables", then Actions, and read the list under "Repository secrets".
   Nothing in it may be named `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`.

**What he should see:** the environment's page showing one reviewer, the bypass box empty, and one branch
rule, `master`, with no secrets listed; and a list of repository secrets with neither name in it.

- [ ] **Step 1: The founder does the six things above,** and says that the bypass box is empty and that
  neither name is among the repository's secrets. The builder writes both answers, and the day, into the
  session log. They are the only check of those two things when a run cannot see them.

### Task 17 (the founder taps; the builder reads): the rehearsal

Design section 8, step 3. It proves three things design section 9 lists as not yet proven: that each of two
jobs in one run asks for its own approval; that a run started from another branch is refused by the
environment itself; and what GitHub's phone app shows. It also proves that the approved jobs make no
deployment record of their own, and that GitHub still records their approvals.

- [ ] **Step 1: The founder presses "Run workflow" on `master`,** on his phone, in GitHub's app if it offers
  the button, otherwise in the phone's browser.
  **What he should see:** step 1 finishes by itself. Its summary shows the gate's rules as he set them and the
  commit. It says "No earlier run of this workflow applied a change" and then shows every file of the trusted
  places in full. If Task 13 found the bypass answer is not seen by a run, it says so. Step 2 then waits for
  review.
- [ ] **Step 2: He approves step 2.** It finishes and says: Rehearsal. No token is stored. **Step 3 must then
  wait for a second review.** He approves it. It says the same.
- [ ] **Step 3: The builder reads the run.**

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run id>/approvals" --jq '[.[] | {state, environments: [.environments[].name]}]'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'
gh api "repos/{owner}/{repo}/deployments?environment=railway-settings" --jq length
```

Expected: two approvals, each for `railway-settings`; three jobs, each `success`; `0` deployment records.

**If the list of approvals is empty although he approved twice:** with no deployment record, GitHub keeps no
review history a run can read. The last change applied is found through that history (Task 5), so no run
could ever count: step 1 would show every file in full for ever, and old values would stay hidden. Then both
approved jobs name the environment as a plain string, rule 11 of Task 11 is changed to that form in the same
pull request, their own deployment records are left to design 6.6's four tests, which already filter them
out, and steps 1 to 3 are done again.

**If step 3 did not ask for its own approval:** stop here. No token is stored. The two approvals the design
promises cannot come from one environment. The nearest thing that can is a second environment for step 3,
with the same four rules and its own copy of the secret. That changes design 6.1, so it is the founder's
decision before anything else is built.

- [ ] **Step 4: One more run shows GitHub's own rule at work** (design section 8, step 3). This is safe only
  because no token exists yet: check first that the environment's page still lists no secret. The builder
  pushes a throwaway branch. Its copy of the workflow differs from `master`'s in exactly two things:
  1. no job has a condition: the `if` of `gate`, `plan` and `apply` is taken out;
  2. step 1 does not refuse other branches: the step that reads the gate's rules back and checks the run is
     current is taken out of `gate`, and the same step is taken out of `plan` and `apply`. The steps after it
     in `gate` are taken out with it, since they read its output.
  Nothing else changes: `plan` still needs `gate`, and both approved jobs still name the environment as
  `master`'s copy does. GitHub's own branch rule is then the only thing between that branch and the
  environment. The builder starts a run from the branch and reads it. Nobody approves anything. The branch is
  never merged, no pull request is opened for it, and it is deleted as soon as the run has been read.

```bash
gh workflow run railway-settings.yml --ref <throwaway branch>
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .status, .conclusion, (.steps | length)] | @tsv'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/pending_deployments" --jq length
git push origin --delete <throwaway branch>
```

Expected: `Check the gate, show the change` succeeded; `Read Railway's plan` failed with no step run, refused
by the environment itself; `Apply this plan` skipped; `0` reviews pending. The run's page says the branch may
not deploy to the environment.

**If GitHub let that job wait for review or run:** store no token. First find out whether `deployment: false`
is the cause. GitHub's page "Deploying with GitHub Actions" says that with it reviewers "must still approve"
and that branch policies restrict "which branches can use certain secrets", but its table of rules has no
row for the branch rule. Run step 4 again from a throwaway branch whose two approved jobs name the
environment as a plain string. If GitHub refuses that one, both approved jobs use the plain form, rule 11 of Task 11 is
changed to it in the same pull request, and their own deployment records are left to design 6.6's four tests,
which already filter them out. If GitHub lets that one through too, stop and read the environment's branch
rule again with the founder.

- [ ] **Step 5: The phone.** Record whether GitHub's phone app showed the summaries, the review button and the
  "Run workflow" button. **If it lacks any of the three:** design section 9's own fallback. He uses the
  browser on his phone, and Task 25's page says so.

**What a person sees:** one green rehearsal run with two approvals on it, and one refused run from a branch.

### Task 18 (needs the founder's yes, and him at Railway's dashboard for step 4): three read-only reads of Railway, by hand

These use the existing by-hand route and its sign-in, outside the repository. Each command only reads. Their
output stays outside the repository; only the words named below are written down. His yes here is for these
reads alone; it approves nothing on GitHub.

**What he is asked:** may the builder run three read-only commands of Railway's tool, the way plans were read
before the move; and will he, for step 4, stage one small change on Railway's dashboard, leave it undeployed
for two minutes, and discard it.

- [ ] **Step 1: A plan from the file, as today.** From a clean checkout of `master` in the by-hand route's
  folder: `railway config plan --out <A>`. Expected: exit 0, and `A` holds no change.
- [ ] **Step 2: A plan from a file evaluated beforehand** (design section 9, not yet proven: whether the tool
  can plan from a settings file evaluated beforehand).

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
railway deployment list --service <the one service the file declares> --json > <L>
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const keys=(o,p='')=>Object.entries(o??{}).flatMap(([k,v])=>v&&typeof v==='object'&&!Array.isArray(v)?[p+k,...keys(v,p+k+'.')]:[p+k]);console.log(Array.isArray(d),d.length,keys(d[0]).sort().join(','),[...new Set(d.map(x=>x.status))].join(','))" <L>
```

  The command is the one design 6.2 writes, with the flags the tool's own help gives (`--service`, `--json`).
  It prints the names of an entry's fields, nested ones too, and the status words: no value but those words.

Expected: `true`, a count, a list of key names that includes `status`, and status words from Railway's CLI
page. From the key names, write down which field carries each of the four things design 6.6's fallback needs:
the service, the time of creation, the status, and the commit. Railway's documented list shows no commit.
**If the status field has another name or the words differ:** Task 19 corrects `railwayBusy` to what was seen.
**If any of the four has no field:** `LIST_FIELDS` keeps `null` for it, and the fallback cannot confirm a
redeploy (Task 7). That matters only if Task 6 turned out false.

- [ ] **Step 4: Staged changes** (design section 9, not yet proven: what an apply does to changes left staged
  on Railway's dashboard). The founder stages one small change on the
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
- Modify, in the trusted folder: `tool.mjs`, `look.mjs`, `flow.mjs`, `plan-lines.mjs`; in the check folder:
  their tests (only where a result of Task 18 calls for it)

- [ ] **Step 1: For each result of Task 18 that differs from what pull request 1 assumed, write the failing
  test first.**
  - Plan from a generated file: `allowedCommands` becomes
    `config plan --file <workdir>/evaluated/railway.ts --out <workdir>/plan.json` and
    `config plan --file <workdir>/evaluated/railway.ts --detailed-exit-code`. The three other commands stay.
    New tests: the old two forms are refused; `--file` with any other path is refused. `recheck` then also
    requires that `.railway/node_modules` is absent and that the generated file's SHA-256 is the one written
    when it was made.
  - The state's field name or words: `railwayBusy`'s tests use what was seen, and `LIST_FIELDS` gets the
    names of the four fields Task 18 step 3 found, `null` for any it did not find. A new test: `listVerdict`
    on an entry shaped as the real list is shaped, with made-up values. If Task 6 set `FALLBACK_READ` to
    `true` and a field is `null`, say so before going on: every apply would end as not confirmed.
  - Staged changes seen: `renderPlan`'s context gains `staged: boolean`, a refusal `Railway holds staged
    changes` and the sentence in Task 10's table; `applyStep` refuses with it.
- [ ] **Step 2: Run to see them fail, change the modules, run to see them pass.**
- [ ] **Step 3: Commit,** naming the files changed, with the message
  `feat(ci): settle the Railway commands on what the read-only proofs showed (T-751)`.

**What a person sees:** nothing yet.

### Task 20: Step 2, live

**Files:**
- Modify: `.github/workflows/railway-settings.yml` (job `plan`), `.github/railway-settings/cli.mjs`
- Modify: `.github/railway-settings-check/cli.test.mjs`, `check-workflows.mjs` (`RUN_LINES`),
  `check-workflows.test.mjs`

**Interfaces:**
- Consumes: `planStep` (Task 9), `renderPlan`, `planIds`, `lineMark`, `planWords`.
- Produces, in `cli.mjs`:
  - `plan`: builds `deps` and calls `planStep`, with its `tool` held to step 2's two commands
    (`runTool`'s `step: 'plan'`, Task 3). That makes two calls to Railway and no others, each with its output
    in a file in WORK: `config plan --out`, then `deployment list`. On success it writes `WORK/planned-at`
    and `WORK/state`, which holds one word, `quiet` or `busy`. On a failure it writes the fixed sentence for
    the result's key (`noToken`, `planFailed`, `stateFailed` or `stateUnknown`) to the log and the summary,
    and exits non-zero, so the step fails. It writes nothing else, and nothing either call printed.
  - `render`: reads `WORK/plan.json`, prints `::add-mask::` for each of `planIds`, renders with
    `declaredLast` from `DECLARED_LAST`, `declaredNow` from `WORK/declared-now.json`, `toolVersion` from the
    pins and `sourceTree` read as the gate reads it for the run's commit, reads `master`'s head for the
    `redeploys` sentence, reads the word in `WORK/state` for the sentence about Railway, writes step 2's
    summary with its marks, and outputs `mode=live`, `pending`, `lines` (the JSON of the list, without marks)
    and `planned_at`. It never reads the state call's own output. It looks at the refusals before it looks at
    whether anything is pending, as Task 9 does: a plan with no change and a refusal is written as `hand`
    with its reason, never as `upToDate`, and the step fails, because such a plan proves nothing about this
    commit. A plan with changes and refusals is written the same way and the step passes with `pending=true`:
    step 3 is then asked for, and refuses.
- In the workflow, job `plan`'s last step becomes two. The first of them is the one step of this job that
  holds the token. The second gate read stays where it is, before the tool is installed. There is no step
  for "already up to date": the summary says it, and such a run is not a change applied (Task 5).

```yaml
      - name: Read Railway's plan, with the token
        env:
          RAILWAY_SETTINGS_TOKEN: ${{ secrets.RAILWAY_SETTINGS_TOKEN }}
        run: bash .github/railway-settings/run.sh plan
      - name: Write the plan's lines, with no token
        id: render
        env:
          DECLARED_LAST: ${{ needs.gate.outputs.declared_last }}
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh render
```

  If Task 18 chose the generated file, the `evaluate` step also writes `WORK/evaluated/railway.ts` and removes
  `.railway/node_modules`, before the token step.

- [ ] **Step 1: Write the failing tests.** In `check-workflows.test.mjs`:

```js
test('the token is in exactly one step of each approved job, and the step is the named one', () => {
  const doc = parse(files()['railway-settings.yml']);
  const named = { plan: "Read Railway's plan, with the token", apply: 'Plan again, look, apply, plan again, with the token' };
  for (const job of ['plan', 'apply']) {
    const holders = doc.jobs[job].steps.filter((s) => JSON.stringify(s).includes('secrets.'));
    assert.equal(holders.length, 1, job);
    assert.equal(holders[0].name, named[job]);
    assert.match(holders[0].run, /^bash \.github\/railway-settings\/run\.sh (plan|apply)$/);
  }
  assert.ok(!JSON.stringify(doc.jobs.gate).includes('secrets'));
});
test('the second gate read comes before the token step in both approved jobs', () => { /* by step order */ });
test('the step that writes the lines comes after the token step and holds no secret', () => { /* ... */ });
```

  In `cli.test.mjs`: `render` on a fixture plan writes the lines of Task 1 into the summary file and the
  outputs file; a plan that changes the health check has its line marked in the summary, unmarked in the
  outputs, and the `shape` sentence below; `render` on a file that is not a plan exits non-zero and prints
  only the `planFailed` sentence; neither file holds any of `planIds`. A plan with no change made for another
  copy of the folder is written as `hand` with its reason, the word "up to date" is nowhere in the summary,
  and `render` exits non-zero; a plan with no change and nothing against it is written as `upToDate`, with
  `pending=false`. With `WORK/state` holding `quiet` the summary has `stateQuiet`; with `busy` it has
  `stateBusy`; with the file missing or holding any other word `render` exits non-zero. `plan`, with an
  injected tool whose state call exits 1, exits non-zero and writes only `stateFailed` with the code; with
  one whose state call writes a shape `railwayBusy` does not know, it exits non-zero and writes only
  `stateUnknown`; with one that writes the text `MADE-UP-STATE-OUTPUT` among readable entries, that text is
  in no log, summary or output. The state is read from `tool-5.out` (Task 3) and from no other file.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL. (The `apply` half of the first test passes after
  Task 21.)
- [ ] **Step 3: Edit the workflow, `cli.mjs` and `RUN_LINES`.**
- [ ] **Step 4: Run every test and the check.** Expected: PASS, apart from `apply` in the first test.
- [ ] **Step 5: Commit,** naming the files, with the message
  `feat(ci): step 2 reads Railway's plan and its state with the token in one step (T-751)`.

**What a person sees:** nothing until the token is stored. A run approved before then says: No token is
stored in the environment. After that, every run's second step says, in the same fixed words, whether Railway
is building or deploying just now.

### Task 21: Step 3, live

**Files:**
- Modify: `.github/workflows/railway-settings.yml` (job `apply`), `.github/railway-settings/cli.mjs`
- Modify: `.github/railway-settings-check/cli.test.mjs`, `check-workflows.mjs` (`RUN_LINES`),
  `check-workflows.test.mjs`

**Interfaces:**
- Consumes: `applyStep` (Task 9), `reinstallKit`, `verifyPinned` (Task 3), `redeployVerdict`,
  `railwayEnvironmentOnGitHub`, `FALLBACK_READ` (Task 7), `applyWords`.
- Produces, in `cli.mjs`:
  - `apply`: builds `deps`, with its `tool` held to step 3's commands (`runTool`'s `step: 'apply'`), and
    calls `applyStep` with `LINES` and `PLANNED_AT` from job `plan`'s outputs. So this one step makes
    design 6.2's calls to Railway, in its order, each to a file in WORK: the plan, the state, the apply, the
    closing plan, and the same list of deployments again only if `FALLBACK_READ` is `true`. Its
    `afterVerdict` is `listVerdict` (Task 7) for the one service, `master`'s head and the apply's time. Its
    `readText` prints `::add-mask::` for each of `planIds` the moment the second plan is read. Its `recheck`
    is `reinstallKit('.railway')` then `verifyPinned` for the tool and the runtime: just before the apply,
    the kit is checked against its lockfile and the tool against its checksum once more. Its
    `github.executing` reads `GET .../actions/workflows/<file>/runs?status=in_progress` for each of
    `MIGRATION_WORKFLOWS`, then each run's jobs. Its `github.head` reads `master`'s head and keeps the
    answer's `Date` header. Its `probe` reads `VERSION_PROBE`, compares that commit with `master`'s head
    through GitHub, and lists the files between them. It writes `WORK/outcome.json` (`outcome`, `key`,
    `code`, `appliedAt`, `head`, `after`) and outputs `outcome`. It exits non-zero unless the outcome is
    `applied`.
  - `after`: reads `WORK/outcome.json`. Reads `master`'s head again and notes whether it moved from `head`.
    For an applied plan it then reads GitHub's deployment records for `head` every 30 seconds, with the run's
    own token, as the production receipt reads them (`production-receipt.yml:105-111`), and gives them to
    `redeployVerdict` with `environment` from
    `railwayEnvironmentOnGitHub(<the project's name in WORK/declared-now.json>)`. With no counted record
    after 10 minutes: `notConfirmed`, exit 1. A record that fails: `redeployFailed`, exit 1. A record that is
    live: `live`, exit 0. Still waiting after 75 minutes (900 seconds of pre-deploy, 2700 of health check,
    and the build): `notConfirmed`, exit 1. With `FALLBACK_READ` it uses `after` from the outcome in place of
    the records: `live` is `live`, exit 0; `failed` is `redeployFailed`, exit 1; `cannot` is `cannotConfirm`,
    exit 1, because the tool's list could not show a deployment of the one service, created after the apply,
    ended in success, for `master`'s head (design 6.6). It writes step 3's summary in every case. An
    unconfirmed redeploy fails the job.
  - `agreed`: prints `A change was applied and nothing is left to change.` It is the step whose success
    Task 5's `lastAgreedCommit` looks for.
- In the workflow, job `apply`'s last step becomes three, after the file's evaluation. The first of them is
  the one step of this job that holds the token.

```yaml
      - name: Plan again, look, apply, plan again, with the token
        id: apply
        env:
          RAILWAY_SETTINGS_TOKEN: ${{ secrets.RAILWAY_SETTINGS_TOKEN }}
          GITHUB_TOKEN: ${{ github.token }}
          LINES: ${{ needs.plan.outputs.lines }}
          PLANNED_AT: ${{ needs.plan.outputs.planned_at }}
          DECLARED_LAST: ${{ needs.gate.outputs.declared_last }}
        run: bash .github/railway-settings/run.sh apply
      - name: Nothing is left to change
        if: steps.apply.outputs.outcome == 'applied'
        run: bash .github/railway-settings/run.sh agreed
      - name: Wait for Railway's report of the new deployment
        if: ${{ !cancelled() }}
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: bash .github/railway-settings/run.sh after
```

  The bracketed test at the end of the job's `if` becomes `(needs.plan.outputs.pending == 'true')`.

- [ ] **Step 1: Write the failing tests.** In `cli.test.mjs`, with an injected `fetch` and a fake clock:
  `after` on an applied outcome with a counted live record prints `applied` then `live` and exits 0; with a
  failed record exits 1 with `redeployFailed`; with none for 10 minutes exits 1 with `notConfirmed`; with
  only records that do not count (the job's own environment, another commit, made before the apply) exits 1
  with `notConfirmed`; on a refused outcome writes that outcome's sentence and reads no deployment record;
  with `master` moved adds `headMoved`; with the fallback switched on, an outcome whose `after` is `cannot`
  exits 1 with `cannotConfirm` and one whose `after` is `live` exits 0. In `check-workflows.test.mjs`: the first test of Task 20 now passes
  for `apply`; `apply` has a step named `Nothing is left to change`; the live file holds no `rehearse`.
- [ ] **Step 2: Run to see them fail.** Expected: FAIL.
- [ ] **Step 3: Edit the workflow, `cli.mjs` and `RUN_LINES`.** Remove the `rehearse` commands.
- [ ] **Step 4: Run every test and the check.** Expected: PASS.
- [ ] **Step 5: Commit,** naming the files, with the message
  `feat(ci): step 3 applies exactly the lines that were read, then waits for the redeploy (T-751)`.

**What a person sees:** nothing until the token is stored.

### Task 22: Pull request 2, with the Deploy workflow's header comment

**Files:**
- Modify: `.github/workflows/deploy.yml` (the comment at lines 18-21 only)
- Modify: `docs/state/tasks.md` (row T-751), `docs/sessions/<the day>.md`

**The comment.** Today it says Railway deploys are kept out of this workflow so that no Railway token lives
on GitHub. That reason is reversed by the design (its section 5), so the comment is rewritten to say three
things: this workflow still triggers no Railway deploy and holds no Railway token; since this change one
Railway token does live on GitHub, in the `railway-settings` environment, released only on the founder's
approval and only to `master`, for settings changes alone; and the design's path, for the reasons. It is a
comment-only change. `deploy.yml` is not a watched path and not a trusted place, and no line that runs is
touched.

- [ ] **Step 1: Write the check first.** It must print nothing before the edit and nothing after it: every
  changed line of the file is a comment.

Run: `git diff -U0 origin/master...HEAD -- .github/workflows/deploy.yml | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*#'`
Expected: nothing. After the edit, `git diff --stat origin/master...HEAD -- .github/workflows/deploy.yml`
also names the file.

- [ ] **Step 2: Edit the comment. Run the four checks of Task 15, step 1,** and
  `node .github/railway-settings-check/check-workflows.mjs`. Expected: the same as there; the check passes.
- [ ] **Step 3: Commit** `.github/workflows/deploy.yml` with the message
  `docs(ci): the Deploy workflow's header no longer says no Railway token lives on GitHub (T-751)`.
- [ ] **Step 4: Open the pull request and send it to the release lead.** It carries, as evidence:
  - the rehearsal: the run with two approvals and no deployment record, and the run from a branch that
    GitHub refused (Task 17);
  - the four results of Task 18, in neutral words, and which commands they led to;
  - the workflow's diff, showing the token in the one named step of each job and in no other place;
  - the count of tests, and the names of the tests of Task 9 that pin the order of the calls;
  - step 1's output for `deploy.yml`, and that the pull request touches no watched path and nothing in
    `.railway/`;
  - a sentence that the merge will start one run, and what the founder does with it (step 5).
- [ ] **Step 5: After review, merge. The merge starts one run,** because it changes the workflow file and its
  folder. Its first step passes and its second waits for review. No token is stored yet.
  **What the founder is asked:** reject that review, or leave it. If he approves it, it says "No token is
  stored in the environment." and fails. Either way nothing is read from Railway.

**What a person sees:** one waiting or rejected run. The workflow is live in code and has no token.

### Task 23 (the founder alone): the token

Design section 8, step 4. No automated tool sees the token at any point, in any form.

**What he is asked, in these words:**

1. On Railway, open the project's settings, then Tokens. Create a project token for the production
   environment.
2. On GitHub, open Settings, then Environments, then `railway-settings`. Under "Environment secrets" add a
   secret named `RAILWAY_SETTINGS_TOKEN` and paste the token as its value.
3. Do not add it under "Repository secrets", and do not name it `RAILWAY_TOKEN`.
4. Look again at the two things of Task 16: the bypass box is empty, and the repository's own secrets hold
   nothing named `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`.
5. Close Railway's page that shows the token. Keep no copy.
6. Note the day. The token is replaced every 90 days, and at once after anything goes wrong with a runner or
   a log (Task 25's page has the steps).

**What he should see:** `RAILWAY_SETTINGS_TOKEN` listed under the environment's secrets, with no value shown;
the repository's own secrets list unchanged; the four rules still as he set them.

- [ ] **Step 1: The founder does the six things above,** and says only that it is done and on which day. The
  builder writes the day into the session log and into the ledger row, as the start of the 90 days.

### Task 24 (the founder, on his phone): the first check with the token

Design section 8, step 5, and design section 9's "a skipped job asks for none". Nothing before this task
relies on that: until now step 3 ran in every rehearsal.

With nothing at stake, this run also proves two of the things design section 9 lists under what a project
token may run and what those calls return: the plan, and the list of deployments, which step 3 will need
just before a real apply. The third, the apply, is first made in Task 27.

- [ ] **Step 1: He presses "Run workflow" on `master` and approves step 2.**
  **What he should see:** step 1 still shows every file in full: no run has applied a change yet. Step 2 says
  "Already up to date. Railway holds what the file declares." and "Railway is not building or deploying just
  now." Step 3 is skipped and asks for nothing. The run ends green.
- [ ] **Step 2: The builder reads the run,** and nothing of the token.

```bash
gh api "repos/{owner}/{repo}/actions/runs/<run id>/jobs" --jq '.jobs[] | [.name, .conclusion] | @tsv'
gh api "repos/{owner}/{repo}/actions/runs/<run id>/approvals" --jq length
```

Expected: `Check the gate, show the change` and `Read Railway's plan` success; `Apply this plan` skipped; `1`.
This run does not count as a change applied (design 6.2), so the next run's first step shows the files in
full again. That lasts until Task 27.

| If instead | Then |
|---|---|
| Step 2 says the plan could not be read | The tool may need to be told the environment when it has only a project token. Read the exit code. The fix is a reviewed pull request that adds `--environment production` to the three `config` commands of Task 3. He does not approve anything meanwhile |
| Step 2 says Railway's own state could not be read, with an exit code | The plan was read, so the token works. A project token may not list deployments, or the command may need the environment named. The fix is a reviewed pull request: first `--environment production` on that command; if that is not it, the reads of Railway's state in steps 2 and 3 use the records Railway's app posts to GitHub, which need no token. No real change is approved until a check passes |
| Step 2 says Railway answered in a shape this workflow does not know | A project token is given a different answer from the one Task 18 saw. The builder reads the shape by hand as in Task 18 step 3, corrects `railwayBusy` in a reviewed pull request, and the check is run again |
| Step 2 says Railway is building or deploying just now | Nothing is wrong with the workflow. He waits and presses "Run workflow" again |
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
- Modify: `.github/railway-settings-check/check-workflows.mjs` and its test (`checkFolder`)
- Modify: `docs/operations/railway-config-move.md` (the link at line 8; "After the move", lines 192-199)
- Modify: `docs/superpowers/specs/2026-11-22-railway-settings-apply-from-ci-design.md` (the status line only)
- Modify: `docs/engineering/README.md` (the row of Task 15), `docs/state/tasks.md`, `docs/sessions/<the day>.md`

**Interfaces:**
- Produces: `checkFolder(names: string[]): string[]`. The files of `.railway/` must be exactly
  `package-lock.json`, `package.json`, `railway.ts` and `watch-patterns.json`. The check, run as a program,
  reads the folder's own entries and leaves out `node_modules`, which git ignores. It starts no process.

**The page, `docs/operations/railway-settings.md`,** in this order:

1. What the settings folder is, and the three trusted places.
2. How a setting changes now: a pull request, then the run's three steps, with design section 2's picture.
3. What each summary means, the marked lines and why they are his to judge, and what to do for each row of
   design 6.8. Why step 1 shows every file in full, and step 2 shows `(hidden)` for old values, until this
   workflow has applied a change: only such a run counts as the last change applied, and a run that found
   Railway up to date does not.
4. What is still applied by hand, and how (the old README's "Install the kit", "Preview" and "Apply", kept).
5. Who may approve. Only the founder approves a `railway-settings` review, and only he changes that
   environment. His yes in a chat lets nothing else approve: the approval is his own, on GitHub's review
   page. GitHub cannot tell an approval made under his sign-in from his own, so until the lock of design
   section 11 this rule is the only control (design 6.10).
6. The set-up as it was done, with its days and no secret, and his two standing checks: the bypass box is
   empty; the repository's own secrets hold nothing named `RAILWAY_SETTINGS_TOKEN` or `RAILWAY_TOKEN`. When a
   run cannot see the bypass answer, his look is the only check of it.
7. Replacing the token, every 90 days and at once after anything goes wrong with a runner or a log: create a
   new token on Railway, paste it over the old secret, delete the old token on Railway, make the two checks
   of item 6 again, and press "check now". The page gives the day the next one is due.
8. If the token may have leaked, in this order: delete the token on Railway; read Railway's record of
   activity for the project; remove any deployment, service, domain or volume nobody recognises; redeploy
   `master`; rotate production's secrets. The database's connection string is also held by GitHub, as the
   secret `DATABASE_URL`, in two places: the repository's secrets and the `Production` environment's. Both
   are replaced.
9. What the workflow does not check: drift between runs (design 6.9); the gate's rules between runs (design
   6.1); staged changes, as Task 18 found; the meaning of a change (design 6.3).
10. The watch list; variables.

- [ ] **Step 1: Write the failing test.**

```js
test('the settings folder holds only what a plan reads', () => {
  assert.deepEqual(checkFolder(['package-lock.json', 'package.json', 'railway.ts', 'watch-patterns.json']), []);
  assert.notDeepEqual(checkFolder(['README.md', 'package-lock.json', 'package.json', 'railway.ts', 'watch-patterns.json']), []);
  assert.notDeepEqual(checkFolder(['package.json', 'railway.ts', 'watch-patterns.json']), []);
});
```

- [ ] **Step 2: Run it and the check to see them fail.** Expected: the test fails (no `checkFolder`); after it
  is written, `node .github/railway-settings-check/check-workflows.mjs` fails on `.railway/README.md` until
  the move.
- [ ] **Step 3: Move and rewrite the page; edit the comments and the other pages.** Check every relative link
  in the changed pages opens a file that exists. Check the page against items 1 to 10, one by one.
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

### Task 26 (the founder taps once; a person watches): the run that pull request 3's merge starts

- [ ] **Step 1: Merge pull request 3.** A run of "Railway settings" starts by itself, because the merge
  changes `.railway/`.
  **What the founder should see:** step 1's summary names the pull request and, as no run has applied a
  change yet, shows every file of the trusted places in full: `.railway/` now holds four files and no
  README.
- [ ] **Step 2: He approves step 2.** Expected: "Already up to date." and whether Railway is busy. Step 3 is
  skipped.
- [ ] **Step 3: The builder reads the run** with the two commands of Task 24, step 2. Expected: the same.

**If step 2 shows lines:** a comment-only change produced a plan, which step 4 of Task 25 says cannot be. He
does not approve step 3. A person compares the lines with the file.

**What a person sees:** a merged pull request, then one run with one approval, ending green.

### Task 27 (a person watches): the first real settings change

Design section 9: the first real settings change is watched to the end by a person. This task has no date:
it is done when someone's pull request first changes a setting in `.railway/railway.ts`. Until then the
apply itself has run only against the fakes of Task 9, and what a project token may do with an apply is not
yet seen (design section 9). Both reads it leans on, the plan and Railway's own state, have been made with
the token on every run since Task 24.

This is also the first run that can count as a change applied. So on this run step 1 still shows every file
in full and has no "What the file changes", and step 2's lines show `(hidden)` where an old value would be.
From the next run on, step 1 shows what changed since this one, and old values are shown again.

- [ ] **Step 1: Before the first approval,** a person reads the pull request's diff beside step 1's summary:
  the settings file shown in full must be the merged one, and nothing else in the trusted places may differ
  from what `master` held before the pull request.
- [ ] **Step 2: Before the second approval,** the founder reads step 2's lines, judges any marked line, reads
  whether Railway is busy just now, and looks at Railway's dashboard for staged changes. If Railway is busy
  he waits. No Deploy run is approved until step 3 has finished.
- [ ] **Step 3: A person watches step 3 to its end:** "Applied. Nothing is left to change.", then "Railway
  reports the new deployment live at commit ...".
- [ ] **Step 4: Run the production receipt on that commit** (`production-receipt.yml`, with `sha` set to the
  commit step 3 named). Expected: green.
- [ ] **Step 5: Record in the session log** what was seen, and anything the lines or the wait got wrong. This
  is also the second sighting of Task 6's record, the first made by this workflow.
- [ ] **Step 6: Read that the run now counts.** Press "Run workflow" once more, or wait for the next run.
  Its first step must say "This workflow last applied a change at commit ..." and name this run. If it
  shows the files in full again, read this run's review history as Task 17 step 3 does: the last change
  applied is found only through a recorded approval.

| If instead | Then |
|---|---|
| Step 3 says a deploy or a migration is under way | Railway became busy between the two approvals, or a Deploy job started. Nothing was applied. Start a new run later |
| Step 3 says something it must read could not be read | Step 2 made the same read of Railway minutes earlier, so look first at the other two: GitHub's answer about executing jobs, and the public version probe. Nothing was applied. Start a new run |
| Step 3 says the redeploy is not confirmed | The apply succeeded. A person reads Railway's own page for the deployment, and the session log records why no record counted: `master` moved in those seconds, or Railway posted none |

**What a person sees:** the changed setting live in production, a green run with two approvals, and a green
receipt.

---

## What this plan could not verify, and where it is handled

| Not verified | Handled in |
|---|---|
| That the pinned runtime and the tool install and run on the `ubuntu-24.04` runner | Task 13 |
| That the checkout action can be held to the three trusted places | Task 13; if not, a plain checkout, and the CI rules stand |
| Which read-only permissions let a run's own token read an environment and its branch rules | Task 13; if none does, stop: design 6.1 cannot be built as written |
| Whether a run's own token sees the bypass answer | Task 13; if not, design 6.1's own special case |
| That a job which never starts does not create its environment | Task 13; if false, Task 16 moves before pull request 1's merge |
| That two jobs in one environment each ask for an approval, with `deployment: false` | Task 17; if false, stop and ask the founder |
| That GitHub records a run's approvals in its review history when the job makes no deployment record | Task 17 step 3; if not, the plain form, with the jobs' own records filtered out. Without it no run could count as a change applied |
| That a run from another branch is refused by the environment itself, and that the branch rule still holds with `deployment: false`. GitHub's page implies it and its table of rules has no row for it | Task 17 step 4, from a throwaway branch, before any token exists; if not, the plain form |
| What GitHub's phone app shows | Task 17; if lacking, the phone's browser |
| That the tool can plan from a file evaluated beforehand | Task 18 step 2; if not, design 6.2 as written |
| The shape of `railway deployment list --json`, and whether it can show the four things the fallback counts by. Railway's documented list carries no commit | Task 18 step 3, then Task 19. If it cannot show all four, the fallback cannot confirm; that matters only if Task 6 turns out false |
| What a project token may do with an apply, and what the apply returns | Not before Task 27, which is watched. A failed apply ends with a fixed sentence and its exit code, and nothing it wrote |
| What a present bypass answer of `null` would mean for a run's token | Task 13 tells it apart from a missing one; if that is what a run is given, stop |
| Whether the tool can see staged changes | Task 18 step 4 |
| What an apply does to staged changes | Not proven by this plan. Held by a rule printed before every second approval |
| That the tool plans with only a project token | Task 24, with a named fix |
| That a project token can list deployments, and in the shape Task 18 saw | Task 24: step 2 makes that read on every run, a check included, so it is proven with nothing at stake. A named fix for each way it can fail |
| The shape of a plan that removes, empties or adds something | Not seen: one real plan exists. Every refusal is an allow-list on the one shape that was seen, so an unknown shape is applied by hand |
| That Railway posts a record for every redeploy an apply starts, for `master`'s head | Seen once (Task 6). Task 27 is the second sighting; without a counted record the run fails as not confirmed |
