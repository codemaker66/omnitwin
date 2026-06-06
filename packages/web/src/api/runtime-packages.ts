import { RuntimePackageSchema, type RuntimePackage } from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Runtime package client — fetches the latest published visual asset package
// for the runtime renderer. Public read (no auth). Returns null when nothing
// is published, which tells the renderer to fall back to the procedural room.
//
// Response is validated through the shared Zod schema at the boundary; a
// drifted shape throws ApiError(RESPONSE_VALIDATION_ERROR) rather than feeding
// a malformed asset into Spark.
// ---------------------------------------------------------------------------

export async function getLatestRuntimePackage(spaceId?: string): Promise<RuntimePackage | null> {
  const query = spaceId !== undefined && spaceId.length > 0
    ? `?spaceId=${encodeURIComponent(spaceId)}`
    : "";
  return api.get(`/assets/runtime-packages/latest${query}`, RuntimePackageSchema.nullable());
}
