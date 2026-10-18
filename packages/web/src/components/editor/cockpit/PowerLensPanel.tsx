import { useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { Zap } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { NotRecorded } from "./NotRecorded.js";
import { useLightingRigStore, rigGroupsForRig } from "../../../stores/lighting-rig-store.js";
import { usePlannerTruth } from "../../../hooks/use-planner-truth.js";
import { fixtureWattsFromGroups } from "../../../lib/dmx.js";
import {
  buildDistroPlan,
  supplyLabel,
  circuitSummaryLabel,
  DEFAULT_CIRCUIT_BREAKER_A,
  POWER_PLANNING_DISCLAIMER,
} from "../../../lib/power.js";

// ---------------------------------------------------------------------------
// PowerLensPanel — indicative distribution + phase balance (Epic 6 Power lens).
//
// Draws its load from the SAME lighting rig the Lighting lens edits (which
// starts empty: nobody's fixtures are assumed): each fixture's watts are
// distributed across a 1- or 3-phase supply (greedy least-loaded), then
// lib/power.ts reports per-phase current, balance and a recommended feeder.
// The venue supply's breaker per phase is a building fact, so it starts as
// "Not recorded" with the hallkeeper to ask; until someone enters it, no phase
// is said to be over or under anything, and nothing is coloured as fine
// (redteam fix-first 2). Indicative planning only (POWER_PLANNING_DISCLAIMER).
// ---------------------------------------------------------------------------

function formatWatts(watts: number): string {
  return `${watts.toLocaleString("en-GB")} W`;
}

type LoadTone = "" | "attention" | "review";

/** A load's tone against an entered rating: no tone below 80 % (no green
 *  "fine" for a rating nobody checked), sage near it, review over it. */
function loadTone(utilisationPercent: number): LoadTone {
  if (utilisationPercent > 100) return "review";
  if (utilisationPercent > 80) return "attention";
  return "";
}

function toneClass(base: string, tone: LoadTone): string {
  return tone === "" ? base : `${base} ${base}--${tone}`;
}

export function PowerLensPanel(): ReactElement {
  const counts = useLightingRigStore((state) => state.counts);
  const imported = useLightingRigStore((state) => state.imported);
  const truth = usePlannerTruth();
  const [phaseCount, setPhaseCount] = useState<1 | 3>(3);
  const [breakerA, setBreakerA] = useState<number | null>(null);
  const [circuitA, setCircuitA] = useState<number>(DEFAULT_CIRCUIT_BREAKER_A);

  const plan = useMemo(() => {
    const watts = fixtureWattsFromGroups(rigGroupsForRig(counts, imported));
    return buildDistroPlan(watts, { phaseCount, perPhaseBreakerA: breakerA, circuitBreakerA: circuitA });
  }, [counts, imported, phaseCount, breakerA, circuitA]);

  const onBreaker = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.trim();
    if (raw === "") { setBreakerA(null); return; }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) setBreakerA(parsed);
  };

  const onCircuit = (event: ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number.parseInt(event.target.value, 10);
    if (Number.isFinite(parsed) && parsed > 0) setCircuitA(parsed);
  };

  const empty = plan.totalWatts <= 0;

  return (
    <LensPanel
      title="Power & distro"
      icon={<Zap size={18} />}
      source="Indicative"
      testId="power-lens-panel"
      footer={POWER_PLANNING_DISCLAIMER}
    >
      <LensPanelSection label="Supply">
        <p className="lens-panel__field-hint">Load from the Lighting rig.</p>
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
        {breakerA === null && (
          <NotRecorded
            label="Venue supply"
            detail="The breaker on each phase of the room's supply. Enter it below once you have it."
            ask={truth.ask("power-supply")}
            testId="power-supply-unrecorded"
          />
        )}
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Breaker per phase (A)</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={1}
            value={breakerA === null ? "" : String(breakerA)}
            placeholder="Not recorded"
            onChange={onBreaker}
            data-testid="power-breaker"
            aria-label="Breaker per phase"
          />
        </label>
        {breakerA !== null && (
          <p className="lens-panel__entered" data-testid="power-breaker-entered">Entered here in this plan; not a check of the supply.</p>
        )}
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Circuit way (A)</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={1}
            value={String(circuitA)}
            onChange={onCircuit}
            data-testid="power-circuit"
            aria-label="Circuit way rating"
          />
        </label>
        <p className="lens-panel__field-hint">Fixtures are packed onto ways of this rating; set it to match your distro.</p>
      </LensPanelSection>

      <LensPanelSection label="Distribution">
        {empty ? (
          <p className="lens-panel__hint" data-testid="power-empty">Add fixtures in Lighting.</p>
        ) : (
          plan.phases.map((p) => {
            const pct = breakerA === null ? 0 : Math.min(100, Math.round((p.amps / breakerA) * 100));
            const tone = breakerA === null ? "" : loadTone((p.amps / breakerA) * 100);
            return (
              <div key={p.phase} className="lens-panel__field" data-testid={`power-phase-${p.phase}`}>
                <div className="lens-panel__row-head">
                  <span className="lens-panel__field-label">{p.phase}</span>
                  <span className="lens-panel__metric-value">{p.amps.toFixed(1)} A</span>
                </div>
                {breakerA !== null && (
                  <div className="lens-panel__meter" aria-hidden="true">
                    <div className={toneClass("lens-panel__meter-fill", tone)} style={{ transform: `scaleX(${String(pct / 100)})` }} />
                  </div>
                )}
                <span className="lens-panel__field-hint">
                  {formatWatts(p.watts)} · {String(p.fixtures)} fixtures · {String(p.circuits.length)} {p.circuits.length === 1 ? "way" : "ways"}
                </span>
                {p.circuits.length > 0 && (
                  <div className="lens-panel__circuits" data-testid={`power-circuits-${p.phase}`}>
                    {p.circuits.map((c) => (
                      <div key={c.id} className="lens-panel__circuit">
                        <span className="lens-panel__circuit-id">{c.id}</span>
                        <span className="lens-panel__circuit-bar" aria-hidden="true">
                          <span
                            className={toneClass("lens-panel__circuit-fill", loadTone(c.utilisationPercent))}
                            style={{ transform: `scaleX(${String(Math.min(100, c.utilisationPercent) / 100)})` }}
                          />
                        </span>
                        <span className="lens-panel__circuit-load">{c.amps.toFixed(1)} A · {String(c.fixtures)}</span>
                      </div>
                    ))}
                  </div>
                )}
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
        <LensPanelMetric label="Distro ways" value={circuitSummaryLabel(plan)} />
        <LensPanelMetric label="Feeder for this load" value={supplyLabel(plan)} />
      </LensPanelSection>
    </LensPanel>
  );
}
