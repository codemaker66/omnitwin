import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShiftHandover } from "../ShiftHandover.js";

const mocks = vi.hoisted(() => ({
  listVenueHandlers: vi.fn(),
  handoverShift: vi.fn(),
}));

vi.mock("../../../api/requests.js", () => ({
  listVenueHandlers: mocks.listVenueHandlers,
  handoverShift: mocks.handoverShift,
}));

const VENUE = "00000000-0000-4000-8000-000000007001";
const ME = "00000000-0000-4000-8000-000000007002";
const CALLUM = "00000000-0000-4000-8000-000000007003";

function request(id: string): Record<string, unknown> {
  return { id, state: "handed-over" };
}

beforeEach(() => {
  mocks.listVenueHandlers.mockReset();
  mocks.handoverShift.mockReset();
  mocks.listVenueHandlers.mockResolvedValue([
    { id: ME, name: "Elaine", role: "hallkeeper" },
    { id: CALLUM, name: "Callum", role: "hallkeeper" },
  ]);
});

afterEach(() => { cleanup(); });

describe("ShiftHandover", () => {
  it("names a relief from the floor, never oneself, and hands every open request in one call", async () => {
    mocks.handoverShift.mockResolvedValue({ handedOver: [request("a"), request("b"), request("c")], toName: "Callum" });
    render(<ShiftHandover venueId={VENUE} meId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand over my shift" }));

    const select = await screen.findByLabelText<HTMLSelectElement>("Hand to");
    expect([...select.options].map((option) => option.textContent)).toEqual(["Choose a colleague", "Callum"]);
    expect(screen.getByRole("button", { name: "Hand over" })).toHaveProperty("disabled", true);

    fireEvent.change(select, { target: { value: CALLUM } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    await waitFor(() => { expect(mocks.handoverShift).toHaveBeenCalledWith(VENUE, CALLUM); });
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Handed 3 requests to Callum. Each stays yours until they take it.");
    expect(screen.queryByLabelText("Hand to")).toBeNull();
  });

  it("says plainly when there is nothing to hand over, and keeps the form for another try", async () => {
    mocks.handoverShift.mockRejectedValue(Object.assign(new Error("Nothing to hand over"), { status: 400, code: "NOTHING_TO_HAND_OVER" }));
    render(<ShiftHandover venueId={VENUE} meId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand over my shift" }));
    fireEvent.change(await screen.findByLabelText("Hand to"), { target: { value: CALLUM } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "You hold no open request.");
    expect(screen.getByLabelText("Hand to")).toBeTruthy();
  });

  it("shows the server's own words when the relief is refused", async () => {
    mocks.handoverShift.mockRejectedValue(Object.assign(new Error("That person does not work this venue's floor."), { status: 400, code: "HANDOVER_TARGET" }));
    render(<ShiftHandover venueId={VENUE} meId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand over my shift" }));
    fireEvent.change(await screen.findByLabelText("Hand to"), { target: { value: CALLUM } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "That person does not work this venue's floor.");
  });

  it("says which had moved on meanwhile and were left as they were", async () => {
    mocks.handoverShift.mockResolvedValue({ handedOver: [request("a"), request("b")], refused: 1, toName: "Callum" });
    render(<ShiftHandover venueId={VENUE} meId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand over my shift" }));
    fireEvent.change(await screen.findByLabelText<HTMLSelectElement>("Hand to"), { target: { value: CALLUM } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "Handed 2 requests to Callum. Each stays yours until they take it. One had moved on meanwhile and was left as it was.",
    );
  });

  it("one request reads in the singular", async () => {
    mocks.handoverShift.mockResolvedValue({ handedOver: [request("a")], toName: "Callum" });
    render(<ShiftHandover venueId={VENUE} meId={ME} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand over my shift" }));
    fireEvent.change(await screen.findByLabelText("Hand to"), { target: { value: CALLUM } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Handed 1 request to Callum. Each stays yours until they take it.");
  });
});
