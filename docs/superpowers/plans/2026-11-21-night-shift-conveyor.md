# Night Shift Conveyor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-job-per-command cloud sandbox launcher into an unattended service that takes jobs from a queue, spends a list of credit pots safely, and delivers draft pull requests.

**Architecture:** A scheduled task runs `shift tick` every two minutes. A tick takes a lock, loads every job folder, advances each job one step (reserve, start, follow, collect, publish), writes one snapshot file for the dashboard, and exits. All state lives in files under a work root outside the repository, set in the private settings file, so any tick resumes where the last one stopped. The agents work in Claude Managed Agents sessions; this PC only dispatches, collects and publishes.

**Tech Stack:** TypeScript (strict), Node 22, the pnpm workspace package `@omnitwin/credit-runner`, `@anthropic-ai/sdk` 0.131.0 (Managed Agents beta), zod 4, vitest, the `git` and `gh` command lines, gitleaks, Windows Task Scheduler.

**Spec:** `docs/superpowers/specs/2026-11-21-night-shift-design.md`. Read it first. A sibling plan, kept privately, builds the dashboard tab that reads this plan's snapshot file.

**Not in this plan** (each gets its own plan when its turn comes in the spec's order of work): the second reviewer and the planted-defect control, the pause rule for a kind that keeps failing, marking a draft ready, the morning summary, visible jobs and the accept or reject of a look, the automatic brief writer and the scouts. Until the reviewer exists every pull request this plan opens stays a draft.

## Global Constraints

- The repository is public. No email address, account name, key value or key-file content in code, tests, logs or commits. Tests use `example.com` and `.invalid` only.
- An API key or the GitHub token is read from its file at the moment of use and handed straight to the SDK client or to the `git` or `gh` child process. It never enters the tick's own `process.env`, a log line, an error message or any file.
- Every Anthropic client is built only through `sdkSandboxApi` in `src/sandbox/api.ts`, never with `new Anthropic(...)`: it fixes the host to `https://api.anthropic.com`, sends no auth token, refuses to start while `ANTHROPIC_BASE_URL` names another host or `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_CUSTOM_HEADERS` is set, and never forwards the key on a redirect to another host.
- TypeScript strict, no `any`. zod validates every file read from disk. Follow the package's existing patterns: `src/sandbox/*` and the `FakeApi` tests.
- All service state lives under the work root (set when the shift is installed; it lies outside the repository), never in the repository.
- A pot is used only when its settings entry says `confirmedNoCard: true` and `hold` is null.
- One tick at a time. Every state file is written to a temporary name and renamed into place.
- The sandbox never receives a credential and its network stays `limited`.
- A run is rejected for protected paths, deleted tests and secret shapes exactly as `src/sandbox/review.ts` does today.
- Amounts are integer cents wherever two amounts are added or compared.
- Session budget: default $5, never above $50 (the existing `src/task.ts` limits).
- Branch `credit/<job id>`; commit trailer `Credit-Runner-Task: <job id>` (both exist today).
- Defaults from the spec: tick every 2 minutes, 2 sessions at once per pot, dispatch pauses at 8 or more open night-shift pull requests, alarm after 30 minutes with work, credit and room but no start. The spec asks for a day ceiling and a small pot reserve without naming figures; the plan's own defaults are a day ceiling of $40 and a pot reserve of $10, and the settings file overrides both.

## Review Focus

Conditions the spec implies that are most likely to bite, each pinned by a test in the task named.

1. The PC sleeps or restarts while a session runs in the cloud. The next tick must re-attach from the saved session id and must never start a second session for the same job. (Task 7)
2. A slow tick is still running when the scheduler fires again. The second tick must exit without touching any state. (Task 10)
3. A crash leaves a half-written ledger line. Spending must stop with a clear reason, never under-count. (Task 10)
4. A pot's cycle rolls over while one of its jobs is running. The cost settles in the cycle it was reserved in, and the new cycle starts at zero. (Task 3)
5. Master moves under a finished job so its patch conflicts. The branch is not pushed, and the job is thrown out with "master moved under it" and queued once more. (Task 9)

## File structure

All paths are under `tools/credit-runner/`.

| File | Responsibility |
|---|---|
| `src/shift/settings.ts` | The private settings file: pots, ceilings, paths. |
| `src/shift/ledger.ts` | Version 2 ledger: reserve, settle and release lines, per pot and cycle. |
| `src/shift/pots.ts` | Cycle arithmetic and choosing which pot pays. Pure. |
| `src/shift/jobs.ts` | Job folders, the state file, legal moves, admitting a brief. |
| `src/sandbox/session.ts` | Modified: the blocking loop is split into start, follow once, finish (the launcher's stop rule and its lookup after an unclear create stay as they are). |
| `src/shift/steps.ts` | One function per move of a job. |
| `src/shift/publish.ts` | Branch from the patch, the public-repository gates, the draft pull request. |
| `src/shift/board.ts` | The snapshot file read by the owner's local dashboard. |
| `src/shift/tick.ts` | The lock and one pass over all jobs. |
| `src/shift/controls.ts` | The pause switch and the daily precondition control. |
| `src/shift/cli.ts` | `shift tick`, `status`, `add`, `pause`, `resume`, `trial-frames`. |
| `src/shift/trials/frames-trial.ts` | The one-off page-rendering trial. |
| `src/__tests__/fake-api.ts` | `FakeApi`, moved out of `sandbox.test.ts` so shift tests share it. |
| `install-shift-task.ps1` | Registers the scheduled task. |

The old local lane (`src/night.ts`, `src/claude.ts`, `run-night.ps1`) has been removed from the package before this plan starts, and so have the unused `src/proc.ts` and `src/env.ts` that went with it. The launcher already has `listSessions(createdSince)` on `SandboxApi` (`src/sandbox/api.ts`), the ledger writer in `src/sandbox/credit-ledger.ts` and `FakeApi` in `src/__tests__/fake-api.ts`.

---

### Task 1: Land the existing launcher on a fresh branch

**Files:** everything under `tools/credit-runner/` as the pull request that lands the launcher has it (the sandbox lane only, the old local lane removed), plus `pnpm-lock.yaml`. If that pull request has merged, this task is already done: check that master holds the package and go on to Task 2.

**Interfaces:** Produces the sandbox launcher as that pull request lands it, on a branch cut from today's `origin/master`.

- [ ] **Step 1:** Create a worktree on a new branch `night-shift/land-launcher` from `origin/master` (use superpowers:using-git-worktrees). Never work in the shared checkout.
- [ ] **Step 2:** Bring the launcher's package onto the branch without the local lane. Resolve `pnpm-lock.yaml` by taking master's file and running `pnpm install --lockfile-only`.
- [ ] **Step 3:** Run `pnpm --filter @omnitwin/credit-runner test`, then `typecheck`, then `lint`. Expected: every test passes and both checks exit 0.
- [ ] **Step 4:** Check whether `.github/workflows/ci.yml` runs this package's tests. If it does not, add the package to the existing test job in this same change.
- [ ] **Step 5:** Check that `FakeApi` lives in `src/__tests__/fake-api.ts` (the landing pull request moved it out of `sandbox.test.ts`) and that the shift's tests can import it. Run the tests again: every existing test still passes (on Windows the verifier's signal case and the POSIX key-mode case are skipped, because they run only on Linux).
- [ ] **Step 6:** Commit with explicit pathspecs, push, open a pull request titled "credit-runner: land the cloud sandbox launcher", and wait for green CI. Later tasks branch from this.

### Task 2: Settings

**Files:**
- Create: `src/shift/settings.ts`
- Test: `src/__tests__/shift-settings.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Pot {
  readonly id: string;            // neutral, e.g. "pot-1"; ^[a-z0-9-]{1,24}$
  readonly label: string;         // shown on the board; lives only in the private file
  readonly keyFile: string;       // file name inside keyDir
  readonly grantUsd: number;
  readonly cycleStart: string;    // YYYY-MM-DD, the day one known cycle began
  readonly cycleEnd: string;      // YYYY-MM-DD, the day that cycle ends
  readonly reserveUsd: number;    // default 10
  readonly confirmedNoCard: boolean;
  readonly hold: string | null;   // why it is kept out, e.g. "kept for another use"
}
export interface ShiftSettings {
  readonly workRoot: string; readonly keyDir: string;
  readonly repoUrl: string; readonly baseBranch: string;        // default "master"
  readonly publisherRepo: string;                               // the publisher's own clone
  readonly gitleaksPath: string; readonly githubTokenFile: string | null;
  readonly pots: readonly Pot[];
  readonly dayCapUsd: number;          // default 40
  readonly maxRunningPerPot: number;   // default 2
  readonly maxOpenPrs: number;         // default 8
  readonly quietHours: { readonly from: string; readonly to: string } | null;  // "HH:MM", local
  readonly privateNames: readonly string[];   // strings that must never appear in a pushed diff
}
export function parseSettings(raw: unknown): ShiftSettings;
export function loadSettings(file: string): Promise<ShiftSettings>;
```

- [ ] **Step 1: Write the failing tests**
```ts
it("fills the spec's defaults", () => {
  const s = parseSettings(minimal);
  expect([s.dayCapUsd, s.maxRunningPerPot, s.maxOpenPrs, s.baseBranch]).toEqual([40, 2, 8, "master"]);
  expect(s.pots[0]?.reserveUsd).toBe(10);
});
it("rejects an unknown key", () => { expect(() => parseSettings({ ...minimal, extra: 1 })).toThrow(); });
it("rejects a cycle that ends on or before its start", () => {
  expect(() => parseSettings(withPot({ cycleStart: "2030-01-01", cycleEnd: "2030-01-01" }))).toThrow();
});
it("rejects two pots with one id", () => { expect(() => parseSettings(twoPotsSameId)).toThrow(); });
```
- [ ] **Step 2:** Run `pnpm --filter @omnitwin/credit-runner exec vitest run src/__tests__/shift-settings.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement with a strict zod schema; reuse `expandHome` from `src/config.ts` and define the YYYY-MM-DD date schema in `src/shift/settings.ts` (`src/config.ts` keeps only `expandHome`).
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit `src/shift/settings.ts` and its test.

### Task 3: Ledger, version 2

**Files:**
- Create: `src/shift/ledger.ts`
- Test: `src/__tests__/shift-ledger.test.ts`

**Interfaces:**
- Produces:
```ts
export type LedgerLine =
  | { readonly v: 2; readonly kind: "reserve"; readonly ts: string; readonly pot: string; readonly cycle: string; readonly job: string; readonly amountCents: number }
  | { readonly v: 2; readonly kind: "settle"; readonly ts: string; readonly pot: string; readonly cycle: string; readonly job: string; readonly sessionId: string | null; readonly costCents: number; readonly costKnown: boolean; readonly model: string; readonly requests: number; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly v: 2; readonly kind: "release"; readonly ts: string; readonly pot: string; readonly cycle: string; readonly job: string };
export interface Ledger { readonly lines: readonly LedgerLine[]; readonly badLines: number }
export function readLedger(file: string): Promise<Ledger>;
export function appendLedger(file: string, line: LedgerLine): Promise<void>;
/**
 * Settled cost plus every reserve still open, in that pot and cycle. Lines are read in file order:
 * a reserve opens, the next settle or release for the same job closes it, and a later reserve for
 * the same job (a retry or a requeue) opens again.
 */
export function committedCents(ledger: Ledger, pot: string, cycle: string): number;
/** The same sum over every pot, for lines whose time falls on that local day (YYYY-MM-DD). */
export function dayCommittedCents(ledger: Ledger, localDay: string): number;
```
`cycle` is the cycle's start day. A line in the launcher's own format (`src/sandbox/credit-ledger.ts`: `ts`, `lane`, `job`, `costUsd`, and `costKnown: false` when the cost is a booking at its whole budget, or its last cost figure if higher, with no `v`) is read as a settle for pot `"legacy"` in cycle `"legacy"` (carrying its `costKnown`), so it never counts against a live cycle.

- [ ] **Step 1: Write the failing tests**
```ts
it("counts an open reserve, then only the settled cost", () => {
  const open = ledgerOf(reserve("pot-1", "2030-01-01", "job-a", 600));
  expect(committedCents(open, "pot-1", "2030-01-01")).toBe(600);
  const done = ledgerOf(reserve("pot-1", "2030-01-01", "job-a", 600), settle("pot-1", "2030-01-01", "job-a", 84));
  expect(committedCents(done, "pot-1", "2030-01-01")).toBe(84);
});
it("frees a released reserve", () => {
  expect(committedCents(ledgerOf(reserve("pot-1", "c", "job-a", 600), release("pot-1", "c", "job-a")), "pot-1", "c")).toBe(0);
});
it("settles in the cycle the job was reserved in, leaving the new cycle at zero", () => {   // Review Focus 4
  const l = ledgerOf(reserve("pot-1", "2030-01-01", "job-a", 600), settle("pot-1", "2030-01-01", "job-a", 161));
  expect(committedCents(l, "pot-1", "2030-02-01")).toBe(0);
  expect(committedCents(l, "pot-1", "2030-01-01")).toBe(161);
});
it("reports an unreadable line instead of dropping it", async () => {
  expect((await readLedger(fileWith('{"v":2,"kind":"reserve"\n'))).badLines).toBe(1);
});
it("reads a line in the launcher's own format (no v) as legacy", async () => {
  const l = await readLedger(fileWith(oldLine));
  expect(l.lines[0]).toMatchObject({ kind: "settle", pot: "legacy", cycle: "legacy", costCents: 84 });
});
```
- [ ] **Step 2:** Run the test file. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. `appendLedger` validates with zod before writing one line.
- [ ] **Step 4:** Run the test file. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 4: Choosing a pot

**Files:**
- Create: `src/shift/pots.ts`
- Test: `src/__tests__/shift-pots.test.ts`

**Interfaces:**
- Consumes: `Pot`, `Ledger`, `committedCents`.
- Produces:
```ts
/** The cycle containing `now`, found by stepping the pot's known cycle forward or back by whole months. */
export function currentCycle(pot: Pot, now: Date): { readonly start: string; readonly end: string };
export function leftCents(pot: Pot, ledger: Ledger, now: Date): number;   // grant minus committed in the current cycle
export type PotChoice = { readonly ok: true; readonly pot: Pot; readonly cycle: string } | { readonly ok: false; readonly reason: string };
export function choosePot(input: {
  readonly pots: readonly Pot[]; readonly ledger: Ledger; readonly budgetCents: number;
  readonly running: ReadonlyMap<string, number>; readonly maxRunningPerPot: number;
  readonly emptyUntil: ReadonlyMap<string, string>;   // pot id -> ISO time; set when the API says the credit is gone
  readonly now: Date;
}): PotChoice;
```
Rule: among pots that are confirmed, not held, not marked empty, under the running limit, and with `leftCents - reserve >= budget`, pick the one whose current cycle ends soonest; break ties by id.

- [ ] **Step 1: Write the failing tests**
```ts
it("rolls a known cycle forward by whole months", () => {
  expect(currentCycle(pot({ cycleStart: "2029-12-01", cycleEnd: "2030-01-01" }), new Date("2030-01-21T03:00:00Z")))
    .toEqual({ start: "2030-01-01", end: "2030-02-01" });
});
it("spends the pot that ends soonest", () => {
  const c = choosePot(input([potA_ends_later, potB_ends_sooner]));
  expect(c.ok && c.pot.id).toBe("pot-b");
});
it("skips unconfirmed, held and empty pots and says why", () => {
  const c = choosePot(input([unconfirmed, held, emptyPot]));
  expect(c).toEqual({ ok: false, reason: expect.stringContaining("pot-held: held (kept for another use)") });
});
it("keeps the reserve: $15 left with a $10 reserve cannot take a $6 job", () => {
  expect(choosePot(input([potWithLeft(1500)], 600)).ok).toBe(false);
});
it("respects the running limit", () => {
  expect(choosePot(input([potA], 600, new Map([["pot-a", 2]]))).ok).toBe(false);
});
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Month stepping clamps to the month's last day when the day does not exist.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 5: Job folders and admitting a brief

**Files:**
- Create: `src/shift/jobs.ts`
- Modify: `src/task.ts` (the strict front-matter schema: add `source`, `sensitive`, `kind`)
- Test: `src/__tests__/shift-jobs.test.ts`

**Interfaces:**
- Produces:
```ts
export type JobStatus = "waiting" | "reserved" | "building" | "collected" | "ready" | "pr-open" | "merged" | "closed" | "held" | "thrown-out" | "failed";
export interface JobState {
  readonly v: 1; readonly id: string; readonly status: JobStatus; readonly title: string;
  readonly source: string; readonly sensitive: boolean; readonly attempts: number;
  readonly pot: string | null; readonly cycle: string | null; readonly budgetCents: number; readonly timeoutMinutes: number;
  readonly sessionId: string | null; readonly baseSha: string | null; readonly runDir: string | null;
  readonly reservedAt: string | null; readonly startedAt: string | null; readonly runId: string | null; readonly interruptedAt: string | null;
  readonly deniedAsks: readonly string[]; readonly costCents: number | null;
  readonly doing: { readonly at: string; readonly text: string } | null;
  readonly pr: { readonly number: number; readonly url: string; readonly draft: boolean } | null;
  readonly reason: string | null; readonly updatedAt: string;
  readonly history: readonly { readonly at: string; readonly status: JobStatus; readonly note: string }[];
}
export const SENSITIVE_HINTS: readonly string[];   // auth, session, permission, tenan, share, token, clerk, stripe, payment, deposit, erase, delete, people
export const NEVER_HINTS: readonly string[];       // migration, drizzle/, deploy, railway, vercel.json, retention, sweep, privacy policy, terms, .github/workflows
export function admitBrief(queueDir: string, briefFile: string, now: Date): Promise<{ readonly ok: true; readonly job: JobState } | { readonly ok: false; readonly reason: string }>;
export function listJobs(queueDir: string): Promise<JobState[]>;
export function saveJob(queueDir: string, job: JobState): Promise<void>;
export function move(job: JobState, status: JobStatus, note: string, now: Date): JobState;   // throws on an illegal move
```
A job is the folder `<queueDir>/<id>/` holding `brief.md` and `state.json`. Legal moves: waiting to reserved; reserved to building, waiting or failed; building to collected, waiting or failed; collected to ready, held or thrown-out; ready to pr-open or thrown-out; pr-open to merged or closed; thrown-out to waiting (once, only for "master moved under it"). That requeue adds one to `attempts` and clears the job's session, pot, cycle, run folder, base, cost and times. `source` must start with one of `defect:`, `test:`, `module:`, `error:`, `feature:`, `control:`.

A brief whose text or cited paths match `NEVER_HINTS` is refused outright: the spec lists work that is never handed to an unattended agent (retention sweeps and deletion, migrations and deploy scripts, legal and privacy copy). The other two kinds on that list, work needing a real credential or live third-party data and work an open pull request already touches, cannot be detected here and are the brief writer's duty.

- [ ] **Step 1: Write the failing tests**
```ts
it("refuses a brief with no source", async () => {
  expect(await admitBrief(q, briefWithout("source"), now)).toEqual({ ok: false, reason: expect.stringContaining("source") });
});
it("refuses work that is never handed to an unattended agent", async () => {
  const r = await admitBrief(q, brief({ body: "Add drizzle migration 0102 for ..." }), now);
  expect(r).toEqual({ ok: false, reason: expect.stringContaining("never handed to an unattended agent") });
});
it("refuses a brief with no precondition", async () => {
  expect((await admitBrief(q, briefWithout("precondition"), now)).ok).toBe(false);
});
it("treats an unmarked brief as sensitive", async () => {
  const r = await admitBrief(q, briefWithout("sensitive"), now);
  expect(r.ok && r.job.sensitive).toBe(true);
});
it("raises a brief marked safe when its text names a sensitive area, and never lowers one", async () => {
  const raised = await admitBrief(q, brief({ sensitive: false, body: "Fix the share token check in ..." }), now);
  expect(raised.ok && raised.job.sensitive).toBe(true);
});
it("requires a mutation for a test-only brief", async () => {
  expect((await admitBrief(q, brief({ kind: "test", mutation: undefined }), now)).ok).toBe(false);
});
it("refuses an illegal move", () => { expect(() => move(waitingJob, "pr-open", "x", now)).toThrow(); });
it("never leaves a partial state file", async () => {
  await saveJob(q, bigJob);
  expect((await readdir(path.join(q, bigJob.id))).sort()).toEqual(["brief.md", "state.json"]);
});
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Reuse `parseTask`; write through a temporary file and rename.
- [ ] **Step 4:** Run this file and the existing `units.test.ts` (the schema changed). Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 6: Split the session loop into start, follow once, finish

**Files:**
- Modify: `src/sandbox/session.ts` (`runSession`, `finishRun`, `stopSession`, `createOrFind` and `EventTally`; `recollectSession` stays; export `stopSession`, which `finishSession` uses)
- Test: `src/__tests__/sandbox-follow.test.ts`; every existing case in `sandbox.test.ts` must pass unchanged

**Interfaces:**
- Produces:
```ts
export function startSession(options: Omit<SessionRunOptions, "timeoutMinutes" | "sleep" | "graceMs">): Promise<{ readonly sessionId: string; readonly status: string }>;
export interface FollowResult {
  readonly finished: boolean; readonly stopReason: string | null;
  readonly requests: number; readonly inputTokens: number; readonly outputTokens: number;
  readonly cacheReadTokens: number; readonly cacheCreationTokens: number;
  readonly verify: VerifyReport | null; readonly verifyRuns: number;
  readonly outcome: SessionRunResult["outcome"]; readonly errors: readonly string[];
  readonly newlyDenied: readonly string[];
  readonly doing: { readonly at: string; readonly text: string } | null;
}
/** Rebuilds everything from the session's whole history. Holds no memory between calls. */
export function followOnce(api: SandboxApi, sessionId: string, runDir: string, alreadyDenied: readonly string[]): Promise<FollowResult>;
export function finishSession(api: SandboxApi, sessionId: string, runDir: string, follow: FollowResult, timedOut: boolean, seams?: { readonly sleep?: (ms: number) => Promise<void>; readonly log?: (line: string) => void }): Promise<SessionRunResult>;
```
`doing` is the newest of: the first line of the latest `agent.message`, or the latest bash command, cut to 120 characters, with that event's `processed_at`. `followOnce` rewrites `events.jsonl` from the history each call and sends one denial for each approval ask not in `alreadyDenied`. `startSession` is the first half of `runSession`: the two uploads, then one create attempt with a one-minute deadline and no lookup (`runSession` keeps `createOrFind`, which looks for the session at once and books the whole budget when it may still exist; the conveyor looks over later ticks instead, see Task 7). `finishSession` is its last half and keeps the launcher's stop rule: it rebuilds the tally from the history (as `recollectSession` does), runs `stopSession` (read the platform's status; if it does not report idle or terminated, send the interrupt again with retries, poll up to 18 times 10 seconds apart, and archive the session if it still runs), and only then reads the platform's totals and the outputs; the result says `stopped`, `archived`, `runningAfterFinish` and `stopInterrupted`. `runSession` keeps its signature and is rebuilt from these three.

- [ ] **Step 1: Write the failing tests**
```ts
it("reports an unfinished session with what the agent is doing", async () => {
  const r = await followOnce(apiWithHistory(runningHistory), "sesn_1", dir, []);
  expect(r.finished).toBe(false);
  expect(r.doing?.text).toBe("pnpm --filter @omnitwin/api exec vitest run src/__tests__/bookings.test.ts");
});
it("reports a finished session with its verifier result", async () => {
  const r = await followOnce(apiWithHistory(finishedHistory), "sesn_1", dir, []);
  expect([r.finished, r.stopReason, r.verify?.ok]).toEqual([true, "end_turn", true]);
});
it("denies an approval ask once, not on every call", async () => {
  const api = apiWithHistory(historyWithAsk);
  const first = await followOnce(api, "sesn_1", dir, []);
  await followOnce(api, "sesn_1", dir, first.newlyDenied);
  expect(api.sentDenials).toHaveLength(1);
});
it("leaves each event once in events.jsonl after two calls", async () => {
  const api = apiWithHistory(runningHistory);
  await followOnce(api, "sesn_1", dir, []); await followOnce(api, "sesn_1", dir, []);
  expect(linesOf(path.join(dir, "events.jsonl"))).toHaveLength(runningHistory.length);
});
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the split.
- [ ] **Step 4:** Run `sandbox-follow.test.ts` and `sandbox.test.ts`. Expected: all PASS, the existing cases untouched.
- [ ] **Step 5:** Commit.

### Task 7: The steps of a job

**Files:**
- Create: `src/shift/steps.ts`
- Already in the launcher, nothing to modify: `src/sandbox/brief.ts` has the agent write `/mnt/session/outputs/precondition.json` as `{"ok":true}` or `{"ok":false}` after the precondition and stop when it is false; `planOutputs` in `src/sandbox/outputs.ts` brings back only the format-patch files, `diff.patch` and `precondition.json` (under that name, under the same size caps) and leaves every other output in the sandbox; the review rejects a `precondition.json` that is false, unreadable, or missing when the task has a precondition. `SandboxApi.listSessions` already exists; nothing changes in `src/sandbox/api.ts`.
- Test: `src/__tests__/shift-steps.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 6, and `bookedCost(stopped, snapshotUsd, budgetUsd)` from `src/sandbox/launcher.ts`. `ensureSandbox(api, stateFile, system, log)` from `src/sandbox/setup.ts` is called with `<workRoot>/state/<pot id>.json`, because an environment and an agent belong to one organisation.
- Produces:
```ts
export interface StepDeps {
  readonly settings: ShiftSettings; readonly ledgerFile: string; readonly queueDir: string;
  apiFor(pot: Pot): Promise<SandboxApi>;        // reads that pot's key file and builds the client with sdkSandboxApi, never new Anthropic()
  masterFacts(): Promise<{ readonly baseSha: string; readonly projectRules: string; readonly verifyScript: string }>;
  now(): Date; log(line: string): void;
}
export function reserveStep(job: JobState, deps: StepDeps, ledger: Ledger, running: ReadonlyMap<string, number>, emptyUntil: ReadonlyMap<string, string>): Promise<JobState>;
export function startStep(job: JobState, deps: StepDeps): Promise<JobState>;
export function followStep(job: JobState, deps: StepDeps): Promise<JobState>;
export function collectStep(job: JobState, deps: StepDeps): Promise<JobState>;
export function isCreditGone(error: unknown): boolean;   // an APIError whose message contains "credit balance is too low"
// already on SandboxApi (in src/sandbox/api.ts), used as it is: lists the sessions created since a time
listSessions(createdSince: string): AsyncIterable<SessionListing>;   // SessionListing = Pick<BetaManagedAgentsSession, "id" | "status" | "metadata">
```
- `reserveStep`: waiting to reserved. Writes the reserve line first, then saves the job. With no pot, the job stays waiting and `reason` carries the choice's reason.
- `startStep`: reserved to building. A job that already has a `sessionId` is moved to building without creating anything. A job with no `sessionId` and no `startedAt` saves `startedAt` and a new per-attempt `runId` (a random UUID) in one save, then creates the session with `metadata: { lane: "shift", job: <id>, task: <id>, run: <runId> }` (one attempt, a one-minute deadline, as the launcher's create), and saves the id before doing anything else. The conveyor does not use the launcher's rule of booking the whole budget after an unclear create, because it can keep looking over later ticks.
  - A failure is unclear exactly when the launcher's `isAmbiguousFailure` (`src/sandbox/api.ts`) says so: anything but a 4xx other than 408. A connection error, a timeout, a 408, a 5xx, a 2xx whose body broke or stalled, and a reply with no session id are all unclear.
  - An unclear failure leaves the job reserved. Each following tick looks for the session with `listSessions` (already on the launcher's API), from no later than `startedAt` less `LOOKUP_CLOCK_SKEW_MS`, the launcher's 10-minute slack for clock skew, exported from `src/sandbox/session.ts` (as `createOrFind` uses it). It adopts only a session whose metadata names this job and carries this attempt's `runId`; nothing is created then. Matching is on `job` and `run` alone (the per-attempt UUID makes that enough), so the test fixtures below leave `task` out. Any other session that names this job and that the ledger has not settled (an earlier attempt's late session) is never adopted: it is stopped and booked as an extra session, never as the job's own settle, at the larger of its retrieved figure (`retrieveSession`) and the job's budget, as not known.
  - A lookup that throws is not "none found": the job stays reserved and the next tick looks again. Only a lookup that succeeded at or past `startedAt` + 10 minutes and found nothing writes a release line, counts one attempt and returns the job to waiting; a second such attempt gives failed.
  - The same lookup, matching the saved `runId`, covers a tick that died between saving `startedAt` and saving the id. A job with no `startedAt` never created a session; one with a `startedAt` and no `sessionId` is looked up, never created again.
  - A failure the server refused (a 4xx other than 408: a 429, a validation error, a credit-gone error) certainly created nothing: the job is released at once, with no wait.
- `followStep`: calls `followOnce`, saves `doing` and the denied asks. At `startedAt + timeoutMinutes` it sends `user.interrupt`, retried with back-off (up to 5 attempts, as the launcher's `sendInterrupt` does), and sets `interruptedAt` once one has reached the session; if every attempt fails it stays as it is and the next tick sends it again. 10 minutes after `interruptedAt` it stops following, treats the session as timed out and moves it to collected. A session the stream says has finished also moves to collected. Neither move trusts the stream: collecting runs the stop rule.
- `collectStep`: `finishSession` (which confirms the stop or interrupts again and archives, taking up to about three minutes for a session that will not stop, inside the tick's lock), then `reviewRun`. It writes the settle line through `bookedCost`: the platform's figure, with `costKnown: true`, only when the platform reported the session stopped (idle or terminated); otherwise the larger of the last snapshot and the whole budget, with `costKnown: false` (the whole budget too when the figure cannot be read). That is the bound the platform's cap gives, not a strict one: the cap is checked before each model request, so one request already in flight can still take a session that may still be spending past that figure. `precondition.json` with `ok: false` gives thrown-out with reason "the defect is no longer there". A rejected review gives thrown-out with the review's reasons. Ready for review gives `held` when the job is sensitive, otherwise `ready`.
- An outside failure (a connection error, a 5xx, or a 429 on any call after the create) never moves a job that already has a session id: it stays where it is, the reason is recorded and the next tick tries again, so a running session is never left behind. Only a create the server refused (a 4xx other than 408; a 429 at the create is such a refusal, and its release gives the reserved credit back at once), or an unclear one whose successful lookup at or past `startedAt` + 10 minutes found nothing, adds one to `attempts` and returns the job to waiting; a second one gives failed. Every move from reserved back to waiting writes a release line first and clears `startedAt` and `runId`, so the next reservation creates afresh. `isCreditGone` writes a release line, returns the job to waiting and records the pot as empty until its cycle ends in `<workRoot>/pots/<id>.json`.

- [ ] **Step 1: Write the failing tests**
```ts
it("never starts a second session for a job that has one", async () => {           // Review Focus 1
  const api = new FakeApi();
  const job = await startStep({ ...reservedJob, sessionId: "sesn_existing" }, depsWith(api));
  expect([job.status, api.created]).toEqual(["building", 0]);
});
it("re-attaches after a restart from the saved id alone", async () => {             // Review Focus 1
  const saved = JSON.parse(JSON.stringify(buildingJob));
  const job = await followStep(saved, depsWith(new FakeApi({ history: finishedHistory })));
  expect(job.status).toBe("collected");
});
it("adopts an orphan session by its metadata and this attempt's run id", async () => {   // a tick died after saving startedAt and runId
  const api = new FakeApi({ sessions: [{ id: "sesn_orphan", metadata: { lane: "shift", job: startedJob.id, run: startedJob.runId } }] });
  const job = await startStep(startedJob, depsWith(api));
  expect([job.sessionId, api.created]).toEqual(["sesn_orphan", 0]);
});
it("never adopts an earlier attempt's session: the run id must match", async () => {
  const api = new FakeApi({ sessions: [{ id: "sesn_earlier", metadata: { lane: "shift", job: startedJob.id, run: "run-of-an-earlier-attempt" } }] });
  const job = await startStep(startedJob, depsWith(api));
  expect([job.status, job.sessionId, api.archived]).toEqual(["reserved", null, ["sesn_earlier"]]);   // stopped and booked as an extra session, not followed
});
it("looks up from no later than startedAt less the 10-minute clock-skew slack", async () => {
  const api = new FakeApi();
  await startStep(startedJob, depsWith(api));
  expect(Date.parse(api.listedSince[0])).toBeLessThanOrEqual(Date.parse(startedJob.startedAt) - LOOKUP_CLOCK_SKEW_MS);
});
it("keeps the reservation when a later tick's lookup finds nothing before startedAt + 10 minutes", async () => {
  const job = await startStep(startedJob, depsWith(new FakeApi(), { now: oneMinuteAfter(startedJob.startedAt) }));
  expect([job.status, await releaseLines(ledgerFile, job.id)]).toEqual(["reserved", 0]);
});
it("keeps the reservation when the lookup throws, even past ten minutes", async () => {
  const api = new FakeApi({ listError: new Error("connection reset") });
  const job = await startStep(startedElevenMinutesAgo, depsWith(api));
  expect([job.status, await releaseLines(ledgerFile, job.id)]).toEqual(["reserved", 0]);
});
it("calls a failure unclear exactly when isAmbiguousFailure does", async () => {
  for (const createError of [new TypeError("terminated"), apiError(408), apiError(503), new Error("the create response held no session id")]) {
    expect((await startStep(reservedJob, depsWith(new FakeApi({ createError })))).status).toBe("reserved");
  }
  const refused = await startStep(reservedJob, depsWith(new FakeApi({ createError: apiError(400) })));
  expect([refused.status, refused.attempts]).toEqual(["waiting", 1]);   // refused: nothing was created
});
it("retries the interrupt at the time limit and sends it once it has arrived", async () => {
  const api = new FakeApi({ history: runningHistory, sendOutcome: (_event, attempt) => (attempt < 3 ? "fail" : "ok") });
  const once = await followStep(pastTimeout(buildingJob), depsWith(api));
  await followStep(once, depsWith(api));
  expect([api.sent.filter((e) => e.type === "user.interrupt").length, once.interruptedAt === null]).toEqual([1, false]);
});
it("archives a session that will not stop and books the whole budget as unknown", async () => {
  const api = new FakeApi({ history: runningHistory, statuses: ["running"], listCostCents: 84 });
  await collectStep(interruptedJob, depsWith(api));
  expect(api.archived).toEqual(["sesn_1"]);
  expect(await settleLine(ledgerFile, "job-a")).toMatchObject({ costCents: 600, costKnown: false });   // max(snapshot 84, budget 600)
});
it("settles at the platform's figure once the session has stopped, and clears the reserve", async () => {
  await collectStep(collectedJob, depsWith(new FakeApi({ statuses: ["idle"], listCostCents: 84 })));
  expect(committedCents(await readLedger(ledgerFile), "pot-1", "2030-01-01")).toBe(84);
});
it("keeps a job reserved after an unclear create, then releases it once the lookup has found nothing for 10 minutes", async () => {
  const api = new FakeApi({ createError: new TypeError("terminated") });
  const first = await startStep(reservedJob, depsWith(api));
  expect([first.status, first.startedAt === null]).toEqual(["reserved", false]);
  const later = await startStep(first, depsWith(api, { now: tenMinutesAfter(first.startedAt) }));
  expect([later.status, later.attempts, await releaseLines(ledgerFile, reservedJob.id)]).toEqual(["waiting", 1, 1]);
  expect([later.startedAt, later.runId]).toEqual([null, null]);   // the next reservation creates afresh
});
it("brings back precondition.json and no other non-patch output", () => {
  expect(planOutputs([out("precondition.json"), out("report.md"), out("0001-fix.patch")]).downloads.map((d) => d.localName)).toEqual(["patch-0001.patch", "precondition.json"]);
});
it("holds a sensitive job instead of making it ready", async () => {
  expect((await collectStep({ ...collectedJob, sensitive: true }, okDeps)).status).toBe("held");
});
it("throws out a job whose defect is no longer there", async () => {
  const job = await collectStep(collectedJob, depsWith(new FakeApi({ outputs: { "precondition.json": '{"ok":false}' } })));
  expect([job.status, job.reason]).toEqual(["thrown-out", "the defect is no longer there"]);
});
it("marks the pot empty and frees the job when the credit is gone", async () => {
  const job = await startStep(reservedJob, depsWith(new FakeApi({ createFails: creditGoneError })));
  expect(job.status).toBe("waiting");
  expect(await emptyUntilOf("pot-1")).toBe("2030-02-01");
});
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The test sketches above stand for the real fixture: `FakeApi` takes `(connections, files)` and already records the sessions created, the events that reached the session (`sent`) and every attempt (`sendAttempts`), the archived ids, the statuses `retrieveSession` reports in turn, `listCostCents`, `createError`, `earlierSessions`, `listFailures` (a lookup that throws) and `listedSince` (each lookup's start time); the sketches' `listError`, `sessions` (listed ones) and `createFails` stand for `listFailures`, `earlierSessions` and `createError`, and `api.created` for the length of the real `sessions` (the creates); extend it only where a test needs more, and write each test against those fields.
- [ ] **Step 4:** Run this file and `sandbox.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 8: The frames trial

A one-off with real spend, capped at $3. Do it only after the owner has confirmed a pot (no card) and its balance has been read.

**Files:**
- Create: `src/shift/trials/frames-trial.ts`
- Test: `src/__tests__/frames-trial.test.ts` (parameters only; the run itself is the test)

**Interfaces:**
- Consumes: `startSession`, `followOnce`, `finishSession`, the ledger, `Pot`.
- Produces: `runFramesTrial(deps: { settings: ShiftSettings; pot: Pot; now(): Date; log(l: string): void }): Promise<{ readonly frames: readonly string[]; readonly costCents: number; readonly minutes: number }>` and `framesEnvironmentParams(): EnvironmentCreateParams`.

The trial's environment is separate (`venviewer-frames-trial`) and adds four hosts to the launcher's two: `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`, `archive.ubuntu.com`, `security.ubuntu.com`. The kickoff is a plain `user.message`, with no verifier and no outcome: clone `origin/master`, `pnpm install --frozen-lockfile`, `pnpm --filter @omnitwin/types build`, `pnpm --filter @omnitwin/web exec playwright install --with-deps chromium`, then a throwaway spec under `packages/web/e2e/` that uses the repository's own Playwright config and saves `/pricing` and `/privacy` at 1366 by 641, 1536 by 704 and 1920 by 953 into `/mnt/session/outputs/`. Budget $3, time limit 30 minutes. The launcher's `planOutputs` brings back only patches and `precondition.json`, so the trial lists the session's outputs itself (`api.listOutputFiles`) and downloads the six PNG files with `api.downloadFile`, which streams and takes a byte cap, under names it chooses (`frame-1.png` to `frame-6.png`).

- [ ] **Step 1:** Write the test: `framesEnvironmentParams()` keeps networking `limited`, its allowed hosts equal the six expected names, and the session is created with a budget amount of `"300"`.
- [ ] **Step 2:** Run. Expected: FAIL. Implement. Run. Expected: PASS. Commit.
- [ ] **Step 3:** Capture the same six frames locally in Chrome with the repository's Playwright config, into `<workRoot>/trials/frames/local/`.
- [ ] **Step 4:** Run `pnpm --filter @omnitwin/credit-runner shift trial-frames --pot <id>`. The trial passes when six PNG files come back, the session cost is at most $3.00 and it took at most 30 minutes.
- [ ] **Step 5:** Put each cloud frame beside its local twin and write `<workRoot>/trials/frames/<stamp>/REPORT.md`: pass or fail on the three numbers, the pixel sizes, and what differs to the eye. Send the pairs to the owner; whether they are close enough to judge by is the owner's call.

### Task 9: Delivery

**Files:**
- Create: `src/shift/publish.ts`
- Test: `src/__tests__/shift-publish.test.ts` (temporary git repositories, as `sandbox-verify.test.ts` builds them, and a fake command runner)

**Interfaces:**
- Consumes: `JobState`, `ShiftSettings`, `Review`, `SessionRunResult`.
- Produces:
```ts
export interface PublishDeps {
  readonly settings: ShiftSettings;
  run(cmd: string, args: readonly string[], opts: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  readToken(): Promise<string | null>;   // null when no token file is configured
  now(): Date; log(line: string): void;
}
export type PublishResult =
  | { readonly ok: true; readonly pr: { readonly number: number; readonly url: string; readonly draft: true } }
  | { readonly ok: false; readonly reason: string; readonly retry: boolean };
export function publishJob(job: JobState, record: { readonly runDir: string; readonly baseSha: string }, deps: PublishDeps): Promise<PublishResult>;
export function findPrivateText(diff: string, privateNames: readonly string[]): string[];
export function prBody(job: JobState, review: Review, result: SessionRunResult): string;
export function openPrCount(deps: PublishDeps): Promise<number>;
```
`publishJob`, in the publisher's own clone and never the shared checkout: fetch; create `credit/<id>` at the job's base; apply the returned format-patch files in order (the launcher saves them under its own names, `patch-0001.patch` and on, with `diff.patch`, in the run's `outputs` folder); require `git diff <base> HEAD` to equal the returned `diff.patch`; run gitleaks over the new commits; require `findPrivateText` to be empty; require a clean `git merge-tree` against `origin/<baseBranch>`; push; `gh pr create --draft`. The pull request's body says the second review is missing until the reviewer exists. With no token it returns `{ ok: false, reason: "no GitHub token yet", retry: false }` and the job stays ready. At the open pull request limit it returns `retry: true`.

The publisher's clone runs with `core.autocrlf=false`, and the diff check compares after turning CRLF into LF.

The token reaches `gh` as `GH_TOKEN` and `git push` as an extra header set through `GIT_CONFIG_*` variables, both in that child's own environment, never in its arguments or a URL; any output that reaches a log or a reason is scrubbed of it.

- [ ] **Step 1: Write the failing tests**
```ts
it("opens a draft pull request for a clean patch", async () => {
  const r = await publishJob(readyJob, record, depsWith(fakeGh({ created: "https://github.com/o/r/pull/468" })));
  expect(r).toEqual({ ok: true, pr: { number: 468, url: "https://github.com/o/r/pull/468", draft: true } });
});
it("does not push when master moved under it", async () => {                         // Review Focus 5
  const r = await publishJob(readyJob, record, depsWith(fakeGh(), { masterConflicts: true }));
  expect(r).toEqual({ ok: false, reason: "master moved under it", retry: false });
  expect(pushes()).toBe(0);
});
it("does not push a diff that carries an address or a private name", async () => {
  expect(findPrivateText("+const a = 'someone@mail.test';", [])).toEqual(["someone@mail.test"]);
  expect(findPrivateText("+// thanks pot-owner-name", ["pot-owner-name"])).toEqual(["pot-owner-name"]);
  expect(findPrivateText("+const a = 'x@example.com'; // y@venviewer.invalid", [])).toEqual([]);
});
it("does not push when the applied branch differs from the verified diff", async () => {
  expect((await publishJob(readyJob, recordWithTamperedDiff, okDeps)).ok).toBe(false);
});
it("keeps the token out of the tick's environment and its log", async () => {
  await publishJob(readyJob, record, depsWith(fakeGh(), { token: "ghp_TESTTOKEN" }));
  expect(Object.values(process.env)).not.toContain("ghp_TESTTOKEN");
  expect(logged.join("\n")).not.toContain("ghp_TESTTOKEN");
});
it("stays ready when there is no token, and when eight pull requests are open", async () => {
  expect(await publishJob(readyJob, record, depsWith(fakeGh(), { token: null }))).toMatchObject({ ok: false, retry: false });
  expect(await publishJob(readyJob, record, depsWith(fakeGh({ open: 8 })))).toMatchObject({ ok: false, retry: true });
});
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The token reaches only the `git` and `gh` child through that child's own `env`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 10: The tick, the lock, the snapshot and the commands

**Files:**
- Create: `src/shift/tick.ts`, `src/shift/board.ts`, `src/shift/cli.ts`
- Modify: `package.json` (script `"shift": "tsx src/shift/cli.ts"`)
- Test: `src/__tests__/shift-tick.test.ts`, `src/__tests__/shift-board.test.ts`

**Interfaces:**
- Consumes: every earlier task.
- Produces:
```ts
export function withTickLock<T>(workRoot: string, now: () => Date, fn: () => Promise<T>): Promise<T | "busy">;   // stale after 10 minutes
export interface TickDeps extends StepDeps { readonly publish: PublishDeps }
export interface TickReport { readonly busy: boolean; readonly moved: number; readonly started: number }
export function tick(deps: TickDeps): Promise<TickReport>;
export function buildBoard(input: { readonly settings: ShiftSettings; readonly jobs: readonly JobState[]; readonly ledger: Ledger; readonly paused: { readonly at: string; readonly reason: string } | null; readonly emptyUntil: ReadonlyMap<string, string>; readonly now: Date }): Board;
export function writeBoard(workRoot: string, board: Board): Promise<void>;   // <workRoot>/board.json
```
Within a tick the order is: pull requests, collect, publish, follow, start, reserve. Money is freed before it is committed. Quiet hours and the pause switch stop `reserve` and `start` only. `reserve` also stops at the day ceiling and at the open pull request limit.

The pull request pass reads each `pr-open` job's pull request with `gh pr view <number> --json state,isDraft` and moves the job to `merged` or `closed` when GitHub says so. It never marks a draft ready: that arrives with the reviewer's plan. A job thrown out for "master moved under it" returns to waiting once, with a fresh base.

`buildBoard` also warns of credit about to be lost. For each usable pot whose cycle ends within 7 days it projects the spend to the end of the cycle at the last 7 days' daily average; when `leftCents` less that projection is over $20 it adds a `needsYou` entry of kind `pot`, titled `<label> will lose about $<N> on <day>`.

**The snapshot, `board.json`, is the contract with the board plan. Do not change it without changing both plans.**
```ts
export interface Board {
  readonly v: 1;
  readonly writtenAt: string;                                  // ISO; also the heartbeat
  readonly heartbeat: { readonly hadWork: boolean; readonly hadCredit: boolean; readonly hadRoom: boolean; readonly lastStartAt: string | null };
  readonly paused: { readonly at: string; readonly reason: string } | null;
  readonly today: { readonly date: string; readonly spentCents: number; readonly capCents: number; readonly landed: number; readonly thrownOut: number };
  readonly month: { readonly spentCents: number; readonly grantCents: number };   // across usable pots, current cycles
  readonly pots: readonly { readonly id: string; readonly label: string; readonly state: "spending" | "next" | "ready" | "held" | "empty" | "unconfirmed"; readonly grantCents: number; readonly leftCents: number; readonly cycleEnds: string; readonly note: string | null }[];
  readonly inHand: readonly { readonly id: string; readonly title: string; readonly source: string; readonly stage: "starting" | "building" | "being-checked" | "opening-pr"; readonly doing: string | null; readonly costCents: number | null; readonly startedAt: string | null }[];
  readonly waiting: { readonly count: number; readonly next: readonly string[] };   // up to 8 titles
  readonly record: readonly { readonly at: string; readonly kind: "pr" | "out" | "held" | "start" | "alarm"; readonly title: string; readonly pr: number | null; readonly prState: "draft" | "ready" | "merged" | "closed" | null; readonly reason: string | null; readonly costCents: number | null }[];   // newest first, at most 60
  readonly needsYou: readonly { readonly kind: "look" | "pot" | "key" | "alarm"; readonly title: string; readonly detail: string }[];
}
```
A pot the settings mark unconfirmed appears with state `unconfirmed`; a pot the owner has not linked is one of these, with `note: "not linked"`.

- [ ] **Step 1: Write the failing tests**
```ts
it("does nothing when another tick holds the lock", async () => {                   // Review Focus 2
  const before = await snapshotOf(workRoot);
  await withTickLock(workRoot, now, async () => { expect(await tick(deps)).toMatchObject({ busy: true, moved: 0 }); });
  expect(await snapshotOf(workRoot)).toEqual(before);
});
it("takes over a lock older than ten minutes", async () => {
  await writeStaleLock(workRoot, minutesAgo(11));
  expect((await tick(deps)).busy).toBe(false);
});
it("starts nothing while the ledger has an unreadable line, and says so", async () => {   // Review Focus 3
  await appendFile(ledgerFile, '{"v":2,"kind":"reserve"\n');
  const report = await tick(deps);
  expect(report.started).toBe(0);
  expect((await readBoard(workRoot)).needsYou[0]).toMatchObject({ kind: "alarm", title: "The ledger has a line that cannot be read" });
});
it("runs three jobs to two pull requests and one thrown out", async () => {
  await runTicksUntilQuiet(deps);
  const b = await readBoard(workRoot);
  expect([b.today.landed, b.today.thrownOut, b.inHand.length, b.waiting.count]).toEqual([2, 1, 0, 0]);
  expect(b.record.filter((r) => r.kind === "pr")).toHaveLength(2);
});
it("starts nothing in quiet hours but still collects", async () => {
  const report = await tick(depsAt("03:00", { quietHours: { from: "01:00", to: "07:00" } }));
  expect(report.started).toBe(0);
  expect((await jobById("finished-in-cloud")).status).toBe("ready");
});
it("stops reserving at the day ceiling and at eight open pull requests", async () => {
  expect((await tick(depsWithDaySpent(4000))).started).toBe(0);
  expect((await tick(depsWithOpenPrs(8))).started).toBe(0);
});
it("names the pot that is spending and the one that is next", () => {
  expect(buildBoard(twoUsablePots).pots.map((p) => p.state)).toEqual(["spending", "next"]);
});
it("follows a pull request to merged and never marks a draft ready", async () => {
  await tick(depsWithGh({ view: { state: "MERGED", isDraft: false } }));
  expect((await jobById("opened-yesterday")).status).toBe("merged");
  expect(ghCalls().some((c) => c.includes("ready"))).toBe(false);
});
it("queues a job once more when master moved under it, and only once", async () => {   // Review Focus 5
  await runTicksUntilQuiet(depsWithMasterConflictOnce);
  expect((await jobById("conflicted")).attempts).toBe(1);
  await runTicksUntilQuiet(depsWithMasterConflictAlways);
  expect((await jobById("conflicted-twice")).status).toBe("thrown-out");
});
it("warns four days ahead that a pot will lose about $120", () => {
  const b = buildBoard(potEndingInFourDaysWith(16000, { dailyAverageCents: 1000 }));
  expect(b.needsYou).toContainEqual(expect.objectContaining({ kind: "pot", title: expect.stringContaining("will lose about $120") }));
});
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `shift status` prints the board in words and makes no API call. `shift add <brief.md>` calls `admitBrief` and prints the refusal reason when there is one.
- [ ] **Step 4:** Run both files. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 11: The pause switch and the daily control

**Files:**
- Create: `src/shift/controls.ts`, `controls/already-fixed.md` (a brief whose precondition greps for text that is absent on master)
- Modify: `src/shift/tick.ts`, `src/shift/cli.ts` (`pause <reason>`, `resume`)
- Test: `src/__tests__/shift-controls.test.ts`

**Interfaces:**
- Produces:
```ts
export function readPause(workRoot: string): Promise<{ readonly at: string; readonly reason: string } | null>;   // <workRoot>/paused.json
export function pause(workRoot: string, reason: string, now: Date): Promise<void>;
export function resume(workRoot: string): Promise<void>;
export function controlDue(jobs: readonly JobState[], localDay: string): boolean;        // none admitted yet today
export function judgeControl(job: JobState, outputs: readonly string[], costCents: number): { readonly ok: true } | { readonly ok: false; readonly reason: string };
```
The control job has `source: "control:already-fixed"`. It passes when it ended thrown out with "the defect is no longer there", returned no patch file, and cost at most 50 cents. A failed control pauses the shift with its reason and adds an alarm to `needsYou`. The control is admitted before the day's first reserve.

- [ ] **Step 1: Write the failing tests**
```ts
it("passes a control that stopped at its precondition for 31 cents", () => {
  expect(judgeControl(stoppedAtPrecondition, [], 31)).toEqual({ ok: true });
});
it("fails a control that produced a patch, and pauses the shift", async () => {
  expect(judgeControl(producedPatch, ["0001-x.patch"], 96).ok).toBe(false);
  await runTicksUntilQuiet(depsWithFailingControl);
  expect((await readPause(workRoot))?.reason).toContain("control");
  expect((await tick(deps)).started).toBe(0);
});
it("fails a control that cost more than 50 cents", () => {
  expect(judgeControl(stoppedAtPrecondition, [], 51).ok).toBe(false);
});
it("admits one control a day, before the first reserve", () => {
  expect(controlDue([], "2030-01-21")).toBe(true);
  expect(controlDue([controlJobOf("2030-01-21")], "2030-01-21")).toBe(false);
});
```
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Then run the whole package: `pnpm --filter @omnitwin/credit-runner test`, `typecheck`, `lint`.
- [ ] **Step 5:** Commit, push, open the pull request for Tasks 2 to 11, and wait for green CI.

### Task 12: The scheduled task and the first unattended night

**Files:**
- Create: `install-shift-task.ps1`
- Modify: `README.md` (the shift's commands, settings and files)

- [ ] **Step 1:** Clone the repository to a `runtime` folder under the work root at the merged commit and run `pnpm install --filter @omnitwin/credit-runner...` there. The scheduled task runs from this clone, never from a worktree. Clone again to a `publisher` folder under the work root for Task 9.
- [ ] **Step 2:** Write `install-shift-task.ps1`. It registers the task "Night shift - tick" the way the owner's local dashboard registers its own: `conhost.exe` as the action so no window opens, repeat every 2 minutes, `-MultipleInstances IgnoreNew`, execution limit 8 minutes, start when available. It runs `pnpm --filter @omnitwin/credit-runner shift tick`.
- [ ] **Step 3:** Write `settings.json` in the work root with the pots the owner has confirmed. Ask the owner to set each of those organisations' monthly spend limit in the Console (the spec's fourth cap), and record the day it was done. Run `shift status`. Expected: the pots listed, no error, no API call.
- [ ] **Step 4:** Write eight briefs by hand from the defects that are still open and suit the sandbox (the design's first feed). For each, run its precondition against today's master first. Admit them with `shift add`.
- [ ] **Step 5:** Run `shift tick` by hand twice and read `board.json`. Then register the task, close every chat, and leave it for the night.
- [ ] **Step 6:** In the morning check the spec's test for this step: every delivered pull request has green CI; the ledger's total for the night matches the Console's billing page within 50 cents (the account owner reads the page); and `shift status` shows nothing in hand. Record the result, with the night's yield and cost per pull request, in `docs/sessions/`.
