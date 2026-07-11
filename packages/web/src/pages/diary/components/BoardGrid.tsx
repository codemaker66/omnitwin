import type { ReactElement } from "react";
import type {
  CalendarEntry,
  CalendarRoom,
  ConflictSeverity,
} from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";
import {
  dayColumns,
  formatWallTime,
  hourTicks,
  msToX,
  widthPx,
  type BoardRange,
} from "../lib/board-time.js";
import { layoutLane, type PositionedBlock } from "../lib/board-layout.js";
import type { BoardDrag, DragBlockDescriptor } from "../hooks/useBoardDrag.js";

// ---------------------------------------------------------------------------
// BoardGrid (T-493; Canon §8/§18 concept A) — rooms as lanes on a horizontal
// time axis. DOM-first: absolutely positioned blocks inside scrollable lanes,
// sticky room rail, sticky axis, brass now-line. Disclosure follows the zoom:
// colour survives everything, then title, then times (Canon §8 priority).
// ---------------------------------------------------------------------------

const SUB_ROW_HEIGHT = 44;
const BLOCK_HEIGHT = 38;
const LANE_PADDING = 6;
const MIN_BLOCK_WIDTH = 12;
const TITLE_MIN_WIDTH = 42;
const TIME_MIN_WIDTH = 88;

export interface BoardGridProps {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
  readonly range: BoardRange;
  readonly pxPerHour: number;
  readonly conflictSeverity: ReadonlyMap<string, ConflictSeverity>;
  readonly drag: BoardDrag;
  readonly writable: boolean;
  readonly nowMs: number;
}

function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${String(rank)}th`;
  switch (rank % 10) {
    case 1:
      return `${String(rank)}st`;
    case 2:
      return `${String(rank)}nd`;
    case 3:
      return `${String(rank)}rd`;
    default:
      return `${String(rank)}th`;
  }
}

function rankChip(block: PositionedBlock): string | null {
  const { entry } = block;
  if (entry.kind !== "hold") return null;
  if (entry.rank === null) return BOARD_COPY.block.unranked;
  if (entry.rank === 1 && entry.jointFlag) return BOARD_COPY.block.jointFirst;
  return BOARD_COPY.block.rank(ordinal(entry.rank));
}

export function BoardGrid(props: BoardGridProps): ReactElement {
  const { rooms, entries, range, pxPerHour, conflictSeverity, drag, writable, nowMs } = props;
  const canvasWidth = widthPx(range.fromMs, range.toMs, pxPerHour);
  const columns = dayColumns(range);
  const ticks = range.view === "day" ? hourTicks(range) : [];
  const nowVisible = nowMs >= range.fromMs && nowMs < range.toMs;
  const ghost = drag.ghost;

  return (
    <div className="diary-scroll" role="region" aria-label={BOARD_COPY.title} tabIndex={0}>
      <div
        className="diary-canvas"
        style={{ width: `calc(var(--diary-rail-width) + ${String(canvasWidth)}px)` }}
      >
        <div className="diary-axis-row" role="row">
          <div className="diary-rail diary-axis-corner" aria-hidden="true" />
          <div className="diary-axis" style={{ width: canvasWidth }}>
            {columns.map((column) => (
              <div
                key={column.startMs}
                className={`diary-axis-day${column.isWeekend ? " is-weekend" : ""}`}
                style={{
                  left: msToX(column.startMs, range, pxPerHour),
                  width: widthPx(column.startMs, column.endMs, pxPerHour),
                }}
              >
                <span className="diary-axis-day-label">{column.label}</span>
              </div>
            ))}
            {ticks.map((tick) => (
              <span
                key={tick.ms}
                className="diary-axis-tick"
                style={{ left: msToX(tick.ms, range, pxPerHour) }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>

        <div className="diary-lanes">
          {rooms.map((room) => {
            const lane = layoutLane(entries, room.id);
            const laneHeight = lane.subRowCount * SUB_ROW_HEIGHT + LANE_PADDING * 2;
            const activeBookings = lane.blocks.filter((block) => block.entry.status === "active");
            const inkCount = activeBookings.filter((block) => block.entry.kind === "ink").length;
            const holdCount = activeBookings.filter((block) => block.entry.kind === "hold").length;

            return (
              <div key={room.id} className="diary-lane-row" role="row">
                <div className="diary-rail" role="rowheader">
                  <span className="diary-rail-name">{room.name}</span>
                  <span className="diary-rail-counts">
                    <span className="diary-rail-count is-ink">
                      {BOARD_COPY.lane.inkCount(inkCount)}
                    </span>
                    <span className="diary-rail-count is-hold">
                      {BOARD_COPY.lane.holdCount(holdCount)}
                    </span>
                  </span>
                </div>
                <div
                  className="diary-lane"
                  data-diary-lane={room.id}
                  style={{ width: canvasWidth, height: laneHeight }}
                >
                  {columns.map((column) => (
                    <div
                      key={column.startMs}
                      className={`diary-lane-col${column.isWeekend ? " is-weekend" : ""}`}
                      style={{
                        left: msToX(column.startMs, range, pxPerHour),
                        width: widthPx(column.startMs, column.endMs, pxPerHour),
                      }}
                      aria-hidden="true"
                    />
                  ))}

                  {lane.orphanPhases.map((positioned) => {
                    const left = msToX(
                      Math.max(positioned.startMs, range.fromMs),
                      range,
                      pxPerHour,
                    );
                    const right = msToX(Math.min(positioned.endMs, range.toMs), range, pxPerHour);
                    return (
                      <div
                        key={positioned.phase.id}
                        className="diary-phase-strip"
                        style={{
                          left,
                          width: Math.max(right - left, MIN_BLOCK_WIDTH),
                          top:
                            LANE_PADDING + positioned.subRow * SUB_ROW_HEIGHT + BLOCK_HEIGHT - 14,
                        }}
                        title={`${positioned.phase.eventName} — ${positioned.phase.name}`}
                      >
                        <span className="diary-phase-strip-label">
                          {positioned.phase.eventName} · {positioned.phase.name}
                        </span>
                      </div>
                    );
                  })}

                  {lane.blocks.map((block) => {
                    const clampedStart = Math.max(block.startMs, range.fromMs);
                    const clampedEnd = Math.min(block.endMs, range.toMs);
                    const left = msToX(clampedStart, range, pxPerHour);
                    const width = Math.max(
                      msToX(clampedEnd, range, pxPerHour) - left,
                      MIN_BLOCK_WIDTH,
                    );
                    const severity = conflictSeverity.get(block.entry.id);
                    const chip = rankChip(block);
                    const isActive = block.entry.status === "active";
                    const descriptor: DragBlockDescriptor = {
                      id: block.entry.id,
                      title: block.entry.title,
                      spaceId: block.entry.spaceId,
                      startMs: block.startMs,
                      endMs: block.endMs,
                      isInk: block.entry.kind === "ink",
                    };
                    const handlers = isActive ? drag.handlersFor(descriptor) : {};
                    const timeLabel = `${formatWallTime(block.startMs)}–${formatWallTime(block.endMs)}`;
                    const stateClass = `is-${block.entry.status === "active" ? block.entry.kind : "exited"}`;
                    const beingDragged = drag.activeBlockId === block.entry.id;
                    const ariaLabel = `${block.entry.title} — ${BOARD_COPY.legend[block.entry.kind]}, ${timeLabel}, ${room.name}${chip === null ? "" : `, ${chip}`}${severity === undefined ? "" : ", has a conflict"}${writable && isActive ? `. ${BOARD_COPY.drag.grabHint}` : ""}`;

                    return (
                      <button
                        key={block.entry.id}
                        type="button"
                        id={`diary-block-${block.entry.id}`}
                        className={[
                          "diary-block",
                          stateClass,
                          severity !== undefined ? `has-conflict-${severity}` : "",
                          beingDragged ? "is-dragging" : "",
                          block.startMs < range.fromMs ? "is-clipped-start" : "",
                          block.endMs > range.toMs ? "is-clipped-end" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={{
                          left,
                          width,
                          top: LANE_PADDING + block.subRow * SUB_ROW_HEIGHT,
                          height: BLOCK_HEIGHT,
                        }}
                        aria-label={ariaLabel}
                        {...handlers}
                      >
                        {width >= TITLE_MIN_WIDTH ? (
                          <span className="diary-block-title">{block.entry.title}</span>
                        ) : null}
                        {width >= TIME_MIN_WIDTH ? (
                          <span className="diary-block-time">{timeLabel}</span>
                        ) : null}
                        {chip !== null && width >= TIME_MIN_WIDTH ? (
                          <span className="diary-block-chip">{chip}</span>
                        ) : null}
                        {block.segments.length > 0 && width >= TITLE_MIN_WIDTH ? (
                          <span className="diary-block-segments" aria-hidden="true">
                            {block.segments.map((segment) => {
                              const segStart = Math.max(segment.startMs, block.startMs);
                              const segEnd = Math.min(segment.endMs, block.endMs);
                              const total = block.endMs - block.startMs;
                              return (
                                <span
                                  key={segment.id}
                                  className="diary-block-segment"
                                  style={{
                                    left: `${String(((segStart - block.startMs) / total) * 100)}%`,
                                    width: `${String(((segEnd - segStart) / total) * 100)}%`,
                                  }}
                                  title={segment.name}
                                />
                              );
                            })}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}

                  {ghost !== null && ghost.spaceId === room.id ? (
                    <div
                      className={`diary-ghost is-${ghost.validity.kind}`}
                      style={{
                        left: msToX(Math.max(ghost.startMs, range.fromMs), range, pxPerHour),
                        width: Math.max(
                          msToX(Math.min(ghost.endMs, range.toMs), range, pxPerHour) -
                            msToX(Math.max(ghost.startMs, range.fromMs), range, pxPerHour),
                          MIN_BLOCK_WIDTH,
                        ),
                      }}
                      aria-hidden="true"
                    >
                      <span className="diary-ghost-time">
                        {formatWallTime(ghost.startMs)}–{formatWallTime(ghost.endMs)}
                      </span>
                      {ghost.validity.kind !== "ok" ? (
                        <span className="diary-ghost-reason">{ghost.validity.reason}</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {nowVisible ? (
            <div
              className="diary-now"
              style={{
                left: `calc(var(--diary-rail-width) + ${String(msToX(nowMs, range, pxPerHour))}px)`,
              }}
              aria-hidden="true"
            >
              <span className="diary-now-plaque">{BOARD_COPY.nowLabel}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
