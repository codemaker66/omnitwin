import {
  RuntimePackageSchema,
  type LatestRuntimePackageQuery,
  type RuntimePackage,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Runtime package client
//
// Authenticated read. Platform administrators retain the generic published
// registry view; assigned Trades Hall venue managers may resolve only the
// protected Grand Hall package. The caller decides whether to mount Spark or
// show the safe fallback.
// ---------------------------------------------------------------------------

export async function getLatestRuntimePackage(query: LatestRuntimePackageQuery): Promise<RuntimePackage | null> {
  const params = new URLSearchParams({
    venue: query.venue,
    room: query.room,
  });
  return api.get(`/assets/runtime-packages/latest?${params.toString()}`, RuntimePackageSchema.nullable());
}
