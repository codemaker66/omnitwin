/**
 * The original eleven-member Grand Hall frontier is source/diagnostic input,
 * not a room-only runtime. No production trust root exists for it. Keep this
 * blocker free of environment, filesystem, credential, and network reads so
 * retired operator entry points can fail before acquiring any capability.
 */
export const GRAND_HALL_V1_INTAKE_RETIRED_CODE =
  "GRAND_HALL_V1_INTAKE_RETIRED";

export const GRAND_HALL_V1_INTAKE_RETIRED_MESSAGE =
  "GRAND_HALL_V1_INTAKE_RETIRED: the legacy frontier is source/diagnostic only; credential minting, staging, rehearsal, upload, and intake are superseded until a distinct human-accepted room-only v2 cropped output exists.";

export class GrandHallV1IntakeRetiredError extends Error {
  readonly code = GRAND_HALL_V1_INTAKE_RETIRED_CODE;

  constructor() {
    super(GRAND_HALL_V1_INTAKE_RETIRED_MESSAGE);
    this.name = "GrandHallV1IntakeRetiredError";
  }
}

export function rejectRetiredGrandHallV1Intake(): void {
  throw new GrandHallV1IntakeRetiredError();
}
