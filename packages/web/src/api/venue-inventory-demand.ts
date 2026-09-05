import type { ZodType, ZodTypeDef } from "zod";
import {
  InventoryAssessmentResponseSchema, InventoryReservationMutationResponseSchema, InventoryRemedyPrepareResponseSchema,
  InventoryRemedyApproveResponseSchema, InventoryRemedyResponseSchema, InventoryReservationHistoryResponseSchema,
  type InventoryAssessment, type InventoryWindow, type InventoryReservationApprovalInput, type InventoryReservationRevokeInput,
  type InventoryReservationMutationResponse, type InventoryRemedyPrepareInput, type InventoryRemedyApproveInput,
  type InventoryRemedyPrepareResponse, type InventoryRemedy, type InventoryReservationRelease,
} from "@omnitwin/types";
import { api, ApiError } from "./client.js";

export type ReservationResult = InventoryReservationMutationResponse["data"];
export type RemedyResult = InventoryRemedyPrepareResponse["data"];
export const INVENTORY_ACTION_TIMEOUT_MS = 30_000;

function assertScope(matches: boolean): void {
  if (!matches) throw new ApiError(0, "The response did not match this inventory review. Check its recorded result before continuing.", "INVENTORY_RESPONSE_SCOPE_MISMATCH");
}
function sameWindow(a: InventoryWindow, b: InventoryWindow): boolean {
  return Date.parse(a.startsAt) === Date.parse(b.startsAt) && Date.parse(a.endsAt) === Date.parse(b.endsAt);
}
async function action<T>(path: string, input: unknown, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(0, "Confirmation took too long. The server may have recorded this action.", "INVENTORY_ACTION_TIMEOUT"));
    }, INVENTORY_ACTION_TIMEOUT_MS);
  });
  try { return await Promise.race([timeout, api.post(path, input, undefined, schema, { signal: controller.signal })]); }
  finally { clearTimeout(timer); }
}

export async function assessVenueInventory(venueId: string, window: InventoryWindow, signal?: AbortSignal): Promise<InventoryAssessment> {
  const query = new URLSearchParams({ from: window.startsAt, to: window.endsAt });
  const result = await api.get(`/venues/${venueId}/inventory/assessment?${query.toString()}`, InventoryAssessmentResponseSchema.shape.data, signal);
  assertScope(result.venueId === venueId && sameWindow(result.window, window));
  return result;
}

async function reservation(venueId: string, input: InventoryReservationRevokeInput, operation: "approve" | "revoke"): Promise<ReservationResult> {
  const result = await action(`/venues/${venueId}/inventory/reservations/${operation}`, input, InventoryReservationMutationResponseSchema.shape.data);
  assertScope(result.release.venueId === venueId && result.release.eventId === input.eventId && result.release.spaceId === input.spaceId
    && result.release.action === (operation === "approve" ? "approved" : "revoked")
    && (operation !== "approve" || result.release.sourceDigest === input.expectedSourceDigest)
    && result.assessment.venueId === venueId && sameWindow(result.assessment.window, input.window));
  return result;
}
export function approveInventoryReservation(venueId: string, input: InventoryReservationApprovalInput): Promise<ReservationResult> {
  return reservation(venueId, input, "approve");
}
export function revokeInventoryReservation(venueId: string, input: InventoryReservationRevokeInput): Promise<ReservationResult> {
  return reservation(venueId, input, "revoke");
}
export async function prepareInventoryRemedy(venueId: string, input: InventoryRemedyPrepareInput): Promise<RemedyResult> {
  const result = await action(`/venues/${venueId}/inventory/remedies/prepare`, input, InventoryRemedyPrepareResponseSchema.shape.data);
  assertScope(result.remedy.venueId === venueId && result.remedy.assetDefinitionId === input.assetDefinitionId
    && result.remedy.kind === input.kind && result.remedy.quantity === input.quantity && sameWindow(result.remedy.window, input.window));
  return result;
}
export async function approveInventoryRemedy(venueId: string, remedyId: string, input: InventoryRemedyApproveInput): Promise<RemedyResult> {
  const result = await action(`/venues/${venueId}/inventory/remedies/${remedyId}/approve`, input, InventoryRemedyApproveResponseSchema.shape.data);
  assertScope(result.remedy.venueId === venueId && result.remedy.id === remedyId && result.remedy.status === "approved");
  return result;
}
export async function getInventoryRemedy(venueId: string, remedyId: string, signal?: AbortSignal): Promise<InventoryRemedy> {
  const result = await api.get(`/venues/${venueId}/inventory/remedies/${remedyId}`, InventoryRemedyResponseSchema.shape.data, signal);
  assertScope(result.venueId === venueId && result.id === remedyId);
  return result;
}
export async function getInventoryReservationHistory(venueId: string, eventId: string, spaceId: string,
  signal?: AbortSignal): Promise<InventoryReservationRelease[]> {
  const result = await api.get(`/venues/${venueId}/inventory/reservations/${eventId}/${spaceId}/history`, InventoryReservationHistoryResponseSchema.shape.data, signal);
  assertScope(result.every((release) => release.venueId === venueId && release.eventId === eventId && release.spaceId === spaceId));
  return result;
}
