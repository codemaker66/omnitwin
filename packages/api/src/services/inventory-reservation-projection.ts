import { createHash } from "node:crypto";
import { InventoryReservationSourceSchema, canonicalLayoutSnapshotDigest,
  type InventoryAssessmentIssue, type InventoryReservationPhase, type InventoryReservationRelease,
  type InventoryReservationSource, type InventoryWindow } from "@omnitwin/types";
import { resolveRoomLayoutTimelineKeyframe, type LayoutTimelineSnapshotCandidate } from "./room-layout-timeline.js";

export interface InventorySourceInput {
  venueId: string; eventId: string; spaceId: string; eventName: string; eventStatus: string;
  eventUpdatedAt: string; eventDeleted: boolean; spaceName: string; spaceDeleted: boolean;
  bookings: { id: string; window: InventoryWindow; updatedAt: string }[];
  phases: { id: string; spaceId: string | null; name: string; templateKey: string | null;
    startsAt: string | null; durationMinutes: number; updatedAt: string; snapshots: LayoutTimelineSnapshotCandidate[] }[];
  catalogue: { id: string; name: string; category: string }[];
  accessoryParentIds: string[];
  latestRelease: InventoryReservationRelease | null;
}

/** Stable key ordering makes digests independent of PostgreSQL jsonb ordering. */
export function inventoryDecisionDigest(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]));
    }
    return input;
  }
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function inventoryWindowsOverlap(left: InventoryWindow, right: InventoryWindow): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt) && Date.parse(right.startsAt) < Date.parse(left.endsAt);
}

/** Only explicit catalogue instances in verified frozen evidence are counted.
 * Each room holds its item peaks across the entire recorded footprint; room
 * allocations are summed by the availability sweep, never event-wide maxed. */
export function projectInventorySource(input: InventorySourceInput): InventoryReservationSource {
  const issues: InventoryAssessmentIssue[] = [];
  const issue = (code: string, message: string, phaseId: string | null = null): void => {
    issues.push({ code, message, eventId: input.eventId, spaceId: input.spaceId, phaseId });
  };
  const bookings = [...input.bookings].sort((left, right) => left.id.localeCompare(right.id));
  if (bookings.length === 0 && input.latestRelease === null) {
    issue("ROOM_BOOKING_MISSING", "This room's event phases have no active ink booking to authorize inventory demand.");
  }
  const relevant = input.phases.filter((phase) => phase.spaceId === input.spaceId || phase.spaceId === null)
    .sort((left, right) => (left.startsAt ?? "").localeCompare(right.startsAt ?? "") || left.id.localeCompare(right.id));
  if (input.eventDeleted || input.spaceDeleted || input.eventStatus === "cancelled") {
    issue("SOURCE_INACTIVE", "The event or room is cancelled or removed; review and revoke any retained commitment.");
  }
  const phases: InventoryReservationPhase[] = [];
  const peak = new Map<string, number>();
  let lastEnd = -Infinity;
  let hasLayout = false;
  for (const [index, phase] of relevant.entries()) {
    if (phase.spaceId === null || phase.startsAt === null || phase.durationMinutes <= 0) {
      issue("PHASE_SCOPE_OR_TIME_MISSING", "Every event phase needs an explicit room and positive occupied time.", phase.id);
      continue;
    }
    const start = Date.parse(phase.startsAt);
    const end = start + phase.durationMinutes * 60_000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(new Date(end).getTime())) {
      issue("PHASE_TIME_INVALID", "The phase timing cannot be interpreted as a valid occupied interval.", phase.id); continue;
    }
    if (start < lastEnd) issue("PHASE_OVERLAP", "Overlapping layouts or transitions in this room need an explicit allocation decision.", phase.id);
    lastEnd = Math.max(lastEnd, end);
    const window = { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() };
    const roomFlip = phase.templateKey === "room-flip"
      || (phase.templateKey === null && phase.name.trim().toLowerCase() === "room flip");
    const breakdownCarry = phase.templateKey === "breakdown" && hasLayout && index === relevant.length - 1
      && phase.snapshots.length === 0;
    if (roomFlip || breakdownCarry) {
      phases.push({ phaseId: phase.id, name: phase.name, window, mode: roomFlip ? "room_flip_carry" : "breakdown_carry",
        snapshotId: null, canonicalSnapshotId: null, proofDigest: null, snapshotDigest: null, objects: [] });
      continue;
    }
    if (phase.snapshots.some((snapshot) => snapshot.eventPhaseId !== phase.id)) {
      issue("SNAPSHOT_PHASE_MISMATCH", "The frozen snapshot belongs to a different event phase.", phase.id); continue;
    }
    const keyframe = resolveRoomLayoutTimelineKeyframe({ venueId: input.venueId, spaceId: input.spaceId,
      isRoomFlip: false, candidates: phase.snapshots });
    if (keyframe.state !== "available") {
      issue("FROZEN_LAYOUT_UNAVAILABLE", `${phase.name}: ${keyframe.message}`, phase.id); continue;
    }
    const objects = keyframe.payload.objects.map((object) => ({ objectId: object.objectId.toLowerCase(),
      assetDefinitionId: object.assetDefinition.assetDefinitionId.toLowerCase() })).sort((left, right) => left.objectId.localeCompare(right.objectId));
    if (new Set(objects.map((object) => object.objectId)).size !== objects.length) {
      issue("DUPLICATE_LAYOUT_OBJECT", "Frozen layout repeats a physical object identity.", phase.id); continue;
    }
    hasLayout = true;
    const counts = new Map<string, number>();
    for (const object of objects) counts.set(object.assetDefinitionId, (counts.get(object.assetDefinitionId) ?? 0) + 1);
    for (const [id, count] of counts) peak.set(id, Math.max(peak.get(id) ?? 0, count));
    phases.push({ phaseId: phase.id, name: phase.name, window, mode: "frozen_layout", snapshotId: keyframe.snapshotId,
      canonicalSnapshotId: keyframe.canonicalSnapshotId, proofDigest: keyframe.proofDigest,
      snapshotDigest: canonicalLayoutSnapshotDigest(keyframe.payload), objects });
  }
  if (!hasLayout) issue("NO_VERIFIED_LAYOUT", "No verified frozen catalogue layout establishes this room's demand.");
  const catalogue = new Map(input.catalogue.map((row) => [row.id, row]));
  const demands = [...peak].sort(([left], [right]) => left.localeCompare(right)).flatMap(([assetDefinitionId, quantity]) => {
    const asset = catalogue.get(assetDefinitionId);
    if (asset === undefined) { issue("CATALOGUE_ITEM_MISSING", "A frozen object refers to an unavailable catalogue identity."); return []; }
    return [{ assetDefinitionId, quantity, name: asset.name, category: asset.category }];
  });
  if (demands.some((row) => input.accessoryParentIds.includes(row.assetDefinitionId))) {
    issue("ACCESSORIES_UNMAPPED", "Known implied accessories have no frozen catalogue mapping. This approval covers placed objects only.");
  }
  const windows = [...bookings.map((row) => row.window), ...phases.map((phase) => phase.window)];
  // Invalid phases still contribute their known time to the recorded footprint.
  for (const phase of relevant) if (phase.startsAt !== null && phase.durationMinutes > 0 && phase.spaceId === input.spaceId) {
    const end = Date.parse(phase.startsAt) + phase.durationMinutes * 60_000;
    if (Number.isFinite(new Date(end).getTime())) windows.push({ startsAt: phase.startsAt, endsAt: new Date(end).toISOString() });
  }
  const occupiedWindow = windows.length === 0 ? null : { startsAt: new Date(Math.min(...windows.map((row) => Date.parse(row.startsAt)))).toISOString(),
    endsAt: new Date(Math.max(...windows.map((row) => Date.parse(row.endsAt)))).toISOString() };
  const sourceDigest = inventoryDecisionDigest({ policy: "room_peak_recorded_footprint_v1", venueId: input.venueId,
    eventId: input.eventId, spaceId: input.spaceId, eventStatus: input.eventStatus, eventDeleted: input.eventDeleted,
    eventUpdatedAt: input.eventUpdatedAt, spaceDeleted: input.spaceDeleted, bookings, occupiedWindow, demands, phases,
    phaseMembership: relevant.map(({ snapshots, ...phase }) => ({ ...phase, snapshots: [...snapshots].sort((left, right) => left.id.localeCompare(right.id)).map((row) => ({
      id: row.id, status: row.status, hash: row.snapshotHash, frozenAt: row.frozenAt?.toISOString(), proofDigest: row.proofDigest })) })), issues });
  const latest = input.latestRelease;
  const approvedRelease = latest?.action === "approved" ? latest : null;
  const blocking = issues.some((row) => row.code !== "ACCESSORIES_UNMAPPED");
  const state = bookings.length === 0 ? "inactive" : blocking ? "incomplete" : approvedRelease !== null
    ? approvedRelease.sourceDigest === sourceDigest ? "approved" : "stale" : latest?.action === "revoked" ? "revoked" : "unapproved";
  return InventoryReservationSourceSchema.parse({ eventId: input.eventId, spaceId: input.spaceId,
    eventName: input.eventName, spaceName: input.spaceName, bookingIds: bookings.map((row) => row.id), occupiedWindow,
    sourceDigest, state, issues, demands, phases, approvedRelease, latestReleaseId: latest?.id ?? null,
    releaseRevision: latest?.revision ?? 0, proposalImpact: [] });
}
