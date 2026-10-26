import { z } from "zod";

// ---------------------------------------------------------------------------
// The hour each layout opens at (T-674, v2 slice 10; spec 6.2, finding D-11).
//
// A layout opens at the hour last chosen for it on this device, failing that
// at the event's first act, failing that now. The choice is presentation
// only: it never changes the layout, is never saved with it and never enters
// History. Kept in localStorage under the layout's id; storage is a
// convenience, so every read and write survives its absence, and what comes
// back is checked before it is believed.
// ---------------------------------------------------------------------------

export const EVENING_MEMORY_PREFIX = "venviewer.hall-hour.v1:";

/** The years a remembered hour may name (as v1's dial bounds its date field). */
const FIRST = Date.UTC(1900, 0, 1);
const LAST = Date.UTC(2200, 11, 31);

const RememberedHourSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now") }).strict(),
  z.object({ mode: z.literal("set"), at: z.number().finite().min(FIRST).max(LAST) }).strict(),
]);

export type RememberedHour = z.infer<typeof RememberedHourSchema>;

/** Just the part of Storage this needs. */
export interface HourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function deviceStorage(): HourStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function keyFor(configId: string): string {
  return `${EVENING_MEMORY_PREFIX}${configId}`;
}

/** The hour last chosen for a layout on this device, or null. */
export function readRememberedHour(configId: string, storage: HourStorage | null = deviceStorage()): RememberedHour | null {
  if (storage === null || configId.length === 0) return null;
  try {
    const raw = storage.getItem(keyFor(configId));
    if (raw === null) return null;
    const parsed = RememberedHourSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Keeps the hour chosen for a layout on this device. */
export function rememberHour(configId: string, hour: RememberedHour, storage: HourStorage | null = deviceStorage()): void {
  if (storage === null || configId.length === 0) return;
  const parsed = RememberedHourSchema.safeParse(hour);
  if (!parsed.success) return;
  try {
    storage.setItem(keyFor(configId), JSON.stringify(parsed.data));
  } catch {
    // Storage is a convenience: a full or blocked store leaves the hour unremembered.
  }
}
