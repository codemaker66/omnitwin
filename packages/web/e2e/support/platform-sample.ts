// ---------------------------------------------------------------------------
// The one sample event the /platform captures follow: the Crawford wedding,
// 160 guests in the Grand Hall on Saturday 5 June 2027. Her enquiry arrives
// on Monday 21 September 2026; the date is held for her as first option on
// the 24th, until Thursday 22 October; version 1 of the proposal goes on the
// 29th; on 5 October she asks for the dinner to cost a little less per head.
//
// CLAUDE_CRAWFORD_DRAFT is the first draft Claude wrote for version 2,
// through the product's own path (claude-opus-5-5, 9 October 2026, 8.5 s):
// the proposal seeded in a throwaway database, messageDraftContext() building
// what the AI is told exactly as the route does (the event, the composer's
// quote with the dinner at £82.50, the quote she was last sent, the diary's
// hold, her enquiry and her request), and generateAIDraft() calling Claude
// through the Anthropic adapter. It is kept verbatim, so the captures show
// Claude's own words, not a stand-in; every figure in it is in what it was
// given (CLAUDE_CRAWFORD_FIGURES, the route's own check, is empty). The full
// request and answer are published as evaluation/data/crawford-draft.json.
// CRAWFORD_SENT_MESSAGE is that draft as the coordinator might edit it before
// sending: our sample edit, shown as one, never as Claude's.
// ---------------------------------------------------------------------------

export const CRAWFORD_FACTS = {
  eventDate: "2027-06-05",
  guestCount: 160,
  occasion: "wedding",
  roomName: "Grand Hall",
  roomSlug: "grand-hall",
} as const;

export const CRAWFORD_ENQUIRY_MESSAGE =
  "We'd love our wedding breakfast and the evening in the Grand Hall, for about 160. Two guests use wheelchairs and two are coeliac. Is Saturday 5 June 2027 free?";

export const CRAWFORD_CHANGE_REQUEST = "Could the dinner be a little less per head?";

export const CLAUDE_CRAWFORD_DRAFT = [
  "Dear Elaine,",
  "",
  "Thank you for your message. We've looked again at the dinner and brought it down from £87.50 to £82.50 per head. For 160 guests the dinner now comes to £13,200.00, rather than £14,000.00.",
  "",
  "Your updated proposal:",
  "",
  "Grand Hall hire: £4,400.00",
  "Dinner, 160 guests at £82.50: £13,200.00",
  "Total: £17,600.00 (previously £18,400.00)",
  "",
  "The Grand Hall is provisionally held for you as first option for 5 June 2027 until 22 October 2026.",
  "",
  "We've noted that two of your guests use wheelchairs and two are coeliac. We'd like to talk through their needs with you so we can plan for them properly.",
  "",
  "This proposal covers the hall hire and dinner. If you'd like us to include anything for the evening, just let us know.",
  "",
  "Warm regards,",
  "The Events Team",
].join("\n");

/** The figures in Claude's draft that appear nowhere in what it was given. */
export const CLAUDE_CRAWFORD_FIGURES: readonly string[] = [];

export const CRAWFORD_SENT_MESSAGE = [
  "Dear Elaine,",
  "",
  "Thank you for your message. We've looked again at the dinner and brought it down from £87.50 to £82.50 per head. For 160 guests the dinner now comes to £13,200, rather than £14,000.",
  "",
  "Your updated proposal:",
  "",
  "Grand Hall hire: £4,400",
  "Dinner, 160 guests at £82.50: £13,200",
  "Total: £17,600 (previously £18,400)",
  "",
  "The Grand Hall is provisionally held for you as first option for Saturday 5 June 2027, until Thursday 22 October.",
  "",
  "We've noted that two of your guests use wheelchairs and two are coeliac. I'll ring you next week to talk through what they need, so we can plan for them properly.",
  "",
  "This proposal covers the hall hire and dinner. If you'd like us to include anything for the evening, just let me know.",
  "",
  "Warm regards,",
  "Catherine Tait",
  "Events Team",
].join("\n");
