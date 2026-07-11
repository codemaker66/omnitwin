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
    grabHint: "Press Enter or Space to lift, then arrow keys to move.",
    blockedDrop: "That placement is blocked — the block returned to its slot.",
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
