import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from "react";
import { Users } from "lucide-react";
import { CAPACITY_FORMATS } from "@omnitwin/types";
import { ActivityStatus } from "../../shared/Activity.js";
import { LensPanel, LensPanelSection, LensPanelMetric } from "./LensPanel.js";
import { NotRecorded } from "./NotRecorded.js";
import { AutoFillPrompt } from "./AutoFillPrompt.js";
import { SeatShortfallFix } from "./SeatShortfallFix.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useAutoFillRequestStore } from "../../../stores/auto-fill-request-store.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import { MAX_GUEST_FLOW_AGENTS } from "../../../lib/guest-flow-layout-input.js";
import {
  buildGuestsCapacityModel,
  seatSufficiencyLabel,
  type GuestsCapacityModel,
} from "../../../lib/cockpit-guests-model.js";
import {
  GENERIC_ESTIMATE_LABEL,
  guestsAbovePublished,
  publishedCapacityRows,
} from "../../../lib/planner-truth.js";
import { usePlannerTruth, type PlannerTruth } from "../../../hooks/use-planner-truth.js";
import {
  AUTO_FILL_STYLES,
  autoFillPlacedLine,
  autoFillStyleOption,
  occasionPhrase,
  publishedFigureFor,
  roomAtSpacingLine,
  type AutoFillPlan,
  type AutoFillStyle,
} from "../../../lib/auto-fill.js";
import type { PlacedItem } from "../../../lib/placement.js";
import { sceneFurniturePlacements } from "../../../lib/table-dressing.js";

// ---------------------------------------------------------------------------
// GuestsLensPanel — guests & seating.
//
// Leads with the venue's own published figure for the room, by layout, with
// who stated it and when ("Published guide · Trades Hall · 9 Jul 2026"), and
// marks the format the layout on the floor is read against (standing
// reception for the planner's "cocktail"). Below it, the planner's own
// arithmetic: is there a seat for every guest. Floor area ÷ generic spacing
// is shown to venue staff only, labelled as an estimate, never as the room's
// capacity, and nothing here says fits, tight or over (redteam fix-first 1).
// The guest count is the SAME cockpit-store field the Flow, Costs and Share
// lenses read, so setting it here flows everywhere.
//
// Building the room asks "How many guests?" first (AutoFillPrompt), and says
// what it placed; a seat shortfall offers one fix beside the line that states
// it (SeatShortfallFix). Redteam fix-first 15.
// ---------------------------------------------------------------------------

type ChipTone = "ok" | "review" | "info";

function seatChip(model: GuestsCapacityModel): { readonly tone: ChipTone; readonly label: string } {
  switch (model.seatStatus) {
    case "short": return { tone: "review", label: `Short ${String(Math.abs(model.seatBalance ?? 0))}` };
    case "spare": return { tone: "ok", label: `${String(model.seatBalance ?? 0)} spare` };
    case "exact": return { tone: "ok", label: "Every guest seated" };
    case "unset": return { tone: "info", label: "No guest count" };
  }
}

function seatBalanceText(model: GuestsCapacityModel): string {
  if (model.seatBalance === null) return "—";
  if (model.seatBalance === 0) return "Exact";
  if (model.seatBalance > 0) return `${String(model.seatBalance)} spare`;
  return `${String(Math.abs(model.seatBalance))} short`;
}

function formatArea(areaM2: number): string {
  return `${areaM2.toLocaleString("en-GB", { maximumFractionDigits: 1 })} m²`;
}

/** The venue's published figures for the open room, or the honest gap. */
function PublishedSection({ model, truth }: { readonly model: GuestsCapacityModel; readonly truth: PlannerTruth }): ReactElement {
  const { published } = truth;

  if (published.kind === "reading") {
    return (
      <LensPanelSection label="Published capacity">
        <div data-testid="guests-published-reading">
          <ActivityStatus className="lens-panel__field-hint">Reading the venue&apos;s published figures…</ActivityStatus>
        </div>
      </LensPanelSection>
    );
  }

  if (published.kind === "not-published") {
    return (
      <LensPanelSection label="Published capacity">
        <NotRecorded label="Published capacity" ask={truth.ask("room-capacity")} testId="guests-published-missing" />
      </LensPanelSection>
    );
  }

  const rows = publishedCapacityRows(published.capacity, model.publishedFormat);
  const format = model.publishedFormat;
  const above = guestsAbovePublished(model.guestCount, published.capacity, format);
  const formatLabel = format === null ? null : CAPACITY_FORMATS.find((f) => f.key === format)?.label.toLowerCase() ?? null;
  const headcountAsk = above !== null && model.guestCount !== null && format !== null && formatLabel !== null
    ? truth.ask({ kind: "headcount", guests: model.guestCount, figure: published.capacity[format], formatLabel })
    : null;

  return (
    <LensPanelSection label="Published capacity">
      <ul className="lens-panel__published" data-testid="guests-published">
        {rows.map((row) => (
          <li
            key={row.format}
            className={row.onFloor ? "lens-panel__published-row is-on-floor" : "lens-panel__published-row"}
            data-testid={`guests-published-${row.format}`}
            aria-current={row.onFloor ? "true" : undefined}
          >
            <span className="lens-panel__published-format">
              {row.label}
              <small>{row.description}</small>
              {row.onFloor && <span className="lens-panel__published-mark">Your layout</span>}
            </span>
            <span className="lens-panel__published-figure">{String(row.figure)}</span>
          </li>
        ))}
      </ul>
      <p className="lens-panel__stated" data-testid="guests-published-source">{published.source}</p>
      {above !== null && headcountAsk !== null && (
        <div className="lens-panel__row lens-panel__row--review" data-testid="guests-above-published">
          <span className="lens-panel__row-title">{above}</span>
          {headcountAsk.href !== null ? (
            <a className="lens-panel__ask" href={headcountAsk.href} data-testid="guests-above-published-ask">
              {headcountAsk.label}
            </a>
          ) : (
            <span className="lens-panel__unrecorded-hint">{headcountAsk.fallback}</span>
          )}
        </div>
      )}
    </LensPanelSection>
  );
}

/** Staff-only: floor area ÷ generic spacing, every style. Never a capacity. */
function GenericEstimateSection({ model }: { readonly model: GuestsCapacityModel }): ReactElement | null {
  if (model.floorAreaM2 <= 0) return null;
  return (
    <LensPanelSection label={GENERIC_ESTIMATE_LABEL}>
      <p className="lens-panel__field-hint" data-testid="guests-estimates-basis">
        {formatArea(model.floorAreaM2)} of floor divided by generic space per guest. Shown to venue staff only; not the venue&apos;s figure.
      </p>
      <ul className="lens-panel__estimates" data-testid="guests-estimates">
        {model.estimates.map((row) => (
          <li key={row.style} className="lens-panel__estimate" data-testid={`guests-estimate-${row.style}`}>
            <span>{row.label}</span>
            <span className="lens-panel__estimate-figure">{String(row.estimate)}</span>
          </li>
        ))}
      </ul>
    </LensPanelSection>
  );
}

export function GuestsLensPanel(): ReactElement {
  const placedItems = usePlacementStore((state) => state.placedItems);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const setPlannedGuestCount = useCockpitStore((state) => state.setPlannedGuestCount);
  const sceneItems = useMemo(() => sceneFurniturePlacements(placedItems), [placedItems]);
  const truth = usePlannerTruth();

  const model = useMemo(
    () => buildGuestsCapacityModel({
      placedItems,
      roomWidthM: dimensions.width / RENDER_SCALE,
      roomLengthM: dimensions.length / RENDER_SCALE,
      guestCount: plannedGuestCount,
    }),
    [placedItems, dimensions, plannedGuestCount],
  );

  const onGuestCount = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.trim();
    if (raw === "") { setPlannedGuestCount(null); return; }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    setPlannedGuestCount(Math.max(1, Math.min(MAX_GUEST_FLOW_AGENTS, parsed)));
  };

  const seat = seatChip(model);

  // The floor's published format, for the shortfall's "nothing fits" line and
  // the one question to ask. Above the published figure, the Published
  // section already carries the ask; one next step, not two.
  const floorFigure = model.publishedFormat === null ? null : publishedFigureFor(truth.published, model.publishedFormat);
  const shortfallAsk = model.guestCount !== null && (floorFigure === null || model.guestCount <= floorFigure.figure)
    ? truth.ask({
      kind: "layout",
      guests: model.guestCount,
      seatsPlaced: model.seatsProvided,
      occasion: model.publishedFormat === null ? "our event" : occasionPhrase(model.publishedFormat),
    })
    : null;

  // Layouts the planner can lay out for a guest count. Only offered on a blank
  // floor so it never wipes work in progress (auto-arrange replaces the layout).
  const canBuild = sceneItems.length === 0;
  const [choosing, setChoosing] = useState<AutoFillStyle | null>(null);
  const [filled, setFilled] = useState<{ readonly plan: AutoFillPlan; readonly after: readonly PlacedItem[] } | null>(null);
  const choiceRefs = useRef(new Map<AutoFillStyle, HTMLButtonElement>());
  const resultRef = useRef<HTMLDivElement>(null);

  // The command deck's Auto-fill asks here, with the style already chosen.
  const requested = useAutoFillRequestStore((state) => state.requested);
  useEffect(() => {
    if (requested === null) return;
    const style = useAutoFillRequestStore.getState().take();
    if (style !== null && canBuild) setChoosing(style);
  }, [requested, canBuild]);

  const fillCurrent = filled !== null && filled.after === placedItems ? filled : null;
  useEffect(() => {
    if (fillCurrent !== null) resultRef.current?.focus({ preventScroll: true });
  }, [fillCurrent]);

  const onPlaced = (plan: AutoFillPlan): void => {
    setChoosing(null);
    setFilled({ plan, after: usePlacementStore.getState().placedItems });
  };
  const onBack = (): void => {
    const style = choosing;
    setChoosing(null);
    // Back where the question was asked from.
    if (style !== null) window.setTimeout(() => { choiceRefs.current.get(style)?.focus(); }, 0);
  };
  const fillShort = fillCurrent === null
    ? null
    : roomAtSpacingLine(fillCurrent.plan, publishedFigureFor(truth.published, autoFillStyleOption(fillCurrent.plan.style).format));

  return (
    <LensPanel
      title="Guests & seating"
      icon={<Users size={18} />}
      source={truth.published.kind === "published" ? "Published guide" : "Planning"}
      testId="guests-lens-panel"
      footer="Published figures are the venue's planning guide; final numbers depend on your layout and are confirmed by the events team."
    >
      <PublishedSection model={model} truth={truth} />

      <LensPanelSection label="Headcount">
        <label className="lens-panel__field lens-panel__field--inline">
          <span className="lens-panel__field-label">Expected guests</span>
          <input
            className="lens-panel__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GUEST_FLOW_AGENTS}
            value={plannedGuestCount === null ? "" : String(plannedGuestCount)}
            placeholder="Set count"
            onChange={onGuestCount}
            data-testid="guests-count"
            aria-label="Expected guests"
          />
        </label>
      </LensPanelSection>

      <LensPanelSection label="Seats">
        <div className="lens-panel__chips">
          <span className={`lens-panel__chip lens-panel__chip--${seat.tone}`} data-testid="guests-seat-chip">{seat.label}</span>
        </div>
        <p className="lens-panel__paragraph" data-testid="guests-seat-summary">{seatSufficiencyLabel(model)}</p>
        <SeatShortfallFix testId="guests-seat-fix" published={floorFigure} ask={shortfallAsk} />
        <LensPanelMetric label="Seats placed" value={String(model.seatsProvided)} />
        <LensPanelMetric label="Seat balance" value={seatBalanceText(model)} />
      </LensPanelSection>

      {truth.staff && <GenericEstimateSection model={model} />}

      <LensPanelSection label="Build this room">
        {canBuild && choosing !== null ? (
          <AutoFillPrompt
            key={choosing}
            style={choosing}
            published={truth.published}
            onPlaced={onPlaced}
            onCancel={onBack}
          />
        ) : canBuild ? (
          <div className="lens-panel__share-buttons">
            {AUTO_FILL_STYLES.map((b) => (
              <button
                key={b.style}
                ref={(node) => {
                  if (node === null) choiceRefs.current.delete(b.style);
                  else choiceRefs.current.set(b.style, node);
                }}
                type="button"
                className="lens-panel__chip-link auto-fill__choice"
                onClick={() => { setChoosing(b.style); }}
                data-testid={`guests-build-${b.style}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        ) : fillCurrent !== null ? (
          <div className="auto-fill__result" ref={resultRef} tabIndex={-1} data-testid="auto-fill-result">
            <p className="auto-fill__placed" data-testid="auto-fill-placed">{autoFillPlacedLine(fillCurrent.plan)}</p>
            {fillShort !== null && <p className="auto-fill__short" data-testid="auto-fill-result-short">{fillShort}</p>}
          </div>
        ) : (
          <p className="lens-panel__field-hint" data-testid="guests-build-blocked">Clear the floor to lay out a fresh room.</p>
        )}
      </LensPanelSection>
    </LensPanel>
  );
}
