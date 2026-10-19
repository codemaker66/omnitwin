import { describe, expect, it } from "vitest";
import {
  CreateSupplierAcknowledgementInputSchema,
  CreateSupplierCoordinationPackInputSchema,
  GenerateSupplierCoordinationShareTokenInputSchema,
  SupplierCoordinationPackSchema,
  SupplierPassBoardSchema,
  SupplierPassDetailsSchema,
  SupplierPassSummarySchema,
  SupplierSafePackViewSchema,
  checkSupplierPassExpiry,
  defaultSupplierPassExpiry,
  latestSupplierPassExpiry,
  supplierCoordinationPayloadDigest,
  type SupplierCoordinationPack,
} from "../supplier-coordination.js";

const NOW = "2026-06-15T09:00:00.000Z";
const PACK_ID = "00000000-0000-4000-8000-000000000501";
const VENUE_ID = "00000000-0000-4000-8000-000000000502";
const HANDOFF_PACK_ID = "00000000-0000-4000-8000-000000000503";
const EVENT_ID = "00000000-0000-4000-8000-000000000504";
const SUPPLIER_ID = "00000000-0000-4000-8000-000000000505";
const INSTRUCTION_ID = "00000000-0000-4000-8000-000000000506";
const HASH = "f".repeat(64);

function packFixture(): SupplierCoordinationPack {
  return SupplierCoordinationPackSchema.parse({
    id: PACK_ID,
    venueId: VENUE_ID,
    handoffPackId: HANDOFF_PACK_ID,
    eventId: EVENT_ID,
    supplierId: SUPPLIER_ID,
    title: "Technical supplier coordination pack",
    contactName: "Sam Supplier",
    contactEmail: "sam@example.com",
    contactPhone: "+44 141 555 0100",
    status: "issued",
    sourceSnapshotHash: HASH,
    sourceDigest: HASH,
    sourceLabel: "Approved configuration snapshot v3",
    safeStatus: "supplier_safe_operations_handoff",
    createdBy: null,
    issuedAt: NOW,
    acknowledgedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("supplier coordination contracts", () => {
  it("parses a supplier-safe coordination pack", () => {
    const parsed = SupplierCoordinationPackSchema.parse(packFixture());
    expect(parsed.status).toBe("issued");
    expect(parsed.safeStatus).toBe("supplier_safe_operations_handoff");
  });

  it("rejects duplicate selected supplier instructions", () => {
    const result = CreateSupplierCoordinationPackInputSchema.safeParse({
      handoffPackId: HANDOFF_PACK_ID,
      supplierInstructionIds: [INSTRUCTION_ID, INSTRUCTION_ID],
    });
    expect(result.success).toBe(false);
  });

  it("blocks unsafe public or supplier-facing wording", () => {
    expect(CreateSupplierCoordinationPackInputSchema.safeParse({
      handoffPackId: HANDOFF_PACK_ID,
      supplierInstructionIds: [INSTRUCTION_ID],
      title: "Certified safe load-in pack",
    }).success).toBe(false);

    expect(CreateSupplierAcknowledgementInputSchema.safeParse({
      acknowledgedByName: "Sam Supplier",
      note: "This confirms it is legally compliant.",
    }).success).toBe(false);
  });

  it("requires supplier acknowledgement identity", () => {
    expect(CreateSupplierAcknowledgementInputSchema.safeParse({
      note: "Received with one timing question.",
    }).success).toBe(false);
    expect(CreateSupplierAcknowledgementInputSchema.safeParse({
      acknowledgedByEmail: "ops@example.com",
      note: "Received with one timing question.",
    }).success).toBe(true);
  });

  it("keeps public supplier views smaller than internal packs", () => {
    const publicView = SupplierSafePackViewSchema.parse({
      title: "Technical supplier coordination pack",
      venueName: "Trades Hall",
      supplierName: "Technical Supplier",
      contactName: "Sam Supplier",
      contactEmail: "sam@example.com",
      contactPhone: null,
      status: "issued",
      safeStatus: "supplier_safe_operations_handoff",
      issuedAt: NOW,
      expiresAt: null,
      source: {
        sourceLabel: "Approved configuration snapshot v3",
        handoffVersion: 3,
        compiledAt: NOW,
        snapshotHashPrefix: HASH.slice(0, 12),
        sourceDigest: HASH,
      },
      changesSincePreviousHandoff: {
        summary: "No previous approved snapshot is available for comparison.",
        addedCount: 0,
        removedCount: 0,
        changedCount: 0,
      },
      items: [{
        title: "Technical supplier handoff",
        detail: "Confirm delivery, setup order, and removal timing against the handoff pack.",
        kind: "requirement",
        arrivalWindow: "08:00-10:00",
        sourceRef: "snapshot.totals",
        sortOrder: 0,
      }],
      acknowledgements: [],
      supplierNotice: "Supplier-facing planning handoff from approved venue operations data. Confirm details with the venue team before arrival.",
    });

    expect(publicView.source.snapshotHashPrefix).toHaveLength(12);
    expect(SupplierSafePackViewSchema.safeParse({
      ...publicView,
      createdBy: "00000000-0000-4000-8000-000000000507",
    }).success).toBe(false);
  });

  it("produces deterministic supplier pack digests", () => {
    const left = supplierCoordinationPayloadDigest({
      handoffPackId: HANDOFF_PACK_ID,
      sourceSnapshotHash: HASH,
      supplierInstructionIds: [INSTRUCTION_ID],
      itemTitles: ["Technical supplier handoff"],
      itemDetails: ["Confirm delivery."],
    });
    const right = supplierCoordinationPayloadDigest({
      itemDetails: ["Confirm delivery."],
      itemTitles: ["Technical supplier handoff"],
      supplierInstructionIds: [INSTRUCTION_ID],
      sourceSnapshotHash: HASH,
      handoffPackId: HANDOFF_PACK_ID,
    });

    expect(left).toMatch(/^[a-f0-9]{64}$/u);
    expect(right).toBe(left);
  });
});

describe("supplier pass stop dates", () => {
  const EVENT_END = new Date("2026-10-24T23:00:00.000Z");
  const NOW_DATE = new Date("2026-10-16T09:00:00.000Z");

  it("defaults to seven days after the event, and to nothing while the event has no date", () => {
    expect(defaultSupplierPassExpiry(EVENT_END)?.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(defaultSupplierPassExpiry(null)).toBeNull();
  });

  it("allows thirty days after the event at most, or thirty days from now without a date", () => {
    expect(latestSupplierPassExpiry(EVENT_END, NOW_DATE).toISOString()).toBe("2026-11-23T23:00:00.000Z");
    expect(latestSupplierPassExpiry(null, NOW_DATE).toISOString()).toBe("2026-11-15T09:00:00.000Z");
  });

  it("refuses a missing, past or too-late stop date and accepts one inside the window", () => {
    expect(checkSupplierPassExpiry(null, EVENT_END, NOW_DATE)).toBe("missing");
    expect(checkSupplierPassExpiry(new Date("not a date"), EVENT_END, NOW_DATE)).toBe("missing");
    expect(checkSupplierPassExpiry(NOW_DATE, EVENT_END, NOW_DATE)).toBe("past");
    expect(checkSupplierPassExpiry(new Date("2026-11-24T00:00:00.000Z"), EVENT_END, NOW_DATE)).toBe("too_late");
    expect(checkSupplierPassExpiry(new Date("2026-10-31T23:00:00.000Z"), EVENT_END, NOW_DATE)).toBe("ok");
  });
});

describe("supplier pass contracts", () => {
  it("accepts a fresh pass that replaces an earlier one, and nothing else on the link request", () => {
    expect(GenerateSupplierCoordinationShareTokenInputSchema.safeParse({ supersedesPackId: PACK_ID }).success).toBe(true);
    expect(GenerateSupplierCoordinationShareTokenInputSchema.safeParse({ supersedesPackId: "not-a-pack" }).success).toBe(false);
    expect(GenerateSupplierCoordinationShareTokenInputSchema.safeParse({ token: "chosen-by-client" }).success).toBe(false);
  });

  it("carries the plain words of the supplier page without system fields", () => {
    const details = SupplierPassDetailsSchema.parse({
      addressedTo: "Sam",
      eventStartsAt: NOW,
      eventEndsAt: null,
      rooms: ["Grand Hall"],
      venueAddress: "85 Glassford Street, Glasgow",
      venueTimeZone: "Europe/London",
      updatedAt: NOW,
      planChangedAt: null,
      changesForYou: { since: NOW, added: ["Aisle candles"], removed: [], changed: ["Table centrepieces"] },
      venueContact: { name: "Kerry Mackay", phone: null },
    });
    expect(details.rooms).toEqual(["Grand Hall"]);
    expect(SupplierPassDetailsSchema.safeParse({ ...details, tokenHash: HASH }).success).toBe(false);
  });

  it("describes a pass on the staff board with its stop date and who has read it", () => {
    const summary = SupplierPassSummarySchema.parse({
      id: PACK_ID,
      title: "Bloom & Co",
      supplierId: SUPPLIER_ID,
      supplierName: "Bloom & Co",
      contactName: "Sam",
      contactEmail: null,
      contactPhone: null,
      status: "acknowledged",
      live: true,
      createdAt: NOW,
      issuedAt: NOW,
      expiresAt: "2026-10-31T23:00:00.000Z",
      expiryAssumed: false,
      revokedAt: null,
      builtFromCompiledAt: NOW,
      planChangedAt: null,
      madeBy: { name: "Kerry Mackay", phone: "0141 496 0100" },
      items: [{ title: "Table centrepieces", arrivalWindow: "07:00-08:00" }],
      link: { tokenPrefix: "abcdefgh", createdAt: NOW, expiresAt: "2026-10-31T23:00:00.000Z", revokedAt: null, lastViewedAt: NOW },
      openedAt: NOW,
      acknowledgements: [{ status: "acknowledged", acknowledgedByName: "Sam", note: null, createdAt: NOW }],
    });
    expect(summary.live).toBe(true);
    // The board never carries a token or its hash.
    expect(SupplierPassSummarySchema.safeParse({ ...summary, tokenHash: HASH }).success).toBe(false);
    expect(SupplierPassBoardSchema.safeParse({
      eventId: EVENT_ID,
      venueName: "Trades Hall Glasgow",
      venueAddress: null,
      venueTimeZone: "Europe/London",
      eventStartsAt: NOW,
      eventLastMomentAt: NOW,
      rooms: [],
      defaultExpiresAt: null,
      latestExpiresAt: NOW,
      canIssue: false,
      handoff: null,
      issuer: null,
      scope: [],
      suppliers: [],
      passes: [summary],
    }).success).toBe(true);
  });
});
