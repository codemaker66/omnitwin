// ---------------------------------------------------------------------------
// The Board — copy as data (T-493; Canon §18 copy locks, claim-safety
// doctrine). Every user-facing string lives here so the claim guard can
// sweep it: planning-support language only, no compliance vocabulary, and a
// confirmed booking is never a "strong enquiry".
//
// Every string uses Blake's hold words (26 September 2026): "Provisional",
// "1st option", "2nd option", "Joint 1st", "Confirmed". The internal words
// (pencil, ink, prospect, ladder position) never reach the screen: a hold is
// provisional, an ink is confirmed, and a prospect is "Interest only".
// ---------------------------------------------------------------------------

/** "Week of Mon, 21 Sept 2026" → "the week of Mon, 21 Sept 2026", so a
 *  range title reads inside a sentence; a day's title stands as it is. */
function rangePhrase(title: string): string {
  return /^(Week|Fortnight) of /u.test(title) ? `the ${title.charAt(0).toLowerCase()}${title.slice(1)}` : title;
}

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/** Indexed as Date's getUTCDay: 0 is Sunday. */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** 1 → "1st", 2 → "2nd", 11 → "11th": the option numbers in Blake's words. */
export function ordinal(rank: number): string {
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
  /** A range on its way while the rooms stay on screen (roadmap N3). */
  opening: (rangeTitle: string): string => `Opening ${rangePhrase(rangeTitle)}…`,
  refreshing: "Refreshing the Diary…",
  /** A refresh that did not land: the board keeps what it last read, and
   *  says from when once that is a different minute. */
  refreshFailed: (at: string, readAt: string | null): string =>
    readAt === null || readAt === at ? `Couldn't refresh at ${at}.` : `Couldn't refresh at ${at}. Showing the Diary as it was at ${readAt}.`,
  rangeError: (rangeTitle: string): string => {
    const phrase = rangePhrase(rangeTitle);
    return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} could not be read.`;
  },
  retry: "Try again",
  refresh: "Refresh",
  noVenue: "Your account has no venue assigned — ask an administrator to link one.",
  readOnly: "Read-only · Sales team edits bookings.",
  emptyRange: "No bookings in this range.",
  showExited: "Show released & cancelled",
  /** The reduced toolbar (roadmap N3): what changes how the board is read,
   *  rather than where it looks, sits one step away. */
  viewMenu: { open: "View" } as const,
  /** A key printed beside its control's name, as its tooltip. */
  withKey: (name: string, key: string): string => `${name} (${key})`,

  // Three zooms, and only three (T-619). The month board was retired; an old
  // `?view=month` link lands on the week its date falls in.
  views: { day: "Day", week: "Week", "2w": "2W" } as const,

  /** The Command Centre card face (C1). Doors language, never compliance;
   *  the countdown is minute-granular on the shared board clock. */
  card: {
    doorsIn: (label: string): string => `Doors in ${label}`,
    guests: (count: number): string => `${String(count)} guests`,
    segments: { setup: "Setup", live: "Live", teardown: "Teardown" } as const,
    /** Beside a gap shorter than its room's changeover time (T-637). */
    tightGap: (needed: string): string => `needs ${needed}`,
  },

  /** The changeover sheet (T-637): a gap between two functions, the time the
   *  room needs, who set it, and, for the venue's administrators, the change.
   *  Durations arrive formatted as Venue settings shows them ("1 h 30"). */
  changeover: {
    title: "Changeover",
    close: "Close",
    gapLabel: (room: string, gap: string, before: string, after: string): string =>
      `Changeover in ${room}: ${gap} between ${before} and ${after}`,
    between: (before: string, endsAt: string, after: string, startsAt: string): string =>
      `${before} ends at ${endsAt}. ${after} starts at ${startsAt}.`,
    loading: "Reading the changeover times…",
    loadFailed: "The changeover times could not be read.",
    retry: "Try again",
    ruleHeading: "The time this room needs",
    noRule: (room: string): string =>
      `${room} has no changeover time yet, so the Diary does not check this gap.`,
    everyRoom: "This time is for every room without its own.",
    enough: "Enough time",
    short: (by: string): string => `${by} short`,
    unchecked: "Checked once both functions are confirmed",
    keep: (duration: string): string => `Keep ${duration}`,
    change: "Change",
    changeLabel: (scope: string): string => `Change the time for ${scope}`,
    setForRoom: (room: string): string => `Set a time for ${room}`,
    minutes: "Minutes",
    minutesFor: (scope: string): string => `Minutes for ${scope}`,
    minutesHint: "Enter 0 to 1,440 minutes",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    saved: (scope: string, duration: string): string => `${scope} now needs ${duration}.`,
    stale: (duration: string): string => `Someone changed this a moment ago. It now says ${duration}.`,
    exists: (duration: string): string => `This room already has its own time: ${duration}. It is shown above.`,
    saveFailed: "The time could not be saved. Try again.",
    allTimes: "All changeover times",
    readOnly: "The venue's administrators set changeover times.",
  },

  /** Ctrl/Cmd-K finding palette (C1). */
  palette: {
    title: "Find on the board",
    placeholder: "Rooms, events, clients…",
    empty:
      "No matches in this range or open enquiries.",
    kinds: { room: "Room", booking: "Booking", enquiry: "Enquiry" } as const,
    roomDetail: "Jump to lane",
    enquiryDetail: "Hold a date for it",
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

  /** The venue's contested dates for the year ahead (roadmap N3): each room
   *  and time more than one booking wants, with its ladder. The place words
   *  and decision dates are the decisions list's own. */
  contested: {
    title: "Contested dates",
    empty: "No date in the year ahead is wanted by more than one booking.",
    confirmed: "Confirmed",
    when: (room: string, day: string): string => `${room} · ${day}`,
    more: (shown: number, total: number): string =>
      `Showing the ${String(shown)} soonest of ${String(total)}.`,
  },
  today: "Today",
  previous: "Earlier",
  next: "Later",

  legend: {
    ink: "Confirmed",
    hold: "Provisional",
    prospect: "Interest only",
    internal_block: "House block",
    phase: "Occupancy footprint",
  } as const,

  lane: {
    inkCount: (count: number): string => `${String(count)} confirmed`,
    holdCount: (count: number): string => `${String(count)} provisional`,
  },

  block: {
    jointFirst: "Joint 1st",
    rank: (ordinal: string): string => `${ordinal} option`,
    unranked: "Provisional, no option yet",
  },

  drag: {
    grabHint: "Space lifts the block for arrow-key moves; Enter opens it.",
    blockedDrop: "That placement is blocked — the block returned to its slot.",
  },

  drawer: {
    createTitle: "New booking",
    editTitle: "Booking details",
    convertTitle: "Hold a date for this enquiry",
    close: "Close",
    cancel: "Discard",
    submit: {
      create: "Add to the diary",
      edit: "Save changes",
      convert: "Hold the date",
    } as const,
    convertNote: (name: string): string =>
      `A provisional date for ${name}. The enquiry stays in review.`,
    hygieneLegend: "Keeping the hold current",
    ownerNote: "You will own this hold.",
    /** What a field needs, in plain words (roadmap N3). The schema's own
     *  words ("endsAt must be after startsAt", "Invalid uuid") never reach
     *  the booker; its hold requirements already read plainly and pass as
     *  they are. */
    problems: {
      room: "Choose a room.",
      titleMissing: "Give the booking a title.",
      titleLong: "Keep the title to 200 characters.",
      eventTypeLong: "Keep the event type to 80 characters.",
      startsMissing: "Choose when it starts.",
      endsMissing: "Choose when it ends.",
      endsBeforeStart: "It must end after it starts.",
      option: "The option is a whole number, 1 or more.",
      nextActionMissing: "Write the next action.",
      nextActionLong: "Keep the next action to 500 characters.",
      notesLong: "Keep the notes to 2,000 characters.",
      owner: "Choose who owns the hold.",
      date: "Enter a valid date and time.",
      commitment: "Choose a commitment.",
      needsDecision: "A provisional hold needs a decision date.",
      needsNextAction: "A provisional hold needs a next action.",
      needsNextActionDate: "A provisional hold needs a date for its next action.",
      unreadable: "This booking cannot be saved as it stands. Close it and open it again.",
    },
    /** What already holds the room and time a new hold is placed in (roadmap
     *  N3); its option follows this ladder until the booker sets one. */
    ladder: {
      open: (room: string): string => `Nothing else holds the ${room} then.`,
      held: (holds: readonly { readonly title: string; readonly place: string }[]): string =>
        `Held then: ${listNames(holds.map((hold) => `${hold.title} (${hold.place.toLowerCase()})`))}.`,
      confirmed: (titles: readonly string[]): string =>
        `${listNames(titles)} ${titles.length === 1 ? "is" : "are"} confirmed then; a hold cannot be confirmed while ${titles.length === 1 ? "it stands" : "they stand"}.`,
      unread: "The board has not read that date, so no option is suggested.",
    },
    // The edit drawer's facts (T-619). Each absence is stated as an answer
    // rather than left as a blank line to interpret.
    summaryLabel: "Booking summary",
    whenLabel: "When",
    roomLabel: "Room",
    roomUnknown: "Room not listed",
    decideByLabel: "Decide by",
    decisionWasDueLabel: "Decision was due",
    ownerLabel: "Owner",
    ownerUnassigned: "Nobody yet",
    clientLabel: "Client",
    clientNone: "No client linked",
    eventLabel: "Event",
    guestsLabel: "Guests",
    saveFailed: "That change could not be saved — nothing was altered.",
    created: (title: string): string => `Added ${title} to the diary.`,
    saved: (title: string): string => `Saved ${title}.`,
    converted: (title: string): string => `Held a provisional date for ${title}.`,
    transitioned: (title: string, action: string): string => `${action}: ${title}.`,
    /** The booking's next step, under its facts (roadmap N3). */
    transitionsTitle: "Next step",
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
      rank: "Option",
      jointFlag: "Joint 1st",
      decisionAt: "Decision date",
      nextAction: "Next action",
      nextActionDueAt: "Next action due",
      notes: "Notes",
    } as const,
  },

  /** Go to date (roadmap N3): a date as it was said, and what each room
   *  holds that day. */
  goTo: {
    open: "Go to date",
    label: "Go to date",
    go: "Go",
    close: "Close",
    hint: "As you would say it: 5 Jun 27, 05/06/2027 or 5th June.",
    notADate: "The Diary cannot read that as a date. Try 5 Jun 27 or 05/06/2027.",
    /** Each booking in a room that day, as the board labels it. */
    confirmed: (title: string, time: string): string => `Confirmed, ${title}, ${time}`,
    hold: (rank: number | null, jointFlag: boolean, title: string, time: string, decides: string | null): string => {
      const place = rank === null ? "Provisional," : rank === 1 && jointFlag ? "Joint 1st" : `${ordinal(rank)} option`;
      return `${place} ${title}, ${time}${decides === null ? "" : `, decides ${decides}`}`;
    },
    block: (title: string, time: string): string => `House block, ${title}, ${time}`,
    /** `from`: the night before's event ends in the small hours ("01:00"). */
    free: (interest: readonly string[], from: string | null): string => {
      const free = from === null ? "Free" : `Free from ${from}`;
      return interest.length === 0 ? free : `${free}, interest only from ${listNames(interest)}`;
    },
    /** A weekday said with the date that is not the date's own (0 is Sunday). */
    otherWeekday: (actual: number, said: number): string =>
      `That date is a ${WEEKDAY_NAMES[actual] ?? ""}, not a ${WEEKDAY_NAMES[said] ?? ""}.`,
  },

  /** Making an interest-only booking provisional (roadmap N3): a live hold
   *  carries its place, a decision date and a dated next action, so the
   *  drawer asks for them before it acts. */
  promotion: {
    question: (title: string): string => `Make ${title} provisional?`,
    needs: "A provisional hold has an option, a decision date and a dated next action.",
    confirm: "Make it provisional",
    saving: "Making it provisional…",
    keep: "Keep it as interest only",
    done: (title: string, place: string): string => `${title} is provisional, ${place.toLowerCase()}.`,
  },

  /** The lifecycle's confirmation (roadmap N3). A change that ends a
   *  booking's claim on its date says, before it runs, what ends, who stands
   *  first on the date afterwards and that nothing reaches the client. A
   *  booking's history keeps the reason; hold reminders go only to staff. */
  ending: {
    question: {
      released: (title: string): string => `Release ${title}?`,
      expired: (title: string): string => `Mark ${title} expired?`,
      lost: (title: string): string => `Mark ${title} lost?`,
      cancelled: (title: string): string => `Cancel ${title}?`,
    },
    confirm: { released: "Release it", expired: "Mark expired", lost: "Mark lost", cancelled: "Cancel the booking" },
    saving: { released: "Releasing…", expired: "Marking expired…", lost: "Marking lost…", cancelled: "Cancelling…" },
    done: {
      released: (title: string): string => `Released ${title}.`,
      expired: (title: string): string => `Marked ${title} expired.`,
      lost: (title: string): string => `Marked ${title} lost.`,
      cancelled: (title: string): string => `Cancelled ${title}.`,
    },
    /** "Grand Hall, Thu 17 Sept 18:00–23:00: the confirmed booking ends." */
    ends: (room: string, when: string, what: string): string => `${room}, ${when}: ${what} ends.`,
    what: {
      ink: "the confirmed booking",
      hold: "the provisional hold",
      prospect: "the interest",
      internal_block: "the house block",
    },
    promoted: (titles: readonly string[]): string => `${listNames(titles)} ${titles.length === 1 ? "becomes" : "become"} 1st option.`,
    free: (titles: readonly string[]): string => `${listNames(titles)}, 1st option, can then be confirmed.`,
    /** A hold opened from another week: the board has not read its date. */
    ladderUnread: "Any hold behind it on that date moves up.",
    nothingSent: "Nothing is sent to the client.",
    noteLabel: "Reason (optional, kept with this change)",
    keep: "Keep it",
    nowFirst: (titles: readonly string[]): string => `${listNames(titles)} ${titles.length === 1 ? "is" : "are"} now 1st option.`,
    nowFree: (titles: readonly string[]): string => `${listNames(titles)}, 1st option, can now be confirmed.`,
  },

  transitions: {
    prospect: "Make it interest only",
    hold: "Make it provisional",
    ink: "Confirm it",
    internal_block: "Make it a house block",
    released: "Release",
    expired: "Mark expired",
    cancelled: "Cancel the booking",
    lost: "Mark lost",
  } as const,

  presence: {
    live: "Live",
    offline: "Reconnecting…",
    here: (names: readonly string[]): string =>
      names.length === 0 ? "Only you are here." : `Also here: ${names.join(", ")}.`,
  },

  trayEnquiries: {
    dragHint: "Drag a slip onto a room lane to hold its date.",
    dropAt: (time: string): string => `Hold at ${time}`,
    dropSeeking: "Drop on a room lane",
    title: "Open enquiries",
    empty: "No open enquiries right now.",
    more: (shown: number): string =>
      `Showing the ${String(shown)} newest open enquiries. Older ones are not listed here.`,
    convert: "Hold a date…",
    /** "wedding · 120 guests · in 8 months": the lead is the enquiries
     *  desk's own ("today", "date has passed"), or `noDate`. */
    detail: (eventType: string | null, guests: number | null, when: string): string => {
      const parts = [eventType ?? "event", guests === null ? null : `${String(guests)} guests`, when];
      return parts.filter((part): part is string => part !== null).join(" · ");
    },
    noDate: "date to be confirmed",
    /** The tile of an enquiry with no date, as the enquiries desk shows it. */
    openDate: { word: "Date", tbc: "TBC" },
    /** The date tile's name: pressing it shows that date on the board. */
    showDate: (spoken: string): string => `Show ${spoken} on the board`,
  },

  confirmInk: {
    title: "Move this confirmed booking?",
    body: "This changes the client's confirmed time or room.",
    confirm: "Move it",
    cancel: "Keep it where it is",
  },

  welcome: {
    title: "Using the Diary",
    intro:
      "Bookings use four commitment types.",
    entries: [
      {
        term: "Provisional",
        detail:
          "A 1st, 2nd or Joint 1st option, with an owner, a decision date and a next action. Provisional holds may overlap.",
      },
      {
        term: "Confirmed",
        detail:
          "Two confirmed bookings cannot share a room at the same time.",
      },
      {
        term: "House block & interest only",
        detail:
          "A house block reserves venue time. Interest only never holds the room.",
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
    /** The board's keys (design system 4.4), printed as a legend. */
    keysTitle: "Keys",
    keys: [
      { keys: ["T"], does: "Today" },
      { keys: ["[", "]"], does: "Earlier and later" },
      { keys: ["G"], does: "Go to a date" },
      { keys: ["D", "W", "F"], does: "Day, week and fortnight" },
      { keys: ["O"], does: "Overview or timeline" },
      { keys: ["N"], does: "New booking" },
      { keys: ["Ctrl", "K"], does: "Find on the board" },
      { keys: ["Ctrl", "Z"], does: "Undo" },
      { keys: ["?"], does: "This guide" },
    ],
    dismiss: "Open Diary",
    reopen: "How the Diary works",
  },

  undo: {
    moved: (title: string): string => `Moved ${title}.`,
    action: "Undo",
    undone: "Move undone.",
    failed: "That move could not be saved — the board has been restored.",
    slotTaken: "That slot was just confirmed by someone else — the board has been refreshed.",
  },

  tray: {
    title: "Needs attention",
    /** An older server sends no venue-wide list: the board's range is all
     *  this panel has read, and it says so. */
    empty: "No overdue next actions in this range.",
    /** Needs attention across the venue (roadmap N3): next actions overdue or
     *  due within seven days, whatever the booking's date. */
    emptyVenue: "No next actions due in the next 7 days.",
    overdue: "Overdue",
    soon: "Next 7 days",
    /** Holds on the board with no place on their ladder yet. */
    noOption: "No option yet",
    noActionWritten: "No next action written.",
    wasDue: (day: string, owner: string | null): string => `Was due ${day} · ${owner ?? "No owner"}`,
    due: (day: string, owner: string | null): string => `Due ${day} · ${owner ?? "No owner"}`,
    more: (shown: number, total: number): string => `Showing the ${String(shown)} most urgent of ${String(total)}.`,
    open: (count: number): string =>
      `${String(count)} provisional ${count === 1 ? "hold needs" : "holds need"} attention`,
  },

  conflicts: {
    title: "Conflicts",
    none: "No conflicts detected in this range.",
    checksTitle: "What was checked",
    severity: {
      blocking: "Blocking",
      warning: "Warning",
      info: "Options",
    } as const,
    turnaround: {
      checked: "Turnaround gaps: checked",
      partial: "Turnaround gaps: partly checked",
      not_checked: "Turnaround gaps: not checked",
    } as const,
  },

  nowLabel: "Now",
} as const;
