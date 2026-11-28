import { z } from "zod";
import {
  BuildingCheckSchema,
  BuildingChecksDaySchema,
  type BuildingCheck,
  type BuildingCheckKind,
  type BuildingChecksDay,
  type ReplaceBuildingChecks,
} from "@omnitwin/types";
import { api } from "./client.js";

// ---------------------------------------------------------------------------
// Opening and lock-up (T-693): the venue's own lists, kept by its
// administrators from the list they saw, and each day's ticks by the floor.
// ---------------------------------------------------------------------------

function checksPath(venueId: string): string {
  return `/venues/${encodeURIComponent(venueId)}/building-checks`;
}

export function getBuildingChecks(venueId: string, day: string, signal?: AbortSignal): Promise<BuildingChecksDay> {
  return api.get(`${checksPath(venueId)}?day=${encodeURIComponent(day)}`, BuildingChecksDaySchema, signal);
}

export function replaceBuildingChecks(venueId: string, kind: BuildingCheckKind, body: ReplaceBuildingChecks): Promise<BuildingCheck[]> {
  return api.put(`${checksPath(venueId)}/${kind}`, body, z.array(BuildingCheckSchema));
}

export function markBuildingCheck(venueId: string, checkId: string, day: string): Promise<BuildingCheck> {
  return api.post(`${checksPath(venueId)}/${encodeURIComponent(checkId)}/marks`, { day }, undefined, BuildingCheckSchema);
}

export function unmarkBuildingCheck(venueId: string, checkId: string, day: string): Promise<BuildingCheck> {
  return api.delete(`${checksPath(venueId)}/${encodeURIComponent(checkId)}/marks?day=${encodeURIComponent(day)}`, BuildingCheckSchema);
}
