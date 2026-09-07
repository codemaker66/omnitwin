import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { InventoryAssessment } from "@omnitwin/types";
import { InventoryImpact, InventoryRemedyShortcut } from "../InventoryImpact.js";
import type { InventoryDemandContext } from "../InventoryDemand.js";
import { demandAssessment, demandIds } from "./inventory-demand-fixtures.js";

afterEach(cleanup);

function context(assessment: InventoryAssessment = demandAssessment): InventoryDemandContext {
  return { assessment, assessmentCurrent: true, loading: false, canAct: true, windowForm: null, onRemedy: vi.fn() };
}

describe("InventoryImpact", () => {
  it("keeps usable, reserved and remaining quantities in the same interval", () => {
    const assessment = structuredClone(demandAssessment);
    const item = assessment.items[0];
    if (item?.availability === null || item?.availability === undefined) throw new Error("Missing test availability");
    const initial = item.availability.segments[0];
    if (initial === undefined) throw new Error("Missing test interval");
    item.availability.segments = [
      { ...initial, endsAt: "2026-09-06T12:00:00.000Z", ownedQuantity: 300, totalQuantity: 300,
        usableQuantity: 300, reservedQuantity: 280, remainingQuantity: 20 },
      { ...initial, startsAt: "2026-09-06T12:00:00.000Z", ownedQuantity: 80, totalQuantity: 80,
        usableQuantity: 80, reservedQuantity: 90, remainingQuantity: -10, shortageQuantity: 10,
        eventIds: [demandIds.event] },
    ];
    item.availability.minimumRemainingQuantity = -10;
    item.availability.maximumShortageQuantity = 10;
    const { container } = render(<InventoryImpact demand={context(assessment)} assetId={demandIds.asset} />);
    expect(Array.from(container.querySelectorAll("dd"), (node) => node.textContent)).toEqual(["80", "90", "-10"]);
    expect(screen.getByRole("link", { name: "McLaren wedding" }).getAttribute("href")).toBe(`/ops/events/${demandIds.event}`);
    expect(screen.getByText(/Coverage gaps remain/u)).toBeTruthy();
    expect(screen.getByText(/Selected period/u)).toBeTruthy();
  });

  it("identifies retained figures as stale and never calls them a current shortfall", () => {
    const demand = { ...context(), assessmentCurrent: false, canAct: false };
    render(<><InventoryImpact demand={demand} assetId={demandIds.asset} />
      <InventoryRemedyShortcut demand={demand} item={demandAssessment.items[0]} /></>);
    expect(screen.getByText(/Outdated assessment. Refresh required/u)).toBeTruthy();
    expect(screen.getByText(/Refresh the assessment for current shortages/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prepare hire or inspection request" }).hasAttribute("disabled")).toBe(true);
  });

  it("distinguishes a missing assessment item from an unrecorded stock count", () => {
    render(<InventoryImpact demand={context()} assetId="missing" />);
    expect(screen.getByText("This item is not in the current assessment.")).toBeTruthy();
    expect(screen.queryByText(/Record stock to assess availability/u)).toBeNull();
  });

  it("preserves unknown stock instead of displaying a zero or positive availability", () => {
    const assessment = structuredClone(demandAssessment);
    const item = assessment.items[0];
    if (item === undefined) throw new Error("Missing test item");
    item.availability = null; item.stockRevision = null; item.unavailableReason = "stock_unrecorded";
    const { container } = render(<InventoryImpact demand={context(assessment)} assetId={demandIds.asset} />);
    expect(screen.getByText(/Record stock to assess availability/u)).toBeTruthy();
    expect(container.querySelector("dd")).toBeNull();
  });
});
