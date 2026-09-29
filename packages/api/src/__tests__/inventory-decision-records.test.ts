import { describe, expect, it } from "vitest";
import type { InventoryActor, InventoryRemedy, InventoryReservationRelease } from "@omnitwin/types";
import { approvedRemedy, decidedRelease, preparedRemedy } from "../services/inventory-reservations.js";

// ---------------------------------------------------------------------------
// What an inventory decision records (Blake, 29 September 2026): a venue's
// administrators and managers both approve and revoke reservations, and
// prepare and approve internal requests, and each record says who decided
// and in which role. The transactions around these are proven on isolated
// PostgreSQL; what they record is proven here, where CI runs it.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-00000000a001";
const ADMIN: InventoryActor = { userId: "00000000-0000-4000-8000-00000000a0a1", role: "admin", venueId: VENUE };
const MANAGER: InventoryActor = { userId: "00000000-0000-4000-8000-00000000a0b1", role: "manager", venueId: VENUE };
const SALES: InventoryActor = { userId: "00000000-0000-4000-8000-00000000a0c1", role: "sales", venueId: VENUE };
const ID = "00000000-0000-4000-8000-00000000a0d1";
const WINDOW = { startsAt: "2026-11-20T09:00:00.000Z", endsAt: "2026-11-21T01:00:00.000Z" };

const RELEASE: Omit<InventoryReservationRelease, "actorUserId" | "actorRole"> = {
  id: ID, venueId: VENUE, eventId: ID, spaceId: ID, revision: 1, action: "approved", supersedesReleaseId: null,
  sourceDigest: "a".repeat(64), occupiedWindow: WINDOW, occupiedWindowConfirmed: true, demands: [],
  bookings: [{ id: ID, window: WINDOW, updatedAt: WINDOW.startsAt }],
  phases: [{ phaseId: ID, name: "Empty layout", window: WINDOW, mode: "frozen_layout", snapshotId: ID, canonicalSnapshotId: ID,
    proofDigest: "a".repeat(64), snapshotDigest: "b".repeat(64), objects: [] }],
  recordedAt: WINDOW.startsAt, reason: "Confirmed with the events team",
};

const REQUEST: Omit<InventoryRemedy, "status" | "preparedBy" | "preparedByRole" | "approvedBy" | "approvedByRole" | "approvedAt"> = {
  id: ID, venueId: VENUE, kind: "hire_request", assetDefinitionId: ID, assetName: "Chiavari chair", quantity: 20, window: WINDOW,
  assessmentDigest: "c".repeat(64), reason: "Twenty short for the Crawford wedding", preparedAt: WINDOW.startsAt,
  effect: "internal_request_only", check: "current",
  evidence: { stockRevision: 3, shortageSegments: [], affectedReservations: [], missingFacts: ["Supplier unconfirmed"] },
};

describe("a reservation's approval and revocation", () => {
  it("records who decided it and in which role", () => {
    expect(decidedRelease(MANAGER, RELEASE)).toMatchObject({ actorUserId: MANAGER.userId, actorRole: "manager" });
    expect(decidedRelease(ADMIN, RELEASE)).toMatchObject({ actorUserId: ADMIN.userId, actorRole: "admin" });
  });

  it("records the one who revokes, never the one who approved", () => {
    const byManager = decidedRelease(MANAGER, RELEASE);
    const revoked = decidedRelease(ADMIN, { ...byManager, id: "00000000-0000-4000-8000-00000000a0d2", action: "revoked", revision: 2,
      supersedesReleaseId: byManager.id, reason: "The event moved" });
    expect(revoked).toMatchObject({ action: "revoked", actorUserId: ADMIN.userId, actorRole: "admin" });
    const byAdmin = decidedRelease(ADMIN, RELEASE);
    expect(decidedRelease(MANAGER, { ...byAdmin, action: "revoked", revision: 2, supersedesReleaseId: byAdmin.id, reason: "Cancelled" }))
      .toMatchObject({ actorUserId: MANAGER.userId, actorRole: "manager" });
  });

  it("refuses to record a decision by a role that may not make one", () => {
    expect(() => decidedRelease(SALES, RELEASE)).toThrow();
  });
});

describe("an internal request", () => {
  it("records who prepared it and in which role, and no approver yet", () => {
    expect(preparedRemedy(MANAGER, REQUEST)).toMatchObject({
      status: "prepared", preparedBy: MANAGER.userId, preparedByRole: "manager", approvedBy: null, approvedByRole: null, approvedAt: null,
    });
  });

  it("records who approved it and in which role, keeping who prepared it", () => {
    const prepared = preparedRemedy(MANAGER, REQUEST);
    expect(approvedRemedy(prepared, ADMIN, WINDOW.endsAt)).toMatchObject({
      status: "approved", preparedBy: MANAGER.userId, preparedByRole: "manager",
      approvedBy: ADMIN.userId, approvedByRole: "admin", approvedAt: WINDOW.endsAt, check: "current",
    });
    expect(approvedRemedy(preparedRemedy(ADMIN, REQUEST), MANAGER, WINDOW.endsAt))
      .toMatchObject({ preparedByRole: "admin", approvedByRole: "manager" });
  });

  it("approves a request prepared before roles were kept, recording the approver's", () => {
    const { preparedByRole: _role, ...before } = preparedRemedy(ADMIN, REQUEST);
    const approved = approvedRemedy(before, MANAGER, WINDOW.endsAt);
    expect(approved.preparedByRole).toBeUndefined();
    expect(approved.approvedByRole).toBe("manager");
  });

  it("refuses to record a request by a role that may not make one", () => {
    expect(() => preparedRemedy(SALES, REQUEST)).toThrow();
    expect(() => approvedRemedy(preparedRemedy(ADMIN, REQUEST), SALES, WINDOW.endsAt)).toThrow();
  });
});
