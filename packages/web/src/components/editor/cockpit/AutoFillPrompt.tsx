import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { ActivityStatus } from "../../shared/Activity.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useEditorStore } from "../../../stores/editor-store.js";
import { RENDER_SCALE } from "../../../constants/scale.js";
import { MAX_GUEST_FLOW_AGENTS } from "../../../lib/guest-flow-layout-input.js";
import { getCatalogueItemBySlug } from "../../../lib/catalogue.js";
import { DEFAULT_PLANNER_CHAIR_SLUG, DEFAULT_PLANNER_ROUND_TABLE_SLUG } from "../../../lib/furniture-defaults.js";
import { plannerFeatureEnabled } from "../../../lib/planner-features.js";
import { banquetSeatsPerTable } from "../../../lib/table-group.js";
import { guestsAbovePublished, type PublishedCapacityAnswer } from "../../../lib/planner-truth.js";
import {
  FILL_AISLE_RULE,
  autoFillActionLabel,
  autoFillBasis,
  autoFillStyleOption,
  fillConsequence,
  fillConsequenceLine,
  fillOverActionLabel,
  planAutoFill,
  planRoomFill,
  publishedFigureFor,
  publishedFigureLine,
  roomAtSpacingLine,
  roomExits,
  type AutoFillPlan,
  type AutoFillStyle,
  type RoomFill,
} from "../../../lib/auto-fill.js";
import "./AutoFill.css";

// ---------------------------------------------------------------------------
// AutoFillPrompt — "How many guests?" before anything is placed.
//
// Choosing "Banquet rounds" or "Theatre" no longer fills the floor at once
// (redteam fix-first 15). The lens section turns, in place, into one number
// field, prefilled with the guest count when one is set, beside the venue's
// published figure for that style and who stated it. As the number changes,
// the button states what it will place ("Place 14 tables and 140 chairs")
// and, when the room cannot take that many at this spacing, a plain line says
// so before anything moves. No modal: it lives in the lens, on a desk or in
// the phone's lens sheet.
// ---------------------------------------------------------------------------

/** A whole number of guests from 1 to the planner's maximum, or null. */
export function parseGuestDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, 10);
  return value >= 1 && value <= MAX_GUEST_FLOW_AGENTS ? value : null;
}

export interface AutoFillPromptProps {
  readonly style: AutoFillStyle;
  /** The venue's published figures for the open room. */
  readonly published: PublishedCapacityAnswer;
  /** Called with what was placed. */
  readonly onPlaced: (plan: AutoFillPlan) => void;
  readonly onCancel: () => void;
}

export function AutoFillPrompt({ style, published, onPlaced, onCancel }: AutoFillPromptProps): ReactElement {
  const plannedGuestCount = useCockpitStore((state) => state.plannedGuestCount);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const [draft, setDraft] = useState(() => (plannedGuestCount === null ? "" : String(plannedGuestCount)));
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const hintId = `${baseId}-published`;
  const basisId = `${baseId}-basis`;
  const option = autoFillStyleOption(style);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus({ preventScroll: true });
    input.select();
    if (typeof input.scrollIntoView === "function") input.scrollIntoView({ block: "nearest" });
  }, []);

  const guests = parseGuestDraft(draft);
  // Fill over the layout behind fillKeepOuts: the same plan the store will lay, over what is placed now, to the room's own doors.
  const fillsOver = style === "dinner-rounds" && plannerFeatureEnabled("fillKeepOuts");
  const placedItems = usePlacementStore((state) => (fillsOver ? state.placedItems : null));
  const roomSlug = useEditorStore((state) => state.space?.slug ?? null);
  const objects = useEditorStore((state) => state.objects);
  const exits = useMemo(() => roomExits(roomSlug), [roomSlug]);
  const preview = useMemo((): { readonly plan: AutoFillPlan; readonly fill: RoomFill | null } | null => {
    if (guests === null) return null;
    const widthM = dimensions.width / RENDER_SCALE;
    const lengthM = dimensions.length / RENDER_SCALE;
    const table = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
    if (fillsOver && placedItems !== null && table !== undefined) {
      const fill = planRoomFill({ table, seatsPerTable: banquetSeatsPerTable(table), guests, roomWidthM: widthM, roomLengthM: lengthM, exits, rule: FILL_AISLE_RULE }, placedItems);
      return fill === null ? null : { plan: fill.plan, fill };
    }
    const planned = planAutoFill(style, guests, widthM, lengthM);
    return planned === null ? null : { plan: planned, fill: null };
  }, [guests, style, dimensions, fillsOver, placedItems, exits]);
  const plan = preview?.plan ?? null;
  // What a fill over a laid floor does to the rounds already there, said before it is pressed (planner-qol C-02).
  const consequence = useMemo(() => {
    const fill = preview?.fill ?? null;
    if (fill === null || placedItems === null) return null;
    const noted = new Set(objects.filter((object) => object.notes.trim() !== "").map((object) => object.id));
    return fillConsequence(placedItems, fill.refillIds, fill.plan, (id) => noted.has(id));
  }, [preview, placedItems, objects]);
  const figure = publishedFigureFor(published, option.format);
  const short = plan === null ? null : roomAtSpacingLine(plan, figure);
  // Only when the room takes them: above the published figure is its own fact.
  const above = short === null && published.kind === "published"
    ? guestsAbovePublished(guests, published.capacity, option.format)
    : null;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (guests === null || plan === null) return;
    useCockpitStore.getState().setPlannedGuestCount(guests);
    const placement = usePlacementStore.getState();
    let placed: AutoFillPlan | null = null;
    if (style === "dinner-rounds") {
      const table = getCatalogueItemBySlug(DEFAULT_PLANNER_ROUND_TABLE_SLUG);
      if (table !== undefined) placed = placement.autoArrangeBanquet(table.id, guests, banquetSeatsPerTable(table), exits);
    } else {
      const chair = getCatalogueItemBySlug(DEFAULT_PLANNER_CHAIR_SLUG);
      if (chair !== undefined) placed = placement.autoArrangeTheatre(chair.id, guests);
    }
    if (placed !== null) onPlaced(placed);
  };

  const describedBy = [figure !== null ? hintId : null, plan !== null ? basisId : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <form
      className="auto-fill"
      onSubmit={submit}
      aria-label={`${option.label}: how many guests?`}
      data-testid="auto-fill-prompt"
      data-style={style}
    >
      <p className="auto-fill__style">{option.label}</p>
      <label className="auto-fill__field">
        <span className="auto-fill__question">How many guests?</span>
        <input
          ref={inputRef}
          className="lens-panel__input auto-fill__input"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_GUEST_FLOW_AGENTS}
          step={1}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); }}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          data-testid="auto-fill-guests"
        />
      </label>

      {published.kind === "reading" && (
        <ActivityStatus className="auto-fill__basis">Reading the venue&apos;s published figures…</ActivityStatus>
      )}
      {figure !== null && (
        <p className="auto-fill__hint" id={hintId} data-testid="auto-fill-published">
          <span>{publishedFigureLine(figure)}</span>
          <span className="auto-fill__stated">{figure.source}</span>
        </p>
      )}

      {draft.trim() !== "" && guests === null && (
        <p className="auto-fill__note" data-testid="auto-fill-invalid">
          Enter a number of guests from 1 to {String(MAX_GUEST_FLOW_AGENTS)}.
        </p>
      )}
      {guests !== null && plan === null && (
        <p className="auto-fill__note" data-testid="auto-fill-no-room">There is no room for this layout at this spacing.</p>
      )}
      {plan !== null && (
        <p className="auto-fill__basis" id={basisId} data-testid="auto-fill-basis">{autoFillBasis(plan)}</p>
      )}
      {consequence !== null && (
        <p className="auto-fill__note" data-testid="auto-fill-consequence">{fillConsequenceLine(consequence)}</p>
      )}
      {short !== null && <p className="auto-fill__short" data-testid="auto-fill-short">{short}</p>}
      {above !== null && <p className="auto-fill__short" data-testid="auto-fill-above">{above}</p>}

      <div className="auto-fill__actions">
        <button
          type="submit"
          className="lens-panel__button"
          disabled={plan === null}
          data-testid="auto-fill-place"
        >
          {plan === null
            ? "Lay out the room"
            : consequence !== null && plan.style === "dinner-rounds" ? fillOverActionLabel(plan) : autoFillActionLabel(plan)}
        </button>
        <button
          type="button"
          className="lens-panel__button lens-panel__button--ghost auto-fill__back"
          onClick={onCancel}
          data-testid="auto-fill-back"
        >
          Back
        </button>
      </div>
    </form>
  );
}
