// ---------------------------------------------------------------------------
// The one sample event the /platform captures follow: the Crawford wedding,
// 160 guests in the Grand Hall on Saturday 5 June 2027, as the proposals desk
// emulator holds it. The message is the draft Claude wrote for exactly these
// facts through the Anthropic adapter (claude-opus-5-5, 8 October 2026, 4.4 s),
// kept verbatim so the captures show Claude's own words, not a stand-in.
// ---------------------------------------------------------------------------

export const CRAWFORD_FACTS = {
  eventDate: "2027-06-05",
  guestCount: 160,
  occasion: "wedding",
  roomName: "Grand Hall",
  roomSlug: "grand-hall",
} as const;

export const CLAUDE_CRAWFORD_DRAFT = [
  "Dear Elaine,",
  "",
  "Thank you for thinking of us for your wedding. We're delighted to share our proposal for your celebration on 5 June 2027.",
  "",
  "We've planned around the Grand Hall for 160 guests. It's a lovely space for a wedding, and we'd be glad to talk through how you'd like the day to flow, from the welcome through to the evening.",
  "",
  "Please have a look through the proposal and let us know your thoughts. If there's anything you'd like to change, or any questions at all, just reply to this message and we'll be happy to help.",
  "",
  "We look forward to hearing from you.",
  "",
  "Warm wishes,",
  "The Events Team",
].join("\n");
