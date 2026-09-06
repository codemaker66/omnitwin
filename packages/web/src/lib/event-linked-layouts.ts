import { EventIdSchema, type EventPhaseGraph } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { getConfig } from "../api/configurations.js";
import { getEventPhaseGraph } from "../api/events.js";
import { getVenue } from "../api/spaces.js";

export interface LinkedLayoutChoice {
  readonly configurationId: string;
  readonly name: string;
  readonly spaceName: string;
}

export interface EventLinkedLayouts {
  readonly eventName: string;
  readonly roomName: string | null;
  readonly layouts: readonly LinkedLayoutChoice[];
  readonly unavailableCount: number;
}

interface CandidateReference {
  readonly configurationId: string;
  readonly phaseRoomIds: ReadonlySet<string> | null;
}

function candidateConfigurations(graph: EventPhaseGraph): readonly CandidateReference[] {
  const eventId = graph.event.id;
  if (graph.phases.some((phase) => phase.eventId !== eventId)
    || graph.configurationLinks.some((link) => link.eventId !== eventId)
    || graph.layoutVariants.some((variant) => variant.eventId !== eventId)) {
    throw new Error("The event's layout references could not be verified.");
  }
  const variants = new Map(graph.layoutVariants.map((variant) => [variant.id, variant]));
  const ids = new Set<string>();
  for (const link of graph.configurationLinks) {
    const variant = link.layoutVariantId === null ? undefined : variants.get(link.layoutVariantId);
    if (link.layoutVariantId !== null && (variant === undefined || variant.configurationId !== link.configurationId)) {
      throw new Error("The event's linked variant could not be verified.");
    }
    if (variant?.status === "archived") continue;
    ids.add(link.configurationId);
  }
  for (const variant of graph.layoutVariants) {
    if (variant.status !== "archived" && variant.configurationId !== null) ids.add(variant.configurationId);
  }
  // A frozen manual phase can have a configuration before a named variant is
  // linked. Only its latest recorded snapshot is a current candidate; an older
  // frozen entry must not revive a superseded/stale phase association.
  const phases = new Map(graph.phases.map((phase) => [phase.id, phase]));
  const latest = new Map<string, EventPhaseGraph["phaseLayoutSnapshots"][number]>();
  for (const snapshot of graph.phaseLayoutSnapshots) {
    if (!phases.has(snapshot.eventPhaseId)) throw new Error("The event's phase reference could not be verified.");
    const previous = latest.get(snapshot.eventPhaseId);
    const versionTime = snapshot.frozenAt ?? snapshot.createdAt;
    if (previous === undefined || versionTime > (previous.frozenAt ?? previous.createdAt)
      || (versionTime === (previous.frozenAt ?? previous.createdAt) && snapshot.id > previous.id)) latest.set(snapshot.eventPhaseId, snapshot);
  }
  const phaseRoomsByConfig = new Map<string, Set<string>>();
  for (const snapshot of latest.values()) {
    const roomId = phases.get(snapshot.eventPhaseId)?.spaceId;
    if (snapshot.status !== "frozen" || snapshot.configurationId === null || roomId === null || roomId === undefined) continue;
    const rooms = phaseRoomsByConfig.get(snapshot.configurationId) ?? new Set<string>();
    rooms.add(roomId);
    phaseRoomsByConfig.set(snapshot.configurationId, rooms);
  }
  return [...new Set([...ids, ...phaseRoomsByConfig.keys()])].map((configurationId) => ({
    configurationId,
    // Explicit event links remain useful independently of any one phase's
    // room. Snapshot-only provenance must still agree with the live phase room.
    phaseRoomIds: ids.has(configurationId) ? null : phaseRoomsByConfig.get(configurationId) ?? new Set<string>(),
  }));
}

/** Resolve only event-owned references through the authenticated configuration API. */
export async function resolveEventLinkedLayouts(input: {
  readonly eventId: string;
  readonly venueSlug?: string;
  readonly spaceSlug: string | null;
  readonly isCurrent: () => boolean;
}): Promise<EventLinkedLayouts> {
  const assertCurrent = (): void => { if (!input.isCurrent()) throw new Error("Layout request superseded."); };
  if (!EventIdSchema.safeParse(input.eventId).success) throw new Error("Invalid event link.");
  assertCurrent();
  const graph = await getEventPhaseGraph(input.eventId);
  assertCurrent();
  if (graph.event.id !== input.eventId) throw new Error("The requested event could not be verified.");
  const candidates = candidateConfigurations(graph);
  const venue = await getVenue(graph.event.venueId);
  assertCurrent();
  if (venue.id !== graph.event.venueId || (input.venueSlug !== undefined && venue.slug !== input.venueSlug)) {
    throw new Error("The event does not belong to the requested venue.");
  }
  const rooms = venue.spaces.filter((space) => space.venueId === venue.id);
  const requestedRoom = input.spaceSlug === null ? undefined : rooms.find((room) => room.slug === input.spaceSlug);
  if (input.spaceSlug !== null && requestedRoom === undefined) throw new Error("The requested room is not in this event's venue.");
  const eligibleRooms = new Map(rooms.filter((room) => requestedRoom === undefined || room.id === requestedRoom.id).map((room) => [room.id, room]));
  let unavailableCount = 0;
  const layouts: LinkedLayoutChoice[] = [];
  // Limit parallel requests without skipping references or choosing the first
  // result. A transient failure means the full choice set is not yet known.
  for (let offset = 0; offset < candidates.length; offset += 4) {
    assertCurrent();
    const batch = candidates.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map((candidate) => getConfig(candidate.configurationId)));
    assertCurrent();
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        if (result.reason instanceof ApiError && (result.reason.status === 403 || result.reason.status === 404)) {
          unavailableCount += 1;
          continue;
        }
        throw new Error("Some linked layouts could not be checked. Retry to load the complete choice.");
      }
      const config = result.value;
      const reference = batch[index];
      if (reference === undefined || config.id !== reference.configurationId) throw new Error("A linked layout's identity could not be verified.");
      const room = eligibleRooms.get(config.spaceId);
      if (config.venueId !== venue.id || room === undefined
        || (reference.phaseRoomIds !== null && !reference.phaseRoomIds.has(config.spaceId))) continue;
      layouts.push({ configurationId: config.id, name: config.name, spaceName: room.name });
    }
  }
  return { eventName: graph.event.name, roomName: requestedRoom?.name ?? null, layouts, unavailableCount };
}
