import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { setPlannerChromeFeatures, type PlannerFeatureOverrides } from "../../lib/planner-features.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { hudSkinRequested, type HudSkin } from "../../stores/planner-hud-store.js";
import { FirstOpen, useFirstOpenShowing } from "./FirstOpen.js";
import { Hand } from "./Hand.js";
import { HudFactsProvider } from "./hud-facts.js";
import { Journey } from "./Journey.js";
import { useHudSound } from "./use-hud-sound.js";
import { ViewStation } from "./ViewStation.js";
import "./hud.css";
import "./hud-skins.css";
import "./hud-plaque.css";

// ---------------------------------------------------------------------------
// The HUD's frame (D:/claude/planner-hud-20261113/DOCTRINE.md, "letterbox"):
// the hall, full screen, and two bars of one ground over it, like the bars of
// a wide film frame. The top bar holds the plaque, the four steps and the
// view; the shelf at the bottom holds everything the hand does. Nothing else
// is a surface: a sheet and the first screen are the shelf grown upward.
// The planner mounts it over its own room and plaque (PlannerHud); the lab
// mounts it over the bare scene, with no backend.
// ---------------------------------------------------------------------------

/**
 * The switches the hand of cards needs, on while the HUD is on screen: a card
 * is set down whole with its seats on it, tables are numbered so the shelf
 * can name them, Copy works, and Lay out keeps what is already placed.
 */
const HUD_FEATURES: PlannerFeatureOverrides = {
  setupCards: true,
  seatsOnTheCard: true,
  tableSets: true,
  tableNumbers: true,
  editingKeys: true,
  fillKeepOuts: true,
};

export interface HudFrameProps {
  /** The room, full bleed. */
  readonly room: ReactNode;
  /** The top bar's left: what this is and whether it is saved. */
  readonly plaque: ReactNode;
  /** The linked event's guest count, where there is one. */
  readonly eventGuests: number | null;
  /** The sheets the steps open: the shelf, grown. */
  readonly sheets?: ReactNode;
}

/**
 * The hall is shown as a stage under the HUD (grand-hall/hall-stage.ts), and
 * keeps the top bar's height of the canvas dark above its walls for the bar's
 * words: --hud-bar-h in hud.css.
 */
const HUD_STAGE = { skyPx: 48 } as const;

export function HudFrame({ room, plaque, eventGuests, sheets }: HudFrameProps): ReactElement {
  // Set before the first child renders: the hand reads its cards' ranges from
  // these switches, and the room opens on the stage in its first frame.
  const [skin] = useState(() => {
    setPlannerChromeFeatures(HUD_FEATURES);
    useHallViewStore.getState().setStage(HUD_STAGE);
    return hudSkinRequested(window.location.search);
  });
  useEffect(() => {
    setPlannerChromeFeatures(HUD_FEATURES);
    useHallViewStore.getState().setStage(HUD_STAGE);
    return () => {
      setPlannerChromeFeatures({});
      useHallViewStore.getState().setStage(null);
    };
  }, []);
  useHudSound();

  // The facts sit outside the root: whether the first screen shows is one of them, and the root says so.
  return (
    <HudFactsProvider eventGuests={eventGuests}>
      <HudRoot skin={skin} room={room} plaque={plaque} sheets={sheets} />
    </HudFactsProvider>
  );
}

interface HudRootProps extends Omit<HudFrameProps, "eventGuests"> {
  readonly skin: HudSkin;
}

function HudRoot({ skin, room, plaque, sheets }: HudRootProps): ReactElement {
  const firstOpen = useFirstOpenShowing();
  // Held on the stage, the top bar's words stand on the night above the walls; otherwise on a scrim (hud.css).
  const stagePhase = useHallViewStore((state) => state.stagePhase);
  return (
    <div className="hud-root" data-hud-skin={skin} data-stage={stagePhase} data-first-open={firstOpen ? "true" : undefined} data-testid="planner-hud">
      <main id="main-content" className="hud-room" aria-label="The room">{room}</main>
      <div className="hud-bar">
        <div className="hud-bar__plaque">{plaque}</div>
        <Journey />
        <ViewStation />
      </div>
      <Hand>
        {firstOpen ? <FirstOpen /> : null}
        {sheets}
      </Hand>
    </div>
  );
}
