// ---------------------------------------------------------------------------
// The Board — copy as data (T-493; Canon §18 copy locks, claim-safety
// doctrine). Every user-facing string lives here so the claim guard can
// sweep it: planning-support language only, no compliance vocabulary,
// INKED — never "strong enquiry".
// ---------------------------------------------------------------------------

export const BOARD_COPY = {
  title: "The Diary",
  subtitle: "Pencil it in. Ink it. Nothing goes stale.",
  disclosure:
    "Planning support only — conflicts and turnaround gaps are guidance for the team's own judgement, never a ruling.",

  loading: "Opening the diary…",
  errorTitle: "The diary could not load.",
  retry: "Try again",
  refresh: "Refresh",
  noVenue: "Your account has no venue assigned — ask an administrator to link one.",
  readOnly: "Read-only view — bookings are moved by the sales team.",
  emptyRange: "Nothing in the diary for this range yet.",
  showExited: "Show released & cancelled",

  views: { day: "Day", week: "Week", month: "Month" } as const,
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
      `Turning ${name}'s enquiry into a pencil — the enquiry itself stays where it is in review.`,
    hygieneLegend: "Pencil hygiene",
    ownerNote: "You become the owner of this pencil — it carries your name and its next action.",
    saveFailed: "That change could not be saved — nothing was altered.",
    created: (title: string): string => `Added ${title} to the diary.`,
    saved: (title: string): string => `Saved ${title}.`,
    converted: (title: string): string => `Pencilled in ${title}.`,
    transitioned: (title: string, action: string): string => `${action}: ${title}.`,
    transitionsTitle: "Lifecycle",
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
    title: "Open enquiries",
    empty: "No open enquiries right now.",
    convert: "Pencil in…",
    detail: (eventType: string | null, guests: number | null): string => {
      const parts = [eventType ?? "event", guests === null ? null : `${String(guests)} guests`];
      return parts.filter((part): part is string => part !== null).join(" · ");
    },
  },

  confirmInk: {
    title: "Move this inked booking?",
    body: "Ink is a confirmed commitment — moving it changes what the client has been promised.",
    confirm: "Move the ink",
    cancel: "Keep it where it is",
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
    empty: "Every pencil has a fresh next action. Nothing is going stale.",
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
