import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Box, Flame, Footprints, LayoutGrid, Sparkles, Sun, Sunset, type LucideIcon } from "lucide-react";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useHallViewStore, type HallViewPreset } from "../../../stores/hall-view-store.js";
import { recordPlannerArrivalChoice } from "../../../lib/planner-room-arrival.js";
import type { HallMoodName } from "../../grand-hall/hall-mood.js";
import { hallSkyRequested } from "../../../lib/hall-sky-access.js";
import { HallSunButton, HallSunDial } from "./HallSunDial.js";
import { useEscapeLayer } from "../../../lib/planner-keys.js";

// ---------------------------------------------------------------------------
// HallViewControls — how to look at the Grand Hall, and in what light
//
// Plan looks straight down on the floor, Room frames the whole hall, Walk
// stands you in it. The three lights show the room as guests will meet it:
// by day, in the evening, or by candlelight. A captured room, where one may
// be shown, is a separate choice at the end.
// ---------------------------------------------------------------------------

const VIEWS: readonly { readonly id: HallViewPreset; readonly label: string; readonly hint: string; readonly Icon: LucideIcon }[] = [
  { id: "plan", label: "Plan", hint: "Look straight down on the floor", Icon: LayoutGrid },
  { id: "room", label: "Room", hint: "See the whole hall", Icon: Box },
  { id: "walk", label: "Walk", hint: "Stand in the hall at eye level", Icon: Footprints },
];

const MOODS: readonly { readonly id: HallMoodName; readonly label: string; readonly Icon: LucideIcon }[] = [
  { id: "daylight", label: "Daylight", Icon: Sun },
  { id: "evening", label: "Evening", Icon: Sunset },
  { id: "candlelight", label: "Candlelight", Icon: Flame },
];

export interface HallViewControlsProps {
  /** Whether this device may show the captured room at all. */
  readonly captureAvailable: boolean;
  /** Whether a saved viewpoint holds the camera (the views must wait). */
  readonly povActive: boolean;
  /** Name each light beside its icon: a touch screen shows no hover title. */
  readonly moodLabels?: boolean;
  /** Called once a view has been asked for, so a sheet can step out of the way. */
  readonly onViewChosen?: () => void;
}

export function HallViewControls({ captureAvailable, povActive, moodLabels = false, onViewChosen }: HallViewControlsProps): ReactElement {
  const walkMode = useCockpitStore((s) => s.walkMode);
  const layerMode = useCockpitStore((s) => s.layerMode);
  const cameraInteractionActive = useCockpitStore((s) => s.cameraInteractionActive);
  const transitioning = useBookmarkStore((s) => s.transition !== null);
  const activePreset = useHallViewStore((s) => s.activePreset);
  const mood = useHallViewStore((s) => s.mood);
  const captureUnavailable = useCockpitStore((s) => s.roomResolve.phase === "unavailable");
  const captureShown = captureAvailable && layerMode === "splat" && !captureUnavailable;

  // Turning the camera by hand leaves the named framing behind.
  useEffect(() => {
    if (cameraInteractionActive && !transitioning && !walkMode) useHallViewStore.getState().setActivePreset(null);
  }, [cameraInteractionActive, transitioning, walkMode]);

  const pressedView: HallViewPreset | null = walkMode ? "walk" : activePreset === "walk" ? null : activePreset;
  // Under the real sky the light is an hour of the day, not a mood.
  const skyLight = useMemo(() => typeof window !== "undefined" && hallSkyRequested(window.location.search), []);

  return (
    <div className="cockpit-layer-controls hall-view-controls" role="group" aria-label="Grand Hall view">
      <div className="hall-view-controls__group" role="group" aria-label="View">
        {VIEWS.map(({ id, label, hint, Icon }) => {
          const pressed = pressedView === id;
          // A saved viewpoint owns the camera until it is left (Esc).
          const disabled = povActive;
          return (
            <button
              key={id}
              type="button"
              className={pressed ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
              aria-pressed={pressed}
              disabled={disabled}
              title={disabled ? "Leave the saved viewpoint first (Esc)" : id === "walk" && walkMode ? "Back to the room (Esc)" : hint}
              data-testid={id === "walk" ? "planner-walk-toggle" : `hall-view-${id}`}
              onClick={() => {
                recordPlannerArrivalChoice();
                if (id === "walk" && walkMode) {
                  useHallViewStore.getState().requestView("room");
                } else {
                  // A capture that could not load cannot be walked: walk the drawn hall.
                  if (id === "walk" && captureUnavailable) useCockpitStore.getState().setLayerMode("mesh");
                  useHallViewStore.getState().requestView(id);
                }
                onViewChosen?.();
              }}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
      <span className="cockpit-layer-controls__divider" aria-hidden="true" />
      {skyLight ? (
        moodLabels ? <HallSunDial inline /> : <HallSunPopover />
      ) : (
      <div className="hall-view-controls__group" role="group" aria-label="Light">
        {MOODS.map(({ id, label, Icon }) => {
          const pressed = mood === id;
          return (
            <button
              key={id}
              type="button"
              className={pressed ? "cockpit-layer-btn hall-view-controls__mood is-active" : "cockpit-layer-btn hall-view-controls__mood"}
              aria-pressed={pressed}
              aria-label={label}
              title={label}
              data-testid={`hall-mood-${id}`}
              onClick={() => { useHallViewStore.getState().setMood(id); }}
            >
              <Icon size={15} aria-hidden="true" />
              {moodLabels ? label : null}
            </button>
          );
        })}
      </div>
      )}
      {captureAvailable && (
        <>
          <span className="cockpit-layer-controls__divider" aria-hidden="true" />
          <button
            type="button"
            className={captureShown ? "cockpit-layer-btn is-active" : "cockpit-layer-btn"}
            aria-pressed={captureShown}
            disabled={captureUnavailable}
            title={captureUnavailable ? "The captured room could not load" : captureShown ? "Back to the drawn hall" : "Show the captured room"}
            data-testid="hall-capture-toggle"
            onClick={() => {
              recordPlannerArrivalChoice();
              useCockpitStore.getState().setLayerMode(captureShown ? "mesh" : "splat");
            }}
          >
            <Sparkles size={14} aria-hidden="true" />
            Capture
          </button>
        </>
      )}
    </div>
  );
}

/** How long the time of day's panel stays drawn while it fades out, ms. */
const CLOSE_MS = 200;
/** Between the button and the panel, px (HallSunDial.css: bottom: calc(100% + 12px)). */
const POPOVER_GAP = 12;
/** Kept clear above the panel, px. */
const POPOVER_MARGIN = 8;
/** The least the panel shrinks to, px: its clock, date and Now, and the top of the day. */
const POPOVER_LEAST = 120;

/**
 * The height the panel may take above its button, px: up to the top of the
 * planner's stage, or the foot of the tool pill across it (drawn over the
 * panel), whichever is lower. Undefined while the button is not laid out.
 * The timeline dock below is drawn over the stage too, so the panel never
 * opens downward; on a short stage it scrolls within instead.
 */
function roomAbove(anchor: HTMLElement): number | undefined {
  const box = anchor.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return undefined;
  const stage = anchor.closest(".cockpit-stage");
  let ceiling = Math.max(0, stage === null ? 0 : stage.getBoundingClientRect().top);
  const pill = stage === null ? null : stage.querySelector("[data-testid='planner-tool-pill']");
  if (pill !== null) ceiling = Math.max(ceiling, pill.getBoundingClientRect().bottom);
  return Math.max(POPOVER_LEAST, Math.floor(box.top - POPOVER_GAP - POPOVER_MARGIN - ceiling));
}

/** The light's button and, above it, the time of day. Closes on Escape or a press elsewhere. */
function HallSunPopover(): ReactElement {
  const [open, setOpen] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [room, setRoom] = useState<number | undefined>(undefined);
  const anchor = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) { setDrawn(true); return undefined; }
    const timer = window.setTimeout(() => { setDrawn(false); }, CLOSE_MS);
    return () => { window.clearTimeout(timer); };
  }, [open]);
  // Measured as it opens, before it is painted, and again if the window changes.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = (): void => { if (anchor.current !== null) setRoom(roomAbove(anchor.current)); };
    measure();
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure); };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && anchor.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);
  // A popover in the planner's one Escape order: it closes before the
  // planner steps back anything else (the placing, the selection, the walk).
  // Focus inside the panel would fall to the page as it unmounts: hand it
  // back to the button that opened it.
  useEscapeLayer("popover", {
    open,
    onEscape: () => { setOpen(false); },
    returnFocusTo: () => {
      const focused = document.activeElement;
      return focused !== null && anchor.current?.contains(focused) === true ? trigger.current : null;
    },
  });
  return (
    <div className="hall-sun-anchor" ref={anchor}>
      <HallSunButton ref={trigger} open={open} onToggle={() => { setOpen((value) => !value); }} />
      {drawn && (
        <div className="hall-sun-popover" data-open={open ? "true" : "false"} role="dialog" aria-label="Time of day">
          <HallSunDial maxHeight={room} />
        </div>
      )}
    </div>
  );
}
