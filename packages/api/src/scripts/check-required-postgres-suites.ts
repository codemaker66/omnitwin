import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

// ---------------------------------------------------------------------------
// The PostgreSQL suites CI's API Vitest step must run, and the check that it did.
//
// Each suite below skips itself (describe.skipIf) when its own
// VENVIEWER_*_TEST_DATABASE_URL is unset, so a database CI never made, or a
// variable it never set, leaves `pnpm test` green with the suite unrun. Until
// 11 November 2026 nineteen of them skipped on every run, the /health/ready
// refusal among them (audit api-schema-db-2). The API step writes Vitest's JSON
// report; this reads it and fails unless every file named here is in the
// report and ran every test it has written (an it.todo is not yet a test).
//
// The list is explicit on purpose. A suite that needs no database is never
// caught by a file-name pattern, and a new database suite joins by being named
// here, with its database created and its variable set in ci.yml.
//
// The platform and event-access suites are not here: their own gates
// (run-platform-postgres-tests.ts, run-event-access-postgres-tests.ts) run them
// first and refuse a skip, and in the API step they skip by design.
// ---------------------------------------------------------------------------

export const REQUIRED_POSTGRES_TEST_FILES = [
  // VENVIEWER_ROUTE_TEST_DATABASE_URL (venviewer_route_atomicity_test)
  "src/__tests__/client-home-postgres.test.ts",
  "src/__tests__/competitor-watch-postgres.test.ts",
  "src/__tests__/crm-postgres.test.ts",
  "src/__tests__/deal-stage-from-proposal-postgres.test.ts",
  "src/__tests__/enquiries-acknowledgement-postgres.test.ts",
  "src/__tests__/enquiry-files-postgres.test.ts",
  "src/__tests__/enquiry-source-migration-postgres.test.ts",
  "src/__tests__/enquiry-summary-draft-postgres.test.ts",
  "src/__tests__/opportunities-postgres.test.ts",
  "src/__tests__/people-book-migration-postgres.test.ts",
  "src/__tests__/preview-sweep-postgres.test.ts",
  "src/__tests__/pricing-desk-postgres.test.ts",
  "src/__tests__/pricing-rules-restore-postgres.test.ts",
  "src/__tests__/proposal-client-page-postgres.test.ts",
  "src/__tests__/proposal-comment-author-migration-postgres.test.ts",
  "src/__tests__/proposal-message-draft-anthropic-postgres.test.ts",
  "src/__tests__/proposal-message-draft-postgres.test.ts",
  "src/__tests__/proposal-send-records-postgres.test.ts",
  "src/__tests__/proposal-sent-version-migration-postgres.test.ts",
  "src/__tests__/proposal-templates-migration-postgres.test.ts",
  "src/__tests__/proposal-templates-postgres.test.ts",
  "src/__tests__/proposals-announcement-isolation-postgres.test.ts",
  "src/__tests__/proposals-client-response-postgres.test.ts",
  "src/__tests__/proposals-desk-postgres.test.ts",
  "src/__tests__/revenue-analytics-authority-postgres.test.ts",
  "src/__tests__/room-layout-timeline-status-postgres.test.ts",
  "src/__tests__/rota-postgres.test.ts",
  "src/__tests__/route-atomicity-postgres.test.ts",
  "src/__tests__/supplier-pass-scope-postgres.test.ts",
  "src/__tests__/supplier-response-notification-postgres.test.ts",
  "src/__tests__/trigram-search-migration-postgres.test.ts",
  "src/__tests__/turnaround-rules-postgres.test.ts",
  "src/__tests__/venue-location-migration-postgres.test.ts",
  // VENVIEWER_INTERNAL_DEMO_TEST_DATABASE_URL (venviewer_internal_demo_review_test)
  "src/__tests__/internal-demo-review-postgres.test.ts",
  // VENVIEWER_TIMING_TEST_DATABASE_URL (venviewer_timing_test)
  "src/__tests__/hallkeeper-timing-postgres.test.ts",
  // VENVIEWER_REQUESTS_TEST_DATABASE_URL (venviewer_lane9_test)
  "src/__tests__/conversation-commands-postgres.test.ts",
  "src/__tests__/conversation-reply-push-postgres.test.ts",
  "src/__tests__/conversations-postgres.test.ts",
  "src/__tests__/crowded-day-postgres.test.ts",
  "src/__tests__/guest-flow-replay-postgres.test.ts",
  "src/__tests__/migrate-before-deploy-postgres.test.ts",
  "src/__tests__/observations-postgres.test.ts",
  "src/__tests__/requests-living-postgres.test.ts",
  "src/__tests__/requests-offline-replay-postgres.test.ts",
  "src/__tests__/requests-postgres.test.ts",
  "src/__tests__/requests-reopen-escalation-postgres.test.ts",
  "src/__tests__/room-delete-writers-postgres.test.ts",
  "src/__tests__/rooms-and-venues-postgres.test.ts",
  // VENVIEWER_SHEET_ACCESS_TEST_DATABASE_URL (venviewer_sheet_access_test)
  "src/__tests__/hallkeeper-long-notes-postgres.test.ts",
  "src/__tests__/protected-premises-postgres.test.ts",
  "src/__tests__/sheet-release-identity-postgres.test.ts",
  // VENVIEWER_FORWARD_BOOK_TEST_DATABASE_URL (venviewer_forward_book_test)
  "src/__tests__/forward-book-postgres.test.ts",
  // VENVIEWER_SUPPLIER_RECORDS_TEST_DATABASE_URL (venviewer_supplier_records_test)
  "src/__tests__/preview-sweep-kept-postgres.test.ts",
  "src/__tests__/supplier-records-kept-postgres.test.ts",
  // VENVIEWER_ENQUIRY_FUNNEL_TEST_DATABASE_URL (venviewer_enquiry_funnel_test)
  "src/__tests__/enquiry-funnel-postgres.test.ts",
  // VENVIEWER_ENQUIRY_FUNNEL_MIGRATION_TEST_DATABASE_URL (venviewer_enquiry_funnel_migration_test)
  "src/__tests__/enquiry-funnel-migration-postgres.test.ts",
  // VENVIEWER_PROGRESS_TEST_DATABASE_URL (venviewer_progress_test)
  "src/__tests__/hallkeeper-progress-postgres.test.ts",
  // VENVIEWER_VENUE_TEAM_TEST_DATABASE_URL (venviewer_venue_team_test)
  "src/__tests__/venue-team-postgres.test.ts",
  // VENVIEWER_PAYMENTS_TEST_DATABASE_URL (venviewer_payments_test, via helpers/payments-db.ts)
  "src/__tests__/contract-signatures-postgres.test.ts",
  "src/__tests__/deposits-postgres.test.ts",
  "src/__tests__/one-event-pain-points-postgres.test.ts",
  "src/__tests__/stripe-test-mode-lock.test.ts",
  "src/__tests__/stripe-webhook-postgres.test.ts",
  // VENVIEWER_PRICING_GUARD_TEST_DATABASE_URL (venviewer_pricing_guard_test)
  "src/__tests__/pricing-public-read-postgres.test.ts",
  // VENVIEWER_WEB_VITALS_TEST_DATABASE_URL (venviewer_web_vitals_test)
  "src/__tests__/web-vitals-postgres.test.ts",
  // The nineteen that skipped on every CI run before 11 November 2026.
  // VENVIEWER_READINESS_TEST_DATABASE_URL (venviewer_readiness_test)
  "src/__tests__/health-readiness-postgres.test.ts",
  // VENVIEWER_PHASE_LAYOUT_TEST_DATABASE_URL (omnitwin_timeline_0060_ci)
  "src/__tests__/phase-layout-snapshot-postgres.test.ts",
  // VENVIEWER_ONBOARDING_TEST_DATABASE_URL (venviewer_onboarding_test)
  "src/__tests__/onboarding-postgres.test.ts",
  // VENVIEWER_INVENTORY_TEST_DATABASE_URL (venviewer_inventory_ci)
  "src/__tests__/inventory-managers-postgres.test.ts",
  "src/__tests__/inventory-reservations-postgres.test.ts",
  "src/__tests__/venue-inventory-postgres.test.ts",
  // VENVIEWER_VISITOR_PLAN_TEST_DATABASE_URL (venviewer_visitor_plan_test)
  "src/__tests__/plan-view-links-postgres.test.ts",
  "src/__tests__/visitor-plan-postgres.test.ts",
  // VENVIEWER_OPS_TEST_DATABASE_URL (venviewer_ops_phase_test)
  "src/__tests__/ops-phase-postgres.test.ts",
  // VENVIEWER_PUSH_TEST_DATABASE_URL (venviewer_push_test)
  "src/__tests__/push-postgres.test.ts",
  // VENVIEWER_TURINI_TEST_DATABASE_URL (venviewer_turini_test)
  "src/__tests__/burgess-turini-migration.test.ts",
  "src/__tests__/four-foot-trestle-migration.test.ts",
  "src/__tests__/furniture-batch-migration.test.ts",
  "src/__tests__/seed-canonical-assets-postgres.test.ts",
  // VENVIEWER_PRICING_WINDOWS_TEST_DATABASE_URL (venviewer_pricing_windows_test)
  "src/__tests__/pricing-windows-migration-postgres.test.ts",
  // VENVIEWER_OPERATING_SETTINGS_TEST_DATABASE_URL (venviewer_operating_settings_test)
  "src/__tests__/venue-operating-settings-postgres.test.ts",
  // VENVIEWER_RECONCILE_TEST_DATABASE_URL (venviewer_reconcile_test)
  "src/__tests__/reconcile-guards-postgres.test.ts",
  // VENVIEWER_S6_TEST_DATABASE_URL (venviewer_s6_test)
  "src/__tests__/room-day-postgres.test.ts",
  "src/__tests__/window-proposals-postgres.test.ts",
] as const;

const apiRoot = resolve(import.meta.dirname, "../..");

/** The part of Vitest's JSON report (Jest's shape) this check reads. */
const VitestJsonReportSchema = z.object({
  testResults: z.array(z.object({
    name: z.string().min(1),
    message: z.string().optional(),
    assertionResults: z.array(z.object({
      status: z.string(),
      fullName: z.string().optional(),
    })),
  })),
});

/** A required suite that did not run every one of its tests, and why. */
export interface SuiteShortfall {
  readonly file: string;
  readonly reason: string;
}

/** A failed test still ran; its verdict belongs to the Vitest step itself. */
const RAN = new Set(["passed", "failed"]);
/**
 * An it.todo is a test not yet written, not one skipped: no database makes it
 * run, and a suite may keep a ledger of them beside the tests it runs
 * (one-event-pain-points-postgres does). A missing database shows instead as
 * skipped tests, through describe.skipIf.
 */
const NOT_YET_WRITTEN = "todo";

function normalizedPath(path: string): string {
  const absolute = resolve(path);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

/**
 * Every required suite that is absent from the report, ran none of its tests,
 * or left any test skipped or pending. Empty when all of them ran in full.
 */
export function requiredSuiteShortfalls(
  report: unknown,
  root: string = apiRoot,
  required: readonly string[] = REQUIRED_POSTGRES_TEST_FILES,
): SuiteShortfall[] {
  const parsed = VitestJsonReportSchema.safeParse(report);
  if (!parsed.success) return [{ file: "(report)", reason: "is not a Vitest JSON report" }];
  const byFile = new Map(parsed.data.testResults.map((result) => [normalizedPath(result.name), result]));
  const shortfalls: SuiteShortfall[] = [];
  for (const file of required) {
    const result = byFile.get(normalizedPath(resolve(root, file)));
    if (result === undefined) {
      shortfalls.push({ file, reason: "is not in the report: renamed, deleted or left out of the run" });
      continue;
    }
    if (result.assertionResults.length === 0) {
      const message = result.message?.trim() ?? "";
      shortfalls.push({ file, reason: message === "" ? "ran no tests" : `ran no tests: ${message}` });
      continue;
    }
    const unrun = result.assertionResults.filter((assertion) =>
      !RAN.has(assertion.status) && assertion.status !== NOT_YET_WRITTEN);
    const first = unrun[0];
    if (first !== undefined) {
      const statuses = [...new Set(unrun.map((assertion) => assertion.status))].join(", ");
      shortfalls.push({ file, reason: `did not run ${String(unrun.length)} of ${String(result.assertionResults.length)} tests `
        + `(${statuses}), the first being "${first.fullName ?? "an unnamed test"}"` });
    } else if (!result.assertionResults.some((assertion) => RAN.has(assertion.status))) {
      shortfalls.push({ file, reason: "ran no tests: every test in it is a todo" });
    }
  }
  return shortfalls;
}

/** Reads the report at `reportPath` and answers the exit code: 0 when every required suite ran. */
export async function checkRequiredPostgresSuites(reportPath: string): Promise<number> {
  let report: unknown;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    const why = error instanceof Error ? error.message : "unreadable";
    process.stderr.write(`No readable Vitest JSON report at ${reportPath} (${why}); nothing shows the required PostgreSQL suites ran.\n`);
    return 1;
  }
  const shortfalls = requiredSuiteShortfalls(report);
  if (shortfalls.length === 0) {
    process.stdout.write(`All ${String(REQUIRED_POSTGRES_TEST_FILES.length)} required PostgreSQL suites ran every test.\n`);
    return 0;
  }
  process.stderr.write(`${String(shortfalls.length)} required PostgreSQL suite(s) did not run in full:\n`);
  for (const shortfall of shortfalls) process.stderr.write(`  ${shortfall.file} ${shortfall.reason}\n`);
  process.stderr.write("Each skips itself when its VENVIEWER_*_TEST_DATABASE_URL is unset: create its database "
    + "and set its variable in the API step of .github/workflows/ci.yml (the list names both).\n");
  return 1;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const reportPath = process.argv[2];
  if (reportPath === undefined) {
    process.stderr.write("Usage: tsx src/scripts/check-required-postgres-suites.ts <vitest-json-report>\n");
    process.exitCode = 2;
  } else {
    void checkRequiredPostgresSuites(resolve(reportPath)).then(
      (code) => { process.exitCode = code; },
      (error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : "The required PostgreSQL suite check failed"}\n`);
        process.exitCode = 1;
      },
    );
  }
}
