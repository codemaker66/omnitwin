// ---------------------------------------------------------------------------
// The Board — copy as data (T-493; Canon §18 copy locks, claim-safety
// doctrine). Every user-facing string lives here so the claim guard can
// sweep it: planning-support language only, no compliance vocabulary,
// INKED — never "strong enquiry".
//
// Strings added from T-619 on use Blake's hold words (26 September 2026):
// "Provisional", "1st option", "2nd option", "Joint 1st", "Confirmed". The
// rest of this file still carries the older Canon vocabulary; the Diary
// rebuild replaces it in one pass.
// ---------------------------------------------------------------------------

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${String(rank)}th`;
  const suffix = rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th";
  return `${String(rank)}${suffix}`;
}

export const BOARD_COPY = {
  title: "The Diary",
 disclosure:
    "Planning support only. Venue staff review conflicts and turnaround gaps.",

  loading: "Opening the diary…",
  errorTitle: "The diary could not load.",
  retry: "Try again",
  refresh: "Refresh",
  noVenue: "Your account has no venue assigned — ask an administrator to link one.",
  readOnly: "Read-only · Sales team edits bookings.",
  emptyRange: "No bookings in this range.",
  showExited: "Show released & cancelled",

  // Three zooms, and only three (T-619). The month board was retired; an old
  // `?view=month` link lands on the week its date falls in.
  views: { day: "Day", week: "Week", "2w": "2W" } as const,

  /** The Command Centre card face (C1). Doors language, never compliance;
   *  the countdown is minute-granular on the shared board clock. */
  card: {
    doorsIn: (label: string): string => `Doors in ${label}`,
    guests: (count: number): string => `${String(count)} guests`,
    segments: { setup: "Setup", live: "Live", teardown: "Teardown" } as const,
    tightGap: (guidelineMinutes: number): string =>
      `under the ${String(guidelineMinutes)}m guideline`,
  },

  /** Ctrl/Cmd-K finding palette (C1). */
  palette: {
    title: "Find on the board",
    placeholder: "Rooms, events, clients…",
    empty:
      "No matches in this range or open enquiries.",
    kinds: { room: "Room", booking: "Booking", enquiry: "Enquiry" } as const,
    roomDetail: "Jump to lane",
    enquiryDetail: "Open the pencil-in form",
  },

  /** Lane rail extras (C1). */
  rail: {
    utilisationNote:
      "Booked share of this range.",
  },

  /** Create-in-context (T-619): the controls that open the drawer at the
   *  room and time the coordinator pointed at. */
  create: {
    cellLabel: (room: string, day: string): string => `New booking — ${room}, ${day}`,
    cellHint: "New",
    // A pointer picks a TIME on the lane; the keyboard, which has no
    // position to offer, picks the DAY the board is showing. The name says
    // the day, because the keyboard is who hears it.
    laneLabel: (room: string, day: string): string =>
      `New booking — ${room}, ${day}. Click the lane for a particular time.`,
  },

  /** The venue-wide list the Diary opens with (T-619, Blake's decision of
   *  26 September 2026): provisional holds whose decision date has passed or
   *  falls within the next seven days, whatever the booking's own date. */
  decisions: {
    title: "Decisions due",
    overdue: "Overdue",
    soon: "Next 7 days",
    empty: "No decision dates in the next 7 days.",
    option: (rank: number | null, jointFlag: boolean): string => {
      if (rank === null) return "Provisional";
      if (rank === 1 && jointFlag) return "Joint 1st";
      return `${ordinal(rank)} option`;
    },
    decideBy: (day: string): string => `Decide by ${day}`,
    wasDue: (day: string): string => `Decision was due ${day}`,
    noOwner: "No owner",
    roomUnknown: "Room not listed",
    more: (shown: number, total: number): string =>
      `Showing the ${String(shown)} most urgent of ${String(total)}.`,
  },
  today: "Today",
  previous: "Earlier",
  next: "Later",

  legend: {
    ink: "Inked — confirmed",
    hold: "Pencil — ranked option",
    prospect: "Prospect — never blocks",
    internal_block: "House block",
    phase: "Occupancy footprint",
  } as const,

  lane: {
    inkCount: (count: number): string => `${String(count)} inked`,
    holdCount: (count: number): string => `${String(count)} pencilled`,
  },

  block: {
    jointFirst: "joint 1st option",
    rank: (ordinal: string): string => `${ordinal} option`,
    unranked: "unranked pencil",
  },

  drag: {
    grabHint: "Space lifts the block for arrow-key moves; Enter opens it.",
    blockedDrop: "That placement is blocked — the block returned to its slot.",
  },

  drawer: {
    createTitle: "New booking",
    editTitle: "Booking details",
    convertTitle: "Pencil in this enquiry",
    close: "Close",
    cancel: "Discard",
    submit: {
      create: "Add to the diary",
      edit: "Save changes",
      convert: "Pencil it in",
    } as const,
    convertNote: (name: string): string =>
      `Pencil in ${name}. The enquiry stays in review.`,
    hygieneLegend: "Pencil hygiene",
    ownerNote: "You will own this pencil.",
    // The edit drawer's facts (T-619). Each absence is stated as an answer
    // rather than left as a blank line to interpret.
    summaryLabel: "Booking summary",
    ownerLabel: "Owner",
    ownerUnassigned: "Nobody yet",
    clientLabel: "Client",
    clientNone: "No client linked",
    eventLabel: "Event",
    guestsLabel: "Guests",
    saveFailed: "That change could not be saved — nothing was altered.",
    created: (title: string): string => `Added ${title} to the diary.`,
    saved: (title: string): string => `Saved ${title}.`,
    converted: (title: string): string => `Pencilled in ${title}.`,
    transitioned: (title: string, action: string): string => `${action}: ${title}.`,
    transitionsTitle: "Lifecycle",
    planTitle: "Floor plan",
    planNone: "No floor plan. Start one with this booking's name and times.",
    planAttached: "Floor plan attached.",
    planStart: "Start a floor plan",
    planOpen: "Open the plan",
    planDetach: "Detach",
    planStarted: (title: string): string => `Started a floor plan for ${title}.`,
    planDetached: (title: string): string => `Detached the floor plan from ${title}.`,
    planFailed: "The floor plan could not be started — the booking is unchanged.",
    // The second leg failed: the plan EXISTS but is not attached yet. Saying
    // "the booking is unchanged" here would be true and useless; saying
    // nothing about the created plan would be dishonest. Retrying re-uses
    // the plan that was already made rather than creating a second one.
    planLinkFailed: "Plan created but not attached. Try again to attach it.",
    fields: {
      kind: "Commitment",
      room: "Room",
      title: "Title",
      eventType: "Event type",
      startsAt: "Starts",
      endsAt: "Ends",
      rank: "Ladder position",
      jointFlag: "Joint first option",
      decisionAt: "Decision date",
      nextAction: "Next action",
      nextActionDueAt: "Next action due",
      notes: "Notes",
    } as const,
  },

  transitions: {
    prospect: "Make it a prospect",
    hold: "Make it a pencil",
    ink: "Ink it",
    internal_block: "Make it a house block",
    released: "Release",
    expired: "Mark expired",
    cancelled: "Cancel the ink",
    lost: "Mark lost",
  } as const,

  presence: {
    live: "Live",
    offline: "Reconnecting…",
    here: (names: readonly string[]): string =>
      names.length === 0 ? "Only you are here." : `Also here: ${names.join(", ")}.`,
  },

  trayEnquiries: {
    dragHint: "Drag a slip onto a room lane to pencil it in.",
    dropAt: (time: string): string => `Pencil at ${time}`,
    dropSeeking: "Drop on a room lane",
    title: "Open enquiries",
    empty: "No open enquiries right now.",
    more: (shown: number): string =>
      `Showing the ${String(shown)} newest open enquiries. Older ones are not listed here.`,
    convert: "Pencil in…",
    detail: (eventType: string | null, guests: number | null): string => {
      const parts = [eventType ?? "event", guests === null ? null : `${String(guests)} guests`];
      return parts.filter((part): part is string => part !== null).join(" · ");
    },
  },

  confirmInk: {
    title: "Move this inked booking?",
    body: "This changes the client's confirmed time or room.",
    confirm: "Move the ink",
    cancel: "Keep it where it is",
  },

  welcome: {
    title: "Using the Diary",
    intro:
      "Bookings use four commitment types.",
    entries: [
      {
        term: "Pencil",
        detail:
          "A ranked option with an owner, decision date and next action. Pencils may overlap.",
      },
      {
        term: "Ink",
        detail:
          "Confirmed. Two inked bookings cannot overlap in one room.",
      },
      {
        term: "House block & prospect",
        detail:
          "House blocks reserve venue time. Prospects never block it.",
      },
      {
        term: "The tray",
        detail:
          "Open enquiries and overdue next actions.",
      },
      {
        term: "Keyboard",
        detail: "Space lifts a block for arrow-key moves. Enter opens it.",
      },
      {
        term: "Live",
        detail:
          "Colleagues' changes appear automatically.",
      },
    ],
    dismiss: "Open Diary",
    reopen: "How the Diary works",
  },

  undo: {
    moved: (title: string): string => `Moved ${title}.`,
    action: "Undo",
    undone: "Move undone.",
    failed: "That move could not be saved — the board has been restored.",
    slotTaken: "That slot was just inked by someone else — the board has been refreshed.",
  },

  tray: {
    title: "Needs attention",
    empty: "No overdue next actions.",
    open: (count: number): string => `${String(count)} pencil${count === 1 ? "" : "s"} need attention`,
  },

  conflicts: {
    title: "Conflicts",
    none: "No conflicts detected in this range.",
    checksTitle: "What was checked",
    severity: {
      blocking: "Blocking",
      warning: "Warning",
      info: "Ladder",
    } as const,
    turnaround: {
      checked: "Turnaround gaps: checked",
      partial: "Turnaround gaps: partly checked",
      not_checked: "Turnaround gaps: not checked",
    } as const,
  },

  nowLabel: "Now",
} as const;
