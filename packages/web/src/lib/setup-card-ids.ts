import type { SetupCardId } from "./setup-cards.js";

// ---------------------------------------------------------------------------
// The setup cards by id. Only the new chrome reads these (its counts and the
// setup-card tests), so they live apart from setup-cards.ts, which today's
// planner loads: there they would be kept in its download (T-671).
// ---------------------------------------------------------------------------

export const SETUP_CARD_IDS: readonly SetupCardId[] = ["round", "top-table", "long-table", "dance-floor"];

export function isSetupCardId(id: string): id is SetupCardId {
  return (SETUP_CARD_IDS as readonly string[]).includes(id);
}
