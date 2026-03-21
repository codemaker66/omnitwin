import { useCallback } from "react";
import { useSectionStore } from "../stores/section-store.js";
import type { BoxFace } from "../lib/section-box.js";
import {
  faceToPercent,
  percentToFace,
  boxValueToReal,
  faceLabel,
  BOX_FACES,
} from "../lib/section-box.js";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "absolute",
  left: 16,
  top: 16,
  background: "rgba(30, 30, 30, 0.9)",
  borderRadius: 8,
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  zIndex: 20,
  pointerEvents: "auto",
  boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
  minWidth: 180,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 4,
};

const titleStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: 600,
  color: "#e0e0e0",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const resetBtnStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "2px 8px",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#aaa",
  cursor: "pointer",
  transition: "background 0.15s",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const faceLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#aaa",
  width: 36,
  textAlign: "right",
  flexShrink: 0,
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  accentColor: "#5080b0",
  cursor: "ew-resize",
};

const valueStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  color: "#ccc",
  width: 42,
  textAlign: "right",
  flexShrink: 0,
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FaceSlider({ face }: { readonly face: BoxFace }): React.ReactElement {
  const boxBounds = useSectionStore((s) => s.boxBounds);
  const setBoxFace = useSectionStore((s) => s.setBoxFace);
  const value = boxBounds[face];
  const percent = faceToPercent(face, value);
  const realValue = boxValueToReal(face, value);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newPercent = Number(event.target.value);
      const newValue = percentToFace(face, newPercent);
      setBoxFace(face, newValue);
    },
    [face, setBoxFace],
  );

  return (
    <div style={rowStyle}>
      <span style={faceLabelStyle}>{faceLabel(face)}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={percent}
        onChange={handleChange}
        aria-label={`Section box ${faceLabel(face)} face`}
        style={sliderStyle}
      />
      <span style={valueStyle}>{realValue.toFixed(1)}m</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Section Box controls panel — shown when box mode is active.
 *
 * Displays 6 range sliders (one per face) to adjust the clipping box.
 * Each slider shows the real-world position in metres.
 * A "Reset" button restores the box to full room bounds.
 */
export function SectionBoxControls(): React.ReactElement | null {
  const boxEnabled = useSectionStore((s) => s.boxEnabled);
  const resetBox = useSectionStore((s) => s.resetBox);

  const handleReset = useCallback(() => {
    resetBox();
  }, [resetBox]);

  if (!boxEnabled) return null;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>Section Box</span>
        <button
          type="button"
          style={resetBtnStyle}
          onClick={handleReset}
          title="Reset to full room"
        >
          Reset
        </button>
      </div>
      {BOX_FACES.map((face) => (
        <FaceSlider key={face} face={face} />
      ))}
    </div>
  );
}
