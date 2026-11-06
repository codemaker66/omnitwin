import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../lib/use-focus-trap.js";
import { useEscapeLayer, usePlannerKeyBindings, type KeyChord } from "../lib/planner-keys.js";
import { chairCountRange, seatCapacity, tableGroupSeatCapacity } from "../lib/table-group.js";
import { stockIdentity } from "../lib/card-stock.js";
import { getCatalogueItem } from "../lib/catalogue.js";
import { prefersReducedMotion } from "../lib/reduced-motion.js";
import type { PlacedItem } from "../lib/placement.js";
import { useChairDialogStore } from "../stores/chair-dialog-store.js";
import { usePlacementStore } from "../stores/placement-store.js";

// ---------------------------------------------------------------------------
// ChairCountDialog — how many seats a table takes, asked as it is placed or
// re-seated. A layout asks it once per table, so it is quick to answer: it
// fades in over 120 ms, starts from the count last placed at that table, and
// takes a typed count as a draft (read on Enter or blur, never clamped per
// keystroke). Placing closes it at once, because the room's set-down is the
// answer; cancelling fades it out over 90 ms.
// ---------------------------------------------------------------------------

export interface ChairCountRequest {
  readonly catalogueItemId: string;
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
  readonly tableShape: "round" | "rectangular";
  /** Uniform scale of an existing table; omitted for a new scale-1 placement. */
  readonly scale?: number;
}

interface ChairCountDialogProps {
  readonly request: ChairCountRequest | null;
  readonly onConfirm: (count: number) => void;
  readonly onCancel: () => void;
}

/** A cancelled question fades this long before it is gone; an answered one goes at once. */
export const CHAIR_DIALOG_CANCEL_FADE_MS = 90;

/** These keys with any modifier held, as the dialog has always taken them. */
function anyModifier(codes: readonly string[]): KeyChord[] {
  return codes.flatMap((code) => [
    { code, shift: "any", alt: "any" } as const,
    { code, mod: true, shift: "any", alt: "any" } as const,
  ]);
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
const STYLE_ID = "omni-chair-dialog-v3";
if (typeof document !== "undefined" && document.getElementById(STYLE_ID) === null) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    input.omni-chair-input::-webkit-outer-spin-button,
    input.omni-chair-input::-webkit-inner-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    /* The house ring, drawn inside: the stepper clips anything outside the count. */
    input.omni-chair-input:focus-visible {
      outline: var(--vv-focus-ring);
      outline-offset: calc(-2px - var(--vv-focus-ring-offset));
    }
    input.omni-chair-input::selection {
      background: color-mix(in srgb, var(--house-accent-copper) 42%, transparent);
      color: #fff;
    }
    @keyframes omni-v3-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes omni-v3-out { from { opacity: 1; } to { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .omni-chair-modal, .omni-chair-modal * {
        animation: none !important;
        transition: none !important;
      }
    }
    .omni-v2-stepper-btn:hover:not(:disabled) {
      background: rgba(201, 138, 91,0.12) !important;
      color: #dca475 !important;
    }
    .omni-v2-stepper-btn:active:not(:disabled) {
      background: rgba(201, 138, 91,0.22) !important;
      transform: scale(0.92);
    }
    @media (hover: hover) and (pointer: fine) {
      .omni-v2-cta:hover {
        transform: translateY(-2px) scale(1.02) !important;
        box-shadow: 0 12px 48px rgba(201, 138, 91,0.5), inset 0 1px 0 rgba(255,255,255,0.2) !important;
      }
    }
    .omni-v2-cta:active {
      transform: translateY(0) scale(0.97) !important;
    }
    .omni-v2-sec:hover {
      background: rgba(201, 138, 91,0.08) !important;
      border-color: rgba(201, 138, 91,0.35) !important;
      color: #dca475 !important;
    }
    .omni-v2-cancel:hover {
      color: #aaa !important;
      border-color: rgba(255,255,255,0.18) !important;
    }
  `;
  document.head.appendChild(s);
}

const GOLD = "#c98a5b";
const GOLD_LIGHT = "#dca475";
const GOLD_DARK = "#7e4620";

/** The count last placed at each table this visit, by its bare table (a clothed round remembers with a plain one). */
const rememberedSeats = new Map<string, number>();

/** Forgets every remembered count (tests). */
export function forgetRememberedSeatsForTests(): void {
  rememberedSeats.clear();
}

/** A typed count the table takes: whole digits within [min, max], else null. */
function seatsFromDraft(draft: string, min: number, max: number): number | null {
  const text = draft.trim();
  if (!/^\d+$/.test(text)) return null;
  const seats = Number(text);
  return seats >= min && seats <= max ? seats : null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Chairs already at a placed table: the count its stepper starts from. */
function chairsAtTable(table: PlacedItem, placedItems: readonly PlacedItem[]): number {
  if (table.groupId === null) return 0;
  return placedItems.filter((item) => (
    item.groupId === table.groupId && getCatalogueItem(item.catalogueItemId)?.category === "chair"
  )).length;
}

export function ChairCountDialog({
  request,
  onConfirm,
  onCancel,
}: ChairCountDialogProps): React.ReactElement | null {
  const [draft, setDraft] = useState("10");
  const [count, setCount] = useState(10);
  const [warning, setWarning] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const countRef = useRef(count);
  countRef.current = count;
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const asking = request !== null && !leaving;
  const trapRef = useFocusTrap<HTMLDivElement>(asking);

  // The stepper runs over seat truth's range (seatsFor), held to what
  // physically fits around this specific table, so the count the planner
  // picks is exactly what gets placed (no silent clamping).
  const tableItem = request === null ? undefined : getCatalogueItem(request.catalogueItemId);
  const editTableId = useChairDialogStore((state) => state.editTableId);
  const placedItems = usePlacementStore((state) => state.placedItems);
  const existingTable = placedItems.find((item) => item.id === editTableId && item.catalogueItemId === request?.catalogueItemId);
  const physicalMax = existingTable !== undefined
    ? tableGroupSeatCapacity(existingTable, placedItems)
    : tableItem !== undefined
    ? seatCapacity(tableItem, request?.scale)
    : 0;
  const range = tableItem === undefined
    ? { min: 0, max: 0, initial: 0 }
    : chairCountRange(tableItem, physicalMax);
  // A placed table keeps the count it already has, even outside seat truth's range.
  const current = existingTable === undefined ? 0 : Math.min(physicalMax, chairsAtTable(existingTable, placedItems));
  const minChairs = current > 0 ? Math.min(range.min, current) : range.min;
  const maxChairs = Math.max(range.max, current);
  // A new table starts from the count last placed at its kind of table, where it still fits.
  const remembered = request === null ? undefined : rememberedSeats.get(stockIdentity(request.catalogueItemId));
  const startCount = current > 0
    ? current
    : remembered === undefined ? range.initial : Math.max(minChairs, Math.min(remembered, maxChairs));

  useEffect(() => {
    if (request === null) return undefined;
    setCount(startCount);
    setDraft(String(startCount));
    setWarning(false);
    // Selected, so the first key typed replaces it.
    const timer = setTimeout(() => { inputRef.current?.select(); }, 80);
    return () => { clearTimeout(timer); };
  }, [startCount, request]);

  // Unmounted mid-fade, the cancel still happens.
  useEffect(() => () => {
    if (leaveTimer.current === null) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
    onCancelRef.current();
  }, []);

  /** Steps from what is typed (held to the range) or else from the last good count. */
  const step = useCallback((by: number) => {
    const typed = draftRef.current.trim();
    const from = /^\d+$/.test(typed) ? Math.max(minChairs, Math.min(Number(typed), maxChairs)) : countRef.current;
    const next = Math.max(minChairs, Math.min(from + by, maxChairs));
    setCount(next);
    setDraft(String(next));
    setWarning(false);
  }, [minChairs, maxChairs]);
  const decrement = useCallback(() => { step(-1); }, [step]);
  const increment = useCallback(() => { step(1); }, [step]);

  const minusRepeat = useRepeatButton(decrement);
  const plusRepeat = useRepeatButton(increment);

  const place = useCallback((seats: number) => {
    if (request === null || leaveTimer.current !== null) return;
    if (seats > 0) rememberedSeats.set(stockIdentity(request.catalogueItemId), seats);
    onConfirm(seats);
  }, [request, onConfirm]);

  /** Enter or the place button: places the typed count, or says what the table takes and places nothing. */
  const commit = useCallback(() => {
    const seats = seatsFromDraft(draftRef.current, minChairs, maxChairs);
    if (seats !== null) { place(seats); return; }
    setWarning(true);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [minChairs, maxChairs, place]);

  const cancel = useCallback(() => {
    if (leaveTimer.current !== null) return;
    if (prefersReducedMotion()) { onCancelRef.current(); return; }
    setLeaving(true);
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      setLeaving(false);
      onCancelRef.current();
    }, CHAIR_DIALOG_CANCEL_FADE_MS);
  }, []);

  // The dialog holds the keyboard while it is open, its fade included: Escape
  // cancels it, and only its own keys below answer (the planner's shortcuts wait).
  useEscapeLayer("modal", { open: request !== null, onEscape: cancel });
  usePlannerKeyBindings([
    // Enter places the seats, from the count too. Enter on a focused button
    // presses that button (Cancel, Table only or a stepper): the keyboard
    // owner leaves it to the button.
    {
      keys: anyModifier(["Enter", "NumpadEnter"]),
      run: commit,
      when: () => asking,
      inFields: true,
      duringModal: true,
    },
    // The arrows step the count. In the count itself they are the number
    // field's own, which steps it natively.
    {
      keys: anyModifier(["ArrowUp", "ArrowRight"]),
      run: increment,
      when: () => asking,
      repeat: true,
      duringModal: true,
    },
    {
      keys: anyModifier(["ArrowDown", "ArrowLeft"]),
      run: decrement,
      when: () => asking,
      repeat: true,
      duringModal: true,
    },
  ]);

  if (request === null) return null;

  const round = request.tableShape === "round";
  const shapeLabel = round ? "Round Table" : "Rectangular Table";
  const editing = existingTable !== undefined;
  // The place button names the whole number in the field, one the table cannot take included, so the press that
  // refuses it reads as the check it is rather than a promise broken; with no number typed it names the last count.
  const typedSeats = /^\d+$/.test(draft.trim()) ? Number(draft.trim()) : null;
  const shown = seatsFromDraft(draft, minChairs, maxChairs) ?? (typedSeats !== null && typedSeats > 0 ? typedSeats : count);
  const placeLabel = editing
    ? (shown === 0 ? "No seats" : `Set ${String(shown)} ${plural(shown, "seat", "seats")}`)
    : (shown === 0 ? "Place the table only" : `Place with ${String(shown)} ${plural(shown, "seat", "seats")}`);
  const rangeHint = maxChairs > 0 ? `${String(minChairs)} – ${String(maxChairs)} seats` : "No seats fit at this scale";
  const takes = minChairs === maxChairs ? String(minChairs) : `${String(minChairs)} to ${String(maxChairs)}`;
  const rangeWarning = maxChairs === 0 ? "No seats fit at this scale" : `${round ? "Rounds take" : "This table takes"} ${takes}`;

  // Escape the transformed planner stage so scene controls cannot cover the modal.
  return createPortal(
    <div
      data-testid="chair-count-dialog"
      data-leaving={leaving ? "true" : undefined}
      className="omni-chair-modal"
      style={{
        position: "fixed", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, pointerEvents: leaving ? "none" : "auto", padding: 16, boxSizing: "border-box",
        background: "rgba(0, 0, 0, 0.55)",
        animation: leaving
          ? `omni-v3-out ${String(CHAIR_DIALOG_CANCEL_FADE_MS)}ms ease-in forwards`
          : "omni-v3-in 120ms ease-out",
      }}
      onClick={cancel}
      role="dialog"
      aria-modal="true"
      aria-hidden={leaving ? true : undefined}
      aria-labelledby="chair-dialog-title"
    >
      {/* Panel */}
      <div
        ref={trapRef}
        style={{
          background: "rgba(16, 16, 16, 0.97)",
          borderRadius: 24,
          padding: "clamp(24px, 5vw, 52px) clamp(24px, 6vw, 64px) clamp(24px, 4vw, 44px)",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "clamp(24px, 4vw, 36px)",
          boxShadow: "0 32px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(201, 138, 91,0.12), inset 0 1px 0 rgba(255,255,255,0.05)",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          color: "#fff",
          width: "min(508px, 100%)", minWidth: 0, boxSizing: "border-box",
          maxHeight: "100%", overflowY: "auto",
          border: "1px solid rgba(201, 138, 91, 0.15)",
        }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        {/* Gold accent line */}
        <div style={{
          height: 2, borderRadius: 1,
          background: `linear-gradient(90deg, transparent, ${GOLD}, transparent)`,
          marginBottom: -20,
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
            fontSize: "clamp(22px, 4.5vw, 28px)", fontWeight: 700, letterSpacing: -0.5,
            color: "#f5f5f5",
            fontFamily: "'Playfair Display', serif",
          }}>
            {round ? "Seats at this round" : "Seats at this table"}
          </div>
        </div>

        {/* Stepper — large, spacious, magnetic */}
        <div style={{
          display: "flex", alignItems: "center",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 16,
          border: "1px solid rgba(201, 138, 91, 0.2)",
          overflow: "hidden",
        }}>
          {/* Minus */}
          <button
            type="button"
            className="omni-v2-stepper-btn"
            style={{
              width: 72, height: 76, border: "none",
              borderRight: "1px solid rgba(201, 138, 91, 0.12)",
              background: "transparent",
              color: shown <= minChairs ? "var(--house-text-3)" : GOLD_LIGHT,
              fontSize: 28, fontWeight: 400, cursor: shown <= minChairs ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              userSelect: "none",
              transition: "background 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            // A pointer steps on press (and repeats while held); Enter or Space steps on the click they make.
            onClick={(e) => { if (e.detail === 0) decrement(); }}
            onPointerDown={minusRepeat.onPointerDown}
            onPointerUp={minusRepeat.onPointerUp}
            onPointerLeave={minusRepeat.onPointerLeave}
            disabled={shown <= minChairs}
            aria-label="Fewer seats"
          >
            −
          </button>

          {/* Count */}
          <div style={{ position: "relative" }}>
            <input
              ref={inputRef}
              className="omni-chair-input"
              type="number"
              inputMode="numeric"
              min={minChairs}
              max={maxChairs}
              value={draft}
              aria-label="Seats"
              aria-invalid={warning ? true : undefined}
              onChange={(e) => {
                // No table seats a thousand: three characters keep the field and the button that names it readable.
                const text = e.target.value.slice(0, 3);
                setDraft(text);
                const seats = seatsFromDraft(text, minChairs, maxChairs);
                if (seats !== null) { setCount(seats); setWarning(false); }
              }}
              onBlur={() => {
                // Left empty, it shows the count it had; left out of range, it says so and keeps what was typed.
                if (draftRef.current.trim() === "") { setDraft(String(countRef.current)); return; }
                if (seatsFromDraft(draftRef.current, minChairs, maxChairs) === null) setWarning(true);
              }}
              style={{
                width: 110, height: 76, border: "none",
                background: "rgba(255,255,255,0.02)",
                color: "#fff", fontSize: 40, fontWeight: 700,
                textAlign: "center", fontVariantNumeric: "tabular-nums",
                appearance: "textfield", MozAppearance: "textfield", WebkitAppearance: "none",
                padding: 0, fontFamily: "'Inter', system-ui, sans-serif",
              }}
            />
          </div>

          {/* Plus */}
          <button
            type="button"
            className="omni-v2-stepper-btn"
            style={{
              width: 72, height: 76, border: "none",
              borderLeft: "1px solid rgba(201, 138, 91, 0.12)",
              background: "transparent",
              color: shown >= maxChairs ? "var(--house-text-3)" : GOLD_LIGHT,
              fontSize: 28, fontWeight: 400, cursor: shown >= maxChairs ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              userSelect: "none",
              transition: "background 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            onClick={(e) => { if (e.detail === 0) increment(); }}
            onPointerDown={plusRepeat.onPointerDown}
            onPointerUp={plusRepeat.onPointerUp}
            onPointerLeave={plusRepeat.onPointerLeave}
            disabled={shown >= maxChairs}
            aria-label="More seats"
          >
            +
          </button>
        </div>

        {/* What the table takes: a quiet hint, or why a typed count cannot be placed */}
        {warning ? (
          <div role="alert" style={{
            fontSize: 13, color: "var(--house-accent-copper-bright)", marginTop: -20,
            letterSpacing: 0.8, fontWeight: 500,
          }}>
            {rangeWarning}
          </div>
        ) : (
          <div style={{
            fontSize: 13, color: "var(--house-text-2)", marginTop: -20,
            letterSpacing: 0.8, fontWeight: 400,
          }}>
            {rangeHint}
          </div>
        )}

        {/* Primary CTA */}
        <button
          type="button"
          data-testid="chair-count-confirm"
          className="omni-v2-cta"
          style={{
            width: "100%", padding: "18px 0",
            borderRadius: 14, border: "none",
            background: `linear-gradient(135deg, ${GOLD_DARK} 0%, ${GOLD} 40%, ${GOLD_LIGHT} 100%)`,
            color: "#0e0e0e", fontSize: 17, fontWeight: 700,
            cursor: "pointer", letterSpacing: 0.6,
            transition: "transform 160ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
            boxShadow: "0 6px 32px rgba(201, 138, 91,0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
          onClick={commit}
        >
          {placeLabel}
        </button>

        {/* Secondary row */}
        <div style={{ display: "flex", gap: 16, marginTop: -8 }}>
          <button
            type="button"
            className="omni-v2-sec"
            style={{
              padding: "10px 24px", borderRadius: 10,
              border: "1px solid rgba(201, 138, 91, 0.18)",
              background: "transparent", color: GOLD,
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              letterSpacing: 0.3, transition: "background 0.25s ease, border-color 0.25s ease, color 0.25s ease",
            }}
            onClick={() => { place(0); }}
          >
            Table only
          </button>
          <button
            type="button"
            className="omni-v2-cancel"
            style={{
              padding: "10px 24px", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.06)",
              // Quiet but readable: #555 read 2.6:1 on the panel; this is 5.6:1.
              background: "transparent", color: "rgba(246, 241, 232, 0.55)",
              fontSize: 14, fontWeight: 500, cursor: "pointer",
              letterSpacing: 0.3, transition: "color 0.25s ease, border-color 0.25s ease",
            }}
            onClick={cancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
