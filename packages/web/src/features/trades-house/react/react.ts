// -----------------------------------------------------------------------------
// react — the one reaction primitive (spec section 5). react(prop, state, ctx,
// gesture) composes one spring, one cue, one caption and an optional aside for
// one poke in one call, so the stage can apply all of them in the same rAF
// frame. Pure: the clock arrives in ctx, the state goes back out in `next`,
// and nothing here imports the instrument.
//
// Rows are deterministic and identical for everyone. A numeric `at` fires
// when the new count equals it. A "distinctProps:n" row fires once, when the
// reader has touched n distinct things in the scene, whatever the count: the
// rare stages reward looking around, never drumming. A "conditional:<id>" row
// fires once, when the persisted fact holds. When several rows are satisfied
// at once the highest authored row wins and the rest wait their turn.
//
// Between and beyond the authored counts the thing repeats its latest numeric
// row (the water rings on every poke; a bolted box does what its last row
// says), the way convener-state.ts holds its terminal line. The aside is
// spoken only when a row fires, never on a repeat.
// -----------------------------------------------------------------------------
import type { Prop, SpringPresetName, StageRow } from "../stage/stage-manifest.js";
import { POKE_HAPTIC_MS } from "./haptics.js";
import { RECENT_KEEP, reducePoke, THIRD_TAP_WINDOW_MS } from "./pokeable-reducer.js";
import {
  SPEAKING_CAPTION,
  type PokeContext,
  type PokeGesture,
  type PokeableState,
  type Reaction,
} from "./react-types.js";

/** What a sleeping thing says when poked. It reports; it does not grade. */
export const ASLEEP_CAPTION = "[it is asleep]";
/** A poke no authored row backs: the spring alone, and a caption that says so. */
export const PLAIN_POKE_CAPTION = "[it stirs, and settles]";
/** A plain poke moves on the playful bounce (spec section 5: pokes on 180/12). */
export const PLAIN_POKE_SPRING: SpringPresetName = "placementBounce";
/** The preset an inert or sleeping reaction carries: overdamped, it refuses to bounce. */
export const STILL_SPRING: SpringPresetName = "heavy";
/** The third tap on one thing inside ten seconds plays this much quieter, at half length. */
export const THIRD_TAP_GAIN_DB = -6;

export type RowCondition =
  | { readonly kind: "count"; readonly n: number }
  | { readonly kind: "distinctProps"; readonly n: number }
  | { readonly kind: "conditional"; readonly id: string }
  /** A malformed `at` the schema would have refused: it never fires. */
  | { readonly kind: "never" };

/** Reads a row's `at` (validated by StageRowSchema; a stray string never fires). */
export function parseRowCondition(at: StageRow["at"]): RowCondition {
  if (typeof at === "number") return { kind: "count", n: at };
  const colon = at.indexOf(":");
  if (colon <= 0) return { kind: "never" };
  const head = at.slice(0, colon);
  const tail = at.slice(colon + 1);
  if (head === "distinctProps") {
    const n = Number.parseInt(tail, 10);
    return Number.isInteger(n) && n > 0 ? { kind: "distinctProps", n } : { kind: "never" };
  }
  if (head === "conditional" && tail.length > 0) return { kind: "conditional", id: tail };
  return { kind: "never" };
}

function rowFires(
  condition: RowCondition,
  index: number,
  count: number,
  ctx: PokeContext,
  fired: readonly number[],
): boolean {
  switch (condition.kind) {
    case "count":
      return count === condition.n;
    case "distinctProps":
      return !fired.includes(index) && ctx.distinctProps >= condition.n;
    case "conditional":
      return !fired.includes(index) && ctx.conditionals.has(condition.id);
    case "never":
      return false;
  }
}

export interface FiredRow {
  readonly index: number;
  readonly condition: RowCondition;
}

/** The highest authored row the new count or the context satisfies, or null. */
export function pickRow(prop: Prop, next: PokeableState, ctx: PokeContext): FiredRow | null {
  const fired = next.firedRows ?? [];
  for (let index = prop.states.length - 1; index >= 0; index -= 1) {
    const row = prop.states[index];
    if (row === undefined) continue;
    const condition = parseRowCondition(row.at);
    if (rowFires(condition, index, next.count, ctx, fired)) return { index, condition };
  }
  return null;
}

/** The latest numeric row at or below the count: what a plain poke repeats. */
export function heldRow(prop: Prop, count: number): number | null {
  let best: number | null = null;
  let bestAt = 0;
  prop.states.forEach((row, index) => {
    if (typeof row.at === "number" && row.at <= count && row.at >= bestAt) {
      best = index;
      bestAt = row.at;
    }
  });
  return best;
}

/**
 * The third poke on one thing inside ten seconds. Read on the NEW state, so
 * the poke being reacted to is the third; the fourth and fifth inside the
 * window count too, since their last three are still within it.
 */
export function isThirdTap(state: PokeableState): boolean {
  if (state.recentMs.length < RECENT_KEEP) return false;
  const first = state.recentMs[0];
  const last = state.recentMs[state.recentMs.length - 1];
  return first !== undefined && last !== undefined && last - first <= THIRD_TAP_WINDOW_MS;
}

function stillReaction(next: PokeableState, caption: string, inert: boolean): Reaction {
  return {
    next,
    spring: STILL_SPRING,
    cue: null,
    cueGainDb: 0,
    cueHalfLength: false,
    caption,
    aside: null,
    stageRow: null,
    colorStep: null,
    inert,
    hapticMs: 0,
  };
}

/**
 * One poke on one thing. `ctx.distinctProps` is what the pokes store reports
 * before this poke lands (the store is written with `next` afterwards), so a
 * thing's own first poke does not count itself; that is deterministic and the
 * manifest authors its "distinctProps:n" rows against it.
 */
export function react(
  prop: Prop,
  state: PokeableState,
  ctx: PokeContext,
  gesture: PokeGesture,
): Reaction {
  if (ctx.speaking) return stillReaction(state, SPEAKING_CAPTION, true);

  const reduced = reducePoke(state, ctx);
  if (reduced.stage === "asleep") return stillReaction(reduced, ASLEEP_CAPTION, false);

  const fired = pickRow(prop, reduced, ctx);
  const next: PokeableState =
    fired !== null && fired.condition.kind !== "count"
      ? { ...reduced, firedRows: [...(reduced.firedRows ?? []), fired.index] }
      : reduced;

  const third = isThirdTap(next);
  // A sweep is continuous; a tick per sample would be a buzz, not a touch.
  const hapticMs = gesture === "sweep" ? 0 : POKE_HAPTIC_MS;

  const sourceIndex = fired?.index ?? heldRow(prop, next.count);
  const row = sourceIndex === null ? undefined : prop.states[sourceIndex];
  if (row === undefined) {
    return {
      next,
      spring: PLAIN_POKE_SPRING,
      cue: null,
      cueGainDb: 0,
      cueHalfLength: false,
      caption: PLAIN_POKE_CAPTION,
      aside: null,
      stageRow: null,
      colorStep: null,
      inert: false,
      hapticMs,
    };
  }

  return {
    next,
    spring: row.spring,
    cue: row.cue,
    cueGainDb: third ? THIRD_TAP_GAIN_DB : 0,
    cueHalfLength: third,
    caption: ctx.reducedMotion ? row.reducedMotion.caption : row.caption,
    aside: fired === null ? null : (row.aside ?? null),
    stageRow: fired === null ? null : fired.index,
    colorStep: row.reducedMotion.colorStep,
    inert: false,
    hapticMs,
  };
}
