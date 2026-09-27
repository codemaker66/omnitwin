import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Booking, DiaryCommand, DiaryCommandAck } from "@omnitwin/types";
import { transitionBooking } from "../diary.js";
import { _resetTokenGetterForTests } from "../auth-bridge.js";
import { setDiaryCommandChannel } from "../../pages/diary/lib/diary-command-channel.js";

// ---------------------------------------------------------------------------
// A transition's promotions reach the drawer (roadmap N3). When a hold
// leaves, the API resequences its date and names the holds now 1st option,
// beside the booking in the REST reply and in the live channel's ack. The
// client used to parse the booking alone and drop them.
// ---------------------------------------------------------------------------

const BOOKING_ID = "00000000-0000-4000-8000-0000000000c1";
const ROBERTSON = "00000000-0000-4000-8000-0000000000c3";

function releasedRow(): Booking {
  return {
    id: BOOKING_ID, venueId: "00000000-0000-4000-8000-000000000001", spaceId: "00000000-0000-4000-8000-0000000000a1",
    eventId: null, kind: "hold", status: "released", state: "released", title: "MacLeod wedding", eventType: "wedding",
    startsAt: "2026-09-19T13:00:00.000Z", endsAt: "2026-09-19T22:30:00.000Z", rank: null, jointFlag: false,
    decisionAt: "2026-09-21T11:00:00.000Z", ownerUserId: null, nextAction: null, nextActionDueAt: null, seriesId: null,
    notes: null, createdBy: "00000000-0000-4000-8000-0000000000ff", enquiryId: null,
    createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-16T08:00:00.000Z",
  };
}

const RESEQUENCE = {
  changes: [{ id: ROBERTSON, fromRank: 2, toRank: 1 }],
  promotedToFirst: [{ id: ROBERTSON, title: "Robertson ceilidh", ownerUserId: null }],
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  _resetTokenGetterForTests();
});

afterEach(() => {
  setDiaryCommandChannel(null);
  vi.unstubAllGlobals();
});

describe("transitionBooking", () => {
  it("returns who became 1st option from the REST reply, with the reason sent and the call keyed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: releasedRow(), resequence: RESEQUENCE })));
    const outcome = await transitionBooking(BOOKING_ID, "released", "Chose another date");
    expect(outcome.booking.state).toBe("released");
    expect(outcome.promotedToFirst).toEqual([{ id: ROBERTSON, title: "Robertson ceilidh" }]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(expect.stringContaining(`/bookings/${BOOKING_ID}/transition`));
    expect(typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null).toEqual({ toState: "released", note: "Chose another date" });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("returns no one when nothing was resequenced", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: releasedRow(), resequence: null })));
    expect((await transitionBooking(BOOKING_ID, "cancelled")).promotedToFirst).toEqual([]);
  });

  it("returns who became 1st option from the live channel's ack", async () => {
    const sender = vi.fn((command: DiaryCommand): Promise<DiaryCommandAck> => Promise.resolve({
      type: "diary.ack", commandId: command.commandId, outcome: "applied", replay: false, status: 200,
      booking: releasedRow(), resequence: RESEQUENCE,
    }));
    setDiaryCommandChannel(sender);
    const outcome = await transitionBooking(BOOKING_ID, "released");
    expect(outcome.promotedToFirst).toEqual([{ id: ROBERTSON, title: "Robertson ceilidh" }]);
    expect(sender.mock.calls[0]?.[0]).toMatchObject({ kind: "booking.transition", bookingId: BOOKING_ID, payload: { toState: "released" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
