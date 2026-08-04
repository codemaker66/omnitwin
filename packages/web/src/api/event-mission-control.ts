import {
  AcknowledgeEventMissionEventInputSchema,
  CreateEventMissionIncidentInputSchema,
  EventMissionAcknowledgementSchema,
  EventMissionBoardSchema,
  EventMissionIncidentSchema,
  EventMissionEventSchema,
  EventMissionSchema,
  EventMissionPresenceHeartbeatInputSchema,
  EventMissionPresenceSchema,
  EventMissionReplaySchema,
  EventMissionTaskSchema,
  EventMissionPhaseSchema,
  EventMissionTimelineSchema,
  StartEventMissionInputSchema,
  TransitionEventMissionPhaseInputSchema,
  TransitionEventMissionTaskInputSchema,
  TransitionEventMissionInputSchema,
  UpdateEventMissionIncidentInputSchema,
  type AcknowledgeEventMissionEventInput,
  type CreateEventMissionIncidentInput,
  type EventMissionAcknowledgement,
  type EventMissionBoard,
  type EventMissionIncident,
  type EventMission,
  type EventMissionPhase,
  type EventMissionPresence,
  type EventMissionPresenceHeartbeatInput,
  type EventMissionReplay,
  type EventMissionTask,
  type EventMissionTimeline,
  type StartEventMissionInput,
  type TransitionEventMissionPhaseInput,
  type TransitionEventMissionTaskInput,
  type TransitionEventMissionInput,
  type UpdateEventMissionIncidentInput,
} from "@omnitwin/types";
import { api } from "./client.js";

export async function startEventMission(
  eventId: string,
  input: StartEventMissionInput,
): Promise<EventMissionBoard> {
  return api.post(
    `/events/${eventId}/mission`,
    StartEventMissionInputSchema.parse(input),
    false,
    EventMissionBoardSchema,
  );
}

export async function getEventMission(eventId: string, signal?: AbortSignal): Promise<EventMissionBoard> {
  return api.get(`/events/${eventId}/mission`, EventMissionBoardSchema, signal);
}

export async function getEventMissionTimeline(
  missionId: string,
  afterSequence = 0,
  limit = 100,
  signal?: AbortSignal,
): Promise<EventMissionTimeline> {
  const params = new URLSearchParams({
    afterSequence: String(afterSequence),
    limit: String(limit),
  });
  return api.get(`/event-missions/${missionId}/timeline?${params.toString()}`, EventMissionTimelineSchema, signal);
}

export async function getEventMissionReplay(
  missionId: string,
  throughSequence?: number,
  signal?: AbortSignal,
): Promise<EventMissionReplay> {
  const params = new URLSearchParams();
  if (throughSequence !== undefined) params.set("throughSequence", String(throughSequence));
  const query = params.size === 0 ? "" : `?${params.toString()}`;
  return api.get(`/event-missions/${missionId}/replay${query}`, EventMissionReplaySchema, signal);
}

export async function heartbeatEventMissionPresence(
  missionId: string,
  input: EventMissionPresenceHeartbeatInput,
): Promise<EventMissionPresence> {
  return api.post(
    `/event-missions/${missionId}/presence`,
    EventMissionPresenceHeartbeatInputSchema.parse(input),
    false,
    EventMissionPresenceSchema,
  );
}

export async function transitionEventMissionStatus(
  missionId: string,
  input: TransitionEventMissionInput,
): Promise<EventMission> {
  const event = await api.patch(
    `/event-missions/${missionId}`,
    TransitionEventMissionInputSchema.parse(input),
    EventMissionEventSchema,
  );
  if (event.payload.kind !== "mission_status_changed") {
    throw new Error("Mission status command returned a different event kind.");
  }
  return EventMissionSchema.parse(event.payload.mission);
}

export async function transitionEventMissionPhase(
  missionId: string,
  missionPhaseId: string,
  input: TransitionEventMissionPhaseInput,
): Promise<EventMissionPhase> {
  const event = await api.patch(
    `/event-missions/${missionId}/phases/${missionPhaseId}`,
    TransitionEventMissionPhaseInputSchema.parse(input),
    EventMissionEventSchema,
  );
  if (event.payload.kind !== "phase_status_changed") {
    throw new Error("Mission phase command returned a different event kind.");
  }
  return EventMissionPhaseSchema.parse(event.payload.phase);
}

export async function transitionEventMissionTask(
  missionId: string,
  missionTaskId: string,
  input: TransitionEventMissionTaskInput,
): Promise<EventMissionTask> {
  const event = await api.patch(
    `/event-missions/${missionId}/tasks/${missionTaskId}`,
    TransitionEventMissionTaskInputSchema.parse(input),
    EventMissionEventSchema,
  );
  if (event.payload.kind !== "task_status_changed") {
    throw new Error("Mission task command returned a different event kind.");
  }
  return EventMissionTaskSchema.parse(event.payload.task);
}

export async function createEventMissionIncident(
  missionId: string,
  input: CreateEventMissionIncidentInput,
): Promise<EventMissionIncident> {
  const event = await api.post(
    `/event-missions/${missionId}/incidents`,
    CreateEventMissionIncidentInputSchema.parse(input),
    false,
    EventMissionEventSchema,
  );
  if (event.payload.kind !== "incident_created") {
    throw new Error("Mission incident command returned a different event kind.");
  }
  return EventMissionIncidentSchema.parse(event.payload.incident);
}

export async function updateEventMissionIncident(
  missionId: string,
  incidentId: string,
  input: UpdateEventMissionIncidentInput,
): Promise<EventMissionIncident> {
  const event = await api.patch(
    `/event-missions/${missionId}/incidents/${incidentId}`,
    UpdateEventMissionIncidentInputSchema.parse(input),
    EventMissionEventSchema,
  );
  if (event.payload.kind !== "incident_updated") {
    throw new Error("Mission incident update returned a different event kind.");
  }
  return EventMissionIncidentSchema.parse(event.payload.incident);
}

export async function acknowledgeEventMissionEvent(
  missionId: string,
  input: AcknowledgeEventMissionEventInput,
): Promise<EventMissionAcknowledgement> {
  const event = await api.post(
    `/event-missions/${missionId}/acknowledgements`,
    AcknowledgeEventMissionEventInputSchema.parse(input),
    false,
    EventMissionEventSchema,
  );
  if (event.payload.kind !== "event_acknowledged") {
    throw new Error("Mission acknowledgement returned a different event kind.");
  }
  return EventMissionAcknowledgementSchema.parse(event.payload.acknowledgement);
}
