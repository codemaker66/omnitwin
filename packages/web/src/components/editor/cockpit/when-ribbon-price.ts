import { msToWallInput } from "../../../pages/diary/lib/board-time.js";

// ---------------------------------------------------------------------------
// The price line (goal 19 S6): the venue's own estimate, recomputed as the
// window moves. The estimate door prices one wall-clock day, so a window
// that runs past midnight is told so rather than priced wrongly; an end at
// midnight exactly is the day's twenty-fourth hour.
// ---------------------------------------------------------------------------

export interface PriceWindowRequest {
  readonly spaceId: string;
  readonly eventDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly guestCount: number;
}

export type PriceWindow =
  | { readonly kind: "request"; readonly input: PriceWindowRequest }
  | { readonly kind: "crosses-midnight" }
  | { readonly kind: "none" };

export function priceWindowFor(
  spaceId: string,
  startMs: number,
  endMs: number,
  timeZone: string,
  guestCount: number | null,
): PriceWindow {
  if (guestCount === null || guestCount < 1 || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return { kind: "none" };
  }
  const [eventDate, startTime] = msToWallInput(startMs, timeZone).split("T");
  const [endDate, endWall] = msToWallInput(endMs, timeZone).split("T");
  if (eventDate === undefined || startTime === undefined || endDate === undefined || endWall === undefined) return { kind: "none" };
  if (endDate === eventDate) {
    return { kind: "request", input: { spaceId, eventDate, startTime, endTime: endWall, guestCount: Math.min(Math.round(guestCount), 10_000) } };
  }
  // Midnight exactly: the next date's 00:00 is this date's 24:00.
  const [lastDate, lastWall] = msToWallInput(endMs - 60_000, timeZone).split("T");
  if (endWall === "00:00" && lastDate === eventDate && lastWall !== undefined) {
    return { kind: "request", input: { spaceId, eventDate, startTime, endTime: "24:00", guestCount: Math.min(Math.round(guestCount), 10_000) } };
  }
  return { kind: "crosses-midnight" };
}

export function formatPrice(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(total);
  } catch {
    return `${currency} ${String(Math.round(total))}`;
  }
}
