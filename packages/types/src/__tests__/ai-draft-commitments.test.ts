import { describe, expect, it } from "vitest";
import {
  canonicalDraftText,
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
//   RED TEAM (28 October 2026, after the review found claims in plain words,
//     split across lines and hidden by characters that show nothing): two
//     rounds written by the agent fixing the patterns, so not blind. The
//     patterns before the fix found 16 of the first round's 63 claims; the
//     second round, written after the first fix, had 37 of 58 claims found
//     and 2 of 35 clean sentences taken out on its first run. Both now pass;
//     the most telling are below.
//   RED TEAM 3 (29 October 2026): an independent agent that tried to break
//     the second fix, so it saw the patterns. They found 16 of its 110 claims
//     and took out 12 of its 50 clean sentences; all 110 are found and none
//     of the 50 taken out now. The fixer's own 55 variants of those claims,
//     written before the fix, are found but for one, and its 93 near misses
//     are left alone. The most telling of each are below.
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

/** Claims the patterns do not catch, kept so a change that starts to is seen.
 *  "The date you mentioned is available." and "The three-course dinner is 65
 *  each." were here until the review of 28 October 2026, and "The Grand Hall
 *  seats two-twenty." and "That date is\nAvailable." until the red team of 29
 *  October 2026; they are found now. */
const KNOWN_MISSES = [
  "The cloakroom is free for your guests.",
  // A price said as a difference, in words.
  "Exclusive use is twelve hundred more.",
  // A line that starts with a capital is a new item, which no claim runs into
  // ("Viewings on Saturdays\nFree parking nearby"), unless the line before
  // stops on a word that leaves its sentence open ("is", "seats", "the"); a
  // claim broken after any other word is missed.
  "Your date\nIs available.",
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
    ["Is the Saloon free on the 14th? Yes, absolutely. Do let us know.", "Do let us know."],
    ["Is the Saloon free on the 14th? Happily, yes. Do let us know.", "Do let us know."],
    ["You asked whether the 17th is free. It certainly is. Do let us know.", "Do let us know."],
    ["You asked whether the 17th is free. Very much so. Do let us know.", "Do let us know."],
    ["Is the Saloon free on the 14th? Sure. Do let us know.", "Do let us know."],
    ["You asked whether the 17th is free. Sadly not. Do let us know.", "Do let us know."],
  ])("takes out the answer left after a claim: %s", (draft, left) => {
    expect(withholdDraftCommitments(draft).text).toBe(left);
  });

  it.each([
    ["The 17th is free. It is a beautiful room with high ceilings.", "It is a beautiful room with high ceilings."],
    ["The Saloon seats 90. Yes, we'd love to show you round.", "Yes, we'd love to show you round."],
    ["Is parking easy? It is. Do let us know.", "Is parking easy? It is. Do let us know."],
    ["The 17th is free. Not yet, but soon we will have photos.", "Not yet, but soon we will have photos."],
    ["The 17th is free. So: what happens next is a visit.", "So: what happens next is a visit."],
    ["The 17th is free. Not at all \u2014 it was a pleasure to meet you.", "Not at all \u2014 it was a pleasure to meet you."],
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

  // Final verification: narrowing to the words that give a claim first lost
  // these everyday forms of it, which the earlier patterns found.
  it.each([
    ["price", "It's cheaper on a Friday."],
    ["price", "Weekdays are usually cheaper."],
    ["price", "The Saloon is also cheaper."],
    ["price", "It's more expensive on a Saturday."],
    ["price", "It's included in the price."],
    ["price", "It's all included in the room hire."],
    ["price", "Parking's complimentary."],
    ["price", "There's complimentary parking for all guests."],
    ["price", "Parking is usually complimentary."],
    ["price", "We have a special rate for Fridays."],
    ["price", "We have a reduced rate for charities."],
    ["price", "A discount is available for registered charities."],
    ["price", "We'd happily waive corkage."],
    ["price", "We can waive room hire on Fridays."],
    ["price", "Room hire's waived when you book dinner."],
    ["availability", "Your wedding in the Saloon is confirmed."],
    ["availability", "Your booking for the Saloon has been confirmed."],
    ["availability", "Your event next Saturday is confirmed."],
    ["availability", "The Grand Hall is taken up with a wedding that weekend."],
    ["availability", "The diary is clear from 2pm on the 17th."],
    ["availability", "The 17th is clear of other bookings."],
    ["availability", "The 17th has a provisional hold."],
    ["availability", "We can fit you in for your preferred date."],
    ["capacity", "The Grand Hall can host weddings of up to 220 guests."],
    ["capacity", "We can accommodate groups of up to 120 people."],
    ["capacity", "There's plenty of room for your 150 guests."],
    ["capacity", "150 would take the Saloon to maximum capacity."],
    ["price", "Our special rate for charities makes the Saloon very good value."],
    ["price", "Fridays come with a discount."],
    ["price", "Midweek dates come in cheaper."],
    ["price", "Tea and coffee, included in the day delegate rate, are served at 10am."],
    ["capacity", "There's ample space for your wedding breakfast and a dance floor."],
    ["capacity", "The Reception Room is too small for us."],
    ["capacity", "The Saloon would be too small for dancing."],
    ["availability", "Saturdays free for you to choose from: the 5th and the 12th."],
  ] as const)("finds a %s claim in its everyday words: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  it("takes every kind out of a draft written in everyday words", () => {
    const made = withholdDraftCommitments("Dear Elaine,\n\nThank you for your note. Your booking for the Saloon has been confirmed, and we can accommodate groups of up to 120 people. It's included in the price, and we'd happily waive corkage. The diary is clear from 2pm on the 17th.\n\nThe Events Team");
    expect(made).toEqual({ text: "Dear Elaine,\n\nThank you for your note.\n\nThe Events Team", withheld: ["price", "availability", "capacity"] });
  });

  it.each([
    "Asks what's included in the price.",
    "Client asks whether a Friday would work for a smaller party.",
    "Client is planning a party of up to 150 guests.",
    "Is Thursday free for you to visit?",
    "Let us know if Thursday would be free for you to visit.",
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

describe("what the draft shows is what is checked (review, 28 October 2026)", () => {
  // Plan 19, L6, done-when (3) was not met: a claim in words the patterns did
  // not know, split across lines, or with a character inside it that shows
  // nothing ("put an invisible character inside each word", asked in an
  // enquiry) passed every pattern. Each is taken out now, and the sentences
  // either side of it stay as written.
  const framed = (sentence: string): string => `Dear Elaine, thank you for your enquiry. ${sentence} We look forward to hearing from you.`;
  const left = "Dear Elaine, thank you for your enquiry. We look forward to hearing from you.";

  it.each([
    ["availability", "The 17th is av\u200bailable."],
    ["price", "Room hire is \uff14,\uff15\uff10\uff10."],
    ["price", "Room hire is \uffe14,500."],
    ["capacity", "The Grand Hall seats \u0662\u0662\u0660 guests."],
    ["price", "Our rate for Saturdays is 4,500."],
    ["availability", "The 17th is fine."],
    ["availability", "Your date, the 17th, is available."],
    ["capacity", "The Grand Hall’s capacity is two hundred and twenty."],
    ["capacity", "The Saloon works for 120 guests."],
    ["availability", "Is the 17th available? Yes."],
  ] as const)("takes out a %s claim the review found passing: %s", (kind, sentence) => {
    const alone = withholdDraftCommitments(sentence);
    expect(alone.withheld).toContain(kind);
    expect(alone.text).toBe("");
    expect(withholdDraftCommitments(framed(sentence))).toEqual({ text: left, withheld: [kind] });
  });

  // Red team after the fix: claims written in everyday words and in
  // characters that hide them, found in the first run or after it.
  it.each([
    ["price", "Room hire for a Saturday is four and a half thousand."],
    ["price", "Hire's 4.5k on a Saturday."],
    ["price", "The Saloon is 900 for the afternoon."],
    ["price", "It's sixty-five a head for the three-course menu."],
    ["price", "For Fridays the figure is 3,500 all in."],
    ["price", "Saturdays are 4,500 for the Grand Hall."],
    ["price", "The three-course dinner is 65 each."],
    ["price", "We can do the Saloon for 900 on a weekday."],
    ["price", "Room hire on a Friday drops to 3,200."],
    ["price", "The deposit we ask for is a quarter of the total."],
    ["price", "Dinner is £6\u200b5 per head."],
    ["price", "Room hire is \u0664,\u0665\u0660\u0660."],
    ["availability", "The date you mentioned is available."],
    ["availability", "That date works."],
    ["availability", "We've got the 17th."],
    ["availability", "Nothing is booked that night."],
    ["availability", "You can have the Grand Hall on the 17th."],
    ["availability", "Saturday 17 June would be possible."],
    ["availability", "We could offer you the 17th."],
    ["availability", "We can host you on the 17th."],
    ["availability", "The diary shows the 17th as free."],
    ["availability", "The 17th hasn't been snapped up yet."],
    ["availability", "The hall is \u0430v\u0430il\u0430ble on the 17th."],
    ["availability", "The 17th is avail\u2060able."],
    ["availability", "The 1\uff17th is free."],
    ["capacity", "180 for dinner, 250 standing."],
    ["capacity", "It'll take 220 at a push."],
    ["capacity", "The most we can seat in the Saloon is 90."],
    ["capacity", "220 is the limit for the Grand Hall."],
    ["capacity", "The hall sits 200 comfortably."],
    ["capacity", "Capacity's 220 seated."],
    ["capacity", "There's space for a couple of hundred."],
    ["capacity", "Your 150 guests won't be a problem."],
    ["capacity", "Seating up to 220, the Grand Hall is our largest room."],
    ["capacity", "The Grand Hall se\u00adats 220."],
    ["capacity", "The hall seats \u0968\u0968\u0966."],
  ] as const)("finds a %s claim the red team wrote: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  // The new forms' near misses, and what HEAD took out wrongly ("a Grand Hall
  // wedding" was the price "a grand"), found on the repository's own prose.
  it.each([
    "We would love to host your wedding.",
    "Our team will confirm availability and pricing.",
    "Happy to talk through options on a call.",
    "Could you tell us your preferred date and numbers?",
    "That's fine, we can talk about it when you visit.",
    "It's fine to bring your own cake.",
    "It may be possible to arrange a visit next week.",
    "Let us know if the date works for you and the team will check it.",
    "A call on Thursday would work well.",
    "We have the 17th noted as your preferred date.",
    "We have hosted over a thousand weddings in our history.",
    "We'd love to host a Grand Hall wedding.",
    "Arrival is 1900 for 1930.",
    "The rate at which guests arrive will shape the drinks service.",
    "Our menus suit most dietary needs.",
    "This works for us: we will send the floor plans tomorrow.",
    "Built 17 October, the layout is ready for your visit.",
    "The timeline has a fine 14:10 marker.",
    "Lane 9's 0077 and the rota's 0078 each took a number.",
    "Viewings on Saturdays\nFree parking nearby",
    "Our wedding coordinator\nwill be in touch.",
    "Room hire\nand catering are quoted separately.",
  ])("leaves alone what only looks like a claim: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it("takes out a claim broken across lines from every line it touches, and leaves a list's items alone", () => {
    expect(withholdDraftCommitments("Dear Elaine,\n\nThe Grand Hall holds\nup to 220.\n\nThe Events Team"))
      .toEqual({ text: "Dear Elaine,\n\nThe Events Team", withheld: ["capacity"] });
    expect(withholdDraftCommitments("That date is\navailable. Do let us know.")).toEqual({ text: "Do let us know.", withheld: ["availability"] });
    const paragraphs = withholdDraftCommitments("The Grand Hall is\n\nfree on the 17th.\n\nWith best wishes,\nThe Events Team");
    expect(paragraphs.withheld).toEqual(["availability"]);
    expect(paragraphs.text).not.toMatch(/free|17th/u);
    const list = "Viewings on Saturdays\nFree parking nearby";
    expect(withholdDraftCommitments(list)).toEqual({ text: list, withheld: [] });
  });

  it("reads the characters as they show, and gives back that reading", () => {
    expect(canonicalDraftText("The 17th is av\u200bailable.")).toBe("The 17th is available.");
    expect(canonicalDraftText("Room hire is \uff14,\uff15\uff10\uff10 or \uffe14,500.")).toBe("Room hire is 4,500 or £4,500.");
    expect(canonicalDraftText("Seats \u0662\u0662\u0660, \u06f2\u06f2\u06f0 or \u0968\u0968\u0966.")).toBe("Seats 220, 220 or 220.");
    expect(canonicalDraftText("se\u00adats, \u0430v\u0430il\u0430ble, a\u0332v")).toBe("seats, available, av");
    // Another script, accents, line endings and tabs are kept, and reading again changes nothing.
    for (const text of ["\u0414\u043e\u0440\u043e\u0433\u0430\u044f \u0415\u043b\u0435\u043d\u0430", "Café cr\u00e8me", "Dear Elaine,\r\n\r\nThanks.\tTab."]) {
      expect(canonicalDraftText(text)).toBe(text);
    }
    for (const text of ["\u0430\ufe0fb \n\u0661\u0301b", "a\u0335\u0301 \u0430\u0345", "\u2028x\u0085y\u200d"]) {
      expect(canonicalDraftText(canonicalDraftText(text))).toBe(canonicalDraftText(text));
    }
    expect(withholdDraftCommitments("Thank you\u200b for your note.")).toEqual({ text: "Thank you for your note.", withheld: [] });
  });

  // Review: 200,000 newlines took 70 s, because every pattern ran on every
  // line. Each pattern now reads the text once, without ignoring case.
  it("reads 200,000 characters of adversarial runs in time that grows with them", () => {
    const fill = (unit: string): string => unit.repeat(Math.ceil(200_000 / unit.length)).slice(0, 200_000);
    const started = performance.now();
    // "\u0661 " reads as "1 1 1" held as two-byte text, which the patterns compiled
    // too large made slow (red team, 29 October 2026: 4 s alone).
    for (const unit of ["1,", "is ", "\n", "the\ndate\nis\n", "a\u200b", "the date, x, is ", "\uff11,", "\u0661 "]) {
      withholdDraftCommitments(fill(unit));
    }
    // A letter after a run of newlines: a pattern that took any whitespace
    // after a line's start read the rest of the run from every line (red team,
    // 29 October 2026: 20,000 characters took 1 s, so 200,000 would take 100 s).
    withholdDraftCommitments(`x${"\n".repeat(199_998)}x`);
    withholdDraftCommitments(`x${"\n\t".repeat(99_999)}x`);
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});

describe("red team 3 (29 October 2026): the forms the second fix did not know", () => {
  // Hundreds and thousands in words, per-head forms, figures as subjects and
  // labels, markdown, look-alike letters in any word, and claims written as
  // a note, a question or an answer.
  it.each([
    ["price", "Room hire is four thousand five hundred."],
    ["price", "Hire of the Grand Hall is forty-five hundred."],
    ["price", "Dinner is fifty five a head."],
    ["price", "Menus start at 65 pph."],
    ["price", "Our menus are 65 p.p."],
    ["price", "The wedding breakfast is 72/head."],
    ["price", "Canapes are 12 apiece."],
    ["price", "The drinks package works out at 30 a pop."],
    ["price", "Room hire is \u20a44,500."],
    ["price", "Room hire is £  4,500."],
    ["price", "Our Saturday rate is 4\u2009500."],
    ["price", "Our Saturday rate is 4,5OO."],
    ["price", "It's 4,500 to hire the hall."],
    ["price", "Expect to pay about 4,500."],
    ["price", "Budget around 4,500 for the room."],
    ["price", "Hire runs to 4,500 on a Saturday."],
    ["price", "We ask 4,500 for Saturdays."],
    ["price", "4,500 gets you the Grand Hall for the evening."],
    ["price", "The Grand Hall goes for 4,500 on Saturdays."],
    ["price", "The hire is somewhere between four and five thousand."],
    ["price", "Room hire 4,500, deposit 1,000."],
    ["price", "| Room hire | 4,500 |"],
    ["price", "- **Room hire:** 4,500"],
    ["price", "A Saturday in the Grand Hall is 4,500 sterling."],
    ["price", "The Saloon is a shade under 1,000 for the afternoon."],
    ["price", "We'd need 500 down to secure it."],
    ["price", "The Grand Hall is 4,500 to 5,000 depending on the date."],
    ["price", "Prices begin at 3,950."],
    ["price", "Weekday hire comes in under 3,000."],
    ["price", "Room hire is four point five thousand."],
    ["availability", "Our diary is empty on the 17th."],
    ["availability", "The 17th looks good."],
    ["availability", "The hall is vacant on the 17th."],
    ["availability", "We've got space on the 17th."],
    ["availability", "There's space in the Grand Hall on the 17th."],
    ["availability", "Happy to say the 17th is a go."],
    ["availability", "Saturday 17 June - no bookings yet."],
    ["availability", "Nobody's booked the 17th."],
    ["availability", "We're not booked on the 17th."],
    ["availability", "The Grand Hall is not in use that evening."],
    ["availability", "There are no events in the Grand Hall on the 17th."],
    ["availability", "We could definitely make the 17th work."],
    ["availability", "The 17th? Free as a bird."],
    ["availability", "You asked about the 17th. Good news: we can do it."],
    ["availability", "About the 17th \u2014 yes, it's yours."],
    ["availability", "- **Saturday 17 June:** available"],
    ["availability", "| 17 June | Available |"],
    ["availability", "17/06 - available"],
    ["availability", "Saturday 17 June \u2705"],
    ["availability", "The 17th is \u041e\u041a."],
    ["availability", "The 17th is availa\u042cle."],
    ["availability", "The 17th is \u043e\u0440\u0435\u0578."],
    ["availability", "The 17th is ava\u0131lable."],
    ["availability", "THE 17TH IS AVA\u0130LABLE."],
    ["availability", "The 17th is \u1d00\u1d20\u1d00\u026a\u029f\u1d00\u0299\u029f\u1d07."],
    ["availability", "The 17th is avail-\nable."],
    ["availability", "The 17th is\nAvailable."],
    ["availability", "The 17th is \u201cavailable\u201d."],
    ["availability", "The 17th remains open to you."],
    ["availability", "Your date is still on the table."],
    ["availability", "Saturday is a yes from us."],
    ["availability", "Count on the 17th."],
    ["availability", "Nothing clashes with the 17th."],
    ["availability", "There's no one in the Grand Hall on the 17th."],
    ["availability", "We can fit you in that Saturday."],
    ["capacity", "Thank you for asking.\nSeats 220 for dinner."],
    ["capacity", "The Grand Hall seats\nTwo hundred and twenty."],
    ["capacity", "The Grand Hall takes two-twenty."],
    ["capacity", "The Grand Hall has 220 seats."],
    ["capacity", "There are 220 seats in the Grand Hall."],
    ["capacity", "Grand Hall: 220 seated"],
    ["capacity", "In the Grand Hall you can have 220 guests."],
    ["capacity", "The Grand Hall comfortably welcomes 220."],
    ["capacity", "220 guests is no trouble at all."],
    ["capacity", "We can squeeze in 230 at a push."],
    ["capacity", "Capacity is c. 220."],
    ["capacity", "The Grand Hall seats ~220."],
    ["capacity", "The hall copes with 220 easily."],
    ["capacity", "Up to two hundred and twenty can dine in the Grand Hall."],
    ["capacity", "The Grand Hall allows 220 for dinner."],
    ["capacity", "The Grand Hall can cater 220."],
    ["capacity", "The Grand Hall is licensed to 250."],
    ["capacity", "220 dinner guests fit in the Grand Hall."],
    ["capacity", "The Grand Hall can have 220 at dinner."],
    ["capacity", "The Grand Hall will take your whole party."],
  ] as const)("finds a %s claim: %s", (kind, sentence) => {
    expect(findDraftCommitments(sentence).map((claim) => claim.kind)).toContain(kind);
  });

  // The red team's clean sentences that the second fix took out, and the
  // near misses of this fix's forms.
  it.each([
    "The Grand Hall holds 14 stained-glass windows.",
    "It holds 3 portraits of former Deacons.",
    "The venue hosts 150 events a year.",
    "The hall takes 2 florists a full morning to dress.",
    "It seats 10 at each round table.",
    "Our Grand Hall is perfect for 1920s-themed parties.",
    "The hall is ideal for 50th birthdays.",
    "The Saloon is great for 18th birthday parties.",
    "The Grand Hall is good for 40th anniversaries.",
    "Rooms are booked through our events team.",
    "The Saloon is reserved for the drinks reception in our standard plan.",
    "Your date is clear in our minds.",
    "We can do 6.30pm for the drinks reception.",
    "We hold 3 tastings a year.",
    "We can fit 2 viewings in on Saturday.",
    "The Grand Hall welcomes 10,000 visitors a year.",
    "Up to two cars can park in the courtyard.",
    "Grand Hall: drinks at 6pm",
    "Our phone number is 0141 552 2911.",
    "Room hire 10am to midnight.",
    "The organ has 2,500 pipes.",
    "Over 1,000 couples have married in the Grand Hall.",
    "You can pay the balance by bank transfer.",
    "We ask that all guests leave by midnight.",
    "Saturday is a go-to day for weddings in Glasgow.",
    "The 17th is a yes from the photographer, you said.",
    "The 17th looks good for photos in the garden.",
    "Good news: we can do it vegetarian.",
    "Nothing clashes with the colour scheme you chose.",
    "There's space in the cloakroom for coats.",
    "The room is empty on arrival so the florist can start.",
    "The Grand Hall is still in use by the Incorporated Trades.",
    "We are available on the phone most weekdays.",
    "We're busy on Monday, so the proposal will follow on Tuesday.",
    "It's yours to keep.",
    "Count on us to look after every detail.",
  ])("leaves alone: %s", (sentence) => {
    expect(findDraftCommitments(sentence)).toEqual([]);
  });

  it("reads look-alike letters, markdown and a table for the patterns only, and gives back the draft's own characters", () => {
    const russian = "\u0414\u043e\u0440\u043e\u0433\u0430\u044f \u0415\u043b\u0435\u043d\u0430, **thank you** | \u201cwe look forward\u201d to it.";
    expect(withholdDraftCommitments(russian)).toEqual({ text: russian, withheld: [] });
    expect(findDraftCommitments("The 17th is \u041e\u041a.")).toEqual([{ kind: "availability", phrase: "The 17th is \u041e\u041a" }]);
    expect(findDraftCommitments("The 17th is avail-\nable.")).toEqual([{ kind: "availability", phrase: "The 17th is avail-\nable" }]);
    expect(withholdDraftCommitments("Dear Elaine,\n\n| Room hire | 4,500 |\n| Guests | 150 |\n\nThe Events Team"))
      .toEqual({ text: "Dear Elaine,\n\n| Guests | 150 |\n\nThe Events Team", withheld: ["price"] });
  });

  // A claim found from the stop before it took the sentence before it out too.
  it("takes out a claim that starts a sentence or a line, and not the sentence before it", () => {
    expect(withholdDraftCommitments("Thank you for your note. Complimentary parking is yours on the day."))
      .toEqual({ text: "Thank you for your note.", withheld: ["price"] });
    expect(withholdDraftCommitments("Thank you for asking.\nSeats 220 for dinner."))
      .toEqual({ text: "Thank you for asking.", withheld: ["capacity"] });
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
