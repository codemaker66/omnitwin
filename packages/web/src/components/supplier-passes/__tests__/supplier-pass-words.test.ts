import { describe, expect, it } from "vitest";
import type { SupplierPassSummary } from "../../../api/supplier-coordination.js";
import {
  boardSummary,
  endOfVenueDay,
  linkWords,
  offerableScope,
  partsSummary,
  passMessage,
  passState,
  passToReplace,
  readWords,
  roomList,
  sameHolder,
  seeSentence,
  venueDateInput,
} from "../supplier-pass-words.js";

const LONDON = "Europe/London";
const FLORIST = "00000000-0000-4000-8000-000000005001";
const BAND = "00000000-0000-4000-8000-000000005002";

function pass(overrides: Partial<SupplierPassSummary> = {}): SupplierPassSummary {
  return {
    id: "00000000-0000-4000-8000-000000007001",
    title: "Bloom & Co",
    supplierId: FLORIST,
    supplierName: "Bloom & Co",
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    status: "issued",
    live: true,
    createdAt: "2026-12-01T14:02:00.000Z",
    issuedAt: "2026-12-01T14:02:00.000Z",
    expiresAt: "2026-12-12T23:00:00.000Z",
    expiryAssumed: false,
    revokedAt: null,
    builtFromCompiledAt: "2026-12-01T09:00:00.000Z",
    planChangedAt: null,
    madeBy: null,
    items: [],
    link: { tokenPrefix: "abcdefgh", createdAt: "2026-12-01T14:02:00.000Z", expiresAt: "2026-12-12T23:00:00.000Z", revokedAt: null, lastViewedAt: null },
    openedAt: null,
    acknowledgements: [],
    ...overrides,
  };
}

describe("stop dates on the venue's clock", () => {
  it("ends a chosen day at 23:59 on the venue's clock, in summer time and in winter", () => {
    expect(endOfVenueDay("2026-10-24", LONDON)?.toISOString()).toBe("2026-10-24T22:59:00.000Z");
    expect(endOfVenueDay("2026-12-08", LONDON)?.toISOString()).toBe("2026-12-08T23:59:00.000Z");
    expect(endOfVenueDay("not-a-day", LONDON)).toBeNull();
  });

  it("reads an instant as the calendar day a date field holds, on the venue's clock", () => {
    expect(venueDateInput("2026-10-24T23:30:00.000Z", LONDON)).toBe("2026-10-25");
    expect(venueDateInput("2026-12-12T23:00:00.000Z", LONDON)).toBe("2026-12-12");
    expect(venueDateInput(null, LONDON)).toBe("");
  });
});

describe("the board's words", () => {
  it("counts the open passes, the read ones and the questions waiting, and says an empty board plainly", () => {
    expect(boardSummary([])).toBe("No passes made for this event yet.");
    expect(boardSummary([pass({ status: "revoked", revokedAt: "2026-12-02T10:00:00.000Z", live: false })])).toBe("1 withdrawn; none open.");
    expect(boardSummary([pass()])).toBe("1 pass · 0 read");
  });

  it("says a pass's state in words: open until a day, assumed, ended, not sent or withdrawn", () => {
    expect(linkWords(pass(), LONDON)).toBe("Works until Sat 12 Dec.");
    expect(linkWords(pass({ expiryAssumed: true }), LONDON)).toBe("Works until Sat 12 Dec (7 days after the event).");
    expect(linkWords(pass({ live: false }), LONDON)).toBe("Stopped working Sat 12 Dec.");
    expect(linkWords(pass({ status: "draft", link: null, live: false }), LONDON)).toBe("Not sent: no link made yet.");
    expect(passState(pass({ status: "revoked", revokedAt: "2026-12-02T10:00:00.000Z" }))).toBe("withdrawn");
  });

  it("reports an opened pass that is not yet marked read, and never invents a reader", () => {
    expect(readWords(pass(), LONDON)).toBe("Not opened yet.");
    expect(readWords(pass({ openedAt: "2026-12-02T09:58:00.000Z" }), LONDON)).toBe("Opened Wed 2 Dec, 09:58; not marked as read yet.");
    expect(readWords(pass({ live: false }), LONDON)).toBe("Never opened.");
  });

  it("sums up a pass's parts by the first, how many more, and the first arrival", () => {
    expect(partsSummary(pass())).toBe("No parts");
    expect(partsSummary(pass({ items: [
      { title: "Table centrepieces", arrivalWindow: null },
      { title: "Ceremony arch", arrivalWindow: "09:00-10:00" },
      { title: "Load-in access notes", arrivalWindow: null },
    ] }))).toBe("Table centrepieces and 2 more · arrives 09:00-10:00");
  });

  it("joins rooms as a person would say them", () => {
    expect(roomList([])).toBeNull();
    expect(roomList(["Grand Hall"])).toBe("Grand Hall");
    expect(roomList(["Saloon", "Grand Hall", "Hall of Fame"])).toBe("Saloon, Grand Hall and Hall of Fame");
  });
});

describe("one holder, one open pass", () => {
  it("matches a holder by the supplier on file, or by name when neither is on file", () => {
    expect(sameHolder(pass(), { supplierId: FLORIST, name: "Anything" })).toBe(true);
    expect(sameHolder(pass(), { supplierId: BAND, name: "Bloom & Co" })).toBe(false);
    expect(sameHolder(pass({ supplierId: null, title: " Piper  Jo " }), { supplierId: null, name: "piper jo" })).toBe(true);
  });

  it("replaces the holder's newest pass that is still open, never a withdrawn one", () => {
    const older = pass({ id: "00000000-0000-4000-8000-000000007002", createdAt: "2026-11-25T10:00:00.000Z" });
    const newer = pass({ id: "00000000-0000-4000-8000-000000007003", createdAt: "2026-12-01T10:00:00.000Z" });
    const withdrawn = pass({ id: "00000000-0000-4000-8000-000000007004", createdAt: "2026-12-02T10:00:00.000Z", status: "revoked", revokedAt: "2026-12-02T11:00:00.000Z" });
    expect(passToReplace([older, newer, withdrawn], { supplierId: FLORIST, name: "Bloom & Co" })?.id).toBe(newer.id);
    expect(passToReplace([withdrawn], { supplierId: FLORIST, name: "Bloom & Co" })).toBeNull();
  });

  it("never offers one supplier another supplier's part", () => {
    const scope = [
      { instructionId: "00000000-0000-4000-8000-000000006001", supplierId: FLORIST, category: "florist", title: "Centrepieces", detail: "Low.", arrivalWindow: null },
      { instructionId: "00000000-0000-4000-8000-000000006002", supplierId: BAND, category: "music", title: "Band", detail: "Lift.", arrivalWindow: null },
      { instructionId: "00000000-0000-4000-8000-000000006003", supplierId: null, category: "logistics", title: "Access", detail: "Side door.", arrivalWindow: null },
    ];
    expect(offerableScope(scope, FLORIST).map((item) => item.title)).toEqual(["Centrepieces", "Access"]);
    expect(offerableScope(scope, null).map((item) => item.title)).toEqual(["Access"]);
  });
});

describe("what is said before and after a pass is made", () => {
  it("promises the address only when there is one, and names the venue team when no one is named", () => {
    const sentence = seeSentence({ holder: "Piper Jo", day: null, rooms: null, parts: 2, hasAddress: false, contact: null });
    expect(sentence.will).toBe("Piper Jo will see the day and room once the Diary has them, the 2 parts you ticked, with any arrival times and the venue team as their contact.");
    expect(sentence.will).not.toContain("address");
  });

  it("writes a message that still helps with no signal, without system words", () => {
    const message = passMessage({
      venueName: "Trades Hall Glasgow",
      day: "Saturday 5 December",
      rooms: "Grand Hall",
      address: null,
      arrivals: [{ title: "Band load-in", window: "15:00-15:30" }],
      contact: { name: "Kerry Mackay", phone: null },
      url: "https://example.test/supplier-share/abc",
      until: null,
    });
    expect(message).toBe([
      "Trades Hall Glasgow: your brief for Saturday 5 December, Grand Hall.",
      "Arrive 15:00-15:30 (Band load-in).",
      "Questions: Kerry Mackay.",
      "Your brief: https://example.test/supplier-share/abc",
    ].join("\n"));
  });
});
