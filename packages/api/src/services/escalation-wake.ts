// ---------------------------------------------------------------------------
// The one escalation scheduler this process runs, reachable by name so the
// request service can wake it without importing the scheduler (which imports
// the request service for its passes). Goal 19 S7.
// ---------------------------------------------------------------------------

export interface EscalationWake {
  poke(): void;
}

let active: EscalationWake | null = null;

export function installEscalationScheduler(scheduler: EscalationWake | null): void {
  active = scheduler;
}

/** Something new is due: a request raised, a handover made. */
export function pokeEscalationScheduler(): void {
  active?.poke();
}
