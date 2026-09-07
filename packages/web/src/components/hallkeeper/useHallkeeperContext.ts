import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigurationIdSchema, EventIdSchema, type EventDayOpsBoard, type EventPhaseGraph } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { getConfig } from "../../api/configurations.js";
import { getEventDayOpsBoard } from "../../api/event-day-ops.js";
import { getEventPhaseGraph } from "../../api/events.js";
import { getVenue } from "../../api/spaces.js";
import { resolveEventLinkedLayouts } from "../../lib/event-linked-layouts.js";
import { useAuthStore } from "../../stores/auth-store.js";

export interface HallkeeperContextLayout {
  readonly configurationId: string;
  readonly name: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly spaceSlug: string;
}

export interface HallkeeperVerifiedContext {
  readonly configId: string;
  readonly venue: { readonly id: string; readonly name: string; readonly slug: string };
  readonly room: { readonly id: string; readonly name: string; readonly slug: string };
  /** Planning phases; neither their elapsed times nor selection prove execution. */
  readonly graph: EventPhaseGraph | null;
  /** Event-wide issues; a non-null pack here always belongs to this configuration. */
  readonly board: EventDayOpsBoard | null;
  readonly layouts: readonly HallkeeperContextLayout[];
  readonly unavailableLayoutCount: number;
  readonly opsError: string | null;
}

export interface HallkeeperContextResult {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly context: HallkeeperVerifiedContext | null;
  readonly error: string | null;
  readonly retry: () => void;
}

interface StoredContext {
  readonly requestKey: string | null;
  readonly status: HallkeeperContextResult["status"];
  readonly context: HallkeeperVerifiedContext | null;
  readonly error: string | null;
}

function verifyBoard(board: EventDayOpsBoard, eventId: string, venueId: string): void {
  const pack = board.handoffPack?.pack;
  if (board.event.id !== eventId || board.event.venueId !== venueId
    || board.phases.some((phase) => phase.eventId !== eventId)
    || board.issues.some((issue) => issue.eventId !== eventId)
    || board.assignments.some((assignment) => assignment.eventId !== eventId)
    || board.statusUpdates.some((update) => update.eventId !== eventId)
    || (pack !== undefined && pack.eventId !== eventId)
    || (pack !== undefined && board.handoffPack?.opsTasks.some((task) => task.handoffPackId !== pack.id) === true)) {
    throw new Error("The event's operations context could not be verified.");
  }
}

/** Read-only enrichment. The sheet remains usable if this separate request fails. */
async function loadContext(configId: string, requestedEventId: string, isCurrent: () => boolean): Promise<HallkeeperVerifiedContext> {
  const assertCurrent = (): void => { if (!isCurrent()) throw new Error("Context request superseded."); };
  if (!ConfigurationIdSchema.safeParse(configId).success) throw new Error("This layout link could not be verified.");
  const config = await getConfig(configId);
  assertCurrent();
  if (config.id !== configId) throw new Error("The selected layout's identity could not be verified.");
  const venue = await getVenue(config.venueId);
  assertCurrent();
  const room = venue.spaces.find((space) => space.id === config.spaceId && space.venueId === config.venueId);
  if (venue.id !== config.venueId || room === undefined) throw new Error("The selected layout's room could not be verified.");
  const currentLayout: HallkeeperContextLayout = {
    configurationId: config.id, name: config.name, spaceId: room.id, spaceName: room.name, spaceSlug: room.slug,
  };
  const base: HallkeeperVerifiedContext = {
    configId, venue: { id: venue.id, name: venue.name, slug: venue.slug },
    room: { id: room.id, name: room.name, slug: room.slug },
    graph: null, board: null, layouts: [currentLayout], unavailableLayoutCount: 0, opsError: null,
  };
  if (requestedEventId.length === 0) return base;
  if (!EventIdSchema.safeParse(requestedEventId).success) throw new Error("This event link could not be verified.");

  // Existing resolver owns event-link, variant and latest frozen-snapshot
  // membership validation. A URL parameter or matching room name is no proof.
  const [graphResult, layoutsResult, boardResult] = await Promise.allSettled([
    getEventPhaseGraph(requestedEventId),
    resolveEventLinkedLayouts({ eventId: requestedEventId, venueSlug: venue.slug, spaceSlug: null, isCurrent }),
    getEventDayOpsBoard(requestedEventId),
  ]);
  assertCurrent();
  if (graphResult.status === "rejected") throw new Error("The linked event's schedule could not be loaded. Your setup sheet is still available.");
  if (layoutsResult.status === "rejected") throw new Error("The event's linked layouts could not be verified. Your setup sheet is still available.");
  const graph = graphResult.value;
  if (graph.event.id !== requestedEventId || graph.event.venueId !== config.venueId
    || graph.phases.some((phase) => phase.eventId !== requestedEventId
      || (phase.spaceId !== null && !venue.spaces.some((space) => space.id === phase.spaceId && space.venueId === config.venueId)))) {
    throw new Error("The event does not belong to this layout's venue and rooms.");
  }

  let board: EventDayOpsBoard | null = null;
  let opsError: string | null = null;
  if (boardResult.status === "fulfilled") {
    verifyBoard(boardResult.value, requestedEventId, config.venueId);
    board = boardResult.value;
  } else {
    opsError = "Operations updates could not be loaded. The verified event schedule is available.";
  }
  const linked = layoutsResult.value;
  const pack = board?.handoffPack?.pack;
  const linkedByGraph = linked.layouts.some((layout) => layout.configurationId === configId);
  const linkedByHandoff = pack?.configId === configId && pack.eventId === requestedEventId;
  if (!linkedByGraph && !linkedByHandoff) throw new Error("This layout has not been linked to the requested event. The setup sheet remains available.");

  // The event's latest pack may belong to another room/configuration. Do not
  // display its checklist as this room's work, even when the event is correct.
  if (pack !== undefined && pack.configId !== configId) {
    board = null;
    opsError = "The latest operations pack is for another layout. Open the event's working documents to choose its pack.";
  }

  const layouts: HallkeeperContextLayout[] = [];
  let unavailableLayoutCount = linked.unavailableCount;
  const references = [...new Set([...linked.layouts.map((layout) => layout.configurationId), ...(linkedByHandoff ? [configId] : [])])];
  for (let offset = 0; offset < references.length; offset += 4) {
    assertCurrent();
    const ids = references.slice(offset, offset + 4);
    const results = await Promise.allSettled(ids.map((id) => getConfig(id)));
    assertCurrent();
    for (const [index, result] of results.entries()) {
      const expectedId = ids[index];
      if (result.status === "rejected") {
        if (expectedId !== configId && result.reason instanceof ApiError && (result.reason.status === 403 || result.reason.status === 404)) {
          unavailableLayoutCount += 1;
          continue;
        }
        throw new Error("Some linked rooms could not be checked. Retry to load the complete choice.");
      }
      const candidate = result.value;
      const candidateRoom = venue.spaces.find((space) => space.id === candidate.spaceId && space.venueId === config.venueId);
      if (candidate.id !== expectedId || candidate.venueId !== config.venueId || candidateRoom === undefined
        || (candidate.id === configId && (candidate.spaceId !== config.spaceId || candidate.revision !== config.revision))) {
        throw new Error("A linked layout changed while its room was being checked. Reload the context.");
      }
      layouts.push({ configurationId: candidate.id, name: candidate.name, spaceId: candidateRoom.id, spaceName: candidateRoom.name, spaceSlug: candidateRoom.slug });
    }
  }
  return { ...base, graph, board, layouts, unavailableLayoutCount, opsError };
}

export function useHallkeeperContext(configId: string | null | undefined, eventId?: string | null): HallkeeperContextResult {
  const user = useAuthStore((state) => state.user);
  const authKey = user === null ? "anonymous" : JSON.stringify([user.id, user.venueId, user.role, user.platformRole]);
  const requestedEventId = eventId?.trim() ?? "";
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setAttempt((value) => value + 1); }, []);
  const requestKey = configId === null || configId === undefined ? null : JSON.stringify([configId, requestedEventId, authKey, attempt]);
  const generationRef = useRef(0);
  const [result, setResult] = useState<StoredContext>({ requestKey: null, status: "idle", context: null, error: null });

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (requestKey === null || configId === null || configId === undefined) return;
    let cancelled = false;
    const isCurrent = (): boolean => !cancelled && generationRef.current === generation;
    setResult({ requestKey, status: "loading", context: null, error: null });
    void loadContext(configId, requestedEventId, isCurrent).then((context) => {
      if (isCurrent()) setResult({ requestKey, status: "ready", context, error: null });
    }).catch((error: unknown) => {
      if (isCurrent()) setResult({ requestKey, status: "error", context: null,
        error: error instanceof Error ? error.message : "Event context could not be loaded. Your setup sheet is still available." });
    });
    return () => { cancelled = true; };
  }, [authKey, configId, requestedEventId, requestKey]);

  if (requestKey === null) return { status: "idle", context: null, error: null, retry };
  if (result.requestKey !== requestKey) return { status: "loading", context: null, error: null, retry };
  return { status: result.status, context: result.context, error: result.error, retry };
}
