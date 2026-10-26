import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { Sun } from "lucide-react";
import { CHIP_DRAG_THRESHOLD_PX, chipScrubbedHour, turnedHour, wheelNotches, wheelPixels } from "../../lib/evening-input.js";
import { chipGlyph, skyAt, type ChipGlyph } from "../../lib/evening-sky.js";
import { KEY_PRIORITY, letter, useEscapeLayer, usePlannerKeyBindings } from "../../lib/planner-keys.js";
import { formatWallTime } from "../../pages/diary/lib/board-time.js";
import { useHallTimeStore } from "../../stores/hall-time-store.js";
import { moonPhasePath } from "../editor/cockpit/HallSunDial.js";
import { feelTheHour } from "./evening-feedback.js";
import { useEveningSource, useHourSetsTheLight, useLayoutOpeningHour, useShownHour } from "./evening-hour.js";
import { heldHour, rememberShownHour, restoreHour, useEveningStore, type HeldHour } from "./evening-state.js";
import { Key } from "./Keys.js";
import "./chrome.css";
import "./evening.css";

// ---------------------------------------------------------------------------
// The hour chip (T-674, v2 slice 10; spec 4.1, 6.2, 11; frames 01, 03).
//
// A key in the dock between Walk and Add: a 20 px glyph and the hour in
// Newsreader 20. By day the sun; by night the moon in its true phase (waning
// lit on the left, as Glasgow sees it), drawn in line while it is below the
// horizon, when its name says "the moon not yet risen". Click or T opens the
// evening; T or a click again keeps the hour and closes it. Drag the chip
// sideways to scrub without opening it (1 px = 2 min, Shift 10 s; Esc puts
// the hour back), or scroll over it, 15 minutes a notch (Shift 1 minute).
// Each kept change is the hour this layout opens at next time.
//
// The chip also carries the hour's standing work, since it is always in the
// dock: it reads the event's acts once, opens each layout at its hour, and
// lets the hour set the hall's light where the real sky is not on.
// ---------------------------------------------------------------------------

/** The evening panel's id, for the chip's aria-controls. */
export const EVENING_PANEL_ID = "planner-evening";

/**
 * The evening's keys outrank the planner's own tier and the selection's: v1's
 * hidden tape measure (TapeMeasure.tsx) still binds T at the planner tier, and
 * under v2 T is the evening's (spec 11; its retirement is requested in WIRING).
 */
export const EVENING_KEY_PRIORITY = KEY_PRIORITY.selection + 1;

export interface MoonGlyphProps {
  readonly lit: number;
  readonly waxing: boolean;
  /** Below the horizon it is drawn in line: its limb and terminator as hairlines, the lit side barely filled. */
  readonly risen: boolean;
  readonly size?: number;
  readonly className?: string;
}

/** The moon in its true phase (moonPhasePath: waxing lit on the right, waning on the left). */
export function MoonGlyph({ lit, waxing, risen, size = 20, className }: MoonGlyphProps): ReactElement {
  const path = moonPhasePath(10, lit, waxing);
  return (
    <svg
      className={["pc-moon", risen ? "" : "pc-moon--down", className ?? ""].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="-12 -12 24 24"
      aria-hidden="true"
    >
      {risen ? (
        <>
          <circle className="pc-moon__dark" r={10} />
          <circle className="pc-moon__shine" r={10} />
          <path className="pc-moon__lit" d={path} />
        </>
      ) : (
        <>
          <circle className="pc-moon__limb" r={9.5} />
          <path className="pc-moon__line" d={path} />
        </>
      )}
    </svg>
  );
}

/** The chip's glyph: the sun, or the moon as it stands. */
export function HourGlyph({ glyph }: { readonly glyph: ChipGlyph }): ReactElement {
  if (glyph.kind === "sun") return <Sun className="pc-icon pc-icon--20 pc-hourchip__sun" aria-hidden="true" />;
  return <MoonGlyph lit={glyph.lit} waxing={glyph.waxing} risen={glyph.risen} />;
}

/** The chip in the dock: the element the evening hands focus back to. */
export function hourChipElement(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-pc-hourchip]");
}

/** Opens the evening, or keeps the hour and closes it. */
export function toggleEvening(): void {
  const evening = useEveningStore.getState();
  if (!evening.open) {
    evening.openEvening();
    return;
  }
  evening.keepEvening();
  hourChipElement()?.focus({ preventScroll: true });
}

interface ChipDrag {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly x: number;
  /** The hour as it stood before the press (Esc returns to it). */
  readonly from: HeldHour;
  readonly startAt: number;
  lastAt: number;
  scrubbing: boolean;
}

export function HourChip(): ReactElement {
  const source = useEveningSource();
  useLayoutOpeningHour(source);
  const { at } = useShownHour();
  useHourSetsTheLight(at);
  const open = useEveningStore((state) => state.open);
  const keyRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<ChipDrag | null>(null);
  const swallowClick = useRef(false);
  const latest = useRef({ at, acts: source.acts });
  latest.current = { at, acts: source.acts };

  const glyph = chipGlyph(skyAt(at));
  const clock = formatWallTime(at);
  const tip = `Time of day ${clock}${glyph.kind === "moon" && !glyph.risen ? ", the moon not yet risen" : ""}`;

  usePlannerKeyBindings([{ keys: letter("t"), priority: EVENING_KEY_PRIORITY, run: toggleEvening }]);

  const endDrag = useCallback((pointerId: number): ChipDrag | null => {
    const held = drag.current;
    if (held === null || held.pointerId !== pointerId) return null;
    drag.current = null;
    const button = keyRef.current;
    try {
      if (button?.hasPointerCapture(pointerId) === true) button.releasePointerCapture(pointerId);
    } catch {
      // The pointer is already gone.
    }
    return held;
  }, []);

  // A scrub in progress is an operation: Esc puts the hour back as it was.
  useEscapeLayer("operation", {
    open: () => drag.current?.scrubbing === true,
    onEscape: () => {
      const held = drag.current;
      if (held === null) return;
      endDrag(held.pointerId);
      swallowClick.current = true;
      restoreHour(held.from);
      useHallTimeStore.getState().endScrub();
    },
  });

  // Native listeners: the tooltip owns the key's React pointer props, and a
  // wheel listener must not be passive or the room would zoom as well.
  useEffect(() => {
    const button = keyRef.current;
    if (button === null) return undefined;
    let carried = 0;
    const onDown = (event: PointerEvent): void => {
      swallowClick.current = false;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      drag.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        x: event.clientX,
        from: heldHour(),
        startAt: latest.current.at,
        lastAt: latest.current.at,
        scrubbing: false,
      };
    };
    const onMove = (event: PointerEvent): void => {
      const held = drag.current;
      if (held?.pointerId !== event.pointerId) return;
      const dx = event.clientX - held.x;
      if (!held.scrubbing) {
        if (Math.abs(dx) < CHIP_DRAG_THRESHOLD_PX) return;
        held.scrubbing = true;
        try { button.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
      }
      const next = chipScrubbedHour(held.startAt, dx, event.shiftKey);
      if (next === held.lastAt) return;
      feelTheHour(held.lastAt, next, latest.current.acts, held.pointerType);
      held.lastAt = next;
      useHallTimeStore.getState().setTime(next, true);
    };
    const onUp = (event: PointerEvent): void => {
      const held = endDrag(event.pointerId);
      if (held === null || !held.scrubbing) return;
      // The press was a scrub, not a click.
      swallowClick.current = true;
      useHallTimeStore.getState().endScrub();
      // While the evening is open the hour is held there: Enter keeps it, Esc returns.
      if (!useEveningStore.getState().open) rememberShownHour();
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const turned = wheelNotches(carried, wheelPixels(event, window.innerHeight));
      carried = turned.rest;
      if (turned.notches === 0) return;
      useHallTimeStore.getState().setTime(turnedHour(latest.current.at, turned.notches, event.shiftKey));
      if (!useEveningStore.getState().open) rememberShownHour();
    };
    button.addEventListener("pointerdown", onDown);
    button.addEventListener("pointermove", onMove);
    button.addEventListener("pointerup", onUp);
    button.addEventListener("pointercancel", onUp);
    button.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      button.removeEventListener("pointerdown", onDown);
      button.removeEventListener("pointermove", onMove);
      button.removeEventListener("pointerup", onUp);
      button.removeEventListener("pointercancel", onUp);
      button.removeEventListener("wheel", onWheel);
    };
  }, [endDrag]);

  return (
    <Key
      ref={keyRef}
      label={clock}
      icon={<HourGlyph glyph={glyph} />}
      tip={tip}
      shortcut={["T"]}
      on={open}
      marked
      expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? EVENING_PANEL_ID : undefined}
      className="pc-hourchip"
      data-pc-hourchip=""
      data-testid="planner-hour-chip"
      onPress={() => {
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        toggleEvening();
      }}
    />
  );
}
