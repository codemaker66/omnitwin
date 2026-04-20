import { describe, it, expect } from "vitest";
import {
  computeSnapshotsToKeep,
  isUniqueViolation,
  SnapshotConflictError,
} from "../../services/sheet-snapshot.js";

// ---------------------------------------------------------------------------
// sheet-snapshot — pure predicate + error-shape tests
//
// Covers:
//   1. `isUniqueViolation(err)` — duck-type check for Postgres 23505.
//      The DB-coupled `createSnapshot` path relies on this to convert
//      concurrent-submit races into a structured 409 instead of a 500
//      that leaks the constraint name.
//   2. `SnapshotConflictError` — public shape of the error surfaced
//      from `createSnapshot` when the unique-constraint race fires.
// ---------------------------------------------------------------------------

describe("isUniqueViolation", () => {
  it("returns true for a pg-shaped 23505 error", () => {
    const err = new Error("duplicate key value violates unique constraint");
    (err as Error & { code: string }).code = "23505";
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("returns true for a plain object with code=23505 (driver-agnostic)", () => {
    expect(isUniqueViolation({ code: "23505", message: "duplicate key" })).toBe(true);
  });

  it("returns false for a non-unique pg error (e.g., foreign-key 23503)", () => {
    const err = Object.assign(new Error("fk violation"), { code: "23503" });
    expect(isUniqueViolation(err)).toBe(false);
  });

  it("returns false for an error without a code field", () => {
    expect(isUniqueViolation(new Error("generic"))).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("returns false for primitive values (string, number, boolean)", () => {
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(23505)).toBe(false);
    expect(isUniqueViolation(true)).toBe(false);
  });

  it("returns false when code is a number 23505 (Postgres emits strings)", () => {
    // Some adapters stringify — some don't. We pin the string-only
    // contract so a driver that starts emitting numeric codes forces
    // us to update the predicate deliberately rather than silently
    // passing through. If this assertion flips, audit the upstream
    // driver and update PG_UNIQUE_VIOLATION accordingly.
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Retention policy — `computeSnapshotsToKeep`
//
// Rules under test:
//   1. Keep the N most recent by version (any approval status).
//   2. Additionally keep the latest approved — even if older than N.
//   3. Below-N row counts produce no deletions.
//   4. Empty row set → empty keep set (no throw).
//   5. keep < 1 throws (operator config error).
// ---------------------------------------------------------------------------

describe("computeSnapshotsToKeep", () => {
  const approvedAt = new Date("2026-04-17T14:00:00.000Z");

  it("returns an empty set for an empty input", () => {
    expect(computeSnapshotsToKeep([], 3).size).toBe(0);
  });

  it("keeps all rows when count ≤ N", () => {
    const rows = [
      { id: "s1", version: 1, approvedAt: null },
      { id: "s2", version: 2, approvedAt: null },
    ];
    const kept = computeSnapshotsToKeep(rows, 3);
    expect(kept.size).toBe(2);
    expect(kept.has("s1")).toBe(true);
    expect(kept.has("s2")).toBe(true);
  });

  it("keeps only the N most recent when count > N and no approvals exist", () => {
    const rows = [
      { id: "s1", version: 1, approvedAt: null },
      { id: "s2", version: 2, approvedAt: null },
      { id: "s3", version: 3, approvedAt: null },
      { id: "s4", version: 4, approvedAt: null },
      { id: "s5", version: 5, approvedAt: null },
    ];
    const kept = computeSnapshotsToKeep(rows, 3);
    expect(kept.size).toBe(3);
    expect(kept.has("s5")).toBe(true);
    expect(kept.has("s4")).toBe(true);
    expect(kept.has("s3")).toBe(true);
    expect(kept.has("s2")).toBe(false);
    expect(kept.has("s1")).toBe(false);
  });

  it("additionally keeps the latest approved even when older than the N-recent window", () => {
    // v1 approved (audit anchor), v2-v5 all drafts. With keep=3 the
    // recency window is v3/v4/v5 — but v1 must survive the prune
    // because it's the only approved row.
    const rows = [
      { id: "s1", version: 1, approvedAt },
      { id: "s2", version: 2, approvedAt: null },
      { id: "s3", version: 3, approvedAt: null },
      { id: "s4", version: 4, approvedAt: null },
      { id: "s5", version: 5, approvedAt: null },
    ];
    const kept = computeSnapshotsToKeep(rows, 3);
    expect(kept.size).toBe(4);
    expect(kept.has("s1")).toBe(true);
    expect(kept.has("s3")).toBe(true);
    expect(kept.has("s4")).toBe(true);
    expect(kept.has("s5")).toBe(true);
    expect(kept.has("s2")).toBe(false);
  });

  it("does not double-count when the latest approved is already in the N-recent window", () => {
    const rows = [
      { id: "s1", version: 1, approvedAt: null },
      { id: "s2", version: 2, approvedAt: null },
      { id: "s3", version: 3, approvedAt }, // approved AND in top-3
      { id: "s4", version: 4, approvedAt: null },
      { id: "s5", version: 5, approvedAt: null },
    ];
    const kept = computeSnapshotsToKeep(rows, 3);
    expect(kept.size).toBe(3);
    expect(kept.has("s5")).toBe(true);
    expect(kept.has("s4")).toBe(true);
    expect(kept.has("s3")).toBe(true);
  });

  it("picks the LATEST approved (by version) when multiple exist", () => {
    // Multi-approval scenario: v1 and v3 both approved. v3 is the
    // operational anchor today; v1 is historical.
    const rows = [
      { id: "s1", version: 1, approvedAt },
      { id: "s2", version: 2, approvedAt: null },
      { id: "s3", version: 3, approvedAt },
      { id: "s4", version: 4, approvedAt: null },
      { id: "s5", version: 5, approvedAt: null },
    ];
    const kept = computeSnapshotsToKeep(rows, 3);
    // Top-3 = s5, s4, s3. s3 IS the latest approved so it's in the
    // window; s1 (older approved) gets pruned.
    expect(kept.size).toBe(3);
    expect(kept.has("s3")).toBe(true);
    expect(kept.has("s1")).toBe(false);
  });

  it("throws when keep is below 1 (operator config error)", () => {
    expect(() => computeSnapshotsToKeep([], 0)).toThrow();
    expect(() => computeSnapshotsToKeep([], -1)).toThrow();
  });

  it("handles unsorted input correctly (version ordering is internal)", () => {
    const rows = [
      { id: "s3", version: 3, approvedAt: null },
      { id: "s1", version: 1, approvedAt },
      { id: "s5", version: 5, approvedAt: null },
      { id: "s2", version: 2, approvedAt: null },
      { id: "s4", version: 4, approvedAt: null },
    ];
    const kept = computeSnapshotsToKeep(rows, 2);
    expect(kept.size).toBe(3); // s5, s4 (recency) + s1 (approved anchor)
    expect(kept.has("s5")).toBe(true);
    expect(kept.has("s4")).toBe(true);
    expect(kept.has("s1")).toBe(true);
  });
});

describe("SnapshotConflictError", () => {
  it("carries the configId for structured logging", () => {
    const err = new SnapshotConflictError("cfg-abc");
    expect(err.configId).toBe("cfg-abc");
    expect(err.name).toBe("SnapshotConflictError");
  });

  it("has a stable `code` that route handlers can map to HTTP 409", () => {
    const err = new SnapshotConflictError("cfg-abc");
    expect(err.code).toBe("SNAPSHOT_CONFLICT");
  });

  it("instanceof check works (the catch-branch relies on it)", () => {
    const err = new SnapshotConflictError("cfg-abc");
    expect(err).toBeInstanceOf(SnapshotConflictError);
    expect(err).toBeInstanceOf(Error);
  });
});
