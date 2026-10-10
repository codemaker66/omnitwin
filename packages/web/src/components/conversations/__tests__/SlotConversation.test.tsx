import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, Thread, VenueRequest } from "@omnitwin/types";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import type { RequestsLiveEvent } from "../../../lib/requests-live.js";
import { SlotConversation, receiptLine } from "../SlotConversation.js";

// ---------------------------------------------------------------------------
// The slot's conversation (goal 19 S4). What it promises the person holding
// the phone: the floor's thread opens on the first note and a resend after a
// failure is the same message; a client-facing thread is badged and nothing
// else is; a message is marked read once, as a fact, and never twice; a tick
// appears only on your own messages and only from the server's receipts; a
// live nudge fetches forward and says so once.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  threads: vi.fn(),
  messages: vi.fn(),
  openThread: vi.fn(),
  sendMessage: vi.fn(),
  markReceipt: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("../../../api/conversations.js", () => ({
  listThreads: mocks.threads,
  listMessages: mocks.messages,
  openThread: mocks.openThread,
  sendMessage: mocks.sendMessage,
  markReceipt: mocks.markReceipt,
}));
vi.mock("../../../lib/requests-live.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/requests-live.js")>("../../../lib/requests-live.js");
  return { ...actual, subscribeRequestsLive: mocks.subscribe };
});

const VENUE = "00000000-0000-4000-8000-00000000a001";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const REQUEST = "00000000-0000-4000-8000-0000000000d1";
const FLOOR_THREAD = "00000000-0000-4000-8000-00000000c001";
const REQUEST_THREAD = "00000000-0000-4000-8000-00000000c002";
const MORAG = "00000000-0000-4000-8000-0000000000aa";
const FIONA = "00000000-0000-4000-8000-0000000000f1";

const elaine: AuthUser = {
  id: "00000000-0000-4000-8000-0000000000ff", name: "Elaine", email: "elaine@example.test",
  role: "hallkeeper", platformRole: "none", venueId: VENUE,
};

function thread(over: Partial<Thread> & Pick<Thread, "id" | "audience" | "subject">): Thread {
  return {
    venueId: VENUE, bookingId: BOOKING, eventId: null, requestId: null, subjectUserId: null, title: null,
    createdByUserId: null, messageCount: 0, lastMessageAt: null, lastCursor: 0, createdAt: "2026-10-10T09:00:00.000Z", ...over,
  };
}

function message(over: Partial<Message> & Pick<Message, "id" | "threadId" | "cursor">): Message {
  return {
    kind: "text", authorUserId: MORAG, authorName: "Morag", authorRole: "client",
    body: "Could we have ten more chairs?", createdAt: "2026-10-10T09:05:00.000Z", receipts: [], ...over,
  };
}

function page(threadRow: Thread, rows: readonly Message[]): { thread: Thread; messages: readonly Message[]; cursor: number; serverNowMs: number } {
  const last = rows[rows.length - 1];
  return { thread: threadRow, messages: rows, cursor: last?.cursor ?? 0, serverNowMs: Date.now() };
}

const chairs: VenueRequest = {
  id: REQUEST, venueId: VENUE, bookingId: BOOKING, eventId: null, roomId: "00000000-0000-4000-8000-0000000000a1", roomName: "Grand Hall",
  kind: "chairs", quantity: 10, urgency: "soon", detail: null, requestedByUserId: MORAG, requestedByName: "Morag", requestedByRole: "client",
  audienceRoles: ["admin", "manager", "staff", "hallkeeper"], ownerUserId: null, ownerName: null, state: "sent", outcome: null, outcomeNote: null,
  escalationDueAt: null, escalatedAt: null, acknowledgedAt: null, acceptedAt: null, resolvedAt: null, threadId: REQUEST_THREAD,
  handoverToUserId: null, handoverToName: null, handedOverAt: null, underwayAt: null, reopenedAt: null,
  createdAt: "2026-10-10T09:04:00.000Z", updatedAt: "2026-10-10T09:04:00.000Z",
};

const listeners = new Set<(event: RequestsLiveEvent) => void>();

beforeEach(() => {
  vi.resetAllMocks();
  listeners.clear();
  mocks.subscribe.mockImplementation((listener: (event: RequestsLiveEvent) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  });
  mocks.threads.mockResolvedValue([]);
  mocks.markReceipt.mockResolvedValue({});
  useAuthStore.getState().setUser(elaine);
});
afterEach(() => { cleanup(); useAuthStore.getState().setUser(null); });

function renderSlot(requests: readonly VenueRequest[] = []): void {
  render(<SlotConversation bookingId={BOOKING} roomName="Grand Hall" requests={requests} />);
}

describe("the floor's notes", () => {
  it("opens the floor's thread on the first note and resends a failed note as the same message", async () => {
    const floor = thread({ id: FLOOR_THREAD, audience: "staff-private", subject: "booking" });
    mocks.openThread.mockResolvedValue(floor);
    mocks.messages.mockResolvedValue(page(floor, []));
    mocks.sendMessage
      .mockRejectedValueOnce(new Error("The house could not be reached."))
      .mockImplementationOnce((_threadId: string, input: { body: string; idempotencyKey: string }) =>
        Promise.resolve(message({ id: "00000000-0000-4000-8000-00000000e001", threadId: FLOOR_THREAD, cursor: 1, authorUserId: elaine.id, authorName: "Elaine", authorRole: "hallkeeper", body: input.body })));
    renderSlot();

    expect(await screen.findByText("No notes yet. The first one opens the floor’s thread for this slot.")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Floor notes" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByLabelText("Note to the floor"), { target: { value: "Doors at six, chairs out by five." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The house could not be reached.");
    expect(screen.getByLabelText("Note to the floor")).toHaveProperty("value", "Doors at six, chairs out by five.");
    expect(mocks.openThread).toHaveBeenCalledWith(VENUE, { audience: "staff-private", subject: "booking", bookingId: BOOKING });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const list = await screen.findByRole("list", { name: "Messages" });
    expect(within(list).getByText("Doors at six, chairs out by five.")).toBeTruthy();
    expect(mocks.openThread).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    const keys = mocks.sendMessage.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(screen.getByLabelText("Note to the floor")).toHaveProperty("value", "");
  });
});

describe("audiences", () => {
  it("badges a client-facing request thread, labels its composer for the client, and marks a message read once", async () => {
    const floor = thread({ id: FLOOR_THREAD, audience: "staff-private", subject: "booking" });
    const asked = thread({ id: REQUEST_THREAD, audience: "client-facing", subject: "request", requestId: REQUEST, title: "Chairs × 10 · Grand Hall", createdAt: "2026-10-10T09:04:00.000Z" });
    mocks.threads.mockResolvedValue([floor, asked]);
    const ask = message({ id: "00000000-0000-4000-8000-00000000e002", threadId: REQUEST_THREAD, cursor: 3, kind: "request" });
    mocks.messages.mockImplementation((threadId: string) => Promise.resolve(threadId === REQUEST_THREAD ? page(asked, [ask]) : page(floor, [])));
    renderSlot([chairs]);

    const floorTab = await screen.findByRole("tab", { name: "Floor notes" });
    expect(within(floorTab).queryByText("Client can read this")).toBeNull();
    const requestTab = screen.getByRole("tab", { name: /Chairs × 10/u });
    expect(within(requestTab).getByText("Client can read this")).toBeTruthy();

    fireEvent.click(requestTab);
    expect(await screen.findByLabelText("Reply to the client")).toBeTruthy();
    expect(screen.getByText("Could we have ten more chairs?")).toBeTruthy();
    await waitFor(() => { expect(mocks.markReceipt).toHaveBeenCalledWith(ask.id, { mark: "read" }); });
    // A client's message is not "noted" from the floor's side: it is answered.
    expect(screen.queryByRole("button", { name: "Noted" })).toBeNull();

    fireEvent.click(floorTab);
    expect(await screen.findByLabelText("Note to the floor")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Chairs × 10/u }));
    await screen.findByLabelText("Reply to the client");
    expect(mocks.markReceipt).toHaveBeenCalledTimes(1);
  });
});

describe("receipts", () => {
  it("shows the server's receipts on your own messages only, and lets you note a colleague's", async () => {
    const floor = thread({ id: FLOOR_THREAD, audience: "staff-private", subject: "booking" });
    mocks.threads.mockResolvedValue([floor]);
    const mine = message({
      id: "00000000-0000-4000-8000-00000000e003", threadId: FLOOR_THREAD, cursor: 1, authorUserId: elaine.id, authorName: "Elaine", authorRole: "hallkeeper",
      body: "Chairs are out.",
      receipts: [{ messageId: "00000000-0000-4000-8000-00000000e003", recipientUserId: FIONA, recipientName: "Fiona", deliveredAt: "2026-10-10T13:01:00.000Z", readAt: "2026-10-10T13:02:00.000Z", acknowledgedAt: null }],
    });
    const theirs = message({ id: "00000000-0000-4000-8000-00000000e004", threadId: FLOOR_THREAD, cursor: 2, authorUserId: FIONA, authorName: "Fiona", authorRole: "staff", body: "Thanks. Doors at six." });
    mocks.messages.mockResolvedValue(page(floor, [mine, theirs]));
    renderSlot();

    const list = await screen.findByRole("list", { name: "Messages" });
    const items = within(list).getAllByRole("listitem");
    expect(within(items[0] as HTMLElement).getByText("Seen by Fiona 14:02")).toBeTruthy();
    expect(within(items[1] as HTMLElement).queryByText(/Seen by|Delivered to/u)).toBeNull();

    fireEvent.click(within(items[1] as HTMLElement).getByRole("button", { name: "Noted" }));
    await waitFor(() => { expect(mocks.markReceipt).toHaveBeenCalledWith(theirs.id, { mark: "acknowledged" }); });
    expect(within(items[1] as HTMLElement).queryByRole("button", { name: "Noted" })).toBeNull();
  });

  it("words a receipt by its strongest fact", () => {
    const base = message({ id: "00000000-0000-4000-8000-00000000e005", threadId: FLOOR_THREAD, cursor: 1, authorUserId: elaine.id, authorName: "Elaine" });
    const receipt = { messageId: base.id, recipientUserId: FIONA, recipientName: "Fiona", deliveredAt: "2026-10-10T13:01:00.000Z", readAt: null, acknowledgedAt: null };
    expect(receiptLine({ ...base, receipts: [receipt] }, elaine.id)).toBe("Delivered to Fiona");
    expect(receiptLine({ ...base, receipts: [{ ...receipt, readAt: "2026-10-10T13:02:00.000Z" }] }, elaine.id)).toBe("Seen by Fiona 14:02");
    expect(receiptLine({ ...base, receipts: [{ ...receipt, readAt: "2026-10-10T13:02:00.000Z", acknowledgedAt: "2026-10-10T13:03:00.000Z" }] }, elaine.id)).toBe("Noted by Fiona");
    expect(receiptLine({ ...base, receipts: [receipt] }, FIONA)).toBeNull();
    expect(receiptLine({ ...base, receipts: [] }, elaine.id)).toBeNull();
  });
});

describe("live", () => {
  it("fetches forward from its cursor on a nudge for the open thread, and says so once", async () => {
    const floor = thread({ id: FLOOR_THREAD, audience: "staff-private", subject: "booking" });
    mocks.threads.mockResolvedValue([floor]);
    const first = message({ id: "00000000-0000-4000-8000-00000000e006", threadId: FLOOR_THREAD, cursor: 5, authorUserId: FIONA, authorName: "Fiona", authorRole: "staff", body: "Doors at six." });
    const second = message({ id: "00000000-0000-4000-8000-00000000e007", threadId: FLOOR_THREAD, cursor: 6, authorUserId: FIONA, authorName: "Fiona", authorRole: "staff", body: "And the lights." });
    mocks.messages
      .mockResolvedValueOnce(page(floor, [first]))
      .mockResolvedValueOnce(page(floor, [second]));
    renderSlot();
    await screen.findByText("Doors at six.");

    await act(async () => {
      for (const listener of listeners) {
        listener({
          kind: "conversation", venueId: VENUE,
          event: {
            type: "conversation.event", venueId: VENUE, kind: "message.sent", threadId: FLOOR_THREAD, audience: "staff-private", subject: "booking",
            bookingId: BOOKING, eventId: null, requestId: null, messageId: second.id, cursor: 6, actorUserId: FIONA, at: "2026-10-10T09:06:00.000Z", serverNowMs: Date.now(),
          },
        });
      }
      await Promise.resolve();
    });

    expect(await screen.findByText("And the lights.")).toBeTruthy();
    expect(mocks.messages).toHaveBeenLastCalledWith(FLOOR_THREAD, { after: 5, limit: 200 });
    expect(screen.getByRole("status").textContent).toBe("New message from Fiona");
  });
});
