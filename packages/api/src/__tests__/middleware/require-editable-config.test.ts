import { describe, it, expect } from "vitest";
import { checkConfigEditable } from "../../middleware/require-editable-config.js";
import type { Database } from "../../db/client.js";

// ---------------------------------------------------------------------------
// `checkConfigEditable` — the fail-closed post-validation helper
//
// Contract under test:
//   1. Admin role bypasses without a DB round-trip.
//   2. DB error → { ok: false, status: 503, code: CONFIG_LOCK_UNAVAILABLE }.
//   3. Unknown config (row undefined) → { ok: true } so the route's own
//      404 path handles it.
//   4. Planner-editable states (draft / changes_requested / rejected)
//      → { ok: true }.
//   5. Locked states (submitted / under_review / approved / etc.)
//      → { ok: false, status: 409, code: CONFIG_LOCKED, reviewStatus }.
// ---------------------------------------------------------------------------

/**
 * Build a fake Database that only implements the shape the helper
 * uses: `db.select(...).from(...).where(...).limit(...)` returning
 * an array. The shape is cast via `unknown` — we don't teach
 * TypeScript the full Drizzle query builder for a test stub.
 */
function fakeDb(behavior: "error" | "not-found" | { reviewStatus: string }): Database {
  // eslint-disable-next-line @typescript-eslint/require-await -- thenable shape required by Drizzle query chain
  const limit = async (): Promise<{ reviewStatus: string }[]> => {
    if (behavior === "error") throw new Error("simulated DB outage");
    if (behavior === "not-found") return [];
    return [behavior];
  };
  const where = (): { limit: typeof limit } => ({ limit });
  const from = (): { where: typeof where } => ({ where });
  const select = (): { from: typeof from } => ({ from });
  return { select } as unknown as Database;
}

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";

describe("checkConfigEditable — fail-closed gate", () => {
  it("admin bypasses without a DB round-trip", async () => {
    // `fakeDb("error")` would throw — but admin short-circuits
    // before the DB call, so the error never fires. Proves the
    // admin branch is genuinely pre-DB.
    const result = await checkConfigEditable(fakeDb("error"), CONFIG_ID, "admin");
    expect(result).toEqual({ ok: true });
  });

  it("returns 503 CONFIG_LOCK_UNAVAILABLE on DB error (non-admin)", async () => {
    const result = await checkConfigEditable(fakeDb("error"), CONFIG_ID, "planner");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.status).toBe(503);
    expect(result.code).toBe("CONFIG_LOCK_UNAVAILABLE");
  });

  it("returns { ok: true } when config row is absent (404 path delegated to route)", async () => {
    const result = await checkConfigEditable(fakeDb("not-found"), CONFIG_ID, "planner");
    expect(result).toEqual({ ok: true });
  });

  it("allows draft state", async () => {
    const result = await checkConfigEditable(fakeDb({ reviewStatus: "draft" }), CONFIG_ID, "planner");
    expect(result).toEqual({ ok: true });
  });

  it("allows changes_requested state (re-submit path)", async () => {
    const result = await checkConfigEditable(
      fakeDb({ reviewStatus: "changes_requested" }),
      CONFIG_ID,
      "planner",
    );
    expect(result).toEqual({ ok: true });
  });

  it("allows rejected state (revise and re-submit)", async () => {
    const result = await checkConfigEditable(
      fakeDb({ reviewStatus: "rejected" }),
      CONFIG_ID,
      "planner",
    );
    expect(result).toEqual({ ok: true });
  });

  it("blocks submitted with 409 CONFIG_LOCKED", async () => {
    const result = await checkConfigEditable(
      fakeDb({ reviewStatus: "submitted" }),
      CONFIG_ID,
      "planner",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.status).toBe(409);
    expect(result.code).toBe("CONFIG_LOCKED");
    expect(result.reviewStatus).toBe("submitted");
  });

  it("blocks under_review with 409", async () => {
    const result = await checkConfigEditable(
      fakeDb({ reviewStatus: "under_review" }),
      CONFIG_ID,
      "planner",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.status).toBe(409);
  });

  it("blocks approved with 409", async () => {
    const result = await checkConfigEditable(
      fakeDb({ reviewStatus: "approved" }),
      CONFIG_ID,
      "planner",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.status).toBe(409);
  });

  it("admin can edit even a locked (approved) config", async () => {
    const result = await checkConfigEditable(
      fakeDb({ reviewStatus: "approved" }),
      CONFIG_ID,
      "admin",
    );
    expect(result).toEqual({ ok: true });
  });
});
