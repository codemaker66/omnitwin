import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { VenueInventoryReceipt } from "@omnitwin/types";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { InventoryReceipt } from "../InventoryReceipt.js";
import { ReservationReceipt } from "../InventoryReservationReview.js";
import { InventoryRemedyReview } from "../InventoryRemedyReview.js";
import { inventoryRoleName, inventoryRoleWords } from "../inventory-roles.js";
import { demandIds, demandRelease, demandRemedy } from "./inventory-demand-fixtures.js";

// ---------------------------------------------------------------------------
// A venue's administrators and managers both change its stock and decide its
// reservations (Blake, 29 September 2026). Each record says which of them it
// was; one from before then carries no role, as only administrators could act.
// ---------------------------------------------------------------------------

const someoneElse = "00000000-0000-4000-8000-000000000099";
const stock = { venueId: demandIds.venue, assetDefinitionId: demandIds.asset, revision: 4, ownedQuantity: 210, damagedQuantity: 0,
  unavailableQuantity: 0, hires: [], storageLocation: "East store", status: "active" as const, effectiveAt: "2026-09-29T10:00:00.000Z" };
function receipt(actorRole: "admin" | "manager"): VenueInventoryReceipt {
  return { kind: "adjusted", actorUserId: someoneElse, actorRole, reason: "Chair stocktake", recordedAt: stock.effectiveAt,
    command: { commandId: "00000000-0000-4000-8000-000000000031", venueId: demandIds.venue, assetDefinitionId: demandIds.asset,
      expectedRevision: 3, ownedQuantity: 210, damagedQuantity: 0, unavailableQuantity: 0, hires: [], storageLocation: "East store",
      status: "active", reason: "Chair stocktake" },
    before: { ...stock, revision: 3, ownedQuantity: 200 }, after: stock };
}

afterEach(() => { cleanup(); useAuthStore.getState().logout(); });

describe("who changed or decided a venue's inventory", () => {
  it("names the role, reading a record without one as an administrator's", () => {
    expect(inventoryRoleName("manager")).toBe("Venue manager");
    expect(inventoryRoleName("admin")).toBe("Venue administrator");
    expect(inventoryRoleName(undefined)).toBe("Venue administrator");
    expect(inventoryRoleWords("manager")).toBe("a venue manager");
    expect(inventoryRoleWords(null)).toBe("a venue administrator");
  });

  it("says a stock receipt was a manager's or an administrator's", () => {
    render(<InventoryReceipt receipt={receipt("manager")} />);
    expect(screen.getByText("Venue manager")).toBeTruthy();
    expect(screen.getByText("Manager")).toBeTruthy();
    cleanup();
    render(<InventoryReceipt receipt={receipt("admin")} />);
    expect(screen.getByText("Venue administrator")).toBeTruthy();
    expect(screen.getByText("Administrator")).toBeTruthy();
  });

  it("says who recorded a reservation, and reads one from before roles were kept as an administrator's", () => {
    const { rerender } = render(<ReservationReceipt release={{ ...demandRelease, actorUserId: someoneElse, actorRole: "manager" }}
      actorId={demandIds.actor} timeZone="Europe/London" />);
    expect(screen.getByText(/Recorded by a venue manager\./u)).toBeTruthy();
    // Its audit identifiers name the role, as a stock receipt's do.
    expect(screen.getByText("Manager", { selector: "dt" })).toBeTruthy();
    rerender(<ReservationReceipt release={{ ...demandRelease, actorUserId: someoneElse }} actorId={demandIds.actor} timeZone="Europe/London" />);
    expect(screen.getByText(/Recorded by a venue administrator\./u)).toBeTruthy();
    expect(screen.getByText("Administrator", { selector: "dt" })).toBeTruthy();
    rerender(<ReservationReceipt release={{ ...demandRelease, actorRole: "manager" }} actorId={demandIds.actor} timeZone="Europe/London" />);
    expect(screen.getByText(/Recorded by you\./u)).toBeTruthy();
  });

  it("says who prepared and who approved an internal request", () => {
    render(<InventoryRemedyReview remedy={{ ...demandRemedy, preparedBy: someoneElse, preparedByRole: "manager", status: "approved",
      approvedBy: demandIds.actor, approvedByRole: "admin", approvedAt: "2026-09-05T11:00:00.000Z" }}
    timeZone="Europe/London" actorId={demandIds.actor} busy={false} canAct onAction={() => undefined}
    onPrepareAgain={() => undefined} onClose={() => undefined} />);
    expect(screen.getByText("Venue manager")).toBeTruthy();
    expect(screen.getByText(/, by you/u)).toBeTruthy();
    cleanup();
    render(<InventoryRemedyReview remedy={{ ...demandRemedy, status: "approved", approvedBy: someoneElse, approvedByRole: "manager",
      approvedAt: "2026-09-05T11:00:00.000Z" }}
    timeZone="Europe/London" actorId={demandIds.actor} busy={false} canAct onAction={() => undefined}
    onPrepareAgain={() => undefined} onClose={() => undefined} />);
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText(/, by a venue manager/u)).toBeTruthy();
  });
});
