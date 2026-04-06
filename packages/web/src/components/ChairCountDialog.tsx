import { useState, useEffect, useRef, useCallback } from "react";
import { MAX_CHAIRS_ROUND, MAX_CHAIRS_RECT } from "../lib/table-group.js";

// ---------------------------------------------------------------------------
// ChairCountDialog — premium modal stepper for chair count
// ---------------------------------------------------------------------------

export interface ChairCountRequest {
  readonly catalogueItemId: string;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly tableShape: "round" | "rectangular";
}

interface ChairCountDialogProps {
  readonly request: ChairCountRequest | null;
  readonly onConfirm: (count: number) => void;
  readonly onCancel: () => void;
}

/** Initial delay before repeat starts (ms). */
const REPEAT_DELAY = 400;
/** Interval between repeats once held (ms). */
const REPEAT_INTERVAL = 80;

// ---------------------------------------------------------------------------
// Press-and-hold repeat hook
// ---------------------------------------------------------------------------

function useRepeatButton(
  action: () => void,
): {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(() => {
    action();
    timerRef.current = setTimeout(() => {
      intervalRef.current = setInterval(action, REPEAT_INTERVAL);
    }, REPEAT_DELAY);
  }, [action]);

  useEffect(() => stop, [stop]);

  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop };
}

// Hide native number-input spinners
const HIDE_SPINNERS_ID = "omni-hide-spinners";
if (typeof document !== "undefined" && document.getElementById(HIDE_SPINNERS_ID) === null) {
  const style = document.createElement("style");
  style.id = HIDE_SPINNERS_ID;
  style.textContent = `
    input.omni-chair-input::-webkit-outer-spin-button,
    input.omni-chair-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  `;
  document.head.appendChild(style);
}

// Inject keyframe animations once
const ANIM_ID = "omni-chair-dialog-anims";
if (typeof document !== "undefined" && document.getElementById(ANIM_ID) === null) {
  const style = document.createElement("style");
  style.id = ANIM_ID;
  style.textContent = `
    @keyframes omni-dialog-in {
      0% { opacity: 0; transform: scale(0.92) translateY(12px); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes omni-overlay-in {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
    @keyframes omni-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes omni-count-pop {
      0% { transform: scale(1); }
      30% { transform: scale(1.15); }
      100% { transform: scale(1); }
    }
    @keyframes omni-gold-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(201, 168, 76, 0.4); }
      50% { box-shadow: 0 0 16px 4px rgba(201, 168, 76, 0.15); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Gold theme constants
// ---------------------------------------------------------------------------

const GOLD = "#c9a84c";
const GOLD_LIGHT = "#dfc06a";
const GOLD_DARK = "#a8872e";
const DARK_BG = "#141414";
const PANEL_BG = "rgba(18, 18, 18, 0.96)";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChairCountDialog({
  request,
  onConfirm,
  onCancel,
}: ChairCountDialogProps): React.ReactElement | null {
  const [count, setCount] = useState(10);
  const [animKey, setAnimKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxChairs = request?.tableShape === "rectangular" ? MAX_CHAIRS_RECT : MAX_CHAIRS_ROUND;

  useEffect(() => {
    if (request !== null) {
      setCount(request.tableShape === "round" ? 10 : 2);
      setAnimKey((k) => k + 1);
      setTimeout(() => { inputRef.current?.select(); }, 50);
    }
  }, [request]);

  const decrement = useCallback(() => {
    setCount((c) => {
      const next = Math.max(c - 1, 1);
      if (next !== c) setAnimKey((k) => k + 1);
      return next;
    });
  }, []);

  const increment = useCallback(() => {
    setCount((c) => {
      const next = Math.min(c + 1, maxChairs);
      if (next !== c) setAnimKey((k) => k + 1);
      return next;
    });
  }, [maxChairs]);

  const minusRepeat = useRepeatButton(decrement);
  const plusRepeat = useRepeatButton(increment);

  useEffect(() => {
    if (request === null) return;

    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement) {
        if (e.code === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          onConfirm(count);
        } else if (e.code === "Escape") {
          e.preventDefault();
          onCancel();
        }
        return;
      }

      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        onConfirm(count);
      } else if (e.code === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.code === "ArrowUp" || e.code === "ArrowRight") {
        e.preventDefault();
        setCount((c) => Math.min(c + 1, maxChairs));
        setAnimKey((k) => k + 1);
      } else if (e.code === "ArrowDown" || e.code === "ArrowLeft") {
        e.preventDefault();
        setCount((c) => Math.max(c - 1, 1));
        setAnimKey((k) => k + 1);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [request, count, maxChairs, onConfirm, onCancel]);

  if (request === null) return null;

  const shapeLabel = request.tableShape === "round" ? "Round Table" : "Rectangular Table";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        pointerEvents: "auto",
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation: "omni-overlay-in 0.3s ease-out",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: PANEL_BG,
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRadius: 16,
          padding: "32px 40px 28px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 24,
          boxShadow: `0 24px 80px rgba(0,0,0,0.5), 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(201,168,76,0.15)`,
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          color: "#fff",
          minWidth: 280,
          border: `1px solid rgba(201, 168, 76, 0.2)`,
          animation: "omni-dialog-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        {/* Gold accent line */}
        <div style={{
          width: 48,
          height: 2,
          borderRadius: 1,
          background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
          marginBottom: -12,
        }} />

        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 2.5,
            color: GOLD,
            marginBottom: 6,
          }}>
            {shapeLabel}
          </div>
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: -0.3,
            color: "#f0f0f0",
            fontFamily: "'Playfair Display', serif",
          }}>
            Seating Arrangement
          </div>
        </div>

        {/* Stepper */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          background: "rgba(255,255,255,0.04)",
          borderRadius: 12,
          border: `1px solid rgba(201, 168, 76, 0.25)`,
          overflow: "hidden",
        }}>
          <button
            type="button"
            style={{
              width: 52,
              height: 56,
              border: "none",
              borderRight: `1px solid rgba(201, 168, 76, 0.15)`,
              background: "transparent",
              color: count <= 1 ? "#444" : GOLD_LIGHT,
              fontSize: 22,
              fontWeight: 500,
              cursor: count <= 1 ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              userSelect: "none",
              transition: "background 0.2s, color 0.2s",
            }}
            onClick={(e) => { e.preventDefault(); }}
            onPointerDown={minusRepeat.onPointerDown}
            onPointerUp={minusRepeat.onPointerUp}
            onPointerLeave={minusRepeat.onPointerLeave}
            onMouseEnter={(e) => { if (count > 1) e.currentTarget.style.background = "rgba(201,168,76,0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            disabled={count <= 1}
          >
            −
          </button>

          <div style={{ position: "relative" }}>
            <input
              key={animKey}
              ref={inputRef}
              className="omni-chair-input"
              type="number"
              min={1}
              max={maxChairs}
              value={count}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") { setCount(1); return; }
                const parsed = parseInt(raw, 10);
                if (!Number.isNaN(parsed)) {
                  setCount(Math.max(1, Math.min(parsed, maxChairs)));
                }
              }}
              onBlur={() => {
                setCount((c) => Math.max(1, Math.min(c, maxChairs)));
              }}
              style={{
                width: 80,
                height: 56,
                border: "none",
                background: "rgba(255,255,255,0.03)",
                color: "#fff",
                fontSize: 28,
                fontWeight: 700,
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
                outline: "none",
                appearance: "textfield",
                MozAppearance: "textfield",
                WebkitAppearance: "none",
                padding: 0,
                fontFamily: "'Inter', system-ui, sans-serif",
                animation: "omni-count-pop 0.2s ease-out",
              }}
            />
          </div>

          <button
            type="button"
            style={{
              width: 52,
              height: 56,
              border: "none",
              borderLeft: `1px solid rgba(201, 168, 76, 0.15)`,
              background: "transparent",
              color: count >= maxChairs ? "#444" : GOLD_LIGHT,
              fontSize: 22,
              fontWeight: 500,
              cursor: count >= maxChairs ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              userSelect: "none",
              transition: "background 0.2s, color 0.2s",
            }}
            onClick={(e) => { e.preventDefault(); }}
            onPointerDown={plusRepeat.onPointerDown}
            onPointerUp={plusRepeat.onPointerUp}
            onPointerLeave={plusRepeat.onPointerLeave}
            onMouseEnter={(e) => { if (count < maxChairs) e.currentTarget.style.background = "rgba(201,168,76,0.1)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            disabled={count >= maxChairs}
          >
            +
          </button>
        </div>

        {/* Range hint */}
        <div style={{
          fontSize: 11,
          color: "#666",
          marginTop: -14,
          letterSpacing: 0.5,
        }}>
          1 – {maxChairs} chairs
        </div>

        {/* Primary CTA — gold gradient */}
        <button
          type="button"
          style={{
            width: "100%",
            padding: "13px 0",
            borderRadius: 10,
            border: "none",
            background: `linear-gradient(135deg, ${GOLD_DARK}, ${GOLD}, ${GOLD_LIGHT})`,
            backgroundSize: "200% 100%",
            color: DARK_BG,
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            letterSpacing: 0.5,
            transition: "transform 0.15s, box-shadow 0.15s",
            boxShadow: `0 4px 16px rgba(201, 168, 76, 0.3)`,
            animation: "omni-gold-pulse 3s ease-in-out infinite",
          }}
          onClick={() => { onConfirm(count); }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.02)";
            e.currentTarget.style.boxShadow = "0 6px 24px rgba(201, 168, 76, 0.45)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(201, 168, 76, 0.3)";
          }}
          onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.97)"; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1.02)"; }}
        >
          Place {count} {count === 1 ? "Chair" : "Chairs"}
        </button>

        {/* Secondary actions */}
        <div style={{ display: "flex", gap: 24, marginTop: -4 }}>
          <button
            type="button"
            style={{
              padding: "6px 12px",
              border: `1px solid rgba(201, 168, 76, 0.2)`,
              borderRadius: 6,
              background: "transparent",
              color: GOLD,
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              letterSpacing: 0.3,
              transition: "all 0.2s",
            }}
            onClick={() => { onConfirm(0); }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(201, 168, 76, 0.1)";
              e.currentTarget.style.borderColor = "rgba(201, 168, 76, 0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "rgba(201, 168, 76, 0.2)";
            }}
          >
            Table Only
          </button>
          <button
            type="button"
            style={{
              padding: "6px 12px",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              background: "transparent",
              color: "#666",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              letterSpacing: 0.3,
              transition: "all 0.2s",
            }}
            onClick={onCancel}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#999";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#666";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
