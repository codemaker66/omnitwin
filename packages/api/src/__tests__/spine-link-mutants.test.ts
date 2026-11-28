import { describe, expect, it } from "vitest";
import { CHILD_MARK, runSpineLinkMutants } from "./helpers/spine-link-mutants.js";

// ---------------------------------------------------------------------------
// The spine links' mutation check (helpers/spine-link-mutants.ts), run in CI's
// Test job by its API test step, the one step that sets
// VENVIEWER_ROUTE_TEST_DATABASE_URL; the job also holds the disposable
// platform database the check's own runs use. It skips anywhere else, and
// inside the check's own runs. Its lines are printed as they come; the last
// one starts "SPINE LINK MUTANTS:".
// ---------------------------------------------------------------------------

const inTheTestJob = process.env["GITHUB_ACTIONS"] === "true"
  && process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"] !== undefined
  && process.env[CHILD_MARK] === undefined;

describe.skipIf(!inTheTestJob)("the spine links' cases catch each named change of the code", () => {
  it("turns every named change's cases red, each on an assertion, after the real code passes them", { timeout: 170 * 60 * 1000 }, async () => {
    const check = await runSpineLinkMutants((line) => { console.log(line); });
    expect(check.passed, check.finalLine).toBe(true);
  });
});
