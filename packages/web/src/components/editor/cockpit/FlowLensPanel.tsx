import { type ChangeEvent, type ReactElement } from "react";
import { Waypoints } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { useCockpitReplay } from "../../../hooks/use-cockpit-replay.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { buildFlowPanelModel, type FlowConflictSeverity } from "../../../lib/cockpit-flow-panel-model.js";
import { DEFAULT_ASSUMED_GUEST_COUNT, MAX_GUEST_FLOW_AGENTS } from "../../../lib/guest-flow-layout-input.js";

// ---------------------------------------------------------------------------
// FlowLensPanel — the first real lens panel (Epic 0's reference tool).
//
// Surfaces the LIVE guest-flow simulation for the current layout: editable
// scenario controls (guest count + arrival window) that re-simulate on change,
// then summary metrics, route conflicts, queue zones, and the assumptions trail
// — all from the same artifact the in-scene overlays draw. Claim-safe: simulated
// planning support only, never a measured or certified route.
// ---------------------------------------------------------------------------

const SOURCE_BY_STATUS: Readonly<Record<string, string>> = {
  idle: "Idle",
  loading: "Simulating…",
  ready: "Simulated",
  error: "Unavailable",
};

const SEVERITY_ORDER: readonly FlowConflictSeverity[] = ["review", "attention", "info"];
const MAX_ARRIVAL_MINUTES = 600;

export function FlowLensPanel(): ReactElement {
  const { artifact, status } = useCockpitReplay(true);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const setPlannedGuestCount = useCockpitStore((state) => state.setPlannedGuestCount);
  const arrivalMinutes = useCockpitStore((state) => state.flowArrivalMinutes);
  const setFlowArrivalMinutes = useCockpitStore((state) => state.setFlowArrivalMinutes);

  const model = artifact !== null ? buildFlowPanelModel(artifact) : null;

  const onGuestCount = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.trim();
    if (raw === "") {
      setPlannedGuestCount(null);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    setPlannedGuestCount(Math.max(1, Math.min(MAX_GUEST_FLOW_AGENTS, parsed)));
  };

  const onArrivalMinutes = (event: ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number.parseInt(event.target.value, 10);
    if (!Number.isFinite(parsed)) return;
    setFlowArrivalMinutes(Math.max(1, Math.min(MAX_ARRIVAL_MINUTES, parsed)));
  };

  return (
    <LensPanel
      eyebrow="Flow lens"
      title="Guest flow"
      icon={<Waypoints size={18} />}
      source={SOURCE_BY_STATUS[status]}
      testId="flow-lens-panel"
      footer="Simulated planning support · human review required before operational reliance."
    >
      <LensPanelSection label="Scenario">
        <label className="lens-panel__field">
          <span className="lens-panel__field-label">Guest count</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GUEST_FLOW_AGENTS}
            value={plannedGuestCount === null ? "" : String(plannedGuestCount)}
            placeholder={`Auto (${String(DEFAULT_ASSUMED_GUEST_COUNT)})`}
            onChange={onGuestCount}
            data-testid="flow-guest-count"
          />
          <span className="lens-panel__field-hint">Drives the simulated agent count. Leave blank to assume a default.</span>
        </label>
        <label className="lens-panel__field">
          <span className="lens-panel__field-label">Arrival window (min)</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ARRIVAL_MINUTES}
            value={String(arrivalMinutes)}
            onChange={onArrivalMinutes}
            data-testid="flow-arrival-minutes"
          />
        </label>
      </LensPanelSection>

      {model !== null && (
        <>
          <LensPanelSection label="Flow summary">
            {model.summary.map((row) => (
              <LensPanelMetric key={row.key} label={row.label} value={row.value} />
            ))}
          </LensPanelSection>

          <LensPanelSection label="Bottlenecks & conflicts">
            <div className="lens-panel__chips">
              {SEVERITY_ORDER.map((severity) => (
                <span key={severity} className={`lens-panel__chip lens-panel__chip--${severity}`}>
                  <strong>{model.conflictCounts[severity]}</strong> {severity}
                </span>
              ))}
            </div>
            {model.conflicts.slice(0, 5).map((conflict) => (
              <div key={conflict.key} className={`lens-panel__row lens-panel__row--${conflict.severity}`}>
                <span className="lens-panel__row-title">{conflict.message}</span>
              </div>
            ))}
            {model.conflicts.length === 0 && (
              <p className="lens-panel__hint">No simulated route conflicts at this layout and guest count.</p>
            )}
          </LensPanelSection>

          {model.queues.length > 0 && (
            <LensPanelSection label="Queues">
              {model.queues.map((queue) => (
                <div key={queue.key} className="lens-panel__row lens-panel__row--info">
                  <span className="lens-panel__row-title">{queue.label}</span>
                  <span className="lens-panel__row-meta">
                    {queue.agents.toLocaleString("en-GB")} agents · ~{queue.waitLabel} wait
                  </span>
                </div>
              ))}
            </LensPanelSection>
          )}

          <LensPanelSection label="Assumptions">
            {model.assumptions.map((assumption) => (
              <div key={assumption.key} className="lens-panel__assumption">
                <span className="lens-panel__assumption-label">{assumption.label}</span>
                <span className="lens-panel__assumption-value">{assumption.value}</span>
                <span className="lens-panel__assumption-source">{assumption.source}</span>
              </div>
            ))}
          </LensPanelSection>
        </>
      )}

      {model === null && status === "loading" && (
        <p className="lens-panel__hint">Simulating guest flow from the current layout…</p>
      )}
      {status === "error" && (
        <p className="lens-panel__hint">Could not simulate guest flow. Adjust the layout and try again.</p>
      )}
    </LensPanel>
  );
}
