import { isLevelAtPrintedPrecision, spellLength, type MeasureSpan } from "./measure-math.js";

// -----------------------------------------------------------------------------
// measure-copy — every word the measure tool says, as data.
//
// It lives beside its component rather than in twin-copy.ts for the reason
// RoomDossier already records: twin-copy.ts is a pure data module and pulling a
// React component's strings through it would invert the dependency. The
// guarantee is what matters, not the location, so this module publishes
// `allMeasureCopy()` and the layer's own suite runs it through
// findUnsupportedProposalClaim — the repo's single enforcement of the banned
// certainty phrases.
//
// THE EDITORIAL RULE, after the refutation. This tool used to print a ± and
// explain it. It no longer prints one, because the only figure it could have
// derived a ± from — the manifest `tier` — is an argv default, not a
// measurement (the long block at the top of measure-math.ts is the record).
// What replaces it is a sentence, and a sentence has to earn its place by being
// true rather than by looking precise. So:
//
//   • It never says how accurate the figures are. It cannot: nothing measured
//     that. Anything of the form "to within X" is barred, in any unit.
//   • It says what KIND of measurement this is — read off a 3D capture of the
//     building — because that is a fact about provenance, which we do have.
//   • It names the one action that resolves the doubt: confirm on site, with
//     the events team. "the events team" matches TWIN_ENQUIRE_CTA rather than
//     paraphrasing it: one building, one team, one name for them.
//
// It also never says "survey-grade", which is on the claim guard's banned list
// (PROPOSAL_UNSUPPORTED_CLAIM_PHRASES) — and was, until this revision, also the
// literal value of the manifest tier this feature consumed. It consumes no tier
// at all now, so that whole hazard is gone rather than guarded: the safest way
// to never print a value is to never be handed it.
// -----------------------------------------------------------------------------

/** Names the cluster for a screen reader before any individual control. */
export const MEASURE_GROUP_LABEL = "Measure";

/** The two states before there is anything to report. Phrased as instructions
 *  rather than status ("No points yet") so the panel always tells the visitor
 *  what to do next, not what has failed to happen. */
export const MEASURE_FIRST_PROMPT = "Choose the first point.";
export const MEASURE_SECOND_PROMPT = "Choose the second point.";

/** The three figures, in the words a room layout is discussed in. "Straight" is
 *  the line through the air; "Plan" is its shadow on the floor — the number a
 *  furniture layout actually needs. */
export const MEASURE_STAT_STRAIGHT = "Straight";
export const MEASURE_STAT_PLAN = "Plan";

/** How the height difference is named. "Level" is the honest reading when the
 *  difference does not survive the rounding we print at — see
 *  isLevelAtPrintedPrecision. It is a statement about the figure on screen, not
 *  a claim about what the capture can resolve. */
export const MEASURE_RISE_UP = "Rise";
export const MEASURE_RISE_DOWN = "Drop";
export const MEASURE_RISE_LEVEL = "Level";

/** Drop the picks, keep the tool. */
export const MEASURE_CLEAR_LABEL = "Clear";
/** Put the tool away. Named for what it closes, so a screen-reader user meeting
 *  the button out of context still knows which "Close" this is. */
export const MEASURE_DONE_LABEL = "Close measure";

/**
 * The keyboard route to placing a point, rendered only when the host wires the
 * callback. Without it the tool is mouse-only, which for a measurement — the
 * one feature whose output people write into an order — is not acceptable.
 * The label says exactly where the point will land, because a visitor who
 * cannot click cannot see a cursor to aim with either.
 */
export const MEASURE_CENTRE_PICK_LABEL = "Place a point at the centre of the view";

/**
 * The qualification that travels with the figures, and the only thing this tool
 * says about confidence.
 *
 * Three clauses, each load-bearing and each a statement of fact rather than of
 * precision:
 *
 *   "Read off the 3D capture of this building, not taken with a surveyor's
 *   instrument" — provenance. True of every capture kind the manifest admits
 *   (matterport-e57, xgrids-lcc, photo-mapanything): none of them is a total
 *   station. It deliberately does not name a technique, because those three do
 *   not share one and picking one would be false for the other two.
 *
 *   "good for planning a layout, not for setting out or cutting to" — what the
 *   figures are for, phrased as the working distinction a venue already knows
 *   (planning dimensions vs setting-out dimensions) rather than as a tolerance
 *   nobody measured.
 *
 *   "Confirm any dimension you are ordering or building to on site with the
 *   events team" — the action that resolves it. It names the moment (before
 *   money), the place (on site), and the people.
 *
 * What is deliberately absent: any number, any unit, and any construction of
 * the form "accurate to". If a future revision wants one, it needs a measured
 * registration residual in the manifest first — see measure-math.ts.
 */
export const MEASURE_CONFIDENCE_NOTE =
  "Read off the 3D capture of this building, not taken with a surveyor's " +
  "instrument — good for planning a layout, not for setting out or cutting to. " +
  "Confirm any dimension you are ordering or building to on site with the " +
  "events team.";

/**
 * Which word names this height difference. The level test is imported rather
 * than restated so the word and the printed figure cannot disagree: "Level"
 * appears exactly when the rise beside it renders as zero.
 */
export function measureRiseWord(riseM: number): string {
  if (isLevelAtPrintedPrecision(riseM)) {
    return MEASURE_RISE_LEVEL;
  }
  return riseM > 0 ? MEASURE_RISE_UP : MEASURE_RISE_DOWN;
}

/**
 * The completed measurement as one spoken sentence for the polite live region.
 *
 * Every figure repeats "approximately" rather than sharing one trailing "all
 * figures approximate". The repetition is one word each and it buys the
 * structural rule the feature rests on: no figure is ever uttered without its
 * qualification, including to somebody who is only listening and cannot glance
 * back at a footnote.
 *
 * The rise is a full clause instead of a bare label because "Level 0.01 metres"
 * is not English; direction reads far better as "higher"/"lower" once spoken.
 */
export function measureAnnouncement(span: MeasureSpan): string {
  const straight = `Straight line ${spellLength(span.straightM)}.`;
  const plan = `In plan ${spellLength(span.planM)}.`;
  const rise = isLevelAtPrintedPrecision(span.riseM)
    ? "The two points are level."
    : `The second point is ${spellLength(Math.abs(span.riseM))} ${
        span.riseM > 0 ? "higher" : "lower"
      }.`;
  return `${straight} ${plan} ${rise}`;
}

/**
 * Every user-visible string this tool can render — the claim-guard sweep target
 * (mirrors allTwinCopy() in twin-copy.ts and allQuickActionCopy()).
 *
 * The generated lines are sampled with real spans rather than templates, so the
 * sweep sees the sentences a visitor sees. All three rise cases are enumerated
 * because the set is finite and known here: sampling one would leave two
 * unswept phrasings that only ever appear on a sloping floor.
 */
export function allMeasureCopy(): readonly string[] {
  const rising: MeasureSpan = {
    straightM: 5.39,
    planM: 5,
    riseM: 2,
    straightLabel: "≈ 5.39 m",
    planLabel: "≈ 5.00 m",
    riseLabel: "≈ 2.00 m",
  };
  const falling: MeasureSpan = { ...rising, riseM: -2 };
  const level: MeasureSpan = { ...rising, riseM: 0, riseLabel: "≈ 0.00 m" };

  return [
    MEASURE_GROUP_LABEL,
    MEASURE_FIRST_PROMPT,
    MEASURE_SECOND_PROMPT,
    MEASURE_STAT_STRAIGHT,
    MEASURE_STAT_PLAN,
    MEASURE_RISE_UP,
    MEASURE_RISE_DOWN,
    MEASURE_RISE_LEVEL,
    MEASURE_CLEAR_LABEL,
    MEASURE_DONE_LABEL,
    MEASURE_CENTRE_PICK_LABEL,
    MEASURE_CONFIDENCE_NOTE,
    measureAnnouncement(rising),
    measureAnnouncement(falling),
    measureAnnouncement(level),
  ];
}
