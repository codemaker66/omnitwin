import { useState, type ChangeEvent, type ReactElement } from "react";
import { Anchor } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { useLightingRigStore, importedRigWeightKg } from "../../../stores/lighting-rig-store.js";
import {
  assessRigging,
  RIGGING_PLANNING_DISCLAIMER,
  type LoadKind,
  type PermittedUse,
} from "../../../lib/rigging.js";

// ---------------------------------------------------------------------------
// RiggingLensPanel — indicative suspended-load + bridle calculator (Epic 6).
//
// The planner enters a suspended load, the bridle geometry, and a point's WLL;
// lib/rigging.ts returns per-leg tension, headroom, and safety warnings. SAFE:
// PLANNING ONLY — it does not certify a point or rig, verify dynamic loads, or
// replace a competent rigger / venue rigging authority / structural engineer
// (RIGGING_PLANNING_DISCLAIMER).
// ---------------------------------------------------------------------------

function NumberField({
  label, value, onValue, testId, min, max,
}: {
  readonly label: string;
  readonly value: number;
  readonly onValue: (value: number) => void;
  readonly testId: string;
  readonly min?: number;
  readonly max?: number;
}): ReactElement {
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number.parseInt(event.target.value, 10);
    if (Number.isFinite(parsed)) onValue(parsed);
  };
  return (
    <label className="lens-panel__field lens-panel__field--inline">
      <span className="lens-panel__field-label">{label}</span>
      <input
        className="lens-panel__input"
        type="number"
        inputMode="numeric"
        value={String(value)}
        min={min}
        max={max}
        onChange={onChange}
        data-testid={testId}
        aria-label={label}
      />
    </label>
  );
}

export function RiggingLensPanel(): ReactElement {
  const imported = useLightingRigStore((state) => state.imported);
  const rigWeightKg = Math.round(importedRigWeightKg(imported));
  const [suspendedLoadKg, setSuspendedLoadKg] = useState(200);
  const [bridleLegs, setBridleLegs] = useState<1 | 2>(1);
  const [legAngleFromHorizontalDeg, setLegAngle] = useState(45);
  const [pointWllKg, setPointWllKg] = useState(500);
  const [permittedUse, setPermittedUse] = useState<PermittedUse>("manual-hoist");
  const [loadKind, setLoadKind] = useState<LoadKind>("static");

  const a = assessRigging({ suspendedLoadKg, bridleLegs, legAngleFromHorizontalDeg, pointWllKg, permittedUse, loadKind });

  const meterPct = Math.min(100, Math.max(0, a.utilizationPercent));
  const meterTone = a.utilizationPercent > 100 ? "review" : a.utilizationPercent > 80 ? "attention" : "ok";
  const statusChip = pointWllKg <= 0
    ? { tone: "info", label: "Set a point WLL" }
    : a.withinWll
      ? { tone: "ok", label: "Within WLL" }
      : { tone: "review", label: "Over WLL" };

  return (
    <LensPanel
      eyebrow="Rigging lens"
      title="Rigging & WLL"
      icon={<Anchor size={18} />}
      source="Indicative"
      testId="rigging-lens-panel"
      footer={RIGGING_PLANNING_DISCLAIMER}
    >
      <LensPanelSection label="Suspended load">
        <NumberField label="Suspended load (kg)" value={suspendedLoadKg} onValue={(v) => { setSuspendedLoadKg(Math.max(0, v)); }} testId="rig-load" min={0} />
        <p className="lens-panel__field-hint">Include fixtures, truss, motors, steels and cabling.</p>
        {rigWeightKg > 0 && (
          <button
            type="button"
            className="lens-panel__chip-link"
            onClick={() => { setSuspendedLoadKg(rigWeightKg); }}
            data-testid="rig-use-rig-weight"
          >
            Use rig weight ({String(rigWeightKg)} kg)
          </button>
        )}
        <NumberField label="Point WLL (kg)" value={pointWllKg} onValue={(v) => { setPointWllKg(Math.max(0, v)); }} testId="rig-wll" min={0} />
      </LensPanelSection>

      <LensPanelSection label="Bridle">
        <div className="lens-panel__share-buttons">
          <button type="button" className={bridleLegs === 1 ? "lens-panel__chip-link is-active" : "lens-panel__chip-link"} onClick={() => { setBridleLegs(1); }} data-testid="rig-1leg">Single point</button>
          <button type="button" className={bridleLegs === 2 ? "lens-panel__chip-link is-active" : "lens-panel__chip-link"} onClick={() => { setBridleLegs(2); }} data-testid="rig-2leg">2-leg bridle</button>
        </div>
        {bridleLegs === 2 && (
          <NumberField label="Leg angle from horizontal (°)" value={legAngleFromHorizontalDeg} onValue={(v) => { setLegAngle(Math.max(1, Math.min(90, v))); }} testId="rig-angle" min={1} max={90} />
        )}
      </LensPanelSection>

      <LensPanelSection label="Point rating">
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Point rated for</span>
          <select className="lens-panel__input" value={permittedUse} onChange={(e) => { setPermittedUse(e.target.value as PermittedUse); }} data-testid="rig-permitted" aria-label="Point rated for">
            <option value="static-only">Static only</option>
            <option value="manual-hoist">Manual hoist</option>
            <option value="power-hoist">Power hoist</option>
          </select>
        </label>
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Load kind</span>
          <select className="lens-panel__input" value={loadKind} onChange={(e) => { setLoadKind(e.target.value as LoadKind); }} data-testid="rig-loadkind" aria-label="Load kind">
            <option value="static">Static</option>
            <option value="manual-hoist">Manual hoist</option>
            <option value="power-hoist">Power hoist</option>
          </select>
        </label>
      </LensPanelSection>

      <LensPanelSection label="Assessment">
        <div className="lens-panel__chips">
          <span className={`lens-panel__chip lens-panel__chip--${statusChip.tone}`} data-testid="rig-status">{statusChip.label}</span>
        </div>
        <div className="lens-panel__meter" aria-hidden="true">
          <div className={`lens-panel__meter-fill lens-panel__meter-fill--${meterTone}`} style={{ transform: `scaleX(${String(meterPct / 100)})` }} />
        </div>
        <LensPanelMetric label="Leg tension" value={`${String(Math.round(a.legTensionKg))} kg`} />
        <LensPanelMetric label="Utilisation" value={`${String(a.utilizationPercent)}% of WLL`} />
        <LensPanelMetric label="Headroom" value={`${String(Math.round(a.headroomKg))} kg`} />

        {a.warnings.map((warning) => (
          <div key={warning} className="lens-panel__row lens-panel__row--review" data-testid="rig-warning">
            <div className="lens-panel__row-meta">{warning}</div>
          </div>
        ))}
      </LensPanelSection>
    </LensPanel>
  );
}
