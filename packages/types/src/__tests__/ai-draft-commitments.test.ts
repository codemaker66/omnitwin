import { describe, expect, it } from "vitest";
import {
  draftLeftAfterWithholding,
  findDraftCommitments,
  sentencesOf,
  withholdDraftCommitments,
  type AIDraftCommitmentKind,
} from "../ai-draft-commitments.js";
import { BLIND_SETS } from "./ai-draft-blind-sets.js";

// ---------------------------------------------------------------------------
// The check after the model (Plan 19, L6): a draft never states a price,
// availability or capacity. Sentence sets, all made up, none from a real
// enquiry, each named by how independent it is of the patterns:
//
//   TUNED: written with the first patterns and adjusted beside them.
//   HELD_OUT: written before the first patterns ran on it (all 31 read right
//     then; one was later missed and fixed, so it is no longer unseen).
//   REVIEW: written by the independent reviewer of the first patterns, who
//     found them unsafe (33 of 39 clean sentences taken out, 41 of 41 claims
//     missed). The patterns were rewritten with these in view, so they show
//     the rewrite answers the review, not how it reads text it has not seen.
//   BLIND: three sets, each written by a separate agent that never saw the
//     patterns, and each run once before it was seen; ai-draft-blind-sets.ts
//     records those first runs, which are the measure of text not seen.
//
// None was written by venue staff. They show what the patterns do and do not
// do, not how often real drafts trip them; the live evaluation records that.
// ---------------------------------------------------------------------------

const TUNED_CLEAN = [
  "Dear Elaine, thank you for thinking of the Grand Hall for your wedding on 17 September 2027.",
  "We'd love to help you plan a dinner for your 150 guests.",
  "Thank you for your enquiry about a dinner for 150 guests on 1 June 2027.",
  "You mentioned around 120 guests, with dancing after dinner.",
  "Our events team will confirm prices and availability for your date as soon as they can.",
  "The team will check availability for 17 September 2027 and come back to you.",
  "Please see the proposal for the figures; we'll be happy to talk them through.",
  "We will confirm the date with you once you are ready.",
  "Could you let us know roughly how many guests you expect?",
  "We'd be glad to arrange a visit so you can see the room for yourself.",
  "The proposal sets out the rooms and the arrangements we have discussed.",
  "If you'd like a call, reply to this message and the team will get in touch.",
  "With best wishes, The Events Team",
  "Your enquiry mentions that your father is a wheelchair user; the team will talk you through the route into the hall and the facilities.",
  "Two of your guests are coeliac, and we'll make sure the catering team knows.",
  "A drinks reception from 6.30pm, then dinner at 7.30pm, as you described.",
  "Thank you for coming back to us with the change to 160 guests.",
  "We look forward to hearing from you.",
  "The conference would run from 0930 to 1700, as you outlined.",
  "We are happy to answer any questions about the proposal.",
  "Summary: a wedding enquiry for about 150 guests on 1 June 2027, in the Grand Hall, still under review.",
  "The guest asks about price and availability; the team needs to answer both.",
  "Received on 26 October 2026; no reply recorded yet.",
  "This room's capacity figure is unverified and awaits review.",
  "The selected table's catalogue entry and placement evidence are shown here.",
  "Florist to arrive by 2pm; three supplier notes in the handoff pack.",
  "We'd be delighted to host your wedding.",
  "Thank you for your patience while we put this together.",
  "Room hire for 150 guests is set out in the proposal.",
  "The quote for your 150 guests is attached.",
  "Hire of the Grand Hall on 17 September 2027 is in the proposal.",
  "The price is in the proposal for 160 guests.",
  "The cost of your day will depend on the menu you choose.",
  // Times and counts that are not capacity, and open or free followed by "to".
  "The turnaround takes 45 minutes between the ceremony and dinner.",
  "The reception could run for up to 2 hours before dinner.",
  "That is open to discussion with the team.",
  "The total is 1,500 guests over the two days, as you wrote.",
];

const TUNED_DIRTY: readonly (readonly [AIDraftCommitmentKind, string])[] = [
  ["price", "The Grand Hall is £2,500 for the evening."],
  ["price", "Hire starts at 1,800 pounds."],
  ["price", "Dinner is £65 per head."],
  ["price", "Catering would be 65pp."],
  ["price", "The deposit is 500 and is due on signing."],
  ["price", "We can offer the room free of charge."],
  ["price", "We are happy to waive the hire fee."],
  ["price", "We can offer a 10% discount for a Friday."],
  ["price", "Room hire is complimentary with dinner."],
  ["price", "The minimum spend is 5000."],
  ["price", "That comes to GBP 4,200 including VAT."],
  ["price", "The hire fee is 2,000."],
  ["price", "The total would be 3,450 with the drinks package."],
  ["availability", "I'm pleased to say the Grand Hall is available on 17 September 2027."],
  ["availability", "The date is still free."],
  ["availability", "Saturday is fully booked, I'm afraid."],
  ["availability", "We have availability on 1 June 2027."],
  ["availability", "We have held the date for you."],
  ["availability", "We can confirm the booking."],
  ["availability", "Your date is confirmed."],
  ["availability", "There are no other bookings that day."],
  ["availability", "Unfortunately that date isn't available."],
  ["availability", "Unfortunately that date isn’t available."],
  ["availability", "The room is yours on the 17th."],
  ["availability", "We've pencilled you in for June."],
  ["availability", "Good news, it's free that weekend."],
  ["capacity", "The Grand Hall seats up to 200 for dinner."],
  ["capacity", "It holds 300 standing."],
  ["capacity", "The room has a capacity of 180."],
  ["capacity", "We can comfortably accommodate your 150 guests."],
  ["capacity", "The hall is big enough for everyone."],
  ["capacity", "There's plenty of room for dancing."],
  ["capacity", "Up to 120 guests can be seated."],
  ["capacity", "The Saloon takes 60 for a reception."],
  ["capacity", "Your party of 160 is well within capacity."],
  ["capacity", "The room will fit all of your guests."],
];

const HELD_OUT_CLEAN = [
  "Thank you so much for getting in touch about your daughter's wedding next summer.",
  "It sounds like a wonderful celebration, and we'd be glad to help shape it.",
  "You asked whether the hall could take a ceilidh band; the team will look into the details with you.",
  "We'll come back to you with the options for the date you have in mind.",
  "Once we have your final numbers, we can update the proposal.",
  "The figures in the proposal are the ones to go by.",
  "We understand you are hoping for 14 August 2027.",
  "You mentioned a budget; the team will talk you through what is possible.",
  "Thanks for letting us know about the vegan and nut-free meals.",
  "We'd suggest a visit on a weekday morning, if that suits you.",
  "The events team will be in touch to talk through your plans.",
  "Kind regards, The Events Team at the Trades Hall",
  "A summary of the enquiry: corporate dinner, roughly 80 people, date not yet given.",
  "The client would like the room flipped from the ceremony to dinner.",
  "Please reply with any questions at all.",
  "We hope this gives you a good picture of how the evening could run.",
];

const HELD_OUT_DIRTY: readonly (readonly [AIDraftCommitmentKind, string])[] = [
  ["price", "The price for exclusive use is £7,000."],
  ["price", "We charge 1500 GBP for the day."],
  ["price", "There would be no extra charge for the ceremony set-up."],
  ["price", "The Saloon costs 900 for an afternoon."],
  ["price", "Canapés are priced at £12 per person."],
  ["availability", "Good news: 14 August 2027 is free in the Grand Hall."],
  ["availability", "The Grand Hall is not available that weekend."],
  ["availability", "We are happy to confirm your date."],
  ["availability", "I have reserved the Saloon for you until Friday."],
  ["availability", "That Saturday looks free at the moment."],
  ["capacity", "The Grand Hall can seat 220 at round tables."],
  ["capacity", "The Saloon accommodates up to 90 for a reception."],
  ["capacity", "With 180 guests you'd be at the hall's maximum of 200."],
  ["capacity", "It will easily hold your 150 guests."],
  ["capacity", "The room is too small for a seated dinner of that size."],
];

const REVIEW_CLEAN = [
  "You're hoping to host around 150 guests for dinner.",
  "You'd like to seat 150 for dinner and have 200 for the evening reception.",
  "You mentioned you'd like to welcome 120 guests in the evening.",
  "We'd love to welcome your 150 guests to the Grand Hall.",
  "We'd be delighted to welcome 150 of your guests.",
  "You're planning to take 40 guests on to the ceilidh afterwards.",
  "Our events team can confirm availability and prices when they reply.",
  "The events team can confirm the figures for you.",
  "I can confirm we've received your enquiry, and the team will be in touch.",
  "We're happy to confirm the details once you've had a look.",
  "We are pleased to confirm receipt of your enquiry.",
  "Our events team will confirm the capacity for your 150 guests.",
  "We'll check the capacity of the Grand Hall for 160 guests and come back to you.",
  "On 1 June, capacity will be confirmed by the team.",
  "The team will let you know about availability for Saturday 17th.",
  "We'll seat your guests at round tables of ten.",
  "After the ceremony, we'll take your guests through to the Saloon for drinks.",
  "Our staff will take the guests' coats as they arrive.",
  "The team will fit the party's timings around the speeches.",
  "Set-up takes 4 staff and two hours.",
  "Up to 6 suppliers may need access to the loading bay.",
  "No more than 2 vehicles can use the loading bay at once.",
  "We've allowed for a total of 15 round tables.",
  "Total 15 round tables and 150 chairs.",
  "Staffing is at a rate of 1 server per 10 guests.",
  "Your room hire is from 10 until midnight.",
  "We've held weddings in the Grand Hall for over two centuries.",
  "The day is yours, and we want it to feel that way.",
  "It's yours to shape however you like.",
  "The evening is yours to enjoy.",
  "This is free text from your enquiry, so we've read it carefully.",
  "It's free for your guests to use the cloakroom.",
  "The hall is open until midnight on Saturdays.",
  "I've blocked out some time on Thursday to call you.",
  "You mentioned a budget of around £10,000.",
  "Thank you for your enquiry about Saturday 17th June.",
  "Carriages are at midnight, as you described.",
  "The 17th sounds like a lovely date.",
  "Your guests will arrive at 6pm.",
  // The internal summary the review ran end to end.
  "They ask whether 14 August 2027 is free in the Grand Hall.",
  "They want to know if the hall can hold 180 for dinner and 220 in the evening.",
  "Their budget is around £12,000, and they ask whether a discount applies to Fridays.",
  "This layout seats 180 at 18 round tables of ten.",
];

const REVIEW_DIRTY: readonly (readonly [AIDraftCommitmentKind, string])[] = [
  ["availability", "Good news: 14 August is free in the Grand Hall."],
  ["availability", "Saturday 17th is free."],
  ["availability", "The 17th is still available."],
  ["availability", "June 1st is available for your wedding."],
  ["availability", "The Grand Hall would be available on that date."],
  ["availability", "Both rooms are free that evening."],
  ["availability", "We're free on the 17th."],
  ["availability", "We have the 17th free."],
  ["availability", "17 September 2027 works well for us."],
  ["availability", "We'll hold the date for you for 14 days."],
  ["availability", "We could pencil you in for the 17th."],
  ["availability", "The diary is clear on the 17th."],
  ["availability", "I'm happy to confirm the Grand Hall for the 17th."],
  ["availability", "Nothing else is booked in the Grand Hall that weekend."],
  ["availability", "I'm afraid the 17th has already gone."],
  ["capacity", "The Grand Hall is ideal for 200."],
  ["capacity", "It's perfect for a party of 150."],
  ["capacity", "The Saloon works well for 80 guests."],
  ["capacity", "Your 150 guests will fit nicely."],
  ["capacity", "There's room for everyone."],
  ["capacity", "200 guests can be seated in the Grand Hall."],
  ["capacity", "The Grand Hall seats two hundred for dinner."],
  ["capacity", "The Grand Hall has space for 200."],
  ["capacity", "Seating for 200 is possible in the Grand Hall."],
  ["capacity", "The hall holds approx. 200 guests."],
  ["capacity", "The Grand Hall can comfortably cater to 180."],
  ["price", "Room hire is two thousand pounds."],
  ["price", "Dinner is 65 a head."],
  ["price", "There's a 500 deposit to secure the date."],
  ["price", "That works out at 4,200 altogether."],
  ["price", "You'd be looking at about 3,000 for the evening."],
  ["price", "The Saloon would be 900 plus VAT for the afternoon."],
  ["price", "The minimum spend for Saturdays in December is 12,000."],
  ["price", "We'd be happy to include the ceremony room for free."],
  ["price", "Weddings start from 5,000 in the Grand Hall."],
  ["price", "We'd be looking at 2k for the room."],
  ["price", "It's 1.5k for the day."],
];

/** Claims the patterns do not catch, kept so a change that starts to is seen. */
const KNOWN_MISSES = [
  "The date you mentioned is available.",
  "Our Saturdays in June are still open.",
  "The three-course dinner is 65 each.",
  "The cloakroom is free for your guests.",
];

describe("what a draft may not say", () => {
  it.each([...TUNED_CLEAN, ...HELD_OUT_CLEAN, ...REVIEW_CLEAN])("leaves alone: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it.each([...TUNED_DIRTY, ...HELD_OUT_DIRTY, ...REVIEW_DIRTY])("finds a %s claim in: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  it("names the words that made each claim, one per kind", () => {
    expect(findDraftCommitments("The Grand Hall seats 200 and costs £2,500.")).toEqual([
      { kind: "price", phrase: "£2,500" },
      { kind: "capacity", phrase: "Hall seats 200" },
    ]);
    expect(findDraftCommitments("The date is free. It seats 200. It is £900.").map((claim) => claim.kind))
      .toEqual(["price", "availability", "capacity"]);
  });
});

describe.each(BLIND_SETS)("$name, now that it has been seen", (set) => {
  it.each(set.clean)("leaves alone: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it.each(set.dirty)("finds a %s claim in: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });
});

describe("a claim asked about, reported or made", () => {
  // Release review, 27 October 2026: the draft's rules tell the model to say
  // the team will confirm a price, a date or a room's size, so those words
  // must stay; and a clause of the client's words no longer hides the
  // draft's own claim in the next clause.
  it.each([
    "Our events team will confirm whether the Saloon is available on the 14th.",
    "The team will check if the Grand Hall is free on Saturday 17 May.",
    "We'll let you know whether the room can seat 120 for dinner.",
    "We'll let you know what's included in the price once the team has looked at your plans.",
    "Internal: client prefers the Saloon; asked about capacity for 120 seated.",
    "The client asked us to hold off until their budget is agreed.",
  ])("leaves alone: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it.each([
    ["price", "The client asked about the deposit; it is £500."],
    ["price", "If you book by Friday, the deposit is £500."],
    ["price", "Your budget of £10k should comfortably cover the room and dinner."],
    ["availability", "You asked whether the 17th is free \u2014 it is."],
    ["capacity", "Summary: client wants 250 seated, but the hall can't take more than 200 on rounds."],
  ] as const)("finds a %s claim in: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });
});

describe("what the patterns do not catch", () => {
  // Precision first: the rules and the person reading the draft are the
  // other guards. These stay recorded as misses rather than be chased with
  // patterns that would take out sentences that make no claim.
  it.each(KNOWN_MISSES)("misses: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });
});

describe("reading a line in sentences", () => {
  // Release review, 27 October 2026: the first splitter kept only the text up
  // to each full stop before a space, so "6.30pm" lost everything before it.
  it.each([
    "Drinks would be from 6.30pm and dinner at 7.30pm, as you described.",
    'You wrote "we\'d love something relaxed and warm." It will be.',
    '"Is the 14th free?" you asked.',
    "See www.tradeshallglasgow.co.uk for the rooms (and e.g. the Saloon).",
    "Carriages at 12.30am; our events team can confirm the timings... And then?",
    "No full stop at the end",
    "",
  ])("loses nothing: %s", (line) => {
    expect(sentencesOf(line).join("")).toBe(line);
  });

  it("splits at a full stop, a question or an exclamation before a space, with any closing quote", () => {
    expect(sentencesOf('Thank you. "Is it free?" she asked! Fine')).toEqual(["Thank you.", ' "Is it free?"', " she asked!", " Fine"]);
    expect(sentencesOf("From 6.30pm. Then 7.30pm.")).toEqual(["From 6.30pm.", " Then 7.30pm."]);
  });
});

describe("taking the claims out of a draft", () => {
  it("keeps a clean draft whole, full stops inside its sentences and all", () => {
    const draft = [
      "Dear Elaine,",
      "",
      "Thank you for your note. Drinks would be from 6.30pm and dinner at 7.30pm, as you described.",
      'You wrote "we\'d love something relaxed and warm." That is just what the Grand Hall does well (e.g. with candles).',
      "Carriages are at 12.30am; our events team can confirm the timings with you.",
      "",
      "The Events Team",
    ].join("\n");
    expect(withholdDraftCommitments(draft)).toEqual({ text: draft, withheld: [] });
  });

  it("leaves no claim the draft schema would find, however a claim falls across sentences", () => {
    const drafts = [
      "The Grand Hall seats max. 200 guests.",
      "The hall holds approx. 200 guests. We look forward to hearing from you.",
      "Room hire\nfrom 10 until 6",
      "Total\n12 arrangements",
      ...[...TUNED_DIRTY, ...HELD_OUT_DIRTY, ...REVIEW_DIRTY].map(([, sentence]) => `Dear Morgan, thank you for your enquiry. ${sentence} We look forward to hearing from you.`),
    ];
    for (const draft of drafts) {
      const kept = withholdDraftCommitments(draft);
      expect(findDraftCommitments(kept.text), draft).toEqual([]);
    }
  });

  it("takes out only the sentences that make a claim, keeping the paragraphs and the sign-off", () => {
    const draft = [
      "Dear Elaine,",
      "",
      "Thank you for thinking of the Grand Hall for your wedding on 17 September 2027. I'm pleased to say the Grand Hall is available on that date! It seats up to 200, so your 150 guests will fit comfortably.",
      "",
      "Dinner is £65 per head. Our events team will confirm prices with you.",
      "",
      "With best wishes,",
      "The Events Team",
    ].join("\n");
    expect(withholdDraftCommitments(draft)).toEqual({
      text: [
        "Dear Elaine,",
        "",
        "Thank you for thinking of the Grand Hall for your wedding on 17 September 2027.",
        "",
        "Our events team will confirm prices with you.",
        "",
        "With best wishes,",
        "The Events Team",
      ].join("\n"),
      withheld: ["price", "availability", "capacity"],
    });
  });

  it("drops a paragraph left with nothing in it, and leaves one blank line between those either side", () => {
    const draft = "Dear Morgan,\n\nThe hall holds 300 standing.\n\nWe look forward to hearing from you.";
    expect(withholdDraftCommitments(draft)).toEqual({
      text: "Dear Morgan,\n\nWe look forward to hearing from you.",
      withheld: ["capacity"],
    });
  });

  it("changes nothing in a draft that makes no claim", () => {
    const draft = "Dear Morgan,\n\nThank you for your message. The team will confirm the date and the figures.\n\nThe Events Team";
    expect(withholdDraftCommitments(draft)).toEqual({ text: draft, withheld: [] });
  });

  it("leaves nothing of a draft that is all claims, and no draft where a greeting and a sign-off are all that is left", () => {
    expect(withholdDraftCommitments("The date is free. It costs £900.")).toEqual({ text: "", withheld: ["price", "availability"] });
    const bare = withholdDraftCommitments("Dear Elaine,\n\nThe Grand Hall is free on the 17th.\n\nWith best wishes,\nThe Events Team");
    expect(bare.text).toBe("Dear Elaine,\n\nWith best wishes,\nThe Events Team");
    expect(draftLeftAfterWithholding(bare)).toBe(false);
    expect(draftLeftAfterWithholding(withholdDraftCommitments("Dear Elaine, thank you.\n\nThe Events Team"))).toBe(true);
    expect(draftLeftAfterWithholding({ text: "", withheld: [] })).toBe(false);
  });

  // Release review: an unbounded number pattern took 2.4 s on 8,000 characters
  // of digits and commas. Every pattern is bounded now.
  it("reads the longest draft in time that grows with it, not its square", () => {
    const started = performance.now();
    for (const text of [
      "1,".repeat(4_000), "1 ".repeat(4_000), "a ".repeat(4_000), "1.".repeat(4_000), `${"9".repeat(7_990)} capacity`,
      // Many claims in one sentence, a long run of spaces before one, many clauses and many colons.
      "£1 ".repeat(2_700), "if £1 ".repeat(1_400), `${" ".repeat(8_000)}within your budget`,
      "the hall is free; ".repeat(470), "wrote: ".repeat(1_140), "hall seats 10 ".repeat(570),
    ]) {
      withholdDraftCommitments(text);
      findDraftCommitments(text);
    }
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
