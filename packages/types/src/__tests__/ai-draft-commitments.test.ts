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
//   BLIND: five sets, each written by a separate agent that never saw the
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
  "Thank you for your enquiry about Saturday 17th June.",
  "Carriages are at midnight, as you described.",
  "The 17th sounds like a lovely date.",
  "Your guests will arrive at 6pm.",
  // The internal summary the review ran end to end.
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
  // A known miss until the release review's patterns read a month as a date.
  ["availability", "Our Saturdays in June are still open."],
];

/** Clean as first written, when the client's words, budget and questions were
 *  excused; the release review's rule forbids a figure, a date's or room's
 *  availability and a room's size even repeated or asked about, so these are
 *  taken out now. */
const TAKEN_OUT_BY_THE_RULE = [
  "You mentioned a budget of around £10,000.", // REVIEW_CLEAN
  "They ask whether 14 August 2027 is free in the Grand Hall.", // REVIEW_CLEAN
  "They want to know if the hall can hold 180 for dinner and 220 in the evening.", // REVIEW_CLEAN
  "Their budget is around £12,000, and they ask whether a discount applies to Fridays.", // REVIEW_CLEAN
];

/** Claims the patterns do not catch, kept so a change that starts to is seen. */
const KNOWN_MISSES = [
  "The date you mentioned is available.",
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
  const takenOut = set.takenOutByTheRule ?? [];
  it.each(set.clean)("leaves alone: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it.each(set.dirty)("finds a %s claim in: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  it.runIf(takenOut.length > 0).each(takenOut)("takes out what the rule forbids, though written as clean: %s", (sentence) => {
    expect(findDraftCommitments(sentence).length).toBeGreaterThan(0);
  });
});

const EVERY_CLAIM = [
  ...TUNED_DIRTY, ...HELD_OUT_DIRTY, ...REVIEW_DIRTY, ...BLIND_SETS.flatMap((set) => set.dirty),
];

describe("words about the client never excuse a claim", () => {
  // Release review, 27 October 2026: a claim stated while answering the
  // client ("as you asked, room hire is £4,500") was excused whole, because
  // its clause held "you asked" or "budget"; 210 of 248 claims went unseen
  // behind such words. Only the client's budget figure, a quotation, and a
  // claim asked about ("whether the 17th is free") are not the draft's own.
  const lowerFirst = (sentence: string): string =>
    /^(?:I\b|I'm|I've|I'll|[A-Z][a-z]+ (?:Hall|Saloon|Room)|Grand|Saloon|Reception|Lower|December|Saturday|Sunday|Friday|June|January)/u.test(sentence)
      ? sentence
      : `${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
  const bare = (sentence: string): string => sentence.replace(/[.!?]$/u, "");
  const frames: Readonly<Record<string, (sentence: string) => string>> = {
    "As you mentioned, ...": (sentence) => `As you mentioned, ${lowerFirst(sentence)}`,
    "Since you asked, ...": (sentence) => `Since you asked, ${lowerFirst(sentence)}`,
    "With your budget in mind, ...": (sentence) => `With your budget in mind, ${lowerFirst(sentence)}`,
    "For the 150 guests you mentioned, ...": (sentence) => `For the 150 guests you mentioned, ${lowerFirst(sentence)}`,
    "Thank you for asking: ...": (sentence) => `Thank you for asking: ${lowerFirst(sentence)}`,
    "..., as you hoped.": (sentence) => `${bare(sentence)}, as you hoped.`,
    "..., which fits the budget.": (sentence) => `${bare(sentence)}, which fits the budget.`,
    "..., all within budget.": (sentence) => `${bare(sentence)}, all within budget.`,
    "... (budget permitting).": (sentence) => `${bare(sentence)} (budget permitting).`,
  };

  it.each(Object.keys(frames))("finds every known claim framed as %s", (name) => {
    const frame = frames[name];
    if (frame === undefined) throw new Error(name);
    const unseen = EVERY_CLAIM.filter(([kind, sentence]) => !findDraftCommitments(frame(sentence)).some((claim) => claim.kind === kind));
    expect(unseen.map(([, sentence]) => frame(sentence))).toEqual([]);
  });

  it.each([
    ["price", "As you asked, room hire is £4,500."],
    ["price", "You would need to pay a 25% deposit."],
    ["price", "You asked for a quote and room hire is £4,500."],
    ["price", "She mentioned the room hire would be £4,500."],
    ["price", "The client asked about the deposit; it is £500."],
    ["price", "If you book by Friday, the deposit is £500."],
    ["price", "Please let us know if £4,500 works for you."],
    ["price", "The team will explain what the £500 deposit covers."],
    ["price", "We'll confirm whether £65 per head includes wine."],
    ["price", "We'd suggest a budget of £10,000 for the evening."],
    ["price", "Your budget of £10k should comfortably cover the room and dinner."],
    ["availability", "If you prefer a Friday, the 18th is free."],
    ["availability", "As requested in your email, we have held the date for you."],
    ["availability", "You asked whether the 17th is free \u2014 it is."],
    ["availability", "You asked whether the 17th is free, and I'm pleased to say it is."],
    ["capacity", "Summary: client wants 250 seated, but the hall can't take more than 200 on rounds."],
    ["capacity", "For the 150 guests you mentioned, the Saloon would be too small."],
  ] as const)("finds a %s claim in: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  it.each([
    ["price", "Room hire: £4,500 + VAT."],
    ["price", "Price: 4,500 for the evening."],
    ["price", "Deposit: 25%."],
    ["availability", "Availability: free on 17 June."],
    ["availability", "17 June 2027: available."],
    ["availability", "Grand Hall \u2013 free on 17 June."],
    ["availability", "Date status: available."],
    ["capacity", "Capacity: 200 seated."],
    ["capacity", "Room: Grand Hall (seats 200)."],
  ] as const)("finds a %s claim written as a summary's label: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });
});

describe("what the rule asks for stays, and what it forbids goes, however it is framed", () => {
  // Release review, 27 October 2026 (third round): every exemption tried (the
  // client's words, their budget, quotation marks, a question, "whether" or
  // "if") let the draft's own claims through. Now nothing excuses a claim's
  // shape, and the rule tells the model to defer without one.
  it.each([
    "Our events team will confirm the details with you.",
    "Our events team will confirm prices and availability when they reply.",
    "The team will check the diary and come back to you about the date and the room.",
    "We'll come back to you on the figures, the date and the room.",
    "Could you tell us roughly how many guests you expect?",
    "The team will look at which rooms suit your plans.",
    "Summary: asks about price and availability for June 2027; has a budget in mind.",
    "The client asks about capacity for a seated dinner; the team to confirm.",
    "Thank you for letting us know your preferred date of Saturday 17 June.",
    "We'd love to host your wedding for your 150 guests.",
    "Drinks would be from 6.30pm, and dinner at 7.30pm, as you described.",
    "Our team is free to talk through the menu whenever suits you.",
    "Please feel free to bring your own cake.",
  ])("leaves alone: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it.each(TAKEN_OUT_BY_THE_RULE)("takes out what the rule forbids, though first written as clean: %s", (sentence) => {
    expect(findDraftCommitments(sentence).length).toBeGreaterThan(0);
  });

  it.each([
    ["price", "Budget: £10,000."],
    ["price", "You mentioned a budget of around £10,000."],
    ["price", "Your budget of £10,000 comfortably covers dinner for 150."],
    ["price", "Room hire is the same as your budget of £4,500."],
    ["price", "Room hire has a ceiling of £4,500."],
    ["price", "Option A (budget £4,500): the Grand Hall with dinner."],
    ["price", "If you book by Friday we'll waive the hire fee."],
    ["price", "If you book two nights we can offer a discount."],
    ["price", "As our website says, \"room hire is £4,500\"."],
    ["availability", "Client asked: 'Is the Saloon free on 3rd May?'"],
    ["availability", "You asked whether the Grand Hall is free on the 17th. I'm pleased to say it is."],
    ["availability", "Our events team will confirm whether the Saloon is available on the 14th."],
    ["availability", "If you'd like we can hold the date for you."],
    ["availability", "What you will find is the hall free on 17 June."],
    ["availability", "Would the hall be free on 17 June? It would."],
    ["capacity", "The good news is the Grand Hall seats 220."],
    ["capacity", "Even if you invite everyone the Grand Hall seats 300."],
    ["capacity", "Let me explain how the Saloon seats 90 for dinner."],
    ["capacity", "You asked whether the Saloon can seat 120. It can, comfortably."],
    ["capacity", "Your '20s theme suits the Grand Hall: it seats 200 and the guests' tables fit."],
  ] as const)("finds a %s claim in: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  it("takes the question out with its answer, so nothing of the claim is left", () => {
    const kept = withholdDraftCommitments("Dear Elaine,\n\nYou asked whether the Grand Hall is free on the 17th. I'm pleased to say it is.\n\nThe Events Team");
    expect(kept.text).toBe("Dear Elaine,\n\nThe Events Team");
    expect(kept.withheld).toEqual(["availability"]);
  });

  // Release review, fourth round: once the claim was out, the bare answer
  // to it stayed ("It is.", "It can, comfortably."), saying it for the claim.
  it.each([
    ["You asked whether the 17th is free. It is. We look forward to hearing from you.", "We look forward to hearing from you."],
    ["You asked whether the Saloon can seat 120.\nIt can, comfortably.\nWe look forward to hearing from you.", "We look forward to hearing from you."],
    ["Is the Saloon free on the 14th? Yes! Do let us know.", "Do let us know."],
    ["Can the Saloon take 120? I'm afraid not. Do let us know.", "Do let us know."],
    ["Is the Grand Hall free on the 17th?\n\nGood news: it is.\n\nWith best wishes,", "With best wishes,"],
    ["The 17th is free. It is, and we would love to host you. Do let us know.", "Do let us know."],
  ])("takes out the answer left after a claim: %s", (draft, left) => {
    expect(withholdDraftCommitments(draft).text).toBe(left);
  });

  it.each([
    ["The 17th is free. It is a beautiful room with high ceilings.", "It is a beautiful room with high ceilings."],
    ["The Saloon seats 90. Yes, we'd love to show you round.", "Yes, we'd love to show you round."],
    ["Is parking easy? It is. Do let us know.", "Is parking easy? It is. Do let us know."],
  ])("keeps what only looks like an answer, or answers no claim: %s", (draft, left) => {
    expect(withholdDraftCommitments(draft).text).toBe(left);
  });

  // Release review, fourth round: carve-outs for times, dates and opening
  // hours hid claims, and topic words a summary uses were taken out as claims.
  it.each([
    ["capacity", "The Grand Hall seats 180 to 220."],
    ["capacity", "The hall holds 150-200 standing."],
    ["capacity", "The Saloon seats between 80 and 100 for dinner."],
    ["capacity", "The Saloon is too small to seat 120."],
    ["capacity", "The Saloon would be a squeeze for 120."],
    ["capacity", "That's too many for the Saloon."],
    ["capacity", "For 150 guests you'd need the Grand Hall."],
    ["capacity", "There's room for everyone in the Saloon."],
    ["capacity", "Max 220 seated."],
    ["capacity", "The Saloon easily seats 120."],
    ["availability", "The Grand Hall is free for the 17th."],
    ["availability", "The Saloon is free from 2pm on the day."],
    ["availability", "The hall is free all day on Saturday."],
    ["availability", "The Saloon is free next Saturday."],
    ["availability", "The Grand Hall is available from the 14th."],
    ["availability", "June is open to bookings."],
    ["availability", "Provisional hold until Friday."],
    ["availability", "Your wedding on 14 June is confirmed."],
    ["price", "Room hire is 2,000 to 3,000 depending on the day."],
    ["price", "Room hire is 2,000-3,000 for the evening."],
    ["price", "We'll keep the menu well within your budget."],
    ["price", "Complimentary on-site parking is included."],
    ["price", "Parking is complimentary."],
    ["price", "Parking is included in the room hire."],
    ["price", "There's a midweek discount."],
    ["price", "Fridays are cheaper."],
    ["price", "The corkage fee is waived for weddings."],
    ["price", "We'll waive the corkage."],
  ] as const)("finds a %s claim a carve-out hid, or said in its giving words: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  it.each([
    "Asks about a discount for a Friday.",
    "The events team will let you know about discounts.",
    "Asks about complimentary parking.",
    "Asks about cheaper options midweek.",
    "Asks what is included in the room hire.",
    "Asks about the special rate for charities.",
    "Asks how provisional holds work.",
    "Asks about the maximum capacity of the Saloon.",
    "No date has been confirmed.",
    "Nothing for your event has been confirmed yet.",
    "The client asked us to hold off until their budget is agreed.",
    "It is clear that the client wants a relaxed evening.",
    "That's taken care of.",
    "Set-up easily takes two hours.",
    "There's room for questions at the end.",
    "There's space for 20 minutes of speeches.",
    "There's room for 10 to 15 minutes of questions.",
    "The corridor is too tight for a wheelchair.",
    "They expect up to 150 guests.",
    "Thursdays open to you for viewings.",
    "Max 2 cars per booking in the courtyard.",
  ])("leaves alone a topic named, not a claim made: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
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

  it("keeps everything else as written: abbreviations, spacing, indentation and line endings", () => {
    // Release review: "approx." and "e.g." ended a sentence, so taking out the
    // second half left "Dinner for approx. We look forward..."; and spacing was
    // collapsed on any line that lost a sentence.
    expect(withholdDraftCommitments("Dinner for approx. 150 guests in the Grand Hall is £9,750. We look forward to hearing from you.").text)
      .toBe("We look forward to hearing from you.");
    expect(withholdDraftCommitments("Some extras (e.g. corkage) are waived for weddings. Do get in touch with any questions.").text)
      .toBe("Do get in touch with any questions.");
    expect(withholdDraftCommitments("Thank you for your note.  We were delighted to hear from you.  The hall seats 200.").text)
      .toBe("Thank you for your note.  We were delighted to hear from you.");
    expect(withholdDraftCommitments("\t- The hall seats 200. Arrival at 6pm.").text).toBe("\t- Arrival at 6pm.");
    expect(withholdDraftCommitments("\t- Arrival at 6pm.\tThe hall seats 200.").text).toBe("\t- Arrival at 6pm.");
    expect(withholdDraftCommitments("1. The hall seats 200. Arrival at 6pm.\n2. Dinner at 7pm.").text).toBe("1. Arrival at 6pm.\n2. Dinner at 7pm.");
    expect(withholdDraftCommitments("Dear Elaine,\r\n\r\nThe hall seats 200.\r\n\r\nThe Events Team").text)
      .toBe("Dear Elaine,\r\n\r\nThe Events Team");
    const spaced = "Dear Morgan,\n\n\n\nThank you.   Truly.\n\nThe Events Team";
    expect(withholdDraftCommitments(spaced)).toEqual({ text: spaced, withheld: [] });
    // Third round: a line that goes adds no blank line; other list markers stay; "max." ends a sentence.
    expect(withholdDraftCommitments("Occasion: wedding\nCapacity: 200 seated\nGuests: 150").text).toBe("Occasion: wedding\nGuests: 150");
    expect(withholdDraftCommitments("Occasion: wedding\r\nCapacity: 200 seated\r\nGuests: 150").text).toBe("Occasion: wedding\r\nGuests: 150");
    expect(withholdDraftCommitments("\u2013 The hall seats 200. Arrival at 6pm.").text).toBe("\u2013 Arrival at 6pm.");
    expect(withholdDraftCommitments("a) The hall seats 200. Arrival at 6pm.").text).toBe("a) Arrival at 6pm.");
    expect(withholdDraftCommitments("> The hall seats 200. Arrival at 6pm.").text).toBe("> Arrival at 6pm.");
    expect(withholdDraftCommitments("The hall holds 200 max. We look forward to hearing from you.").text).toBe("We look forward to hearing from you.");
    // Fourth round: a title is not a list marker; a numeral is.
    expect(withholdDraftCommitments("Mrs. Smith asked whether the 17th is free. She would like a reply soon.").text).toBe("She would like a reply soon.");
    expect(withholdDraftCommitments("iv) The hall seats 200. Arrival at 6pm.").text).toBe("iv) Arrival at 6pm.");
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
      // Runs of stops, quotation marks, budgets and questions.
      ".".repeat(8_000), "!?".repeat(4_000), '"'.repeat(8_000), "' ".repeat(4_000),
      "your budget of £1 and ".repeat(380), "whether the hall is free ".repeat(320), "is the hall free on 1 May ".repeat(300),
    ]) {
      withholdDraftCommitments(text);
      findDraftCommitments(text);
    }
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});
