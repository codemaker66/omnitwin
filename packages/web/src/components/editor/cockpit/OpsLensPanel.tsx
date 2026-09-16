import { useMemo, useRef, useState, type ReactElement } from "react";
import { BriefcaseBusiness } from "lucide-react";
import { ActivityIndicator } from "../../shared/Activity.js";
import type { OpsHandoffPackBundle } from "@omnitwin/types";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useLightingRigStore } from "../../../stores/lighting-rig-store.js";
import { buildOpsSetupPlan, formatSetupDuration } from "../../../lib/cockpit-ops-model.js";
import { compileOpsHandoffPack } from "../../../api/ops-handoff.js";
import { linkEventConfiguration } from "../../../api/events.js";
import { useLinkedEvent } from "../../../hooks/use-linked-event.js";
import { ApiError } from "../../../api/client.js";

// ---------------------------------------------------------------------------
// OpsLensPanel — run-of-show setup planning (Epic 0, fifth real lens panel).
//
// Two layers, like the Share lens. The PREVIEW is the instant, no-backend setup
// plan built live from the placed layout (load-in tasks + indicative crew/time
// estimate). "Compile ops handoff pack" then runs the real server compiler
// (compileOpsHandoffPack) on the SAVED configuration to produce the full handoff
// pack — task groups, pick lists, load-in/breakdown sequences, a BEO — opened at
// /ops/handoff/:id. Staff sign-in + a saved layout are required; both gated
// honestly. SAFE: effort figures are planning-grade estimates, not a guaranteed
// schedule — the footer keeps that visible.
//
// THE EVENT CHAIN: when the planner was opened from an event link (?eventId),
// the compiled pack must carry that event or the Event Day board has nothing to
// show and reports a missing handoff. The Ops compiler refuses an event it has
// no recorded event_configuration_links row for, so compiling attempts that
// binding first. Three rules keep the chain honest:
//
//  * the binding is attempted by the EXPLICIT compile action, never by mounting
//    the lens. The row it writes is also the participation grant that admits a
//    customer to an event's schedule (services/client-event-schedule.ts), so it
//    follows a human act and the server refuses a client-owned layout outright.
//  * only a SUCCESSFUL binding is remembered. A refusal or a network blip is
//    retried by the next explicit compile rather than becoming a permanent dead
//    end that answers 409 to every later attempt.
//  * a binding that cannot be made — a hallkeeper's 403, a client-owned layout,
//    a failed request — falls back to compiling WITHOUT the event, exactly as
//    this panel did before the event chain existed. The note then states that
//    the pack is not attached and why, instead of promising an attachment.
// ---------------------------------------------------------------------------

type OpsPhase = "idle" | "compiling" | "error";

const ACTIONABLE_OPS_ERROR_CODES = new Set([
  "APPROVED_SNAPSHOT_REQUIRED",
  "BLOCKING_REVIEW_GATE",
  "EVENT_CONFIGURATION_BINDING_REQUIRED",
  "SOURCE_EVIDENCE_INVALID",
]);

function opsCompilationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && ACTIONABLE_OPS_ERROR_CODES.has(error.code)) {
    return error.message;
  }
  return "Couldn't compile the handoff pack. Check the connection and try again, or use Ops in your dashboard.";
}

// What this panel actually knows about the event binding, for the note. "idle"
// is "not attempted yet for this event and layout" — never "assumed to work".
type EventBinding =
  | { readonly kind: "idle" }
  | { readonly kind: "bound" }
  | { readonly kind: "unbound"; readonly reason: string };

const BINDING_IDLE: EventBinding = { kind: "idle" };
const BINDING_BOUND: EventBinding = { kind: "bound" };

function bindingFailure(error: unknown): EventBinding {
  if (error instanceof ApiError && error.status === 403) {
    return {
      kind: "unbound",
      reason: "Your role can't attach packs to events, so venue staff or an administrator has to attach this one.",
    };
  }
  if (error instanceof ApiError && error.code === "CONFIGURATION_OWNER_IS_CUSTOMER") {
    return {
      kind: "unbound",
      reason: "This saved layout belongs to a client account, and attaching it would give that client the event's schedule.",
    };
  }
  if (error instanceof ApiError && error.status < 500) {
    // Server messages on this route are written for the person reading them.
    return { kind: "unbound", reason: /[.!?]$/u.test(error.message) ? error.message : `${error.message}.` };
  }
  return { kind: "unbound", reason: "The attachment request didn't complete — compile again to retry it." };
}

function bindingNote(eventName: string, binding: EventBinding): string {
  if (binding.kind === "bound") return `Attached to ${eventName}, so this pack reaches the event day board.`;
  if (binding.kind === "idle") {
    return `Not attached to ${eventName} yet — compiling attaches it so the pack reaches the event day board.`;
  }
  return `Not attached to ${eventName}. ${binding.reason} The pack compiles without the event, so it won't reach the event day board.`;
}

export function OpsLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const configId = useEditorStore((state) => state.configId);
  const venueId = useEditorStore((state) => state.venueId);
  const isSignedIn = useAuthStore((state) => state.isAuthenticated);
  const linkedEvent = useLinkedEvent(venueId);
  const linkedEventId = linkedEvent.status === "loaded" ? linkedEvent.graph?.event.id ?? null : null;
  const linkedEventName = linkedEvent.status === "loaded" ? linkedEvent.eventName : null;

  const [phase, setPhase] = useState<OpsPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<OpsHandoffPackBundle | null>(null);

  const rigCounts = useLightingRigStore((state) => state.counts);
  const lightingFixtures = useMemo(
    () => Object.values(rigCounts).reduce((sum, n) => sum + n, 0),
    [rigCounts],
  );
  const plan = useMemo(
    () => buildOpsSetupPlan(placedItems, { lightingFixtures }),
    [placedItems, lightingFixtures],
  );
  const canCompile = isSignedIn && configId !== null;
  const compiling = phase === "compiling";

  // The binding belongs to one (event, configuration) pair; a different pair
  // starts from "not attempted" rather than inheriting the last verdict.
  const bindingKey = configId !== null && linkedEventId !== null && isSignedIn
    ? `${linkedEventId}:${configId}`
    : null;
  const [settledBinding, setSettledBinding] = useState<{ readonly key: string; readonly state: EventBinding } | null>(null);
  const binding: EventBinding = settledBinding !== null && settledBinding.key === bindingKey
    ? settledBinding.state
    : BINDING_IDLE;

  // Only an IN-FLIGHT request is shared, so a double press cannot issue two
  // writes. Nothing rejected is ever cached: the next explicit compile retries.
  const inFlightBindingRef = useRef<{ readonly key: string; readonly request: Promise<EventBinding> } | null>(null);
  const attemptBinding = (key: string, eventId: string, configurationId: string): Promise<EventBinding> => {
    const current = inFlightBindingRef.current;
    if (current !== null && current.key === key) return current.request;
    const request = linkEventConfiguration(eventId, { configurationId, linkType: "source_configuration" })
      .then<EventBinding, EventBinding>(() => BINDING_BOUND, (error: unknown) => bindingFailure(error))
      .then((outcome) => {
        if (inFlightBindingRef.current?.key === key) inFlightBindingRef.current = null;
        return outcome;
      });
    inFlightBindingRef.current = { key, request };
    return request;
  };

  const handleCompile = (): void => {
    if (compiling || configId === null) return;
    setPhase("compiling");
    setError(null);
    const eventId = linkedEventId;
    const key = bindingKey;
    const attempt: Promise<EventBinding> = eventId === null || key === null
      ? Promise.resolve(BINDING_IDLE)
      : binding.kind === "bound"
        ? Promise.resolve(BINDING_BOUND)
        : attemptBinding(key, eventId, configId);
    attempt
      .then((outcome) => {
        if (key !== null && eventId !== null) setSettledBinding({ key, state: outcome });
        // An event that could not be bound is left off the compile call: the
        // server would refuse it, and an unbound pack is what this panel
        // produced before the event chain existed.
        return compileOpsHandoffPack(outcome.kind === "bound" && eventId !== null
          ? { configId, eventId }
          : { configId });
      })
      .then((bundle) => { setPack(bundle); setPhase("idle"); })
      .catch((error: unknown) => {
        setError(opsCompilationErrorMessage(error));
        setPhase("error");
      });
  };

  return (
    <LensPanel
      title="Run of show"
      icon={<BriefcaseBusiness size={18} />}
      source="Setup plan"
      testId="ops-lens-panel"
      footer="Setup estimate, not a guaranteed schedule. Confirm crew and timings with operations."
    >
      <LensPanelSection label="Setup plan">
        {plan.tasks.length === 0 ? (
          <p className="lens-panel__hint" data-testid="ops-empty">Add furniture to create a setup plan.</p>
        ) : (
          plan.tasks.map((task) => (
            <div key={task.key} className="lens-panel__cost-line" data-testid={`ops-task-${task.key}`}>
              <span className="lens-panel__cost-line-label">
                {task.label}
                <small>{task.count} to place</small>
              </span>
              <span className="lens-panel__cost-line-amount">{formatSetupDuration(task.effortMinutes)}</span>
            </div>
          ))
        )}
      </LensPanelSection>

      <LensPanelSection label="Effort estimate">
        <LensPanelMetric label="Items to place" value={String(plan.totalItems)} />
        <LensPanelMetric label="Crew effort" value={formatSetupDuration(plan.totalCrewMinutes)} />
        <LensPanelMetric label="Suggested crew" value={plan.suggestedCrew > 0 ? String(plan.suggestedCrew) : "—"} />
        <LensPanelMetric
          label="Est. setup time"
          value={plan.estimatedSetupMinutes > 0 ? `${formatSetupDuration(plan.estimatedSetupMinutes)} · ${String(plan.suggestedCrew)} crew` : "—"}
        />
      </LensPanelSection>

      <LensPanelSection label="Handoff pack">
        {canCompile && linkedEventName !== null && (
          <p
            className={binding.kind === "unbound" ? "lens-panel__note lens-panel__note--warn" : "lens-panel__note"}
            data-testid="ops-event-binding"
          >
            {bindingNote(linkedEventName, binding)}
          </p>
        )}

        {!canCompile && (
          <p className="lens-panel__note lens-panel__note--warn" data-testid="ops-precondition">
            {!isSignedIn
              ? "Sign in as venue staff to compile an ops handoff pack."
              : "Save this layout first to compile an ops handoff pack."}
          </p>
        )}

        {canCompile && (
          <div className="lens-panel__actions">
            <button
              type="button"
              className="lens-panel__button"
              onClick={handleCompile}
              disabled={compiling}
              data-testid="ops-compile"
            >
              {compiling && <ActivityIndicator size={18} />}
              {compiling ? "Compiling…" : pack !== null ? "Recompile handoff pack" : "Compile ops handoff pack"}
            </button>
          </div>
        )}

        {error !== null && (
          <p className="lens-panel__error" role="alert" data-testid="ops-error">{error}</p>
        )}

        {pack !== null && (
          <div className="lens-panel__share-result" data-testid="ops-pack-result">
            <span className="lens-panel__share-result-label">Handoff pack compiled</span>
            <p className="lens-panel__paragraph">{pack.pack.summary}</p>
            <div className="lens-panel__share-buttons">
              <a className="lens-panel__chip-link" href={`/ops/handoff/${pack.pack.id}`} target="_blank" rel="noreferrer" data-testid="ops-pack-open">
                Open pack
              </a>
            </div>
            <p className="lens-panel__note">
              {String(pack.opsTasks.length)} tasks · {String(pack.loadInSequence.length)} load-in steps · status {pack.pack.status.replace(/_/g, " ")}.
            </p>
          </div>
        )}
      </LensPanelSection>
    </LensPanel>
  );
}
