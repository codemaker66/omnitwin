import { useCallback } from "react";
import { useSectionStore } from "../stores/section-store.js";
import { isLayoutTimelineMutationLocked } from "../lib/layout-timeline-preview-lock.js";

// ---------------------------------------------------------------------------
// Pure helpers — testable without React
// ---------------------------------------------------------------------------

/**
 * Converts a slider percentage (0–100) to a section height in meters.
 * 0% = floor only (height 0), 100% = full room (height = maxHeight).
 */
export function sliderPercentToHeight(percent: number, maxHeight: number): number {
  return (percent / 100) * maxHeight;
}

/**
 * Converts a section height in meters to a slider percentage (0–100).
 */
export function heightToSliderPercent(height: number, maxHeight: number): number {
  if (maxHeight <= 0) return 100;
  return (height / maxHeight) * 100;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Vertical slider overlaid on the right side of the 3D viewport.
 *
 * Controls the section plane height: drag down to slice away walls/ceiling
 * from the top, revealing a clean planning view. Drag up to restore full
 * 3D architectural view with walls and dome.
 *
 * The slider is oriented so that the top position = full height (all walls)
 * and bottom position = floor only.
 */
export function SectionSlider({ embedded = false }: { readonly embedded?: boolean }): React.ReactElement {
  const height = useSectionStore((s) => s.height);
  const maxHeight = useSectionStore((s) => s.maxHeight);
  const setHeight = useSectionStore((s) => s.setHeight);

  const percent = heightToSliderPercent(height, maxHeight);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (isLayoutTimelineMutationLocked()) return;
      const newPercent = Number(event.target.value);
      setHeight(sliderPercentToHeight(newPercent, maxHeight));
    },
    [setHeight, maxHeight],
  );

  const displayHeight = height.toFixed(1);

  if (embedded) return (
    <div style={{ display: "grid", gap: 9, minWidth: 0 }}>
      <span style={{ color: "#c9b993", fontVariantNumeric: "tabular-nums" }}>{displayHeight} m / {maxHeight.toFixed(1)} m</span>
      <input type="range" min={0} max={100} step={0.5} value={percent} onChange={handleChange}
        aria-label="Section plane height" aria-valuetext={`${displayHeight} metres of ${maxHeight.toFixed(1)} metres`}
        style={{ width: "100%", margin: 0, accentColor: "#c8a464", cursor: "ew-resize" }} />
      <button type="button" onClick={() => { if (!isLayoutTimelineMutationLocked()) setHeight(maxHeight); }}
        style={{ padding: "6px 8px", borderRadius: 4, background: "#29251e", border: "1px solid #514633", color: "#e5d5b5", font: "inherit", cursor: "pointer" }}>
        Show full model height
      </button>
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: "monospace",
          color: "#666",
          letterSpacing: "0.05em",
        }}
      >
        {maxHeight.toFixed(0)}m
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={percent}
        onChange={handleChange}
        aria-label="Section plane height"
        style={{
          writingMode: "vertical-lr",
          direction: "rtl",
          width: 28,
          height: 200,
          cursor: "ns-resize",
          accentColor: "#5080b0",
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontFamily: "monospace",
          color: "#666",
          letterSpacing: "0.05em",
        }}
      >
        0m
      </span>
      <span
        style={{
          fontSize: 10,
          fontFamily: "monospace",
          color: "#999",
          marginTop: 2,
        }}
      >
        {displayHeight}m
      </span>
    </div>
  );
}
