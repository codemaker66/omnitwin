import { Suspense, lazy, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Check, ChevronDown } from "lucide-react";
import type { PublishedRoomSlug } from "@omnitwin/types";
import { slateSaveState, type SlateSaveMark, type SlateSaveState } from "../../lib/editor-save-status.js";
import { customerEventPath } from "../../lib/event-access.js";
import { lastInputWasKeys, letter, usePlannerKeyBindings } from "../../lib/planner-keys.js";
import { actsInRoom, planeFacts, slateEyebrow, venueDay, type PlaneFacts } from "../../lib/slate-facts.js";
import { useFreezePhaseLayoutSnapshot } from "../../hooks/use-freeze-phase-layout-snapshot.js";
import { usePlannerVenueIdentity } from "../../hooks/use-planner-venue-identity.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { setWallsFull, useVisibilityStore } from "../../stores/visibility-store.js";
import { canFreezePhaseLayoutForVenue } from "../editor/cockpit/PhaseLayoutSnapshotAction.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { CreamKey, QuietKey } from "./Keys.js";
import { usePopoverState } from "./Popover.js";
import { SlateMenu, slateMenuRooms } from "./SlateMenu.js";
import { useEventHold, useSlateAudience } from "./slate-data.js";
import { Chip, Notice, StatusDot, type StatusDotTone } from "./Surfaces.js";
import "./chrome.css";
import "./slate.css";

const LazyAuthModal = lazy(() => import("../editor/AuthModal.js").then((m) => ({ default: m.AuthModal })));
const LazyClerkRouteProvider = lazy(() => import("../auth/ClerkRouteProvider.js").then((m) => ({ default: m.ClerkRouteProvider })));

// ---------------------------------------------------------------------------
// The slate — what this is, and whether it is saved (T-671 slice 7; spec 6.1,
// frames 01, 17 and 19).
//
// A lacquer plate top left: the crest, the eyebrow (the day and the room), the
// title as the key to the slate's menu, and one line: the hold, the save state
// in plain words, "Sample" for a sample. Under it the copper plane carries the
// figures that decide: guests, seats against the room's published limit, and
// tables. A notice under the plane says what is safe and the way forward when
// a save did not arrive, the connection dropped or someone else changed the
// layout. Status is always words; dots, the tick and colour repeat them.
// ---------------------------------------------------------------------------

export type SlateActionId = "try-again" | "show-theirs" | "keep-mine" | "sign-in";

/** What each way forward is doing while it runs: the words the other keys wait on. */
const BUSY_WORDS: Readonly<Record<SlateActionId, string>> = {
  "try-again": "Saving",
  "show-theirs": "Opening the other version",
  "keep-mine": "Keeping your version",
  "sign-in": "Signing in",
};

const DOT_TONE: Readonly<Partial<Record<SlateSaveMark, StatusDotTone>>> = {
  saved: "saved",
  offline: "offline",
  problem: "failed",
  draft: "draft",
};

export interface SlateCardProps {
  /** The venue's crest, or nothing. */
  readonly crest: ReactNode;
  /** "Sat 28 Nov 2026 · Grand Hall". */
  readonly eyebrow: string;
  /** The event's name, or the room's with no event. */
  readonly title: string;
  /** The hold chip's words (staff only), or null. */
  readonly hold: string | null;
  readonly sample: boolean;
  readonly save: SlateSaveState;
  /** The figures, or null where the slate drops the plane (Walk). */
  readonly plane: PlaneFacts | null;
  readonly menuOpen: boolean;
  readonly menuId?: string;
  readonly titleRef?: Ref<HTMLButtonElement>;
  readonly onMenu: () => void;
  readonly onAction: (id: SlateActionId) => void;
  /** The way forward now running, or null. */
  readonly busy: SlateActionId | null;
}

function SaveMark({ mark }: { readonly mark: SlateSaveMark }): ReactElement | null {
  if (mark === "working") return <ActivityIndicator size={16} className="pc-slate__working" />;
  const tone = DOT_TONE[mark];
  return tone === undefined ? null : <StatusDot tone={tone} />;
}

function ActionKey({ id, label, primary, busy, onAction }: {
  readonly id: SlateActionId;
  readonly label: string;
  readonly primary: boolean;
  readonly busy: SlateActionId | null;
  readonly onAction: (id: SlateActionId) => void;
}): ReactElement {
  const running = busy === id;
  const shared = {
    label,
    "aria-busy": running ? true : undefined,
    icon: running ? <ActivityIndicator size={16} /> : undefined,
    // The other ways forward wait on the one running, and say so.
    disabledReason: busy !== null && !running ? BUSY_WORDS[busy] : undefined,
    onPress: () => { if (busy === null) onAction(id); },
  } as const;
  return primary ? <CreamKey {...shared} /> : <QuietKey {...shared} />;
}

/** A figure on the plane that rolls once when it changes (180 ms), unless the keys changed it. */
function Figure({ value }: { readonly value: number }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || previous.current === value) return;
    const rose = value > previous.current;
    previous.current = value;
    element.classList.remove("is-rolling-up", "is-rolling-down");
    if (lastInputWasKeys()) return;
    // Read layout so the removed class lets go before the roll starts again.
    void element.offsetWidth;
    element.classList.add(rose ? "is-rolling-up" : "is-rolling-down");
  }, [value]);
  return <span ref={ref} className="pc-figure pc-plane__figure">{value}</span>;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function Plane({ facts }: { readonly facts: PlaneFacts }): ReactElement {
  const { guests, seats, tables, limit, standing, short } = facts;
  return (
    <div className="pc-plane" role="group" aria-label="The figures">
      <div className="pc-plane__cell">
        {guests === null ? <span className="pc-figure pc-plane__figure" aria-hidden="true">–</span> : <Figure value={guests} />}
        <span className="pc-plane__label">{guests === null ? "no guests yet" : plural(guests, "guest", "guests")}</span>
      </div>
      <div className="pc-plane__cell pc-plane__cell--seats" data-standing={standing}>
        <span className="pc-plane__figures">
          <Figure value={seats} />
          {limit !== null ? <span className="pc-plane__of">of {limit}</span> : null}
        </span>
        <span className="pc-plane__label">
          {plural(seats, "seat", "seats")}
          {standing === "seated" ? <><Check className="pc-plane__tick" size={12} aria-hidden="true" /><span className="vv-sr-only">every guest seated</span></> : null}
          {standing === "short" ? <span className="pc-plane__standing"> · {short} short</span> : null}
          {standing === "over" ? <span className="pc-plane__standing"> · over</span> : null}
        </span>
      </div>
      <div className="pc-plane__cell">
        <Figure value={tables} />
        <span className="pc-plane__label">{plural(tables, "table", "tables")}</span>
      </div>
    </div>
  );
}

export function SlateCard({
  crest, eyebrow, title, hold, sample, save, plane, menuOpen, menuId, titleRef, onMenu, onAction, busy,
}: SlateCardProps): ReactElement {
  const { notice, lineAction } = save;
  const urgent = save.kind === "not-saved" || save.kind === "changed-elsewhere";
  return (
    <section className="pc-slate" aria-label={title} data-save={save.kind} data-plane={plane === null ? "none" : "joined"} data-pc-popover-anchor>
      <div className="pc-lacquer pc-slate__plate">
        {crest !== null ? <span className="pc-slate__crest" aria-hidden="true">{crest}</span> : null}
        <div className="pc-slate__words">
          <span className="pc-caps pc-slate__eyebrow">{eyebrow}</span>
          <button
            ref={titleRef}
            type="button"
            className="pc-title pc-slate__title"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={onMenu}
          >
            <span className="pc-slate__title-words">{title}</span>
            <ChevronDown className="pc-icon pc-slate__chevron" aria-hidden="true" />
          </button>
          <p className="pc-meta pc-slate__line" data-testid="slate-line">
            {hold !== null ? <Chip tone="hold">{hold}</Chip> : null}
            <span className="pc-slate__save" title={save.title ?? undefined}>
              <SaveMark mark={save.mark} />
              <b className="pc-slate__status">{save.status}</b>
              {save.detail !== null ? <span className="pc-slate__detail"> · {save.detail}</span> : null}
            </span>
            {sample ? <Chip tone="sample">Sample</Chip> : null}
            {lineAction !== null ? (
              <button type="button" className="pc-slate__line-action" onClick={() => { onAction(lineAction.id); }}>
                {lineAction.label}
              </button>
            ) : null}
          </p>
        </div>
      </div>
      {plane !== null ? <Plane facts={plane} /> : null}
      {notice !== null ? (
        <Notice
          className="pc-slate__notice"
          lead={notice.heading}
          body={notice.body}
          urgency={urgent ? "alert" : "status"}
          actions={notice.actions.length > 0 ? notice.actions.map((action, index) => (
            <ActionKey key={action.id} id={action.id} label={action.label} primary={index === 0} busy={busy} onAction={onAction} />
          )) : undefined}
        />
      ) : null}
    </section>
  );
}

/** The address of the planner in another room or layout, carrying the event and the chrome. */
function plannerHref(path: string, search: URLSearchParams, extra: Readonly<Record<string, string>> = {}): string {
  const next = new URLSearchParams(extra);
  for (const key of ["eventId", "chrome"]) {
    const value = search.get(key);
    if (value !== null) next.set(key, value);
  }
  const query = next.toString();
  return query.length === 0 ? path : `${path}?${query}`;
}

/** Ctrl S answers with the save state, for the reflex: saving is automatic (spec 6.1). */
const SAVE_REFLEX_KEYS = letter("s", { mod: true });

/** The slate over the room, from the planner's own state. */
export function Slate(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const audience = useSlateAudience();
  const { event, graph, staff, signedIn } = audience;
  const venueId = useEditorStore((state) => state.venueId);
  const space = useEditorStore((state) => state.space);
  const configName = useEditorStore((state) => state.configName);
  const isTemplate = useEditorStore((state) => state.isTemplate);
  const facts = useEditorStore(useShallow((state) => ({
    configId: state.configId,
    isSaving: state.isSaving,
    isDirty: state.isDirty,
    pendingChanges: state.pendingChanges,
    savingChanges: state.savingChanges,
    isOnline: state.isOnline,
    keptOnDevice: state.keptOnDevice,
    saveError: state.saveError,
    saveConflict: state.saveConflict,
    lockReason: state.lockReason,
    lastSavedAt: state.lastSavedAt,
  })));
  const user = useAuthStore((state) => state.user);
  const venue = usePlannerVenueIdentity(venueId);
  const hold = useEventHold(venueId, event, staff);
  const walk = useCockpitStore((state) => state.walkMode);
  const items = usePlacementStore((state) => state.placedItems);
  const wallsFull = useVisibilityStore((state) => state.mode === "manual");
  const previewing = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const menu = usePopoverState();
  const freeze = useFreezePhaseLayoutSnapshot();
  const [busy, setBusy] = useState<SlateActionId | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const [actBusy, setActBusy] = useState<string | null>(null);
  const [actsSet, setActsSet] = useState<Readonly<Record<string, true>>>({});
  const [actProblem, setActProblem] = useState<string | null>(null);
  const [answer, setAnswer] = useState({ words: "", count: 0 });

  const { saveConflict: conflict } = facts;
  const save = slateSaveState({
    hasLayout: facts.configId !== null,
    guest: !signedIn,
    isSaving: facts.isSaving,
    isDirty: facts.isDirty,
    pendingChanges: facts.pendingChanges,
    savingChanges: facts.savingChanges,
    isOnline: facts.isOnline,
    keptOnDevice: facts.keptOnDevice,
    saveError: facts.saveError,
    conflict: conflict === null ? null : {
      changedByName: conflict.changedBy?.name ?? null,
      byYou: conflict.byYou,
      changedAt: conflict.changedAt,
      theirChange: conflict.theirChange,
    },
    lockReason: facts.lockReason,
    lastSavedAt: facts.lastSavedAt,
    timeZone: event?.timeZone ?? undefined,
  });

  const roomName = space?.name ?? "The room";
  const guests = event?.guestCount ?? null;
  const roomSlug = space?.slug ?? null;
  const plane = useMemo(
    () => (walk ? null : planeFacts({ items, guests, roomSlug })),
    [guests, items, roomSlug, walk],
  );
  const acts = useMemo(() => {
    if (graph === null || space === null) return [];
    return actsInRoom(graph, space.id, facts.configId).map((act) => (actsSet[act.id] === true ? { ...act, state: "this" as const } : act));
  }, [actsSet, facts.configId, graph, space]);

  usePlannerKeyBindings([{
    keys: SAVE_REFLEX_KEYS,
    inFields: true,
    run: () => {
      const editor = useEditorStore.getState();
      if (editor.isDirty && !editor.isSaving && editor.saveConflict === null && editor.isOnline
        && editor.lockReason === null && editor.configId !== null) {
        void editor.saveToServer(signedIn);
      }
      setAnswer((previous) => ({ words: save.detail === null ? save.status : `${save.status} · ${save.detail}`, count: previous.count + 1 }));
    },
  }]);

  const onAction = (id: SlateActionId): void => {
    if (id === "sign-in") {
      setSigningIn(true);
      return;
    }
    const editor = useEditorStore.getState();
    setBusy(id);
    const running = id === "try-again" ? editor.saveToServer(signedIn)
      : id === "keep-mine" ? editor.keepMine(signedIn)
        : editor.showTheirVersion(signedIn);
    void running.finally(() => { setBusy(null); });
  };

  const onRoom = (slug: PublishedRoomSlug): void => {
    menu.close(false);
    void navigate(plannerHref("/plan", searchParams, { space: slug }));
  };

  const onUseForAct = (phaseId: string): void => {
    if (event === null || facts.configId === null) return;
    const actName = acts.find((act) => act.id === phaseId)?.name ?? "That act";
    setActBusy(phaseId);
    setActProblem(null);
    void freeze.freeze({ eventId: event.id, phaseId }, { configurationId: facts.configId })
      .then((result) => {
        if (result !== null) setActsSet((previous) => ({ ...previous, [phaseId]: true }));
        else setActProblem(`${actName} was not set. Try again in a moment.`);
      })
      .finally(() => { setActBusy(null); });
  };

  const actWaitsOn = previewing ? "Leave the preview first"
    : conflict !== null ? "Choose a version first"
      : facts.isDirty || facts.isSaving ? "Saving this layout first"
        : null;
  const crest = venue.logoUrl !== null && venue.logoUrl !== failedLogo
    ? <img src={venue.logoUrl} alt="" onError={() => { setFailedLogo(venue.logoUrl); }} />
    : null;

  return (
    <>
      <SlateCard
        crest={crest}
        eyebrow={slateEyebrow({ startsAt: event?.startsAt ?? null, roomName })}
        title={event?.name ?? roomName}
        hold={staff ? hold : null}
        sample={isTemplate}
        save={save}
        plane={plane}
        menuOpen={menu.open}
        menuId={menu.panelId}
        titleRef={menu.triggerRef}
        onMenu={menu.toggle}
        onAction={onAction}
        busy={busy}
      />
      {/* The answer to Ctrl S, said once each press (a trailing space renews the words). */}
      <span className="vv-sr-only" role="status">{answer.count === 0 ? "" : `${answer.words}${answer.count % 2 === 0 ? " " : ""}`}</span>
      <SlateMenu
        state={menu}
        rooms={slateMenuRooms()}
        currentRoomSlug={roomSlug}
        onRoom={onRoom}
        layoutName={facts.configId === null ? null : configName}
        otherLayouts={(event?.layouts ?? [])
          .filter((layout) => layout.id !== facts.configId)
          .map((layout) => ({ ...layout, href: plannerHref(`/plan/${layout.id}`, searchParams) }))}
        acts={acts}
        actsSettable={canFreezePhaseLayoutForVenue(user, venueId)}
        onUseForAct={onUseForAct}
        actBusy={actBusy}
        actWaitsOn={actWaitsOn}
        actProblem={actProblem}
        eventHref={event === null ? null : staff ? `/ops/events/${event.id}` : customerEventPath(event.id)}
        diaryHref={!staff ? null : event === null || event.startsAt === null ? "/diary" : `/diary?date=${venueDay(event.startsAt, event.timeZone)}`}
        wallsFull={wallsFull}
        onWalls={setWallsFull}
      />
      {signingIn ? (
        <Suspense fallback={<ActivityStatus variant="panel">Opening sign in</ActivityStatus>}>
          <LazyClerkRouteProvider>
            <LazyAuthModal onClose={() => { setSigningIn(false); }} />
          </LazyClerkRouteProvider>
        </Suspense>
      ) : null}
    </>
  );
}
