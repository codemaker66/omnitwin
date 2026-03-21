import { useState, useEffect, useRef, useCallback } from "react";
import { MAX_CHAIRS_ROUND, MAX_CHAIRS_RECT } from "../lib/table-group.js";

// ---------------------------------------------------------------------------
// ChairCountDialog — modal stepper for chair count when placing a table
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

// Hide native number-input spinners (Chrome/Safari/Edge pseudo-elements)
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChairCountDialog({
  request,
  onConfirm,
  onCancel,
}: ChairCountDialogProps): React.ReactElement | null {
  const [count, setCount] = useState(10);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxChairs = request?.tableShape === "rectangular" ? MAX_CHAIRS_RECT : MAX_CHAIRS_ROUND;

  useEffect(() => {
    if (request !== null) {
      setCount(request.tableShape === "round" ? 10 : 6);
      setTimeout(() => { inputRef.current?.select(); }, 50);
    }
  }, [request]);

  const decrement = useCallback(() => {
    setCount((c) => Math.max(c - 1, 1));
  }, []);

  const increment = useCallback(() => {
    setCount((c) => Math.min(c + 1, maxChairs));
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
      } else if (e.code === "ArrowDown" || e.code === "ArrowLeft") {
        e.preventDefault();
        setCount((c) => Math.max(c - 1, 1));
      }
    }

    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [request, count, maxChairs, onConfirm, onCancel]);

  if (request === null) return null;

  const shapeLabel = request.tableShape === "round" ? "Round table" : "Rectangular table";

  return (
    // Overlay — frosted backdrop
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        pointerEvents: "auto",
        background: "rgba(0, 0, 0, 0.2)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
      onClick={onCancel}
    >
      {/* Panel */}
      <div
        style={{
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: 14,
          padding: "28px 36px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          boxShadow: "0 12px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          color: "#1a1a1a",
          minWidth: 260,
          border: "1px solid rgba(0,0,0,0.06)",
        }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        {/* Header */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            color: "#888",
            marginBottom: 4,
          }}>
            {shapeLabel}
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: -0.2,
            color: "#2a2a2a",
          }}>
            Seating arrangement
          </div>
        </div>

        {/* Stepper */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          background: "rgba(0,0,0,0.04)",
          borderRadius: 10,
          border: "1px solid rgba(0,0,0,0.08)",
          overflow: "hidden",
        }}>
          {/* Minus button */}
          <button
            type="button"
            style={{
              width: 44,
              height: 48,
              border: "none",
              borderRight: "1px solid rgba(0,0,0,0.08)",
              background: "transparent",
              color: count <= 1 ? "#ccc" : "#555",
              fontSize: 18,
              fontWeight: 600,
              cursor: count <= 1 ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              userSelect: "none",
              transition: "background 0.12s, color 0.12s",
            }}
            onClick={(e) => { e.preventDefault(); }}
            onPointerDown={minusRepeat.onPointerDown}
            onPointerUp={minusRepeat.onPointerUp}
            onPointerLeave={minusRepeat.onPointerLeave}
            disabled={count <= 1}
          >
            −
          </button>

          {/* Editable count input */}
          <input
            ref={inputRef}
            className="omni-chair-input"
            type="number"
            min={1}
            max={maxChairs}
            value={count}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setCount(1);
                return;
              }
              const parsed = parseInt(raw, 10);
              if (!Number.isNaN(parsed)) {
                setCount(Math.max(1, Math.min(parsed, maxChairs)));
              }
            }}
            onBlur={() => {
              setCount((c) => Math.max(1, Math.min(c, maxChairs)));
            }}
            style={{
              width: 72,
              height: 48,
              border: "none",
              background: "white",
              color: "#1a1a1a",
              fontSize: 24,
              fontWeight: 700,
              textAlign: "center",
              fontVariantNumeric: "tabular-nums",
              outline: "none",
              appearance: "textfield",
              MozAppearance: "textfield",
              WebkitAppearance: "none",
              padding: 0,
            }}
          />

          {/* Plus button */}
          <button
            type="button"
            style={{
              width: 44,
              height: 48,
              border: "none",
              borderLeft: "1px solid rgba(0,0,0,0.08)",
              background: "transparent",
              color: count >= maxChairs ? "#ccc" : "#555",
              fontSize: 18,
              fontWeight: 600,
              cursor: count >= maxChairs ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              userSelect: "none",
              transition: "background 0.12s, color 0.12s",
            }}
            onClick={(e) => { e.preventDefault(); }}
            onPointerDown={plusRepeat.onPointerDown}
            onPointerUp={plusRepeat.onPointerUp}
            onPointerLeave={plusRepeat.onPointerLeave}
            disabled={count >= maxChairs}
          >
            +
          </button>
        </div>

        {/* Range hint */}
        <div style={{
          fontSize: 11,
          color: "#999",
          marginTop: -12,
          letterSpacing: 0.2,
        }}>
          1 – {maxChairs} chairs
        </div>

        {/* Actions */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          width: "100%",
        }}>
          {/* Primary confirm */}
          <button
            type="button"
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: 8,
              border: "none",
              background: "#2a2a2a",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: 0.2,
              transition: "background 0.15s",
            }}
            onClick={() => { onConfirm(count); }}
          >
            Place {count} {count === 1 ? "chair" : "chairs"}
          </button>

          {/* Secondary actions */}
          <div style={{ display: "flex", gap: 16, marginTop: 2 }}>
            <button
              type="button"
              style={{
                padding: "4px 0",
                border: "none",
                background: "transparent",
                color: "#999",
                fontSize: 12,
                cursor: "pointer",
                letterSpacing: 0.2,
                transition: "color 0.15s",
              }}
              onClick={() => { onConfirm(0); }}
            >
              Table only
            </button>
            <button
              type="button"
              style={{
                padding: "4px 0",
                border: "none",
                background: "transparent",
                color: "#bbb",
                fontSize: 12,
                cursor: "pointer",
                letterSpacing: 0.2,
                transition: "color 0.15s",
              }}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
