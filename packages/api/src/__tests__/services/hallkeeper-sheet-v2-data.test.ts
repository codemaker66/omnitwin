import { describe, it, expect } from "vitest";
import {
  buildSheetApproval,
  parseStoredSnapshotPayload,
} from "../../services/hallkeeper-sheet-v2-data.js";

// ---------------------------------------------------------------------------
// parseStoredSnapshotPayload — pure unit tests
//
// The function parses the `configuration_sheet_snapshots.payload` jsonb
// column into a validated `HallkeeperSheetV2`. Because the payload is
// persisted, schema drift across releases is a real concern:
//
//   - Pre-Phase-4c snapshots lack the required `approval` field.
//     The parser backfills `approval: null` before validation so
//     older rows remain readable.
//   - A corrupt or manually-patched row should return null so the
//     caller falls through to live data rather than rendering garbage.
//
// These tests pin both corners directly, without needing a DB fixture.
// ---------------------------------------------------------------------------

const VALID_PAYLOAD: Record<string, unknown> = {
  config: {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Anderson Wedding Reception",
    guestCount: 120,
    layoutStyle: "dinner-rounds",
  },
  venue: { name: "Trades Hall Glasgow", address: "85 Glassford St", logoUrl: null, timezone: "Europe/London" },
  space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
  timing: null,
  instructions: null,
  phases: [],
  totals: { entries: [], totalRows: 0, totalItems: 0 },
  diagramUrl: null,
  webViewUrl: "https://example.com/hallkeeper/abc",
  generatedAt: "2026-04-15T10:00:00.000Z",
  approval: null,
};

describe("parseStoredSnapshotPayload", () => {
  it("returns the parsed payload for a valid input", () => {
    const result = parseStoredSnapshotPayload(VALID_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result?.config.name).toBe("Anderson Wedding Reception");
    expect(result?.approval).toBeNull();
  });

  it("backfills `approval: null` when the field is missing (pre-4c snapshot)", () => {
    const pre4c = { ...VALID_PAYLOAD };
    delete pre4c["approval"];
    const result = parseStoredSnapshotPayload(pre4c);
    expect(result).not.toBeNull();
    expect(result?.approval).toBeNull();
  });

  it("preserves a populated approval block", () => {
    const approved = {
      ...VALID_PAYLOAD,
      approval: {
        version: 3,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "Catherine Tait",
      },
    };
    const result = parseStoredSnapshotPayload(approved);
    expect(result?.approval?.version).toBe(3);
    expect(result?.approval?.approverName).toBe("Catherine Tait");
  });

  it("returns null for a null input (malformed jsonb read)", () => {
    expect(parseStoredSnapshotPayload(null)).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseStoredSnapshotPayload("not-a-payload")).toBeNull();
    expect(parseStoredSnapshotPayload(42)).toBeNull();
    expect(parseStoredSnapshotPayload(true)).toBeNull();
    expect(parseStoredSnapshotPayload([1, 2, 3])).toBeNull();
  });

  it("returns null when a required field has the wrong type (schema drift)", () => {
    const garbage = { ...VALID_PAYLOAD, phases: "not-an-array" };
    expect(parseStoredSnapshotPayload(garbage)).toBeNull();
  });

  it("returns null when the approval block is structurally invalid", () => {
    const badApproval = {
      ...VALID_PAYLOAD,
      approval: {
        version: 0, // violates min(1)
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "Catherine Tait",
      },
    };
    expect(parseStoredSnapshotPayload(badApproval)).toBeNull();
  });

  it("returns null when approvedAt is not a valid ISO-8601 string", () => {
    const badDate = {
      ...VALID_PAYLOAD,
      approval: {
        version: 1,
        approvedAt: "yesterday afternoon",
        approverName: "Catherine Tait",
      },
    };
    expect(parseStoredSnapshotPayload(badDate)).toBeNull();
  });

  it("returns null when approverName is empty (sheet-approval invariant)", () => {
    const emptyName = {
      ...VALID_PAYLOAD,
      approval: {
        version: 1,
        approvedAt: "2026-04-17T14:30:00.000Z",
        approverName: "",
      },
    };
    expect(parseStoredSnapshotPayload(emptyName)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSheetApproval — pure unit tests for the snap+approver → SheetApproval
// step.
//
// Pinned edge cases (the DB-coupled resolveApproval delegates to this):
//   - approver row exists with displayName → uses displayName
//   - approver row exists WITHOUT displayName → falls back to name
//     (users.name is NOT NULL in schema, so name always resolves)
//   - approver row has been deleted (null) → returns null so the sheet
//     renders without a stale approval stamp
//   - approvedAt (Date) is serialized to ISO-8601 string
// ---------------------------------------------------------------------------

describe("buildSheetApproval", () => {
  const snap = {
    version: 3,
    approvedAt: new Date("2026-04-17T14:30:00.000Z"),
  };

  it("uses displayName when set", () => {
    const approval = buildSheetApproval(snap, {
      name: "catherine.tait@example.com",
      displayName: "Catherine Tait",
    });
    expect(approval).toEqual({
      version: 3,
      approvedAt: "2026-04-17T14:30:00.000Z",
      approverName: "Catherine Tait",
    });
  });

  it("falls back to `name` when displayName is null", () => {
    const approval = buildSheetApproval(snap, {
      name: "Catherine Tait",
      displayName: null,
    });
    expect(approval?.approverName).toBe("Catherine Tait");
  });

  it("returns null when the approver row has been deleted", () => {
    // The DB path returns an empty array → undefined → we normalise
    // to null at the call site. `buildSheetApproval` treats null as
    // "no approver resolvable" and returns null so the sheet renders
    // without a stale approval banner.
    expect(buildSheetApproval(snap, null)).toBeNull();
  });

  it("serialises approvedAt to ISO-8601", () => {
    const approval = buildSheetApproval(
      { version: 1, approvedAt: new Date("2026-06-15T09:05:30.123Z") },
      { name: "Staff User", displayName: null },
    );
    expect(approval?.approvedAt).toBe("2026-06-15T09:05:30.123Z");
  });

  it("passes the version straight through (no off-by-one drift)", () => {
    const approval = buildSheetApproval(
      { version: 42, approvedAt: new Date("2026-04-17T14:30:00.000Z") },
      { name: "Staff User", displayName: null },
    );
    expect(approval?.version).toBe(42);
  });
});
