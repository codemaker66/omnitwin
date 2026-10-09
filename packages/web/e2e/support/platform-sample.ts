// ---------------------------------------------------------------------------
// The one sample event the /platform captures follow: the Crawford wedding,
// 160 guests in the Grand Hall on Saturday 5 June 2027. Her enquiry arrives
// on Monday 21 September 2026; version 1 of the proposal goes on the 29th;
// on 5 October she asks for the dinner to cost a little less per head.
//
// CLAUDE_CRAWFORD_DRAFT is the first draft Claude wrote for version 2,
// through the product's own path (generateAIDraft and the Anthropic adapter,
// claude-opus-5-5, 9 October 2026, 6.5 s) from exactly the context the
// proposals route builds: the event, her enquiry and her request. It is kept
// verbatim, so the captures show Claude's own words, not a stand-in. Claude
// is never sent a price, so it asks what figure she has in mind;
// CRAWFORD_SENT_MESSAGE is that draft as Catherine edited it before sending,
// with version 2's price and the hold she knows of.
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
  "Thank you for your message, and for thinking of us for your wedding on 5 June 2027.",
  "",
  "We'd be glad to look at ways of bringing the dinner cost per head down. Before we suggest options, it would help to know roughly what figure you have in mind, and whether there are courses or extras you'd be happy to change or simplify. We can then come back to you with some alternatives for the wedding breakfast in the Grand Hall for around 160 guests.",
  "",
  "We've also noted the other points from your enquiry. We haven't yet confirmed that 5 June 2027 is available, and we'll come back to you on that. Two of your guests are coeliac, and we'll make sure their needs are part of any menu we suggest. Two guests use wheelchairs, and we'd like to talk through their access arrangements with you in detail so we can plan properly for them.",
  "",
  "Do let us know your thoughts on budget, and we'll take it from there.",
  "",
  "Warm wishes,",
  "",
  "The Events Team",
].join("\n");

export const CRAWFORD_SENT_MESSAGE = [
  "Dear Elaine,",
  "",
  "Thank you for your message, and for thinking of us for your wedding on 5 June 2027.",
  "",
  "We've brought the dinner down to £82.50 a head, which takes version 2 of the proposal to £17,600. If there are courses or extras you'd be happy to change or simplify, we can look at those too.",
  "",
  "Your date is held for you as our first option until Thursday 22 October. Two of your guests are coeliac, and their needs are part of the menu. Two guests use wheelchairs, and we'd like to talk through their access arrangements with you in detail so we can plan properly for them.",
  "",
  "Warm wishes,",
  "",
  "Catherine Tait, Events Team",
].join("\n");
