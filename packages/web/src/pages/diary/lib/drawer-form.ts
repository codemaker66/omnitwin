import {
  ConvertEnquirySchema,
  CreateBookingSchema,
  UpdateBookingSchema,
  VALID_BOOKING_TRANSITIONS,
  type BookingKind,
  type BookingState,
  type CalendarBookingEntry,
  type ConvertEnquiryInput,
  type CreateBookingInput,
  type UpdateBookingInput,
} from "@omnitwin/types";
import { msToWallInput, wallInputToMs } from "./board-time.js";

// ---------------------------------------------------------------------------
// Drawer form mapping (T-495/T-496).
//
// One flat string-field form drives create, edit, and convert. Validation is
// THE SHARED ZOD SCHEMAS — the exact objects the server parses — so the
// drawer can never drift from the API's rules; this module only converts
// venue wall-time inputs to instants and Zod issues to field errors.
// ---------------------------------------------------------------------------

export interface DrawerForm {
  readonly kind: BookingKind;
  readonly spaceId: string;
  readonly title: string;
  readonly eventType: string;
  readonly startsAt: string; // datetime-local, venue wall time
  readonly endsAt: string;
  readonly rank: string;
  readonly jointFlag: boolean;
  readonly decisionAt: string;
  readonly ownerUserId: string;
  readonly nextAction: string;
  readonly nextActionDueAt: string;
  readonly notes: string;
}

export interface ConvertSource {
  readonly id: string;
  readonly spaceId: string;
  readonly name: string;
  readonly eventType: string | null;
  readonly preferredDate: string | null; // "YYYY-MM-DD"
}

export type DrawerMode =
  | {
      readonly kind: "create";
      readonly spaceId: string;
      readonly dayStartMs: number;
      readonly ownerUserId: string;
    }
  | { readonly kind: "edit"; readonly booking: CalendarBookingEntry }
  | { readonly kind: "convert"; readonly enquiry: ConvertSource; readonly ownerUserId: string };

export type FieldErrors = Readonly<Record<string, string>>;

export type FormResult<Payload> =
  | { readonly ok: true; readonly payload: Payload; readonly changed: boolean }
  | { readonly ok: false; readonly fieldErrors: FieldErrors };

const HOUR_MS = 3_600_000;
const DEFAULT_START_HOUR_OFFSET = 17;
const DEFAULT_END_HOUR_OFFSET = 23;

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function initialDrawerForm(mode: DrawerMode): DrawerForm {
  if (mode.kind === "edit") {
    const { booking } = mode;
    return {
      kind: booking.kind,
      spaceId: booking.spaceId,
      title: booking.title,
      eventType: booking.eventType ?? "",
      startsAt: msToWallInput(Date.parse(booking.startsAt)),
      endsAt: msToWallInput(Date.parse(booking.endsAt)),
      rank: booking.rank === null ? "" : String(booking.rank),
      jointFlag: booking.jointFlag,
      decisionAt:
        booking.decisionAt === null ? "" : msToWallInput(Date.parse(booking.decisionAt)),
      ownerUserId: booking.ownerUserId ?? "",
      nextAction: booking.nextAction ?? "",
      nextActionDueAt:
        booking.nextActionDueAt === null
          ? ""
          : msToWallInput(Date.parse(booking.nextActionDueAt)),
      notes: "",
    };
  }

  if (mode.kind === "convert") {
    const { enquiry } = mode;
    const dayStart =
      enquiry.preferredDate === null
        ? null
        : wallInputToMs(`${enquiry.preferredDate}T00:00`);
    const startMs = (dayStart ?? Date.now()) + DEFAULT_START_HOUR_OFFSET * HOUR_MS;
    const endMs = (dayStart ?? Date.now()) + DEFAULT_END_HOUR_OFFSET * HOUR_MS;
    return {
      kind: "hold",
      spaceId: enquiry.spaceId,
      title: `${enquiry.name}${enquiry.eventType === null ? "" : ` — ${enquiry.eventType}`}`.slice(0, 200),
      eventType: enquiry.eventType ?? "",
      startsAt: msToWallInput(startMs),
      endsAt: msToWallInput(endMs),
      rank: "1",
      jointFlag: false,
      decisionAt: "",
      ownerUserId: mode.ownerUserId,
      nextAction: "",
      nextActionDueAt: "",
      notes: "",
    };
  }

  return {
    kind: "hold",
    spaceId: mode.spaceId,
    title: "",
    eventType: "",
    startsAt: msToWallInput(mode.dayStartMs + DEFAULT_START_HOUR_OFFSET * HOUR_MS),
    endsAt: msToWallInput(mode.dayStartMs + DEFAULT_END_HOUR_OFFSET * HOUR_MS),
    rank: "1",
    jointFlag: false,
    decisionAt: "",
    ownerUserId: mode.ownerUserId,
    nextAction: "",
    nextActionDueAt: "",
    notes: "",
  };
}

interface TimeFields {
  readonly values: Readonly<Record<string, string | undefined>>;
  readonly errors: FieldErrors;
}

/** Convert the wall-time text fields to ISO instants, collecting per-field
 *  errors for anything present but unparseable. */
function mapTimes(form: DrawerForm, fields: readonly (keyof DrawerForm)[]): TimeFields {
  const values: Record<string, string | undefined> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = (form[field] as string).trim();
    if (raw.length === 0) {
      values[field] = undefined;
      continue;
    }
    const ms = wallInputToMs(raw);
    if (ms === null) {
      errors[field] = "Enter a valid date and time.";
      continue;
    }
    values[field] = new Date(ms).toISOString();
  }
  return { values, errors };
}

function issuesToFieldErrors(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): FieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

export function formToCreatePayload(
  form: DrawerForm,
  venueId: string,
): FormResult<CreateBookingInput> {
  const times = mapTimes(form, ["startsAt", "endsAt", "decisionAt", "nextActionDueAt"]);
  if (Object.keys(times.errors).length > 0) return { ok: false, fieldErrors: times.errors };

  const rank = emptyToUndefined(form.rank);
  const candidate = {
    venueId,
    spaceId: form.spaceId,
    kind: form.kind,
    title: form.title,
    eventType: emptyToUndefined(form.eventType),
    startsAt: times.values["startsAt"],
    endsAt: times.values["endsAt"],
    rank: rank === undefined ? undefined : Number(rank),
    jointFlag: form.jointFlag || undefined,
    decisionAt: times.values["decisionAt"],
    ownerUserId: emptyToUndefined(form.ownerUserId),
    nextAction: emptyToUndefined(form.nextAction),
    nextActionDueAt: times.values["nextActionDueAt"],
    notes: emptyToUndefined(form.notes),
  };
  const parsed = CreateBookingSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  return { ok: true, payload: parsed.data, changed: true };
}

export function formToUpdatePayload(
  form: DrawerForm,
  original: CalendarBookingEntry,
): FormResult<UpdateBookingInput> {
  const times = mapTimes(form, ["startsAt", "endsAt", "decisionAt", "nextActionDueAt"]);
  if (Object.keys(times.errors).length > 0) return { ok: false, fieldErrors: times.errors };

  const patch: Record<string, unknown> = {};
  if (form.title !== original.title) patch["title"] = form.title;
  const eventType = emptyToUndefined(form.eventType);
  if ((eventType ?? null) !== original.eventType) patch["eventType"] = eventType ?? null;
  if (times.values["startsAt"] !== undefined && times.values["startsAt"] !== original.startsAt) {
    patch["startsAt"] = times.values["startsAt"];
  }
  if (times.values["endsAt"] !== undefined && times.values["endsAt"] !== original.endsAt) {
    patch["endsAt"] = times.values["endsAt"];
  }
  const rank = emptyToUndefined(form.rank);
  if (rank !== undefined && Number(rank) !== original.rank) {
    patch["rank"] = Number(rank);
  }
  if (form.jointFlag !== original.jointFlag) patch["jointFlag"] = form.jointFlag;
  if (
    times.values["decisionAt"] !== undefined &&
    times.values["decisionAt"] !== original.decisionAt
  ) {
    patch["decisionAt"] = times.values["decisionAt"];
  }
  const owner = emptyToUndefined(form.ownerUserId);
  if (owner !== undefined && owner !== original.ownerUserId) patch["ownerUserId"] = owner;
  const nextAction = emptyToUndefined(form.nextAction);
  if (nextAction !== undefined && nextAction !== original.nextAction) {
    patch["nextAction"] = nextAction;
  }
  if (
    times.values["nextActionDueAt"] !== undefined &&
    times.values["nextActionDueAt"] !== original.nextActionDueAt
  ) {
    patch["nextActionDueAt"] = times.values["nextActionDueAt"];
  }

  const parsed = UpdateBookingSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  return { ok: true, payload: parsed.data, changed: Object.keys(patch).length > 0 };
}

export function formToConvertPayload(
  form: DrawerForm,
  enquiryId: string,
): FormResult<ConvertEnquiryInput> {
  const times = mapTimes(form, ["startsAt", "endsAt", "decisionAt", "nextActionDueAt"]);
  if (Object.keys(times.errors).length > 0) return { ok: false, fieldErrors: times.errors };

  const rank = emptyToUndefined(form.rank);
  const candidate = {
    enquiryId,
    spaceId: form.spaceId,
    title: emptyToUndefined(form.title),
    eventType: emptyToUndefined(form.eventType),
    startsAt: times.values["startsAt"],
    endsAt: times.values["endsAt"],
    rank: rank === undefined ? undefined : Number(rank),
    jointFlag: form.jointFlag || undefined,
    decisionAt: times.values["decisionAt"],
    ownerUserId: emptyToUndefined(form.ownerUserId),
    nextAction: emptyToUndefined(form.nextAction),
    nextActionDueAt: times.values["nextActionDueAt"],
    notes: emptyToUndefined(form.notes),
  };
  const parsed = ConvertEnquirySchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, fieldErrors: issuesToFieldErrors(parsed.error.issues) };
  return { ok: true, payload: parsed.data, changed: true };
}

/** Lifecycle moves the drawer may offer: the structural matrix gated by the
 *  same write roles the API enforces. */
export function allowedTransitionTargets(
  state: BookingState,
  role: string,
): readonly BookingState[] {
  if (role !== "staff" && role !== "admin") return [];
  return VALID_BOOKING_TRANSITIONS[state];
}
