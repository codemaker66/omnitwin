import { useState, useCallback } from "react";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useXrayStore } from "../stores/xray-store.js";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const toolbarStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  display: "flex",
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 8,
  zIndex: 20,
  pointerEvents: "auto",
};

const toggleBtnStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  border: "none",
  background: "rgba(30, 30, 30, 0.85)",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  transition: "background 0.15s",
  color: "#e0e0e0",
  flexShrink: 0,
};

const trayStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: 6,
  padding: "4px 8px",
  background: "rgba(30, 30, 30, 0.85)",
  borderRadius: 8,
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  transition: "opacity 0.2s, transform 0.2s",
};

const toolBtnBase: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "transparent",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 1,
  transition: "background 0.15s, border-color 0.15s",
  color: "#d0d0d0",
  position: "relative",
};

const toolBtnActive: React.CSSProperties = {
  ...toolBtnBase,
  background: "rgba(255,255,255,0.15)",
  borderColor: "rgba(255,255,255,0.35)",
  color: "#ffffff",
};

const labelStyle: React.CSSProperties = {
  fontSize: 8,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: 500,
  lineHeight: 1,
  opacity: 0.7,
  letterSpacing: 0.3,
};

const kbdHintStyle: React.CSSProperties = {
  position: "absolute",
  top: -6,
  right: -4,
  fontSize: 9,
  fontFamily: "monospace",
  background: "rgba(60, 60, 60, 0.95)",
  color: "#aaa",
  padding: "1px 3px",
  borderRadius: 3,
  lineHeight: 1.2,
  pointerEvents: "none",
};

// ---------------------------------------------------------------------------
// SVG Icons (inline, 20×20)
// ---------------------------------------------------------------------------

function RulerIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="7" width="16" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <line x1="5" y1="7" x2="5" y2="10" stroke="currentColor" strokeWidth="1.2" />
      <line x1="8" y1="7" x2="8" y2="11" stroke="currentColor" strokeWidth="1.2" />
      <line x1="11" y1="7" x2="11" y2="10" stroke="currentColor" strokeWidth="1.2" />
      <line x1="14" y1="7" x2="14" y2="11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function XrayIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="6" y1="6" x2="14" y2="14" stroke="currentColor" strokeWidth="1.2" />
      <line x1="14" y1="6" x2="6" y2="14" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ToolboxIcon(): React.ReactElement {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="8" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8V6a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Top-right toolbar with expandable tool tray.
 *
 * Click the toolbox icon to expand/collapse the tool tray.
 * Each tool button shows an icon, label, and keyboard shortcut hint.
 * Active tools are highlighted.
 */
export function Toolbar(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const measureActive = useMeasurementStore((s) => s.active);
  const xrayEnabled = useXrayStore((s) => s.enabled);

  const toggleTray = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  const toggleMeasure = useCallback(() => {
    useMeasurementStore.getState().toggle();
  }, []);

  const toggleXray = useCallback(() => {
    useXrayStore.getState().toggle();
  }, []);

  return (
    <div style={toolbarStyle}>
      {/* Expandable tool tray */}
      {open && (
        <div style={trayStyle}>
          {/* Measure tool */}
          <button
            type="button"
            style={measureActive ? toolBtnActive : toolBtnBase}
            onClick={toggleMeasure}
            title="Measure distance (M)"
          >
            <RulerIcon />
            <span style={labelStyle}>Measure</span>
            <span style={kbdHintStyle}>M</span>
          </button>

          {/* X-ray tool */}
          <button
            type="button"
            style={xrayEnabled ? toolBtnActive : toolBtnBase}
            onClick={toggleXray}
            title="X-ray mode (X)"
          >
            <XrayIcon />
            <span style={labelStyle}>X-Ray</span>
            <span style={kbdHintStyle}>X</span>
          </button>
        </div>
      )}

      {/* Toolbox toggle button */}
      <button
        type="button"
        style={{
          ...toggleBtnStyle,
          background: open ? "rgba(60, 60, 60, 0.9)" : "rgba(30, 30, 30, 0.85)",
        }}
        onClick={toggleTray}
        title="Tools"
      >
        <ToolboxIcon />
      </button>
    </div>
  );
}
