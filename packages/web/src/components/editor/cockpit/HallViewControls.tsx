import { useEffect, type ReactElement } from "react";
import { Box, Flame, Footprints, LayoutGrid, Sparkles, Sun, Sunset, type LucideIcon } from "lucide-react";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useHallViewStore, type HallViewPreset } from "../../../stores/hall-view-store.js";
import { recordPlannerArrivalChoice } from "../../../lib/planner-room-arrival.js";
import type { HallMoodName } from "../../grand-hall/hall-mood.js";

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
