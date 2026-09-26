import type { TurnaroundRuleSetting } from "@omnitwin/types";
import { venueDate } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// Words for changeover times. Pure: the settings section renders what these
// return, and the tests pin them.
// ---------------------------------------------------------------------------

/** "45 min", "2 h", "1 h 30"; a rule of 0 means back to back is fine. */
export function changeoverDuration(minutes: number): string {
  if (minutes === 0) return "None";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest).padStart(2, "0")}`;
}

/** The same duration in full words, for a screen reader. */
export function changeoverDurationWords(minutes: number): string {
  if (minutes === 0) return "no changeover time";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    hours === 0 ? null : `${String(hours)} ${hours === 1 ? "hour" : "hours"}`,
    rest === 0 ? null : `${String(rest)} ${rest === 1 ? "minute" : "minutes"}`,
  ].filter((part): part is string => part !== null);
  return parts.join(" ");
}

/** "Wedding" from "wedding": event types are stored as bookings use them. */
export function eventTypeLabel(eventType: string | null): string {
  if (eventType === null) return "Any event";
  const trimmed = eventType.trim();
  return trimmed === "" ? "Any event" : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export type RoomNames = ReadonlyMap<string, string>;

export function roomLabel(spaceId: string | null, rooms: RoomNames): string {
  if (spaceId === null) return "All rooms";
  return rooms.get(spaceId) ?? "A room no longer listed";
}

/** The rule the Diary would use for this scope once `retiring` is gone: the
 *  engine's own choice, most specific first and the longer on a tie. */
export function fallbackRule(
  retiring: Pick<TurnaroundRuleSetting, "id" | "spaceId" | "eventType">,
  rules: readonly TurnaroundRuleSetting[],
): TurnaroundRuleSetting | null {
  let best: TurnaroundRuleSetting | null = null;
  let bestScore = -1;
  for (const candidate of rules) {
    if (candidate.id === retiring.id || !candidate.isActive) continue;
    if (candidate.spaceId !== null && candidate.spaceId !== retiring.spaceId) continue;
    if (candidate.eventType !== null && candidate.eventType !== retiring.eventType) continue;
    const score = (candidate.spaceId !== null ? 2 : 0) + (candidate.eventType !== null ? 1 : 0);
    if (score > bestScore || (score === bestScore && best !== null && candidate.minutes > best.minutes)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** What removing a rule does, in one sentence. */
export function removalConsequence(
  retiring: TurnaroundRuleSetting,
  rules: readonly TurnaroundRuleSetting[],
  rooms: RoomNames,
): string {
  const fallback = fallbackRule(retiring, rules);
  const where = retiring.spaceId === null ? "Rooms without their own time" : roomLabel(retiring.spaceId, rooms);
  if (fallback === null) return `${where} will have no changeover time, so the Diary will not check those gaps.`;
  const source = fallback.spaceId === null ? "all rooms" : roomLabel(fallback.spaceId, rooms);
  const kind = fallback.eventType === null ? "" : ` for ${eventTypeLabel(fallback.eventType).toLowerCase()}`;
  return `${where} will use the time for ${source}${kind}: ${changeoverDuration(fallback.minutes)}.`;
}

/** "Set by Elaine MacGregor, 26 Sep 2026" (venue-local, the desk's month
 *  names), or "Not confirmed" for a demo value. */
export function confirmationWords(rule: Pick<TurnaroundRuleSetting, "confirmedAt" | "updatedByName">): string {
  if (rule.confirmedAt === null) return "Not confirmed";
  const when = venueDate(rule.confirmedAt);
  if (when === null) return "Confirmed";
  return rule.updatedByName === null ? `Set ${when}` : `Set by ${rule.updatedByName}, ${when}`;
}

/** The API's order: all rooms first, then the venue's rooms in order; within a
 *  room, the time for any event before those for particular types. */
export function sortRules(
  rules: readonly TurnaroundRuleSetting[],
  roomOrder: readonly string[],
): TurnaroundRuleSetting[] {
  const position = new Map(roomOrder.map((id, index) => [id, index]));
  const place = (spaceId: string | null): number => spaceId === null ? -1 : position.get(spaceId) ?? roomOrder.length;
  return [...rules].sort((left, right) => {
    const byRoom = place(left.spaceId) - place(right.spaceId);
    if (byRoom !== 0) return byRoom;
    if (left.eventType === null || right.eventType === null) {
      return left.eventType === right.eventType ? 0 : left.eventType === null ? -1 : 1;
    }
    return left.eventType.localeCompare(right.eventType, "en-GB");
  });
}

/** Whole minutes from 0 to a day, from what was typed; null when it is not one. */
export function parseMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/u.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes <= 1440 ? minutes : null;
}

/** Where a new time most likely belongs: all rooms if that has none, else the
 *  first room, in the venue's order, with no time for any event. "" is all
 *  rooms, as the add form's select has it. */
export function firstOpenRoom(
  rules: readonly Pick<TurnaroundRuleSetting, "spaceId" | "eventType">[],
  roomOrder: readonly string[],
): string {
  const taken = new Set(rules.filter((rule) => rule.eventType === null).map((rule) => rule.spaceId ?? ""));
  if (!taken.has("")) return "";
  return roomOrder.find((id) => !taken.has(id)) ?? "";
}
