import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { GuestEnquiryModal } from "../editor/GuestEnquiryModal.js";
import { AutoFillPrompt } from "../editor/cockpit/AutoFillPrompt.js";
import { SOUND_MODE_LINES } from "../planner-chrome/SoundControl.js";
import { prepareLayoutForGuestEnquiry } from "../editor/send-layout-flow.js";
import { ActivityIndicator } from "../shared/Activity.js";
import { usePlannerTruth } from "../../hooks/use-planner-truth.js";
import { AUTO_FILL_STYLES, type AutoFillStyle } from "../../lib/auto-fill.js";
import { CATALOGUE_CATEGORIES, categoryLabel, getCatalogueByCategory, getCatalogueItem, type CatalogueItem } from "../../lib/catalogue.js";
import { canApplyTableLinenToItem, isDiningTableItem } from "../../lib/furniture-semantics.js";
import { MAX_GUEST_FLOW_AGENTS } from "../../lib/guest-flow-layout-input.js";
import { JOURNEY_LABELS } from "../../lib/hud/journey.js";
import { asOneUndoStep } from "../../lib/planner-keymap.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { armPlannerSound, setPlannerSoundMode, usePlannerSoundSettings, type PlannerSoundMode } from "../../lib/sound-registry.js";
import { isTableDressingApplicatorSlug } from "../../lib/table-dressing.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { captureEditorSession, isCurrentEditorSession, useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { usePlannerEventStore, type PlannerEventKind } from "../../stores/planner-event-store.js";
import { usePlanSent, usePlannerHudStore, type HudSheet } from "../../stores/planner-hud-store.js";
import { useToolStore } from "../../stores/tool-store.js";
import { setWallsFull, useVisibilityStore } from "../../stores/visibility-store.js";
import { useModelledGrandHall } from "../grand-hall/hall-space.js";
import { useHudFacts } from "./hud-facts.js";
import { CloseGlyph, MinusGlyph, PlusGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// The sheets: what each step of the journey opens (the HUD's design note, "Sheets are
// the shelf, grown"). A sheet is the shelf rising, to at most 60 % of the
// screen: the same surface, with the status line, the cards and the one
// primary key still under it, so the hand stays in reach. One is open at a
// time. Escape, the step again or the close glyph shuts it.
// ---------------------------------------------------------------------------

const TITLE_ID = "hud-sheet-title";

function close(): void {
  usePlannerHudStore.getState().closeSheet();
}

/**
 * A sheet's title, and the keyboard's way in and out of the sheet. A sheet
 * opens a long way, in the page's order, from the step, card or key that
 * opened it. So focus goes to its title as it opens: the next Tab is its first
 * control, and a screen reader says where it is. When it shuts with focus
 * still inside it (Escape, its own Close) focus goes back to what opened it;
 * shut from outside (the step again, a card taken), focus stays where it is.
 */
function SheetTitle({ children }: { readonly children: ReactNode }): ReactElement {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const title = titleRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    title?.focus({ preventScroll: true });
    return () => {
      // Read before the sheet leaves the page: this runs while its title is still in it.
      const sheet = title?.closest(".hud-sheet") ?? null;
      if (sheet === null || opener === null || !sheet.contains(document.activeElement)) return;
      // Given back once the screen has settled: the opener may be the primary key, which stands aside while its own sheet is open.
      queueMicrotask(() => { if (opener.isConnected) opener.focus({ preventScroll: true }); });
    };
  }, []);
  return <h2 ref={titleRef} className="hud-sheet__title" id={TITLE_ID} tabIndex={-1}>{children}</h2>;
}

// -- Your event --------------------------------------------------------------

const KINDS: readonly { readonly kind: PlannerEventKind; readonly name: string; readonly line: string }[] = [
  { kind: "wedding", name: "Wedding", line: "Ceremony, dinner and dancing" },
  { kind: "corporate", name: "Corporate", line: "Conference, dinner or awards" },
  { kind: "other", name: "Something else", line: "Tell us what you have in mind" },
];

/** A step of the guest count's keys. */
const GUEST_STEP = 10;

function EventSheet(): ReactElement {
  const kind = usePlannerEventStore((state) => state.eventKind);
  const guests = useCockpitStore((state) => state.plannedGuestCount);
  const setGuests = (next: number | null): void => {
    useCockpitStore.getState().setPlannedGuestCount(next === null ? null : Math.min(MAX_GUEST_FLOW_AGENTS, Math.max(1, Math.round(next))));
  };
  return (
    <>
      <SheetTitle>{JOURNEY_LABELS.event}</SheetTitle>
      <p className="hud-sheet__lede">Two things shape the room: what the day is, and how many are coming. Both can change later.</p>
      <div className="hud-choices" role="radiogroup" aria-label="What are you planning?">
        {KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            role="radio"
            className="hud-choice"
            aria-checked={kind === option.kind}
            onClick={() => { usePlannerEventStore.getState().setEventKind(option.kind); }}
          >
            <span className="hud-choice__name">{option.name}</span>
            <span className="hud-choice__line">{option.line}</span>
          </button>
        ))}
      </div>
      <div className="hud-sheet__section">
        <h3 className="hud-sheet__heading">Guests</h3>
        <div className="hud-sheet__row">
          <button type="button" className="hud-round" aria-label={`${String(GUEST_STEP)} fewer guests`} onClick={() => { setGuests((guests ?? 0) - GUEST_STEP); }}>
            <MinusGlyph />
          </button>
          <input
            className="hud-number"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GUEST_FLOW_AGENTS}
            step={1}
            aria-label="Guests"
            value={guests === null ? "" : String(guests)}
            placeholder="0"
            onChange={(event) => {
              const typed = event.target.value.trim();
              setGuests(/^\d+$/u.test(typed) ? Number.parseInt(typed, 10) : null);
            }}
          />
          <button type="button" className="hud-round" aria-label={`${String(GUEST_STEP)} more guests`} onClick={() => { setGuests((guests ?? 0) + GUEST_STEP); }}>
            <PlusGlyph />
          </button>
        </div>
      </div>
    </>
  );
}

// -- Lay out -----------------------------------------------------------------

function LayoutSheet(): ReactElement {
  const { published } = usePlannerTruth();
  const floorEmpty = usePlacementStore((state) => state.placedItems.length === 0);
  const [style, setStyle] = useState<AutoFillStyle>("dinner-rounds");
  return (
    <>
      <SheetTitle>{JOURNEY_LABELS.layout}</SheetTitle>
      <p className="hud-sheet__lede">Say how many, and the room is laid for you, clear of the doors. Nothing moves until you press, and Undo takes it all back.</p>
      <div className="hud-choices" role="radiogroup" aria-label="How to lay the room">
        {AUTO_FILL_STYLES.map((option) => {
          // Rows of chairs need a clear floor; rounds are laid round what is already placed.
          const unavailable = option.style === "theatre" && !floorEmpty;
          return (
            <button
              key={option.style}
              type="button"
              role="radio"
              className="hud-choice"
              aria-checked={style === option.style}
              aria-disabled={unavailable || undefined}
              onClick={() => { if (!unavailable) setStyle(option.style); }}
            >
              <span className="hud-choice__name">{option.label}</span>
              <span className="hud-choice__line">
                {option.style === "dinner-rounds" ? "Round tables of ten, laid round what is already placed" : unavailable ? "Needs an empty floor" : "Rows of chairs facing one way"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="hud-sheet__section">
        <AutoFillPrompt key={style} style={style} published={published} onPlaced={close} onCancel={close} />
      </div>
    </>
  );
}

// -- Finishing touches -------------------------------------------------------

function dressableTableIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of usePlacementStore.getState().placedItems) {
    const catalogue = getCatalogueItem(item.catalogueItemId);
    if (catalogue !== undefined && isDiningTableItem(catalogue) && canApplyTableLinenToItem(catalogue)) ids.add(item.id);
  }
  return ids;
}

function diningTableIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of usePlacementStore.getState().placedItems) {
    const catalogue = getCatalogueItem(item.catalogueItemId);
    if (catalogue !== undefined && isDiningTableItem(catalogue)) ids.add(item.id);
  }
  return ids;
}

function dressEveryTable(cloth: "white" | "black" | "bare"): void {
  const ids = dressableTableIds();
  if (ids.size === 0) return;
  asOneUndoStep(() => {
    const placement = usePlacementStore.getState();
    if (cloth !== "bare") {
      placement.applyTableCloth(ids, cloth);
      return;
    }
    for (const item of placement.placedItems) {
      if (ids.has(item.id) && item.clothed) usePlacementStore.getState().toggleCloth(item.id);
    }
  });
}

function setEveryTable(dinner: boolean): void {
  const ids = diningTableIds();
  if (ids.size === 0) return;
  asOneUndoStep(() => {
    if (dinner) {
      usePlacementStore.getState().applyTableSetting(ids, "dinner");
      return;
    }
    for (const id of ids) usePlacementStore.getState().clearTableSetting(id);
  });
}

function FinishingSheet(): ReactElement {
  const { plane } = useHudFacts();
  const locked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const none = plane.tables === 0;
  return (
    <>
      <SheetTitle>{JOURNEY_LABELS.finishing}</SheetTitle>
      <p className="hud-sheet__lede">
        {none ? "Once there are tables in the room, dress them all here at a stroke." : "Dress every table at a stroke. One table on its own is changed from its card, when you choose it."}
      </p>
      <div className="hud-sheet__section">
        <h3 className="hud-sheet__heading">Cloths</h3>
        <div className="hud-sheet__row">
          <button type="button" className="hud-key" disabled={none || locked} onClick={() => { dressEveryTable("white"); }}>Ivory on every table</button>
          <button type="button" className="hud-key" disabled={none || locked} onClick={() => { dressEveryTable("black"); }}>Black on every table</button>
          <button type="button" className="hud-word" disabled={none || locked} onClick={() => { dressEveryTable("bare"); }}>No cloths</button>
        </div>
      </div>
      <div className="hud-sheet__section">
        <h3 className="hud-sheet__heading">Place settings</h3>
        <div className="hud-sheet__row">
          <button type="button" className="hud-key" disabled={none || locked} onClick={() => { setEveryTable(true); }}>Set every table for dinner</button>
          <button type="button" className="hud-word" disabled={none || locked} onClick={() => { setEveryTable(false); }}>Clear the settings</button>
        </div>
      </div>
    </>
  );
}

// -- Send --------------------------------------------------------------------

function SendSheet(): ReactElement {
  const configId = useEditorStore((state) => state.configId);
  const guestDraft = useEditorStore((state) => state.isPublicPreview);
  const hasPieces = usePlacementStore((state) => state.placedItems.length > 0);
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const sent = usePlanSent();
  const [preparing, setPreparing] = useState(false);
  const [asking, setAsking] = useState(false);

  const send = (): void => {
    if (configId === null || preparing) return;
    const session = captureEditorSession();
    setPreparing(true);
    void prepareLayoutForGuestEnquiry(configId)
      .then((ready) => { if (ready && isCurrentEditorSession(session)) setAsking(true); })
      .catch(() => { /* the plaque says what stopped the save */ })
      .finally(() => { setPreparing(false); });
  };

  return (
    <>
      <SheetTitle>Send to the events team</SheetTitle>
      {!hasPieces ? (
        <p className="hud-sheet__lede">There is nothing in the room yet. Set down a table, or lay the room out, and it can go to the events team.</p>
      ) : !guestDraft || configId === null ? (
        <p className="hud-sheet__lede">This plan is saved to an account, so it goes to the venue for approval rather than as an enquiry. Submit for approval is not on this screen yet: it is on the standard planner.</p>
      ) : (
        <>
          <p className="hud-sheet__lede">The events team receives this layout with your contact details, and replies with what happens next. Nothing is booked by sending it.</p>
          <div className="hud-sheet__row">
            <button type="button" className="hud-act" disabled={preparing || previewing} aria-busy={preparing} onClick={send}>
              {preparing ? <ActivityIndicator size={16} /> : null}
              {preparing ? "Preparing the layout" : previewing ? "Leave the preview to send" : sent ? "Send it again" : "Continue"}
            </button>
          </div>
          {asking ? (
            <GuestEnquiryModal
              configId={configId}
              // Sent is said only when the enquiry has arrived: putting the form away unsent leaves the plan unsent.
              onSubmitted={() => { usePlannerHudStore.getState().markSent(configId); }}
              onClose={() => { setAsking(false); }}
            />
          ) : null}
        </>
      )}
    </>
  );
}

// -- More: the whole catalogue -----------------------------------------------

function CataloguePiece({ item }: { readonly item: CatalogueItem }): ReactElement {
  const take = (): void => {
    useToolStore.getState().setTool("select");
    useCatalogueStore.getState().selectItem(item.id);
    close();
  };
  return (
    <li className="hud-cards__slot">
      <button type="button" className="hud-card" onClick={take} title={item.subtitle} aria-label={item.name}>
        <span className="hud-card__art">
          {item.thumbnailUrl !== null && item.thumbnailUrl !== undefined ? <img src={item.thumbnailUrl} alt="" draggable={false} loading="lazy" decoding="async" /> : null}
        </span>
        <span className="hud-card__name">{item.name}</span>
      </button>
    </li>
  );
}

function MoreSheet(): ReactElement {
  return (
    <>
      <SheetTitle>Everything the hall has</SheetTitle>
      <p className="hud-sheet__lede">Take any piece, then click the floor to set it down.</p>
      {CATALOGUE_CATEGORIES.map((category) => {
        const pieces = getCatalogueByCategory(category).filter((item) => !isTableDressingApplicatorSlug(item.slug));
        if (pieces.length === 0) return null;
        return (
          <div className="hud-sheet__section" key={category}>
            <h3 className="hud-sheet__heading">{categoryLabel(category)}</h3>
            <ul className="hud-catalogue" role="list">
              {pieces.map((item) => <CataloguePiece key={item.id} item={item} />)}
            </ul>
          </div>
        );
      })}
    </>
  );
}

// -- More tools --------------------------------------------------------------

const SOUND_HEADING_ID = "hud-sheet-sound";

const SOUND_MODES: readonly { readonly mode: PlannerSoundMode; readonly label: string }[] = [
  { mode: "off", label: "Off" },
  { mode: "quiet", label: "Quiet" },
  { mode: "full", label: "Full" },
];

/**
 * The planner's sound, Quiet unless chosen (Blake's D1), and only here, in the
 * view's More tools. A choice is kept on this device; Quiet or Full is itself
 * a deliberate press, so it makes the sound ready at once.
 */
function chooseSound(mode: PlannerSoundMode): void {
  setPlannerSoundMode(mode);
  if (mode !== "off") armPlannerSound();
}

function ToolsSheet(): ReactElement {
  const wallsFull = useVisibilityStore((state) => state.mode === "manual");
  // The drawn Grand Hall lowers its own walls by where the camera stands; only the other rooms' walls are put up or cut by hand.
  const wallsByHand = !useModelledGrandHall();
  const snap = usePlacementStore((state) => state.snapEnabled);
  const sound = usePlannerSoundSettings().mode;
  const tool = (name: "measure" | "draw"): void => {
    useToolStore.getState().setTool(name);
    close();
  };
  return (
    <>
      <SheetTitle>More tools</SheetTitle>
      <p className="hud-sheet__lede">The things used now and then.</p>
      <div className="hud-sheet__row">
        <button type="button" className="hud-key" onClick={() => { tool("measure"); }} title="Two clicks lay a tape, in metres (M)">Measure</button>
        <button type="button" className="hud-key" onClick={() => { tool("draw"); }} title="Draw a note on the floor (D)">Draw a note</button>
        {wallsByHand ? (
          <button type="button" className="hud-key" aria-pressed={wallsFull} onClick={() => { setWallsFull(!wallsFull); }}>{wallsFull ? "Cut the near walls away" : "Show every wall"}</button>
        ) : null}
        <button type="button" className="hud-key" aria-pressed={snap} onClick={() => { usePlacementStore.getState().toggleSnap(); }} title="G">{snap ? "Snapping to the grid" : "Placing freely"}</button>
      </div>
      <div className="hud-sheet__section">
        <h3 className="hud-sheet__heading" id={SOUND_HEADING_ID}>Sound</h3>
        <div className="hud-sheet__row">
          <div className="hud-view__switch" role="radiogroup" aria-labelledby={SOUND_HEADING_ID}>
            {SOUND_MODES.map((option) => (
              <button
                key={option.mode}
                type="button"
                role="radio"
                className="hud-option"
                aria-checked={sound === option.mode}
                onClick={() => { chooseSound(option.mode); }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className="hud-sheet__note">{SOUND_MODE_LINES[sound]}</p>
      </div>
    </>
  );
}

const WIDE: ReadonlySet<HudSheet> = new Set<HudSheet>(["more"]);

export function HudSheets(): ReactElement | null {
  const sheet = usePlannerHudStore((state) => state.sheet);
  useEscapeLayer("panel", { open: sheet !== null, onEscape: close });
  if (sheet === null) return null;
  return (
    <section className="hud-sheet" data-sheet={sheet} data-wide={WIDE.has(sheet) ? "true" : undefined} role="dialog" aria-modal="false" aria-labelledby={TITLE_ID}>
      <button type="button" className="hud-glyph-key hud-sheet__close" aria-label="Close" onClick={close}>
        <CloseGlyph />
      </button>
      {sheet === "event" ? <EventSheet />
        : sheet === "layout" ? <LayoutSheet />
          : sheet === "finishing" ? <FinishingSheet />
            : sheet === "send" ? <SendSheet />
              : sheet === "more" ? <MoreSheet />
                : <ToolsSheet />}
    </section>
  );
}
