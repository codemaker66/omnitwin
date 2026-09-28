import { describe, expect, it } from "vitest";
import { clientAnswerNotice, clipped, proposalDeskPath } from "../services/client-answer-notice.js";

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

  it("never cuts through the middle of a character, emoji and flags included", () => {
    const accepted = (name: string): string =>
      clientAnswerNotice({ act: "accepted", proposalTitle: "Autumn gala", version: 1, name, words: null }).title;
    // A name is kept to 80 code units: 79 and the ellipsis. Each character
    // below would run past the 79th, so it goes whole.
    for (const [lead, character] of [[78, "🎉"], [78, "🇬🇧"], [77, "👍🏽"], [75, "👨‍👩‍👧"]] as const) {
      const title = accepted(`${"E".repeat(lead)}${character} and friends`);
      expect(title).toBe(`${"E".repeat(lead)}… accepted Autumn gala`);
      // No half of a pair left behind: in a /u pattern a lone half is a Cs code point.
      expect(/\p{Cs}/u.test(title)).toBe(false);
    }
    // One that fits is kept whole.
    expect(accepted(`${"E".repeat(75)}🇬🇧 and friends`)).toBe(`${"E".repeat(75)}🇬🇧… accepted Autumn gala`);
  });

  it("keeps whole code points where the runtime cannot tell characters", () => {
    // Without a way to tell characters, nothing is left half-written.
    expect(clipped(`${"E".repeat(78)}🎉 and friends`, 80, null)).toBe(`${"E".repeat(78)}…`);
    const flag = clipped(`${"E".repeat(76)}🇬🇧 and friends`, 80, null);
    expect(/\p{Cs}/u.test(flag)).toBe(false);
    expect(flag.length).toBeLessThanOrEqual(80);
  });

  it("keeps what it can of a single character longer than the limit", () => {
    // One letter with 199 accents is one character of 200 code units.
    const name = `e${"\u0301".repeat(199)}`;
    const title = clientAnswerNotice({ act: "accepted", proposalTitle: "Autumn gala", version: 1, name, words: null }).title;
    expect(title.startsWith(`e${"\u0301".repeat(78)}…`)).toBe(true);
    expect(title.endsWith(" accepted Autumn gala")).toBe(true);
  });
});

describe("proposalDeskPath", () => {
  it("opens the proposal on the Proposals desk", () => {
    expect(proposalDeskPath("66666666-6666-4666-8666-666666666666"))
      .toBe("/dashboard?view=proposals&proposal=66666666-6666-4666-8666-666666666666");
  });
});
