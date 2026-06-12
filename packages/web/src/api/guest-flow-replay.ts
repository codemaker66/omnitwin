import { z } from "zod";
import { GuestFlowReplayPersistenceResultSchema, type GuestFlowReplayPersistenceResult } from "@omnitwin/types";
import { api } from "./client.js";

export interface LatestGuestFlowReplayQuery {
  readonly eventId?: string | null;
  readonly phaseId?: string | null;
  readonly configurationId?: string | null;
}

function latestReplayPath(query: LatestGuestFlowReplayQuery = {}): string {
  const params = new URLSearchParams();
  if (query.eventId !== undefined && query.eventId !== null) params.set("eventId", query.eventId);
  if (query.phaseId !== undefined && query.phaseId !== null) params.set("phaseId", query.phaseId);
  if (query.configurationId !== undefined && query.configurationId !== null) params.set("configurationId", query.configurationId);
  const queryString = params.toString();
  return queryString.length === 0
    ? "/guest-flow/replays/latest"
    : `/guest-flow/replays/latest?${queryString}`;
}

export async function getLatestGuestFlowReplay(query: LatestGuestFlowReplayQuery = {}): Promise<GuestFlowReplayPersistenceResult> {
  const payload = await api.get(latestReplayPath(query), z.unknown());
  return GuestFlowReplayPersistenceResultSchema.parse(payload);
}
