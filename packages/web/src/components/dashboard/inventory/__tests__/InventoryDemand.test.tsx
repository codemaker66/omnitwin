import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { InventoryDemand } from "../InventoryDemand.js";
import { ApiError } from "../../../../api/client.js";
import { inventoryActionKey, writeInventoryAction } from "../inventory-action-pending.js";
import { demandAssessment, demandRelease, demandRemedy, demandIds } from "./inventory-demand-fixtures.js";

const venueId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000003";
const mocks = vi.hoisted(() => ({ assess: vi.fn(), reserve: vi.fn(), revoke: vi.fn(), prepare: vi.fn(), approve: vi.fn(), remedy: vi.fn(), history: vi.fn() }));
vi.mock("../../../../api/venue-inventory-demand.js", () => ({
  assessVenueInventory: mocks.assess, approveInventoryReservation: mocks.reserve, revokeInventoryReservation: mocks.revoke,
  prepareInventoryRemedy: mocks.prepare, approveInventoryRemedy: mocks.approve, getInventoryRemedy: mocks.remedy, getInventoryReservationHistory: mocks.history,
}));
beforeEach(() => { vi.clearAllMocks(); mocks.assess.mockReset().mockRejectedValue(new Error("Connection unavailable"));
  mocks.reserve.mockReset().mockResolvedValue({ release: demandRelease, assessment: demandAssessment, replayed: false });
  mocks.prepare.mockReset().mockResolvedValue({ remedy: demandRemedy, replayed: false });
  mocks.approve.mockReset().mockResolvedValue({ remedy: { ...demandRemedy, status: "approved", approvedBy: actorId, approvedAt: "2026-09-05T10:02:00.000Z" }, replayed: false });
  mocks.history.mockReset().mockResolvedValue([]);
  writeInventoryAction(inventoryActionKey(actorId, venueId), null);
});
afterEach(cleanup);

describe("InventoryDemand", () => {
  it("gates new choices until replay reconciliation refreshes the changed assessment digest", async () => {
    const approved = { ...demandRemedy, status: "approved" as const, approvedBy: actorId, approvedAt: "2026-09-05T11:00:00.000Z" };
    const next = { ...demandAssessment, assessmentDigest: "f".repeat(64), remedies: [approved] };
    let finishRefresh: ((value: typeof next) => void) | undefined;
    mocks.assess.mockResolvedValueOnce({ ...demandAssessment, remedies: [demandRemedy] })
      .mockImplementationOnce(() => new Promise((resolve: (value: typeof next) => void) => { finishRefresh = resolve; }));
    mocks.prepare.mockResolvedValueOnce({ remedy: demandRemedy, replayed: true });
    mocks.remedy.mockResolvedValue(approved);
    writeInventoryAction(inventoryActionKey(actorId, venueId), { kind: "prepare", title: "Hire request · Chiavari chair", input: {
      commandId: demandIds.remedy, assetDefinitionId: demandIds.asset, window: demandRemedy.window,
      kind: "hire_request", quantity: 20, expectedAssessmentDigest: demandRemedy.assessmentDigest, reason: "Cover shortage" } });
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Check recorded result" }));
    await screen.findByText("Internal request approved");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "Prepare remedy · Chiavari chair" })).toBeNull();
    if (finishRefresh === undefined) throw new Error("Expected a current assessment refresh");
    finishRefresh(next);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare remedy · Chiavari chair" }));
    fireEvent.change(screen.getByLabelText("Requested quantity"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Reason for request"), { target: { value: "Inspect the remaining gap" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare request" }));
    await waitFor(() => { expect(mocks.prepare).toHaveBeenCalledTimes(2); });
    expect(mocks.prepare.mock.calls[1]?.[1]).toMatchObject({ expectedAssessmentDigest: next.assessmentDigest });
  });
  it("reads current request status before presenting a replayed lost preparation for approval", async () => {
    const approved = { ...demandRemedy, status: "approved" as const, approvedBy: actorId, approvedAt: "2026-09-05T11:00:00.000Z" };
    mocks.assess.mockResolvedValue({ ...demandAssessment, remedies: [approved] });
    mocks.prepare.mockResolvedValue({ remedy: demandRemedy, replayed: true });
    mocks.remedy.mockResolvedValue(approved);
    writeInventoryAction(inventoryActionKey(actorId, venueId), { kind: "prepare", title: "Hire request · Chiavari chair", input: {
      commandId: demandIds.remedy, assetDefinitionId: demandIds.asset, window: demandRemedy.window,
      kind: "hire_request", quantity: 20, expectedAssessmentDigest: demandRemedy.assessmentDigest, reason: "Cover shortage" } });
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Check recorded result" }));
    expect(await screen.findByText("Internal request approved")).toBeTruthy();
    expect(mocks.remedy).toHaveBeenCalledWith(venueId, demandIds.remedy, expect.any(AbortSignal));
    expect(screen.queryByRole("button", { name: "Approve internal request" })).toBeNull();
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("moves keyboard focus to the new decision stage and restores the original opener on close", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    const opener = await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" });
    opener.focus(); fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText("Reason for reservation decision"), { target: { value: "Reviewed" } });
    fireEvent.click(screen.getByLabelText(/recorded times cover equipment setup through return/u));
    const approve = screen.getByRole("button", { name: "Approve reservation" });
    approve.focus(); fireEvent.click(approve);
    await screen.findByText("Reservation approved");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Reservation decision recorded" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(document.activeElement).toBe(opener);
  });
  it("reviews a current request in its original window without falsely marking it stale", async () => {
    const request = { ...demandRemedy, assessmentDigest: "e".repeat(64), window: {
      startsAt: "2026-09-07T10:00:00.000Z", endsAt: "2026-09-07T20:00:00.000Z" } };
    mocks.assess.mockResolvedValue({ ...demandAssessment, remedies: [{ ...request, check: "not_checked" }] });
    mocks.remedy.mockResolvedValue(request);
    mocks.approve.mockResolvedValue({ remedy: { ...request, status: "approved", approvedBy: actorId, approvedAt: "2026-09-05T11:00:00.000Z" }, replayed: false });
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review internal request · Chiavari chair" }));
    const approve = await screen.findByRole("button", { name: "Approve internal request" });
    expect(screen.queryByText(/Facts changed. Prepare a fresh request/u)).toBeNull();
    fireEvent.click(approve);
    await screen.findByText("Internal request approved");
    expect(mocks.approve.mock.calls[0]?.[2]).toMatchObject({ expectedAssessmentDigest: request.assessmentDigest });
  });
  it("keeps an approved request receipt visible when refreshing the new assessment fails", async () => {
    mocks.assess.mockResolvedValueOnce({ ...demandAssessment, remedies: [demandRemedy] }).mockRejectedValueOnce(new Error("Refresh offline"));
    mocks.remedy.mockResolvedValue(demandRemedy);
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    const opener = await screen.findByRole("button", { name: "Review internal request · Chiavari chair" });
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole("button", { name: "Approve internal request" }));
    expect(await screen.findByText("Internal request approved")).toBeTruthy();
    await screen.findByText(/The request was approved, but the current assessment could not be refreshed/u);
    expect(screen.getByRole("button", { name: "Done" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(opener.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Assess demand" }).hasAttribute("disabled")).toBe(false);
  });
  it("cannot approve a full allocation that extends into unsupported stock history", async () => {
    mocks.assess.mockResolvedValue({ ...demandAssessment, sources: demandAssessment.sources.map((source) => ({ ...source,
      proposalImpact: source.proposalImpact.map((item) => ({ ...item, availability: null, unavailableReason: "historical_unsupported" })) })) });
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" }));
    expect(screen.getByText(/allocation extends into unsupported stock history/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve reservation" })).toBeNull();
  });
  it("mounts shared activity only during an active assessment and stops on failure", async () => {
    let rejectRead: ((reason: Error) => void) | undefined;
    mocks.assess.mockImplementation(() => new Promise((_resolve, reject: (reason: Error) => void) => { rejectRead = reject; }));
    const view = render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    expect(await screen.findByText("Assessing recorded demand and stock…")).toBeTruthy();
    expect(view.container.querySelector('[data-activity-indicator="particles"]')).not.toBeNull();
    if (rejectRead === undefined) throw new Error("Expected the assessment to start");
    rejectRead(new Error("Offline now"));
    await screen.findByText("Offline now");
    expect(view.container.querySelector('[data-activity-indicator="particles"]')).toBeNull();
  });
  it("shows coverage limitations and never reserves until the full occupied window is confirmed", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    expect(await screen.findByText("Reception room has no timed layout.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" }));
    expect(within(screen.getByRole("dialog")).getByText(/Accessories are not mapped/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve reservation" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for reservation decision"), { target: { value: "Reviewed room setup" } });
    fireEvent.click(screen.getByLabelText(/recorded times cover equipment setup through return/u));
    fireEvent.click(screen.getByRole("button", { name: "Approve reservation" }));
    await waitFor(() => { expect(mocks.reserve).toHaveBeenCalledTimes(1); });
    expect(mocks.reserve.mock.calls[0]?.[1]).toMatchObject({ occupiedWindowConfirmed: true,
      expectedSourceDigest: demandAssessment.sources[0]?.sourceDigest, expectedAssessmentDigest: demandAssessment.assessmentDigest });
    expect(await screen.findByText("Reservation approved")).toBeTruthy();
  });

  it("invalidates a stale choice without silently resubmitting it", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    mocks.reserve.mockRejectedValueOnce(new ApiError(409, "Stock or demand changed", "INVENTORY_ASSESSMENT_STALE"));
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" }));
    fireEvent.change(screen.getByLabelText("Reason for reservation decision"), { target: { value: "Reviewed" } });
    fireEvent.click(screen.getByLabelText(/recorded times cover equipment setup through return/u));
    fireEvent.click(screen.getByRole("button", { name: "Approve reservation" }));
    expect(await screen.findByText(/Facts changed. Review a fresh assessment/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve reservation" })).toBeNull();
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });
  it("retains an identity-conflicted command for review and permits explicit dismissal without a retry", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    mocks.reserve.mockRejectedValueOnce(new ApiError(409, "Command identity conflict", "INVENTORY_IDEMPOTENCY_CONFLICT"));
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" }));
    fireEvent.change(screen.getByLabelText("Reason for reservation decision"), { target: { value: "Reviewed" } });
    fireEvent.click(screen.getByLabelText(/recorded times cover equipment setup through return/u));
    fireEvent.click(screen.getByRole("button", { name: "Approve reservation" }));
    expect(await screen.findByText(/This command identifier conflicts with a recorded action/u)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check recorded result" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss retained attempt" }));
    await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" });
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
  });

  it("retries an uncertain reservation with the same command after closing its review", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    mocks.reserve.mockRejectedValueOnce(new ApiError(0, "Connection lost", "NETWORK_ERROR"));
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" }));
    fireEvent.change(screen.getByLabelText("Reason for reservation decision"), { target: { value: "Reviewed" } });
    fireEvent.click(screen.getByLabelText(/recorded times cover equipment setup through return/u));
    fireEvent.click(screen.getByRole("button", { name: "Approve reservation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close and check later" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check recorded result" }));
    await screen.findByText("Reservation approved");
    expect(mocks.reserve.mock.calls[1]?.[1]).toEqual(mocks.reserve.mock.calls[0]?.[1]);
  });

  it("prepares then separately approves an internal request without adding supply", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare remedy · Chiavari chair" }));
    fireEvent.change(screen.getByLabelText("Requested quantity"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Reason for request"), { target: { value: "Cover shortage" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare request" }));
    expect(await screen.findByRole("button", { name: "Approve internal request" })).toBeTruthy();
    expect(mocks.approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Approve internal request" }));
    expect(await screen.findByText("Internal request approved")).toBeTruthy();
    expect(screen.getByText(/does not add supply or resolve the shortage/u)).toBeTruthy();
    expect(mocks.approve).toHaveBeenCalledWith(venueId, demandIds.remedy, expect.objectContaining({ expectedAssessmentDigest: demandAssessment.assessmentDigest }));
  });

  it("allows a venue administrator to approve a current request prepared by another administrator", async () => {
    const otherPrepared = { ...demandRemedy, preparedBy: demandIds.space };
    mocks.assess.mockResolvedValue({ ...demandAssessment, remedies: [otherPrepared] });
    mocks.remedy.mockResolvedValue(otherPrepared);
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review internal request · Chiavari chair" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve internal request" }));
    await screen.findByText("Internal request approved");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.approve).toHaveBeenCalledTimes(1);
  });

  it.each(["incomplete", "inactive"] as const)("does not offer approval for a %s source", async (state) => {
    mocks.assess.mockResolvedValue({ ...demandAssessment, sources: demandAssessment.sources.map((source) => ({ ...source, state })) });
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" }));
    expect(screen.queryByRole("button", { name: "Approve reservation" })).toBeNull();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("does not approve a prepared request whose evidence changed", async () => {
    mocks.assess.mockResolvedValue({ ...demandAssessment, remedies: [demandRemedy] });
    mocks.remedy.mockResolvedValue({ ...demandRemedy, check: "stale" });
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review internal request · Chiavari chair" }));
    expect(await screen.findByText("Facts changed. Prepare a fresh request before approval.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve internal request" })).toBeNull();
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("restores a pending action and its observation window after leaving inventory", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    mocks.reserve.mockRejectedValueOnce(new ApiError(0, "Connection lost", "NETWORK_ERROR"));
    const first = render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" }));
    fireEvent.change(screen.getByLabelText("Reason for reservation decision"), { target: { value: "Reviewed" } });
    fireEvent.click(screen.getByLabelText(/recorded times cover equipment setup through return/u));
    fireEvent.click(screen.getByRole("button", { name: "Approve reservation" }));
    await screen.findByText("Result not confirmed"); first.unmount();
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    await screen.findByText("An earlier action is not confirmed");
    expect(mocks.assess.mock.calls.at(-1)?.[1]).toEqual(demandAssessment.window);
    fireEvent.click(screen.getByRole("button", { name: "Check recorded result" }));
    await screen.findByText("Reservation approved");
    expect(mocks.reserve.mock.calls[1]?.[1]).toEqual(mocks.reserve.mock.calls[0]?.[1]);
  });

  it("closes a read-only review without replacing its opener or refetching the assessment", async () => {
    mocks.assess.mockResolvedValue(demandAssessment);
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    const opener = await screen.findByRole("button", { name: "Review reservation · McLaren wedding · Grand Hall" });
    opener.focus(); fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.assess).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it("retains a visible assessment error and allows retry", async () => {
    render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    expect(await screen.findByText("Connection unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assess demand" }));
    await waitFor(() => { expect(mocks.assess).toHaveBeenCalledTimes(2); });
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("aborts an obsolete assessment after physical stock changes", async () => {
    mocks.assess.mockImplementation(() => new Promise(() => { /* Controlled unresolved request. */ }));
    const view = render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    await waitFor(() => { expect(mocks.assess).toHaveBeenCalledTimes(1); });
    const previous = mocks.assess.mock.calls[0]?.[2] as AbortSignal | undefined;
    view.rerender(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={1} />);
    await waitFor(() => { expect(mocks.assess).toHaveBeenCalledTimes(2); });
    expect(previous?.aborted).toBe(true);
  });

  it("does not leave an assessment request active after leaving inventory", async () => {
    mocks.assess.mockImplementation(() => new Promise(() => { /* Controlled unresolved request. */ }));
    const view = render(<InventoryDemand actorId={actorId} venueId={venueId} refreshKey={0} />);
    await waitFor(() => { expect(mocks.assess).toHaveBeenCalledTimes(1); });
    const signal = mocks.assess.mock.calls[0]?.[2] as AbortSignal | undefined;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
