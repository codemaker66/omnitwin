import { describe, expect, it } from "vitest";
import { findDraftCommitments, withholdDraftCommitments, type AIDraftCommitmentKind } from "../ai-draft-commitments.js";

// ---------------------------------------------------------------------------
// The check after the model (Plan 19, L6): a draft never states a price,
// availability or capacity. Two sets of sentences, all made up, none from a
// real enquiry. TUNED was written with the patterns and adjusted beside them.
// HELD_OUT was written before the patterns were first run against it, on 27
// October 2026: on that first run every one of its 31 sentences was read
// right. One of its sentences ("The Saloon costs 900 for an afternoon") was
// missed after a later tightening of the price patterns, and the patterns were
// then changed to catch it, so it is no longer an unseen measure. Both sets
// were written by the developing agent, not by venue staff; they show the
// patterns do what they say, not how often real drafts trip them.
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

describe("what a draft may not say", () => {
  it.each([...TUNED_CLEAN, ...HELD_OUT_CLEAN])("leaves alone: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it.each([...TUNED_DIRTY, ...HELD_OUT_DIRTY])("finds a %s claim in: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  it("names the words that made each claim, one per kind", () => {
    expect(findDraftCommitments("The Grand Hall seats 200, is free on the 17th and costs £2,500.")).toEqual([
      { kind: "price", phrase: "£2,500" },
      { kind: "capacity", phrase: "seats 200" },
    ]);
    expect(findDraftCommitments("The date is free. It seats 200. It is £900.").map((claim) => claim.kind))
      .toEqual(["price", "availability", "capacity"]);
  });
});

describe("taking the claims out of a draft", () => {
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

  it("leaves nothing of a draft that is all claims", () => {
    expect(withholdDraftCommitments("The date is free. It costs £900.")).toEqual({ text: "", withheld: ["price", "availability"] });
  });
});
