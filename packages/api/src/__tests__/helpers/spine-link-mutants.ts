import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, cpSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { CASES, ERASURE, MUTANTS, PROVEN_ELSEWHERE, ROUTE, type CaseKey, type Mutant, type Source, type Suite } from "./spine-link-mutants-list.js";

// ---------------------------------------------------------------------------
// The spine links' mutation check: each named one-line change of the erasure
// service or the enquiries route (spine-link-mutants-list.ts) must turn every
// case named for it red, each on an assertion.
//
// It works on a copy of the API package two levels below the repository, as
// the package is (so every path the package reads relative to itself still
// resolves), with the package's node_modules linked in. The checkout's own
// files never change. Before the first change it runs each set of cases the
// changes name on the real code, alone, and stops unless every one is green.
// Then, for each change: it checks the file's sha256, writes the change, runs
// only the change's cases, writes the file back and checks its sha256 again
// before the next. Each run is a Vitest process of its own against the Test
// job's disposable platform database; its result is read from Vitest's JSON
// report, never from its exit code:
//   - KILLED: every named case failed on an assertion;
//   - SURVIVED: a named case passed;
//   - ERROR: otherwise (the file failed to load, a case threw something other
//     than an assertion, timed out, or did not run).
// Each run's report and output are kept under .test-results/api-vitest/
// spine-link-mutants, with the summary.
// ---------------------------------------------------------------------------

const API_ROOT = resolve(import.meta.dirname, "../../..");
const REPO_ROOT = resolve(API_ROOT, "../..");
const WORK_PARENT = join(REPO_ROOT, ".spine-link-mutants");
const WORK = join(WORK_PARENT, "api");
const RESULTS = join(API_ROOT, ".test-results", "api-vitest", "spine-link-mutants");
/** The Test job's disposable platform database: the only target the suites' guard accepts. */
const PLATFORM_TARGET = "postgresql://postgres:postgres@127.0.0.1:55477/venviewer_platform_test";
/** Set in each run's environment, so the check never starts inside one of its own runs. */
export const CHILD_MARK = "VENVIEWER_SPINE_LINK_MUTANTS_CHILD";
const RUN_LIMIT_MS = 10 * 60 * 1000;
const TOTAL_LIMIT_MS = 150 * 60 * 1000;
/** Folders of the package the copy leaves out; its node_modules is linked instead. */
const LEFT_OUT = new Set(["node_modules", "dist", ".test-results", "coverage"]);
const FINAL = "SPINE LINK MUTANTS";
/** The files the changes are made in. */
const SOURCES: readonly Source[] = [ERASURE, ROUTE];

type CaseState = "passed" | "assertion" | "error";
type Verdict = "KILLED" | "SURVIVED" | "ERROR";

interface CaseOutcome {
  readonly key: CaseKey;
  readonly state: CaseState;
  readonly detail: string;
}

interface RunOutcome {
  readonly cases: readonly CaseOutcome[];
  /** What the report says of the file itself (an import or hook error), if anything. */
  readonly fileProblem: string | null;
  readonly seconds: number;
}

interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
}

interface Original {
  readonly bytes: Buffer;
  readonly sha: string;
  readonly text: string;
}

export interface MutationCheck {
  readonly passed: boolean;
  /** The one last line, findable in the log by its first words. */
  readonly finalLine: string;
  readonly report: string;
}

const ReportSchema = z.object({
  testResults: z.array(z.object({
    name: z.string(),
    message: z.string().optional(),
    assertionResults: z.array(z.object({
      title: z.string(),
      status: z.string(),
      failureMessages: z.array(z.string()).optional(),
    })),
  })),
});

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const firstLine = (text: string): string => (text.split("\n")[0] ?? "").trim().slice(0, 240);
const escapeForPattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pad = (n: number): string => String(n).padStart(2, "0");
const shortSuite = (suite: Suite): string => suite.replace(/^src\/__tests__\//u, "");

/** The 1-based line of a character offset. */
function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let at = 0; at < offset; at += 1) {
    if (text.charCodeAt(at) === 10) line += 1;
  }
  return line;
}

/** Where each occurrence of a part starts, overlapping ones included. */
function occurrences(text: string, part: string): number[] {
  const found: number[] = [];
  if (part === "") return found;
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) found.push(at);
  return found;
}

/** The one suite of a set of cases, or undefined when they span two. */
function suiteOf(keys: readonly CaseKey[]): Suite | undefined {
  const suites = [...new Set(keys.map((key) => CASES[key].suite))];
  return suites.length === 1 ? suites[0] : undefined;
}

/** What is wrong with the list against the checkout's files, if anything. */
function listProblems(): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const mutant of MUTANTS) {
    if (names.has(mutant.name)) problems.push(`two changes are named "${mutant.name}"`);
    names.add(mutant.name);
    const count = occurrences(readFileSync(join(API_ROOT, mutant.file), "utf8"), mutant.from).length;
    if (count !== 1) problems.push(`"${mutant.name}": its text is in ${mutant.file} ${String(count)} times, not once`);
    if (mutant.from === mutant.to) problems.push(`"${mutant.name}" changes nothing`);
    if (mutant.cases.length === 0 || suiteOf(mutant.cases) === undefined) problems.push(`"${mutant.name}" must name cases of one suite`);
  }
  for (const [key, entry] of Object.entries(CASES)) {
    const count = occurrences(readFileSync(join(API_ROOT, entry.suite), "utf8"), `"${entry.title}"`).length;
    if (count !== 1) problems.push(`case ${key} is titled in ${entry.suite} ${String(count)} times, not once`);
  }
  return problems;
}

function removeWork(): void {
  const link = join(WORK, "node_modules");
  try {
    if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
  } catch {
    // No link to take away.
  }
  rmSync(WORK_PARENT, { recursive: true, force: true });
}

function makeWork(): void {
  removeWork();
  mkdirSync(WORK_PARENT, { recursive: true });
  cpSync(API_ROOT, WORK, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => !LEFT_OUT.has(relative(API_ROOT, source).split(sep)[0] ?? ""),
  });
  symlinkSync(join(API_ROOT, "node_modules"), join(WORK, "node_modules"), "junction");
}

function vitestCli(): string {
  const require = createRequire(join(API_ROOT, "package.json"));
  return join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
}

/** The run's environment: no generic database target, no CI annotations, the platform target, and the mark. */
function childEnv(): NodeJS.ProcessEnv {
  const kept = Object.entries(process.env).filter(([key]) =>
    key.toUpperCase() !== "DATABASE_URL" && !key.startsWith("VITEST") && key !== "GITHUB_ACTIONS");
  return { ...Object.fromEntries(kept), NODE_ENV: "test", VENVIEWER_PLATFORM_TEST_DATABASE_URL: PLATFORM_TARGET, [CHILD_MARK]: "1" };
}

/** What a run's JSON report says of each named case. */
function readOutcome(reportPath: string, suite: Suite, keys: readonly CaseKey[], exit: Exit): Omit<RunOutcome, "seconds"> {
  const how = `Vitest exit ${String(exit.code)}, signal ${String(exit.signal)}${exit.timedOut ? ", stopped at the run's limit" : ""}`;
  let report: z.infer<typeof ReportSchema>;
  try {
    report = ReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch {
    const problem = `no readable report (${how})`;
    return { cases: keys.map((key): CaseOutcome => ({ key, state: "error", detail: problem })), fileProblem: problem };
  }
  const file = report.testResults.find((result) => result.name.split("\\").join("/").endsWith(suite));
  const message = file?.message ?? "";
  const fileProblem = file === undefined ? `the suite is not in the report (${how})` : message.trim() === "" ? null : firstLine(message);
  const cases = keys.map((key): CaseOutcome => {
    const found = file?.assertionResults.filter((result) => result.title === CASES[key].title) ?? [];
    const [only] = found;
    if (found.length !== 1 || only === undefined) {
      return { key, state: "error", detail: found.length > 1 ? "more than one case of this title" : fileProblem ?? "the case did not run" };
    }
    if (only.status === "passed") return { key, state: "passed", detail: "passed" };
    if (only.status !== "failed") return { key, state: "error", detail: `the case was ${only.status}` };
    const first = only.failureMessages?.[0] ?? "";
    if (/^AssertionError\b/u.test(first)) return { key, state: "assertion", detail: firstLine(first) };
    return { key, state: "error", detail: first === "" ? "failed with no message" : firstLine(first) };
  });
  return { cases, fileProblem };
}

/** One Vitest process on the copy: only the named cases of the suite. */
async function runCases(label: string, suite: Suite, keys: readonly CaseKey[]): Promise<RunOutcome> {
  const reportPath = join(RESULTS, `${label}.json`);
  rmSync(reportPath, { force: true });
  const pattern = keys.map((key) => escapeForPattern(CASES[key].title)).join("|");
  const started = Date.now();
  const output = openSync(join(RESULTS, `${label}.log`), "w");
  const exit = await new Promise<Exit>((done, fail) => {
    const child = spawn(process.execPath, [vitestCli(), "run", suite, "-t", pattern,
      "--reporter=default", "--reporter=json", `--outputFile=${reportPath}`], {
      cwd: WORK, env: childEnv(), shell: false, windowsHide: true, stdio: ["ignore", output, output],
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, RUN_LIMIT_MS);
    child.once("error", (error) => { clearTimeout(timer); fail(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); done({ code, signal, timedOut }); });
  }).finally(() => { closeSync(output); });
  return { ...readOutcome(reportPath, suite, keys, exit), seconds: Math.round((Date.now() - started) / 1000) };
}

/** Runs with one file of the copy changed, and puts it back byte for byte. */
async function underChange(original: Original, path: string, changed: string, run: () => Promise<RunOutcome>): Promise<RunOutcome> {
  if (sha256(readFileSync(path)) !== original.sha) throw new Error(`${relative(WORK, path)} was not the real code before a change`);
  writeFileSync(path, changed, "utf8");
  const outcome = await run().finally(() => { writeFileSync(path, original.bytes); });
  if (sha256(readFileSync(path)) !== original.sha) throw new Error(`${relative(WORK, path)} did not come back byte for byte`);
  return outcome;
}

function verdictOf(run: RunOutcome): Verdict {
  if (run.cases.every((outcome) => outcome.state === "assertion")) return "KILLED";
  if (run.cases.some((outcome) => outcome.state === "passed")) return "SURVIVED";
  return "ERROR";
}

/** The whole check; `say` gets each line as it is known. */
export async function runSpineLinkMutants(say: (line: string) => void): Promise<MutationCheck> {
  const started = Date.now();
  rmSync(RESULTS, { recursive: true, force: true });
  mkdirSync(RESULTS, { recursive: true });
  const lines: string[] = [];
  const note = (line: string): void => { lines.push(line); say(line); };
  const finish = (passed: boolean, finalLine: string): MutationCheck => {
    note(finalLine);
    writeFileSync(join(RESULTS, "summary.txt"), `${lines.join("\n")}\n`);
    return { passed, finalLine, report: lines.join("\n") };
  };
  const minutes = (): string => String(Math.round((Date.now() - started) / 60_000));
  const overTime = (): boolean => Date.now() - started > TOTAL_LIMIT_MS;

  const problems = listProblems();
  if (problems.length > 0) {
    for (const problem of problems) note(`The list does not match the code: ${problem}`);
    return finish(false, `${FINAL}: FAILED, the list of changes does not match the code (${String(problems.length)} problems); nothing was run`);
  }
  const checkoutSha = new Map<Source, string>(SOURCES.map((file): [Source, string] => [file, sha256(readFileSync(join(API_ROOT, file)))]));

  makeWork();
  try {
    const originals = new Map<Source, Original>();
    for (const file of SOURCES) {
      const bytes = readFileSync(join(WORK, file));
      if (sha256(bytes) !== checkoutSha.get(file)) throw new Error(`the copy of ${file} differs from the checkout's`);
      originals.set(file, { bytes, sha: sha256(bytes), text: bytes.toString("utf8") });
    }

    // The real code first: each set of cases a change names, run alone as the change's run will be.
    const sets = new Map<string, { readonly suite: Suite; readonly keys: readonly CaseKey[] }>();
    for (const mutant of MUTANTS) {
      const keys = [...mutant.cases].sort();
      const suite = suiteOf(keys);
      if (suite !== undefined) sets.set(`${suite} ${keys.join(" ")}`, { suite, keys });
    }
    note(`${FINAL}: ${String(MUTANTS.length)} changes; first the real code, ${String(sets.size)} sets of cases, each run alone.`);
    let notGreen = 0;
    let set = 0;
    for (const { suite, keys } of sets.values()) {
      set += 1;
      if (overTime()) {
        notGreen += 1;
        note(`[real code ${String(set)}/${String(sets.size)}] not run: the check's time limit`);
        continue;
      }
      const run = await runCases(`real-code-${pad(set)}`, suite, keys);
      const green = run.fileProblem === null && run.cases.every((outcome) => outcome.state === "passed");
      note(`[real code ${String(set)}/${String(sets.size)}] ${String(keys.length)} case(s) of ${shortSuite(suite)}: ${green ? "green" : "NOT GREEN"} (${String(run.seconds)} s)`);
      if (!green) {
        notGreen += 1;
        if (run.fileProblem !== null) note(`    the file: ${run.fileProblem}`);
        for (const outcome of run.cases.filter((each) => each.state !== "passed")) note(`    ${outcome.state}: ${CASES[outcome.key].title}: ${outcome.detail}`);
      }
    }
    if (notGreen > 0) {
      return finish(false, `${FINAL}: FAILED, the real code did not pass ${String(notGreen)} of ${String(sets.size)} sets of cases; no change was run`);
    }

    const rows: { readonly mutant: Mutant; readonly where: string; readonly verdict: Verdict }[] = [];
    for (const [index, mutant] of MUTANTS.entries()) {
      const original = originals.get(mutant.file);
      const suite = suiteOf(mutant.cases);
      const [at] = original === undefined ? [] : occurrences(original.text, mutant.from);
      if (original === undefined || suite === undefined || at === undefined) throw new Error(`"${mutant.name}" cannot be applied`);
      const where = `${mutant.file.replace(/^src\//u, "")}:${String(lineOf(original.text, at))}`;
      const counter = `[change ${String(index + 1)}/${String(MUTANTS.length)}]`;
      if (overTime()) {
        rows.push({ mutant, where, verdict: "ERROR" });
        note(`${counter} ${mutant.name}: ERROR, not run: the check's time limit`);
        continue;
      }
      const changed = original.text.slice(0, at) + mutant.to + original.text.slice(at + mutant.from.length);
      const run = await underChange(original, join(WORK, mutant.file), changed,
        () => runCases(`change-${pad(index + 1)}`, suite, mutant.cases));
      const verdict = verdictOf(run);
      rows.push({ mutant, where, verdict });
      note(`${counter} ${mutant.name} (${where}): ${verdict} (${String(run.seconds)} s)`);
      if (verdict !== "KILLED") {
        if (run.fileProblem !== null) note(`    the file: ${run.fileProblem}`);
        for (const outcome of run.cases.filter((each) => each.state !== "assertion")) note(`    ${outcome.state}: ${CASES[outcome.key].title}: ${outcome.detail}`);
      }
    }

    note("");
    note("| # | Result | Change | Where | The rule it breaks | Cases expected red |");
    note("|---|---|---|---|---|---|");
    for (const [index, row] of rows.entries()) {
      const cases = row.mutant.cases.map((key) => CASES[key].title).join("; ");
      note(`| ${String(index + 1)} | ${row.verdict} | ${row.mutant.name} | ${row.where} | ${row.mutant.rule} | ${cases} |`);
    }
    note("");
    for (const proven of PROVEN_ELSEWHERE) note(`Note: ${proven}`);
    const unchanged = SOURCES.every((file) => sha256(readFileSync(join(API_ROOT, file))) === checkoutSha.get(file));
    note(`The checkout's own files: ${unchanged ? "unchanged" : "CHANGED"}. Each change's file came back byte for byte. ${minutes()} min in all.`);
    const killed = rows.filter((row) => row.verdict === "KILLED").length;
    const survived = rows.filter((row) => row.verdict === "SURVIVED").length;
    const errors = rows.filter((row) => row.verdict === "ERROR").length;
    if (killed === MUTANTS.length && unchanged) {
      return finish(true, `${FINAL}: PASSED, ${String(killed)} of ${String(MUTANTS.length)} changes killed, each on an assertion, after the real code passed all ${String(sets.size)} sets of cases`);
    }
    return finish(false, `${FINAL}: FAILED, ${String(killed)} killed, ${String(survived)} survived, ${String(errors)} errors, of ${String(MUTANTS.length)} changes`);
  } catch (error) {
    note(`The check stopped: ${error instanceof Error ? error.message : "an unknown error"}`);
    return finish(false, `${FINAL}: FAILED, the check stopped before it finished`);
  } finally {
    removeWork();
  }
}
