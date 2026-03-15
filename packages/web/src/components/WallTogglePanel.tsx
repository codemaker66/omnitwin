import { useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import {
  useVisibilityStore,
  type WallKey,
  type WallMode,
  WALL_KEYS,
} from "../stores/visibility-store.js";

// ---------------------------------------------------------------------------
// Menu config
// ---------------------------------------------------------------------------

const WALL_LABELS: Readonly<Record<WallKey, string>> = {
  "wall-front": "Front wall",
  "wall-back": "Back wall",
  "wall-left": "Left wall",
  "wall-right": "Right wall",
};

interface ModeOption {
  readonly value: WallMode;
  readonly label: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  { value: "auto-2", label: "2 walls" },
  { value: "auto-3", label: "3 walls" },
  { value: "manual", label: "Manual" },
];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const buttonStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  border: "none",
  background: "rgba(30, 30, 30, 0.85)",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  transition: "background 0.15s",
};

const panelBaseStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 56,
  background: "rgba(255, 255, 255, 0.95)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 12,
  fontFamily: "system-ui, -apple-system, sans-serif",
  lineHeight: 1.8,
  boxShadow: "0 2px 12px rgba(0,0,0,0.15)",
  userSelect: "none" as const,
  minWidth: 140,
  whiteSpace: "nowrap" as const,
  transition: "opacity 0.2s ease, transform 0.2s ease",
};

const modeGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  marginBottom: 8,
};

const modeButtonBase: React.CSSProperties = {
  flex: 1,
  padding: "4px 6px",
  fontSize: 11,
  border: "1px solid #ccc",
  borderRadius: 4,
  cursor: "pointer",
  fontFamily: "inherit",
  transition: "all 0.15s",
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "#e0e0e0",
  margin: "6px 0",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  padding: "1px 0",
};

const checkboxStyle: React.CSSProperties = {
  margin: 0,
  cursor: "pointer",
};

const headingStyle: React.CSSProperties = {
  margin: 0,
  marginBottom: 2,
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "#888",
};

// ---------------------------------------------------------------------------
// R3F component — auto-wall selection based on camera angle
// ---------------------------------------------------------------------------

/**
 * Runs per-frame inside Canvas. Reads camera position and updates
 * the visibility store's wall opacity with smooth transitions.
 * Keeps rendering while opacity is still transitioning.
 */
export function AutoWallSelector(): null {
  const { invalidate } = useThree();
  const updateAutoWalls = useVisibilityStore((s) => s.updateAutoWalls);
  const wallOpacity = useVisibilityStore((s) => s.wallOpacity);

  useFrame(({ camera }, delta) => {
    const transitioning = updateAutoWalls(camera.position.x, camera.position.z, delta);
    if (transitioning) {
      invalidate(); // Keep rendering until opacity transition completes
    }
  });

  // Invalidate when wallOpacity changes (for demand mode — covers manual toggles)
  useEffect(() => {
    invalidate();
  }, [wallOpacity, invalidate]);

  return null;
}

/**
 * Invalidates the R3F frame when ceiling/dome toggles change.
 */
export function InvalidateOnToggle(): null {
  const { invalidate } = useThree();
  const ceiling = useVisibilityStore((s) => s.ceiling);
  const dome = useVisibilityStore((s) => s.dome);

  useEffect(() => {
    invalidate();
  }, [ceiling, dome, invalidate]);

  return null;
}

// ---------------------------------------------------------------------------
// HTML overlay — icon button + expandable panel
// ---------------------------------------------------------------------------

export function WallTogglePanel(): React.ReactElement {
  const mode = useVisibilityStore((s) => s.mode);
  const walls = useVisibilityStore((s) => s.walls);
  const ceiling = useVisibilityStore((s) => s.ceiling);
  const dome = useVisibilityStore((s) => s.dome);
  const menuOpen = useVisibilityStore((s) => s.menuOpen);
  const setMode = useVisibilityStore((s) => s.setMode);
  const toggleWall = useVisibilityStore((s) => s.toggleWall);
  const toggleCeiling = useVisibilityStore((s) => s.toggleCeiling);
  const toggleDome = useVisibilityStore((s) => s.toggleDome);
  const toggleMenu = useVisibilityStore((s) => s.toggleMenu);

  return (
    <div style={{
      position: "relative",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    }}>
      {/* Expandable panel — floats to the left of the button */}
      <div style={{
        ...panelBaseStyle,
        opacity: menuOpen ? 1 : 0,
        transform: menuOpen ? "translateX(0)" : "translateX(12px)",
        pointerEvents: menuOpen ? "auto" as const : "none" as const,
      }}>
          {/* Mode selector */}
          <div style={modeGroupStyle}>
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                style={{
                  ...modeButtonBase,
                  background: mode === opt.value ? "#333" : "#fff",
                  color: mode === opt.value ? "#fff" : "#333",
                  borderColor: mode === opt.value ? "#333" : "#ccc",
                }}
                onClick={() => { setMode(opt.value); }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Wall toggles (manual mode) */}
          <p style={headingStyle}>Walls</p>
          {WALL_KEYS.map((key) => (
            <label key={key} style={{
              ...labelStyle,
              opacity: mode !== "manual" ? 0.5 : 1,
            }}>
              <input
                type="checkbox"
                checked={walls[key]}
                onChange={() => { toggleWall(key); }}
                style={checkboxStyle}
                disabled={mode !== "manual"}
              />
              {WALL_LABELS[key]}
            </label>
          ))}

          <div style={dividerStyle} />

          {/* Ceiling + Dome (always available) */}
          <p style={headingStyle}>Other</p>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={ceiling}
              onChange={toggleCeiling}
              style={checkboxStyle}
            />
            Ceiling
          </label>
          <label style={labelStyle}>
            <input
              type="checkbox"
              checked={dome}
              onChange={toggleDome}
              style={checkboxStyle}
            />
            Dome
          </label>
      </div>

      {/* Icon button — Trades Hall building */}
      <button
        type="button"
        style={buttonStyle}
        onClick={toggleMenu}
        title="Wall visibility"
      >
        <img
          src="/th-building.png"
          alt="Wall visibility"
          style={{ width: 32, height: 32, objectFit: "contain", filter: "invert(0)" }}
        />
      </button>
    </div>
  );
}
