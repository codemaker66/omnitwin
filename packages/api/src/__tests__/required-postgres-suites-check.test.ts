import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REQUIRED_POSTGRES_TEST_FILES,
  checkRequiredPostgresSuites,
  requiredSuiteShortfalls,
} from "../scripts/check-required-postgres-suites.js";
import { EVENT_ACCESS_POSTGRES_TEST_FILES } from "../scripts/run-event-access-postgres-tests.js";
import { PLATFORM_POSTGRES_TEST_FILES } from "../scripts/run-platform-postgres-tests.js";

const apiRoot = resolve(import.meta.dirname, "../..");
const required: readonly string[] = REQUIRED_POSTGRES_TEST_FILES;

type Status = "passed" | "failed" | "skipped" | "pending" | "todo";

/** One file's entry as Vitest's JSON reporter writes it: an absolute, forward-slash path. */
function fileResult(file: string, statuses: readonly Status[], message = "") {
  return {
    name: resolve(apiRoot, file).replaceAll("\\", "/"),
    status: statuses.includes("failed") || statuses.length === 0 ? "failed" : "passed",
    message,
    assertionResults: statuses.map((status, index) => ({
      status, title: `case ${String(index + 1)}`, fullName: `a suite case ${String(index + 1)}`,
    })),
  };
}

function report(results: readonly ReturnType<typeof fileResult>[]) {
  return { success: true, numTotalTests: results.length, testResults: results };
}

const kept = "src/__tests__/kept-postgres.test.ts";
const renamed = "src/__tests__/renamed-postgres.test.ts";
const broken = "src/__tests__/broken-postgres.test.ts";

describe("the PostgreSQL suites CI's API step must run", () => {
  it("names each suite once, as a test file that exists", async () => {
    expect(new Set(required).size).toBe(required.length);
    for (const file of required) {
      expect(file).toMatch(/^src\/__tests__\/[a-z0-9-]+\.test\.ts$/u);
      await expect(access(resolve(apiRoot, file))).resolves.toBeUndefined();
    }
  });

  it("leaves the platform and event-access suites to the gates that run them", () => {
    const gated = new Set<string>([...PLATFORM_POSTGRES_TEST_FILES, ...EVENT_ACCESS_POSTGRES_TEST_FILES]);
    expect(required.filter((file) => gated.has(file))).toEqual([]);
  });

  it("keeps the /health/ready refusal and the push suites on the list", () => {
    expect(required).toEqual(expect.arrayContaining([
      "src/__tests__/health-readiness-postgres.test.ts",
      "src/__tests__/push-postgres.test.ts",
      "src/__tests__/conversation-reply-push-postgres.test.ts",
    ]));
  });
});

describe("requiredSuiteShortfalls", () => {
  it("passes a report in which every required suite ran, a failing test included", () => {
    expect(requiredSuiteShortfalls(report(required.map((file) => fileResult(file, ["passed", "passed"]))))).toEqual([]);
    // A failed test ran; the Vitest step's own exit code answers for it.
    expect(requiredSuiteShortfalls(report([fileResult(kept, ["passed", "failed"])]), apiRoot, [kept])).toEqual([]);
  });

  it("names a suite that skipped whole or in part, or left a test todo or pending", () => {
    const whole = "src/__tests__/whole-postgres.test.ts";
    const part = "src/__tests__/part-postgres.test.ts";
    const todo = "src/__tests__/todo-postgres.test.ts";
    const pending = "src/__tests__/pending-postgres.test.ts";
    const shortfalls = requiredSuiteShortfalls(report([
      fileResult(whole, ["skipped", "skipped"]), fileResult(part, ["passed", "skipped"]),
      fileResult(todo, ["passed", "todo"]), fileResult(pending, ["pending"]), fileResult(kept, ["passed"]),
    ]), apiRoot, [kept, whole, part, todo, pending]);
    expect(shortfalls.map((shortfall) => shortfall.file)).toEqual([whole, part, todo, pending]);
    expect(shortfalls[0]?.reason).toBe('did not run 2 of 2 tests (skipped), the first being "a suite case 1"');
    expect(shortfalls[1]?.reason).toBe('did not run 1 of 2 tests (skipped), the first being "a suite case 2"');
    expect(shortfalls[2]?.reason).toContain("(todo)");
    expect(shortfalls[3]?.reason).toContain("(pending)");
  });

  it("names a suite missing from the report, and one whose file loaded no tests", () => {
    const guard = "Error: Readiness tests require the explicit disposable database venviewer_readiness_test on 127.0.0.1";
    expect(requiredSuiteShortfalls(report([fileResult(kept, ["passed"]), fileResult(broken, [], guard)]),
      apiRoot, [kept, renamed, broken])).toEqual([
      { file: renamed, reason: "is not in the report: renamed, deleted or left out of the run" },
      { file: broken, reason: `ran no tests: ${guard}` },
    ]);
  });

  it("refuses anything that is not a Vitest JSON report", () => {
    for (const notAReport of [null, "report", {}, { testResults: "none" }, { testResults: [{ name: "", assertionResults: [] }] },
      { testResults: [{ name: "x.test.ts", assertionResults: [{ title: "no status" }] }] }]) {
      expect(requiredSuiteShortfalls(notAReport, apiRoot, [kept])).toEqual([{ file: "(report)", reason: "is not a Vitest JSON report" }]);
    }
  });
});

describe("checkRequiredPostgresSuites", () => {
  let directory: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("answers 0 for a full report, and 1 for a skip or a report that is missing", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    directory = await mkdtemp(join(tmpdir(), "required-postgres-suites-"));
    const full = join(directory, "full.json");
    const skipped = join(directory, "skipped.json");
    await writeFile(full, JSON.stringify(report(required.map((file) => fileResult(file, ["passed"])))));
    await writeFile(skipped, JSON.stringify(report(required.map((file) => fileResult(file,
      file.endsWith("health-readiness-postgres.test.ts") ? ["skipped", "skipped"] : ["passed"])))));

    expect(await checkRequiredPostgresSuites(full)).toBe(0);
    expect(stdout).toHaveBeenCalledWith(`All ${String(required.length)} required PostgreSQL suites ran every test.\n`);

    expect(await checkRequiredPostgresSuites(skipped)).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      '  src/__tests__/health-readiness-postgres.test.ts did not run 2 of 2 tests (skipped), the first being "a suite case 1"\n');

    expect(await checkRequiredPostgresSuites(join(directory, "absent.json"))).toBe(1);
    expect(stderr.mock.calls.some(([text]) => String(text).startsWith(`No readable Vitest JSON report at ${join(directory ?? "", "absent.json")}`))).toBe(true);
  });
});
