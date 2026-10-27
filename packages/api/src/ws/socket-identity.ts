import { eq, inArray } from "drizzle-orm";
import { PlatformRoleSchema, type PlatformRole } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { users } from "../db/schema.js";

// ---------------------------------------------------------------------------
// A socket's user, as the database holds them now (release audit configs-4
// and events-diary-5).
//
// A socket authenticates once, but its person can be offboarded (Clerk's
// user.deleted webhook unlinks the row), moved to another venue or given
// another role while it stays open. Every write a socket makes, and every
// heartbeat, reads the row again: the role, venue and platform role it acts
// with are the row's, never the ones it connected with.
// ---------------------------------------------------------------------------

/** Who a socket signed in as: the users row, and the Clerk account it was
 *  linked to then. A test-mode token names no Clerk account (null). */
export interface SocketIdentity {
  readonly userId: string;
  readonly clerkId: string | null;
}

/** The authority a socket's user holds now. */
export interface CurrentSocketUser {
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole: PlatformRole;
}

interface UserRow {
  readonly id: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole: string;
  readonly clerkId: string | null;
}

/**
 * The row's authority, or null when the row no longer answers for this
 * socket: deleted, unlinked from Clerk (offboarded), or linked to another
 * Clerk account than the one the socket signed in with. An unknown platform
 * role reads as none.
 */
export function currentAuthority(row: UserRow | undefined, identity: SocketIdentity): CurrentSocketUser | null {
  if (row === undefined || row.clerkId === null) return null;
  if (identity.clerkId !== null && row.clerkId !== identity.clerkId) return null;
  const platformRole = PlatformRoleSchema.safeParse(row.platformRole);
  return { role: row.role, venueId: row.venueId, platformRole: platformRole.success ? platformRole.data : "none" };
}

const USER_COLUMNS = {
  id: users.id,
  role: users.role,
  venueId: users.venueId,
  platformRole: users.platformRole,
  clerkId: users.clerkId,
} as const;

/**
 * Reads one socket's user. Inside a write's transaction pass `lock: true`:
 * the row is held FOR SHARE to the end of it, so a role change or an
 * offboarding waits for the write that read the old role, and a write that
 * starts after it reads the new one.
 */
export async function readCurrentSocketUser(
  db: Pick<Database, "select">,
  identity: SocketIdentity,
  options: { readonly lock: boolean },
): Promise<CurrentSocketUser | null> {
  const query = db.select(USER_COLUMNS).from(users).where(eq(users.id, identity.userId)).limit(1);
  const [row] = options.lock ? await query.for("share") : await query;
  return currentAuthority(row, identity);
}

/** Reads many sockets' users in one query, for a heartbeat's re-check. */
export async function readCurrentSocketUsers(
  db: Pick<Database, "select">,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, UserRow>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.select(USER_COLUMNS).from(users).where(inArray(users.id, [...new Set(userIds)]));
  return new Map(rows.map((row) => [row.id, row]));
}
