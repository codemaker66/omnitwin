import {
  useCallback,
  useEffect,
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
} from "lucide-react";
import type { RoomLayoutTimelineFrame } from "@omnitwin/types";
import { useSearchParams } from "react-router-dom";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { useRoomLayoutTimeline } from "../../../hooks/use-room-layout-timeline.js";
import { useLinkedEvent } from "../../../hooks/use-linked-event.js";
import { useMediaQuery } from "../../../hooks/use-media-query.js";
import {
  placedItemsFromCanonicalSnapshot,
} from "../../../lib/layout-timeline.js";
import {
  adjacentAvailableFrameIndex,
  availableFrameCursorAtTime,
  availableFrameSegment,
  availableFrameIndices,
  layoutMetricsFromSnapshot,
  layoutTimelineTicks,
  linkedEventTimelineAnchorMs,
  operationalDayRange,
  shiftOperationalDayRange,
  timelineDisplayRange,
  timelinePhaseBlocks,
  timePositionPercent,
  wallClockPlaybackCursor,
  type LayoutTimelineMetrics,
} from "../../../lib/room-layout-timeline-ui.js";
import {
  boardRange,
  formatWallTime,
  rangeTitle,
  shiftRange,
  type BoardRange,
} from "../../../pages/diary/lib/board-time.js";
import { LayoutPlanThumbnail } from "./LayoutPlanThumbnail.js";
import { PhaseLayoutSnapshotAction } from "./PhaseLayoutSnapshotAction.js";

type TimelineScope = "day" | "week";

const FULL_PLAYBACK_MS = 20_000;
const KEYFRAME_ANIMATION_MS = 680;
const REDUCED_MOTION_KEYFRAME_MS = 180;
const EMPTY_FRAMES: readonly RoomLayoutTimelineFrame[] = [];

function availablePayload(frame: RoomLayoutTimelineFrame | undefined) {
  return frame?.keyframe.state === "available" ? frame.keyframe.payload : null;
}

function frameItems(frame: RoomLayoutTimelineFrame | undefined) {
  const payload = availablePayload(frame);
  return payload === null ? null : placedItemsFromCanonicalSnapshot(payload);
}

function frameTime(frame: RoomLayoutTimelineFrame): string {
  return `${formatWallTime(Date.parse(frame.startsAt))}–${formatWallTime(Date.parse(frame.endsAt))}`;
}

function frameStateLabel(frame: RoomLayoutTimelineFrame): string {
  if (frame.keyframe.state === "available") {
    switch (frame.keyframe.snapshotStatus) {
      case "frozen": return "Frozen layout";
      case "draft": return "Draft layout";
      case "stale": return "Stale layout";
      case "superseded": return "Superseded layout";
    }
  }
  if (frame.keyframe.state === "invalid") return "Saved layout invalid";
  return frame.keyframe.reason === "room_flip_gap" ? "Room flip gap" : "No saved layout";
}

function frameLifecycleClass(frame: RoomLayoutTimelineFrame): string {
  return frame.keyframe.state === "available" ? ` is-${frame.keyframe.snapshotStatus}` : "";
}

function timelineValueText(atMs: number, frames: readonly RoomLayoutTimelineFrame[]): string {
  const time = formatWallTime(atMs);
  const frame = frames.find((candidate) => {
    const startsAt = Date.parse(candidate.startsAt);
    const endsAt = Date.parse(candidate.endsAt);
    return atMs >= startsAt && atMs < endsAt;
  });
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

interface MetricChipProps {
  readonly label: string;
  readonly value: number | null;
  readonly suffix?: string;
}

function MetricChip({ label, value, suffix = "" }: MetricChipProps): ReactElement {
  const rendered = `${numericText(value)}${suffix}`;
  return (
    <span className="layout-metric" aria-label={`${label}: ${rendered}`}>
      <span className="layout-metric__label">{label}</span>
      <span className="layout-metric__reel" aria-hidden="true">
        <span key={rendered} className="layout-metric__value">{rendered}</span>
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
}

function RangeControls({
  scope,
  range,
  onScope,
  onShift,
  showJumpToEvent,
  eventAnchorError,
  onJumpToEvent,
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
      <span className="layout-range-title"><CalendarDays size={13} aria-hidden="true" />{rangeTitle(range)}</span>
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
  return hasLinkedEvent
    ? { title: "No room phases in this range", detail: "The linked event has no room phases here. Try another day.", tone: "neutral" }
    : { title: "No event linked", detail: "Connect an event or move to another day to browse room layouts.", tone: "neutral" };
}

export function RoomLayoutTimelineDock(): ReactElement | null {
  const venueId = useEditorStore((state) => state.venueId);
  const spaceId = useEditorStore((state) => state.spaceId);
  const configurationId = useEditorStore((state) => state.configId);
  const isDirty = useEditorStore((state) => state.isDirty);
  const isPublicPreview = useEditorStore((state) => state.isPublicPreview);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isReadOnly = isPublicPreview || !isAuthenticated;
  const [searchParams] = useSearchParams();
  const hasLinkedEvent = (searchParams.get("eventId")?.trim().length ?? 0) > 0;
  const linkedEvent = useLinkedEvent();
  const linkedEventAnchorMs = useMemo(
    () => linkedEventTimelineAnchorMs(linkedEvent.graph),
    [linkedEvent.graph],
  );
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [scope, setScope] = useState<TimelineScope>("day");
  const [anchorMs, setAnchorMs] = useState(() => Date.now());
  const range = useMemo(
    () => scope === "day" ? operationalDayRange(anchorMs) : boardRange(anchorMs, scope),
    [anchorMs, scope],
  );
  const fromIso = useMemo(() => new Date(range.fromMs).toISOString(), [range.fromMs]);
  const toIso = useMemo(() => new Date(range.toMs).toISOString(), [range.toMs]);
  const timeline = useRoomLayoutTimeline(venueId, spaceId, fromIso, toIso);
  const frames = timeline.data?.frames ?? EMPTY_FRAMES;
  const displayRange = useMemo(
    () => timelineDisplayRange(range, frames, scope),
    [frames, range, scope],
  );
  const phaseCount = useMemo(
    () => frames.filter((frame) => frame.kind === "phase").length,
    [frames],
  );
  const canExpand = timeline.status === "loaded" && phaseCount >= 2;
  const availableIndices = useMemo(() => availableFrameIndices(frames), [frames]);
  const [collapsed, setCollapsed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [playheadMs, setPlayheadMs] = useState(displayRange.fromMs);
  const [playing, setPlaying] = useState(false);
  const previewActive = useLayoutTimelinePreviewStore((state) => state.activeFrame !== null);
  const selectionAnimationRef = useRef<number | null>(null);
  const playbackAnimationRef = useRef<number | null>(null);
  const scrubTransitionRef = useRef<string | null>(null);
  const spaceDownAtRef = useRef<number | null>(null);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const autoAnchoredEventIdRef = useRef<string | null>(null);
  const effectiveCollapsed = collapsed || !canExpand;
  const activeFrame = frames[activeIndex];
  const metrics = metricsForFrame(activeFrame);
  const ticks = useMemo(() => layoutTimelineTicks(displayRange, scope), [displayRange, scope]);
  const phaseBlocks = useMemo(
    () => timelinePhaseBlocks(frames, displayRange.fromMs, displayRange.toMs),
    [displayRange.fromMs, displayRange.toMs, frames],
  );

  useEffect(() => {
    const eventId = linkedEvent.graph?.event.id;
    if (eventId === undefined || linkedEventAnchorMs === null || autoAnchoredEventIdRef.current === eventId) return;
    autoAnchoredEventIdRef.current = eventId;
    setAnchorMs(linkedEventAnchorMs);
  }, [linkedEvent.graph, linkedEventAnchorMs]);

  const cancelAnimations = useCallback((): void => {
    if (selectionAnimationRef.current !== null) cancelAnimationFrame(selectionAnimationRef.current);
    if (playbackAnimationRef.current !== null) cancelAnimationFrame(playbackAnimationRef.current);
    selectionAnimationRef.current = null;
    playbackAnimationRef.current = null;
  }, []);

  const settleFrame = useCallback((index: number): boolean => {
    const frame = frames[index];
    const items = frameItems(frame);
    if (frame === undefined || items === null) return false;
    useLayoutTimelinePreviewStore.getState().settle(frame, items);
    useCockpitStore.getState().selectPhase(frame.phaseId);
    setActiveIndex(index);
    setCursor(index);
    setPlayheadMs(Date.parse(frame.startsAt));
    return true;
  }, [frames]);

  const selectFrame = useCallback((targetIndex: number): void => {
    const targetFrame = frames[targetIndex];
    const targetItems = frameItems(targetFrame);
    if (targetFrame === undefined || targetItems === null) return;
    setPlaying(false);
    cancelAnimations();
    const fromFrame = frames[activeIndex];
    const fromItems = frameItems(fromFrame);
    if (
      fromFrame === undefined
      || fromItems === null
      || fromFrame.id === targetFrame.id
    ) {
      settleFrame(targetIndex);
      return;
    }

    useLayoutTimelinePreviewStore.getState().beginTransition({
      fromFrame,
      toFrame: targetFrame,
      fromItems,
      toItems: targetItems,
      reducedMotion,
    });
    useCockpitStore.getState().selectPhase(targetFrame.phaseId);
    setActiveIndex(targetIndex);
    const startedAt = performance.now();
    const fromIndex = activeIndex;
    const fromMs = Date.parse(fromFrame.startsAt);
    const toMs = Date.parse(targetFrame.startsAt);
    const animate = (now: number): void => {
      const duration = reducedMotion ? REDUCED_MOTION_KEYFRAME_MS : KEYFRAME_ANIMATION_MS;
      const linear = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - linear) ** 3;
      useLayoutTimelinePreviewStore.getState().setProgress(eased);
      setCursor(fromIndex + (targetIndex - fromIndex) * eased);
      setPlayheadMs(fromMs + (toMs - fromMs) * eased);
      if (linear < 1) {
        selectionAnimationRef.current = requestAnimationFrame(animate);
      } else {
        selectionAnimationRef.current = null;
        useLayoutTimelinePreviewStore.getState().settle(targetFrame, targetItems);
        setCursor(targetIndex);
        setPlayheadMs(toMs);
      }
    };
    selectionAnimationRef.current = requestAnimationFrame(animate);
  }, [activeIndex, cancelAnimations, frames, reducedMotion, settleFrame]);

  const moveKeyframe = useCallback((direction: -1 | 1): void => {
    const target = adjacentAvailableFrameIndex(availableIndices, activeIndex, direction);
    if (target !== null) selectFrame(target);
  }, [activeIndex, availableIndices, selectFrame]);

  const togglePlayback = useCallback((): void => {
    if (availableIndices.length < 2) return;
    if (playing) {
      setPlaying(false);
      if (playbackAnimationRef.current !== null) cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
      const nearest = availableIndices.reduce((best, index) =>
        Math.abs(index - cursor) < Math.abs(best - cursor) ? index : best,
      );
      settleFrame(nearest);
      setPlayheadMs(playheadMs);
      return;
    }
    cancelAnimations();
    settleFrame(availableIndices[0] ?? 0);
    setPlayheadMs(displayRange.fromMs);
    setPlaying(true);
  }, [availableIndices, cancelAnimations, cursor, displayRange.fromMs, playheadMs, playing, settleFrame]);

  useEffect(() => {
    if (!playing || availableIndices.length < 2) return;
    const startedAt = performance.now();
    let transitionKey: string | null = null;

    const animate = (now: number): void => {
      const elapsedMs = now - startedAt;
      const overall = Math.min(1, elapsedMs / FULL_PLAYBACK_MS);
      const playback = wallClockPlaybackCursor(
        frames,
        availableIndices,
        elapsedMs,
        FULL_PLAYBACK_MS,
        displayRange,
      );
      const segment = playback === null
        ? null
        : availableFrameSegment(availableIndices, playback.cursor);
      const fromIndex = segment?.fromIndex;
      const toIndex = segment?.toIndex;
      const fromFrame = fromIndex === undefined ? undefined : frames[fromIndex];
      const toFrame = toIndex === undefined ? undefined : frames[toIndex];
      const fromItems = frameItems(fromFrame);
      const toItems = frameItems(toFrame);

      if (
        fromIndex !== undefined
        && toIndex !== undefined
        && fromFrame !== undefined
        && toFrame !== undefined
        && fromItems !== null
        && toItems !== null
        && segment !== null
        && playback !== null
      ) {
        const key = `${fromFrame.id}:${toFrame.id}`;
        if (key !== transitionKey) {
          if (fromIndex === toIndex) {
            useLayoutTimelinePreviewStore.getState().settle(fromFrame, fromItems);
          } else {
            useLayoutTimelinePreviewStore.getState().beginTransition({
              fromFrame,
              toFrame,
              fromItems,
              toItems,
              reducedMotion,
            });
          }
          transitionKey = key;
        }
        useLayoutTimelinePreviewStore.getState().setProgress(segment.progress);
        const visualIndex = segment.progress < 0.5 ? fromIndex : toIndex;
        setActiveIndex(visualIndex);
        useCockpitStore.getState().selectPhase((segment.progress < 0.5 ? fromFrame : toFrame).phaseId);
        setCursor(playback.cursor);
        setPlayheadMs(playback.atMs);
      }

      if (overall < 1) {
        playbackAnimationRef.current = requestAnimationFrame(animate);
        return;
      }

      playbackAnimationRef.current = null;
      const lastIndex = availableIndices.at(-1);
      if (lastIndex !== undefined) settleFrame(lastIndex);
      setPlayheadMs(displayRange.toMs);
      setPlaying(false);
    };

    playbackAnimationRef.current = requestAnimationFrame(animate);
    return () => {
      if (playbackAnimationRef.current !== null) cancelAnimationFrame(playbackAnimationRef.current);
      playbackAnimationRef.current = null;
    };
  }, [availableIndices, displayRange, frames, playing, reducedMotion, settleFrame]);

  useEffect(() => {
    cancelAnimations();
    setPlaying(false);
    scrubTransitionRef.current = null;
    useLayoutTimelinePreviewStore.getState().clear();
    if (!canExpand) {
      setActiveIndex(0);
      setCursor(0);
      setPlayheadMs(displayRange.fromMs);
      return;
    }
    const firstAvailable = availableIndices[0];
    setActiveIndex(firstAvailable ?? 0);
    setCursor(firstAvailable ?? 0);
    const firstFrame = firstAvailable === undefined ? undefined : frames[firstAvailable];
    setPlayheadMs(firstFrame === undefined ? displayRange.fromMs : Date.parse(firstFrame.startsAt));
  }, [availableIndices, canExpand, cancelAnimations, displayRange.fromMs, frames]);

  useEffect(() => () => {
    cancelAnimations();
    useLayoutTimelinePreviewStore.getState().clear();
  }, [cancelAnimations]);

  useEffect(() => {
    const node = filmstripRef.current?.querySelector<HTMLElement>(`[data-frame-index="${String(activeIndex)}"]`);
    if (node === undefined || node === null || typeof node.scrollIntoView !== "function") return;
    node.scrollIntoView({ block: "nearest", inline: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }, [activeIndex, reducedMotion]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!canExpand || isTypingTarget(event.target)) return;
      if (event.key === "[") {
        if (event.repeat) return;
        event.preventDefault();
        moveKeyframe(-1);
      } else if (event.key === "]") {
        if (event.repeat) return;
        event.preventDefault();
        moveKeyframe(1);
      } else if (event.code === "Space") {
        if (!event.repeat && spaceDownAtRef.current === null) {
          spaceDownAtRef.current = performance.now();
        }
      }
    };
    const onKeyUp = (event: globalThis.KeyboardEvent): void => {
      if (event.code !== "Space") return;
      const startedAt = spaceDownAtRef.current;
      spaceDownAtRef.current = null;
      if (!canExpand || startedAt === null || isTypingTarget(event.target)) return;
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
    setScope(nextScope);
    setAnchorMs(nextScope === "day" ? range.fromMs + 12 * 60 * 60 * 1_000 : range.fromMs);
  }, [range.fromMs, scope]);

  const shift = useCallback((direction: -1 | 1): void => {
    setPlaying(false);
    if (scope === "day") {
      const shifted = shiftOperationalDayRange(range, direction);
      setAnchorMs(shifted.fromMs);
      return;
    }
    const shifted = shiftRange(range, direction);
    setAnchorMs(shifted.fromMs);
  }, [range, scope]);

  const jumpToEvent = useCallback((): void => {
    if (linkedEventAnchorMs === null) return;
    setPlaying(false);
    setAnchorMs(linkedEventAnchorMs);
  }, [linkedEventAnchorMs]);

  const exitPreview = useCallback((): void => {
    setPlaying(false);
    cancelAnimations();
    scrubTransitionRef.current = null;
    useLayoutTimelinePreviewStore.getState().clear();
  }, [cancelAnimations]);

  const toggleCollapsed = (): void => {
    if (!collapsed) exitPreview();
    setCollapsed((value) => !value);
  };

  const scrub = (event: ChangeEvent<HTMLInputElement>): void => {
    setPlaying(false);
    cancelAnimations();
    const atMs = Number(event.currentTarget.value);
    setPlayheadMs(atMs);
    const nextCursor = availableFrameCursorAtTime(frames, availableIndices, atMs);
    if (nextCursor === null) {
      useLayoutTimelinePreviewStore.getState().clear();
      return;
    }
    setCursor(nextCursor);
    const firstAvailable = availableIndices[0];
    const lastAvailable = availableIndices.at(-1);
    const firstFrame = firstAvailable === undefined ? undefined : frames[firstAvailable];
    const lastFrame = lastAvailable === undefined ? undefined : frames[lastAvailable];
    if (
      firstFrame === undefined
      || lastFrame === undefined
      || atMs < Date.parse(firstFrame.startsAt)
      || atMs > Date.parse(lastFrame.startsAt)
    ) {
      scrubTransitionRef.current = null;
      useLayoutTimelinePreviewStore.getState().clear();
      return;
    }
    const segment = availableFrameSegment(availableIndices, nextCursor);
    if (segment === null) {
      scrubTransitionRef.current = null;
      useLayoutTimelinePreviewStore.getState().clear();
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
      useLayoutTimelinePreviewStore.getState().clear();
      return;
    }
    const nearestIndex = segment.progress < 0.5 ? segment.fromIndex : segment.toIndex;
    setActiveIndex(nearestIndex);
    useCockpitStore.getState().selectPhase((segment.progress < 0.5 ? fromFrame : toFrame).phaseId);
    if (segment.fromIndex === segment.toIndex) {
      scrubTransitionRef.current = null;
      useLayoutTimelinePreviewStore.getState().settle(fromFrame, fromItems);
      return;
    }
    const key = `${fromFrame.id}:${toFrame.id}`;
    if (scrubTransitionRef.current !== key) {
      useLayoutTimelinePreviewStore.getState().beginTransition({
        fromFrame,
        toFrame,
        fromItems,
        toItems,
        reducedMotion,
      });
      scrubTransitionRef.current = key;
    }
    useLayoutTimelinePreviewStore.getState().setProgress(segment.progress);
  };

  const handleFilmstripWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || element.scrollWidth <= element.clientWidth) return;
    event.preventDefault();
    element.scrollLeft += event.deltaY;
  };

  const compact = compactMessage(timeline.status, frames, hasLinkedEvent);
  const playDisabled = availableIndices.length < 2;
  const previousDisabled = adjacentAvailableFrameIndex(availableIndices, activeIndex, -1) === null;
  const nextDisabled = adjacentAvailableFrameIndex(availableIndices, activeIndex, 1) === null;
  const playheadValueText = timelineValueText(playheadMs, frames);

  // Wave E: a timeline only communicates change. One scheduled phase has no
  // transition to scrub, so the entire dock yields the space back to the room.
  if (timeline.status === "loaded" && phaseCount === 1) return null;

  return (
    <footer
      className={`cockpit-bottom${effectiveCollapsed ? " is-collapsed" : ""}`}
      data-testid="cockpit-bottom"
      aria-label="Room layout timeline"
    >
      <header className="layout-timeline__header">
        <div className="layout-timeline__identity">
          <span className="layout-timeline__title"><Clock3 size={14} aria-hidden="true" />Room layouts</span>
          <span className="layout-timeline__truth">Saved phase snapshots · presentation only</span>
        </div>
        <RangeControls
          scope={scope}
          range={range}
          onScope={changeScope}
          onShift={shift}
          showJumpToEvent={linkedEventAnchorMs !== null && (linkedEventAnchorMs < range.fromMs || linkedEventAnchorMs >= range.toMs)}
          eventAnchorError={hasLinkedEvent && linkedEvent.status === "error"}
          onJumpToEvent={jumpToEvent}
        />

        {effectiveCollapsed ? (
          <div className={`layout-compact-state is-${compact.tone}`} role={compact.tone === "error" ? "alert" : "status"}>
            {compact.tone === "loading" ? <LoaderCircle className="is-spinning" size={14} aria-hidden="true" /> : null}
            {compact.tone === "error" ? <CircleAlert size={14} aria-hidden="true" /> : null}
            <strong>{canExpand && collapsed ? activeFrame?.phaseName ?? "Room timeline" : compact.title}</strong>
            <span>{canExpand && collapsed ? activeFrame === undefined ? "" : `${frameTime(activeFrame)} · ${frameStateLabel(activeFrame)}` : compact.detail}</span>
          </div>
        ) : null}

        {!effectiveCollapsed ? (
          <div className="layout-timeline__metrics" aria-live="polite">
            <MetricChip label="Guests" value={metrics?.guests ?? null} />
            <MetricChip label="Objects" value={metrics?.objects ?? null} />
            <MetricChip label="Tables" value={metrics?.tables ?? null} />
            <MetricChip label="Seats" value={metrics?.seats ?? null} />
            <MetricChip label="Stage / bar" value={metrics?.stages ?? null} suffix={` / ${numericText(metrics?.bars ?? null)}`} />
          </div>
        ) : null}

        {canExpand ? (
          <div className="layout-timeline__dock-actions">
            {!effectiveCollapsed && previewActive ? (
              <button type="button" className="layout-exit-preview" onClick={exitPreview}>Exit preview</button>
            ) : null}
            <button
              type="button"
              className="layout-collapse-button"
              aria-label={collapsed ? "Expand room timeline" : "Collapse room timeline"}
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
            </button>
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
                  className={`layout-phase${active ? " is-active" : ""}${available ? "" : " is-unavailable"}${frame.keyframe.state === "missing" ? " is-missing" : ""}${frame.keyframe.state === "invalid" ? " is-invalid" : ""}${frame.kind === "room_flip" ? " is-gap" : ""}${frameLifecycleClass(frame)}`}
                  style={{
                    left: `${String(block.leftPercent)}%`,
                    width: `${String(block.widthPercent)}%`,
                    top: `${String((block.lane / block.laneCount) * 100)}%`,
                    height: `calc(${String(100 / block.laneCount)}% - 3px)`,
                  }}
                  aria-pressed={active && available}
                  aria-label={`${frame.eventName}, ${frame.phaseName}, ${frameTime(frame)}, ${frameStateLabel(frame)}${clipLabel}`}
                  title={`${frame.eventName} · ${frame.phaseName} · ${frameTime(frame)} · ${frameStateLabel(frame)}`}
                  disabled={!available}
                  onClick={() => { selectFrame(index); }}
                >
                  <span className="layout-phase__time">{frameTime(frame)}</span>
                  <span className="layout-phase__name">{frame.phaseName}</span>
                  <span className="layout-phase__event">{frame.eventName}</span>
                  <span className="layout-phase__state">{frameStateLabel(frame)}</span>
                </button>
              );
            })}
          </div>

          <div className="layout-ruler" aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick.atMs} className="layout-ruler__tick" style={{ left: `${String(tick.positionPercent)}%` }}>
                <i />{tick.label}
              </span>
            ))}
            <span className="layout-ruler__playhead" style={{ left: `${String(timePositionPercent(playheadMs, displayRange.fromMs, displayRange.toMs))}%` }}>
              <i />
            </span>
          </div>
          <input
            className="layout-ruler__input"
            type="range"
            min={displayRange.fromMs}
            max={displayRange.toMs}
            step={60_000}
            value={playheadMs}
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
                const canLinkCurrentPlan = frame.kind === "phase"
                  && frame.keyframe.state === "missing"
                  && frame.keyframe.reason === "no_snapshot";
                return (
                  <div
                    key={frame.id}
                    className={`layout-filmstrip__item${canLinkCurrentPlan ? " has-link-action" : ""}`}
                    role="listitem"
                    data-frame-index={index}
                  >
                    <button
                      type="button"
                      className={`layout-filmstrip__card${index === activeIndex ? " is-active" : ""}${available ? "" : " is-unavailable"}${frame.keyframe.state === "missing" ? " is-missing" : ""}${frame.keyframe.state === "invalid" ? " is-invalid" : ""}${frameLifecycleClass(frame)}`}
                      aria-label={`${frame.eventName}, ${frame.phaseName}, ${frameStateLabel(frame)}`}
                      aria-pressed={available && index === activeIndex}
                      disabled={!available}
                      onClick={() => { selectFrame(index); }}
                    >
                      {frame.keyframe.state === "available" ? (
                        <LayoutPlanThumbnail snapshot={frame.keyframe.payload} label={`${frame.eventName} ${frame.phaseName}`} />
                      ) : (
                        <span className="layout-filmstrip__unavailable">
                          <CircleAlert size={15} aria-hidden="true" />
                          <strong>{frameStateLabel(frame)}</strong>
                          <span>{frame.keyframe.message}</span>
                        </span>
                      )}
                      <span className="layout-filmstrip__caption">
                        <span><strong>{formatWallTime(Date.parse(frame.startsAt))}</strong>{frame.phaseName}</span>
                        <small>{frame.eventName} · {frameStateLabel(frame)}</small>
                      </span>
                    </button>
                    {canLinkCurrentPlan ? (
                      <PhaseLayoutSnapshotAction
                        eventId={frame.eventId}
                        phaseId={frame.phaseId}
                        configurationId={configurationId}
                        isDirty={isDirty}
                        isReadOnly={isReadOnly}
                        onLinked={() => { timeline.refresh(); }}
                      />
                    ) : null}
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

