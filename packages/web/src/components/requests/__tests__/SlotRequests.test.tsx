import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateVenueRequest, RequestTransition, VenueRequest } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import {
  enqueueEventDayRequestStep,
  listPendingEventDayOps,
  type EventDayOpOutcome,
  type QueuedEventDayOp,
  type RequestStepInput,
} from "../../../lib/event-day-offline-queue.js";
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
  handlers: vi.fn(),
  threads: vi.fn(),
  messages: vi.fn(),
  openThread: vi.fn(),
  sendMessage: vi.fn(),
  markReceipt: vi.fn(),
}));
vi.mock("../../../api/requests.js", () => ({
  listVenueRequests: mocks.list,
  makeVenueRequest: mocks.make,
  moveVenueRequest: mocks.move,
  listVenueHandlers: mocks.handlers,
}));
// The slot's conversation (goal 19 S4) sits in the same region; here it is
// quiet so the slab's own promises are what is proved.
vi.mock("../../../api/conversations.js", () => ({
  listThreads: mocks.threads,
  listMessages: mocks.messages,
  openThread: mocks.openThread,
  sendMessage: mocks.sendMessage,
  markReceipt: mocks.markReceipt,
}));
// L9: the real offline queue (its ordering, keys and acks), over an
// in-memory store that each case starts empty.
const queueSeam = vi.hoisted(() => ({ reset: (): void => undefined }));
vi.mock("../../../lib/event-day-offline-queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/event-day-offline-queue.js")>();
  const cache = await import("../../../lib/idb-cache.js");
  const fresh = () => actual.createEventDayQueue(cache.withBackend<QueuedEventDayOp>(cache.memoryBackend()));
  let queue = fresh();
  queueSeam.reset = () => { queue = fresh(); };
  return {
    ...actual,
    enqueueEventDayRequestStep: (step: RequestStepInput) => queue.enqueueRequestStep(step),
    listPendingEventDayOps: () => queue.list(),
    drainEventDayOps: (perform: (op: QueuedEventDayOp) => Promise<EventDayOpOutcome>) => queue.drain(perform),
  };
});
vi.mock("../../../lib/requests-live.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/requests-live.js")>("../../../lib/requests-live.js");
  // The conversation hook reads the cursor from the same module: keep the
  // real exports and replace only the subscription.
  return { ...actual, subscribeRequestsLive: mocks.subscribe };
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
    threadId: null,
    handoverToUserId: null,
    handoverToName: null,
    handedOverAt: null,
    underwayAt: null,
    reopenedAt: null,
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
  queueSeam.reset();
  mocks.list.mockResolvedValue([]);
  mocks.subscribe.mockReturnValue(() => undefined);
  mocks.handlers.mockResolvedValue([]);
  mocks.threads.mockResolvedValue([]);
  mocks.messages.mockResolvedValue({ thread: null, messages: [], cursor: 0, serverNowMs: Date.now() });
  useAuthStore.getState().setUser(hallkeeper);
});
afterEach(() => { cleanup(); useAuthStore.getState().setUser(null); });

const FIONA = { id: "00000000-0000-4000-8000-0000000000f1", name: "Fiona", role: "staff" as const };
const GRAHAM_BOOKING = GRAND_HALL.bookingId;
const GRAHAM = { id: "00000000-0000-4000-8000-0000000000f2", name: "Graham", role: "hallkeeper" as const };

// Goal 19 S4: the longer ladder from the slab — hand over to a named
// colleague, finish another way with a note, and a handover that is only for
// the person it was handed to.
describe("handing over and finishing another way", () => {
  it("hands a request over to a named colleague, never to yourself", async () => {
    const owned = venueRequest({
      id: "00000000-0000-4000-8000-0000000000e3", bookingId: GRAND_HALL.bookingId, kind: "chairs", quantity: 10,
      state: "accepted", ownerUserId: hallkeeper.id, ownerName: "Elaine", acceptedAt: "2026-09-26T10:01:00.000Z",
    });
    mocks.list.mockResolvedValue([owned]);
    mocks.handlers.mockResolvedValue([{ id: hallkeeper.id, name: "Elaine", role: "hallkeeper" }, FIONA, GRAHAM]);
    mocks.move.mockResolvedValueOnce({ ...owned, state: "handed-over", handoverToUserId: FIONA.id, handoverToName: "Fiona", handedOverAt: "2026-09-26T10:05:00.000Z" });
    renderBoard();

    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "Hand over" }));
    const picker = await within(hall).findByLabelText("Hand to");
    const names = Array.from((picker as HTMLSelectElement).options).map((option) => option.textContent);
    expect(names).toEqual(["Choose a colleague", "Fiona", "Graham"]);
    expect(within(hall).getByRole("button", { name: "Hand it over" })).toHaveProperty("disabled", true);

    fireEvent.change(picker, { target: { value: FIONA.id } });
    fireEvent.click(within(hall).getByRole("button", { name: "Hand it over" }));
    await waitFor(() => { expect(mocks.move).toHaveBeenCalledWith(owned.id, { to: "handed-over", toUserId: FIONA.id }, expect.any(String)); });
    expect(await within(hall).findByText("Elaine is handing this to Fiona.")).toBeTruthy();
  });

  it("finishes a request another way, with the note the client will read", async () => {
    const owned = venueRequest({
      id: "00000000-0000-4000-8000-0000000000e4", bookingId: GRAND_HALL.bookingId, kind: "chairs", quantity: 10,
      state: "accepted", ownerUserId: hallkeeper.id, ownerName: "Elaine",
    });
    mocks.list.mockResolvedValue([owned]);
    mocks.move.mockResolvedValueOnce({ ...owned, state: "resolved", outcome: "substituted", outcomeNote: "Benches instead." });
    renderBoard();

    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "Finish" }));
    fireEvent.click(within(hall).getByRole("button", { name: "Done another way" }));
    const finish = within(hall).getByRole("button", { name: "Finish" });
    expect(finish).toHaveProperty("disabled", true);
    fireEvent.change(within(hall).getByLabelText("What was done instead"), { target: { value: "Benches instead." } });
    fireEvent.click(finish);
    await waitFor(() => {
      expect(mocks.move).toHaveBeenCalledWith(owned.id, { to: "resolved", outcome: "substituted", note: "Benches instead." }, expect.any(String));
    });
  });

  it("offers I’ll do it on a handover only to the person it was handed to", async () => {
    const toMe = venueRequest({
      id: "00000000-0000-4000-8000-0000000000e5", bookingId: GRAND_HALL.bookingId, kind: "chairs", quantity: 4,
      state: "handed-over", ownerUserId: FIONA.id, ownerName: "Fiona", handoverToUserId: hallkeeper.id, handoverToName: "Elaine",
    });
    const toGraham = venueRequest({
      id: "00000000-0000-4000-8000-0000000000e6", bookingId: SALOON.bookingId, roomId: SALOON.roomId, roomName: "Saloon", kind: "av",
      state: "handed-over", ownerUserId: FIONA.id, ownerName: "Fiona", handoverToUserId: GRAHAM.id, handoverToName: "Graham",
      createdAt: "2026-09-26T09:30:00.000Z",
    });
    mocks.list.mockResolvedValue([toMe, toGraham]);
    renderBoard();

    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    expect(await within(hall).findByText("Fiona handed this to you.")).toBeTruthy();
    expect(within(hall).getByRole("button", { name: "I’ll do it" })).toBeTruthy();

    const saloon = screen.getByRole("region", { name: "Requests for Saloon" });
    expect(await within(saloon).findByText("Fiona is handing this to Graham.")).toBeTruthy();
    expect(within(saloon).queryByRole("button", { name: "I’ll do it" })).toBeNull();
    // Nobody else starts or hands over what they do not own.
    expect(within(saloon).queryByRole("button", { name: "On it" })).toBeNull();
    expect(within(saloon).queryByRole("button", { name: "Hand over" })).toBeNull();
  });
});

describe("asking for something from a Day Board slot", () => {
  it("keeps a failed ask open, says why there, and sends it again as the same request", async () => {
    mocks.make
      .mockRejectedValueOnce(new Error("The house could not be reached. Try again in a moment."))
      .mockImplementationOnce((_venueId: string, input: CreateVenueRequest) =>
        Promise.resolve(madeFrom(input, "00000000-0000-4000-8000-0000000000d1")));
    renderBoard();
    const hall = await openComposer(GRAND_HALL);

    // The composer's own field: the slot's conversation (goal 19 S4) keeps a
    // textbox of its own in the same region.
    fireEvent.change(within(hall).getByRole("textbox", { name: "Anything to add" }), { target: { value: "Two jugs of water" } });
    fireEvent.click(within(hall).getByRole("button", { name: "Send it" }));

    const alert = await within(hall).findByRole("alert");
    expect(alert.textContent).toBe("The house could not be reached. Try again in a moment.");
    // Still open, still holding what was typed: nothing to write twice.
    expect(within(hall).getByRole("textbox", { name: "Anything to add" })).toHaveProperty("value", "Two jugs of water");

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
    // The region also holds the conversation's live announcer (goal 19 S4),
    // so the working state is found by its words.
    const working = (): string[] => within(hall).getAllByRole("status").map((element) => element.textContent ?? "");
    expect(working()).toContain("Loading requests…");
    expect(mocks.list).toHaveBeenCalledTimes(2);

    await act(async () => {
      answer([venueRequest({ id: "00000000-0000-4000-8000-0000000000f1", bookingId: GRAND_HALL.bookingId })]);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText("This room’s requests could not be loaded just now.")).toBeNull();
    });
    expect(working()).not.toContain("Loading requests…");
    expect(within(hall).getByText("Refreshments")).toBeTruthy();
  });
});

describe("moving a request on the slab", () => {
  it("says a failed step on that request's card and on no other", async () => {
    const first = venueRequest({ id: "00000000-0000-4000-8000-0000000000e1", bookingId: GRAND_HALL.bookingId, kind: "refreshments" });
    const second = venueRequest({ id: "00000000-0000-4000-8000-0000000000e2", bookingId: GRAND_HALL.bookingId, kind: "cleaning", createdAt: "2026-09-26T09:30:00.000Z" });
    mocks.list.mockResolvedValue([first, second]);
    mocks.move.mockRejectedValueOnce(new ApiError(409, "Somebody has already taken this one.", "REQUEST_TAKEN"));
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

// L9: request steps through the event-day offline queue. A step pressed with
// no connection waits under the key it was pressed with, said beside its card
// and never shown as done; the queue replays it, in the order pressed, when
// the browser or the socket comes back; and whatever the replay could not do
// is said on the slot, in plain words.
describe("steps pressed with no connection", () => {
  const OFFLINE = (): ApiError => new ApiError(0, "Network error — check your connection", "NETWORK_ERROR");
  const chairs = (overrides: Partial<VenueRequest> = {}): VenueRequest => venueRequest({
    id: "00000000-0000-4000-8000-0000000000c1", bookingId: GRAND_HALL.bookingId, kind: "chairs", quantity: 10, ...overrides,
  });

  function keyOf(call: number): string {
    const key = mocks.move.mock.calls[call]?.[2] as string | undefined;
    if (key === undefined) throw new Error(`No step was sent on call ${String(call)}`);
    return key;
  }

  function stepOf(call: number): RequestTransition | undefined {
    return mocks.move.mock.calls[call]?.[1] as RequestTransition | undefined;
  }

  /** What the replay could not do: each a card of its own, read politely. */
  function noticesIn(place: HTMLElement): readonly HTMLElement[] {
    return [...place.querySelectorAll<HTMLElement>(".vv-request-notice")];
  }

  async function noticeIn(place: HTMLElement): Promise<HTMLElement> {
    await waitFor(() => { expect(noticesIn(place).length).toBeGreaterThan(0); });
    const card = noticesIn(place)[0];
    if (card === undefined) throw new Error("A notice is a card of its own");
    expect(card.getAttribute("role")).toBe("status");
    return card;
  }

  async function backOnline(): Promise<void> {
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
  }

  it("keeps a step that could not be sent, under its own key, and sends that same press once the connection is back", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValueOnce(OFFLINE());
    renderBoard();

    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "Seen" }));

    expect(await within(hall).findByText("Waiting to send: Seen")).toBeTruthy();
    // Not shown as done, because it is not: the card still says what the server says.
    expect(within(hall).queryByText(/· Seen/u)).toBeNull();
    expect(within(hall).queryByRole("alert")).toBeNull();
    const pressed = keyOf(0);
    expect(pressed).toMatch(/^[0-9a-f-]{36}$/u);
    const waiting = await listPendingEventDayOps();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({
      kind: "request_step", requestId: request.id, commandId: pressed, transition: { to: "acknowledged" },
      authorUserId: hallkeeper.id, authorName: "Elaine", summary: "Chairs × 10", bookingId: GRAND_HALL.bookingId,
    });

    const seen = { ...request, state: "acknowledged" as const, acknowledgedAt: "2026-09-26T10:02:00.000Z" };
    mocks.move.mockResolvedValueOnce(seen);
    mocks.list.mockResolvedValue([seen]);
    await backOnline();

    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(2); });
    // The replay is the same press: the same request, step and key, and the
    // state it was pressed against. The press itself carried no expectation.
    expect(mocks.move.mock.calls[1]?.[0]).toBe(request.id);
    expect(stepOf(0)).toEqual({ to: "acknowledged" });
    expect(stepOf(1)).toEqual({ to: "acknowledged", expectedState: "sent", expectedOwnerUserId: null });
    expect(keyOf(1)).toBe(pressed);
    await waitFor(() => { expect(within(hall).queryByText("Waiting to send: Seen")).toBeNull(); });
    expect(await listPendingEventDayOps()).toEqual([]);
    expect(noticesIn(hall)).toHaveLength(0);
  });

  it("offers the next step after one still waiting, and replays them in the order they were pressed", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValue(OFFLINE());
    renderBoard();

    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "Seen" }));
    await within(hall).findByText("Waiting to send: Seen");
    // "Seen" is pressed already; the slab offers what comes after it.
    expect(within(hall).queryByRole("button", { name: "Seen" })).toBeNull();
    fireEvent.click(within(hall).getByRole("button", { name: "I’ll do it" }));
    expect(await within(hall).findByText("Waiting to send: Seen · I’ll do it")).toBeTruthy();
    // Still the server's word on the card: nobody owns it yet.
    expect(within(hall).queryByText(/· Elaine$/u)).toBeNull();

    const sentBeforeReconnect = mocks.move.mock.calls.length;
    const accepted = { ...request, state: "accepted" as const, ownerUserId: hallkeeper.id, ownerName: "Elaine" };
    mocks.move.mockReset();
    mocks.move
      .mockResolvedValueOnce({ ...request, state: "acknowledged" as const })
      .mockResolvedValueOnce(accepted);
    mocks.list.mockResolvedValue([accepted]);
    await backOnline();

    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(2); });
    // Each pressed against the state the one before it left.
    expect([stepOf(0), stepOf(1)]).toEqual([
      { to: "acknowledged", expectedState: "sent", expectedOwnerUserId: null },
      { to: "accepted", expectedState: "acknowledged", expectedOwnerUserId: null },
    ]);
    expect(keyOf(0)).not.toBe(keyOf(1));
    expect(sentBeforeReconnect).toBeGreaterThanOrEqual(1);
    await waitFor(() => { expect(within(hall).queryByText(/Waiting to send/u)).toBeNull(); });
    expect(await listPendingEventDayOps()).toEqual([]);
  });

  it("sends a step the server already had as the same key again, and shows it once", async () => {
    // The first send reached the server; its answer was lost on the way back.
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValueOnce(OFFLINE());
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "I’ll do it" }));
    await within(hall).findByText("Waiting to send: I’ll do it");

    // The server answers the replay from its ledger: the step it already took.
    const accepted = { ...request, state: "accepted" as const, ownerUserId: hallkeeper.id, ownerName: "Elaine" };
    mocks.move.mockResolvedValueOnce(accepted);
    mocks.list.mockResolvedValue([accepted]);
    await backOnline();
    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(2); });
    expect(keyOf(1)).toBe(keyOf(0));

    // A second reconnect finds nothing waiting and sends nothing.
    await backOnline();
    await waitFor(() => { expect(within(hall).queryByText(/Waiting to send/u)).toBeNull(); });
    expect(mocks.move).toHaveBeenCalledTimes(2);
    expect(await listPendingEventDayOps()).toEqual([]);
  });

  it("says on the slot, by name, that someone else took it first, and puts the step away", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValueOnce(OFFLINE());
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "I’ll do it" }));
    await within(hall).findByText("Waiting to send: I’ll do it");

    const graham = { ...request, state: "accepted" as const, ownerUserId: GRAHAM.id, ownerName: "Graham" };
    mocks.move.mockRejectedValueOnce(new ApiError(409, "Graham has this.", "REQUEST_TAKEN"));
    mocks.list.mockResolvedValue([graham]);
    const listedBefore = mocks.list.mock.calls.length;
    await backOnline();

    const notice = await noticeIn(hall);
    expect(notice.textContent).toContain("Your “I’ll do it” on Chairs × 10 was not sent. Graham has this.");
    // The server's word is read again: the card names the owner, and nothing waits.
    await waitFor(() => { expect(mocks.list.mock.calls.length).toBeGreaterThan(listedBefore); });
    expect(await within(hall).findByText(/Graham/u, { selector: ".vv-request-who" })).toBeTruthy();
    expect(within(hall).queryByText(/Waiting to send/u)).toBeNull();
    expect(await listPendingEventDayOps()).toEqual([]);
    // Said on its own slot only, and put away when read.
    expect(noticesIn(region(SALOON))).toHaveLength(0);
    fireEvent.click(within(notice).getByRole("button", { name: "OK" }));
    expect(noticesIn(hall)).toHaveLength(0);
  });

  it("refuses for good a step whose sender may no longer act on the venue's requests, and says so", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValueOnce(OFFLINE());
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "Seen" }));
    await within(hall).findByText("Waiting to send: Seen");

    mocks.move.mockRejectedValueOnce(new ApiError(403, "Forbidden", "FORBIDDEN"));
    await backOnline();

    const notice = await noticeIn(hall);
    // It may have landed before access went: "not confirmed", never "not sent".
    expect(notice.textContent).toContain("Your “Seen” on Chairs × 10 could not be confirmed: this account can no longer act on this venue’s requests.");
    expect(await listPendingEventDayOps()).toEqual([]);
    // Refused for good: another reconnect sends nothing.
    await backOnline();
    expect(mocks.move).toHaveBeenCalledTimes(2);
  });

  it("keeps a step waiting while the session must be renewed, and stops there so the order holds", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValue(OFFLINE());
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "Seen" }));
    await within(hall).findByText("Waiting to send: Seen");
    fireEvent.click(within(hall).getByRole("button", { name: "I’ll do it" }));
    await within(hall).findByText("Waiting to send: Seen · I’ll do it");

    mocks.move.mockReset();
    mocks.move.mockRejectedValue(new ApiError(401, "Session expired — please sign in again", "UNAUTHORIZED"));
    await backOnline();
    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(1); });
    // The first stopped the replay; the second was never sent ahead of it.
    expect(stepOf(0)).toEqual({ to: "acknowledged", expectedState: "sent", expectedOwnerUserId: null });
    expect(within(hall).getByText("Waiting to send: Seen · I’ll do it")).toBeTruthy();
    expect(noticesIn(hall)).toHaveLength(0);
    expect(await listPendingEventDayOps()).toHaveLength(2);
  });

  it("never sends a colleague's waiting step in the name of whoever is signed in now", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    await enqueueEventDayRequestStep({
      venueId: VENUE, requestId: request.id, bookingId: GRAND_HALL.bookingId, summary: "Chairs × 10",
      transition: { to: "accepted" }, expectedState: "sent", expectedOwnerUserId: null, commandId: "00000000-0000-4000-8000-0000000000d9",
      authorUserId: GRAHAM.id, authorName: "Graham",
    });
    renderBoard();

    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    expect(await within(hall).findByText("Waiting for Graham to sign in on this device: I’ll do it")).toBeTruthy();
    await backOnline();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(await listPendingEventDayOps()).toHaveLength(1);
    // Elaine is offered her own steps from the server's state, not Graham's,
    // and her own press goes at once: his waiting step holds nothing back.
    mocks.move.mockResolvedValueOnce({ ...request, state: "acknowledged" as const });
    fireEvent.click(within(hall).getByRole("button", { name: "Seen" }));
    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(1); });
    expect(stepOf(0)).toEqual({ to: "acknowledged" });
    const left = await listPendingEventDayOps();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ authorUserId: GRAHAM.id, transition: { to: "accepted" } });
  });

  it("never sends a step pressed on top of one the server refused: a kept Done does not close a colleague's work", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValue(OFFLINE());
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "I’ll do it" }));
    await within(hall).findByText("Waiting to send: I’ll do it");
    fireEvent.click(within(hall).getByRole("button", { name: "Finish" }));
    fireEvent.click(within(hall).getByRole("button", { name: "Done" }));
    await within(hall).findByText("Waiting to send: I’ll do it · Done");

    // Graham took it while this phone was in the cellar.
    mocks.move.mockReset();
    mocks.move.mockRejectedValueOnce(new ApiError(409, "Graham has this.", "REQUEST_TAKEN"));
    mocks.list.mockResolvedValue([{ ...request, state: "accepted" as const, ownerUserId: GRAHAM.id, ownerName: "Graham" }]);
    await backOnline();

    await waitFor(() => { expect(noticesIn(hall)).toHaveLength(2); });
    // Only the accept was asked; the Done behind it never left the phone.
    expect(mocks.move).toHaveBeenCalledTimes(1);
    expect(stepOf(0)).toEqual({ to: "accepted", expectedState: "sent", expectedOwnerUserId: null });
    expect(hall.textContent).toContain("Your “I’ll do it” on Chairs × 10 was not sent. Graham has this.");
    expect(hall.textContent).toContain("Your “Done” on Chairs × 10 was not sent: the step before it was not.");
    expect(await listPendingEventDayOps()).toEqual([]);
  });

  it("sends a kept Done in a later replay with the owner it was pressed against, so the server can refuse it", async () => {
    // The refusal and the Done behind it land in different replays: the
    // signal drops on another request in between, so this replay's memory of
    // the refusal is gone when the Done is sent. The Done names the owner it
    // was pressed against (Elaine), which Graham's request does not have.
    const chairsReq = chairs();
    const tablesReq = chairs({ id: "00000000-0000-4000-8000-0000000000c2", kind: "tables", quantity: 2, createdAt: "2026-09-26T09:30:00.000Z" });
    mocks.list.mockResolvedValue([chairsReq, tablesReq]);
    mocks.move.mockRejectedValue(OFFLINE());
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    const cardFor = (words: string): HTMLElement => {
      const card = within(hall).getAllByRole("listitem").find((item) => (item.textContent ?? "").includes(words));
      if (card === undefined) throw new Error(`No card for ${words}`);
      return card;
    };
    await within(hall).findByText(/Tables × 2/u);
    fireEvent.click(within(cardFor("Chairs × 10")).getByRole("button", { name: "I’ll do it" }));
    await within(cardFor("Chairs × 10")).findByText("Waiting to send: I’ll do it");
    fireEvent.click(within(cardFor("Tables × 2")).getByRole("button", { name: "Seen" }));
    await within(cardFor("Tables × 2")).findByText("Waiting to send: Seen");
    fireEvent.click(within(cardFor("Chairs × 10")).getByRole("button", { name: "Finish" }));
    fireEvent.click(within(cardFor("Chairs × 10")).getByRole("button", { name: "Done" }));
    await within(cardFor("Chairs × 10")).findByText("Waiting to send: I’ll do it · Done");

    // Graham took the chairs; the tables step loses its signal once.
    let tablesDrops = 1;
    mocks.move.mockReset();
    mocks.move.mockImplementation((id: string, transition: RequestTransition) => {
      if (id === tablesReq.id) {
        if (tablesDrops > 0) { tablesDrops -= 1; return Promise.reject(OFFLINE()); }
        return Promise.resolve({ ...tablesReq, state: "acknowledged" as const });
      }
      if (transition.to === "accepted") return Promise.reject(new ApiError(409, "Graham has this.", "REQUEST_TAKEN"));
      return Promise.reject(new ApiError(409, "Graham has this now.", "REQUEST_STATE_CONFLICT"));
    });
    mocks.list.mockResolvedValue([{ ...chairsReq, state: "accepted" as const, ownerUserId: GRAHAM.id, ownerName: "Graham" }, tablesReq]);
    await backOnline();
    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(2); });
    await backOnline();
    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(4); });

    // The Done went in the second replay, pressed against Elaine's accepted.
    expect(mocks.move.mock.calls[3]?.[0]).toBe(chairsReq.id);
    expect(stepOf(3)).toEqual({ to: "resolved", outcome: "done", expectedState: "accepted", expectedOwnerUserId: hallkeeper.id });
    await waitFor(() => { expect(hall.textContent).toContain("Your “Done” on Chairs × 10 was not sent. Graham has this now."); });
    expect(hall.textContent).toContain("Your “I’ll do it” on Chairs × 10 was not sent. Graham has this.");
    expect(await listPendingEventDayOps()).toEqual([]);
  });

  it("stops sending a person's kept steps the moment someone else is signed in", async () => {
    const first = chairs();
    const second = chairs({ id: "00000000-0000-4000-8000-0000000000c2", kind: "tables", quantity: 2, createdAt: "2026-09-26T09:30:00.000Z" });
    mocks.list.mockResolvedValue([first, second]);
    mocks.move.mockRejectedValue(OFFLINE());
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    const cards = await within(hall).findAllByRole("listitem");
    for (const card of cards) fireEvent.click(within(card).getByRole("button", { name: "Seen" }));
    await waitFor(async () => { expect(await listPendingEventDayOps()).toHaveLength(2); });

    // The phone changes hands while the first replay is in flight.
    mocks.move.mockReset();
    mocks.move.mockImplementationOnce(() => {
      useAuthStore.getState().setUser({ ...hallkeeper, id: GRAHAM.id, name: "Graham" });
      return Promise.resolve({ ...first, state: "acknowledged" as const });
    });
    await backOnline();
    await waitFor(() => { expect(mocks.move).toHaveBeenCalledTimes(1); });
    await act(async () => { await new Promise((settle) => { setTimeout(settle, 50); }); });
    expect(mocks.move).toHaveBeenCalledTimes(1);
    const left = await listPendingEventDayOps();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ authorUserId: hallkeeper.id });
  });

  it("puts away a kept step it cannot read, says so, and still draws the board", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    const kept: RequestStepInput = {
      venueId: VENUE, requestId: request.id, bookingId: GRAHAM_BOOKING, summary: "Chairs × 10",
      transition: { to: "acknowledged" }, expectedState: "sent", expectedOwnerUserId: null,
      commandId: "00000000-0000-4000-8000-0000000000d8", authorUserId: hallkeeper.id, authorName: "Elaine",
    };
    // A step another version of the page kept, which this one does not know:
    // what the store hands back, not what this bundle's types allow.
    Reflect.set(kept, "transition", { to: "teleported" });
    await enqueueEventDayRequestStep(kept);
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    expect(await within(hall).findByRole("button", { name: "Seen" })).toBeTruthy();
    expect(within(hall).queryByText(/Waiting to send/u)).toBeNull();
    expect((await noticeIn(hall)).textContent).toContain("could not be read, so it was not sent");
    expect(mocks.move).not.toHaveBeenCalled();
    expect(await listPendingEventDayOps()).toEqual([]);
  });

  it("says a refusal that is not about the connection on the card at once, and keeps nothing", async () => {
    const request = chairs();
    mocks.list.mockResolvedValue([request]);
    mocks.move.mockRejectedValueOnce(new ApiError(409, "Graham has this.", "REQUEST_TAKEN"));
    renderBoard();
    const hall = await screen.findByRole("region", { name: "Requests for Grand Hall" });
    fireEvent.click(await within(hall).findByRole("button", { name: "I’ll do it" }));
    expect((await within(hall).findByRole("alert")).textContent).toBe("Graham has this.");
    expect(within(hall).queryByText(/Waiting to send/u)).toBeNull();
    expect(await listPendingEventDayOps()).toEqual([]);
  });
});
