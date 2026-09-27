import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateVenueRequest, VenueRequest } from "@omnitwin/types";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import { RequestsProvider } from "../RequestsProvider.js";
import { SlotRequests } from "../SlotRequests.js";

// The request slab on a Day Board slot, inside the real provider, against a
// mocked request client. What it promises the person holding the phone:
//   - "Send it" either makes the request or says, in that composer, why not,
//     keeping what was chosen and typed so it can be sent again;
//   - sending again after a failure replays the same request (same key), so
//     a lost answer never becomes two requests;
//   - a failure is said where it happened, and nowhere else on the board.

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  make: vi.fn(),
  move: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("../../../api/requests.js", () => ({
  listVenueRequests: mocks.list,
  makeVenueRequest: mocks.make,
  moveVenueRequest: mocks.move,
}));
vi.mock("../../../lib/requests-live.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/requests-live.js")>("../../../lib/requests-live.js");
  return { listensForFloorRequests: actual.listensForFloorRequests, subscribeRequestsLive: mocks.subscribe };
});

const VENUE = "00000000-0000-4000-8000-00000000a001";
const GRAND_HALL = { bookingId: "00000000-0000-4000-8000-0000000000b1", roomId: "00000000-0000-4000-8000-0000000000a1", roomName: "Grand Hall" };
const SALOON = { bookingId: "00000000-0000-4000-8000-0000000000b2", roomId: "00000000-0000-4000-8000-0000000000a2", roomName: "Saloon" };

const hallkeeper: AuthUser = {
  id: "00000000-0000-4000-8000-0000000000ff", name: "Elaine", email: "elaine@example.test",
  role: "hallkeeper", platformRole: "none", venueId: VENUE,
};

function venueRequest(overrides: Partial<VenueRequest> & Pick<VenueRequest, "id" | "bookingId">): VenueRequest {
  return {
    venueId: VENUE,
    eventId: null,
    roomId: GRAND_HALL.roomId,
    roomName: "Grand Hall",
    kind: "refreshments",
    quantity: null,
    urgency: "soon",
    detail: null,
    requestedByUserId: hallkeeper.id,
    requestedByName: "Elaine",
    requestedByRole: "hallkeeper",
    audienceRoles: ["admin", "manager", "staff", "hallkeeper"],
    ownerUserId: null,
    ownerName: null,
    state: "sent",
    outcome: null,
    outcomeNote: null,
    escalationDueAt: null,
    escalatedAt: null,
    acknowledgedAt: null,
    acceptedAt: null,
    resolvedAt: null,
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:00:00.000Z",
    ...overrides,
  };
}

function madeFrom(input: CreateVenueRequest, id: string): VenueRequest {
  return venueRequest({
    id,
    bookingId: input.bookingId ?? null,
    roomId: input.roomId,
    kind: input.kind,
    urgency: input.urgency,
    quantity: input.quantity ?? null,
    detail: input.detail ?? null,
    createdAt: new Date().toISOString(),
  });
}

function slot(room: typeof GRAND_HALL): ReactElement {
  return (
    <SlotRequests
      bookingId={room.bookingId}
      eventId={null}
      roomId={room.roomId}
      roomName={room.roomName}
      startsAtMs={Date.parse("2026-09-26T09:00:00.000Z")}
      endsAtMs={Date.parse("2026-09-26T23:00:00.000Z")}
    />
  );
}

function renderBoard(): void {
  render(
    <RequestsProvider>
      {slot(GRAND_HALL)}
      {slot(SALOON)}
    </RequestsProvider>,
  );
}

function region(room: typeof GRAND_HALL): HTMLElement {
  return screen.getByRole("region", { name: `Requests for ${room.roomName}` });
}

async function openComposer(room: typeof GRAND_HALL): Promise<HTMLElement> {
  const place = await screen.findByRole("region", { name: `Requests for ${room.roomName}` });
  fireEvent.click(within(place).getByRole("button", { name: "Ask for something" }));
  return place;
}

function sentKey(call: number): string {
  const input = mocks.make.mock.calls[call]?.[1] as CreateVenueRequest | undefined;
  if (input === undefined) throw new Error(`No request was made on call ${String(call)}`);
  return input.idempotencyKey;
}

beforeEach(() => {
  // Reset, not clear: an answer queued for one case must never reach the next.
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
  mocks.subscribe.mockReturnValue(() => undefined);
  useAuthStore.getState().setUser(hallkeeper);
});
afterEach(() => { cleanup(); useAuthStore.getState().setUser(null); });

describe("asking for something from a Day Board slot", () => {
  it("keeps a failed ask open, says why there, and sends it again as the same request", async () => {
    mocks.make
      .mockRejectedValueOnce(new Error("The house could not be reached. Try again in a moment."))
      .mockImplementationOnce((_venueId: string, input: CreateVenueRequest) =>
        Promise.resolve(madeFrom(input, "00000000-0000-4000-8000-0000000000d1")));
    renderBoard();
    const hall = await openComposer(GRAND_HALL);

    fireEvent.change(within(hall).getByRole("textbox"), { target: { value: "Two jugs of water" } });
    fireEvent.click(within(hall).getByRole("button", { name: "Send it" }));

    const alert = await within(hall).findByRole("alert");
    expect(alert.textContent).toBe("The house could not be reached. Try again in a moment.");
    // Still open, still holding what was typed: nothing to write twice.
    expect(within(hall).getByRole("textbox")).toHaveProperty("value", "Two jugs of water");

    fireEvent.click(within(hall).getByRole("button", { name: "Send it" }));
    await waitFor(() => {
      expect(within(hall).getByRole("button", { name: "Ask for something" })).toBeTruthy();
    });
    expect(mocks.make).toHaveBeenCalledTimes(2);
    expect(sentKey(1)).toBe(sentKey(0));
    expect(within(hall).queryByRole("alert")).toBeNull();
    expect(within(hall).getByText("Two jugs of water")).toBeTruthy();
  });

  it("says a failed ask only in the composer that sent it", async () => {
    mocks.make.mockRejectedValueOnce(new Error("The house could not be reached. Try again in a moment."));
    renderBoard();
    const hall = await openComposer(GRAND_HALL);
    const saloon = await openComposer(SALOON);

    fireEvent.click(within(hall).getByRole("button", { name: "Send it" }));

    await within(hall).findByRole("alert");
    expect(within(saloon).queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("says Sending… only in the composer that is sending, and sends once however often it is pressed", async () => {
    let answer: (made: VenueRequest) => void = () => undefined;
    mocks.make.mockImplementationOnce(() => new Promise<VenueRequest>((resolve) => { answer = resolve; }));
    renderBoard();
    const hall = await openComposer(GRAND_HALL);
    const saloon = await openComposer(SALOON);

    fireEvent.click(within(hall).getByRole("button", { name: "Send it" }));
    fireEvent.click(within(hall).getByRole("button", { name: "Sending…" }));

    expect(within(hall).getByRole("button", { name: "Sending…" })).toHaveProperty("disabled", true);
    expect(within(saloon).getByRole("button", { name: "Send it" })).toHaveProperty("disabled", false);
    expect(mocks.make).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer(venueRequest({ id: "00000000-0000-4000-8000-0000000000d2", bookingId: GRAND_HALL.bookingId }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(within(hall).getByRole("button", { name: "Ask for something" })).toBeTruthy();
    });
    expect(within(saloon).getByRole("button", { name: "Send it" })).toBeTruthy();
  });
});

describe("when the venue's requests cannot be loaded", () => {
  it("says so on every slot rather than showing rooms where nothing was asked, and tries again", async () => {
    let answer: (snapshot: readonly VenueRequest[]) => void = () => undefined;
    mocks.list
      .mockRejectedValueOnce(new Error("Network error — check your connection"))
      .mockImplementationOnce(() => new Promise<readonly VenueRequest[]>((resolve) => { answer = resolve; }));
    renderBoard();

    const said = await screen.findAllByText("This room’s requests could not be loaded just now.");
    expect(said).toHaveLength(2);
    const hall = region(GRAND_HALL);

    fireEvent.click(within(hall).getByRole("button", { name: "Try again" }));
    expect(within(hall).getByRole("status").textContent).toBe("Loading requests…");
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      answer([venueRequest({ id: "00000000-0000-4000-8000-0000000000f1", bookingId: GRAND_HALL.bookingId })]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText("This room’s requests could not be loaded just now.")).toBeNull();
    });
    expect(within(hall).queryByRole("status")).toBeNull();
    expect(within(hall).getByText("Refreshments")).toBeTruthy();
  });
});

describe("moving a request on the slab", () => {
  it("says a failed step on that request's card and on no other", async () => {
    const first = venueRequest({ id: "00000000-0000-4000-8000-0000000000e1", bookingId: GRAND_HALL.bookingId, kind: "refreshments" });
    const second = venueRequest({ id: "00000000-0000-4000-8000-0000000000e2", bookingId: GRAND_HALL.bookingId, kind: "cleaning", createdAt: "2026-09-26T09:30:00.000Z" });
    mocks.list.mockResolvedValue([first, second]);
    mocks.move.mockRejectedValueOnce(new Error("Somebody has already taken this one."));
    renderBoard();

    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    const cards = await within(hall).findAllByRole("listitem");
    const cleaning = cards.find((card) => card.textContent?.includes("Cleaning") === true);
    const refreshments = cards.find((card) => card.textContent?.includes("Refreshments") === true);
    if (cleaning === undefined || refreshments === undefined) throw new Error("Both cards should be on the slab");

    fireEvent.click(within(cleaning).getByRole("button", { name: "Seen" }));

    expect(await within(cleaning).findByRole("alert")).toBeTruthy();
    expect(within(cleaning).getByRole("alert").textContent).toBe("Somebody has already taken this one.");
    expect(within(refreshments).queryByRole("alert")).toBeNull();
    expect(within(region(SALOON)).queryByRole("alert")).toBeNull();
  });
});
