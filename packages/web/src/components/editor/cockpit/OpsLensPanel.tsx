import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
// show and reports a missing handoff. Two things make that work: the corridor
// records the event↔configuration link the Ops compiler requires, and the
// compile call passes the eventId. The link request is idempotent server-side
// and is awaited before compiling, so opening the lens twice writes one row and
// an immediate compile never races the binding. Roles without event-write
// permission simply fail to bind and get the server's actionable
// EVENT_CONFIGURATION_BINDING_REQUIRED message instead of a silent no-op.
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

  // One in-flight binding per (event, configuration) pair. Keeping the promise
  // rather than a boolean lets the compile await the same request the corridor
  // already started instead of firing a second one.
  const bindingRef = useRef<{ readonly key: string; readonly request: Promise<void> } | null>(null);
  const ensureEventBinding = useCallback((): Promise<void> => {
    if (configId === null || linkedEventId === null || !isSignedIn) return Promise.resolve();
    const key = `${linkedEventId}:${configId}`;
    const current = bindingRef.current;
    if (current !== null && current.key === key) return current.request;
    // A failed binding is not retried on every render; the compile surfaces the
    // server's own reason, which is more useful than a silent retry loop.
    const request = linkEventConfiguration(linkedEventId, {
      configurationId: configId,
      linkType: "source_configuration",
    }).then(() => undefined, () => undefined);
    bindingRef.current = { key, request };
    return request;
  }, [configId, isSignedIn, linkedEventId]);

  useEffect(() => { void ensureEventBinding(); }, [ensureEventBinding]);

  const handleCompile = (): void => {
    if (compiling || configId === null) return;
    setPhase("compiling");
    setError(null);
    const eventId = linkedEventId;
    ensureEventBinding()
      .then(() => compileOpsHandoffPack(eventId === null ? { configId } : { configId, eventId }))
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
          <p className="lens-panel__note" data-testid="ops-event-binding">
            This pack will be attached to {linkedEventName}, so it reaches the event day board.
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
