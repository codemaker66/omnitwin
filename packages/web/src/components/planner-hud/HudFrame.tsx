import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { setPlannerChromeFeatures, type PlannerFeatureOverrides } from "../../lib/planner-features.js";
import { hudSkinRequested, type HudSkin } from "../../stores/planner-hud-store.js";
import { FirstOpen, useFirstOpenShowing } from "./FirstOpen.js";
import { Hand } from "./Hand.js";
import { HudFactsProvider } from "./hud-facts.js";
import { HudNotices } from "./HudNotices.js";
import { Journey } from "./Journey.js";
import { PieceCard } from "./PieceCard.js";
import { Seals } from "./Seals.js";
import { useHudSound } from "./use-hud-sound.js";
import { ViewStation } from "./ViewStation.js";
import "./hud.css";
import "./hud-skins.css";

// ---------------------------------------------------------------------------
// The HUD's frame: the room, full bleed, and the stations round it, each in
// its one fixed place (docs/superpowers/specs/2026-11-13-planner-hud-design.md).
// The planner mounts it over its own room and plaque (PlannerHud); the lab
// mounts it over the bare scene, with no backend.
// ---------------------------------------------------------------------------

/**
 * The switches the hand of cards needs, on while the HUD is on screen: a card
 * is set down whole with its seats on it, tables are numbered so the piece
 * card can name them, Copy works, and Lay out keeps what is already placed.
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
  /** Top left: what this is and whether it is saved. */
  readonly plaque: ReactNode;
  /** The linked event's guest count, where there is one. */
  readonly eventGuests: number | null;
  /** The line above the hand: a door in the way, a receipt. */
  readonly notices?: ReactNode;
  /** The sheets the steps open. */
  readonly sheets?: ReactNode;
}

export function HudFrame({ room, plaque, eventGuests, notices, sheets }: HudFrameProps): ReactElement {
  // Set before the first child renders: the hand reads its cards' ranges from these switches.
  const [skin] = useState(() => {
    setPlannerChromeFeatures(HUD_FEATURES);
    return hudSkinRequested(window.location.search);
  });
  useEffect(() => {
    setPlannerChromeFeatures(HUD_FEATURES);
    return () => { setPlannerChromeFeatures({}); };
  }, []);
  useHudSound();

  // The facts sit outside the root: whether the first screen shows is one of them, and the root says so.
  return (
    <HudFactsProvider eventGuests={eventGuests}>
      <HudRoot skin={skin} room={room} plaque={plaque} notices={notices} sheets={sheets} />
    </HudFactsProvider>
  );
}

interface HudRootProps extends Omit<HudFrameProps, "eventGuests"> {
  readonly skin: HudSkin;
}

function HudRoot({ skin, room, plaque, notices, sheets }: HudRootProps): ReactElement {
  const firstOpen = useFirstOpenShowing();
  return (
    <div className="hud-root" data-hud-skin={skin} data-first-open={firstOpen ? "true" : undefined} data-testid="planner-hud">
      <main id="main-content" className="hud-room" aria-label="The room">{room}</main>
      <div className="hud-stations">
        <div className="hud-station hud-station--plaque">{plaque}</div>
        <div className="hud-station hud-station--journey"><Journey /></div>
        <div className="hud-station hud-station--view"><ViewStation /></div>
        <div className="hud-station hud-station--seals"><Seals /></div>
        <div className="hud-station hud-station--piece"><PieceCard /></div>
        <div className="hud-station hud-station--notices"><HudNotices />{notices}</div>
        <div className="hud-station hud-station--hand"><Hand /></div>
      </div>
      {firstOpen ? <FirstOpen /> : null}
      {sheets}
    </div>
  );
}
