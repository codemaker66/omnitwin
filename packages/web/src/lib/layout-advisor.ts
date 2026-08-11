import type { Action, AIActionProposal } from "@omnitwin/types";
import { asJson } from "./action-log.js";

// ---------------------------------------------------------------------------
// layout-advisor — the copilot's engine.
//
// DETERMINISTIC BY CHOICE. Every proposal comes from geometry the operator
// can check with a tape measure, so it can be explained, replayed, and
// argued with. A language model cannot promise that, and in a room where
// the answer touches egress, "trust me" is not a product. A model's place is
// phrasing and intent-parsing ON TOP of this engine, never in place of it.
//
// It only ever PROPOSES. Everything it emits is an AIActionProposal whose
// actions carry an `ai` actor, so the 01 §12 law — nothing applies without a
// recorded operator acceptance — is enforced by the type, not by this
// file's good intentions.
//
// CLAIM SAFETY: proposals cite guidance and observed geometry. They never
// assert that a layout is safe, compliant, or approved; those are human
// determinations about a real room, and this engine has only nominal
// catalogue footprints on a plan.
// ---------------------------------------------------------------------------

export interface AdvisorItem {
  readonly id: string;
  readonly kind: string;
  /** Metres, plan coordinates. */
  readonly x: number;
  readonly z: number;
  /** Nominal footprint radius in metres — catalogue geometry, not measured. */
  readonly radiusM: number;
  /** Fixed features (stage, pillar, bar) are never proposed for a move. */
  readonly fixed?: boolean;
}

export interface AdvisorOptions {
  readonly configurationId: string;
  readonly advisorRef: string;
  readonly makeId: () => string;
  readonly now: () => string;
  /** Circulation gap the venue works to, in metres. */
  readonly minClearanceM: number;
  /** A chair further than this from every table is treated as stranded. */
  readonly orphanRadiusM?: number;
}

export interface AdvisorResult {
  readonly proposals: readonly AIActionProposal[];
  /** Pairs examined — so the operator can see the sweep was exhaustive. */
  readonly checked: number;
  /** Problems found but deliberately NOT proposed for, stated plainly
   *  rather than silently dropped or papered over with a fake fix. */
  readonly unresolved: readonly string[];
}

const CHAIR_KINDS = ["chair", "seat", "stool"];

function isChair(kind: string): boolean {
  return CHAIR_KINDS.some((candidate) => kind.includes(candidate));
}

function isTable(kind: string): boolean {
  return kind.includes("table");
}

function distance(a: AdvisorItem, b: AdvisorItem): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Round to millimetres — plan geometry has no business carrying float dust
 *  into an audit record a person will later read back. */
function mm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function aiAction(
  options: AdvisorOptions,
  intent: string,
  payload: unknown,
  inverse: unknown,
): Action {
  return {
    id: options.makeId(),
    actor: { kind: "ai", ref: options.advisorRef },
    intent,
    payload: asJson(payload),
    inverse: asJson(inverse),
    provenance: { surface: "planner", tool: "layout-advisor" },
    ts: options.now(),
  };
}

function proposal(
  options: AdvisorOptions,
  rationale: string,
  actions: readonly Action[],
): AIActionProposal {
  return {
    id: options.makeId(),
    configurationId: options.configurationId,
    rationale,
    // AIActionProposalSchema infers a mutable array; copy rather than widen
    // the caller's `readonly Action[]`.
    proposedActions: [...actions],
    status: "proposed",
    createdTs: options.now(),
    acceptance: null,
  };
}

/** Move `mover` directly away from `anchor` until the gap between their
 *  nominal footprints equals the guidance — along the line joining them, so
 *  the fix is the smallest one that resolves the pair. */
function separationPatch(
  mover: AdvisorItem,
  anchor: AdvisorItem,
  minClearanceM: number,
): { readonly positionX: number; readonly positionZ: number } {
  const needed = minClearanceM + mover.radiusM + anchor.radiusM;
  const dx = mover.x - anchor.x;
  const dz = mover.z - anchor.z;
  const current = Math.hypot(dx, dz);
  // Exactly coincident: no line to push along, so pick +X deterministically
  // rather than dividing by zero or choosing at random.
  const ux = current === 0 ? 1 : dx / current;
  const uz = current === 0 ? 0 : dz / current;
  return {
    positionX: mm(anchor.x + ux * needed),
    positionZ: mm(anchor.z + uz * needed),
  };
}

export function adviseLayout(
  items: readonly AdvisorItem[],
  options: AdvisorOptions,
): AdvisorResult {
  const proposals: AIActionProposal[] = [];
  const unresolved: string[] = [];
  let checked = 0;

  // Sort by id so the advice is identical whatever order the room arrived
  // in — an advisor whose output depends on array order cannot be trusted
  // or diffed between runs.
  const ordered = [...items].sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const first = ordered[i];
      const second = ordered[j];
      if (first === undefined || second === undefined) continue;
      checked += 1;

      const gap = distance(first, second) - first.radiusM - second.radiusM;
      if (gap >= options.minClearanceM) continue;

      // A chair at its own table is seating, not a clearance fault.
      if ((isChair(first.kind) && isTable(second.kind)) || (isTable(first.kind) && isChair(second.kind))) {
        continue;
      }

      // Who yields: a fixed feature never does. When neither is fixed the
      // LATER-sorted item moves, so the rule is stable across runs and
      // explainable to an operator ("we kept the first and moved the
      // second") rather than silently arbitrary.
      const mover = first.fixed === true ? second : second.fixed === true ? first : second;
      const anchor = mover === first ? second : first;
      if (mover.fixed === true) {
        unresolved.push(
          `${first.id} and ${second.id} sit ${mm(gap).toFixed(2)}m apart against ${options.minClearanceM.toFixed(2)}m guidance, but both fixed — a person needs to decide this one.`,
        );
        continue;
      }

      const after = separationPatch(mover, anchor, options.minClearanceM);
      const before = { positionX: mm(mover.x), positionZ: mm(mover.z) };
      proposals.push(proposal(
        options,
        `${first.id} and ${second.id} leave a ${mm(gap).toFixed(2)}m gap; this venue works to ${options.minClearanceM.toFixed(2)}m for circulation. Moving ${mover.id} opens it to the guidance figure — worth a review against the real room.`,
        [aiAction(
          options,
          "object.update",
          { label: `Open circulation around ${mover.id}`, added: [], removed: [], updated: [{ id: mover.id, before, after }] },
          { label: `Open circulation around ${mover.id}`, added: [], removed: [], updated: [{ id: mover.id, before: after, after: before }] },
        )],
      ));
    }
  }

  const orphanRadiusM = options.orphanRadiusM;
  if (orphanRadiusM !== undefined) {
    const tables = ordered.filter((candidate) => isTable(candidate.kind));
    for (const candidate of ordered) {
      if (!isChair(candidate.kind)) continue;
      const nearest = tables.reduce<number>(
        (best, table) => Math.min(best, distance(candidate, table)),
        Number.POSITIVE_INFINITY,
      );
      if (nearest <= orphanRadiusM) continue;
      const placed = {
        object: { id: candidate.id, kind: candidate.kind, positionX: mm(candidate.x), positionZ: mm(candidate.z) },
        index: 0,
      };
      proposals.push(proposal(
        options,
        `${candidate.id} has no table within ${orphanRadiusM.toFixed(2)}m. It may be left over from an earlier arrangement — removing it tidies the count, if it is not there on purpose.`,
        [aiAction(
          options,
          "object.remove",
          { label: `Remove stranded ${candidate.kind}`, added: [], removed: [placed], updated: [] },
          { label: `Remove stranded ${candidate.kind}`, added: [placed], removed: [], updated: [] },
        )],
      ));
    }
  }

  return { proposals, checked, unresolved };
}
