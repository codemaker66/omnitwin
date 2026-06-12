import { RoomAssetStatusSchema, type RoomAssetStatus } from "@omnitwin/types";
import { api } from "./client.js";

export async function getAdminAssetRooms(venue = "trades-hall"): Promise<readonly RoomAssetStatus[]> {
  const params = new URLSearchParams({ venue });
  return api.get(`/admin/assets/rooms?${params.toString()}`, RoomAssetStatusSchema.array());
}
