import { describe, expect, it } from "vitest";
import {
  PUBLIC_DAY_NO_BOOKING,
  PUBLIC_DAY_STATUSES,
  PUBLIC_DAY_STATUS_WORDING,
  PUBLIC_ROOM_ANSWERS,
  PUBLIC_ROOM_ASK_THE_TEAM,
  PUBLIC_ROOM_ASK_THE_TEAM_WORDING,
  publicDayStatus,
  publicRoomAnswer,
} from "../booking.js";

// ---------------------------------------------------------------------------
// The public date answer (fix-first item 4, 16 October 2026). An empty Diary
// day is a fact about the Diary, not about the room, so no public answer may
// say "free" or "available", and the one wording serves the MCP and the web.
// ---------------------------------------------------------------------------

describe("public date answers", () => {
  it("never answers a bare 'free'", () => {
    expect(PUBLIC_DAY_STATUSES).toEqual(["no_booking_on_our_diary_team_confirms", "held", "busy"]);
    expect(PUBLIC_DAY_STATUSES).not.toContain("free");
    expect(PUBLIC_DAY_NO_BOOKING).toBe("no_booking_on_our_diary_team_confirms");
  });

  it("keeps busy over held over nothing on the Diary", () => {
    expect(publicDayStatus([])).toBe(PUBLIC_DAY_NO_BOOKING);
    expect(publicDayStatus(["held"])).toBe("held");
    expect(publicDayStatus(["held", "busy", "held"])).toBe("busy");
  });

  it("words every answer, and none of them promises a room", () => {
    expect(Object.keys(PUBLIC_DAY_STATUS_WORDING).sort()).toEqual([...PUBLIC_DAY_STATUSES].sort());
    for (const status of PUBLIC_DAY_STATUSES) {
      const { label, meaning } = PUBLIC_DAY_STATUS_WORDING[status];
      expect(label.length).toBeGreaterThan(0);
      for (const text of [label, meaning]) {
        expect(text).not.toMatch(/\bfree\b/iu);
        expect(text).not.toMatch(/\bis available\b/iu);
      }
    }
    // The two answers a person might act on name who confirms.
    expect(PUBLIC_DAY_STATUS_WORDING[PUBLIC_DAY_NO_BOOKING].meaning).toContain("only the venue team can confirm a date");
    expect(PUBLIC_DAY_STATUS_WORDING[PUBLIC_DAY_NO_BOOKING].meaning).toContain("may hold bookings that are not on this diary");
    expect(PUBLIC_DAY_STATUS_WORDING.held.meaning).toContain("A second option may be possible");
  });
});

// ---------------------------------------------------------------------------
// Hidden until checked (Blake, 17 October 2026). A room shows date statuses
// only while the venue's record that its forward book is on the Diary stands.
// ---------------------------------------------------------------------------

describe("a room's public answer", () => {
  it("is 'ask the team' until the venue has recorded the room's check", () => {
    expect(PUBLIC_ROOM_ANSWERS).toEqual(["dates", "ask_the_team"]);
    expect(publicRoomAnswer(null)).toBe(PUBLIC_ROOM_ASK_THE_TEAM);
    expect(publicRoomAnswer(undefined)).toBe(PUBLIC_ROOM_ASK_THE_TEAM);
    expect(publicRoomAnswer("2026-10-17T13:02:00.000Z")).toBe("dates");
    expect(publicRoomAnswer(new Date("2026-10-17T13:02:00.000Z"))).toBe("dates");
  });

  it("says plainly that nothing is said about the room's dates, and who to ask", () => {
    const { label, meaning } = PUBLIC_ROOM_ASK_THE_TEAM_WORDING;
    expect(label).toBe("Ask the team");
    expect(meaning).toContain("says nothing about its dates");
    expect(meaning).toContain("Ask the venue team about any date");
    for (const text of [label, meaning]) {
      expect(text).not.toMatch(/\b(?:free|available|booked|held)\b/iu);
    }
  });
});
