import type { ActionActor } from "@omnitwin/types";
import type { ActionContext } from "../lib/action-log.js";
import { surfaceAction, type SurfaceActionSpec } from "../lib/surface-actions.js";
import { useActionLogStore } from "./action-log-store.js";
import { useAuthStore } from "./auth-store.js";

// ---------------------------------------------------------------------------
// planner-action-log — G4 Slice 2 wiring.
//
// The single seam between direct surfaces (markup, event details, lighting
// rig) and the append-only action log. Actor context is built here — the
// surface stores stay ignorant of auth — so who-did-it stamping matches the
// editor history emitter's. Envelope building itself stays pure in
// lib/surface-actions.ts.
// ---------------------------------------------------------------------------

function currentOperator(): ActionActor {
  const id = useAuthStore.getState().user?.id;
  return id === undefined ? { kind: "operator" } : { kind: "operator", ref: id };
}

export function plannerActionContext(): ActionContext {
  return {
    actor: currentOperator(),
    surface: "planner",
    makeId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
}

/** Append one completed surface mutation to the action log.
 *  Never throws: the log is a side channel riding alongside real mutations —
 *  an audit failure must not break the mutation's caller (a store action's
 *  follow-up work, or a save handler that would misreport "Failed to save"
 *  for a PATCH that succeeded). */
export function logPlannerAction(spec: SurfaceActionSpec): void {
  try {
    useActionLogStore.getState().append(surfaceAction(spec, plannerActionContext()));
  } catch (error) {
    // eslint-disable-next-line no-console -- deliberate: the only trace of a swallowed audit-channel failure
    console.error("action log append failed", spec.intent, error);
  }
}
