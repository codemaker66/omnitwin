import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { venues } from "../db/schema.js";
import { canonicalRuntimeAssetStorageKey } from "./runtime-asset-receipt.js";
import type { JwtUser } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";

export const EXACT_GRAND_HALL_RUNTIME_TARGET = {
  venueSlug: "trades-hall",
  roomSlug: "grand-hall",
} as const;

export const EXACT_GRAND_HALL_RUNTIME_STORAGE_PREFIX =
  "venues/trades-hall/rooms/grand-hall/";

export function isExactGrandHallRuntimeTarget(
  venueSlug: string,
  roomSlug: string,
): boolean {
  return venueSlug === EXACT_GRAND_HALL_RUNTIME_TARGET.venueSlug
    && roomSlug === EXACT_GRAND_HALL_RUNTIME_TARGET.roomSlug;
}

/**
 * Bind every private Grand Hall member to its own storage namespace. Database
 * venue/room labels alone are not storage authorization: a mislabeled row must
 * never delegate a different room's or tenant's object to Grand Hall users.
 */
export function isExactGrandHallRuntimeStorageKey(r2Key: string): boolean {
  const canonical = canonicalRuntimeAssetStorageKey(r2Key);
  if (!canonical.startsWith(EXACT_GRAND_HALL_RUNTIME_STORAGE_PREFIX)) return false;

  const suffix = canonical.slice(EXACT_GRAND_HALL_RUNTIME_STORAGE_PREFIX.length);
  if (suffix.length === 0 || suffix.includes("\\")) return false;
  const segments = suffix.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function isExactGrandHallRuntimeStorageSet(
  venueSlug: string,
  roomSlug: string,
  members: readonly {
    readonly r2Key: string | null;
    readonly externalUrl: string | null;
  }[],
): boolean {
  if (!isExactGrandHallRuntimeTarget(venueSlug, roomSlug)) return true;
  return members.length > 0 && members.every((member) =>
    member.r2Key !== null
    && member.externalUrl === null
    && isExactGrandHallRuntimeStorageKey(member.r2Key));
}

/**
 * Raw captured-runtime access is narrower than ordinary layout access. The
 * existing venue-management boundary admits Venviewer platform admins and the
 * assigned venue's admin/staff/hallkeeper roles; planners and clients do not
 * gain private capture access merely by knowing an immutable package id.
 */
export function canAccessExactGrandHallRuntime(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  tradesHallVenueId: string,
): boolean {
  return canManageVenue(user, tradesHallVenueId);
}

export async function resolveActiveRuntimeVenueId(
  db: Database,
  venueSlug: string,
): Promise<string | null> {
  const [venue] = await db
    .select({ id: venues.id })
    .from(venues)
    .where(and(eq(venues.slug, venueSlug), isNull(venues.deletedAt)))
    .limit(1);
  return venue?.id ?? null;
}
