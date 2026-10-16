import type { EventPhase } from "@omnitwin/types";
import { createEventPhase, updateEventPhase } from "../../../api/events.js";
import type { RibbonPhaseInput, RibbonPhaseWrite } from "./when-ribbon-model.js";

// ---------------------------------------------------------------------------
// The phase handles' writes (goal 19 S6, D1): the office moves a marker and
// the ribbon writes the inner boundaries as event phases. The API has a
// create and an update door for phases and no delete, so a collapsed marker
// patches its phase to zero minutes: the row stays, honest about its length.
// Setup carries no template key (the table's CHECK constraint pins the list)
// and is matched by its name, "Setup", on the way back in.
// Writes go one at a time so a failure leaves a readable half, never a race.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

/** The phases the ribbon may read as its own in this room: timed, and either
 *  room-less or in the booking's room. */
export function phaseInputsFor(phases: readonly EventPhase[], spaceId: string): readonly RibbonPhaseInput[] {
  const inputs: RibbonPhaseInput[] = [];
  for (const phase of phases) {
    if (phase.startsAt === null) continue;
    if (phase.spaceId !== null && phase.spaceId !== spaceId) continue;
    const startMs = Date.parse(phase.startsAt);
    if (!Number.isFinite(startMs)) continue;
    inputs.push({
      id: phase.id,
      templateKey: phase.templateKey,
      name: phase.name,
      startsAt: phase.startsAt,
      endsAt: new Date(startMs + phase.durationMinutes * MINUTE_MS).toISOString(),
    });
  }
  return inputs;
}

function replacePhase(phases: readonly EventPhase[], next: EventPhase): readonly EventPhase[] {
  const index = phases.findIndex((phase) => phase.id === next.id);
  if (index < 0) return [...phases, next];
  return phases.map((phase, at) => (at === index ? next : phase));
}

/** Apply the writes in order and return the phases as the server now holds
 *  them. Throws on the first failure, after the earlier writes have landed. */
export async function applyRibbonPhaseWrites(
  eventId: string,
  spaceId: string,
  writes: readonly RibbonPhaseWrite[],
  phases: readonly EventPhase[],
): Promise<readonly EventPhase[]> {
  let current = phases;
  for (const write of writes) {
    if (write.op === "create") {
      const created = await createEventPhase(eventId, {
        // event_phases pins template_key to the seeded keys by a CHECK
        // constraint; setup is written key-less and found again by its name.
        templateKey: write.templateKey === "setup" ? null : write.templateKey,
        spaceId,
        name: write.name,
        startsAt: write.startsAt,
        durationMinutes: write.durationMinutes,
        opsTasksCount: 0,
        reviewGatesCount: 0,
      });
      current = replacePhase(current, created);
      continue;
    }
    if (write.phaseId === null) continue;
    const updated = await updateEventPhase(write.phaseId, {
      name: write.name,
      startsAt: write.startsAt,
      durationMinutes: write.op === "delete" ? 0 : write.durationMinutes,
    });
    current = replacePhase(current, updated);
  }
  return current;
}
