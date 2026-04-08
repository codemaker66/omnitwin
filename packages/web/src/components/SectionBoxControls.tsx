import { useCallback, useEffect, useRef } from "react";
import { useSectionStore } from "../stores/section-store.js";
import type { BoxFace } from "../lib/section-box.js";
import {
  faceToPercent,
  percentToFace,
  boxValueToReal,
  faceLabel,
  getFullRoomBounds,
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

const sliderRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, padding: "6px 0",
};
const sliderLabelStyle: React.CSSProperties = {
  fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 600,
  color: "#bbb", width: 48, textAlign: "right", flexShrink: 0,
};
const sliderValueStyle: React.CSSProperties = {
  fontSize: 14, fontFamily: "'Inter', system-ui, monospace", fontWeight: 700,
  color: "#fff", width: 56, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums",
};

function FaceSlider({ face }: { readonly face: BoxFace }): React.ReactElement {
  const boxBounds = useSectionStore((s) => s.boxBounds);
  const setBoxFace = useSectionStore((s) => s.setBoxFace);
  const value = boxBounds[face];
  const percent = faceToPercent(face, value);
  const realValue = boxValueToReal(face, value);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setBoxFace(face, percentToFace(face, Number(event.target.value)));
    },
    [face, setBoxFace],
  );

  return (
    <div style={sliderRowStyle}>
      <span style={sliderLabelStyle}>{faceLabel(face)}</span>
      <input type="range" className="omni-sb-slider" min={0} max={100} step={0.5}
        value={percent} onChange={handleChange} style={{ flex: 1 }}
        aria-label={`Section box ${faceLabel(face)} face`} />
      <span style={sliderValueStyle}>{realValue.toFixed(1)}m</span>
    </div>
  );
}

/**
 * Unified walls slider — moves all 4 wall faces (left, right, front, back)
 * symmetrically inward by the same percentage.
 */
function WallsSlider(): React.ReactElement {
  const boxBounds = useSectionStore((s) => s.boxBounds);
  const setBoxFace = useSectionStore((s) => s.setBoxFace);
  const room = getFullRoomBounds();

  // Compute the inset as a percentage (0 = full room, 100 = fully clipped)
  const insetX = 1 - (boxBounds.maxX - boxBounds.minX) / (room.maxX - room.minX);
  const insetZ = 1 - (boxBounds.maxZ - boxBounds.minZ) / (room.maxZ - room.minZ);
  const insetPercent = Math.round(((insetX + insetZ) / 2) * 100);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(event.target.value) / 100;
      const halfInsetX = ((room.maxX - room.minX) / 2) * pct;
      const halfInsetZ = ((room.maxZ - room.minZ) / 2) * pct;
      setBoxFace("minX", room.minX + halfInsetX);
      setBoxFace("maxX", room.maxX - halfInsetX);
      setBoxFace("minZ", room.minZ + halfInsetZ);
      setBoxFace("maxZ", room.maxZ - halfInsetZ);
    },
    [setBoxFace, room],
  );

  return (
    <div style={sliderRowStyle}>
      <span style={sliderLabelStyle}>Walls</span>
      <input type="range" className="omni-sb-slider" min={0} max={90} step={1}
        value={insetPercent} onChange={handleChange} style={{ flex: 1 }}
        aria-label="Section box wall inset" />
      <span style={sliderValueStyle}>{String(insetPercent)}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SectionBoxControls(): React.ReactElement | null {
  const boxEnabled = useSectionStore((s) => s.boxEnabled);
  const resetBox = useSectionStore((s) => s.resetBox);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleReset = useCallback(() => {
    resetBox();
  }, [resetBox]);

  // Close section box when clicking outside the panel (e.g. on the canvas)
  useEffect(() => {
    if (!boxEnabled) return;
    function onPointerDown(e: PointerEvent): void {
      // Only close on left-click, not right-click (orbit) or middle-click (pan)
      if (e.button !== 0) return;
      if (panelRef.current !== null && !panelRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (target.closest("[data-section-box-btn]") !== null) return;
        useSectionStore.getState().toggleBox();
      }
    }
    // Use a short delay so the opening click doesn't immediately close it
    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", onPointerDown);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [boxEnabled]);

  if (!boxEnabled) return null;

  return (
    <div ref={panelRef} style={{
      position: "absolute",
      left: 68,
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

        {/* Unified walls slider */}
        <WallsSlider />

        <div style={{
          height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0",
        }} />

        {/* Top / Bottom individual sliders */}
        <FaceSlider face="minY" />
        <FaceSlider face="maxY" />

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
