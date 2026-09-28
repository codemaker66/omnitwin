import { describe, expect, it } from "vitest";
import { clientAnswerNotice, proposalDeskPath } from "../services/client-answer-notice.js";

// ---------------------------------------------------------------------------
// What the venue team is told when a client answers a proposal (roadmap X1):
// who, what and which proposal, then the version and the client's own words,
// kept within the change feed's limits so a long name or note never costs
// the notice.
// ---------------------------------------------------------------------------

describe("clientAnswerNotice", () => {
  it("says who accepted which proposal, the version and what they wrote", () => {
    expect(clientAnswerNotice({
      act: "accepted", proposalTitle: "Crawford wedding proposal", version: 2, name: " Elaine Crawford ", words: "See you in June.",
    })).toEqual({
      title: "Elaine Crawford accepted Crawford wedding proposal",
      summary: "Version 2. “See you in June.”",
      actorLabel: "Elaine Crawford",
    });
  });

  it("says the client when no name was given, and gives no words that were not written", () => {
    expect(clientAnswerNotice({ act: "changes", proposalTitle: "Autumn gala", version: 1, name: "  ", words: null })).toEqual({
      title: "The client asked for changes to Autumn gala",
      summary: "Version 1.",
      actorLabel: "Client",
    });
    expect(clientAnswerNotice({ act: "comment", proposalTitle: "Autumn gala", version: 3, name: undefined, words: "Is there parking?" }).title)
      .toBe("The client wrote about Autumn gala");
  });

  it("says where it was answered when there is no version and no words", () => {
    expect(clientAnswerNotice({ act: "accepted", proposalTitle: "Autumn gala", version: null, name: null, words: "" }).summary)
      .toBe("Answered on the client's page.");
  });

  it("keeps a long name, title and note within the feed's limits", () => {
    const notice = clientAnswerNotice({
      act: "changes", proposalTitle: "P".repeat(200), version: 12, name: "N".repeat(200), words: "W".repeat(1000),
    });
    expect(notice.title.length).toBeLessThanOrEqual(180);
    expect(notice.title.startsWith(`${"N".repeat(79)}… asked for changes to P`)).toBe(true);
    expect(notice.title.endsWith("…")).toBe(true);
    expect(notice.actorLabel.length).toBeLessThanOrEqual(160);
    expect(notice.summary.length).toBeLessThanOrEqual(800);
    expect(notice.summary.startsWith("Version 12. “W")).toBe(true);
    expect(notice.summary.endsWith("…”")).toBe(true);
  });
});

describe("proposalDeskPath", () => {
  it("opens the proposal on the Proposals desk", () => {
    expect(proposalDeskPath("66666666-6666-4666-8666-666666666666"))
      .toBe("/dashboard?view=proposals&proposal=66666666-6666-4666-8666-666666666666");
  });
});
