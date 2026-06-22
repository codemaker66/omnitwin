import { useMemo, type ChangeEvent, type ReactElement } from "react";
import { Lightbulb } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { useLightingRigStore } from "../../../stores/lighting-rig-store.js";
import { LIGHTING_FIXTURE_FAMILIES, type LightingFixtureFamily } from "../../../lib/photometrics.js";
import {
  buildDmxPatch,
  estimateRigPower,
  rigGroupsFromCounts,
  fixtureFamilyLabel,
  FIXTURE_FAMILY_DMX_CHANNELS,
  DMX_UNIVERSE_SIZE,
  DMX_PLANNING_DISCLAIMER,
} from "../../../lib/dmx.js";

// ---------------------------------------------------------------------------
// LightingLensPanel — rig → DMX patch + power (Epic 6 Lighting lens, first slice).
//
// The catalogue has no placeable lighting fixtures yet, so the planner specs the
// rig here (fixture family × count) — how a lighting designer blocks out a rig
// before fixtures are hung. lib/dmx.ts patches it onto 512-channel universes and
// estimates single-phase load. SAFE: indicative planning only — NOT console
// programming, cue data, or electrical certification (see DMX_PLANNING_DISCLAIMER).
// ---------------------------------------------------------------------------

/** An editable count field for one fixture family. */
function RigField({
  family, count, onCount,
}: {
  readonly family: LightingFixtureFamily;
  readonly count: number;
  readonly onCount: (family: LightingFixtureFamily, value: string) => void;
}): ReactElement {
  const onChange = (event: ChangeEvent<HTMLInputElement>): void => { onCount(family, event.target.value); };
  const label = fixtureFamilyLabel(family);
  return (
    <label className="lens-panel__field lens-panel__field--inline">
      <span className="lens-panel__field-label">{label} · {String(FIXTURE_FAMILY_DMX_CHANNELS[family])} ch</span>
      <input
        className="lens-panel__input"
        type="number"
        inputMode="numeric"
        min={0}
        value={count === 0 ? "" : String(count)}
        placeholder="0"
        onChange={onChange}
        data-testid={`rig-${family}`}
        aria-label={label}
      />
    </label>
  );
}

function formatWatts(watts: number): string {
  return `${watts.toLocaleString("en-GB")} W`;
}

export function LightingLensPanel(): ReactElement {
  const counts = useLightingRigStore((state) => state.counts);
  const setCount = useLightingRigStore((state) => state.setCount);
  const clear = useLightingRigStore((state) => state.clear);
  const reset = useLightingRigStore((state) => state.reset);

  const { patch, power } = useMemo(() => {
    const groups = rigGroupsFromCounts(counts);
    return { patch: buildDmxPatch(groups), power: estimateRigPower(groups) };
  }, [counts]);

  const onCount = (family: LightingFixtureFamily, raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === "") { setCount(family, 0); return; }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) setCount(family, Math.max(0, parsed));
  };

  return (
    <LensPanel
      eyebrow="Lighting lens"
      title="Lighting & DMX"
      icon={<Lightbulb size={18} />}
      source="Indicative"
      testId="lighting-lens-panel"
      footer={DMX_PLANNING_DISCLAIMER}
    >
      <LensPanelSection label="Rig (editable)">
        <p className="lens-panel__field-hint">Starter rig — set the fixtures in your design. Channel footprints are indicative per family.</p>
        {LIGHTING_FIXTURE_FAMILIES.map((family) => (
          <RigField key={family} family={family} count={counts[family]} onCount={onCount} />
        ))}
        <div className="lens-panel__share-buttons">
          <button type="button" className="lens-panel__chip-link" onClick={() => { reset(); }} data-testid="rig-reset">Reset starter</button>
          <button type="button" className="lens-panel__chip-link" onClick={() => { clear(); }} data-testid="rig-clear">Clear</button>
        </div>
      </LensPanelSection>

      <LensPanelSection label="DMX patch">
        <LensPanelMetric label="Fixtures" value={String(patch.totalFixtures)} />
        <LensPanelMetric label="DMX channels" value={patch.totalChannels.toLocaleString("en-GB")} />
        <LensPanelMetric label="Universes" value={String(patch.universeCount)} />
        {patch.universeCount === 0 ? (
          <p className="lens-panel__hint" data-testid="dmx-empty">Add fixtures to the rig to build a patch.</p>
        ) : (
          patch.universes.map((u) => {
            const pct = Math.min(100, Math.round((u.channelsUsed / DMX_UNIVERSE_SIZE) * 100));
            return (
              <div key={u.universe} className="lens-panel__field" data-testid={`dmx-universe-${String(u.universe)}`}>
                <div className="lens-panel__row-head">
                  <span className="lens-panel__field-label">Universe {String(u.universe)}</span>
                  <span className="lens-panel__metric-value">{String(u.channelsUsed)} / {String(DMX_UNIVERSE_SIZE)} ch</span>
                </div>
                <div className="lens-panel__meter" aria-hidden="true">
                  <div className="lens-panel__meter-fill lens-panel__meter-fill--ok" style={{ width: `${String(pct)}%` }} />
                </div>
                <span className="lens-panel__field-hint">{String(u.fixtures.length)} fixtures · {String(u.channelsFree)} ch free</span>
              </div>
            );
          })
        )}
      </LensPanelSection>

      <LensPanelSection label="Power (indicative)">
        <LensPanelMetric label="Total load" value={formatWatts(power.totalWatts)} />
        <LensPanelMetric label="Single-phase" value={`${power.amps.toFixed(1)} A @ ${String(power.voltage)} V`} />
        <LensPanelMetric label="Power factor" value={power.powerFactor.toFixed(2)} />
      </LensPanelSection>
    </LensPanel>
  );
}
