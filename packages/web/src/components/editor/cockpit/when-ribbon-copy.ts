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
    `Lands under "${title}" — a pencil here cannot convert while that ink stands.`,

  inkConfirm: (range: string): string => `Move the ink to ${range}?`,
  inkConfirmYes: "Move the ink",
  inkConfirmNo: "Leave it",

  moved: (range: string): string => `Moved to ${range}.`,
  undo: "Undo",
  slotTaken: "That slot was just inked by someone else — the ribbon has been refreshed.",
  moveFailed: "The Diary could not record that change. The booking keeps its previous time.",

  dragHint: "Drag to move · pull an end to resize · Shift for minute steps",
  keyboardHint:
    "Arrow keys move by 15 minutes, Shift+arrows by one; Alt+arrows adjust the end; Enter commits; Escape cancels.",

  announceMove: (range: string): string => `Proposed ${range}. Enter commits, Escape cancels.`,
  announceBlocked: (title: string): string =>
    `Stopped at "${title}" — two inked bookings cannot share a room.`,
} as const;
