import { useState, useEffect, useRef, useCallback } from "react";
import { useFocusTrap } from "../lib/use-focus-trap.js";
import { MAX_CHAIRS_ROUND, MAX_CHAIRS_RECT } from "../lib/table-group.js";

// ---------------------------------------------------------------------------
// ChairCountDialog — luxury modal for seating arrangement
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

const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 80;

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
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (intervalRef.current !== null) { clearInterval(intervalRef.current); intervalRef.current = null; }
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

// Inject styles once
const STYLE_ID = "omni-chair-dialog-v2";
if (typeof document !== "undefined" && document.getElementById(STYLE_ID) === null) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    input.omni-chair-input::-webkit-outer-spin-button,
    input.omni-chair-input::-webkit-inner-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    @keyframes omni-v2-overlay { 0% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes omni-v2-panel {
      0% { opacity: 0; transform: scale(0.88) translateY(24px); filter: blur(8px); }
      100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
    }
    @keyframes omni-v2-pop {
      0% { transform: scale(1); }
      25% { transform: scale(1.18); }
      100% { transform: scale(1); }
    }
    @keyframes omni-v2-glow {
      0%, 100% { box-shadow: 0 6px 32px rgba(201,168,76,0.25), inset 0 1px 0 rgba(255,255,255,0.15); }
      50% { box-shadow: 0 8px 48px rgba(201,168,76,0.4), inset 0 1px 0 rgba(255,255,255,0.2); }
    }
    @keyframes omni-v2-line {
      0% { width: 0; opacity: 0; }
      100% { width: 64px; opacity: 1; }
    }
    .omni-v2-stepper-btn:hover:not(:disabled) {
      background: rgba(201,168,76,0.12) !important;
      color: #e8c95a !important;
    }
    .omni-v2-stepper-btn:active:not(:disabled) {
      background: rgba(201,168,76,0.22) !important;
      transform: scale(0.92);
    }
    .omni-v2-cta:hover {
      transform: translateY(-2px) scale(1.02) !important;
      box-shadow: 0 12px 48px rgba(201,168,76,0.5), inset 0 1px 0 rgba(255,255,255,0.2) !important;
    }
    .omni-v2-cta:active {
      transform: translateY(0) scale(0.97) !important;
    }
    .omni-v2-sec:hover {
      background: rgba(201,168,76,0.08) !important;
      border-color: rgba(201,168,76,0.35) !important;
      color: #dfc06a !important;
    }
    .omni-v2-cancel:hover {
      color: #aaa !important;
      border-color: rgba(255,255,255,0.18) !important;
    }
  `;
  document.head.appendChild(s);
}

const GOLD = "#c9a84c";
const GOLD_LIGHT = "#dfc06a";
const GOLD_DARK = "#a8872e";

export function ChairCountDialog({
  request,
  onConfirm,
  onCancel,
}: ChairCountDialogProps): React.ReactElement | null {
  const [count, setCount] = useState(10);
  const [animKey, setAnimKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(request !== null);

  const maxChairs = request?.tableShape === "rectangular" ? MAX_CHAIRS_RECT : MAX_CHAIRS_ROUND;

  useEffect(() => {
    if (request !== null) {
      setCount(request.tableShape === "round" ? 10 : 2);
      setAnimKey((k) => k + 1);
      setTimeout(() => { inputRef.current?.select(); }, 80);
    }
  }, [request]);

  const decrement = useCallback(() => {
    setCount((c) => { const n = Math.max(c - 1, 1); if (n !== c) setAnimKey((k) => k + 1); return n; });
  }, []);
  const increment = useCallback(() => {
    setCount((c) => { const n = Math.min(c + 1, maxChairs); if (n !== c) setAnimKey((k) => k + 1); return n; });
  }, [maxChairs]);

  const minusRepeat = useRepeatButton(decrement);
  const plusRepeat = useRepeatButton(increment);

  useEffect(() => {
    if (request === null) return;
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement) {
        if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); onConfirm(count); }
        else if (e.code === "Escape") { e.preventDefault(); onCancel(); }
        return;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); onConfirm(count); }
      else if (e.code === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.code === "ArrowUp" || e.code === "ArrowRight") { e.preventDefault(); setCount((c) => Math.min(c + 1, maxChairs)); setAnimKey((k) => k + 1); }
      else if (e.code === "ArrowDown" || e.code === "ArrowLeft") { e.preventDefault(); setCount((c) => Math.max(c - 1, 1)); setAnimKey((k) => k + 1); }
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [request, count, maxChairs, onConfirm, onCancel]);

  if (request === null) return null;

  const shapeLabel = request.tableShape === "round" ? "Round Table" : "Rectangular Table";

  return (
    /* Overlay */
    <div
      style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, pointerEvents: "auto",
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        animation: "omni-v2-overlay 0.4s ease-out",
      }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="chair-dialog-title"
    >
      {/* Panel */}
      <div
        ref={trapRef}
        style={{
          background: "rgba(16, 16, 16, 0.97)",
          borderRadius: 24,
          padding: "52px 64px 44px",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 36,
          boxShadow: "0 32px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.12), inset 0 1px 0 rgba(255,255,255,0.05)",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          color: "#fff",
          minWidth: 380,
          border: "1px solid rgba(201, 168, 76, 0.15)",
          animation: "omni-v2-panel 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        {/* Gold accent line — animated width */}
        <div style={{
          height: 2, borderRadius: 1,
          background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
          marginBottom: -20,
          animation: "omni-v2-line 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          width: 64,
        }} />

        {/* Header — large, breathable */}
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: 12, fontWeight: 600, textTransform: "uppercase",
            letterSpacing: 3.5, color: GOLD, marginBottom: 10,
          }}>
            {shapeLabel}
          </div>
          <div id="chair-dialog-title" style={{
            fontSize: 28, fontWeight: 700, letterSpacing: -0.5,
            color: "#f5f5f5",
            fontFamily: "'Playfair Display', serif",
          }}>
            Seating Arrangement
          </div>
        </div>

        {/* Stepper — large, spacious, magnetic */}
        <div style={{
          display: "flex", alignItems: "center",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 16,
          border: "1px solid rgba(201, 168, 76, 0.2)",
          overflow: "hidden",
        }}>
          {/* Minus */}
          <button
            type="button"
            className="omni-v2-stepper-btn"
            style={{
              width: 72, height: 76, border: "none",
              borderRight: "1px solid rgba(201, 168, 76, 0.12)",
              background: "transparent",
              color: count <= 1 ? "#333" : GOLD_LIGHT,
              fontSize: 28, fontWeight: 400, cursor: count <= 1 ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              userSelect: "none",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onClick={(e) => { e.preventDefault(); }}
            onPointerDown={minusRepeat.onPointerDown}
            onPointerUp={minusRepeat.onPointerUp}
            onPointerLeave={minusRepeat.onPointerLeave}
            disabled={count <= 1}
            aria-label="Decrease chair count"
          >
            −
          </button>

          {/* Count display */}
          <div style={{ position: "relative" }}>
            <input
              key={animKey}
              ref={inputRef}
              className="omni-chair-input"
              type="number"
              min={1}
              max={maxChairs}
              value={count}
              aria-label="Chair count"
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") { setCount(1); return; }
                const parsed = parseInt(raw, 10);
                if (!Number.isNaN(parsed)) setCount(Math.max(1, Math.min(parsed, maxChairs)));
              }}
              onBlur={() => { setCount((c) => Math.max(1, Math.min(c, maxChairs))); }}
              style={{
                width: 110, height: 76, border: "none",
                background: "rgba(255,255,255,0.02)",
                color: "#fff", fontSize: 40, fontWeight: 700,
                textAlign: "center", fontVariantNumeric: "tabular-nums",
                outline: "none",
                appearance: "textfield", MozAppearance: "textfield", WebkitAppearance: "none",
                padding: 0, fontFamily: "'Inter', system-ui, sans-serif",
                animation: "omni-v2-pop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            />
          </div>

          {/* Plus */}
          <button
            type="button"
            className="omni-v2-stepper-btn"
            style={{
              width: 72, height: 76, border: "none",
              borderLeft: "1px solid rgba(201, 168, 76, 0.12)",
              background: "transparent",
              color: count >= maxChairs ? "#333" : GOLD_LIGHT,
              fontSize: 28, fontWeight: 400, cursor: count >= maxChairs ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              userSelect: "none",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onClick={(e) => { e.preventDefault(); }}
            onPointerDown={plusRepeat.onPointerDown}
            onPointerUp={plusRepeat.onPointerUp}
            onPointerLeave={plusRepeat.onPointerLeave}
            disabled={count >= maxChairs}
            aria-label="Increase chair count"
          >
            +
          </button>
        </div>

        {/* Range hint */}
        <div style={{
          fontSize: 13, color: "#555", marginTop: -20,
          letterSpacing: 0.8, fontWeight: 400,
        }}>
          1 – {maxChairs} chairs
        </div>

        {/* Primary CTA */}
        <button
          type="button"
          className="omni-v2-cta"
          style={{
            width: "100%", padding: "18px 0",
            borderRadius: 14, border: "none",
            background: `linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD} 40%, ${GOLD_LIGHT} 100%)`,
            color: "#0e0e0e", fontSize: 17, fontWeight: 700,
            cursor: "pointer", letterSpacing: 0.6,
            transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            boxShadow: "0 6px 32px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
            animation: "omni-v2-glow 4s ease-in-out infinite",
          }}
          onClick={() => { onConfirm(count); }}
        >
          Place {count} {count === 1 ? "Chair" : "Chairs"}
        </button>

        {/* Secondary row */}
        <div style={{ display: "flex", gap: 16, marginTop: -8 }}>
          <button
            type="button"
            className="omni-v2-sec"
            style={{
              padding: "10px 24px", borderRadius: 10,
              border: "1px solid rgba(201, 168, 76, 0.18)",
              background: "transparent", color: GOLD,
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              letterSpacing: 0.3, transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onClick={() => { onConfirm(0); }}
          >
            Table Only
          </button>
          <button
            type="button"
            className="omni-v2-cancel"
            style={{
              padding: "10px 24px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "transparent", color: "#555",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              letterSpacing: 0.3, transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
