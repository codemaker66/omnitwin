import {
  CreateEventArchitectRunInputSchema,
  EventArchitectCandidateSelectionSchema,
  PersistedEventArchitectRunSchema,
  SelectEventArchitectCandidateInputSchema,
  type CreateEventArchitectRunInput,
  type EventArchitectCandidateSelection,
  type PersistedEventArchitectRun,
  type SelectEventArchitectCandidateInput,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function createEventArchitectRun(
  input: CreateEventArchitectRunInput,
): Promise<PersistedEventArchitectRun> {
  return api.post(
    "/event-architect/runs",
    CreateEventArchitectRunInputSchema.parse(input),
    false,
    PersistedEventArchitectRunSchema,
  );
}
export async function getEventArchitectRun(
  runId: string,
  signal?: AbortSignal,
): Promise<PersistedEventArchitectRun> {
  return api.get(
    `/event-architect/runs/${runId}`,
    PersistedEventArchitectRunSchema,
    signal,
  );
}

export async function selectEventArchitectCandidate(
  candidateId: string,
  input: SelectEventArchitectCandidateInput,
): Promise<EventArchitectCandidateSelection> {
  return api.post(
    `/event-architect/candidates/${candidateId}/select`,
    SelectEventArchitectCandidateInputSchema.parse(input),
    false,
    EventArchitectCandidateSelectionSchema,
  );
}
