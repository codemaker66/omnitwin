import type { FastifyBaseLogger } from "fastify";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { configurationLayoutRevisions, users } from "../db/schema.js";
import { userDisplayName } from "../utils/user-display-name.js";

/** Who made a layout revision, as far as the caller may be told. */
export interface RevisionAuthor {
  readonly userId: string | null;
  /** Display name, else account name; never an email. */
  readonly name: string | null;
}

/** The newer revision a save collided with: who made it and when. */
export interface RevisionChange {
  /** Null when no revision row names an account (a guest save, a revision
   *  older than the revision history) or the caller may not be told. */
  readonly changedBy: RevisionAuthor | null;
  /** ISO 8601; null when no revision row records the revision. */
  readonly changedAt: string | null;
}

export interface RevisionConflictBody {
  readonly error: string;
  readonly code: "REVISION_CONFLICT";
  readonly details: {
    readonly expectedRevision: number;
    readonly currentRevision: number;
    readonly changedBy: RevisionAuthor | null;
    readonly changedAt: string | null;
  };
}

export const UNKNOWN_REVISION_CHANGE: RevisionChange = { changedBy: null, changedAt: null };

export function configurationRevisionEtag(revision: number): string {
  return `"configuration:${String(revision)}"`;
}

export function revisionConflictBody(
  expectedRevision: number,
  currentRevision: number,
  change: RevisionChange = UNKNOWN_REVISION_CHANGE,
): RevisionConflictBody {
  return {
    error: "Layout changed on the server. Reload before saving again.",
    code: "REVISION_CONFLICT",
    details: {
      expectedRevision,
      currentRevision,
      changedBy: change.changedBy,
      changedAt: change.changedAt,
    },
  };
}

/**
 * Who made `revision` of a layout and when, from its immutable revision row.
 * Only the row for exactly that revision answers: every writer that advances
 * `configurations.revision` records one, so a missing row means the revision
 * predates the history (or is the layout's creation) and the answer is
 * unknown, never a guess from a neighbouring row.
 *
 * `discloseActor: true` is for callers who may join the layout's live room
 * (canJoinLayoutLive: the venue's floor team, a staff owner, a platform
 * admin), who see each other's names there anyway. Anyone else keeps the time
 * and is named only in their own revision (`callerUserId`, so a client can be
 * told "You changed this layout in another tab"): a customer is never told
 * who on the venue's side edited, and an anonymous guest (null) never anyone.
 * A failed read costs the conflict its explanation, never the 409 itself.
 */
export async function loadRevisionChange(
  db: Database,
  configurationId: string,
  revision: number,
  options: {
    readonly discloseActor: boolean;
    /** The signed-in caller; null for an anonymous guest. */
    readonly callerUserId: string | null;
    readonly log: FastifyBaseLogger;
  },
): Promise<RevisionChange> {
  try {
    const [row] = await db.select({
      actorUserId: configurationLayoutRevisions.actorUserId,
      createdAt: configurationLayoutRevisions.createdAt,
      name: userDisplayName,
    })
      .from(configurationLayoutRevisions)
      .leftJoin(users, eq(users.id, configurationLayoutRevisions.actorUserId))
      .where(and(
        eq(configurationLayoutRevisions.configurationId, configurationId),
        eq(configurationLayoutRevisions.revision, revision),
      ))
      .limit(1);
    if (row === undefined) return UNKNOWN_REVISION_CHANGE;
    const changedAt = row.createdAt.toISOString();
    if (row.actorUserId === null) return { changedBy: null, changedAt };
    const callersOwnRevision = options.callerUserId !== null && row.actorUserId === options.callerUserId;
    if (!options.discloseActor && !callersOwnRevision) return { changedBy: null, changedAt };
    const name = row.name === null || row.name.trim() === "" ? null : row.name;
    return { changedBy: { userId: row.actorUserId, name }, changedAt };
  } catch (err) {
    options.log.warn({ err, configurationId, revision }, "revision conflict: could not read who made the newer revision");
    return UNKNOWN_REVISION_CHANGE;
  }
}
