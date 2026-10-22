import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  DIETARY_MEMORY_NOTE_MAX,
  DIETARY_MEMORY_RETENTION,
  dietaryMemoryConsentWording,
  type RememberedDietaryNote,
} from "@omnitwin/types";
import { configurations, rememberedDietaryNotes, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Remembered allergy notes — "ask once, then remember" (Blake, 17 October
// 2026). The store behind PUT/GET/DELETE /account/dietary-notes and the
// unused-note pass of POST /admin/cleanup.
//
// Three rules hold here, not in the route:
//   - Only the owner. Every read and write is scoped to the signed-in user's
//     id; a note is never found, listed or removed through another account,
//     whatever that account's role.
//   - The note never travels as a parameter. It is copied inside PostgreSQL
//     from the client's own saved layout to the remembered row, so a failed
//     write's error (which repeats the query's parameters) cannot carry it
//     into a log line or an error report; and a write error is rethrown
//     with its SQLSTATE only, never the failing row the database describes.
//   - The record outlives the note. Removal clears the note and keeps who
//     agreed, when, to which words, and when and why it ended.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_PATH = "{instructions,dietary,otherAllergies}";

/** A write to the store failed. Carries the SQLSTATE and nothing else: the
 *  database's own error can describe the failing row, note included. */
export class DietaryMemoryWriteError extends Error {
  readonly sqlState: string | null;
  constructor(cause: unknown) {
    const sqlState = sqlStateOf(cause);
    super(`Remembered dietary note write failed${sqlState === null ? "" : ` (SQLSTATE ${sqlState})`}`);
    this.name = "DietaryMemoryWriteError";
    this.sqlState = sqlState;
  }
}

/** The SQLSTATE of a database error, looking through up to three causes; the
 *  only part of such an error that is safe to log beside an allergy note. */
export function sqlStateOf(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth += 1) {
    const code: unknown = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Every write to the store goes through here: whatever fails comes back as
 *  a DietaryMemoryWriteError, never as the database's own description. */
export async function guardDietaryMemoryWrite<T>(write: () => PromiseLike<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw new DietaryMemoryWriteError(error);
  }
}

/** What the layout holds, without the note itself. */
interface LayoutNoteFacts {
  readonly venueId: string;
  readonly ownerId: string | null;
  readonly hasNote: boolean;
  readonly noteLength: number;
}

async function layoutNoteFacts(db: Database, configurationId: string): Promise<LayoutNoteFacts | null> {
  const [row] = await db
    .select({
      venueId: configurations.venueId,
      ownerId: configurations.userId,
      hasNote: sql<boolean>`coalesce(${configurations.metadata} #>> ${NOTE_PATH}, '') ~ '\\S'`,
      noteLength: sql<number>`coalesce(char_length(${configurations.metadata} #>> ${NOTE_PATH}), 0)::int`,
    })
    .from(configurations)
    .where(and(eq(configurations.id, configurationId), isNull(configurations.deletedAt)))
    .limit(1);
  return row ?? null;
}

export type RememberOutcome =
  | { readonly kind: "remembered"; readonly note: RememberedDietaryNote }
  /** Missing, deleted, or another account's layout: one answer for all three. */
  | { readonly kind: "layout-not-found" }
  | { readonly kind: "no-note" }
  | { readonly kind: "note-too-long" };

class LayoutChangedDuringRemember extends Error {
  constructor() {
    super("The layout no longer holds an allergy note to remember");
    this.name = "LayoutChangedDuringRemember";
  }
}

/**
 * Remembers the allergy note on the user's own saved layout, with the
 * current wording as the consent record. A note already remembered at the
 * venue under the same wording is replaced and its consent kept; one
 * remembered under other words is ended ("reworded") and a new record made,
 * because the client has now agreed to different words.
 */
export async function rememberDietaryNote(
  db: Database,
  userId: string,
  configurationId: string,
): Promise<RememberOutcome> {
  const facts = await layoutNoteFacts(db, configurationId);
  if (facts === null || facts.ownerId !== userId) return { kind: "layout-not-found" };
  if (!facts.hasNote) return { kind: "no-note" };
  if (facts.noteLength > DIETARY_MEMORY_NOTE_MAX) return { kind: "note-too-long" };

  const wording = dietaryMemoryConsentWording();
  const rememberedId = await guardDietaryMemoryWrite(() => db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE remembered_dietary_notes
      SET note = NULL, removed_at = now(), removed_by = 'reworded'
      WHERE user_id = ${userId} AND venue_id = ${facts.venueId}
        AND removed_at IS NULL AND consent_wording <> ${wording}`);
    // The checks above, again inside the statement: if the layout changed
    // hands or lost its note in the meantime, nothing is written.
    const inserted = await tx.execute(sql`
      INSERT INTO remembered_dietary_notes (user_id, venue_id, note, consent_wording, source_configuration_id)
      SELECT c.user_id, c.venue_id, c.metadata #>> ${NOTE_PATH}, ${wording}, c.id
      FROM configurations c
      WHERE c.id = ${configurationId} AND c.user_id = ${userId} AND c.deleted_at IS NULL
        AND coalesce(c.metadata #>> ${NOTE_PATH}, '') ~ '\\S'
        AND char_length(c.metadata #>> ${NOTE_PATH}) <= ${DIETARY_MEMORY_NOTE_MAX}
      ON CONFLICT (user_id, venue_id) WHERE removed_at IS NULL
      DO UPDATE SET note = EXCLUDED.note, source_configuration_id = EXCLUDED.source_configuration_id, updated_at = now()
      RETURNING id`);
    const id: unknown = inserted.rows[0]?.["id"];
    // Throwing rolls the "reworded" ending back with the failed insert.
    if (typeof id !== "string") throw new LayoutChangedDuringRemember();
    return id;
  }).catch((error: unknown) => {
    if (error instanceof LayoutChangedDuringRemember) return null;
    throw error;
  }));
  if (rememberedId === null) return { kind: "no-note" };

  const [note] = await listRememberedDietaryNotes(db, userId, rememberedId);
  if (note === undefined) return { kind: "no-note" };
  return { kind: "remembered", note };
}

const RowSchema = z.object({
  id: z.string(),
  venueId: z.string(),
  venueName: z.string(),
  note: z.string(),
  consentWording: z.string(),
  consentedAt: z.date(),
  updatedAt: z.date(),
  layoutId: z.string().nullable(),
  layoutName: z.string().nullable(),
});

/** The user's remembered notes (one per venue), newest first; `onlyId`
 *  narrows it to one. Never another account's. */
export async function listRememberedDietaryNotes(
  db: Database,
  userId: string,
  onlyId?: string,
): Promise<RememberedDietaryNote[]> {
  const rows = await db
    .select({
      id: rememberedDietaryNotes.id,
      venueId: rememberedDietaryNotes.venueId,
      venueName: venues.name,
      note: rememberedDietaryNotes.note,
      consentWording: rememberedDietaryNotes.consentWording,
      consentedAt: rememberedDietaryNotes.consentedAt,
      updatedAt: rememberedDietaryNotes.updatedAt,
      layoutId: configurations.id,
      layoutName: configurations.name,
    })
    .from(rememberedDietaryNotes)
    .innerJoin(venues, eq(venues.id, rememberedDietaryNotes.venueId))
    // The layout is named only while it is still this user's and not deleted.
    .leftJoin(configurations, and(
      eq(configurations.id, rememberedDietaryNotes.sourceConfigurationId),
      eq(configurations.userId, userId),
      isNull(configurations.deletedAt),
    ))
    .where(and(
      eq(rememberedDietaryNotes.userId, userId),
      isNull(rememberedDietaryNotes.removedAt),
      onlyId === undefined ? undefined : eq(rememberedDietaryNotes.id, onlyId),
    ))
    .orderBy(desc(rememberedDietaryNotes.updatedAt));

  return rows.map((raw) => {
    const row = RowSchema.parse(raw);
    return {
      id: row.id,
      venueId: row.venueId,
      venueName: row.venueName,
      otherAllergies: row.note,
      consentWording: row.consentWording,
      consentedAt: row.consentedAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sourceLayout: row.layoutId === null || row.layoutName === null ? null : { id: row.layoutId, name: row.layoutName },
    };
  });
}

/**
 * The client removes a remembered note. True when it was theirs and still
 * remembered; false otherwise, whoever else's it is. The layouts that already
 * carry the note keep it under their own rule (30 days after the event).
 */
export async function removeRememberedDietaryNote(db: Database, userId: string, id: string): Promise<boolean> {
  const removed = await guardDietaryMemoryWrite(() => db.update(rememberedDietaryNotes)
    .set({ note: null, removedAt: sql`now()`, removedBy: "client" })
    .where(and(
      eq(rememberedDietaryNotes.id, id),
      eq(rememberedDietaryNotes.userId, userId),
      isNull(rememberedDietaryNotes.removedAt),
    ))
    .returning({ id: rememberedDietaryNotes.id }));
  return removed.length > 0;
}

export interface UnusedRememberedNotesOptions {
  readonly now?: Date;
  /** Count what would be removed, and remove nothing. */
  readonly dryRun?: boolean;
}

export interface UnusedRememberedNotesResult {
  readonly dryRun: boolean;
  /** Remembered notes removed (or that would be) for going unused. */
  readonly removed: number;
}

/**
 * The unused period: a note not saved with a layout for
 * DIETARY_MEMORY_RETENTION.daysUnused days is removed, its record kept.
 * Idempotent: an ended record is never touched again.
 */
export async function removeUnusedRememberedNotes(
  db: Database,
  options: UnusedRememberedNotesOptions = {},
): Promise<UnusedRememberedNotesResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const cutoff = new Date(now.getTime() - DIETARY_MEMORY_RETENTION.daysUnused * DAY_MS);
  const unused = and(isNull(rememberedDietaryNotes.removedAt), lt(rememberedDietaryNotes.updatedAt, cutoff));
  if (dryRun) {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(rememberedDietaryNotes).where(unused);
    return { dryRun, removed: row?.count ?? 0 };
  }
  const removed = await guardDietaryMemoryWrite(() => db.update(rememberedDietaryNotes)
    .set({ note: null, removedAt: now, removedBy: "retention" })
    .where(unused)
    .returning({ id: rememberedDietaryNotes.id }));
  return { dryRun, removed: removed.length };
}
