import { describe, expect, it } from "vitest";
import {
  FORWARD_BOOK_NOTE_MAX_LENGTH,
  FORWARD_BOOK_RECORD_ROLES,
  ForwardBookResponseSchema,
  RecordForwardBookCheckSchema,
} from "../forward-book.js";

// ---------------------------------------------------------------------------
// The record that a room's forward book is on the Diary (Blake, 17 October
// 2026: "hide date status until checked"): who may make it, and what a
// record request may carry.
// ---------------------------------------------------------------------------

const ROOM = "73333333-3333-4333-8333-333333333333";

describe("recording a room's forward book", () => {
  it("belongs to the venue's own admin and manager only", () => {
    expect([...FORWARD_BOOK_RECORD_ROLES]).toEqual(["admin", "manager"]);
  });

  it("takes a room and an optional note, trimmed, with a blank note as none", () => {
    expect(RecordForwardBookCheckSchema.parse({ spaceId: ROOM })).toEqual({ spaceId: ROOM, note: null });
    expect(RecordForwardBookCheckSchema.parse({ spaceId: ROOM, note: null })).toEqual({ spaceId: ROOM, note: null });
    expect(RecordForwardBookCheckSchema.parse({ spaceId: ROOM, note: "   " })).toEqual({ spaceId: ROOM, note: null });
    expect(RecordForwardBookCheckSchema.parse({ spaceId: ROOM, note: "  Compared with the paper diary to Dec 2027.  " }))
      .toEqual({ spaceId: ROOM, note: "Compared with the paper diary to Dec 2027." });
  });

  it("refuses a note over the limit, a room that is not an id, and anything else", () => {
    expect(RecordForwardBookCheckSchema.safeParse({ spaceId: ROOM, note: "x".repeat(FORWARD_BOOK_NOTE_MAX_LENGTH) }).success).toBe(true);
    expect(RecordForwardBookCheckSchema.safeParse({ spaceId: ROOM, note: "x".repeat(FORWARD_BOOK_NOTE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(RecordForwardBookCheckSchema.safeParse({ spaceId: "grand-hall" }).success).toBe(false);
    expect(RecordForwardBookCheckSchema.safeParse({ spaceId: ROOM, recordedByName: "Someone else" }).success).toBe(false);
    expect(RecordForwardBookCheckSchema.safeParse({ spaceId: ROOM, note: 7 }).success).toBe(false);
  });

  it("reads back each room with its standing and its last cleared record", () => {
    const check = {
      id: "74444444-4444-4444-8444-444444444444",
      spaceId: ROOM,
      recordedAt: "2026-10-17T13:02:00.000Z",
      recordedByName: "Moira Brown",
      note: null,
      clearedAt: null,
      clearedByName: null,
    };
    expect(ForwardBookResponseSchema.parse({
      rooms: [{ spaceId: ROOM, name: "Grand Hall", current: check, previous: null }],
    }).rooms[0]?.current?.recordedByName).toBe("Moira Brown");
    expect(ForwardBookResponseSchema.safeParse({
      rooms: [{ spaceId: ROOM, name: "Grand Hall", current: { ...check, recordedAt: "yesterday" }, previous: null }],
    }).success).toBe(false);
  });
});
