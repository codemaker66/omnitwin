import { describe, expect, it } from "vitest";
import {
  effectivePassExpiry,
  eventMomentsFrom,
  itemChanges,
  passContact,
  planChangedAfter,
  samePassHolder,
  summarisePass,
} from "../services/supplier-passes.js";

// The pure rules behind supplier passes (A Door for Everyone Outside, stage 1).
// The routes that use them are held against real PostgreSQL in
// supplier-pass-scope-postgres.test.ts.

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-16T09:00:00.000Z");
const EVENT_END = new Date("2026-10-24T23:00:00.000Z");
const PACK_ID = "00000000-0000-4000-8000-000000000a01";
const VENUE_ID = "00000000-0000-4000-8000-000000000a02";
const HANDOFF_ID = "00000000-0000-4000-8000-000000000a03";
const HASH = "a".repeat(64);

describe("the event's day and rooms", () => {
  it("takes the day and rooms from the Diary's bookings, in order, without repeats", () => {
    const moments = eventMomentsFrom(
      { startsAt: new Date("2026-10-24T08:00:00.000Z"), endsAt: null },
      [
        { startsAt: new Date("2026-10-24T13:00:00.000Z"), endsAt: new Date("2026-10-24T18:00:00.000Z"), room: "Saloon" },
        { startsAt: new Date("2026-10-24T17:00:00.000Z"), endsAt: EVENT_END, room: "Grand Hall" },
        { startsAt: new Date("2026-10-24T19:00:00.000Z"), endsAt: new Date("2026-10-24T22:00:00.000Z"), room: "Saloon " },
      ],
    );
    expect(moments.firstAt?.toISOString()).toBe("2026-10-24T13:00:00.000Z");
    expect(moments.lastAt?.toISOString()).toBe(EVENT_END.toISOString());
    expect(moments.rooms).toEqual(["Saloon", "Grand Hall"]);
  });

  it("falls back to the event's own times when no booking names it, and to nothing without them", () => {
    const start = new Date("2026-10-24T17:00:00.000Z");
    expect(eventMomentsFrom({ startsAt: start, endsAt: null }, [])).toEqual({ firstAt: start, lastAt: start, rooms: [] });
    expect(eventMomentsFrom({ startsAt: null, endsAt: null }, [])).toEqual({ firstAt: null, lastAt: null, rooms: [] });
    expect(eventMomentsFrom(null, [])).toEqual({ firstAt: null, lastAt: null, rooms: [] });
  });
});

describe("the stop date that applies", () => {
  it("keeps a stored date, assumes seven days after the event for an older pass, and never invents one", () => {
    const stored = new Date("2026-10-28T00:00:00.000Z");
    expect(effectivePassExpiry(stored, EVENT_END)).toEqual({ expiresAt: stored, assumed: false });
    expect(effectivePassExpiry(null, EVENT_END)).toEqual({ expiresAt: new Date(EVENT_END.getTime() + 7 * DAY_MS), assumed: true });
    expect(effectivePassExpiry(null, null)).toEqual({ expiresAt: null, assumed: false });
  });
});

describe("what changed for a supplier", () => {
  it("names added, removed and changed parts by title", () => {
    const before = [
      { title: "Table centrepieces", detail: "Twelve low arrangements.", arrivalWindow: "07:00-08:00" },
      { title: "Aisle candles", detail: "LED only.", arrivalWindow: null },
      { title: "Load-in", detail: "Side door.", arrivalWindow: null },
    ];
    const after = [
      { title: "Table centrepieces", detail: "Fourteen low arrangements.", arrivalWindow: "07:00-08:00" },
      { title: "Load-in", detail: "Side door.", arrivalWindow: "06:45-07:15" },
      { title: "Top table garland", detail: "Eucalyptus.", arrivalWindow: null },
    ];
    expect(itemChanges(before, after)).toEqual({
      added: ["Top table garland"],
      removed: ["Aisle candles"],
      changed: ["Table centrepieces", "Load-in"],
    });
    expect(itemChanges(after, after)).toEqual({ added: [], removed: [], changed: [] });
  });

  it("matches a holder by the supplier on file, or by the name on the pass when neither has one", () => {
    expect(samePassHolder({ supplierId: "s1", title: "Bloom & Co" }, { supplierId: "s1", title: "Bloom and Co" })).toBe(true);
    expect(samePassHolder({ supplierId: "s1", title: "Bloom & Co" }, { supplierId: "s2", title: "Bloom & Co" })).toBe(false);
    expect(samePassHolder({ supplierId: "s1", title: "Bloom & Co" }, { supplierId: null, title: "Bloom & Co" })).toBe(false);
    expect(samePassHolder({ supplierId: null, title: " Bloom  & co " }, { supplierId: null, title: "Bloom & Co" })).toBe(true);
    expect(samePassHolder({ supplierId: null, title: "Bloom & Co" }, { supplierId: null, title: "Petal & Stem" })).toBe(false);
  });

  it("says the plan changed only when a later plan was compiled", () => {
    const built = new Date("2026-10-15T13:02:00.000Z");
    expect(planChangedAfter(built, null)).toBeNull();
    expect(planChangedAfter(built, { compiledAt: built })).toBeNull();
    const later = new Date("2026-10-15T15:10:00.000Z");
    expect(planChangedAfter(built, { compiledAt: later })).toEqual(later);
  });
});

describe("a contact a supplier can use", () => {
  it("keeps a name and a usable phone, and drops what is blank or malformed", () => {
    expect(passContact(" Kerry Mackay ", " 0141 496 0100 ")).toEqual({ name: "Kerry Mackay", phone: "0141 496 0100" });
    expect(passContact("Kerry Mackay", "")).toEqual({ name: "Kerry Mackay", phone: null });
    expect(passContact("Kerry Mackay", "0".repeat(41))).toEqual({ name: "Kerry Mackay", phone: null });
    expect(passContact("  ", "0141 496 0100")).toBeNull();
    expect(passContact(null, null)).toBeNull();
  });
});

describe("a pass on the staff board", () => {
  type SummaryInput = Parameters<typeof summarisePass>[0];

  function pack(overrides: Partial<SummaryInput["pack"]> = {}): SummaryInput["pack"] {
    return {
      id: PACK_ID,
      venueId: VENUE_ID,
      handoffPackId: HANDOFF_ID,
      eventId: null,
      supplierId: null,
      title: "Bloom & Co",
      contactName: "Sam",
      contactEmail: null,
      contactPhone: null,
      status: "issued",
      sourceSnapshotHash: HASH,
      sourceDigest: HASH,
      sourceLabel: "Approved snapshot v1",
      safeStatus: "supplier_safe_operations_handoff",
      createdBy: null,
      issuedAt: NOW,
      acknowledgedAt: null,
      expiresAt: new Date(EVENT_END.getTime() + 7 * DAY_MS),
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }
  function token(overrides: Partial<SummaryInput["tokens"][number]> = {}): SummaryInput["tokens"][number] {
    return {
      id: "00000000-0000-4000-8000-000000000a04",
      packId: PACK_ID,
      tokenHash: HASH,
      tokenPrefix: "abcdefgh",
      createdBy: null,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
      lastViewedAt: null,
      ...overrides,
    };
  }
  const context = { now: NOW, eventLastMoment: EVENT_END, latestHandoff: null };

  it("is live while issued, unexpired and reachable through an open link", () => {
    const summary = summarisePass({
      pack: pack(), builtFromCompiledAt: NOW, supplierName: "Bloom & Co", items: [], tokens: [token()], acknowledgements: [],
    }, context);
    expect(summary.live).toBe(true);
    expect(summary.link?.expiresAt).toBe(summary.expiresAt);
  });

  it("is not live as a draft, once withdrawn, past its date, or with every link closed", () => {
    const cases = [
      { pack: pack({ status: "draft" }), tokens: [] },
      { pack: pack({ status: "revoked", revokedAt: NOW }), tokens: [token()] },
      { pack: pack({ expiresAt: new Date(NOW.getTime() - 1) }), tokens: [token()] },
      { pack: pack(), tokens: [token({ revokedAt: NOW })] },
      { pack: pack(), tokens: [token({ expiresAt: new Date(NOW.getTime() - 1) })] },
    ];
    for (const entry of cases) {
      expect(summarisePass({
        pack: entry.pack, builtFromCompiledAt: NOW, supplierName: null, items: [], tokens: entry.tokens, acknowledgements: [],
      }, context).live).toBe(false);
    }
  });

  it("reports the newest link, when it was last opened, and the acknowledgements in order", () => {
    const older = token({
      id: "00000000-0000-4000-8000-000000000a05",
      tokenPrefix: "oldlink1",
      createdAt: new Date(NOW.getTime() - DAY_MS),
      revokedAt: NOW,
      lastViewedAt: new Date(NOW.getTime() - 3600_000),
    });
    const newer = token({ tokenPrefix: "newlink1", lastViewedAt: null });
    const summary = summarisePass({
      pack: pack({ status: "acknowledged" }),
      builtFromCompiledAt: NOW,
      supplierName: "Bloom & Co",
      items: [{ title: "Table centrepieces", arrivalWindow: "07:00-08:00" }],
      tokens: [older, newer],
      acknowledgements: [
        { id: "00000000-0000-4000-8000-000000000a07", packId: PACK_ID, shareTokenId: null, status: "acknowledged", acknowledgedByName: "Sam", acknowledgedByEmail: null, note: null, createdAt: new Date(NOW.getTime() + 60_000) },
        { id: "00000000-0000-4000-8000-000000000a06", packId: PACK_ID, shareTokenId: null, status: "needs_clarification", acknowledgedByName: "Sam", acknowledgedByEmail: null, note: "Which door?", createdAt: NOW },
      ],
    }, { ...context, latestHandoff: { compiledAt: new Date(NOW.getTime() + 1) } });
    expect(summary.link?.tokenPrefix).toBe("newlink1");
    expect(summary.openedAt).toBe(new Date(NOW.getTime() - 3600_000).toISOString());
    expect(summary.acknowledgements.map((ack) => ack.status)).toEqual(["needs_clarification", "acknowledged"]);
    expect(summary.planChangedAt).toBe(new Date(NOW.getTime() + 1).toISOString());
    // The board carries the pass, never the link or its hash.
    expect(JSON.stringify(summary)).not.toContain(HASH);
  });

  it("refuses a status the board does not know rather than passing it on", () => {
    expect(() => summarisePass({
      pack: pack({ status: "sent" }), builtFromCompiledAt: NOW, supplierName: null, items: [], tokens: [], acknowledgements: [],
    }, context)).toThrow();
  });
});
