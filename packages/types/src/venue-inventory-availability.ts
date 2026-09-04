import {
  InventoryCommitmentSchema, InventoryStockSchema, InventoryWindowSchema, addInventoryQuantities,
  type InventoryStock, type InventoryCommitment, type InventoryWindow,
  type InventoryAvailability, type InventoryAvailabilitySegment,
} from "./venue-inventory.js";

interface Boundary {
  hireStarts: number[];
  hireEnds: number[];
  reservationStarts: InventoryCommitment[];
  reservationEnds: InventoryCommitment[];
}

function boundaryAt(boundaries: Map<number, Boundary>, instant: number): Boundary {
  const existing = boundaries.get(instant);
  if (existing !== undefined) return existing;
  const created = { hireStarts: [], hireEnds: [], reservationStarts: [], reservationEnds: [] };
  boundaries.set(instant, created);
  return created;
}

function collectBoundaries(stock: InventoryStock, commitments: readonly InventoryCommitment[], window: InventoryWindow): Map<number, Boundary> {
  const start = Date.parse(window.startsAt);
  const end = Date.parse(window.endsAt);
  const boundaries = new Map<number, Boundary>();
  boundaryAt(boundaries, start);
  boundaryAt(boundaries, end);
  for (const hire of stock.hires) {
    const from = Math.max(start, Date.parse(hire.startsAt));
    const to = Math.min(end, Date.parse(hire.endsAt));
    if (from >= to) continue;
    boundaryAt(boundaries, from).hireStarts.push(hire.quantity);
    boundaryAt(boundaries, to).hireEnds.push(hire.quantity);
  }
  for (const commitment of commitments) {
    const from = Math.max(start, Date.parse(commitment.startsAt));
    const to = Math.min(end, Date.parse(commitment.endsAt));
    if (commitment.status !== "reserved" || from >= to || commitment.quantity === 0) continue;
    boundaryAt(boundaries, from).reservationStarts.push(commitment);
    boundaryAt(boundaries, to).reservationEnds.push(commitment);
  }
  return boundaries;
}

function validateCommitments(stock: InventoryStock, values: readonly InventoryCommitment[]): InventoryCommitment[] {
  const commitments = values.map((value) => InventoryCommitmentSchema.parse(value));
  if (commitments.some((value) => value.venueId !== stock.venueId || value.assetDefinitionId !== stock.assetDefinitionId)) {
    throw new Error("INVENTORY_SCOPE_MISMATCH");
  }
  if (new Set(commitments.map((value) => value.id)).size !== commitments.length) throw new Error("INVENTORY_DUPLICATE_ID");
  return commitments;
}

function segmentAt(stock: InventoryStock, from: number, to: number, hired: number,
  reserved: number, active: ReadonlyMap<string, InventoryCommitment>): InventoryAvailabilitySegment {
  const totalQuantity = addInventoryQuantities(stock.ownedQuantity, hired);
  const usableQuantity = stock.status === "retired" ? 0
    : addInventoryQuantities(stock.ownedQuantity - stock.damagedQuantity - stock.unavailableQuantity, hired);
  const remainingQuantity = usableQuantity - reserved;
  return { startsAt: new Date(from).toISOString(), endsAt: new Date(to).toISOString(),
    ownedQuantity: stock.ownedQuantity, hiredQuantity: hired, totalQuantity, usableQuantity,
    reservedQuantity: reserved, remainingQuantity, shortageQuantity: Math.max(0, -remainingQuantity),
    commitmentIds: [...active.keys()].sort(), eventIds: [...new Set([...active.values()].map((value) => value.eventId))].sort() };
}

function sweep(stock: InventoryStock, boundaries: ReadonlyMap<number, Boundary>): InventoryAvailabilitySegment[] {
  const instants = [...boundaries.keys()].sort((left, right) => left - right);
  const active = new Map<string, InventoryCommitment>();
  const segments: InventoryAvailabilitySegment[] = [];
  let hired = 0;
  let reserved = 0;
  for (const [index, instant] of instants.entries()) {
    const boundary = boundaries.get(instant);
    const next = instants[index + 1];
    if (boundary === undefined || next === undefined) continue;
    // End before start gives [start,end) semantics, including exact handovers.
    for (const quantity of boundary.hireEnds) hired -= quantity;
    for (const value of boundary.reservationEnds) { reserved -= value.quantity; active.delete(value.id); }
    for (const quantity of boundary.hireStarts) hired = addInventoryQuantities(hired, quantity);
    for (const value of boundary.reservationStarts) {
      reserved = addInventoryQuantities(reserved, value.quantity);
      active.set(value.id, value);
    }
    segments.push(segmentAt(stock, instant, next, hired, reserved, active));
  }
  return segments;
}

/** Pure current-stock forecast, not a reservation write. The caller must supply
 * all commitments for this venue/item/window, including occupied setup and
 * breakdown time, from one consistent server snapshot. No incomplete-input
 * result may be presented as guaranteed availability. */
export function evaluateInventoryAvailability(stockInput: InventoryStock,
  commitmentInputs: readonly InventoryCommitment[], windowInput: InventoryWindow): InventoryAvailability {
  const stock = InventoryStockSchema.parse(stockInput);
  const window = InventoryWindowSchema.parse(windowInput);
  if (Date.parse(window.startsAt) < Date.parse(stock.effectiveAt)) throw new Error("INVENTORY_HISTORY_REQUIRED");
  const commitments = validateCommitments(stock, commitmentInputs);
  const segments = sweep(stock, collectBoundaries(stock, commitments, window));
  let minimumRemainingQuantity = Number.MAX_SAFE_INTEGER;
  let maximumShortageQuantity = 0;
  for (const segment of segments) {
    minimumRemainingQuantity = Math.min(minimumRemainingQuantity, segment.remainingQuantity);
    maximumShortageQuantity = Math.max(maximumShortageQuantity, segment.shortageQuantity);
  }
  return { venueId: stock.venueId, assetDefinitionId: stock.assetDefinitionId, stockRevision: stock.revision,
    minimumRemainingQuantity, maximumShortageQuantity, segments };
}
