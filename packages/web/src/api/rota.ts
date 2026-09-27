import {
  RotaPublishResultSchema,
  RotaShiftSchema,
  RotaWeekSchema,
  StaffRecordSchema,
  StaffUnavailabilitySchema,
  type CreateRotaShift,
  type CreateStaffMember,
  type CreateStaffUnavailability,
  type RotaPublishResult,
  type RotaShift,
  type RotaWarningCode,
  type RotaWeek,
  type StaffRecord,
  type StaffUnavailability,
  type UpdateRotaShift,
  type UpdateStaffMember,
} from "@omnitwin/types";
import { ApiError, api } from "./client.js";

// ---------------------------------------------------------------------------
// The staff rota (T-637 slice B). The venue's administrators plan and publish
// it; the venue floor reads the published week; anyone else on it sees their
// own shifts. Every change carries the revision it was made from, so a
// colleague's newer change is shown rather than overwritten.
// ---------------------------------------------------------------------------

function rotaPath(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/rota`;
}

/** The week holding `weekStart`, or this week on the venue's calendar. */
export function getRotaWeek(venueId: string, weekStart: string | null, signal?: AbortSignal): Promise<RotaWeek> {
  const query = weekStart === null ? "" : `?start=${encodeURIComponent(weekStart)}`;
  return api.get(`${rotaPath(venueId)}/week${query}`, RotaWeekSchema, signal);
}

export function createRotaShift(venueId: string, body: CreateRotaShift): Promise<RotaShift> {
  return api.post(`${rotaPath(venueId)}/shifts`, body, undefined, RotaShiftSchema);
}

export function updateRotaShift(venueId: string, shiftId: string, body: UpdateRotaShift): Promise<RotaShift> {
  return api.patch(`${rotaPath(venueId)}/shifts/${encodeURIComponent(shiftId)}`, body, RotaShiftSchema);
}

/** A draft nobody has been told about. */
export function removeRotaShift(venueId: string, shift: Pick<RotaShift, "id" | "revision">): Promise<void> {
  return api.delete(`${rotaPath(venueId)}/shifts/${encodeURIComponent(shift.id)}?expectedRevision=${String(shift.revision)}`);
}

/** A published shift: the person is told, and the notice recorded. */
export function cancelRotaShift(venueId: string, shift: Pick<RotaShift, "id" | "revision">): Promise<RotaShift> {
  return api.post(`${rotaPath(venueId)}/shifts/${encodeURIComponent(shift.id)}/cancel`,
    { expectedRevision: shift.revision }, undefined, RotaShiftSchema);
}

export function keepRotaWarning(
  venueId: string,
  shift: Pick<RotaShift, "id" | "revision">,
  code: RotaWarningCode,
  reason: string,
): Promise<RotaShift> {
  return api.post(`${rotaPath(venueId)}/shifts/${encodeURIComponent(shift.id)}/keep`,
    { code, reason, expectedRevision: shift.revision }, undefined, RotaShiftSchema);
}

export function publishRotaWeek(
  venueId: string,
  weekStart: string,
  shifts: readonly Pick<RotaShift, "id" | "revision">[],
): Promise<RotaPublishResult> {
  return api.post(`${rotaPath(venueId)}/publish`,
    { weekStart, shifts: shifts.map(({ id, revision }) => ({ id, revision })) }, undefined, RotaPublishResultSchema);
}

export function createStaffMember(venueId: string, body: CreateStaffMember): Promise<StaffRecord> {
  return api.post(`${rotaPath(venueId)}/people`, body, undefined, StaffRecordSchema);
}

export function updateStaffMember(venueId: string, id: string, body: UpdateStaffMember): Promise<StaffRecord> {
  return api.patch(`${rotaPath(venueId)}/people/${encodeURIComponent(id)}`, body, StaffRecordSchema);
}

export function addUnavailability(venueId: string, body: CreateStaffUnavailability): Promise<StaffUnavailability> {
  return api.post(`${rotaPath(venueId)}/unavailability`, body, undefined, StaffUnavailabilitySchema);
}

export function removeUnavailability(venueId: string, id: string): Promise<void> {
  return api.delete(`${rotaPath(venueId)}/unavailability/${encodeURIComponent(id)}`);
}

/** The shift as it stands, from a refusal that carries it (a stale edit). */
export function shiftFromRefusal(error: unknown): RotaShift | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = RotaShiftSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/** The record as it stands, from a refusal that carries it. */
export function recordFromRefusal(error: unknown): StaffRecord | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const parsed = StaffRecordSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/**
 * What to tell the person when a change is refused. The rota's refusals are
 * written in plain words by the server (a legal block, a stale edit, a room of
 * another venue); anything else gets the fallback.
 */
export function rotaRefusalWords(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return "Venviewer could not be reached. Check the connection and try again.";
    if ((error.status === 409 || error.status === 422 || error.status === 404) && error.message.trim() !== "") return error.message;
  }
  return fallback;
}
