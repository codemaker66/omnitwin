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
// Inject custom slider + animation styles
// ---------------------------------------------------------------------------

const STYLE_ID = "omni-section-box-v2";
if (typeof document !== "undefined" && document.getElementById(STYLE_ID) === null) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes omni-sb-in {
      0% { opacity: 0; transform: translateX(-12px) scale(0.95); filter: blur(4px); }
      100% { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); }
    }
    @keyframes omni-sb-glow {
      0%, 100% { box-shadow: 0 16px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.12); }
      50% { box-shadow: 0 20px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.25), 0 0 20px rgba(201,168,76,0.05); }
    }
    .omni-sb-slider {
      -webkit-appearance: none;
      appearance: none;
      height: 6px;
      border-radius: 3px;
      background: rgba(255,255,255,0.08);
      outline: none;
      cursor: ew-resize;
      transition: background 0.2s;
    }
    .omni-sb-slider:hover {
      background: rgba(255,255,255,0.12);
    }
    .omni-sb-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: linear-gradient(135deg, #c9a84c, #dfc06a);
      border: 2px solid rgba(0,0,0,0.3);
      box-shadow: 0 2px 8px rgba(201,168,76,0.4);
      cursor: ew-resize;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .omni-sb-slider::-webkit-slider-thumb:hover {
      transform: scale(1.2);
      box-shadow: 0 3px 12px rgba(201,168,76,0.6);
    }
    .omni-sb-slider::-webkit-slider-thumb:active {
      transform: scale(0.95);
    }
    .omni-sb-slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: linear-gradient(135deg, #c9a84c, #dfc06a);
      border: 2px solid rgba(0,0,0,0.3);
      box-shadow: 0 2px 8px rgba(201,168,76,0.4);
      cursor: ew-resize;
    }
    .omni-sb-reset:hover {
      background: rgba(201,168,76,0.12) !important;
      border-color: rgba(201,168,76,0.4) !important;
      color: #dfc06a !important;
    }
    .omni-sb-reset:active {
      transform: scale(0.95);
    }
  `;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOLD = "#c9a84c";

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
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "6px 0",
    }}>
      <span style={{
        fontSize: 13,
        fontFamily: "'Inter', system-ui, sans-serif",
        fontWeight: 600,
        color: "#bbb",
        width: 48,
        textAlign: "right",
        flexShrink: 0,
      }}>
        {faceLabel(face)}
      </span>
      <input
        type="range"
        className="omni-sb-slider"
        min={0}
        max={100}
        step={0.5}
        value={percent}
        onChange={handleChange}
        aria-label={`Section box ${faceLabel(face)} face`}
        style={{ flex: 1 }}
      />
      <span style={{
        fontSize: 14,
        fontFamily: "'Inter', system-ui, monospace",
        fontWeight: 700,
        color: "#fff",
        width: 56,
        textAlign: "right",
        flexShrink: 0,
        fontVariantNumeric: "tabular-nums",
      }}>
        {realValue.toFixed(1)}m
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SectionBoxControls(): React.ReactElement | null {
  const boxEnabled = useSectionStore((s) => s.boxEnabled);
  const resetBox = useSectionStore((s) => s.resetBox);

  const handleReset = useCallback(() => {
    resetBox();
  }, [resetBox]);

  if (!boxEnabled) return null;

  return (
    <div style={{
      position: "absolute",
      left: 68, // clear of 52px toolbar + 16px gap
      top: 20,
      zIndex: 30,
      pointerEvents: "auto",
      animation: "omni-sb-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
    }}>
      <div style={{
        background: "linear-gradient(145deg, rgba(16,16,16,0.97), rgba(22,22,22,0.97))",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(201,168,76,0.15)",
        borderRadius: 20,
        padding: "28px 32px 24px",
        minWidth: 340,
        animation: "omni-sb-glow 4s ease-in-out infinite",
      }}>
        {/* Gold accent bar */}
        <div style={{
          width: 40,
          height: 3,
          borderRadius: 2,
          background: `linear-gradient(90deg, ${GOLD}, rgba(201,168,76,0.3))`,
          marginBottom: 16,
        }} />

        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}>
          <div>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase" as const,
              letterSpacing: 2.5,
              color: GOLD,
              marginBottom: 4,
            }}>
              Precision Tool
            </div>
            <div style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#f5f5f5",
              fontFamily: "'Playfair Display', serif",
              letterSpacing: -0.3,
            }}>
              Section Box
            </div>
            <div style={{
              fontSize: 13,
              color: "#777",
              marginTop: 4,
              fontFamily: "'Inter', system-ui, sans-serif",
              lineHeight: 1.4,
            }}>
              Slice the room from any direction to see inside
            </div>
          </div>
          <button
            type="button"
            className="omni-sb-reset"
            onClick={handleReset}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(201,168,76,0.2)",
              background: "transparent",
              color: GOLD,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Inter', system-ui, sans-serif",
              cursor: "pointer",
              letterSpacing: 0.3,
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              flexShrink: 0,
            }}
          >
            Reset
          </button>
        </div>

        {/* Sliders */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}>
          {BOX_FACES.map((face) => (
            <FaceSlider key={face} face={face} />
          ))}
        </div>

        {/* Shortcut hint */}
        <div style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <span style={{
            padding: "3px 8px",
            borderRadius: 4,
            background: "rgba(201,168,76,0.1)",
            border: "1px solid rgba(201,168,76,0.15)",
            color: GOLD,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "'Inter', system-ui, sans-serif",
          }}>
            B
          </span>
          <span style={{
            fontSize: 12,
            color: "#555",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}>
            Toggle section box on / off
          </span>
        </div>
      </div>
    </div>
  );
}
