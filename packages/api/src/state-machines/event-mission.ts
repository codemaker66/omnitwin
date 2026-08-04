import type {
  EventMissionIncidentStatus,
  EventMissionPhaseStatus,
  EventMissionStatus,
  OpsTaskStatus,
} from "@omnitwin/types";

const MISSION_TRANSITIONS: Readonly<Record<EventMissionStatus, readonly EventMissionStatus[]>> = {
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const PHASE_TRANSITIONS: Readonly<Record<EventMissionPhaseStatus, readonly EventMissionPhaseStatus[]>> = {
  pending: ["active", "skipped"],
  active: ["completed"],
  completed: [],
  skipped: [],
};

const TASK_TRANSITIONS: Readonly<Record<OpsTaskStatus, readonly OpsTaskStatus[]>> = {
  todo: ["in_progress", "done", "blocked", "waived"],
  in_progress: ["done", "blocked"],
  blocked: ["in_progress", "waived"],
  done: [],
  waived: [],
};

const INCIDENT_TRANSITIONS: Readonly<Record<EventMissionIncidentStatus, readonly EventMissionIncidentStatus[]>> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export class EventMissionInvalidTransitionError extends Error {
  readonly fromStatus: string;
  readonly toStatus: string;

  constructor(entity: string, fromStatus: string, toStatus: string) {
    super(`Invalid ${entity} transition from ${fromStatus} to ${toStatus}.`);
    this.name = "EventMissionInvalidTransitionError";
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export function canTransitionEventMission(from: EventMissionStatus, to: EventMissionStatus): boolean {
  return MISSION_TRANSITIONS[from].includes(to);
}

export function canTransitionEventMissionPhase(from: EventMissionPhaseStatus, to: EventMissionPhaseStatus): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export function canTransitionEventMissionTask(from: OpsTaskStatus, to: OpsTaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function canTransitionEventMissionIncident(
  from: EventMissionIncidentStatus,
  to: EventMissionIncidentStatus,
): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export function assertEventMissionTransition(from: EventMissionStatus, to: EventMissionStatus): void {
  if (!canTransitionEventMission(from, to)) throw new EventMissionInvalidTransitionError("mission", from, to);
}

export function assertEventMissionPhaseTransition(from: EventMissionPhaseStatus, to: EventMissionPhaseStatus): void {
  if (!canTransitionEventMissionPhase(from, to)) throw new EventMissionInvalidTransitionError("phase", from, to);
}

export function assertEventMissionTaskTransition(from: OpsTaskStatus, to: OpsTaskStatus): void {
  if (!canTransitionEventMissionTask(from, to)) throw new EventMissionInvalidTransitionError("task", from, to);
}

export function assertEventMissionIncidentTransition(
  from: EventMissionIncidentStatus,
  to: EventMissionIncidentStatus,
): void {
  if (!canTransitionEventMissionIncident(from, to)) {
    throw new EventMissionInvalidTransitionError("incident", from, to);
  }
}
