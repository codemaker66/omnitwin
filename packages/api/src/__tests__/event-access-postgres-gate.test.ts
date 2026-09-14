import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_ACCESS_POSTGRES_TEST_FILES,
  assertEventAccessMigrationJournal,
  requireCompleteEventAccessReport,
  requireEventAccessTestDatabaseUrl,
} from "../scripts/run-event-access-postgres-tests.js";

const local = "postgresql://goal15@127.0.0.1:55481/venviewer_goal15_access_test";
const ci = "postgresql://postgres:postgres@127.0.0.1:55477/venviewer_event_access_test";

describe("required event access PostgreSQL gate", () => {
  it("accepts only the dedicated local and CI target tuples", () => {
    expect(requireEventAccessTestDatabaseUrl(local)).toBe(local);
    expect(requireEventAccessTestDatabaseUrl(ci)).toBe(ci);
    for (const target of [undefined, "", " ", "not-a-url", local.replace("postgresql:", "https:"),
      local.replace("127.0.0.1", "localhost"), local.replace("127.0.0.1", "db.example.invalid"),
      local.replace("goal15@", "postgres@"), local.replace("55481", "55477"),
      local.replace("venviewer_goal15_access_test", "venviewer_goal15"),
      ci.replace("venviewer_event_access_test", "venviewer_platform_test"),
      `${local}?options=-csearch_path=public`, `${local}#target`,
    ]) expect(() => requireEventAccessTestDatabaseUrl(target)).toThrow();
  });

  it("requires the complete unchanged migration hash and timestamp sequence", () => {
    const expected = [{ hash: "hash-1", folderMillis: 1 }, { hash: "hash-2", folderMillis: 2 }];
    const applied = [{ hash: "hash-1", created_at: "1" }, { hash: "hash-2", created_at: "2" }];
    expect(() => { assertEventAccessMigrationJournal([], expected, false); }).not.toThrow();
    expect(() => { assertEventAccessMigrationJournal(applied, expected, true); }).not.toThrow();
    for (const rows of [[], applied.slice(0, 1), [...applied, applied[0]], [...applied].reverse(),
      [{ hash: "modified", created_at: "1" }, applied[1]], [{ hash: "hash-1", created_at: "9" }, applied[1]],
    ]) {
      // Entries chosen above exist in this fixed two-row fixture.
      const concrete = rows.filter((row): row is { hash: string; created_at: string } => row !== undefined);
      expect(() => { assertEventAccessMigrationJournal(concrete, expected, true); }).toThrow();
    }
    expect(() => { assertEventAccessMigrationJournal([], [], true); }).toThrow();
  });

  it("rejects skipped, failed, missing, duplicate, wrong-file and inconsistent reports", () => {
    const report = {
      success: true, numFailedTests: 0, numFailedTestSuites: 0,
      numPendingTests: 0, numPendingTestSuites: 0, numTodoTests: 0,
      numPassedTests: EVENT_ACCESS_POSTGRES_TEST_FILES.length, numTotalTests: EVENT_ACCESS_POSTGRES_TEST_FILES.length,
      testResults: EVENT_ACCESS_POSTGRES_TEST_FILES.map(file => ({ name: resolve(file), status: "passed", assertionResults: [{ status: "passed" }] })),
    };
    expect(requireCompleteEventAccessReport(report)).toMatchObject({ passed: EVENT_ACCESS_POSTGRES_TEST_FILES.length, skipped: 0 });
    for (const invalid of [
      {}, { ...report, success: false }, { ...report, numPendingTests: 1 }, { ...report, numFailedTests: 1 },
      { ...report, numTodoTests: 1 }, { ...report, numPassedTests: 0 }, { ...report, testResults: [] },
      { ...report, testResults: [...report.testResults, ...report.testResults] },
      { ...report, numTotalTests: report.numTotalTests + 1 },
      { ...report, testResults: report.testResults.slice(1) },
      { ...report, testResults: [{ ...report.testResults[0], name: resolve("src/__tests__/wrong.test.ts") }] },
      { ...report, testResults: [{ ...report.testResults[0], assertionResults: [{ status: "pending" }] }] },
      { ...report, testResults: [{ ...report.testResults[0], assertionResults: [] }] },
    ]) expect(() => requireCompleteEventAccessReport(invalid)).toThrow();
  });
});
