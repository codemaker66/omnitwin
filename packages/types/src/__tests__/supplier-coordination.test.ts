import { describe, expect, it } from "vitest";
import {
  CreateSupplierAcknowledgementInputSchema,
  CreateSupplierCoordinationPackInputSchema,
  SupplierCoordinationPackSchema,
  SupplierSafePackViewSchema,
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
