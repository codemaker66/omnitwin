import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  ClientAccountKindSchema,
  normalisePhone,
  type PeopleSearchResults,
} from "@omnitwin/types";
import { containsPattern, matcher } from "./client-search.js";
import { liveAccount, liveContact, type PeopleConn } from "./people-records.js";

// ---------------------------------------------------------------------------
// People Book search (T-665).
//
// Staff find a person while the person is on the phone, by what they have: a
// name they heard, a piece of an email, or a phone number in whatever shape it
// was typed. The name and email use the Clients desk's matcher, so both desks
// rank alike: a name or email that contains the words typed, or, from four
// letters, one that is close under pg_trgm. A phone is found on its digits: a
// point's value is the normalised number (07700900123, +33123456789), and
// "07700 900 123", "+44 7700 900123" and "7700900123" all normalise to digits
// it contains. Live records only, at the venue unless the searcher is a
// platform admin, twenty of each at most.
// ---------------------------------------------------------------------------

/** The most people, and the most organisations, one search returns. */
export const PEOPLE_SEARCH_LIMIT = 20;

/** Fewest digits a query needs before it is taken for a phone number. */
const PHONE_SEARCH_MIN_DIGITS = 6;

const PersonRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  organisation_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  matched: z.enum(["name", "email", "phone"]),
});

const OrganisationRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: ClientAccountKindSchema,
  member_count: z.number().int().nonnegative(),
});

/**
 * The digits to look for in phone points, or null when the query is not a
 * phone number: it holds a letter, or fewer than six digits once typed the way
 * points are stored (a leading +44 or 0044 is the national 0, any other +
 * is dropped, spaces and punctuation go).
 */
function phoneDigits(query: string): string | null {
  if (/\p{L}/u.test(query)) return null;
  const digits = normalisePhone(query)?.replace(/\D/g, "") ?? "";
  return digits.length >= PHONE_SEARCH_MIN_DIGITS ? digits : null;
}

/**
 * The live people and organisations at `scopeVenueId` (every venue when null)
 * that match `query`: people by name, any email or any phone they hold, with
 * the primary email, phone and organisation the record shows; organisations by
 * name, with their live members counted.
 */
export async function searchPeople(
  db: PeopleConn,
  query: string,
  scopeVenueId: string | null,
): Promise<PeopleSearchResults> {
  const match = matcher(query);
  const pattern = containsPattern(query);
  const digits = phoneDigits(query);
  const venueOf = (table: "contacts" | "client_accounts"): SQL =>
    scopeVenueId === null ? sql`TRUE` : sql`${sql.raw(table)}.venue_id = ${scopeVenueId}`;

  const nameCol = sql`contacts.name`;
  const nameHit = match.where(nameCol);
  const nameExact = sql`contacts.name ILIKE ${pattern}`;
  const pointOf = (kind: "email" | "phone", test: SQL): SQL => sql`EXISTS (
    SELECT 1 FROM contact_points p
    WHERE p.contact_id = contacts.id AND p.venue_id = contacts.venue_id AND p.kind = ${kind} AND ${test}
  )`;
  const emailHit = pointOf("email", match.where(sql`p.value`));
  const emailExact = pointOf("email", sql`p.value ILIKE ${pattern}`);
  const phoneHit = digits === null ? sql`FALSE` : pointOf("phone", sql`strpos(p.value, ${digits}) > 0`);

  const people = db.execute(sql`
    SELECT contacts.id, contacts.name, contacts.email, contacts.phone,
      (SELECT client_accounts.name FROM account_memberships pm
        JOIN client_accounts ON client_accounts.id = pm.client_account_id AND client_accounts.venue_id = pm.venue_id
        WHERE pm.contact_id = contacts.id AND pm.venue_id = contacts.venue_id AND pm.is_primary AND ${liveAccount()}
        LIMIT 1) AS organisation_name,
      CASE
        WHEN ${nameExact} THEN 'name'
        WHEN ${emailExact} THEN 'email'
        WHEN ${phoneHit} THEN 'phone'
        WHEN ${nameHit} THEN 'name'
        ELSE 'email'
      END AS matched
    FROM contacts
    WHERE ${venueOf("contacts")} AND ${liveContact()} AND (${nameHit} OR ${emailHit} OR ${phoneHit})
    ORDER BY GREATEST(
      CASE WHEN ${nameHit} THEN ${match.rank(nameCol)} ELSE 0 END,
      CASE WHEN ${emailHit} OR ${phoneHit} THEN 1 ELSE 0 END
    ) DESC, contacts.name, contacts.id
    LIMIT ${PEOPLE_SEARCH_LIMIT}
  `);

  const accountName = sql`client_accounts.name`;
  const organisations = db.execute(sql`
    SELECT client_accounts.id, client_accounts.name, client_accounts.kind,
      (SELECT count(*)::int FROM account_memberships m
        JOIN contacts ON contacts.id = m.contact_id AND contacts.venue_id = m.venue_id
        WHERE m.client_account_id = client_accounts.id AND m.venue_id = client_accounts.venue_id AND ${liveContact()}
      ) AS member_count
    FROM client_accounts
    WHERE ${venueOf("client_accounts")} AND ${liveAccount()} AND ${match.where(accountName)}
    ORDER BY ${match.rank(accountName)} DESC, client_accounts.name, client_accounts.id
    LIMIT ${PEOPLE_SEARCH_LIMIT}
  `);

  const [peopleResult, organisationResult] = await Promise.all([people, organisations]);
  return {
    people: peopleResult.rows.map((raw) => {
      const row = PersonRowSchema.parse(raw);
      return {
        id: row.id,
        name: row.name,
        organisationName: row.organisation_name,
        email: row.email,
        phone: row.phone,
        matched: row.matched,
      };
    }),
    organisations: organisationResult.rows.map((raw) => {
      const row = OrganisationRowSchema.parse(raw);
      return { id: row.id, name: row.name, kind: row.kind, memberCount: row.member_count };
    }),
  };
}
