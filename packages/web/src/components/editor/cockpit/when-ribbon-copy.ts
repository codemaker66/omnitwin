// ---------------------------------------------------------------------------
// When ribbon copy — every user-facing string on the ribbon, as data
// (Day Board S2; docs/plan/hallkeeper-day-board-plan.md §2).
//
// Same doctrine as the Diary's board-copy.ts: planning-support language only.
// Turnaround is a GUIDELINE the team judges, never a requirement the tool
// enforces; the only hard wall the ribbon claims is the database's own
// ink-vs-ink exclusion. The claim-guard test pins the vocabulary.
// ---------------------------------------------------------------------------

export const RIBBON_COPY = {
  /** Rail heading over the strip. */
  heading: "When",
  disclosure:
    "Planning support only — turnaround gaps are guidance for the team's own judgement, never a ruling.",

  notInDiary: "This plan isn't in the Diary yet — times live in the Diary.",
  openDiary: "Open the Diary",
  readOnly: "Read-only — booking times are changed by the house team.",
  loadFailed: "The Diary could not be reached, so the ribbon is resting.",
  tryAgain: "Try again",

  bufferWarning: (minutes: number, ruleName: string): string =>
    `Inside the ${ruleName} turnaround guideline (${String(minutes)} minutes). Planning support only — the team judges what is workable.`,
  pencilUnderInk: (title: string): string =>
    `Lands under "${title}" — a provisional hold here cannot be confirmed while that booking stands.`,

  inkConfirm: (range: string): string => `Move the confirmed booking to ${range}?`,
  inkConfirmYes: "Move it",
  inkConfirmNo: "Leave it",

  moved: (range: string): string => `Moved to ${range}.`,
  undo: "Undo",
  slotTaken: "That slot was just confirmed by someone else — the ribbon has been refreshed.",
  moveFailed: "The Diary could not record that change. The booking keeps its previous time.",

  dragHint: "Drag to move · pull an end to resize · Shift for minute steps",
  keyboardHint:
    "Arrow keys move by 15 minutes, Shift+arrows by one; Alt+arrows adjust the end; Enter commits; Escape cancels.",

  announceMove: (range: string): string => `Proposed ${range}. Enter commits, Escape cancels.`,
  announceBlocked: (title: string): string =>
    `Stopped at "${title}" — two confirmed bookings cannot share a room.`,

  // --- goal 19 S6: typed entry, the client's proposal, the office's confirm,
  //     phase handles, the price line and the opt-in tick -------------------
  typedLabel: "Type a time",
  typedPlaceholder: "Type a time, like 12-4pm or 7 for 7:30",
  typedSet: "Set",
  typedBlocked: "That time is already booked in this room. Try another.",
  /** What the client's side sees of everyone else's bookings in the room. */
  busySpan: "Booked",
  heldSpan: "Held",
  venueRuleName: "venue's",
  clientHint: "Drag to move · pull an end to resize · or type a time, then propose it",
  clientDraftNote: "Nothing is booked yet. Place the bar where you would like your event, then propose that time to the office.",
  clientWaitingNote: "Proposed · waiting for the office to confirm.",
  clientConfirmedNote: "Confirmed by the office. Ask the office if it needs to change.",
  roomDayLoading: "Loading the room's day…",
  roomDayFailed: "The room's day could not be reached, so the ribbon is resting.",
  proposeConfirm: (range: string): string => `Propose ${range} to the office?`,
  proposeYes: "Propose this time",
  proposeNo: "Leave it",
  proposed: (range: string): string => `Proposed ${range} · waiting for the office.`,
  proposeFailed: "The office could not record that proposal. Your time keeps its previous place.",
  proposeDecided: "The office has confirmed your time, so only they can change it now. The ribbon has been refreshed.",
  confirmTime: "Confirm this time",
  confirmQuestion: (range: string, title: string): string =>
    `Confirm ${range} for ${title}? The Diary will show it as confirmed, and so will the client.`,
  confirmYes: "Confirm it",
  confirmNo: "Not yet",
  confirmed: (range: string): string => `Confirmed ${range}.`,
  confirmFailed: "The Diary could not confirm that. The time stays provisional.",
  handleHint: "Drag a marker to set setup, doors, live and clear-down. The bar's edges stay the booking.",
  handleSetup: "Setup",
  handleDoors: "Doors",
  handleLive: "Live",
  handleClearDown: "Clear-down",
  handleEnd: "Ends",
  handleSaved: "Phases saved.",
  handleFailed: "The phases could not be saved. The markers show the saved times.",
  priceLine: (amount: string): string => `${amount} · the venue's current rate for this window`,
  priceNoSlot: "The venue's price sheet has no slot for this window. Ask the office for a price.",
  priceSameDayOnly: "A price is shown for same-day windows only.",
  tickOn: "Tick on snap: on",
  tickOff: "Tick on snap: off",
  tickHint: "A soft tick each time the bar snaps. Your choice, kept on this device only.",
} as const;
