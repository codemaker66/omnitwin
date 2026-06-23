import { useState, type ChangeEvent, type ReactElement } from "react";
import { Volume2 } from "lucide-react";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import {
  buildAvCoverage,
  AV_PLANNING_DISCLAIMER,
  DEFAULT_SPEECH_SNR_TARGET_DB,
  type SnrStatus,
} from "../../../lib/av-spl.js";

// ---------------------------------------------------------------------------
// AVLensPanel — indicative speaker coverage + speech-SNR (Epic 6 AV lens).
//
// The planner enters a speaker rating + room geometry + ambient noise;
// lib/av-spl.ts returns SPL at the listener, the coverage width there, and the
// speech SNR over ambient. SAFE: indicative only — real directivity and room
// acoustics vary; final voicing is set on-site (AV_PLANNING_DISCLAIMER).
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
      <input className="lens-panel__input" type="number" inputMode="numeric" value={String(value)} min={min} max={max} onChange={onChange} data-testid={testId} aria-label={label} />
    </label>
  );
}

const STATUS: Record<SnrStatus, { readonly tone: string; readonly label: string }> = {
  good: { tone: "ok", label: "Clear speech" },
  marginal: { tone: "attention", label: "Marginal" },
  poor: { tone: "review", label: "Below ambient" },
};

export function AVLensPanel(): ReactElement {
  const [maxSplAt1mDb, setMaxSpl] = useState(127);
  const [coverageAngleDeg, setCoverageAngle] = useState(90);
  const [listenerDistanceM, setListenerDistance] = useState(12);
  const [ambientDb, setAmbient] = useState(70);
  const [targetSnrDb, setTargetSnr] = useState(DEFAULT_SPEECH_SNR_TARGET_DB);

  const c = buildAvCoverage({ maxSplAt1mDb, coverageAngleDeg, listenerDistanceM, ambientDb, targetSnrDb });
  const status = STATUS[c.snrStatus];
  const meterPct = Math.min(100, Math.max(0, Math.round((c.speechSnrDb / (Math.max(1, targetSnrDb) * 2)) * 100)));

  return (
    <LensPanel
      eyebrow="AV lens"
      title="AV & coverage"
      icon={<Volume2 size={18} />}
      source="Indicative"
      testId="av-lens-panel"
      footer={AV_PLANNING_DISCLAIMER}
    >
      <LensPanelSection label="Speaker">
        <NumberField label="Max SPL @ 1 m (dB)" value={maxSplAt1mDb} onValue={(v) => { setMaxSpl(Math.max(0, v)); }} testId="av-spl" min={0} />
        <NumberField label="Coverage angle (°)" value={coverageAngleDeg} onValue={(v) => { setCoverageAngle(Math.max(1, Math.min(179, v))); }} testId="av-angle" min={1} max={179} />
      </LensPanelSection>

      <LensPanelSection label="Room">
        <NumberField label="Listener distance (m)" value={listenerDistanceM} onValue={(v) => { setListenerDistance(Math.max(1, v)); }} testId="av-distance" min={1} />
        <NumberField label="Ambient noise (dB)" value={ambientDb} onValue={(v) => { setAmbient(Math.max(0, v)); }} testId="av-ambient" min={0} />
        <NumberField label="Speech SNR target (dB)" value={targetSnrDb} onValue={(v) => { setTargetSnr(Math.max(0, v)); }} testId="av-target" min={0} />
      </LensPanelSection>

      <LensPanelSection label="Coverage & intelligibility">
        <div className="lens-panel__chips">
          <span className={`lens-panel__chip lens-panel__chip--${status.tone}`} data-testid="av-status">{status.label}</span>
        </div>
        <div className="lens-panel__meter" aria-hidden="true">
          <div className={`lens-panel__meter-fill lens-panel__meter-fill--${status.tone}`} style={{ width: `${String(meterPct)}%` }} />
        </div>
        <LensPanelMetric label="SPL at listener" value={`${String(Math.round(c.splAtListenerDb))} dB`} />
        <LensPanelMetric label="Coverage width" value={`${c.coverageWidthM.toFixed(1)} m at ${String(listenerDistanceM)} m`} />
        <LensPanelMetric label="Speech SNR" value={`${String(Math.round(c.speechSnrDb))} dB over ambient`} />
        <LensPanelMetric label="Target" value={`+${String(targetSnrDb)} dB over ambient`} />
      </LensPanelSection>
    </LensPanel>
  );
}
