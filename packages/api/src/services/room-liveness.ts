import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { spaces } from "../db/schema.js";

type Conn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Whether the room is live at the venue, read under FOR KEY SHARE in the
 * caller's transaction (release audit admin-venues-3). Every write that puts
 * a booking or a timed event phase into a room, moves one there, or moves one
 * in time calls this before it writes anything. A room's delete holds the
 * room FOR UPDATE while it counts what is still to come, so the two wait for
 * each other: a write that took the room first is counted and refuses the
 * delete, and one that waits finds the room deleted and writes nothing. The
 * lock does not stop the room being renamed or edited.
 *
 * Called outside a transaction it would hold nothing, so callers pass a tx.
 */
export async function lockLiveRoom(conn: Conn, venueId: string, spaceId: string): Promise<boolean> {
  const [room] = await conn.select({ id: spaces.id }).from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.venueId, venueId), isNull(spaces.deletedAt)))
    .limit(1)
    .for("key share");
  return room !== undefined;
}
