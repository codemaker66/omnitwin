import {
  VenueInventoryListResponseSchema, VenueInventoryWriteResponseSchema,
  VenueInventoryHistoryResponseSchema,
  type VenueInventoryListResponse, type VenueInventoryWriteInput,
  type VenueInventoryWriteResponse, type VenueInventoryReceipt,
} from "@omnitwin/types";
import { api, ApiError } from "./client.js";

export type VenueInventoryItem = VenueInventoryListResponse["data"]["items"][number];
export type VenueInventoryData = VenueInventoryListResponse["data"];
export type VenueInventoryResult = VenueInventoryWriteResponse["data"];

export function listVenueInventory(venueId: string, signal?: AbortSignal): Promise<VenueInventoryData> {
  return api.get(`/venues/${venueId}/inventory`, VenueInventoryListResponseSchema.shape.data, signal);
}

export const INVENTORY_WRITE_TIMEOUT_MS = 30_000;

export async function writeVenueInventory(venueId: string, assetDefinitionId: string,
  input: VenueInventoryWriteInput): Promise<VenueInventoryResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError(0, "Confirmation took too long. The server may have recorded your change.", "INVENTORY_WRITE_TIMEOUT"));
    }, INVENTORY_WRITE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, api.post(`/venues/${venueId}/inventory/${assetDefinitionId}/adjustments`, input, undefined,
      VenueInventoryWriteResponseSchema.shape.data, { signal: controller.signal })]);
  } finally { clearTimeout(timer); }
}

/** The shared client unwraps data, so this view intentionally requests the latest
 * 20 receipts only; pagination totals are not silently inferred from that page. */
export function recentVenueInventoryHistory(venueId: string, assetDefinitionId: string,
  signal?: AbortSignal): Promise<VenueInventoryReceipt[]> {
  return api.get(`/venues/${venueId}/inventory/${assetDefinitionId}/history?limit=20&offset=0`,
    VenueInventoryHistoryResponseSchema.shape.data, signal);
}
