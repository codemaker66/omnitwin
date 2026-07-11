// -----------------------------------------------------------------------------
// living-hall-copy — every line of the Living Hall document, as data.
//
// Same contract as rite-copy.ts: no copy buried in JSX; allLivingHallCopy()
// is swept through the claim guard. This document is the source of truth for
// every tier of the experience — the 3D layers perform it, Tier C styles it,
// and it is what search engines and screen readers read. Write it as if it is
// the only version anyone will ever see, because for many visitors it is.
//
// Provenance rule: RECEPTION_CAPTURE_RECORD mirrors state/capture_log.json and
// a test pins them together — the page may only claim what the record holds.
// -----------------------------------------------------------------------------

export const LH_META_TITLE = "The Living Hall — Trades Hall Glasgow";

export const LH_BRAND_SMALL = "Est. 1791 · Glasgow";
export const LH_BRAND_NAME = "Trades Hall";

export const LH_SKIP_LABEL = "Skip to rooms & rates";
export const LH_CHECK_DATE_LABEL = "Check a date";
export const LH_ENQUIRE_LABEL = "Enquire";

export const LH_HEADLINE = "The hall is real.";
export const LH_LEDE =
  "This page is built from a scan of Trades Hall itself. On capable devices it becomes the venue's own planning room — the captured hall, dressed for your evening in front of you. What you read below is the whole story, exactly as the full experience performs it.";

export interface LivingHallAct {
  readonly id: string;
  readonly navLabel: string;
  readonly title: string;
  readonly narration: readonly string[];
}

export const LH_ACTS: readonly LivingHallAct[] = [
  {
    id: "arrival",
    navLabel: "Arrival",
    title: "Arrival",
    narration: [
      "You arrive in the Reception Room as it stands on Glassford Street — reconstructed from a scan of the room itself, not photography arranged to flatter. Robert Adam drew this building in 1791; the room you are standing in is the one his walls still hold.",
      "The room is empty, and it is listening. The first mark of gold ink — a single chair, drawn in place beside you — is the page introducing its only rule: everything photographic is the captured room; everything gold is a plan.",
    ],
  },
  {
    id: "the-dressing",
    navLabel: "The dressing",
    title: "The dressing",
    narration: [
      "Choose the shape of your evening — a wedding, a dinner, a conference — and the room dresses itself for it. One table is laid completely first, close enough to read the place settings. Then the floor fills: tables sweep in, chairs settle around them, drawn in the same gold ink, until the room holds your number.",
      "The figures that tick beside the choreography are the venue's published ones, carried live from the planning engine — never typed into this page by hand.",
    ],
  },
  {
    id: "the-plan",
    navLabel: "The plan",
    title: "The plan, and the record",
    narration: [
      "From a high corner of the room, the photograph gives way to the plan: the same floor, the same walls, seen the way the venue team sees them. This is Venviewer — the planning room Trades Hall works in. Move a table and the capacity guidance answers; what you arrange here can open in the full planner and travel with your enquiry.",
      "A page that asks for your wedding should show its papers. Below is the capture record for the room you are seeing — where it came from, when, and how it was built. Nothing on this page is generated from imagination: every pixel of the room is reconstructed from the scan, and everything added to it is drawn as ink, deliberately unmistakable.",
    ],
  },
  {
    id: "rooms-and-rates",
    navLabel: "Rooms & rates",
    title: "The rooms, and the threshold",
    narration: [
      "Trades Hall keeps six published rooms, each with its own hours and temperament — from the Grand Hall beneath its dome to the galleries that hold forty. Their capacities below are the venue's own figures, in the venue's own four formats.",
      "When you are ready, begin in the room — arrange your evening in the planner and send it with your enquiry — or speak directly with the events team, who answer as people, not a form.",
    ],
  },
] as const;

/** The gold/cyan rule, stated once and rendered beside the plan. */
export const LH_LEGEND_GOLD = "Gold — placed by the plan.";
export const LH_LEGEND_CYAN = "Cyan — simulated movement and guidance, always labelled.";

/** Beat two — the visitor chooses the evening's shape; the pen obeys. */
export const LH_EVENT_CHOICE_LEGEND = "The shape of your evening";
export const LH_EVENT_TYPES = [
  { key: "wedding", label: "Wedding" },
  { key: "dinner", label: "Dinner" },
  { key: "conference", label: "Conference" },
] as const;

/** The Turn's sandbox — the first thing on the page the visitor owns. */
export const LH_SANDBOX_START = "Move the table yourself";
export const LH_SANDBOX_DONE = "Done — the table stays where you left it";
export const LH_SANDBOX_HINT =
  "Drag it, or use the arrow keys. Esc to finish. The cyan ring is a clearance guide — a planning aid.";

/** The tick: live seats under the pen, ceiling from venue truth. Rendered
 *  as `«n» seated · the room takes up to «ceiling» at «format»`. */
export const LH_TICK_SEATED = "seated";
export const LH_TICK_CEILING_PREFIX = "the room takes up to";
export const LH_TICK_FORMAT_LABEL: Record<"dinner" | "theatre", string> = {
  dinner: "at dinner",
  theatre: "theatre style",
};

/** Mirrors state/capture_log.json (reception-room) — pinned by test. */
export const RECEPTION_CAPTURE_RECORD = {
  room: "Reception Room",
  capturedAt: "2026-06-01T15:06:18",
  device: "XGRIDS PortalCam",
  splatCount: 2002122,
  builtAt: "2026-06-08T16:04:14",
  status: "Runtime scene built — web presentation in preparation.",
} as const;

export const LH_CAPTURE_RECORD_TITLE = "Capture record";
export const LH_CAPTURE_RECORD_LINES = [
  `Scanned ${RECEPTION_CAPTURE_RECORD.room}, 1 June 2026, with a ${RECEPTION_CAPTURE_RECORD.device}.`,
  `Rebuilt from ${RECEPTION_CAPTURE_RECORD.splatCount.toLocaleString("en-GB")} captured points, 8 June 2026.`,
  RECEPTION_CAPTURE_RECORD.status,
] as const;

export const LH_ROOMS_TITLE = "Capacities, as published by the venue";
export const LH_RATES_TITLE = "Wedding hire";

export const LH_CTA_PLANNER_LABEL = "Begin with the room";
/** When the visitor has placed their table, the planner door speaks to
 *  what they already own. ("With your table" waits for frame registration —
 *  the planner cannot yet show the exact placement, so we do not say it.) */
export const LH_CTA_CONTINUE_LABEL = "Continue with this room";
/** The Living Hall opens the planner on the room it performs. */
export const LH_CTA_PLANNER_HREF = "/plan?space=reception-room";
export const LH_CTA_TEAM_LABEL = "Speak with the events team";
/** Travels in the enquiry body when the visitor engaged the sandbox —
 *  facts only: what they did, on which surface. */
export const LH_ENQUIRY_DRAFT_NOTE =
  "I have been sketching a table layout in the Reception Room preview on your planning page.";

export const LH_FOOTER_NOTE =
  "Built for Trades Hall of Glasgow by Venviewer — planning on the captured room.";

/** Every visible string, for the claim guard sweep. */
export function allLivingHallCopy(): readonly string[] {
  return [
    LH_META_TITLE,
    LH_BRAND_SMALL,
    LH_BRAND_NAME,
    LH_SKIP_LABEL,
    LH_CHECK_DATE_LABEL,
    LH_ENQUIRE_LABEL,
    LH_HEADLINE,
    LH_LEDE,
    ...LH_ACTS.flatMap((act) => [act.navLabel, act.title, ...act.narration]),
    LH_LEGEND_GOLD,
    LH_LEGEND_CYAN,
    LH_EVENT_CHOICE_LEGEND,
    ...LH_EVENT_TYPES.map((t) => t.label),
    LH_SANDBOX_START,
    LH_SANDBOX_DONE,
    LH_SANDBOX_HINT,
    LH_TICK_SEATED,
    LH_TICK_CEILING_PREFIX,
    LH_TICK_FORMAT_LABEL.dinner,
    LH_TICK_FORMAT_LABEL.theatre,
    LH_CAPTURE_RECORD_TITLE,
    ...LH_CAPTURE_RECORD_LINES,
    LH_ROOMS_TITLE,
    LH_RATES_TITLE,
    LH_CTA_PLANNER_LABEL,
    LH_CTA_CONTINUE_LABEL,
    LH_ENQUIRY_DRAFT_NOTE,
    LH_CTA_TEAM_LABEL,
    LH_FOOTER_NOTE,
  ] as const;
}
