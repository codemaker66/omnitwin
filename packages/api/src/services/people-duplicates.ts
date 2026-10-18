import { sql } from "drizzle-orm";
import { z } from "zod";
import { CLOSE_NAME_SIMILARITY, DUPLICATE_REASONS, type DuplicateReason, type DuplicateSuggestion } from "@omnitwin/types";
import { liveAccount, liveContact, type PeopleConn } from "./people-records.js";

// ---------------------------------------------------------------------------
// Possible duplicates in the People Book (T-665).
//
// The book never merges people by itself; it suggests. Two live people at a
// venue are suggested to each other when they hold one email or one phone
// (the same normalised value of that kind), or when both belong to one live
// organisation and their names are close under pg_trgm.
//
// A person settles a suggestion by marking the pair as two people. The mark
// is kept against the records as they were, and a merge leaves a tombstone
// pointing at its survivor, so a person's "family" is the person and every
// tombstone whose merged_into_id leads to them, followed to any depth. A pair
// is left out when a live mark joins any of one person's family to any of
// the other's: the mark holds across merges in either direction, and lapses
// by itself when a merge is undone, without anything rewriting the mark.
// ---------------------------------------------------------------------------

/** The most suggestions one person is shown. */
export const DUPLICATE_SUGGESTION_LIMIT = 50;

const SuggestionRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  organisation_name: z.string().nullable(),
  shared_email: z.boolean(),
  shared_phone: z.boolean(),
  close_name: z.boolean(),
});
type SuggestionRow = z.infer<typeof SuggestionRowSchema>;

function reasonsOf(row: SuggestionRow): DuplicateReason[] {
  const held: Record<DuplicateReason, boolean> = {
    shared_email: row.shared_email,
    shared_phone: row.shared_phone,
    close_name: row.close_name,
  };
  return DUPLICATE_REASONS.filter((reason) => held[reason]);
}

/**
 * The live people at `venueId` who may be the same person as `personId`, most
 * reasons first, then by name and id. Empty when the person is not live at
 * that venue.
 */
export async function duplicateSuggestions(db: PeopleConn, venueId: string, personId: string): Promise<DuplicateSuggestion[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE
    me AS (
      SELECT contacts.id, contacts.name FROM contacts
      WHERE contacts.id = ${personId} AND contacts.venue_id = ${venueId} AND ${liveContact()}
    ),
    my_points AS (
      SELECT p.kind, p.value FROM contact_points p JOIN me ON me.id = p.contact_id
      WHERE p.venue_id = ${venueId}
    ),
    point_hits AS (
      SELECT p.contact_id AS id,
        bool_or(p.kind = 'email') AS shared_email,
        bool_or(p.kind = 'phone') AS shared_phone
      FROM contact_points p JOIN my_points m ON m.kind = p.kind AND m.value = p.value
      WHERE p.venue_id = ${venueId} AND p.contact_id <> ${personId}
      GROUP BY p.contact_id
    ),
    my_accounts AS (
      SELECT m.client_account_id AS id FROM account_memberships m
      JOIN client_accounts ON client_accounts.id = m.client_account_id AND client_accounts.venue_id = ${venueId}
      WHERE m.venue_id = ${venueId} AND m.contact_id = ${personId} AND ${liveAccount()}
    ),
    name_hits AS (
      SELECT DISTINCT o.contact_id AS id FROM account_memberships o
      JOIN my_accounts a ON a.id = o.client_account_id
      JOIN contacts ON contacts.id = o.contact_id AND contacts.venue_id = ${venueId}
      CROSS JOIN me
      WHERE o.venue_id = ${venueId} AND o.contact_id <> me.id
        AND similarity(people_name_key(contacts.name), people_name_key(me.name)) >= ${CLOSE_NAME_SIMILARITY}::real
    ),
    candidates AS (
      SELECT contacts.id, contacts.name,
        coalesce(ph.shared_email, false) AS shared_email,
        coalesce(ph.shared_phone, false) AS shared_phone,
        nh.id IS NOT NULL AS close_name
      FROM contacts
      LEFT JOIN point_hits ph ON ph.id = contacts.id
      LEFT JOIN name_hits nh ON nh.id = contacts.id
      WHERE contacts.venue_id = ${venueId} AND contacts.id <> ${personId} AND ${liveContact()}
        AND contacts.id IN (SELECT id FROM point_hits UNION SELECT id FROM name_hits)
    ),
    roots AS (
      SELECT id FROM me UNION SELECT id FROM candidates
    ),
    family (root_id, id) AS (
      SELECT id, id FROM roots
      UNION
      SELECT f.root_id, t.id FROM family f
      JOIN contacts t ON t.merged_into_id = f.id AND t.venue_id = ${venueId}
    )
    SELECT c.id, c.name, c.shared_email, c.shared_phone, c.close_name,
      (SELECT client_accounts.name FROM account_memberships pm
        JOIN client_accounts ON client_accounts.id = pm.client_account_id AND client_accounts.venue_id = ${venueId}
        WHERE pm.contact_id = c.id AND pm.venue_id = ${venueId} AND pm.is_primary AND ${liveAccount()}
        LIMIT 1) AS organisation_name
    FROM candidates c CROSS JOIN me
    WHERE NOT EXISTS (
      SELECT 1 FROM family fm
      JOIN family fc ON fc.root_id = c.id
      JOIN contact_kept_apart k
        ON k.low_contact_id = LEAST(fm.id, fc.id) AND k.high_contact_id = GREATEST(fm.id, fc.id)
      WHERE fm.root_id = me.id AND k.venue_id = ${venueId} AND k.withdrawn_at IS NULL
    )
    ORDER BY (c.shared_email::int + c.shared_phone::int + c.close_name::int) DESC, c.name, c.id
    LIMIT ${DUPLICATE_SUGGESTION_LIMIT}
  `);
  return result.rows.map((raw) => {
    const row = SuggestionRowSchema.parse(raw);
    return { person: { id: row.id, name: row.name, organisationName: row.organisation_name }, reasons: reasonsOf(row) };
  });
}

/** How many people `duplicateSuggestions` suggests for this person. */
export async function countDuplicateSuggestions(db: PeopleConn, venueId: string, personId: string): Promise<number> {
  return (await duplicateSuggestions(db, venueId, personId)).length;
}
