import { useState, type ChangeEvent, type ReactElement } from "react";
import { Anchor } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { NotRecorded } from "./NotRecorded.js";
import { useLightingRigStore, importedRigWeightKg } from "../../../stores/lighting-rig-store.js";
import { usePlannerTruth } from "../../../hooks/use-planner-truth.js";
import {
  assessRigging,
  RIGGING_PLANNING_DISCLAIMER,
  type LoadKind,
  type PermittedUse,
} from "../../../lib/rigging.js";

// ---------------------------------------------------------------------------
// RiggingLensPanel — suspended-load and bridle arithmetic.
//
// The planner enters a suspended load and the bridle geometry; lib/rigging.ts
// returns the leg tension. The rigging point's working load limit and rating
// are building facts, so they start as "Not recorded" with the hallkeeper to
// ask, never as an invented 500 kg. When the planner types a WLL in, the
// panel shows the arithmetic against it and says plainly that it was entered
// here, not checked; it never says "within", only "over" (redteam fix-first 2).
// PLANNING ONLY — RIGGING_PLANNING_DISCLAIMER.
// ---------------------------------------------------------------------------

function NumberField({
  label, value, onValue, testId, min, max, placeholder,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onValue: (value: number | null) => void;
  readonly testId: string;
  readonly min?: number;
  readonly max?: number;
  readonly placeholder?: string;
}): ReactElement {
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.trim();
    if (raw === "") { onValue(null); return; }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) onValue(parsed);
  };
  return (
    <label className="lens-panel__field lens-panel__field--inline">
      <span className="lens-panel__field-label">{label}</span>
      <input
        className="lens-panel__input"
        type="number"
        inputMode="numeric"
        value={value === null ? "" : String(value)}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={onChange}
        data-testid={testId}
        aria-label={label}
      />
    </label>
  );
}

const PERMITTED_USES: ReadonlySet<string> = new Set<PermittedUse>(["static-only", "manual-hoist", "power-hoist"]);
const LOAD_KINDS: ReadonlySet<string> = new Set<LoadKind>(["static", "manual-hoist", "power-hoist"]);

function isPermittedUse(value: string): value is PermittedUse {
  return PERMITTED_USES.has(value);
}

function isLoadKind(value: string): value is LoadKind {
  return LOAD_KINDS.has(value);
}

export function RiggingLensPanel(): ReactElement {
  const imported = useLightingRigStore((state) => state.imported);
  const rigWeightKg = Math.round(importedRigWeightKg(imported));
  const truth = usePlannerTruth();
  const [suspendedLoadKg, setSuspendedLoadKg] = useState<number | null>(null);
  const [bridleLegs, setBridleLegs] = useState<1 | 2>(1);
  const [legAngleFromHorizontalDeg, setLegAngle] = useState(45);
  const [pointWllKg, setPointWllKg] = useState<number | null>(null);
  const [permittedUse, setPermittedUse] = useState<PermittedUse | null>(null);
  const [loadKind, setLoadKind] = useState<LoadKind>("static");

  const a = assessRigging({
    suspendedLoadKg: suspendedLoadKg ?? 0,
    bridleLegs,
    legAngleFromHorizontalDeg,
    pointWllKg,
    permittedUse,
    loadKind,
  });
  const pointAsk = truth.ask("rigging-point");
  const hasLoad = suspendedLoadKg !== null && suspendedLoadKg > 0;
  const pointUnrecorded = a.pointWllKg === null || permittedUse === null;
  const meterPct = a.utilizationPercent === null ? 0 : Math.min(100, Math.max(0, a.utilizationPercent));

  return (
    <LensPanel
      title="Rigging & WLL"
      icon={<Anchor size={18} />}
      source="Arithmetic"
      testId="rigging-lens-panel"
      footer={RIGGING_PLANNING_DISCLAIMER}
    >
      <LensPanelSection label="Suspended load">
        <NumberField
          label="Suspended load (kg)"
          value={suspendedLoadKg}
          onValue={(v) => { setSuspendedLoadKg(v === null ? null : Math.max(0, v)); }}
          testId="rig-load"
          min={0}
          placeholder="Enter kg"
        />
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
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Load kind</span>
          <select
            className="lens-panel__input"
            value={loadKind}
            onChange={(e) => { if (isLoadKind(e.target.value)) setLoadKind(e.target.value); }}
            data-testid="rig-loadkind"
            aria-label="Load kind"
          >
            <option value="static">Static</option>
            <option value="manual-hoist">Manual hoist</option>
            <option value="power-hoist">Power hoist</option>
          </select>
        </label>
      </LensPanelSection>

      <LensPanelSection label="Bridle">
        <div className="lens-panel__share-buttons">
          <button type="button" className={bridleLegs === 1 ? "lens-panel__chip-link is-active" : "lens-panel__chip-link"} onClick={() => { setBridleLegs(1); }} data-testid="rig-1leg">Single point</button>
          <button type="button" className={bridleLegs === 2 ? "lens-panel__chip-link is-active" : "lens-panel__chip-link"} onClick={() => { setBridleLegs(2); }} data-testid="rig-2leg">2-leg bridle</button>
        </div>
        {bridleLegs === 2 && (
          <NumberField
            label="Leg angle from horizontal (°)"
            value={legAngleFromHorizontalDeg}
            onValue={(v) => { setLegAngle(Math.max(1, Math.min(90, v ?? 45))); }}
            testId="rig-angle"
            min={1}
            max={90}
          />
        )}
      </LensPanelSection>

      <LensPanelSection label="Rigging point">
        {pointUnrecorded && (
          <NotRecorded
            label="Point WLL and rating"
            detail="The venue rates its own rigging points. Enter the figures below once you have them."
            ask={pointAsk}
            testId="rig-point-unrecorded"
          />
        )}
        <NumberField
          label="Point WLL (kg)"
          value={pointWllKg}
          onValue={(v) => { setPointWllKg(v === null || v <= 0 ? null : v); }}
          testId="rig-wll"
          min={0}
          placeholder="Not recorded"
        />
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Point rated for</span>
          <select
            className="lens-panel__input"
            value={permittedUse ?? ""}
            onChange={(e) => { setPermittedUse(isPermittedUse(e.target.value) ? e.target.value : null); }}
            data-testid="rig-permitted"
            aria-label="Point rated for"
          >
            <option value="">Not recorded</option>
            <option value="static-only">Static only</option>
            <option value="manual-hoist">Manual hoist</option>
            <option value="power-hoist">Power hoist</option>
          </select>
        </label>
        {(a.pointWllKg !== null || permittedUse !== null) && (
          <p className="lens-panel__entered" data-testid="rig-entered-note">
            Entered here in this plan; not a check of the point.
          </p>
        )}
      </LensPanelSection>

      <LensPanelSection label="Arithmetic">
        {!hasLoad ? (
          <p className="lens-panel__hint" data-testid="rig-empty">Enter the suspended load to work out the leg tension.</p>
        ) : (
          <>
            {a.overWll && (
              <div className="lens-panel__chips">
                <span className="lens-panel__chip lens-panel__chip--review" data-testid="rig-status">Over the WLL entered</span>
              </div>
            )}
            <LensPanelMetric label="Leg tension" value={`${String(Math.round(a.legTensionKg))} kg`} />
            {a.pointWllKg !== null && a.utilizationPercent !== null && a.headroomKg !== null && (
              <>
                <div className="lens-panel__meter" aria-hidden="true">
                  <div
                    className={a.overWll ? "lens-panel__meter-fill lens-panel__meter-fill--review" : "lens-panel__meter-fill"}
                    style={{ transform: `scaleX(${String(meterPct / 100)})` }}
                  />
                </div>
                <LensPanelMetric label="Share of the WLL entered" value={`${String(a.utilizationPercent)}% of ${String(a.pointWllKg)} kg`} />
                <LensPanelMetric label="WLL entered less leg tension" value={`${String(Math.round(a.headroomKg))} kg`} />
              </>
            )}
          </>
        )}

        {a.warnings.map((warning) => (
          <div key={warning} className="lens-panel__row lens-panel__row--review" data-testid="rig-warning">
            <div className="lens-panel__row-meta">{warning}</div>
          </div>
        ))}
        {a.overWll && (pointAsk.href !== null ? (
          <a className="lens-panel__ask" href={pointAsk.href} data-testid="rig-over-ask">{pointAsk.label}</a>
        ) : (
          <span className="lens-panel__unrecorded-hint">{pointAsk.fallback}</span>
        ))}
      </LensPanelSection>
    </LensPanel>
  );
}
