import { useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { Lightbulb } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { useLightingRigStore, rigGroupsForRig, fixtureDisplayLabel } from "../../../stores/lighting-rig-store.js";
import { LIGHTING_FIXTURE_FAMILIES, type LightingFixtureFamily } from "../../../lib/photometrics.js";
import { parseGdtfDescription, gdtfFixtureFamily, GDTF_IMPORT_DISCLAIMER } from "../../../lib/gdtf.js";
import {
  buildDmxPatch,
  estimateRigPower,
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

/** Paste a GDTF description → parse → pick a mode/family → add the real fixture. */
function GdtfImportSection(): ReactElement {
  const addImportedFixture = useLightingRigStore((state) => state.addImportedFixture);
  const [xml, setXml] = useState("");
  const [modeIndex, setModeIndex] = useState(0);
  const [familyOverride, setFamilyOverride] = useState<LightingFixtureFamily | "">("");

  const parse = useMemo(() => (xml.trim() === "" ? null : parseGdtfDescription(xml)), [xml]);
  const fixture = parse !== null && parse.ok ? parse.fixture : null;
  const mappedFamily = fixture !== null ? gdtfFixtureFamily(fixture) : null;
  const family: LightingFixtureFamily = familyOverride !== "" ? familyOverride : (mappedFamily ?? "par");
  const mode = fixture !== null && fixture.modes.length > 0
    ? fixture.modes[Math.min(modeIndex, fixture.modes.length - 1)] ?? null
    : null;
  const canAdd = fixture !== null && mode !== null && mode.channelFootprint > 0;

  const onXml = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setXml(event.target.value);
    setModeIndex(0);
    setFamilyOverride("");
  };

  const onAdd = (): void => {
    if (fixture === null || mode === null) return;
    addImportedFixture({
      manufacturer: fixture.manufacturer,
      name: fixture.name,
      family,
      channels: mode.channelFootprint,
      weightKg: fixture.physical.weightKg,
      modeName: mode.name,
    });
    setXml("");
    setModeIndex(0);
    setFamilyOverride("");
  };

  return (
    <LensPanelSection label="Import a fixture (GDTF)">
      <p className="lens-panel__field-hint">Paste a fixture&apos;s GDTF description.xml to use its real DMX footprint.</p>
      <textarea
        className="lens-panel__input lens-panel__input--area"
        value={xml}
        placeholder="Paste GDTF description XML…"
        onChange={onXml}
        data-testid="gdtf-xml"
        aria-label="GDTF description XML"
        spellCheck={false}
      />
      {parse !== null && !parse.ok && (
        <p className="lens-panel__error" data-testid="gdtf-error">{parse.error}</p>
      )}
      {fixture !== null && (
        <>
          <p className="lens-panel__paragraph" data-testid="gdtf-name">{fixture.manufacturer} — {fixture.name}</p>
          {fixture.modes.length > 0 && (
            <label className="lens-panel__field lens-panel__field--inline">
              <span className="lens-panel__field-label">DMX mode</span>
              <select
                className="lens-panel__input"
                value={String(modeIndex)}
                onChange={(event) => { setModeIndex(Number.parseInt(event.target.value, 10) || 0); }}
                data-testid="gdtf-mode"
                aria-label="DMX mode"
              >
                {fixture.modes.map((m, i) => (
                  <option key={`${m.name}-${String(i)}`} value={String(i)}>{m.name} · {String(m.channelFootprint)} ch</option>
                ))}
              </select>
            </label>
          )}
          <label className="lens-panel__field lens-panel__field--inline">
            <span className="lens-panel__field-label">Family{mappedFamily !== null && familyOverride === "" ? " · auto" : ""}</span>
            <select
              className="lens-panel__input"
              value={family}
              onChange={(event) => { setFamilyOverride(event.target.value as LightingFixtureFamily); }}
              data-testid="gdtf-family"
              aria-label="Fixture family"
            >
              {LIGHTING_FIXTURE_FAMILIES.map((fam) => (
                <option key={fam} value={fam}>{fixtureFamilyLabel(fam)}</option>
              ))}
            </select>
          </label>
          {fixture.physical.weightKg !== null && (
            <p className="lens-panel__field-hint" data-testid="gdtf-weight">Weight {String(fixture.physical.weightKg)} kg — feeds the Rigging lens.</p>
          )}
          <button type="button" className="lens-panel__button" onClick={onAdd} disabled={!canAdd} data-testid="gdtf-add">Add to rig</button>
          <p className="lens-panel__note">{GDTF_IMPORT_DISCLAIMER}</p>
        </>
      )}
    </LensPanelSection>
  );
}

/** The fixtures imported into the rig, with editable counts. */
function ImportedFixtureList(): ReactElement | null {
  const imported = useLightingRigStore((state) => state.imported);
  const setImportedCount = useLightingRigStore((state) => state.setImportedCount);
  const removeImportedFixture = useLightingRigStore((state) => state.removeImportedFixture);
  if (imported.length === 0) return null;
  return (
    <LensPanelSection label="Imported fixtures">
      {imported.map((f) => (
        <div key={f.id} className="lens-panel__cost-line" data-testid={`imported-${f.id}`}>
          <div className="lens-panel__cost-line-label">
            {fixtureDisplayLabel(f.manufacturer, f.name)}
            <small>{String(f.channels)} ch · {f.modeName} · {fixtureFamilyLabel(f.family)}</small>
          </div>
          <div className="lens-panel__imported-controls">
            <input
              className="lens-panel__input"
              type="number"
              inputMode="numeric"
              min={1}
              value={String(f.count)}
              onChange={(event) => {
                const n = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(n)) setImportedCount(f.id, Math.max(0, n));
              }}
              data-testid={`imported-count-${f.id}`}
              aria-label={`${f.manufacturer} ${f.name} count`}
            />
            <button
              type="button"
              className="lens-panel__chip-link"
              onClick={() => { removeImportedFixture(f.id); }}
              data-testid={`imported-remove-${f.id}`}
              aria-label={`Remove ${f.name}`}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </LensPanelSection>
  );
}

export function LightingLensPanel(): ReactElement {
  const counts = useLightingRigStore((state) => state.counts);
  const imported = useLightingRigStore((state) => state.imported);
  const setCount = useLightingRigStore((state) => state.setCount);
  const clear = useLightingRigStore((state) => state.clear);
  const reset = useLightingRigStore((state) => state.reset);

  const { patch, power } = useMemo(() => {
    const groups = rigGroupsForRig(counts, imported);
    return { patch: buildDmxPatch(groups), power: estimateRigPower(groups) };
  }, [counts, imported]);

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

      <GdtfImportSection />
      <ImportedFixtureList />

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
