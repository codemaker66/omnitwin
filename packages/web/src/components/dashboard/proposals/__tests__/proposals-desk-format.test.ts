import { describe, expect, it } from "vitest";
import type { ProposalVersionPayload } from "@omnitwin/types";
import type { DeskProposal, ProposalHistoryEntry } from "../../../../api/proposals.js";
import {
  composerLayoutLine, composerStartWords, draftChanges, draftFromVersion, groupOf, layoutFact, groupRows, historyMoments, linkVersionWords, listWords,
  notCarriedWords, proposalTone, proposalsSummary, rowDetails, rowWhen,
} from "../proposals-desk-format.js";

// ---------------------------------------------------------------------------
// The Proposals desk's words: its groups, a row's "when", the opening
// sentence, where a new version starts and what it changes, and the history.
// ---------------------------------------------------------------------------

/** 11:00 in Glasgow on Friday 2 October 2026. */
const NOW = Date.parse("2026-10-02T10:00:00.000Z");

function row(overrides: Partial<DeskProposal> = {}): DeskProposal {
  return {
    id: "p1", venueId: "v1", opportunityId: null, enquiryId: null, configurationId: null, title: "Autumn gala", status: "draft",
    currentVersion: 0, shareCode: null, sentAt: null, createdBy: "u1", createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z", deletedAt: null, dealTitle: null, clientName: null, eventDate: null, guestCount: null,
    eventType: null, latestTotalMinor: null, latestCurrency: null, linkOpenedAt: null, sentVersion: null,
    lastSentAt: null, hasLink: true, linkOpen: true, ...overrides,
  };
}

function payload(overrides: Partial<ProposalVersionPayload> = {}): ProposalVersionPayload {
  return {
    schemaVersion: "venviewer.proposal-version.v1", title: "Autumn gala", clientMessage: "Planning-grade draft.", configurationId: null,
    layoutRevision: null, capacityNote: null,
    quote: {
      quoteId: null, currency: "GBP", subtotalMinor: 452_050, totalMinor: 452_050,
      lineItems: [
        { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 440_000, lineTotalMinor: 440_000 },
        { description: "Piper", quantity: 1, unitAmountMinor: 12_050, lineTotalMinor: 12_050 },
      ],
    },
    ...overrides,
  };
}

describe("the groups", () => {
  it("files every status under the group a booker works it in, and anything unknown as closed", () => {
    expect(["changes_requested", "draft", "sent", "accepted", "declined", "withdrawn", "expired", "archived", "mystery"].map(groupOf))
      .toEqual(["waiting", "drafts", "with_client", "accepted", "closed", "closed", "closed", "closed", "closed"]);
    expect(proposalTone("changes_requested")).toBe("new");
    expect(proposalTone("declined")).toBe("declined");
    expect(proposalTone("expired")).toBe("withdrawn");
  });

  it("puts the groups in working order and keeps the API's order within each", () => {
    const groups = groupRows([
      row({ id: "a", status: "sent" }), row({ id: "b", status: "draft" }), row({ id: "c", status: "sent" }),
      row({ id: "d", status: "changes_requested" }), row({ id: "e", status: "expired" }),
    ]);
    expect(groups.map((group) => [group.label, group.rows.map((item) => item.id)])).toEqual([
      ["Waiting on you", ["d"]], ["Drafts", ["b"]], ["With the client", ["a", "c"]], ["Closed", ["e"]],
    ]);
  });
});

describe("a row", () => {
  it("says when it last moved, in the words of where it stands", () => {
    expect(rowWhen(row(), NOW)).toBe("Nothing written yet");
    expect(rowWhen(row({ currentVersion: 2 }), NOW)).toBe("Version 2, changed yesterday");
    expect(rowWhen(row({ status: "sent", currentVersion: 1, sentAt: "2026-09-29T10:00:00.000Z" }), NOW)).toBe("Sent 3 days ago, not opened yet");
    expect(rowWhen(row({ status: "sent", currentVersion: 1, sentAt: "2026-09-29T10:00:00.000Z", linkOpenedAt: "2026-10-01T18:00:00.000Z" }), NOW))
      .toBe("Sent 3 days ago, opened yesterday");
    expect(rowWhen(row({ status: "changes_requested", currentVersion: 1, updatedAt: "2026-10-02T08:00:00.000Z" }), NOW)).toBe("Version 1, changed 2 hours ago");
    expect(rowWhen(row({ status: "accepted", updatedAt: "2026-09-25T10:00:00.000Z" }), NOW)).toBe("Accepted 7 days ago");
  });

  it("names who it is for, the occasion, the guests and what it comes to, where known", () => {
    expect(rowDetails(row())).toEqual([]);
    expect(rowDetails(row({ clientName: "Elaine Crawford", eventType: "wedding", guestCount: 1, latestTotalMinor: 1_840_000, latestCurrency: "GBP" })))
      .toEqual(["Elaine Crawford", "Wedding", "1 guest", "£18,400"]);
  });
});

describe("the opening sentence", () => {
  it("says what is waiting on the booker first, then what is with clients", () => {
    const text = (counts: Record<string, number>): string => (proposalsSummary(counts) ?? [])
      .map((part) => typeof part === "string" ? part : part.strong).join("");
    expect(text({ changes_requested: 2, draft: 3, sent: 4 })).toBe("2 clients asked for changes, and 3 drafts are yours to finish. 4 proposals are with clients.");
    expect(text({ changes_requested: 1 })).toBe("1 client asked for changes.");
    expect(text({ draft: 1, sent: 1 })).toBe("1 draft is yours to finish. 1 proposal is with a client.");
    expect(text({ accepted: 5 })).toBe("Nothing is waiting on you.");
    expect(proposalsSummary(null)).toBeNull();
    // What the client sent back is the copper part.
    expect(proposalsSummary({ changes_requested: 1 })?.[0]).toEqual({ strong: "1 client", tone: "new" });
  });
});

describe("the next version", () => {
  it("starts from the latest version's words and quote, in pounds", () => {
    expect(draftFromVersion(payload({ capacityNote: "Around 120 seated." }))).toEqual({
      message: "Planning-grade draft.",
      capacityNote: "Around 120 seated.",
      lines: [
        { description: "Grand Hall hire", quantity: "1", pounds: "4400" },
        { description: "Piper", quantity: "1", pounds: "120.50" },
      ],
    });
    expect(draftFromVersion(null)).toEqual({ message: "", capacityNote: "", lines: [] });
  });

  it("says what the new version changes, and nothing when nothing does", () => {
    const from = payload();
    const same = draftFromVersion(from);
    expect(draftChanges(from, same)).toEqual([]);
    expect(draftChanges(from, { ...same, message: "  Planning-grade draft.  " })).toEqual([]);
    expect(draftChanges(from, { ...same, message: "A later finish." })).toEqual(["the message"]);
    expect(draftChanges(from, { ...same, capacityNote: "Around 100." })).toEqual(["the capacity note"]);
    expect(draftChanges(from, { ...same, lines: same.lines.slice(0, 1) })).toEqual(["the quote, £4,520.50 to £4,400"]);
    // The same total from different lines is still a changed quote.
    expect(draftChanges(from, { ...same, lines: [{ description: "Everything", quantity: "1", pounds: "4520.50" }] })).toEqual(["the quote"]);
    // A line not yet readable changes the quote, without a total to show.
    expect(draftChanges(from, { ...same, lines: [...same.lines, { description: "", quantity: "1", pounds: "" }] })).toEqual(["the quote"]);
    expect(draftChanges(null, same)).toEqual([]);
    expect(listWords(["the message", "the capacity note", "the quote"])).toBe("the message, the capacity note and the quote");
    expect(listWords(["the message"])).toBe("the message");
  });

  // What is typed here is all it speaks of: the drawing and the event's
  // details are taken afresh at the save, so "nothing is changed" would not
  // be true of the version.
  it("says where it starts and what the person has changed, and only that", () => {
    expect(composerStartWords(null, [])).toBe("The first version.");
    expect(composerStartWords(2, [])).toBe("Starts from version 2. You have not changed anything here yet.");
    expect(composerStartWords(2, ["the message", "the quote, £4,400 to £4,600"]))
      .toBe("Starts from version 2. You have changed the message and the quote, £4,400 to £4,600.");
  });

  it("says what the version it starts from shows the client that the next one will not carry", () => {
    expect(notCarriedWords(null)).toBeNull();
    expect(notCarriedWords(payload())).toBeNull();
    expect(notCarriedWords(payload({ roomSummary: "The room is 30 m by 15 m.", layoutSummary: "Ten rounds of ten." })))
      .toBe("Its descriptions of the room and layout are not carried over.");
    expect(notCarriedWords(payload({ roomSummary: "The room is 30 m by 15 m.", layoutSummary: null })))
      .toBe("Its description of the room is not carried over.");
    expect(notCarriedWords(payload({ layoutSummary: "Ten rounds of ten." }))).toBe("Its description of the layout is not carried over.");
    expect(notCarriedWords(payload({ packageSummary: ["Piper"] }))).toBe("Its list of what is included is not carried over.");
    expect(notCarriedWords(payload({ packageSummary: [] }))).toBeNull();
  });
});

describe("the history", () => {
  function entry(overrides: Partial<ProposalHistoryEntry>): ProposalHistoryEntry {
    return { id: "h", proposalId: "p1", fromStatus: "draft", toStatus: "sent", changedBy: "u1", note: null, createdAt: "2026-09-25T10:00:00.000Z", ...overrides };
  }

  it("tells each move as what happened, the client's own acts as theirs, newest first with the start last", () => {
    const moments = historyMoments([
      entry({ id: "a", toStatus: "sent", note: "Client share link generated", createdAt: "2026-09-25T10:00:00.000Z" }),
      entry({ id: "b", fromStatus: "sent", toStatus: "changes_requested", changedBy: null, note: "Could we finish later?", createdAt: "2026-09-27T10:00:00.000Z" }),
      entry({ id: "c", fromStatus: "sent", toStatus: "accepted", changedBy: null, note: "  ", createdAt: "2026-09-30T10:00:00.000Z" }),
      entry({ id: "d", fromStatus: "accepted", toStatus: "archived", createdAt: "2026-10-01T10:00:00.000Z" }),
    ], "2026-09-20T09:00:00.000Z");
    expect(moments.map((moment) => [moment.sentence, moment.quote])).toEqual([
      ["Archived.", null],
      ["The client accepted it.", null],
      ["The client asked for changes.", "Could we finish later?"],
      ["Sent to the client.", "Client share link generated"],
      ["The proposal was started.", null],
    ]);
    expect(historyMoments([entry({ toStatus: "declined" })], null).map((moment) => moment.sentence)).toEqual(["Marked declined."]);
  });
});
describe("the latest send and the link's version", () => {
  it("counts a row from its latest send, and claims no opens for the older share code", () => {
    expect(rowWhen(row({ status: "sent", sentAt: "2026-09-01T10:00:00.000Z", lastSentAt: "2026-10-01T10:00:00.000Z" }), NOW))
      .toBe("Sent yesterday, not opened yet");
    expect(rowWhen(row({ status: "sent", sentAt: "2026-10-01T10:00:00.000Z", hasLink: false }), NOW)).toBe("Sent yesterday");
  });

  it("says which version the client's link shows, or that a closed one showed it", () => {
    expect(linkVersionWords(row({ currentVersion: 3, sentVersion: 2 }))).toBe("; the client's link shows version 2");
    expect(linkVersionWords(row({ currentVersion: 3, sentVersion: 2, linkOpen: false }))).toBe("; the client's link, which showed version 2, no longer opens");
    expect(linkVersionWords(row({ currentVersion: 2, sentVersion: 2 }))).toBe("");
  });
});

describe("the layout a proposal carries", () => {
  const linked = { configurationId: "layout-1", layoutRoomName: "Grand Hall", layoutFromEnquiry: true };

  it("names the client's own layout and its room, another layout's room, one removed, or none", () => {
    expect(layoutFact(linked)).toEqual({ words: "Their own, Grand Hall", muted: false });
    expect(layoutFact({ ...linked, layoutFromEnquiry: false })).toEqual({ words: "Grand Hall", muted: false });
    expect(layoutFact({ ...linked, layoutRoomName: null, layoutFromEnquiry: false })).toEqual({ words: "Removed", muted: true });
    expect(layoutFact({ configurationId: null, layoutRoomName: null, layoutFromEnquiry: false })).toEqual({ words: "None", muted: true });
  });

  it("says nothing of a removed layout once the proposal is with the client, whose version keeps its drawing", () => {
    expect(layoutFact({ ...linked, layoutRoomName: null }, false)).toBeNull();
    expect(layoutFact(linked, false)).toEqual({ words: "Their own, Grand Hall", muted: false });
    expect(layoutFact({ configurationId: null, layoutRoomName: null, layoutFromEnquiry: false }, false)).toEqual({ words: "None", muted: true });
  });

  it("claims nothing when the API does not say", () => {
    expect(layoutFact({ configurationId: "layout-1", layoutRoomName: undefined, layoutFromEnquiry: undefined })).toBeNull();
    expect(layoutFact({ configurationId: null, layoutRoomName: undefined, layoutFromEnquiry: undefined })).toBeNull();
    expect(composerLayoutLine({ configurationId: "layout-1", layoutRoomName: undefined, layoutFromEnquiry: undefined })).toBeNull();
  });

  // Preview shows a saved version only, so it is offered for this one once saved.
  it("tells the composer the layout is taken as it stands, only while there is one", () => {
    expect(composerLayoutLine(linked)).toBe("Their layout is taken as it stands when you save. Once the version is saved, Preview as the client shows it as they will see it.");
    expect(composerLayoutLine({ ...linked, layoutFromEnquiry: false }))
      .toBe("The layout is taken as it stands when you save. Once the version is saved, Preview as the client shows it as they will see it.");
    expect(composerLayoutLine({ ...linked, layoutRoomName: null })).toBeNull();
    expect(composerLayoutLine({ configurationId: null, layoutRoomName: null, layoutFromEnquiry: false })).toBeNull();
  });
});
