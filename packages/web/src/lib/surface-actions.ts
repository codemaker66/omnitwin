import type { Action } from "@omnitwin/types";
import { asJson, type ActionContext } from "./action-log.js";

// ---------------------------------------------------------------------------
// surface-actions — G4 Slice 2 (03 §1).
//
// The direct-surface counterpart to action-log's history sealing: markup,
// event details, and the lighting rig mutate outside the undo engine, so
// each completed mutation builds its own envelope here. No coalescing, no
// sealing — one call is one Action. Pure: ids/timestamps via context.
// ---------------------------------------------------------------------------

export interface SurfaceActionSpec {
  /** Namespaced lowercase verb, e.g. `markup.draw`, `lighting.rig.set-count`. */
  readonly intent: string;
  /** Provenance tool tag, e.g. `markup`, `event-details`, `lighting-rig`. */
  readonly tool: string;
  readonly payload: unknown;
  /** The mutation's real inverse. Surface actions always have one — `null`
   *  is reserved for log-management records (`log.summarized`). */
  readonly inverse: unknown;
}

export function surfaceAction(spec: SurfaceActionSpec, context: ActionContext): Action {
  return {
    id: context.makeId(),
    actor: context.actor,
    intent: spec.intent,
    payload: asJson(spec.payload),
    inverse: asJson(spec.inverse),
    provenance: { surface: context.surface, tool: spec.tool },
    ts: context.now(),
  };
}
