import {
  RuntimePackageSchema,
  type LatestRuntimePackageQuery,
  type RuntimePackage,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Runtime package client
//
// Public read. Returns null when no usable package exists for the room, or
// when the API has no resolved asset URL because object storage is not
// configured. The caller decides whether to mount Spark or show fallback.
// ---------------------------------------------------------------------------

export async function getLatestRuntimePackage(query: LatestRuntimePackageQuery): Promise<RuntimePackage | null> {
  const params = new URLSearchParams({
    venue: query.venue,
    room: query.room,
  });
  return api.get(`/assets/runtime-packages/latest?${params.toString()}`, RuntimePackageSchema.nullable());
}
