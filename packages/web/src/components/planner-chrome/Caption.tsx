import { AlignCenterHorizontal, Copy, Move, PackageMinus, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { captionAisles, captionModel, type CaptionModel, type CaptionVerb } from "../../lib/caption-model.js";
import { placeCaption } from "../../lib/caption-placement.js";
import { plannerFeatureEnabled } from "../../lib/planner-features.js";
import {
  QUARTER_TURN_RAD,
  changeSeatsAtSelectedTables,
  duplicateSelection,
  lineUpSelection,
  moveSelectionTo,
  removeSelection,
  toggleClothOnSelection,
  turnSelection,
} from "../../lib/planner-keymap.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { pickFloorAt, registerScreenAnchor, requestScreenAnchorFrame, type ScreenPoint } from "../../lib/screen-anchors.js";
import { DANCE_FLOOR_PANELS } from "../../lib/setup-cards.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { Stepper } from "./Controls.js";
import { ClothGlyph } from "./glyphs.js";
import { Key } from "./Keys.js";
import "./chrome.css";
import "./caption.css";

// ---------------------------------------------------------------------------
// The caption (T-671 slice 11′; approved spec §6.6). Beside the selected
// piece, joined to a pin on it by a copper hairline: its number, its card's
// name and size, the seat stepper (the only place it shows seats) and the
// verbs. Each verb runs the same command as its key, so a button and a key
// never disagree. It follows its piece every frame through the screen anchors
// with no spring of its own, docks to the nearest edge when the piece leaves
// the view, never covers the dock, and steps aside for a card in hand, Walk
// and a view-only layout.
// ---------------------------------------------------------------------------

const ANCHOR_ID = "caption";

interface VerbKey {
  readonly label: string;
  readonly tip?: string;
  readonly icon: ReactNode;
  readonly shortcut: readonly string[];
  readonly run: () => boolean;
}

/**
 * Each verb's command, shared with its key (lane E's for Duplicate and Line
 * up). A verb without a command here is never drawn.
 */
const VERB_KEYS: Partial<Record<CaptionVerb, VerbKey>> = {
  turn: {
    label: "Turn",
    tip: "Turn a quarter",
    icon: <RotateCw className="pc-icon" aria-hidden="true" />,
    shortcut: ["R"],
    run: () => turnSelection(-QUARTER_TURN_RAD),
  },
  duplicate: {
    label: "Duplicate",
    icon: <Copy className="pc-icon" aria-hidden="true" />,
    shortcut: ["Ctrl", "D"],
    run: duplicateSelection,
  },
  lineUp: {
    label: "Line up",
    tip: "Line up their centres",
    icon: <AlignCenterHorizontal className="pc-icon" aria-hidden="true" />,
    shortcut: [],
    run: lineUpSelection,
  },
  cloth: {
    label: "Cloth",
    tip: "Cloth on or off",
    icon: <ClothGlyph className="pc-icon" />,
    shortcut: ["C"],
    run: toggleClothOnSelection,
  },
  remove: {
    label: "Remove",
    tip: "Remove, back to the store",
    icon: <PackageMinus className="pc-icon" aria-hidden="true" />,
    shortcut: ["Delete"],
    run: removeSelection,
  },
};

/** One verb's key, running its command, then `after` when it did something. */
function VerbButton({ verb, after }: { readonly verb: CaptionVerb; readonly after?: () => void }): ReactElement | null {
  const key = VERB_KEYS[verb];
  if (key === undefined) return null;
  return (
    <Key
      label={key.label}
      tip={key.tip}
      icon={key.icon}
      iconOnly
      small
      shortcut={key.shortcut}
      onPress={() => { if (act(key.run)) after?.(); }}
    />
  );
}

function act(run: () => boolean): boolean {
  const done = run();
  if (done) requestScreenAnchorFrame();
  return done;
}

/** The dock's top, in the layer's pixels: the caption stays above it. */
function dockTop(layer: HTMLElement): number | null {
  const dock = document.querySelector<HTMLElement>("[data-testid='planner-dock-stack']");
  if (dock === null) return null;
  return dock.getBoundingClientRect().top - layer.getBoundingClientRect().top;
}

function nameOf(model: CaptionModel): string {
  return model.label === null ? model.name : `${model.label}, ${model.name}`;
}

export function Caption(): ReactElement | null {
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const placedItems = usePlacementStore((state) => state.placedItems);
  const armed = useCatalogueStore((state) => state.armedCardId);
  const walking = useCockpitStore((state) => state.walkMode);
  const viewOnly = useEditorStore((state) => state.lockReason !== null);
  const model = useMemo(() => captionModel(selectedIds, placedItems, plannerFeatureEnabled), [selectedIds, placedItems]);
  const shown = model !== null && armed === null && !walking && !viewOnly;
  // Move, then tap where it goes (law 11): the next tap on the room is the destination.
  const [moving, setMoving] = useState(false);
  const moveKeyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMoving(false); }, [selectedIds, shown]);
  useEscapeLayer("operation", { open: moving, onEscape: () => { setMoving(false); }, returnFocusTo: moveKeyRef });
  const room = useRoomDimensionsStore((state) => state.dimensions);
  const grandHall = useEditorStore((state) => state.space?.slug === "grand-hall");
  const aisles = useMemo(
    () => (shown && plannerFeatureEnabled("liveAisles") ? captionAisles(selectedIds, placedItems, room, grandHall) : []),
    [shown, selectedIds, placedItems, room, grandHall],
  );

  const layerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const pinRef = useRef<SVGCircleElement>(null);
  const anchor = useRef<CaptionModel["anchor"] | null>(null);
  anchor.current = model?.anchor ?? null;

  useEffect(() => {
    if (!shown) return undefined;
    return registerScreenAnchor(ANCHOR_ID, () => anchor.current, (pin: ScreenPoint) => {
      const layer = layerRef.current;
      const root = rootRef.current;
      if (layer === null || root === null) return;
      // Read everything, then write: one layout per frame.
      const area = { width: layer.clientWidth || window.innerWidth, height: layer.clientHeight || window.innerHeight };
      const box = { width: root.offsetWidth, height: root.offsetHeight };
      const floor = dockTop(layer) ?? area.height;
      const placed = placeCaption(pin, box, area, floor);
      root.style.transform = `translate(${String(Math.round(placed.x))}px, ${String(Math.round(placed.y))}px)`;
      root.dataset["side"] = placed.side;
      root.dataset["placed"] = "";
      if (placed.arrowDeg !== null) root.style.setProperty("--pc-caption-arrow", `${String(Math.round(placed.arrowDeg))}deg`);
      const line = lineRef.current;
      const dot = pinRef.current;
      if (line !== null && dot !== null) {
        const drawn = placed.line !== null;
        line.style.display = drawn ? "" : "none";
        dot.style.display = drawn ? "" : "none";
        if (placed.line !== null) {
          line.setAttribute("x1", String(placed.line.x1));
          line.setAttribute("y1", String(placed.line.y1));
          line.setAttribute("x2", String(placed.line.x2));
          line.setAttribute("y2", String(placed.line.y2));
          dot.setAttribute("cx", String(placed.line.x1));
          dot.setAttribute("cy", String(placed.line.y1));
        }
      }
    });
  }, [shown]);

  if (!shown) return null;

  const landHere = (event: MouseEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = pickFloorAt(event.clientX - box.left, event.clientY - box.top);
    if (at === null) return; // off the floor: still waiting for a tap on it
    act(() => moveSelectionTo(at));
    setMoving(false);
  };
  const name = nameOf(model);
  const verbs = model.verbs.filter((verb) => verb === "move" || VERB_KEYS[verb] !== undefined);
  const panels = model.panels;
  const resize = (cols: number, rows: number): void => {
    if (panels !== null) act(() => usePlacementStore.getState().resizeArea(panels.groupId, cols, rows));
  };

  return (
    <div ref={layerRef} className="pc-caption-layer" data-testid="planner-caption-layer">
      {moving ? <div className="pc-caption__catcher" data-testid="planner-caption-catcher" onClick={landHere} /> : null}
      <svg className="pc-caption__wire" aria-hidden="true">
        <line ref={lineRef} />
        <circle ref={pinRef} r="3" />
      </svg>
      <div ref={rootRef} className="pc-lacquer pc-caption" role="group" aria-label={name} data-side="right">
        <span className="pc-caption__arrow" aria-hidden="true" />
        {moving ? (
          <p className="pc-caption__hint" role="status"><b>Tap where it goes</b> · <b>Esc</b> cancels</p>
        ) : null}
        {model.eyebrow !== null ? <p className="pc-caps pc-caption__eyebrow">{model.eyebrow}</p> : null}
        <p className="pc-title pc-caption__name">{model.name}</p>
        {model.size !== null || aisles.length > 0 ? (
          <dl className="pc-caption__facts">
            {model.size !== null ? (
              <div className="pc-caption__fact">
                <dt>Size</dt>
                <dd>{model.size}</dd>
              </div>
            ) : null}
            {aisles.map((aisle) => (
              <div key={aisle.label} className={`pc-caption__fact pc-caption__fact--${aisle.tone}`}>
                <dt><span className="pc-caption__dash" aria-hidden="true" />{aisle.label}</dt>
                <dd>{aisle.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="pc-caption__verbs" role="group" aria-label={`What to do with ${model.label ?? model.name}`}>
          {model.seats !== null ? (
            <Stepper
              label={`Seats at ${model.label ?? model.name}`}
              value={model.seats.now}
              min={model.seats.min}
              max={model.seats.max}
              unit="seats"
              onChange={(next) => { act(() => changeSeatsAtSelectedTables(next > (model.seats?.now ?? next) ? 1 : -1)); }}
            />
          ) : null}
          {panels !== null ? (
            <>
              <Stepper label="Panels across" value={panels.cols} min={DANCE_FLOOR_PANELS.min} max={DANCE_FLOOR_PANELS.max} unit="across" onChange={(cols) => { resize(cols, panels.rows); }} />
              <Stepper label="Panels deep" value={panels.rows} min={DANCE_FLOOR_PANELS.min} max={DANCE_FLOOR_PANELS.max} unit="deep" onChange={(rows) => { resize(panels.cols, rows); }} />
            </>
          ) : null}
          {verbs.map((verb) => (verb === "move" ? (
            <Key
              key={verb}
              ref={moveKeyRef}
              label="Move"
              tip="Move, then tap where it goes"
              icon={<Move className="pc-icon" aria-hidden="true" />}
              iconOnly
              small
              toggle
              on={moving}
              onPress={() => { setMoving((now) => !now); }}
            />
          ) : (
            <VerbButton
              key={verb}
              verb={verb}
              // Remove puts the piece back in store (card-dock spec §8): the receipt says so, with Undo.
              after={verb === "remove" ? () => { usePlannerChromeStore.getState().postReceipt(`${model.label ?? model.name} put back in store`, { undo: true }); } : undefined}
            />
          )))}
        </div>
      </div>
    </div>
  );
}
