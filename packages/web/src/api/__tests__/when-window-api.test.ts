import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRoomDay, proposeWindow } from "../when-window.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";

// ---------------------------------------------------------------------------
// The When ribbon's two doors from the client's side (goal 19 S6): the room's
// day arrives anonymised and the privacy pin holds on this side too; a
// proposal carries its key in the body and the header alike.
// ---------------------------------------------------------------------------

const EVENT = "00000000-0000-4000-8000-0000000000e1";
const ROOM = "00000000-0000-4000-8000-0000000000a1";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const KEY = "00000000-0000-4000-8000-0000000000c1";

function roomDay(spans: readonly unknown[]): unknown {
  return {
    eventId: EVENT,
    space: { id: ROOM, name: "Grand Hall" },
    day: "2030-05-10",
    timezone: "Europe/London",
    range: { startsAt: "2030-05-10T03:00:00.000Z", endsAt: "2030-05-11T03:00:00.000Z" },
    turnaroundMinutes: 90,
    spans,
  };
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  _resetTokenGetterForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRoomDay", () => {
  it("asks for the room and the day and returns the anonymised spans", async () => {
    const spans = [
      { kind: "busy", startsAt: "2030-05-10T08:00:00.000Z", endsAt: "2030-05-10T13:00:00.000Z" },
      { kind: "yours", bookingId: BOOKING, title: "Our dinner", startsAt: "2030-05-10T17:00:00.000Z", endsAt: "2030-05-10T22:00:00.000Z" },
    ];
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: roomDay(spans) })));
    const day = await getRoomDay(EVENT, { spaceId: ROOM, day: "2030-05-10" });
    expect(day.turnaroundMinutes).toBe(90);
    expect(day.spans).toEqual(spans);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(expect.stringContaining(`/events/${EVENT}/room-day?spaceId=${ROOM}&day=2030-05-10`));
    expect(init?.method).toBe("GET");
  });

  it("refuses a day that names who else booked: the privacy pin holds on this side too", async () => {
    const leak = [{ kind: "held", title: "The MacLeod wedding", startsAt: "2030-05-10T14:00:00.000Z", endsAt: "2030-05-10T16:00:00.000Z" }];
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: roomDay(leak) })));
    await expect(getRoomDay(EVENT, { spaceId: ROOM, day: "2030-05-10" })).rejects.toThrow();
  });
});

describe("proposeWindow", () => {
  it("PUTs the window with the gesture's key in the body and the header, and returns the slot", async () => {
    const slot = {
      bookingId: BOOKING, kind: "hold", title: "Our dinner", space: { id: ROOM, name: "Grand Hall" },
      startsAt: "2030-05-10T17:00:00.000Z", endsAt: "2030-05-10T22:00:00.000Z",
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: slot }), { status: 201 }));
    const input = { spaceId: ROOM, startsAt: slot.startsAt, endsAt: slot.endsAt, idempotencyKey: KEY };
    const result = await proposeWindow(EVENT, input);
    expect(result).toEqual(slot);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(expect.stringContaining(`/events/${EVENT}/proposed-window`));
    expect(init?.method).toBe("PUT");
    expect(typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null).toEqual(input);
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(KEY);
  });

  it("surfaces the house's refusal as an error the ribbon can show", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "That window has already been decided.", code: "WINDOW_DECIDED" }), { status: 409 }));
    await expect(proposeWindow(EVENT, { spaceId: ROOM, startsAt: "2030-05-10T17:00:00.000Z", endsAt: "2030-05-10T22:00:00.000Z", idempotencyKey: KEY }))
      .rejects.toThrow("That window has already been decided.");
  });
});
