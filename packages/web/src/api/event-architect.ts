import {
  CreateEventArchitectRunInputSchema,
  CreateEventArchitectOpsReviewInputSchema,
  EventArchitectCandidateSelectionSchema,
  EventArchitectOpsReviewGateSchema,
  PersistedEventArchitectRunSchema,
  SelectEventArchitectCandidateInputSchema,
  type CreateEventArchitectRunInput,
  type CreateEventArchitectOpsReviewInput,
  type EventArchitectCandidateSelection,
  type EventArchitectOpsReviewGate,
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

export async function getEventArchitectOpsReview(
  candidateId: string,
  signal?: AbortSignal,
): Promise<EventArchitectOpsReviewGate> {
  return api.get(
    `/event-architect/candidates/${candidateId}/ops-review`,
    EventArchitectOpsReviewGateSchema,
    signal,
  );
}

export async function createEventArchitectOpsReview(
  candidateId: string,
  input: CreateEventArchitectOpsReviewInput,
): Promise<EventArchitectOpsReviewGate> {
  return api.post(
    `/event-architect/candidates/${candidateId}/ops-review`,
    CreateEventArchitectOpsReviewInputSchema.parse(input),
    false,
    EventArchitectOpsReviewGateSchema,
  );
}
