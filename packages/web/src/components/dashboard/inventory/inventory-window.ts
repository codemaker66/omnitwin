import { InventoryAssessmentQuerySchema, type InventoryWindow } from "@omnitwin/types";

export interface InventoryWindowDraft { readonly startsAt: string; readonly endsAt: string }
const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

export function localInventoryInstant(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultInventoryWindow(now: Date = new Date()): InventoryWindowDraft {
  const startsAt = new Date((Math.floor(now.getTime() / HOUR_MS) + 1) * HOUR_MS);
  return { startsAt: localInventoryInstant(startsAt), endsAt: localInventoryInstant(new Date(startsAt.getTime() + WEEK_MS)) };
}

function instant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localInventoryInstant(date) !== value) return null;
  return date.toISOString();
}

export function inventoryWindowInput(draft: InventoryWindowDraft):
  { readonly success: true; readonly data: InventoryWindow } | { readonly success: false; readonly message: string } {
  const startsAt = instant(draft.startsAt);
  const endsAt = instant(draft.endsAt);
  if (startsAt === null || endsAt === null) return { success: false, message: "Enter valid start and end dates and times." };
  if (Date.parse(endsAt) <= Date.parse(startsAt)) return { success: false, message: "The end must be after the start." };
  const result = InventoryAssessmentQuerySchema.safeParse({ from: startsAt, to: endsAt });
  if (!result.success) return { success: false, message: "Choose a window of at most 31 days." };
  return { success: true, data: { startsAt: result.data.from, endsAt: result.data.to } };
}

export function inventoryTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit",
    minute: "2-digit", timeZoneName: "shortOffset", timeZone }).format(new Date(iso));
}

export function inventoryClockLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
