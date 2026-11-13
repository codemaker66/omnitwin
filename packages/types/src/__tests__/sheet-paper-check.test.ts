import { describe, expect, it } from "vitest";
import {
  HallkeeperSheetV2Schema,
  SheetPaperCheckQuerySchema,
  SheetPaperCheckResultSchema,
  SheetPaperQrSchema,
  buildSheetPaperCheckUrl,
  describePaperClaim,
  describeSheetCopy,
  formatPaperWallClock,
  paperFingerprint,
  parseSheetPaperLink,
  venueWallClock,
  withPrintedAt,
} from "../index.js";

const SNAPSHOT = "5b8f2c1e-3d4a-4f6b-9c7d-1e2f3a4b5c6d";
const CONFIG = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FINGERPRINT = "0123456789abcdef";

describe("the check link a printed copy carries", () => {
  it("names an issued copy by snapshot, version and fingerprint, and nothing else", () => {
    const url = buildSheetPaperCheckUrl("https://venviewer.com/", {
      kind: "issued", issue: { snapshotId: SNAPSHOT, version: 7, fingerprint: FINGERPRINT },
    });
    expect(url).toBe(`https://venviewer.com/sheet-check?s=${SNAPSHOT}&v=7&h=${FINGERPRINT}`);
  });

  it("names a working copy by its layout only", () => {
    expect(buildSheetPaperCheckUrl("https://venviewer.com", { kind: "working", configId: CONFIG }))
      .toBe(`https://venviewer.com/sheet-check?c=${CONFIG}`);
  });

  it("adds the printed minute, and refuses anything that is not one", () => {
    const base = `https://venviewer.com/sheet-check?c=${CONFIG}`;
    expect(withPrintedAt(base, "2026-10-17T06:02")).toBe(`${base}&p=2026-10-17T06:02`);
    expect(withPrintedAt(base, "06:02<script>")).toBe(base);
  });

  it("carries the first sixteen hex characters of the source hash", () => {
    expect(paperFingerprint(`${FINGERPRINT}${"f".repeat(48)}`)).toBe(FINGERPRINT);
  });
});

describe("reading a scanned link", () => {
  it("round-trips an issued copy and keeps the paper's printed minute as a claim", () => {
    const url = withPrintedAt(buildSheetPaperCheckUrl("https://venviewer.com", {
      kind: "issued", issue: { snapshotId: SNAPSHOT, version: 7, fingerprint: FINGERPRINT },
    }), "2026-10-17T06:02");
    const parsed = parseSheetPaperLink(new URL(url).searchParams);
    expect(parsed).toEqual({
      query: { s: SNAPSHOT, v: 7, h: FINGERPRINT },
      claim: { kind: "issued", version: 7, printed: "2026-10-17T06:02" },
    });
  });

  it("reads a working copy", () => {
    const parsed = parseSheetPaperLink(new URLSearchParams({ c: CONFIG }));
    expect(parsed?.claim).toEqual({ kind: "working", version: null, printed: null });
  });

  it("drops a malformed printed time rather than echoing it", () => {
    const parsed = parseSheetPaperLink(new URLSearchParams({ c: CONFIG, p: "<b>06:02</b>" }));
    expect(parsed?.claim.printed).toBeNull();
  });

  it.each([
    [{}],
    [{ s: SNAPSHOT, v: "7" }],
    [{ s: SNAPSHOT, v: "0", h: FINGERPRINT }],
    [{ s: SNAPSHOT, v: "1e2", h: FINGERPRINT }],
    [{ s: SNAPSHOT, v: "7", h: FINGERPRINT.toUpperCase() }],
    [{ s: "not-a-uuid", v: "7", h: FINGERPRINT }],
    [{ c: "not-a-uuid" }],
  ])("is not a sheet check: %j", (params) => {
    expect(parseSheetPaperLink(new URLSearchParams(params))).toBeNull();
    expect(SheetPaperCheckQuerySchema.safeParse(params).success).toBe(false);
  });
});

describe("the version line in words", () => {
  const timeZone = "Europe/London";

  it("reads 'v7, issued …, printed …' on the venue's clock", () => {
    expect(describeSheetCopy({
      version: 7, issuedAt: "2026-10-16T13:02:00.000Z", printedAt: "2026-10-17T05:02:00.000Z", timeZone,
    })).toBe("v7, issued 16 Oct 14:02, printed 17 Oct 06:02");
  });

  it("calls a copy printed before approval a draft", () => {
    expect(describeSheetCopy({ version: null, issuedAt: null, printedAt: "2026-01-10T06:02:00.000Z", timeZone }))
      .toBe("Draft, printed 10 Jan 06:02");
  });

  it("is pinned to the venue's zone, not the renderer's", () => {
    expect(venueWallClock("2026-10-17T05:02:00.000Z", "Europe/London")).toBe("2026-10-17T06:02");
    expect(venueWallClock("2026-10-17T05:02:00.000Z", "America/New_York")).toBe("2026-10-17T01:02");
    expect(venueWallClock("2026-12-31T23:30:00.000Z", "Europe/London")).toBe("2026-12-31T23:30");
    expect(venueWallClock("not a date", timeZone)).toBeNull();
    expect(venueWallClock("2026-10-17T05:02:00.000Z", "Not/AZone")).toBeNull();
  });

  it("formats a wall-clock minute without a zone conversion", () => {
    expect(formatPaperWallClock("2026-10-17T06:02")).toBe("17 Oct 06:02");
    expect(formatPaperWallClock("2026-13-17T06:02")).toBeNull();
  });

  it("repeats the paper's own claim for the offline answer", () => {
    expect(describePaperClaim({ kind: "issued", version: 7, printed: "2026-10-17T06:02" }))
      .toBe("Your copy is v7, printed 17 Oct 06:02.");
    expect(describePaperClaim({ kind: "issued", version: 7, printed: null })).toBe("Your copy is v7.");
    expect(describePaperClaim({ kind: "working", version: null, printed: "2026-10-17T06:02" }))
      .toBe("Your copy is a draft, printed 17 Oct 06:02.");
  });
});

describe("the answer carries version state only", () => {
  it.each([
    { state: "current", version: 7 },
    { state: "superseded", currentVersion: 9 },
    { state: "not_approved" },
    { state: "retired" },
    { state: "unknown" },
  ])("accepts %j", (result) => {
    expect(SheetPaperCheckResultSchema.parse(result)).toEqual(result);
  });

  it("strips anything else a server might add", () => {
    const parsed = SheetPaperCheckResultSchema.parse({ state: "current", version: 7, eventName: "Smith wedding" });
    expect(parsed).toEqual({ state: "current", version: 7 });
  });
});

describe("the sheet payload's paper check", () => {
  it("rejects a QR that is not square", () => {
    expect(SheetPaperQrSchema.safeParse({ size: 21, rows: ["1".repeat(21)] }).success).toBe(false);
  });

  it("is optional, so frozen snapshots without it stay valid", () => {
    const base = {
      config: { id: CONFIG, name: "Plan", guestCount: 10, layoutStyle: "custom" },
      venue: { name: "Venue", address: "Address" },
      space: { name: "Room", widthM: 10, lengthM: 10, heightM: 3 },
      timing: null, instructions: null, phases: [],
      totals: { entries: [], totalRows: 0, totalItems: 0 },
      diagramUrl: null, webViewUrl: "https://venviewer.com/hallkeeper/x",
      generatedAt: "2026-10-17T05:02:00.000Z", approval: null,
    };
    expect(HallkeeperSheetV2Schema.safeParse(base).success).toBe(true);
    const qr = { size: 21, rows: Array.from({ length: 21 }, () => "01".repeat(10) + "1") };
    expect(HallkeeperSheetV2Schema.parse({ ...base, paperCheck: { url: `https://venviewer.com/sheet-check?c=${CONFIG}`, qr } }).paperCheck?.qr.size)
      .toBe(21);
  });
});
