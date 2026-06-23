import { useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { Zap } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { useLightingRigStore } from "../../../stores/lighting-rig-store.js";
import { rigGroupsFromCounts, fixtureWattsFromGroups } from "../../../lib/dmx.js";
import {
  buildDistroPlan,
  supplyLabel,
  DEFAULT_PER_PHASE_BREAKER_A,
  POWER_PLANNING_DISCLAIMER,
} from "../../../lib/power.js";

// ---------------------------------------------------------------------------
// PowerLensPanel — indicative distribution + phase balance (Epic 6 Power lens).
//
// Draws its load from the SAME lighting rig the Lighting lens edits: each
// fixture's watts are distributed across a 1- or 3-phase supply (greedy
// least-loaded), then lib/power.ts reports per-phase current, balance, breaker
// headroom, and a recommended supply. SAFE: indicative planning only — NOT an
// electrical design or certification; a competent electrician must verify before
// energising (POWER_PLANNING_DISCLAIMER).
// ---------------------------------------------------------------------------

function formatWatts(watts: number): string {
  return `${watts.toLocaleString("en-GB")} W`;
}

function phaseTone(amps: number, breakerA: number): string {
  if (amps > breakerA) return "review";
  if (amps > breakerA * 0.8) return "attention";
  return "ok";
}

export function PowerLensPanel(): ReactElement {
  const counts = useLightingRigStore((state) => state.counts);
  const [phaseCount, setPhaseCount] = useState<1 | 3>(3);
  const [breakerA, setBreakerA] = useState<number>(DEFAULT_PER_PHASE_BREAKER_A);

  const plan = useMemo(() => {
    const watts = fixtureWattsFromGroups(rigGroupsFromCounts(counts));
    return buildDistroPlan(watts, { phaseCount, perPhaseBreakerA: breakerA });
  }, [counts, phaseCount, breakerA]);

  const onBreaker = (event: ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number.parseInt(event.target.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) setBreakerA(parsed);
  };

  const empty = plan.totalWatts <= 0;

  return (
    <LensPanel
      eyebrow="Power lens"
      title="Power & distro"
      icon={<Zap size={18} />}
      source="Indicative"
      testId="power-lens-panel"
      footer={POWER_PLANNING_DISCLAIMER}
    >
      <LensPanelSection label="Supply">
        <p className="lens-panel__field-hint">Load comes from the Lighting lens rig.</p>
        <div className="lens-panel__share-buttons">
          <button
            type="button"
            className={phaseCount === 3 ? "lens-panel__chip-link is-active" : "lens-panel__chip-link"}
            onClick={() => { setPhaseCount(3); }}
            data-testid="power-3ph"
          >
            3-phase
          </button>
          <button
            type="button"
            className={phaseCount === 1 ? "lens-panel__chip-link is-active" : "lens-panel__chip-link"}
            onClick={() => { setPhaseCount(1); }}
            data-testid="power-1ph"
          >
            1-phase
          </button>
        </div>
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Breaker per phase (A)</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={1}
            value={String(breakerA)}
            onChange={onBreaker}
            data-testid="power-breaker"
            aria-label="Breaker per phase"
          />
        </label>
      </LensPanelSection>

      <LensPanelSection label="Distribution">
        {empty ? (
          <p className="lens-panel__hint" data-testid="power-empty">Add fixtures in the Lighting lens to plan distribution.</p>
        ) : (
          plan.phases.map((p) => {
            const pct = Math.min(100, Math.round((p.amps / breakerA) * 100));
            return (
              <div key={p.phase} className="lens-panel__field" data-testid={`power-phase-${p.phase}`}>
                <div className="lens-panel__row-head">
                  <span className="lens-panel__field-label">{p.phase}</span>
                  <span className="lens-panel__metric-value">{p.amps.toFixed(1)} A</span>
                </div>
                <div className="lens-panel__meter" aria-hidden="true">
                  <div className={`lens-panel__meter-fill lens-panel__meter-fill--${phaseTone(p.amps, breakerA)}`} style={{ width: `${String(pct)}%` }} />
                </div>
                <span className="lens-panel__field-hint">{formatWatts(p.watts)} · {String(p.fixtures)} fixtures</span>
              </div>
            );
          })
        )}

        {plan.warnings.map((warning) => (
          <div key={warning} className="lens-panel__row lens-panel__row--review" data-testid="power-warning">
            <div className="lens-panel__row-meta">{warning}</div>
          </div>
        ))}
      </LensPanelSection>

      <LensPanelSection label="Summary">
        <LensPanelMetric label="Total load" value={formatWatts(plan.totalWatts)} />
        <LensPanelMetric label="Apparent power" value={`${plan.totalKva.toFixed(1)} kVA`} />
        <LensPanelMetric label="Phase imbalance" value={`${String(plan.imbalancePercent)}%`} />
        <LensPanelMetric label="Recommended supply" value={supplyLabel(plan)} />
      </LensPanelSection>
    </LensPanel>
  );
}
