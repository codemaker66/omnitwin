import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type WheelEvent,
} from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import {
  type RoomLayoutTimelineFrame,
  type RoomLayoutTimelineScope,
} from "../../../api/room-layout-timeline.js";
import { RoomLayoutTimelineLocalDateSchema } from "@omnitwin/types";
import { useSearchParams } from "react-router-dom";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { stepSpring, isSpringSettled, type SpringState } from "../../../lib/springs.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import type { LayoutTimelinePreviewFrameMetadata } from "../../../stores/layout-timeline-preview-store.js";
import { useRoomLayoutTimeline } from "../../../hooks/use-room-layout-timeline.js";
import { useLinkedEvent } from "../../../hooks/use-linked-event.js";
import { useMediaQuery } from "../../../hooks/use-media-query.js";
import {
  placedItemsFromCanonicalSnapshot,
} from "../../../lib/layout-timeline.js";
import { frozenRoomEnvelopesMatch } from "../../../lib/frozen-layout-room.js";
import {
  activeTimelineFrameIndexAtTime,
  adjacentAvailableFrameIndex,
  availableFrameCursorAtTime,
  availableFrameSegment,
  availableFrameIndices,
  layoutMetricsFromSnapshot,
  layoutTimelineTicks,
  linkedEventTimelineAnchorMs,
  shiftTimelineAnchorDate,
  timelineScopeAnchorDateAt,
  timelineDisplayRange,
  timelineFramesAllowSpatialMorph,
  timelinePhaseBlocks,
  timePositionPercent,
  type LayoutTimelineMetrics,
} from "../../../lib/room-layout-timeline-ui.js";
import {
  boardRange,
  formatWallTime,
  rangeTitle,
  type BoardRange,
} from "../../../pages/diary/lib/board-time.js";
import { LayoutPlanThumbnail } from "./LayoutPlanThumbnail.js";
import {
  canFreezePhaseLayoutForVenue,
  PhaseLayoutSnapshotAction,
} from "./PhaseLayoutSnapshotAction.js";

/** Keep deep links on the API's semantic calendar-date contract. */
export function isValidTimelineDeepLinkDate(value: string | null): value is string {
  return value !== null && RoomLayoutTimelineLocalDateSchema.safeParse(value).success;
}

type TimelineScope = RoomLayoutTimelineScope;

const FULL_PLAYBACK_MS = 20_000;
/** The spring's hard settle bound: motion never exceeds this, so a paused
 *  tab or a giant frame gap lands cleanly instead of replaying. */
const KEYFRAME_SPRING_MAX_MS = 900;
export const MAX_MOUNTED_TIMELINE_THUMBNAILS = 7;
const EMPTY_FRAMES: readonly RoomLayoutTimelineFrame[] = [];

export function shouldMountTimelineThumbnail(
  index: number,
  activeIndex: number,
): boolean {
  const radius = Math.floor(MAX_MOUNTED_TIMELINE_THUMBNAILS / 2);
  return Math.abs(index - activeIndex) <= radius;
}

export function timelinePhaseDensityClass(widthPercent: number, laneCount = 1): string {
  if (widthPercent < 4) return " is-micro";
  if (widthPercent < 10 || laneCount > 1) return " is-compact";
  return "";
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function availablePayload(frame: RoomLayoutTimelineFrame | undefined) {
  return frame?.keyframe.state === "available"
    ? frame.keyframe.payload
    : null;
}

function frameItems(frame: RoomLayoutTimelineFrame | undefined) {
  const payload = availablePayload(frame);
  return payload === null ? null : placedItemsFromCanonicalSnapshot(payload);
}

function previewFrameMetadata(
  frame: RoomLayoutTimelineFrame,
): LayoutTimelinePreviewFrameMetadata {
  return {
    id: frame.id,
    eventId: frame.eventId,
    eventName: frame.eventName,
    phaseId: frame.phaseId,
    phaseName: frame.phaseName,
    startsAt: frame.startsAt,
    endsAt: frame.endsAt,
    venueRuntime: frame.keyframe.state === "available"
      ? frame.keyframe.payload.venueRuntime
      : null,
  };
}

function framesAllowFrozenSpatialMorph(
  frames: readonly RoomLayoutTimelineFrame[],
  fromIndex: number,
  toIndex: number,
): boolean {
  const from = frames[fromIndex];
  const to = frames[toIndex];
  if (
    from?.keyframe.state !== "available"
    || to?.keyframe.state !== "available"
  ) return false;
  return timelineFramesAllowSpatialMorph(frames, fromIndex, toIndex)
    && frozenRoomEnvelopesMatch(
      from.keyframe.payload.venueRuntime,
      to.keyframe.payload.venueRuntime,
    );
}

function frameTime(frame: RoomLayoutTimelineFrame, timeZone: string): string {
  return `${formatWallTime(Date.parse(frame.startsAt), timeZone)}–${formatWallTime(Date.parse(frame.endsAt), timeZone)}`;
}

function frameStateLabel(frame: RoomLayoutTimelineFrame): string {
  if (frame.keyframe.state === "available") {
    return "Frozen layout";
  }
  if (frame.keyframe.state === "invalid") return "Saved layout invalid";
  return frame.keyframe.reason === "room_flip_gap" ? "Room flip gap" : "No saved layout";
}

function frameLifecycleClass(frame: RoomLayoutTimelineFrame): string {
  return frame.keyframe.state === "available" ? ` is-${frame.keyframe.snapshotStatus}` : "";
}

function timelineValueText(
  atMs: number,
  frames: readonly RoomLayoutTimelineFrame[],
  timeZone: string,
): string {
  const time = formatWallTime(atMs, timeZone);
  const activeIndex = activeTimelineFrameIndexAtTime(frames, atMs);
  const frame = activeIndex === null ? undefined : frames[activeIndex];
  if (frame !== undefined) {
    return `${time} · ${frame.eventName} · ${frame.phaseName} · ${frameStateLabel(frame)}`;
  }
  const previous = [...frames]
    .filter((candidate) => Date.parse(candidate.endsAt) <= atMs)
    .sort((left, right) => Date.parse(right.endsAt) - Date.parse(left.endsAt))[0];
  const next = [...frames]
    .filter((candidate) => Date.parse(candidate.startsAt) > atMs)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0];
  if (previous !== undefined && next !== undefined) {
    return `${time} · Schedule gap between ${previous.phaseName} and ${next.phaseName}`;
  }
  if (next !== undefined) return `${time} · Schedule gap before ${next.phaseName}`;
  if (previous !== undefined) return `${time} · Schedule gap after ${previous.phaseName}`;
  return `${time} · No scheduled phase`;
}

function metricsForFrame(frame: RoomLayoutTimelineFrame | undefined): LayoutTimelineMetrics | null {
  const payload = availablePayload(frame);
  return payload === null ? null : layoutMetricsFromSnapshot(payload);
}

function numericText(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-GB").format(value);
}

function revenueText(frame: RoomLayoutTimelineFrame | undefined): string {
  if (frame === undefined || frame.figures.revenue.state === "unavailable") return "Unavailable";
  if (frame.figures.revenue.state === "restricted") return "Restricted";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: frame.figures.revenue.scenario.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(frame.figures.revenue.scenario.estimatedRevenueMinor / 100);
}

function capacityText(frame: RoomLayoutTimelineFrame | undefined): string {
  if (frame === undefined || frame.figures.seatedCapacity.state === "unavailable") return "Unavailable";
  return numericText(frame.figures.seatedCapacity.value);
}

function figureDetail(frame: RoomLayoutTimelineFrame | undefined, figure: "guests" | "capacity" | "staffing" | "revenue"): string | undefined {
  if (frame === undefined) return undefined;
  if (figure === "guests") return `Source: ${frame.figures.guests.source.replaceAll("_", " ")}.`;
  if (figure === "capacity") {
    return frame.figures.seatedCapacity.state === "available"
      ? `Frozen snapshot capacity from ${frame.figures.seatedCapacity.basis.replaceAll("_", " ")}.`
      : `Capacity unavailable: ${frame.figures.seatedCapacity.reason.replaceAll("_", " ")}.`;
  }
  if (figure === "staffing") return `${frame.figures.staffing.staffConflictsLabel}. No staffing headcount is asserted.`;
  if (frame.figures.revenue.state === "available") return frame.figures.revenue.disclosure;
  if (frame.figures.revenue.state === "restricted") {
    return "Commercial access is required to view this planning estimate.";
  }
  return `Revenue unavailable: ${frame.figures.revenue.reason.replaceAll("_", " ")}.`;
}

interface MetricChipProps {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly secondary?: boolean;
}

function MetricChip({ label, value, detail, secondary = false }: MetricChipProps): ReactElement {
  return (
    <span
      className={`layout-metric${secondary ? " is-secondary" : ""}`}
      aria-label={`${label}: ${value}`}
      aria-description={detail}
      title={detail}
    >
      <span className="layout-metric__label">{label}</span>
      <span className="layout-metric__reel" aria-hidden="true">
        <span key={value} className="layout-metric__value">{value}</span>
      </span>
    </span>
  );
}

interface RangeControlsProps {
  readonly scope: TimelineScope;
  readonly range: BoardRange;
  readonly onScope: (scope: TimelineScope) => void;
  readonly onShift: (direction: -1 | 1) => void;
  readonly showJumpToEvent: boolean;
  readonly eventAnchorError: boolean;
  readonly onJumpToEvent: () => void;
  readonly timeZone: string;
}

function RangeControls({
  scope,
  range,
  onScope,
  onShift,
  showJumpToEvent,
  eventAnchorError,
  onJumpToEvent,
  timeZone,
}: RangeControlsProps): ReactElement {
  return (
    <div className="layout-range-controls">
      <div className="layout-scope" aria-label="Timeline range">
        {(["day", "week"] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={scope === option ? "is-active" : ""}
            aria-pressed={scope === option}
            onClick={() => { onScope(option); }}
          >
            {option === "day" ? "Day" : "Week"}
          </button>
        ))}
      </div>
      <button type="button" className="layout-icon-button" aria-label={`Previous ${scope}`} onClick={() => { onShift(-1); }}>
        <ChevronLeft size={15} aria-hidden="true" />
      </button>
      <span className="layout-range-title"><CalendarDays size={13} aria-hidden="true" />{rangeTitle(range, timeZone)}</span>
      <button type="button" className="layout-icon-button" aria-label={`Next ${scope}`} onClick={() => { onShift(1); }}>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      {showJumpToEvent ? (
        <button type="button" className="layout-jump-event" onClick={onJumpToEvent}>Jump to event</button>
      ) : null}
      {eventAnchorError ? <span className="layout-event-anchor-error">Event date unavailable</span> : null}
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(target.tagName)
    || target.closest("[role='button'], [role='link']") !== null;
}

function compactMessage(
  status: "idle" | "loading" | "loaded" | "error",
  frames: readonly RoomLayoutTimelineFrame[],
  hasLinkedEvent: boolean,
  scope: TimelineScope,
): { readonly title: string; readonly detail: string; readonly tone: "neutral" | "error" | "loading" } {
  if (status === "idle") {
    return { title: "Room timeline unavailable", detail: "Open a saved room configuration to load its schedule.", tone: "neutral" };
  }
  if (status === "loading") {
    return { title: "Loading room timeline", detail: "Reading saved phase keyframes…", tone: "loading" };
  }
  if (status === "error") {
    return { title: "Room timeline unavailable", detail: "The schedule could not be loaded. Your current layout is unchanged.", tone: "error" };
  }
  const phaseFrames = frames.filter((frame) => frame.kind === "phase");
  if (phaseFrames.length === 1) {
    const only = phaseFrames[0];
    if (only === undefined) {
      return { title: "One phase in this range", detail: "The interactive timeline appears when a second phase is scheduled.", tone: "neutral" };
    }
    return {
      title: `${only.phaseName} · ${frameStateLabel(only)}`,
      detail: "One phase in this range · interactive timeline hidden.",
      tone: only.keyframe.state === "invalid" ? "error" : "neutral",
    };
  }
  const period = scope === "day" ? "day" : "week";
  return hasLinkedEvent
    ? { title: `No room phases this ${period}`, detail: `The linked event has no room phases in this ${period}. Try another ${period}.`, tone: "neutral" }
    : { title: `No room phases this ${period}`, detail: `Move to another ${period} to browse saved layouts.`, tone: "neutral" };
}

export function RoomLayoutTimelineDock(): ReactElement | null {
  const venueId = useEditorStore((state) => state.venueId);
  const spaceId = useEditorStore((state) => state.spaceId);
  const configurationId = useEditorStore((state) => state.configId);
  const isDirty = useEditorStore((state) => state.isDirty);
  const isPublicPreview = useEditorStore((state) => state.isPublicPreview);
  const user = useAuthStore((state) => state.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamSignature = searchParams.toString();
  const hasLinkedEvent = (searchParams.get("eventId")?.trim().length ?? 0) > 0;
  const linkedEvent = useLinkedEvent(venueId);
  const linkedEventAnchorMs = useMemo(
    () => linkedEventTimelineAnchorMs(linkedEvent.graph, venueId, spaceId),
    [linkedEvent.graph, spaceId, venueId],
  );
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const narrowViewport = useMediaQuery("(max-width: 640px)");
  const initialTimeZoneRef = useRef(browserTimeZone());
  const initialScopeRef = useRef<TimelineScope>(
    searchParams.get("timelineScope") === "week" ? "week" : "day",
  );
  const initialTimelineDateRef = useRef<string | null>((() => {
    const requested = searchParams.get("timelineDate");
    return isValidTimelineDeepLinkDate(requested) ? requested : null;
  })());
  const hasExplicitTimelineDateRef = useRef(initialTimelineDateRef.current !== null);
  const anchorOriginRef = useRef<"automatic" | "explicit" | "manual" | "linked">(
    initialTimelineDateRef.current === null ? "automatic" : "explicit",
  );
  const [scope, setScope] = useState<TimelineScope>(initialScopeRef.current);
  const [anchorDate, setAnchorDate] = useState(() => {
    if (initialTimelineDateRef.current !== null) return initialTimelineDateRef.current;
    return timelineScopeAnchorDateAt(Date.now(), initialScopeRef.current, initialTimeZoneRef.current);
  });
  const timeline = useRoomLayoutTimeline(venueId, spaceId, { scope, anchorDate });
  const timelineData = timeline.data;
  const timelineResponseMatchesSelection = timeline.status === "loaded"
    && timelineData !== null
    && timelineData.venueId === venueId
    && timelineData.spaceId === spaceId
    && timelineData.range.scope === scope
    && timelineData.range.anchorDate === anchorDate;
  const timeZone = timelineResponseMatchesSelection
    ? timelineData.timeZone
    : initialTimeZoneRef.current;
  const range = useMemo(
    (): BoardRange => timeline.data === null || !timelineResponseMatchesSelection
      ? boardRange(Date.parse(`${anchorDate}T12:00:00.000Z`), scope, timeZone)
      : {
          view: scope,
          fromMs: Date.parse(timeline.data.range.from),
          toMs: Date.parse(timeline.data.range.to),
        },
    [anchorDate, scope, timeZone, timeline.data, timelineResponseMatchesSelection],
  );
  const frames = timelineResponseMatchesSelection ? timelineData.frames : EMPTY_FRAMES;
  const displayRange = useMemo(
    () => timelineDisplayRange(range, frames, scope),
    [frames, range, scope],
  );
  const phaseCount = useMemo(
    () => frames.filter((frame) => frame.kind === "phase").length,
    [frames],
  );
  const canExpand = timeline.status === "loaded" && phaseCount >= 2;
  const canFreezeCurrentPlan = configurationId !== null
    && !isDirty
    && !isPublicPreview
    && canFreezePhaseLayoutForVenue(user, venueId);
  const availableIndices = useMemo(() => availableFrameIndices(frames), [frames]);
  const [collapsed, setCollapsed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const previewMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const previewActive = previewMode !== "inactive";
  const selectionAnimationRef = useRef<number | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const previewTimelineAtRef = useRef<(atMs: number) => void>(() => undefined);
  const animationGenerationRef = useRef(0);
  const scrubTransitionRef = useRef<string | null>(null);
  const spaceDownAtRef = useRef<number | null>(null);
  const shortcutContextRef = useRef(false);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const centeredFilmstripFrameRef = useRef<string | null>(null);
  const centeredFilmstripNarrowRef = useRef<boolean | null>(null);
  const dockRef = useRef<HTMLElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const playheadRef = useRef<HTMLSpanElement>(null);
  const cursorRef = useRef(0);
  const playheadMsRef = useRef(displayRange.fromMs);
  const visualFrameIndexRef = useRef(0);
  const requestedInitialPhaseIdRef = useRef(searchParams.get("timelinePhaseId"));
  const lastSearchParamSignatureRef = useRef(searchParamSignature);
  const selfNavigationSignatureRef = useRef<string | null>(null);
  const prePreviewPhaseRef = useRef<{ captured: boolean; phaseId: string | null }>({
    captured: false,
    phaseId: null,
  });
  const autoAnchoredEventZoneRef = useRef<string | null>(null);
  const reconciledAutomaticAnchorRef = useRef<string | null>(null);
  const externalSearchParamChange = searchParamSignature !== lastSearchParamSignatureRef.current
    && selfNavigationSignatureRef.current !== searchParamSignature;
  const externallyRequestedDate = externalSearchParamChange ? searchParams.get("timelineDate") : null;
  const externalDateIsExplicit = isValidTimelineDeepLinkDate(externallyRequestedDate);
  const explicitTimelineDate = hasExplicitTimelineDateRef.current
    || externalDateIsExplicit;
  const effectiveCollapsed = collapsed || !canExpand;
  const activeFrame = frames[activeIndex];
  const metrics = previewMode === "unavailable" ? null : metricsForFrame(activeFrame);
  const ticks = useMemo(
    () => layoutTimelineTicks(displayRange, scope, timeZone),
    [displayRange, scope, timeZone],
  );
  const phaseBlocks = useMemo(
    () => timelinePhaseBlocks(frames, displayRange.fromMs, displayRange.toMs),
    [displayRange.fromMs, displayRange.toMs, frames],
  );
  const linkedEventId = linkedEvent.graph?.event.id;
  const roomAnchorKey = venueId === null || spaceId === null
    ? null
    : `${venueId}:${spaceId}`;
  const linkedEventAnchorKey = linkedEventId === undefined
    ? null
    : `${roomAnchorKey ?? "room-pending"}:${linkedEventId}:${scope}:${timeZone}`;
  const linkedEventAutoAnchorPending = hasLinkedEvent
    && !explicitTimelineDate
    && (
      linkedEvent.status === "none"
      || linkedEvent.status === "loading"
      || (
        linkedEvent.status === "loaded"
        && linkedEventAnchorMs !== null
        && autoAnchoredEventZoneRef.current !== linkedEventAnchorKey
      )
    );

  const updatePlayhead = useCallback((atMs: number): void => {
    playheadMsRef.current = atMs;
    const slider = sliderRef.current;
    if (slider !== null) {
      slider.value = String(atMs);
      slider.setAttribute("aria-valuetext", timelineValueText(atMs, frames, timeZone));
    }
    const playhead = playheadRef.current;
    if (playhead !== null) {
      playhead.style.left = `${String(timePositionPercent(atMs, displayRange.fromMs, displayRange.toMs))}%`;
    }
  }, [displayRange.fromMs, displayRange.toMs, frames, timeZone]);

  useEffect(() => {
    if (
      linkedEventId === undefined
      || linkedEventAnchorMs === null
      || explicitTimelineDate
      || autoAnchoredEventZoneRef.current === linkedEventAnchorKey
    ) return;
    autoAnchoredEventZoneRef.current = linkedEventAnchorKey;
    anchorOriginRef.current = "linked";
    setAnchorDate(timelineScopeAnchorDateAt(linkedEventAnchorMs, scope, timeZone));
  }, [explicitTimelineDate, linkedEventAnchorKey, linkedEventAnchorMs, linkedEventId, scope, timeZone]);

  useEffect(() => {
    const reconciliationKey = timeline.data === null || roomAnchorKey === null
      ? null
      : `${roomAnchorKey}:${scope}:${timeline.data.timeZone}`;
    if (
      reconciliationKey === null
      || reconciledAutomaticAnchorRef.current === reconciliationKey
      || timeline.data === null
      || explicitTimelineDate
      || hasLinkedEvent
    ) return;
    reconciledAutomaticAnchorRef.current = reconciliationKey;
    const venueToday = timelineScopeAnchorDateAt(Date.now(), scope, timeline.data.timeZone);
    if (venueToday !== anchorDate) {
      anchorOriginRef.current = "automatic";
      setAnchorDate(venueToday);
    }
  }, [anchorDate, explicitTimelineDate, hasLinkedEvent, roomAnchorKey, scope, timeline.data]);

  const cancelAnimations = useCallback((): number => {
    animationGenerationRef.current += 1;
    if (selectionAnimationRef.current !== null) cancelAnimationFrame(selectionAnimationRef.current);
    if (playbackAnimationRef.current !== null) cancelAnimationFrame(playbackAnimationRef.current);
    selectionAnimationRef.current = null;
    playbackAnimationRef.current = null;
    return animationGenerationRef.current;
  }, []);

  const capturePrePreviewPhase = useCallback((): void => {
    if (prePreviewPhaseRef.current.captured) return;
    prePreviewPhaseRef.current = {
      captured: true,
      phaseId: useCockpitStore.getState().selectedPhaseId,
    };
  }, []);

  const restorePrePreviewPhase = useCallback((): void => {
    if (!prePreviewPhaseRef.current.captured) return;
    const phaseId = prePreviewPhaseRef.current.phaseId;
    prePreviewPhaseRef.current = { captured: false, phaseId: null };
    useCockpitStore.getState().selectPhase(phaseId);
  }, []);

  const settleFrame = useCallback((index: number): boolean => {
    const frame = frames[index];
    const items = frameItems(frame);
    if (frame === undefined || items === null) return false;
    capturePrePreviewPhase();
    useLayoutTimelinePreviewStore.getState().settle(previewFrameMetadata(frame), items);
    useCockpitStore.getState().selectPhase(frame.phaseId);
    setActiveIndex(index);
    visualFrameIndexRef.current = index;
    cursorRef.current = index;
    updatePlayhead(Date.parse(frame.startsAt));
    return true;
  }, [capturePrePreviewPhase, frames, updatePlayhead]);

  const showUnavailableFrame = useCallback((index: number, fallbackMessage?: string): boolean => {
    const frame = frames[index];
    if (frame === undefined) return false;
    capturePrePreviewPhase();
    const message = frame.keyframe.state === "available"
      ? fallbackMessage ?? "The frozen keyframe could not be rendered."
      : frame.keyframe.message;
    useLayoutTimelinePreviewStore.getState().showUnavailable(previewFrameMetadata(frame), message);
    useCockpitStore.getState().selectPhase(frame.phaseId);
    setActiveIndex(index);
    visualFrameIndexRef.current = index;
    cursorRef.current = index;
    updatePlayhead(Date.parse(frame.startsAt));
    return true;
  }, [capturePrePreviewPhase, frames, updatePlayhead]);

  const selectFrame = useCallback((targetIndex: number): void => {
    const targetFrame = frames[targetIndex];
    const targetItems = frameItems(targetFrame);
    if (targetFrame === undefined || targetItems === null) return;
    capturePrePreviewPhase();
    setPlaying(false);
    const generation = cancelAnimations();
    const preview = useLayoutTimelinePreviewStore.getState();
    const previewSourceIndex = preview.activeFrame === null
      ? -1
      : frames.findIndex((frame) => frame.id === preview.activeFrame?.id);
    const fromIndex = previewSourceIndex >= 0 ? previewSourceIndex : activeIndex;
    const fromFrame = frames[fromIndex];
    const fromItems = preview.activeFrame === null ? frameItems(fromFrame) : preview.currentItems;
    if (
      fromFrame === undefined
      || fromItems === null
      || (preview.transition === null && fromFrame.id === targetFrame.id)
    ) {
      settleFrame(targetIndex);
      return;
    }

    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame: previewFrameMetadata(fromFrame),
      toFrame: previewFrameMetadata(targetFrame),
      fromItems,
      toItems: targetItems,
      reducedMotion,
      spatialMorphAllowed: framesAllowFrozenSpatialMorph(frames, fromIndex, targetIndex),
    });
    // House motion law: springs, never tweens (lib/springs.ts header). The
    // ported dock drove progress with a cubic ease-out; the spring keeps the
    // same 0->1 contract but stays interruptible with real velocity, and
    // reduced motion settles in one step (checked here, per the cockpit's
    // CSS-zeroing rule that JS motion must honour itself).
    const spring: SpringState = { value: 0, velocity: 0 };
    const SPRING_CONFIG = { stiffness: 170, damping: 26 };
    let lastNow = performance.now();
    let elapsedMs = 0;
    const fromVisualIndex = activeIndex;
    const fromCursor = cursorRef.current;
    const fromMs = playheadMsRef.current;
    const toMs = Date.parse(targetFrame.startsAt);
    const animate = (now: number): void => {
      if (animationGenerationRef.current !== generation) return;
      const frameMs = now - lastNow;
      const dt = Math.min(frameMs / 1000, 0.25);
      lastNow = now;
      elapsedMs += frameMs;
      if (reducedMotion || elapsedMs >= KEYFRAME_SPRING_MAX_MS) {
        spring.value = 1;
        spring.velocity = 0;
      } else {
        stepSpring(spring, 1, dt, SPRING_CONFIG);
      }
      const eased = Math.min(1, Math.max(0, spring.value));
      const settled = reducedMotion || elapsedMs >= KEYFRAME_SPRING_MAX_MS || isSpringSettled(spring, 1, 0.001);
      useLayoutTimelinePreviewStore.getState().setProgress(settled ? 1 : eased);
      const visualIndex = eased < 0.5 ? fromVisualIndex : targetIndex;
      if (visualFrameIndexRef.current !== visualIndex) {
        visualFrameIndexRef.current = visualIndex;
        setActiveIndex(visualIndex);
        useCockpitStore.getState().selectPhase(
          (eased < 0.5 ? frames[fromVisualIndex] : targetFrame)?.phaseId ?? targetFrame.phaseId,
        );
      }
      cursorRef.current = fromCursor + (targetIndex - fromCursor) * eased;
      updatePlayhead(fromMs + (toMs - fromMs) * eased);
      if (!settled) {
        selectionAnimationRef.current = requestAnimationFrame(animate);
      } else {
        if (animationGenerationRef.current !== generation) return;
        selectionAnimationRef.current = null;
        useLayoutTimelinePreviewStore.getState().settle(
          previewFrameMetadata(targetFrame),
          targetItems,
        );
        setActiveIndex(targetIndex);
        visualFrameIndexRef.current = targetIndex;
        useCockpitStore.getState().selectPhase(targetFrame.phaseId);
        cursorRef.current = targetIndex;
        updatePlayhead(toMs);
      }
    };
    selectionAnimationRef.current = requestAnimationFrame(animate);
  }, [activeIndex, cancelAnimations, capturePrePreviewPhase, frames, reducedMotion, settleFrame, updatePlayhead]);

  const moveKeyframe = useCallback((direction: -1 | 1): void => {
    const target = adjacentAvailableFrameIndex(availableIndices, activeIndex, direction);
    if (target !== null) selectFrame(target);
  }, [activeIndex, availableIndices, selectFrame]);

  const togglePlayback = useCallback((): void => {
    if (availableIndices.length < 2) return;
    if (playing) {
      setPlaying(false);
      cancelAnimations();
      return;
    }
    cancelAnimations();
    previewTimelineAtRef.current(displayRange.fromMs);
    setPlaying(true);
  }, [availableIndices, cancelAnimations, displayRange.fromMs, playing]);

  useEffect(() => {
    if (!playing || availableIndices.length < 2) return;
    const generation = animationGenerationRef.current;
    const startedAt = performance.now();
    let playbackRequest: number | null = null;

    const animate = (now: number): void => {
      if (animationGenerationRef.current !== generation) return;
      const elapsedMs = now - startedAt;
      const overall = Math.min(1, elapsedMs / FULL_PLAYBACK_MS);
      const atMs = displayRange.fromMs
        + (displayRange.toMs - displayRange.fromMs) * overall;
      previewTimelineAtRef.current(atMs);

      if (overall < 1) {
        playbackRequest = requestAnimationFrame(animate);
        playbackAnimationRef.current = playbackRequest;
        return;
      }

      if (animationGenerationRef.current !== generation) return;
      playbackAnimationRef.current = null;
      setPlaying(false);
    };

    playbackRequest = requestAnimationFrame(animate);
    playbackAnimationRef.current = playbackRequest;
    return () => {
      if (playbackRequest !== null) cancelAnimationFrame(playbackRequest);
      if (playbackAnimationRef.current === playbackRequest) playbackAnimationRef.current = null;
    };
  }, [availableIndices, displayRange, playing]);

  useLayoutEffect(() => {
    cancelAnimations();
    setPlaying(false);
    scrubTransitionRef.current = null;
    if (!timelineResponseMatchesSelection) {
      if (prePreviewPhaseRef.current.captured) {
        useLayoutTimelinePreviewStore.getState().showPending(
          timeline.status === "error"
            ? "The requested room timeline could not be loaded."
            : "Loading the authoritative room timeline…",
        );
      } else {
        useLayoutTimelinePreviewStore.getState().clear();
      }
      return;
    }
    if (!canExpand) {
      setActiveIndex(0);
      visualFrameIndexRef.current = 0;
      cursorRef.current = 0;
      updatePlayhead(displayRange.fromMs);
      if (prePreviewPhaseRef.current.captured) {
        useLayoutTimelinePreviewStore.getState().showPending(
          phaseCount === 1
            ? "Only one room phase is scheduled in this range."
            : "No room phases are scheduled in this range.",
        );
      } else {
        useLayoutTimelinePreviewStore.getState().clear();
      }
      return;
    }
    const requestedIndex = frames.findIndex((frame) =>
      frame.phaseId === requestedInitialPhaseIdRef.current,
    );
    if (requestedIndex >= 0) {
      if (!settleFrame(requestedIndex)) showUnavailableFrame(requestedIndex);
      return;
    }
    const initialIndex = availableIndices[0];
    if (initialIndex === undefined) {
      const truthfulFrame = frames[0];
      setActiveIndex(0);
      visualFrameIndexRef.current = 0;
      cursorRef.current = 0;
      updatePlayhead(displayRange.fromMs);
      if (truthfulFrame !== undefined) showUnavailableFrame(0);
      return;
    }
    if (!settleFrame(initialIndex)) showUnavailableFrame(initialIndex);
  }, [
    availableIndices,
    canExpand,
    cancelAnimations,
    displayRange.fromMs,
    frames,
    phaseCount,
    settleFrame,
    showUnavailableFrame,
    timeline.status,
    timelineResponseMatchesSelection,
    updatePlayhead,
  ]);

  useEffect(() => {
    const searchChanged = searchParamSignature !== lastSearchParamSignatureRef.current;
    lastSearchParamSignatureRef.current = searchParamSignature;
    const current = new URLSearchParams(searchParamSignature);

    if (searchChanged) {
      if (selfNavigationSignatureRef.current === searchParamSignature) {
        selfNavigationSignatureRef.current = null;
        return;
      }
      selfNavigationSignatureRef.current = null;
      const requestedScope: TimelineScope = current.get("timelineScope") === "week" ? "week" : "day";
      const requestedDate = current.get("timelineDate");
      const requestedDateIsValid = isValidTimelineDeepLinkDate(requestedDate);
      hasExplicitTimelineDateRef.current = requestedDateIsValid;
      let validDate = anchorDate;
      if (requestedDateIsValid) {
        anchorOriginRef.current = "explicit";
        reconciledAutomaticAnchorRef.current = null;
        validDate = requestedDate;
      } else {
        reconciledAutomaticAnchorRef.current = null;
        if (linkedEventAnchorMs !== null) {
          anchorOriginRef.current = "linked";
          validDate = timelineScopeAnchorDateAt(linkedEventAnchorMs, requestedScope, timeZone);
        } else {
          anchorOriginRef.current = "automatic";
          validDate = timelineScopeAnchorDateAt(Date.now(), requestedScope, timeZone);
        }
      }
      const requestedPhaseId = current.get("timelinePhaseId");
      requestedInitialPhaseIdRef.current = requestedPhaseId;
      const rangeChanged = requestedScope !== scope || validDate !== anchorDate;
      if (requestedScope !== scope) setScope(requestedScope);
      if (validDate !== anchorDate) setAnchorDate(validDate);
      if (!rangeChanged && requestedPhaseId !== null) {
        const requestedIndex = frames.findIndex((frame) =>
          frame.phaseId === requestedPhaseId,
        );
        if (requestedIndex >= 0 && !settleFrame(requestedIndex)) {
          showUnavailableFrame(requestedIndex);
        }
      }
      return;
    }

    if (linkedEventAutoAnchorPending || !timelineResponseMatchesSelection) return;
    // The layout effect hydrates a deep-linked phase before this passive URL
    // sync runs. Read the preview store at effect time so the first loaded
    // render cannot erase that phase with the render's stale `inactive`
    // snapshot (which would make reload fall back to the first keyframe).
    const currentPreview = useLayoutTimelinePreviewStore.getState();
    const desiredPhaseId = currentPreview.mode !== "inactive"
      ? currentPreview.activeFrame?.phaseId ?? null
      : null;
    const paramsMatch = current.get("timelineScope") === scope
      && current.get("timelineDate") === anchorDate
      && current.get("timelinePhaseId") === desiredPhaseId;
    if (paramsMatch) return;
    current.set("timelineScope", scope);
    current.set("timelineDate", anchorDate);
    if (desiredPhaseId === null) current.delete("timelinePhaseId");
    else current.set("timelinePhaseId", desiredPhaseId);
    selfNavigationSignatureRef.current = current.toString();
    setSearchParams(current, { replace: true });
  }, [
    activeFrame,
    anchorDate,
    frames,
    linkedEventAnchorMs,
    linkedEventAutoAnchorPending,
    scope,
    searchParamSignature,
    setSearchParams,
    settleFrame,
    showUnavailableFrame,
    previewMode,
    timeZone,
    timelineResponseMatchesSelection,
  ]);

  useLayoutEffect(() => () => {
    cancelAnimations();
    useLayoutTimelinePreviewStore.getState().clear();
    restorePrePreviewPhase();
  }, [cancelAnimations, restorePrePreviewPhase]);

  useLayoutEffect(() => {
    if (effectiveCollapsed) return;
    const node = filmstripRef.current?.querySelector<HTMLElement>(`[data-frame-index="${String(activeIndex)}"]`);
    if (node === undefined || node === null || typeof node.scrollIntoView !== "function") return;
    const frameId = frames[activeIndex]?.id ?? null;
    const firstCenter = centeredFilmstripFrameRef.current === null;
    const breakpointChanged = centeredFilmstripNarrowRef.current !== null
      && centeredFilmstripNarrowRef.current !== narrowViewport;
    node.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: reducedMotion || firstCenter || breakpointChanged ? "auto" : "smooth",
    });
    centeredFilmstripFrameRef.current = frameId;
    centeredFilmstripNarrowRef.current = narrowViewport;
  }, [activeIndex, effectiveCollapsed, frames, narrowViewport, reducedMotion]);

  useEffect(() => {
    const updateShortcutContext = (event: Event): void => {
      const target = event.target;
      shortcutContextRef.current = target instanceof Element
        && target.closest(".cockpit-stage, .cockpit-bottom") !== null;
    };
    document.addEventListener("pointerdown", updateShortcutContext, true);
    document.addEventListener("focusin", updateShortcutContext, true);
    return () => {
      document.removeEventListener("pointerdown", updateShortcutContext, true);
      document.removeEventListener("focusin", updateShortcutContext, true);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!canExpand || !shortcutContextRef.current || isTypingTarget(event.target)) return;
      if (event.key === "[") {
        if (event.repeat) return;
        event.preventDefault();
        moveKeyframe(-1);
      } else if (event.key === "]") {
        if (event.repeat) return;
        event.preventDefault();
        moveKeyframe(1);
      } else if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat && spaceDownAtRef.current === null) {
          spaceDownAtRef.current = performance.now();
        }
      }
    };
    const onKeyUp = (event: globalThis.KeyboardEvent): void => {
      if (event.code !== "Space") return;
      const startedAt = spaceDownAtRef.current;
      spaceDownAtRef.current = null;
      if (
        !canExpand
        || !shortcutContextRef.current
        || startedAt === null
        || isTypingTarget(event.target)
      ) return;
      if (performance.now() - startedAt <= 240) {
        event.preventDefault();
        togglePlayback();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      spaceDownAtRef.current = null;
    };
  }, [canExpand, moveKeyframe, togglePlayback]);

  const changeScope = useCallback((nextScope: TimelineScope): void => {
    if (nextScope === scope) return;
    setPlaying(false);
    cancelAnimations();
    requestedInitialPhaseIdRef.current = null;
    if (prePreviewPhaseRef.current.captured) {
      useLayoutTimelinePreviewStore.getState().showPending("Loading the authoritative room timeline…");
    }
    if (!hasExplicitTimelineDateRef.current) {
      if (linkedEventAnchorMs !== null) {
        anchorOriginRef.current = "linked";
        setAnchorDate(timelineScopeAnchorDateAt(linkedEventAnchorMs, nextScope, timeZone));
      } else if (anchorOriginRef.current === "automatic" || anchorOriginRef.current === "linked") {
        anchorOriginRef.current = "automatic";
        setAnchorDate(timelineScopeAnchorDateAt(Date.now(), nextScope, timeZone));
      }
    }
    setScope(nextScope);
  }, [cancelAnimations, linkedEventAnchorMs, scope, timeZone]);

  const shift = useCallback((direction: -1 | 1): void => {
    setPlaying(false);
    cancelAnimations();
    requestedInitialPhaseIdRef.current = null;
    hasExplicitTimelineDateRef.current = true;
    anchorOriginRef.current = "manual";
    if (prePreviewPhaseRef.current.captured) {
      useLayoutTimelinePreviewStore.getState().showPending("Loading the authoritative room timeline…");
    }
    setAnchorDate((current) => shiftTimelineAnchorDate(current, scope, direction));
  }, [cancelAnimations, scope]);

  const jumpToEvent = useCallback((): void => {
    if (linkedEventAnchorMs === null) return;
    setPlaying(false);
    cancelAnimations();
    requestedInitialPhaseIdRef.current = null;
    hasExplicitTimelineDateRef.current = false;
    anchorOriginRef.current = "linked";
    if (prePreviewPhaseRef.current.captured) {
      useLayoutTimelinePreviewStore.getState().showPending("Loading the authoritative room timeline…");
    }
    setAnchorDate(timelineScopeAnchorDateAt(linkedEventAnchorMs, scope, timeZone));
  }, [cancelAnimations, linkedEventAnchorMs, scope, timeZone]);

  const exitPreview = useCallback((): void => {
    setPlaying(false);
    cancelAnimations();
    scrubTransitionRef.current = null;
    useLayoutTimelinePreviewStore.getState().clear();
    restorePrePreviewPhase();
  }, [cancelAnimations, restorePrePreviewPhase]);

  const toggleCollapsed = (): void => {
    if (!collapsed) {
      exitPreview();
    } else {
      const frameAtSentinel = frames[activeIndex];
      if (frameAtSentinel === undefined) {
        previewTimelineAtRef.current(playheadMsRef.current);
      } else if (!settleFrame(activeIndex)) {
        showUnavailableFrame(activeIndex);
      }
    }
    setCollapsed((value) => !value);
  };

  const previewTimelineAt = useCallback((atMs: number): void => {
    capturePrePreviewPhase();
    updatePlayhead(atMs);
    const firstAvailable = availableIndices[0];
    const firstFrame = firstAvailable === undefined ? undefined : frames[firstAvailable];
    const scheduledIndex = activeTimelineFrameIndexAtTime(frames, atMs) ?? -1;
    const scheduledFrame = frames[scheduledIndex];
    if (scheduledFrame !== undefined && scheduledFrame.keyframe.state !== "available") {
      const availableBefore = [...availableIndices].reverse().find((index) => index < scheduledIndex);
      const availableAfter = availableIndices.find((index) => index > scheduledIndex);
      const interpolableRoomFlip = scheduledFrame.kind === "room_flip"
        && scheduledFrame.keyframe.state === "missing"
        && scheduledFrame.keyframe.reason === "room_flip_gap"
        && availableBefore !== undefined
        && availableAfter !== undefined
        && timelineFramesAllowSpatialMorph(frames, availableBefore, availableAfter);
      if (!interpolableRoomFlip) {
        scrubTransitionRef.current = null;
        setActiveIndex(scheduledIndex);
        visualFrameIndexRef.current = scheduledIndex;
        cursorRef.current = scheduledIndex;
        useCockpitStore.getState().selectPhase(scheduledFrame.phaseId);
        useLayoutTimelinePreviewStore.getState().showUnavailable(
          previewFrameMetadata(scheduledFrame),
          scheduledFrame.kind === "room_flip"
            ? "Room flip preview unavailable because the surrounding phases are not a continuous valid frozen sequence."
            : scheduledFrame.keyframe.message,
        );
        return;
      }
    }
    const scheduledFromMs = frames.reduce(
      (minimum, frame) => Math.min(minimum, Date.parse(frame.startsAt)),
      Number.POSITIVE_INFINITY,
    );
    const scheduledToMs = frames.reduce(
      (maximum, frame) => Math.max(maximum, Date.parse(frame.endsAt)),
      Number.NEGATIVE_INFINITY,
    );
    if (
      scheduledFrame === undefined
      && (atMs < scheduledFromMs || atMs >= scheduledToMs)
    ) {
      scrubTransitionRef.current = null;
      const beforeSchedule = atMs < scheduledFromMs;
      const gapIndex = beforeSchedule ? -1 : frames.length;
      setActiveIndex(gapIndex);
      visualFrameIndexRef.current = gapIndex;
      cursorRef.current = gapIndex;
      useCockpitStore.getState().selectPhase(null);
      useLayoutTimelinePreviewStore.getState().showScheduleGap(
        beforeSchedule
          ? "No room phase is scheduled yet."
          : "No room phase is scheduled now.",
      );
      return;
    }

    const nextCursor = availableFrameCursorAtTime(frames, availableIndices, atMs);
    if (nextCursor === null) {
      if (scheduledFrame === undefined) {
        scrubTransitionRef.current = null;
        setActiveIndex(-1);
        visualFrameIndexRef.current = -1;
        cursorRef.current = -1;
        useCockpitStore.getState().selectPhase(null);
        useLayoutTimelinePreviewStore.getState().showScheduleGap(
          "No room phase is scheduled now.",
        );
        return;
      }
      const activeUnavailableIndex = activeTimelineFrameIndexAtTime(frames, atMs) ?? -1;
      const nearestBlockingIndex = frames.reduce<number>((nearest, frame, index) => {
        if (frame.keyframe.state === "available" || frame.kind === "room_flip") return nearest;
        const distance = atMs < Date.parse(frame.startsAt)
          ? Date.parse(frame.startsAt) - atMs
          : atMs - Date.parse(frame.endsAt);
        if (nearest < 0) return index;
        const current = frames[nearest];
        if (current === undefined) return index;
        const currentDistance = atMs < Date.parse(current.startsAt)
          ? Date.parse(current.startsAt) - atMs
          : atMs - Date.parse(current.endsAt);
        return distance < currentDistance ? index : nearest;
      }, -1);
      const unavailableIndex = activeUnavailableIndex >= 0
        ? activeUnavailableIndex
        : nearestBlockingIndex;
      const unavailableFrame = frames[unavailableIndex];
      if (unavailableIndex >= 0 && unavailableFrame !== undefined) {
        setActiveIndex(unavailableIndex);
        visualFrameIndexRef.current = unavailableIndex;
        cursorRef.current = unavailableIndex;
        useCockpitStore.getState().selectPhase(unavailableFrame.phaseId);
        const message = unavailableFrame.keyframe.state === "available"
          ? "No frozen layout is scheduled for this interval."
          : unavailableFrame.keyframe.message;
        useLayoutTimelinePreviewStore.getState().showUnavailable(
          previewFrameMetadata(unavailableFrame),
          message,
        );
      }
      scrubTransitionRef.current = null;
      return;
    }
    cursorRef.current = nextCursor;
    const segment = availableFrameSegment(availableIndices, nextCursor);
    if (segment === null) {
      scrubTransitionRef.current = null;
      if (firstFrame === undefined) {
        useCockpitStore.getState().selectPhase(null);
        useLayoutTimelinePreviewStore.getState().showScheduleGap(
          "No room phase is scheduled now.",
        );
        return;
      }
      useLayoutTimelinePreviewStore.getState().showUnavailable(
        previewFrameMetadata(firstFrame),
        "No trustworthy frozen layout is available for this time.",
      );
      return;
    }
    const fromFrame = frames[segment.fromIndex];
    const toFrame = frames[segment.toIndex];
    const fromItems = frameItems(fromFrame);
    const toItems = frameItems(toFrame);
    if (
      fromFrame === undefined
      || toFrame === undefined
      || fromItems === null
      || toItems === null
    ) {
      scrubTransitionRef.current = null;
      const fallback = fromFrame ?? toFrame;
      if (fallback !== undefined) {
        useLayoutTimelinePreviewStore.getState().showUnavailable(
          previewFrameMetadata(fallback),
          "The saved keyframe could not be rendered.",
        );
      }
      return;
    }
    const nearestIndex = segment.progress < 0.5 ? segment.fromIndex : segment.toIndex;
    if (visualFrameIndexRef.current !== nearestIndex) {
      visualFrameIndexRef.current = nearestIndex;
      setActiveIndex(nearestIndex);
      useCockpitStore.getState().selectPhase((segment.progress < 0.5 ? fromFrame : toFrame).phaseId);
    }
    if (segment.fromIndex === segment.toIndex) {
      scrubTransitionRef.current = null;
      useLayoutTimelinePreviewStore.getState().settle(
        previewFrameMetadata(fromFrame),
        fromItems,
      );
      return;
    }
    const key = `${fromFrame.id}:${toFrame.id}`;
    if (scrubTransitionRef.current !== key) {
      useLayoutTimelinePreviewStore.getState().beginTransition({
        fromFrame: previewFrameMetadata(fromFrame),
        toFrame: previewFrameMetadata(toFrame),
        fromItems,
        toItems,
        reducedMotion,
        spatialMorphAllowed: framesAllowFrozenSpatialMorph(
          frames,
          segment.fromIndex,
          segment.toIndex,
        ),
      });
      scrubTransitionRef.current = key;
    }
    useLayoutTimelinePreviewStore.getState().setProgress(segment.progress);
  }, [availableIndices, capturePrePreviewPhase, frames, reducedMotion, updatePlayhead]);

  useEffect(() => {
    previewTimelineAtRef.current = previewTimelineAt;
  }, [previewTimelineAt]);

  const scrub = (event: ChangeEvent<HTMLInputElement>): void => {
    setPlaying(false);
    cancelAnimations();
    previewTimelineAt(Number(event.currentTarget.value));
  };

  const handleFilmstripWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || element.scrollWidth <= element.clientWidth) return;
    event.preventDefault();
    element.scrollLeft += event.deltaY;
  };

  const compact = compactMessage(timeline.status, frames, hasLinkedEvent, scope);
  const playDisabled = availableIndices.length < 2;
  const previousDisabled = adjacentAvailableFrameIndex(availableIndices, activeIndex, -1) === null;
  const nextDisabled = adjacentAvailableFrameIndex(availableIndices, activeIndex, 1) === null;
  const playheadValueText = timelineValueText(playheadMsRef.current, frames, timeZone);

  const freezeActionFrame = !previewActive
    && canFreezeCurrentPlan
    && activeFrame?.kind === "phase"
    && linkedEvent.status === "loaded"
    && linkedEvent.graph?.event.id === activeFrame.eventId
    && linkedEvent.graph.phases.some((phase) =>
      phase.id === activeFrame.phaseId
      && phase.eventId === activeFrame.eventId
      && phase.spaceId === spaceId,
    )
    ? activeFrame
    : undefined;

  // Wave E: a timeline only communicates change. One scheduled phase has no
  // transition to scrub, so the presentation yields the space back. The
  // explicit server-backed freeze action remains reachable when authorized.
  if (
    timelineResponseMatchesSelection
    && phaseCount === 1
    && !previewActive
    && freezeActionFrame === undefined
  ) return null;

  return (
    <footer
      ref={dockRef}
      className={`cockpit-bottom${effectiveCollapsed ? " is-collapsed" : ""}`}
      data-testid="cockpit-bottom"
      aria-label="Room layout timeline"
    >
      <header className="layout-timeline__header">
        <div className="layout-timeline__identity">
          <span className="layout-timeline__title"><Clock3 size={14} aria-hidden="true" />Room layouts</span>
          <span className="layout-timeline__truth">Frozen room outline + furniture are the saved plan · motion is a preview</span>
        </div>
        <RangeControls
          scope={scope}
          range={range}
          onScope={changeScope}
          onShift={shift}
          showJumpToEvent={linkedEventAnchorMs !== null && (linkedEventAnchorMs < range.fromMs || linkedEventAnchorMs >= range.toMs)}
          eventAnchorError={hasLinkedEvent && linkedEvent.status === "error"}
          onJumpToEvent={jumpToEvent}
          timeZone={timeZone}
        />

        {effectiveCollapsed ? (
          <div className={`layout-compact-state is-${compact.tone}`} role={compact.tone === "error" ? "alert" : "status"}>
            {compact.tone === "loading" ? <LoaderCircle className="is-spinning" size={14} aria-hidden="true" /> : null}
            {compact.tone === "error" ? <CircleAlert size={14} aria-hidden="true" /> : null}
            <strong>{canExpand && collapsed ? activeFrame?.phaseName ?? "Room timeline" : compact.title}</strong>
            <span>{canExpand && collapsed ? activeFrame === undefined ? "" : `${frameTime(activeFrame, timeZone)} · ${frameStateLabel(activeFrame)}` : compact.detail}</span>
            {timeline.status === "error" ? (
              <button type="button" className="layout-retry" onClick={timeline.refresh}>
                <RotateCcw size={13} aria-hidden="true" />Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {!effectiveCollapsed ? (
          <div className="layout-timeline__metrics" aria-live="polite">
            <MetricChip
              label="Guests"
              value={activeFrame === undefined ? "—" : numericText(activeFrame.figures.guests.value)}
              detail={figureDetail(activeFrame, "guests")}
            />
            <MetricChip
              label="Seated capacity"
              value={capacityText(activeFrame)}
              detail={figureDetail(activeFrame, "capacity")}
            />
            <MetricChip
              label="Staffing"
              value={activeFrame === undefined ? "—" : "Not recorded"}
              detail={figureDetail(activeFrame, "staffing")}
            />
            <MetricChip
              label="Revenue"
              value={revenueText(activeFrame)}
              detail={figureDetail(activeFrame, "revenue")}
            />
            <MetricChip label="Objects" value={numericText(metrics?.objects ?? null)} secondary />
            <MetricChip label="Tables" value={numericText(metrics?.tables ?? null)} secondary />
            <MetricChip
              label="Stage / bar"
              value={`${numericText(metrics?.stages ?? null)} / ${numericText(metrics?.bars ?? null)}`}
              secondary
            />
          </div>
        ) : null}

        {canExpand || previewActive || freezeActionFrame !== undefined ? (
          <div className="layout-timeline__dock-actions">
            {freezeActionFrame !== undefined && configurationId !== null ? (
              <PhaseLayoutSnapshotAction
                key={`${freezeActionFrame.phaseId}:${configurationId}`}
                eventId={freezeActionFrame.eventId}
                phaseId={freezeActionFrame.phaseId}
                configurationId={configurationId}
                onFrozen={() => { timeline.refresh(); }}
              />
            ) : null}
            {previewActive ? (
              <button type="button" className="layout-exit-preview" onClick={exitPreview}>Exit preview</button>
            ) : null}
            {canExpand ? (
              <button
                type="button"
                className="layout-collapse-button"
                aria-label={collapsed ? "Expand room timeline" : "Collapse room timeline"}
                aria-expanded={!collapsed}
                onClick={toggleCollapsed}
              >
                {collapsed ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      {!effectiveCollapsed ? (
        <div className="layout-timeline__body">
          <div className="layout-phase-track" aria-label="Event phases">
            {phaseBlocks.map((block) => {
              const index = block.frameIndex;
              const frame = frames[index];
              if (frame === undefined) return null;
              const available = frame.keyframe.state === "available";
              const active = index === activeIndex;
              const clipLabel = `${block.clippedStart ? ", continues from previous range" : ""}${block.clippedEnd ? ", continues into next range" : ""}`;
              return (
                <button
                  key={frame.id}
                  type="button"
                  className={`layout-phase${timelinePhaseDensityClass(block.widthPercent, block.laneCount)}${active ? " is-active" : ""}${available ? "" : " is-unavailable"}${frame.keyframe.state === "missing" ? " is-missing" : ""}${frame.keyframe.state === "invalid" ? " is-invalid" : ""}${frame.kind === "room_flip" ? " is-gap" : ""}${frameLifecycleClass(frame)}`}
                  style={{
                    left: `${String(block.leftPercent)}%`,
                    width: `${String(block.widthPercent)}%`,
                    top: `${String((block.lane / block.laneCount) * 100)}%`,
                    height: `calc(${String(100 / block.laneCount)}% - 3px)`,
                  }}
                  aria-pressed={active}
                  aria-label={`${frame.eventName}, ${frame.phaseName}, ${frameTime(frame, timeZone)}, ${frameStateLabel(frame)}${clipLabel}`}
                  title={`${frame.eventName} · ${frame.phaseName} · ${frameTime(frame, timeZone)} · ${frameStateLabel(frame)}`}
                  onClick={() => {
                    if (available) selectFrame(index);
                    else showUnavailableFrame(index);
                  }}
                >
                  <span className="layout-phase__time">{frameTime(frame, timeZone)}</span>
                  <span className="layout-phase__name">{frame.phaseName}</span>
                  <span className="layout-phase__event">{frame.eventName}</span>
                  <span className="layout-phase__state">{frameStateLabel(frame)}</span>
                </button>
              );
            })}
          </div>

          <div className="layout-ruler" aria-hidden="true">
            {ticks.map((tick, index) => {
              const nextTick = ticks[index + 1];
              const crowdsTerminal = index === ticks.length - 2
                && nextTick !== undefined
                && nextTick.positionPercent - tick.positionPercent < 6;
              return (
                <span
                  key={tick.atMs}
                  className={`layout-ruler__tick${crowdsTerminal ? " is-mobile-terminal-crowded" : ""}`}
                  style={{ left: `${String(tick.positionPercent)}%` }}
                >
                  <i />{tick.label}
                </span>
              );
            })}
            <span
              ref={playheadRef}
              className="layout-ruler__playhead"
              style={{ left: `${String(timePositionPercent(playheadMsRef.current, displayRange.fromMs, displayRange.toMs))}%` }}
            >
              <i />
            </span>
          </div>
          <input
            ref={sliderRef}
            className="layout-ruler__input"
            type="range"
            min={displayRange.fromMs}
            max={displayRange.toMs}
            step={60_000}
            value={playheadMsRef.current}
            aria-label="Scrub room layout timeline"
            aria-valuetext={playheadValueText}
            onChange={scrub}
          />

          <div className="layout-filmstrip-row">
            <div className="layout-playback-controls" aria-label="Timeline playback controls">
              <button type="button" className="layout-icon-button" aria-label="Previous saved layout" aria-keyshortcuts="[" disabled={previousDisabled} onClick={() => { moveKeyframe(-1); }}>
                <ChevronLeft size={17} aria-hidden="true" />
              </button>
              <button type="button" className="layout-play-button" aria-label={playing ? "Pause timeline" : "Play full timeline"} aria-keyshortcuts="Space" disabled={playDisabled} onClick={togglePlayback}>
                {playing ? <Pause size={17} fill="currentColor" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}
              </button>
              <button type="button" className="layout-icon-button" aria-label="Next saved layout" aria-keyshortcuts="]" disabled={nextDisabled} onClick={() => { moveKeyframe(1); }}>
                <ChevronRight size={17} aria-hidden="true" />
              </button>
              <span className="layout-playback-controls__duration">20s full range</span>
            </div>

            <div ref={filmstripRef} className="layout-filmstrip" role="list" aria-label="Saved layout previews" onWheel={handleFilmstripWheel}>
              {frames.map((frame, index) => {
                const available = frame.keyframe.state === "available";
                return (
                  <div
                    key={frame.id}
                    className="layout-filmstrip__item"
                    role="listitem"
                    data-frame-index={index}
                  >
                    <button
                      type="button"
                      className={`layout-filmstrip__card${index === activeIndex ? " is-active" : ""}${available ? "" : " is-unavailable"}${frame.keyframe.state === "missing" ? " is-missing" : ""}${frame.keyframe.state === "invalid" ? " is-invalid" : ""}${frameLifecycleClass(frame)}`}
                      aria-label={`${frame.eventName}, ${frame.phaseName}, ${frameStateLabel(frame)}`}
                      aria-pressed={index === activeIndex}
                      onClick={() => {
                        if (available) selectFrame(index);
                        else showUnavailableFrame(index);
                      }}
                    >
                      {frame.keyframe.state === "available" && shouldMountTimelineThumbnail(index, activeIndex) ? (
                        <LayoutPlanThumbnail snapshot={frame.keyframe.payload} label={`${frame.eventName} ${frame.phaseName}`} />
                      ) : frame.keyframe.state === "available" ? (
                        <span className="layout-filmstrip__deferred" aria-hidden="true">
                          <Clock3 size={15} />
                          <span>Preview loads nearby</span>
                        </span>
                      ) : (
                        <span className="layout-filmstrip__unavailable">
                          <CircleAlert size={15} aria-hidden="true" />
                          <strong>{frameStateLabel(frame)}</strong>
                          <span>{frame.keyframe.message}</span>
                        </span>
                      )}
                      <span className="layout-filmstrip__caption">
                        <span><strong>{formatWallTime(Date.parse(frame.startsAt), timeZone)}</strong>{frame.phaseName}</span>
                        <small>{frame.eventName} · {frameStateLabel(frame)}</small>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </footer>
  );
}
