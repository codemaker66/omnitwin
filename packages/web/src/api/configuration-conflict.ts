import { z } from "zod";
import { ApiError } from "./client.js";

// ---------------------------------------------------------------------------
// A save that met a newer revision (HTTP 409, REVISION_CONFLICT): who made it
// and when, for the editor's conflict choice. Its own module, apart from
// configurations.ts, because the walkable twin's enquiry modal loads that
// module and none of this (the twin's byte budget, e2e/twin-performance).
// ---------------------------------------------------------------------------

/** Who made the newer revision a save collided with. */
export interface RevisionAuthor {
  readonly userId: string | null;
  /** Their display name (else account name); never an email. */
  readonly name: string | null;
}

export interface RevisionConflict {
  readonly expectedRevision: number;
  readonly currentRevision: number;
  readonly message: string;
  /** Null when the server does not know or will not say (a guest's save, a
   *  revision older than the history, any 409 to an anonymous caller, an
   *  older server that sends neither field). */
  readonly changedBy: RevisionAuthor | null;
  /** When the newer revision was made, by the server's clock; null when unknown. */
  readonly changedAt: Date | null;
}

// Who and when are explanations, not the conflict: a missing or malformed
// value (an older server, a proxy) degrades to unknown and never costs the
// client the 409 it must act on.
const RevisionAuthorSchema = z.object({
  userId: z.string().trim().min(1).max(200).nullable().catch(null),
  name: z.string().trim().max(200).nullable().catch(null)
    .transform((name) => name === null || name.length === 0 ? null : name),
}).transform((author): RevisionAuthor | null => author.userId === null && author.name === null ? null : author);

const RevisionConflictDetailsSchema = z.object({
  expectedRevision: z.number().int().min(1),
  currentRevision: z.number().int().min(1),
  changedBy: RevisionAuthorSchema.nullable().optional().catch(null),
  changedAt: z.iso.datetime({ offset: true }).nullable().optional().catch(null),
});

export function parseRevisionConflict(err: unknown): RevisionConflict | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 409 || err.code !== "REVISION_CONFLICT") return null;
  const parsed = RevisionConflictDetailsSchema.safeParse(err.details);
  if (!parsed.success) return null;
  const changedAt = parsed.data.changedAt === undefined || parsed.data.changedAt === null
    ? null
    : new Date(parsed.data.changedAt);
  return {
    expectedRevision: parsed.data.expectedRevision,
    currentRevision: parsed.data.currentRevision,
    message: err.message,
    changedBy: parsed.data.changedBy ?? null,
    changedAt: changedAt !== null && Number.isFinite(changedAt.getTime()) ? changedAt : null,
  };
}
