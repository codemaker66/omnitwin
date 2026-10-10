import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientEventScheduleSlot, ConversationSnapshot, Message, VenueRequest } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { useAuthStore, type AuthUser } from "../../../stores/auth-store.js";
import {
  ClientRequests,
  LINK_REVOKED,
  OFFLINE_NOT_SENT,
  SENT_WAITING,
  preferredSlot,
  slotLabel,
  statusLine,
} from "../ClientRequests.js";

// ---------------------------------------------------------------------------
// The client's requests on their event page (goal 19 S4). What it promises:
// the ask is one gesture on the slot that is live or next; the state shown is
// the house's own, read from the poll; a request that could not be sent keeps
// its draft and its key, so sending again is the same request; a revoked link
// closes the composer at once, in one sentence.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  conversation: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../../../api/conversations.js", () => ({
  getEventConversation: mocks.conversation,
  createEventRequest: mocks.create,
  listEventRequests: mocks.list,
}));

const EVENT = "00000000-0000-4000-8000-00000000e001";
const HALL = { id: "00000000-0000-4000-8000-0000000000a1", name: "Grand Hall" };
const SALOON = { id: "00000000-0000-4000-8000-0000000000a2", name: "Saloon" };
const THREAD = "00000000-0000-4000-8000-00000000c001";

const morag: AuthUser = {
  id: "00000000-0000-4000-8000-0000000000aa", name: "Morag", email: "morag@example.test", role: "client", platformRole: "none", venueId: null,
};

function slot(bookingId: string, space: typeof HALL, startsAt: string, endsAt: string): ClientEventScheduleSlot {
  return { bookingId, kind: "ink", title: "Three identities", space, startsAt, endsAt };
}

const NOW = Date.now();
const hour = 3_600_000;
const past = slot("00000000-0000-4000-8000-0000000000b1", SALOON, new Date(NOW - 5 * hour).toISOString(), new Date(NOW - 3 * hour).toISOString());
const live = slot("00000000-0000-4000-8000-0000000000b2", HALL, new Date(NOW - hour).toISOString(), new Date(NOW + hour).toISOString());
const later = slot("00000000-0000-4000-8000-0000000000b3", HALL, new Date(NOW + 3 * hour).toISOString(), new Date(NOW + 5 * hour).toISOString());

function snapshot(messages: readonly Message[] = []): ConversationSnapshot {
  const last = messages[messages.length - 1];
  return { eventId: EVENT, threads: [], messages, cursor: last?.cursor ?? 0, serverNowMs: Date.now() };
}

function made(input: { bookingId: string; kind: VenueRequest["kind"]; quantity: number | null; urgency: VenueRequest["urgency"]; detail: string | null }): VenueRequest {
  return {
    id: "00000000-0000-4000-8000-0000000000d1", venueId: "00000000-0000-4000-8000-00000000a001", bookingId: input.bookingId, eventId: EVENT,
    roomId: HALL.id, roomName: HALL.name, kind: input.kind, quantity: input.quantity, urgency: input.urgency, detail: input.detail,
    requestedByUserId: morag.id, requestedByName: "Morag", requestedByRole: "client", audienceRoles: ["admin", "manager", "staff", "hallkeeper"],
    ownerUserId: null, ownerName: null, state: "sent", outcome: null, outcomeNote: null, escalationDueAt: null, escalatedAt: null,
    acknowledgedAt: null, acceptedAt: null, resolvedAt: null, threadId: THREAD, handoverToUserId: null, handoverToName: null,
    handedOverAt: null, underwayAt: null, reopenedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

const step = (body: string, cursor: number): Message => ({
  id: `00000000-0000-4000-8000-0000000000e${String(cursor)}`, threadId: THREAD, cursor, kind: "system", authorUserId: null,
  authorName: "Venviewer", authorRole: "system", body, createdAt: new Date().toISOString(), receipts: [],
});

let requestsNow: readonly VenueRequest[] = [];
let conversationNow: ConversationSnapshot | (() => Promise<ConversationSnapshot>) = snapshot();

beforeEach(() => {
  vi.resetAllMocks();
  requestsNow = [];
  conversationNow = snapshot();
  mocks.list.mockImplementation(() => Promise.resolve(requestsNow));
  mocks.conversation.mockImplementation(() => (typeof conversationNow === "function" ? conversationNow() : Promise.resolve(conversationNow)));
  useAuthStore.getState().setUser(morag);
});
afterEach(() => { cleanup(); useAuthStore.getState().setUser(null); });

function renderRequests(slots: readonly ClientEventScheduleSlot[] = [past, live, later]): void {
  render(<ClientRequests eventId={EVENT} slots={slots} timeZone="Europe/London" pollMs={40} />);
}

describe("asking the house", () => {
  it("asks in one gesture on the live slot, then reads the house's own steps", async () => {
    mocks.create.mockImplementation((_eventId: string, input: Parameters<typeof made>[0]) => {
      const request = made(input);
      requestsNow = [request];
      return Promise.resolve(request);
    });
    renderRequests();

    const region = screen.getByRole("region", { name: "Requests" });
    fireEvent.click(within(region).getByRole("button", { name: "Ask for something" }));
    expect(within(region).getByRole("button", { name: "Chairs" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(region).getByRole("button", { name: "Soon" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(region).getByLabelText("Room and time")).toHaveProperty("value", live.bookingId);
    fireEvent.change(within(region).getByLabelText("How many"), { target: { value: "10" } });
    fireEvent.click(within(region).getByRole("button", { name: "Send it" }));

    const list = await within(region).findByRole("list", { name: "Your requests" });
    expect(within(list).getByText("Chairs × 10")).toBeTruthy();
    expect(within(list).getByText(SENT_WAITING)).toBeTruthy();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[1]).toMatchObject({ bookingId: live.bookingId, kind: "chairs", quantity: 10, urgency: "soon", detail: null });
    expect(within(region).queryByRole("button", { name: "Send it" })).toBeNull();

    // The house takes it: the poll reads the step in the house's own words.
    conversationNow = snapshot([step("Elaine has seen this.", 1), step("Elaine has this.", 2)]);
    expect(await within(list).findByText("Elaine has this.")).toBeTruthy();
    await waitFor(() => { expect(within(region).getByRole("status").textContent).toBe("Chairs × 10: Elaine has this."); });
  });

  it("keeps the draft and the key when the house cannot be reached, and sends again as the same request", async () => {
    mocks.create
      .mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"))
      .mockImplementationOnce((_eventId: string, input: Parameters<typeof made>[0]) => {
        const request = made(input);
        requestsNow = [request];
        return Promise.resolve(request);
      });
    renderRequests();
    const region = screen.getByRole("region", { name: "Requests" });
    fireEvent.click(within(region).getByRole("button", { name: "Ask for something" }));
    fireEvent.change(within(region).getByLabelText("How many"), { target: { value: "10" } });
    fireEvent.click(within(region).getByRole("button", { name: "Send it" }));

    expect((await within(region).findByRole("alert")).textContent).toBe(OFFLINE_NOT_SENT);
    expect(within(region).getByLabelText("How many")).toHaveProperty("value", "10");
    fireEvent.click(within(region).getByRole("button", { name: "Send again" }));
    await within(region).findByRole("list", { name: "Your requests" });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const keys = mocks.create.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("sends no quantity for a kind that has none", async () => {
    mocks.create.mockImplementation((_eventId: string, input: Parameters<typeof made>[0]) => Promise.resolve(made(input)));
    renderRequests();
    const region = screen.getByRole("region", { name: "Requests" });
    fireEvent.click(within(region).getByRole("button", { name: "Ask for something" }));
    fireEvent.change(within(region).getByLabelText("How many"), { target: { value: "4" } });
    fireEvent.click(within(region).getByRole("button", { name: "Access" }));
    expect(within(region).queryByLabelText("How many")).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Now" }));
    fireEvent.click(within(region).getByRole("button", { name: "Send it" }));
    await waitFor(() => { expect(mocks.create).toHaveBeenCalledTimes(1); });
    expect(mocks.create.mock.calls[0]?.[1]).toMatchObject({ kind: "access", quantity: null, urgency: "now" });
  });

  it("closes the composer the instant the link is revoked, in one sentence", async () => {
    renderRequests();
    const region = screen.getByRole("region", { name: "Requests" });
    fireEvent.click(within(region).getByRole("button", { name: "Ask for something" }));
    expect(within(region).getByRole("button", { name: "Send it" })).toHaveProperty("disabled", false);

    conversationNow = () => Promise.reject(new ApiError(403, "This conversation is not yours to read.", "FORBIDDEN"));
    expect((await within(region).findByText(LINK_REVOKED)).textContent).toBe(LINK_REVOKED);
    expect(within(region).getByRole("button", { name: "Send it" })).toHaveProperty("disabled", true);
  });

  it("says when the house holds no slot yet, and offers nothing to send", () => {
    renderRequests([]);
    const region = screen.getByRole("region", { name: "Requests" });
    expect(within(region).getByText("The house has not held a slot for this event yet, so there is nothing to ask about.")).toBeTruthy();
    expect(within(region).queryByRole("button", { name: "Ask for something" })).toBeNull();
  });
});

describe("the words and the slot", () => {
  it("prefills the live slot, else the next, else the last", () => {
    expect(preferredSlot([past, live, later], NOW)?.bookingId).toBe(live.bookingId);
    expect(preferredSlot([past, later], NOW)?.bookingId).toBe(later.bookingId);
    expect(preferredSlot([past], NOW)?.bookingId).toBe(past.bookingId);
    expect(preferredSlot([], NOW)).toBeNull();
  });

  it("names a slot by its room, day and window, venue-local", () => {
    const fixed = slot("00000000-0000-4000-8000-0000000000b9", HALL, "2026-10-10T11:00:00.000Z", "2026-10-10T15:00:00.000Z");
    expect(slotLabel(fixed, "Europe/London")).toBe("Grand Hall · Sat 10 Oct · 12:00–16:00");
  });

  it("reads the house's latest step, and before any step says it is sent", () => {
    const request = made({ bookingId: live.bookingId, kind: "chairs", quantity: 10, urgency: "soon", detail: null });
    expect(statusLine(request, [])).toBe(SENT_WAITING);
    expect(statusLine(request, [step("Elaine has seen this.", 1), step("Elaine has this.", 2)])).toBe("Elaine has this.");
    // A step from another request's thread is not this request's.
    expect(statusLine(request, [{ ...step("Fiona has this.", 3), threadId: "00000000-0000-4000-8000-00000000c009" }])).toBe(SENT_WAITING);
    expect(statusLine({ ...request, state: "resolved", outcome: "substituted", outcomeNote: "Benches instead." }, [])).toBe("Done another way: Benches instead.");
    expect(statusLine({ ...request, state: "accepted", ownerName: "Elaine" }, [])).toBe("Elaine has this.");
  });
});
