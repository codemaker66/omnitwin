import { useState, type ChangeEvent, type ReactElement } from "react";
import { Volume2 } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { AV_PLANNING_DISCLAIMER, coverageWidthM, splAtDistanceDb } from "../../../lib/av-spl.js";

// ---------------------------------------------------------------------------
// AVLensPanel — indicative speaker coverage and speech over ambient (Epic 6).
//
// Every input starts empty: a speaker's rating, the throw and the room's
// ambient noise are facts somebody has to state, so the panel never works from
// a default (it once said "Clear speech" for a 127 dB speaker and a 70 dB room
// the visitor never entered). Each missing figure is shown as "Not recorded"
// with where it comes from. lib/av-spl.ts does the arithmetic only on figures
// the person entered, and the panel states the result without a verdict word:
// no "clear", no "good". It speaks only when a result falls short of a figure
// the person entered, as the Rigging lens does (redteam fix-first 2).
// SAFE: indicative only (AV_PLANNING_DISCLAIMER).
// ---------------------------------------------------------------------------

function NumberField({
  label, value, onValue, testId, min, max,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onValue: (value: number | null) => void;
  readonly testId: string;
  readonly min?: number;
  readonly max?: number;
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
        placeholder="Not recorded"
        onChange={onChange}
        data-testid={testId}
        aria-label={label}
      />
    </label>
  );
}

interface MissingFigure {
  readonly key: string;
  readonly label: string;
  readonly source: string;
}

function clampOrNull(value: number | null, min: number, max: number): number | null {
  return value === null ? null : Math.max(min, Math.min(max, value));
}

function decibels(value: number): string {
  return `${String(Math.round(value))} dB`;
}

export function AVLensPanel(): ReactElement {
  const [maxSplAt1mDb, setMaxSpl] = useState<number | null>(null);
  const [coverageAngleDeg, setCoverageAngle] = useState<number | null>(null);
  const [listenerDistanceM, setListenerDistance] = useState<number | null>(null);
  const [ambientDb, setAmbient] = useState<number | null>(null);
  const [targetSnrDb, setTargetSnr] = useState<number | null>(null);

  const missing: MissingFigure[] = [];
  if (maxSplAt1mDb === null) missing.push({ key: "spl", label: "Speaker maximum SPL at 1 m", source: "On the speaker's specification sheet." });
  if (coverageAngleDeg === null) missing.push({ key: "angle", label: "Coverage angle", source: "On the speaker's specification sheet." });
  if (listenerDistanceM === null) missing.push({ key: "distance", label: "Listener distance", source: "Measure on the plan, from the speaker to the furthest seat." });
  if (ambientDb === null) missing.push({ key: "ambient", label: "Ambient noise in the room", source: "A sound level reading in the room, or ask your audio supplier." });

  const splAtListener = maxSplAt1mDb !== null && listenerDistanceM !== null
    ? splAtDistanceDb(maxSplAt1mDb, listenerDistanceM)
    : null;
  const width = coverageAngleDeg !== null && listenerDistanceM !== null
    ? coverageWidthM(listenerDistanceM, coverageAngleDeg)
    : null;
  const speechOverAmbient = splAtListener !== null && ambientDb !== null ? splAtListener - ambientDb : null;
  const belowAmbient = speechOverAmbient !== null && speechOverAmbient <= 0;
  const shortOfTarget = speechOverAmbient !== null && targetSnrDb !== null && speechOverAmbient < targetSnrDb
    ? targetSnrDb - speechOverAmbient
    : null;
  const entered = maxSplAt1mDb !== null || coverageAngleDeg !== null || listenerDistanceM !== null
    || ambientDb !== null || targetSnrDb !== null;
  const nothingToShow = splAtListener === null && width === null;

  return (
    <LensPanel
      title="AV & coverage"
      icon={<Volume2 size={18} />}
      source="Arithmetic"
      testId="av-lens-panel"
      footer={AV_PLANNING_DISCLAIMER}
    >
      <LensPanelSection label="Speaker">
        <NumberField label="Max SPL @ 1 m (dB)" value={maxSplAt1mDb} onValue={(v) => { setMaxSpl(clampOrNull(v, 0, 200)); }} testId="av-spl" min={0} />
        <NumberField label="Coverage angle (°)" value={coverageAngleDeg} onValue={(v) => { setCoverageAngle(clampOrNull(v, 1, 179)); }} testId="av-angle" min={1} max={179} />
      </LensPanelSection>

      <LensPanelSection label="Room">
        <NumberField label="Listener distance (m)" value={listenerDistanceM} onValue={(v) => { setListenerDistance(clampOrNull(v, 1, 500)); }} testId="av-distance" min={1} />
        <NumberField label="Ambient noise (dB)" value={ambientDb} onValue={(v) => { setAmbient(clampOrNull(v, 0, 200)); }} testId="av-ambient" min={0} />
        <NumberField label="Target over ambient (dB)" value={targetSnrDb} onValue={(v) => { setTargetSnr(clampOrNull(v, 0, 100)); }} testId="av-target" min={0} />
        {entered && (
          <p className="lens-panel__entered" data-testid="av-entered-note">
            Entered here in this plan; not a measurement of the room.
          </p>
        )}
      </LensPanelSection>

      <LensPanelSection label="Coverage & speech">
        {missing.map((figure) => (
          <div key={figure.key} className="lens-panel__unrecorded" data-testid={`av-unrecorded-${figure.key}`}>
            <div className="lens-panel__unrecorded-head">
              <span className="lens-panel__unrecorded-label">{figure.label}</span>
              <span className="lens-panel__unrecorded-value">Not recorded</span>
            </div>
            <span className="lens-panel__unrecorded-hint">{figure.source}</span>
          </div>
        ))}

        {(belowAmbient || shortOfTarget !== null) && (
          <div className="lens-panel__chips">
            <span className="lens-panel__chip lens-panel__chip--review" data-testid="av-status">
              {belowAmbient ? "Below the ambient noise entered" : "Short of the target entered"}
            </span>
          </div>
        )}
        {splAtListener !== null && <LensPanelMetric label="SPL at listener" value={decibels(splAtListener)} />}
        {width !== null && listenerDistanceM !== null && (
          <LensPanelMetric label="Coverage width" value={`${width.toFixed(1)} m at ${String(listenerDistanceM)} m`} />
        )}
        {speechOverAmbient !== null && (
          <LensPanelMetric
            label="Speech over ambient"
            value={speechOverAmbient >= 0 ? `${decibels(speechOverAmbient)} over ambient` : `${decibels(-speechOverAmbient)} under ambient`}
          />
        )}
        {targetSnrDb !== null && <LensPanelMetric label="Target entered" value={`+${String(targetSnrDb)} dB over ambient`} />}
        {shortOfTarget !== null && <LensPanelMetric label="Short of the target by" value={decibels(shortOfTarget)} />}
        {nothingToShow && (
          <p className="lens-panel__hint" data-testid="av-empty">Enter the speaker's figures and the listener distance to work out the level and the coverage.</p>
        )}
      </LensPanelSection>
    </LensPanel>
  );
}
