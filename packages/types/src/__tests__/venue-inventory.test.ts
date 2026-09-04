import { describe, expect, it } from "vitest";
import {
  InventoryStockSchema,
  InventoryCommitmentSchema,
  InventoryAdjustmentReceiptSchema,
  addInventoryQuantities,
  canAdjustVenueInventory,
  type InventoryStock,
  type InventoryCommitment,
  type InventoryAdjustmentCommand,
} from "../venue-inventory.js";
import { evaluateInventoryAvailability } from "../venue-inventory-availability.js";
import { applyInventoryAdjustment } from "../venue-inventory-adjustment.js";

const VENUE = "00000000-0000-4000-8000-000000000001";
const ASSET = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";
const OTHER = "00000000-0000-4000-8000-000000000004";
const COMMAND = "00000000-0000-4000-8000-000000000005";
const EVENT = "00000000-0000-4000-8000-000000000006";
const NOW = "2026-09-04T10:00:00.000Z";
const LATER = "2026-09-04T10:01:00.000Z";
const WINDOW = { startsAt: "2026-09-07T10:00:00Z", endsAt: "2026-09-07T14:00:00Z" };
const ADMIN = { userId: USER, venueId: VENUE, role: "admin" };
// This is an argument-limit correctness fixture, not a five-second performance
// promise. Shared CI/workstation contention must not change its assertion.
const LARGE_SCHEDULE_TEST_TIMEOUT_MS = 30_000;

function stock(overrides: Partial<InventoryStock> = {}): InventoryStock {
  return {
    venueId: VENUE, assetDefinitionId: ASSET, revision: 0, ownedQuantity: 200,
    damagedQuantity: 0, unavailableQuantity: 0, hires: [], status: "active",
    storageLocation: "Basement store", effectiveAt: NOW, ...overrides,
  };
}

function commitment(overrides: Partial<InventoryCommitment> = {}): InventoryCommitment {
  return { id: OTHER, venueId: VENUE, assetDefinitionId: ASSET, eventId: EVENT,
    quantity: 190, status: "reserved", ...WINDOW, ...overrides };
}

function command(overrides: Partial<InventoryAdjustmentCommand> = {}): InventoryAdjustmentCommand {
  return {
    commandId: COMMAND, venueId: VENUE, assetDefinitionId: ASSET, expectedRevision: 0,
    reason: "Twenty chairs damaged during inspection", ownedQuantity: 200,
    damagedQuantity: 20, unavailableQuantity: 0, hires: [], status: "active",
    storageLocation: "Basement store", ...overrides,
  };
}

describe("venue inventory contracts", () => {
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])("rejects invalid owned count %s", (quantity) => {
    expect(InventoryStockSchema.safeParse(stock({ ownedQuantity: quantity })).success).toBe(false);
  });
  it("accepts zero and rejects overlapping unavailable classifications", () => {
    expect(InventoryStockSchema.parse(stock({ ownedQuantity: 0 })).ownedQuantity).toBe(0);
    expect(InventoryStockSchema.safeParse(stock({ damagedQuantity: 120, unavailableQuantity: 100 })).success).toBe(false);
  });
  it("rejects duplicate hires and invalid quantities in every input family", () => {
    const hire = { id: COMMAND, quantity: 10, ...WINDOW };
    expect(InventoryStockSchema.safeParse(stock({ hires: [hire, hire] })).success).toBe(false);
    expect(InventoryStockSchema.safeParse(stock({ hires: [{ ...hire, quantity: -1 }] })).success).toBe(false);
    expect(InventoryCommitmentSchema.safeParse(commitment({ quantity: 0.5 })).success).toBe(false);
    expect(() => addInventoryQuantities(-1, 1)).toThrow();
    expect(() => addInventoryQuantities(0.5, 0.5)).toThrow();
    expect(() => addInventoryQuantities(1, Infinity)).toThrow();
    expect(addInventoryQuantities(0, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("rejects invalid, empty and backwards commitment windows", () => {
    for (const endsAt of [WINDOW.startsAt, "2026-09-07T09:00:00Z", "not a time"]) {
      expect(InventoryCommitmentSchema.safeParse(commitment({ endsAt })).success).toBe(false);
    }
  });
  it("grants only the same venue's admin, including after role revocation", () => {
    expect(canAdjustVenueInventory(ADMIN, VENUE)).toBe(true);
    for (const role of ["staff", "hallkeeper", "planner", "client", "platform_admin"]) {
      expect(canAdjustVenueInventory({ ...ADMIN, role }, VENUE)).toBe(false);
    }
    expect(canAdjustVenueInventory({ ...ADMIN, venueId: OTHER }, VENUE)).toBe(false);
  });
});

describe("inventory availability over actual occupied windows", () => {
  it("exposes a ten-chair shortage and the affected event without clamping physical stock", () => {
    const result = evaluateInventoryAvailability(stock({ damagedQuantity: 20 }), [commitment()], WINDOW);
    expect(result.minimumRemainingQuantity).toBe(-10);
    expect(result.maximumShortageQuantity).toBe(10);
    expect(result.segments[0]).toMatchObject({ ownedQuantity: 200, usableQuantity: 180, reservedQuantity: 190,
      remainingQuantity: -10, shortageQuantity: 10, eventIds: [EVENT] });
  });
  it("does not add non-simultaneous reservations or double-count touching endpoints", () => {
    const reservations = [commitment({ endsAt: "2026-09-07T12:00:00Z" }),
      commitment({ id: COMMAND, startsAt: "2026-09-07T12:00:00Z" })];
    const result = evaluateInventoryAvailability(stock(), reservations, WINDOW);
    expect(result.minimumRemainingQuantity).toBe(10);
    expect(result.segments).toHaveLength(2);
  });
  it("accounts for hired stock only within its validity window", () => {
    const result = evaluateInventoryAvailability(stock({ damagedQuantity: 20, hires: [{ id: COMMAND,
      quantity: 15, startsAt: WINDOW.startsAt, endsAt: "2026-09-07T12:00:00Z" }] }), [commitment()], WINDOW);
    expect(result.segments.map((segment) => segment.remainingQuantity)).toEqual([5, -10]);
  });
  it("uses whole occupancy windows, reports all simultaneous events, and excludes outside reservations", () => {
    const reservations = [commitment({ quantity: 100, startsAt: "2026-09-07T09:00:00Z" }),
      commitment({ id: COMMAND, eventId: USER, quantity: 120, startsAt: "2026-09-07T12:00:00Z" }),
      commitment({ id: VENUE, quantity: 1000, startsAt: WINDOW.endsAt, endsAt: "2026-09-07T15:00:00Z" })];
    const result = evaluateInventoryAvailability(stock(), reservations, WINDOW);
    expect(result.segments.map((segment) => segment.reservedQuantity)).toEqual([100, 220]);
    expect(result.maximumShortageQuantity).toBe(20);
    expect(result.segments[1]?.eventIds).toEqual([USER, EVENT]);
    expect(result.segments[1]?.totalQuantity).toBe(200);
  });
  it("ignores released commitments and gives retired stock no usable capacity", () => {
    expect(evaluateInventoryAvailability(stock(), [commitment({ status: "released" })], WINDOW).minimumRemainingQuantity).toBe(200);
    expect(evaluateInventoryAvailability(stock({ status: "retired" }), [commitment()], WINDOW).maximumShortageQuantity).toBe(190);
  });
  it("rejects mixed venue/item records and duplicate reservation identities", () => {
    expect(() => evaluateInventoryAvailability(stock(), [commitment({ venueId: OTHER })], WINDOW)).toThrow("INVENTORY_SCOPE_MISMATCH");
    expect(() => evaluateInventoryAvailability(stock(), [commitment({ assetDefinitionId: OTHER })], WINDOW)).toThrow("INVENTORY_SCOPE_MISMATCH");
    expect(() => evaluateInventoryAvailability(stock(), [commitment(), commitment()], WINDOW)).toThrow("INVENTORY_DUPLICATE_ID");
  });
  it("rejects overflow rather than inventing an imprecise available count", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(() => evaluateInventoryAvailability(stock({ ownedQuantity: maximum, hires: [{ id: COMMAND,
      quantity: 1, ...WINDOW }] }), [], WINDOW)).toThrow("INVENTORY_QUANTITY_OVERFLOW");
    expect(() => evaluateInventoryAvailability(stock(), [commitment({ quantity: maximum }),
      commitment({ id: COMMAND, quantity: 1 })], WINDOW)).toThrow("INVENTORY_QUANTITY_OVERFLOW");
  });
  it("is order-independent and respects real instants across the autumn DST fold", () => {
    const window = { startsAt: "2026-10-25T01:00:00+01:00", endsAt: "2026-10-25T02:00:00+00:00" };
    const first = commitment({ ...window, endsAt: "2026-10-25T01:00:00+00:00", quantity: 100 });
    const second = commitment({ id: COMMAND, ...window, startsAt: "2026-10-25T01:00:00+00:00", quantity: 150 });
    const expected = evaluateInventoryAvailability(stock(), [first, second], window);
    expect(expected).toEqual(evaluateInventoryAvailability(stock(), [second, first], window));
    expect(expected.minimumRemainingQuantity).toBe(50);
    expect(expected.segments).toHaveLength(2);
  });
  it("refuses historical queries before the supplied current stock became effective", () => {
    expect(() => evaluateInventoryAvailability(stock({ effectiveAt: "2026-09-08T10:00:00Z" }), [], WINDOW)).toThrow("INVENTORY_HISTORY_REQUIRED");
  });
  it("aggregates a large schedule without variadic argument limits", () => {
    const start = Date.parse(WINDOW.startsAt);
    const count = 70_000;
    const reservations = Array.from({ length: count }, (_, index) => commitment({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      quantity: 1,
      startsAt: new Date(start + index * 2).toISOString(),
      endsAt: new Date(start + index * 2 + 1).toISOString(),
    }));
    const result = evaluateInventoryAvailability(stock(), reservations, WINDOW);
    expect(result.segments).toHaveLength(count * 2);
    expect(result.minimumRemainingQuantity).toBe(199);
    expect(result.maximumShortageQuantity).toBe(0);
  }, LARGE_SCHEDULE_TEST_TIMEOUT_MS);
});

describe("auditable inventory adjustments", () => {
  it("records an admin's decrease with exact before/after identity and keeps the input immutable", () => {
    const original = stock();
    const result = applyInventoryAdjustment(original, command(), ADMIN, LATER);
    expect(result.replayed).toBe(false);
    expect(result.receipt.before).toEqual(original);
    expect(result.receipt.after).toMatchObject({ revision: 1, damagedQuantity: 20, effectiveAt: LATER });
    expect(result.receipt).toMatchObject({ actorUserId: USER, reason: command().reason, recordedAt: LATER });
    expect(original.damagedQuantity).toBe(0);
    expect(evaluateInventoryAvailability(result.receipt.after, [commitment()], WINDOW).maximumShortageQuantity).toBe(10);
  });
  it("replays exactly the original receipt even after a later update", () => {
    const first = applyInventoryAdjustment(stock(), command(), ADMIN, LATER);
    const second = applyInventoryAdjustment(first.receipt.after, command({ commandId: OTHER,
      expectedRevision: 1, damagedQuantity: 5 }), ADMIN, "2026-09-04T10:02:00Z");
    const retry = applyInventoryAdjustment(second.receipt.after, command(), ADMIN, "2026-09-04T10:03:00Z", first.receipt);
    expect(retry.replayed).toBe(true);
    expect(retry.receipt).toEqual(first.receipt);
    expect(retry.stock).toEqual(second.stock);
    expect(second.receipt.after.damagedQuantity).toBe(5);
  });
  it("rejects stale concurrent adjustments and changed payloads on the same idempotency key", () => {
    const first = applyInventoryAdjustment(stock(), command(), ADMIN, LATER);
    expect(() => applyInventoryAdjustment(first.receipt.after, command({ commandId: OTHER }), ADMIN, LATER)).toThrow("INVENTORY_REVISION_CONFLICT");
    expect(() => applyInventoryAdjustment(first.receipt.after, command({ damagedQuantity: 10 }), ADMIN, LATER, first.receipt)).toThrow("INVENTORY_IDEMPOTENCY_CONFLICT");
  });
  it("rechecks current authority before replay and rejects a different actor or venue", () => {
    const first = applyInventoryAdjustment(stock(), command(), ADMIN, LATER);
    expect(() => applyInventoryAdjustment(first.receipt.after, command(), { ...ADMIN, role: "staff" }, LATER, first.receipt)).toThrow("INVENTORY_FORBIDDEN");
    expect(() => applyInventoryAdjustment(first.receipt.after, command(), { ...ADMIN, userId: OTHER }, LATER, first.receipt)).toThrow("INVENTORY_IDEMPOTENCY_CONFLICT");
    expect(() => applyInventoryAdjustment(stock(), command({ venueId: OTHER }), ADMIN, LATER)).toThrow("INVENTORY_FORBIDDEN");
  });
  it("rejects blank reasons, invalid counts and recorded times older than current stock", () => {
    expect(() => applyInventoryAdjustment(stock(), command({ reason: " " }), ADMIN, LATER)).toThrow();
    expect(() => applyInventoryAdjustment(stock(), command({ damagedQuantity: 201 }), ADMIN, LATER)).toThrow();
    expect(() => applyInventoryAdjustment(stock(), command(), ADMIN, "2026-09-04T09:00:00Z")).toThrow("INVENTORY_TIME_CONFLICT");
  });
  it("records restored stock and does not change previously released count records", () => {
    const first = applyInventoryAdjustment(stock(), command(), ADMIN, LATER);
    const second = applyInventoryAdjustment(first.stock, command({ commandId: OTHER,
      expectedRevision: 1, damagedQuantity: 0, reason: "Chairs repaired and inspected" }), ADMIN, "2026-09-04T10:02:00Z");
    expect(second.stock.damagedQuantity).toBe(0);
    expect(first.receipt.after.damagedQuantity).toBe(20);
    expect(second.receipt.actorRole).toBe("admin");
  });
  it("rejects a corrupt receipt and mismatched current stock at the receipt revision", () => {
    const first = applyInventoryAdjustment(stock(), command(), ADMIN, LATER);
    expect(InventoryAdjustmentReceiptSchema.safeParse({ ...first.receipt,
      after: { ...first.stock, ownedQuantity: 300 } }).success).toBe(false);
    expect(() => applyInventoryAdjustment({ ...first.stock, ownedQuantity: 300 }, command(), ADMIN,
      LATER, first.receipt)).toThrow("INVENTORY_RECEIPT_INTEGRITY");
    expect(() => applyInventoryAdjustment(stock(), command(), ADMIN, LATER, first.receipt)).toThrow("INVENTORY_RECEIPT_INTEGRITY");
  });
  it("normalizes time offsets and hire ordering for idempotent retries", () => {
    const hires = [{ id: OTHER, quantity: 10, ...WINDOW }, { id: USER, quantity: 20, ...WINDOW }];
    const first = applyInventoryAdjustment(stock(), command({ hires }), ADMIN, LATER);
    const retry = applyInventoryAdjustment(first.stock, command({ hires: [...hires].reverse().map((hire) => ({ ...hire,
      startsAt: "2026-09-07T11:00:00+01:00" })) }), ADMIN, LATER, first.receipt);
    expect(retry.replayed).toBe(true);
    expect(hires[0]?.id).toBe(OTHER);
  });
  it("rejects a different item's command and exhausted version counter", () => {
    expect(() => applyInventoryAdjustment(stock(), command({ assetDefinitionId: OTHER }), ADMIN, LATER)).toThrow("INVENTORY_SCOPE_MISMATCH");
    expect(() => applyInventoryAdjustment(stock({ revision: Number.MAX_SAFE_INTEGER }), command({
      expectedRevision: Number.MAX_SAFE_INTEGER }), ADMIN, LATER)).toThrow("INVENTORY_QUANTITY_OVERFLOW");
  });
});
