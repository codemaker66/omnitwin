import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../db/client.js";
import {
  clientAccounts,
  configurations,
  contacts,
  guestLeads,
  opportunities,
  proposals,
  spaces,
  users,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// Client search (T-635, roadmap X1).
//
// Staff look a client up while the client is on the phone, and a name is often
// heard rather than read. A row matches when one of its names contains the
// words typed, or, for four letters or more, when pg_trgm's word similarity
// (migration 0081) reaches 0.6: "Mcdonald" finds "Fiona MacDonald" (0.67),
// "Hendersen" finds "Ailsa Henderson" (0.70), and "Robertson" finds neither
// (0). Shorter queries match by substring alone, where trigrams cannot tell
// a name from noise. The closest come first.
//
// The venue floor (hallkeepers included) finds people, leads and layouts, as
// before. Contacts, accounts, deals and proposals are the commercial record,
// so only the commercial roles find those (goal 18 §6 decision 6b).
// ---------------------------------------------------------------------------

export const FUZZY_MIN_LENGTH = 4;
export const WORD_SIMILARITY_THRESHOLD = 0.6;
const LIMIT = 20;

export interface ClientSearchScope {
  /** The venue searched, or null for a platform admin, who searches all. */
  readonly venueId: string | null;
  /** Whether the searcher may see the commercial record. */
  readonly commercial: boolean;
}

/** `%text%` for ILIKE, with the query's own wildcards taken literally. */
export function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

interface Matcher {
  /** True when any of the columns matches. */
  readonly where: (...columns: readonly (AnyPgColumn | SQL)[]) => SQL;
  /** How well the best of the columns matches, for ordering (1 for a substring). */
  readonly rank: (...columns: readonly (AnyPgColumn | SQL)[]) => SQL<number>;
}

function matcher(query: string): Matcher {
  const pattern = containsPattern(query);
  const lowered = query.toLowerCase();
  const fuzzy = query.length >= FUZZY_MIN_LENGTH;
  const one = (column: AnyPgColumn | SQL): SQL => fuzzy
    ? sql`(${column} ILIKE ${pattern} OR word_similarity(${lowered}, lower(${column})) >= ${WORD_SIMILARITY_THRESHOLD})`
    : sql`${column} ILIKE ${pattern}`;
  const score = (column: AnyPgColumn | SQL): SQL =>
    sql`COALESCE(CASE WHEN ${column} ILIKE ${pattern} THEN 1 ELSE word_similarity(${lowered}, lower(${column})) END, 0)`;
  return {
    where: (...columns) => sql`(${sql.join(columns.map(one), sql` OR `)})`,
    rank: (...columns) => sql<number>`GREATEST(${sql.join(columns.map(score), sql`, `)})`,
  };
}

export interface ClientSearchResults {
  readonly users: readonly {
    id: string; displayName: string | null; organizationName: string | null; email: string; phone: string | null;
    configurationCount: number; enquiryCount: number;
  }[];
  readonly guestLeads: readonly {
    id: string; email: string; phone: string | null; name: string | null; enquiryCount: number; convertedToUserId: string | null;
  }[];
  readonly configurations: readonly {
    id: string; name: string; spaceName: string | null; userName: string | null; createdAt: Date;
  }[];
  readonly contacts: readonly {
    id: string; name: string; email: string; phone: string | null; accountName: string | null;
  }[];
  readonly accounts: readonly { id: string; name: string; accountType: string; primaryContactId: string | null }[];
  readonly deals: readonly {
    id: string; title: string; stage: string; preferredDate: string | null; guestCount: number | null; contactName: string | null;
  }[];
  readonly proposals: readonly {
    id: string; title: string; status: string; currentVersion: number; opportunityId: string | null; sentAt: Date | null;
  }[];
}

export async function searchClients(db: Database, query: string, scope: ClientSearchScope): Promise<ClientSearchResults> {
  const match = matcher(query);
  const { venueId } = scope;
  const inVenue = (column: AnyPgColumn): SQL | undefined => (venueId === null ? undefined : eq(column, venueId));

  // People who have a layout or an enquiry at this venue.
  const userName = sql`COALESCE(${users.displayName}, ${users.name})`;
  const venueUsers = venueId === null ? undefined : sql`(
    EXISTS (SELECT 1 FROM configurations WHERE user_id = ${users.id} AND venue_id = ${venueId} AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM enquiries WHERE user_id = ${users.id} AND venue_id = ${venueId})
  )`;
  const usersQuery = db.select({
    id: users.id,
    displayName: users.displayName,
    organizationName: users.organizationName,
    email: users.email,
    phone: users.phone,
    configurationCount: venueId === null
      ? sql<number>`(SELECT count(*)::int FROM configurations WHERE user_id = ${users.id} AND deleted_at IS NULL)`
      : sql<number>`(SELECT count(*)::int FROM configurations WHERE user_id = ${users.id} AND venue_id = ${venueId} AND deleted_at IS NULL)`,
    enquiryCount: venueId === null
      ? sql<number>`(SELECT count(*)::int FROM enquiries WHERE user_id = ${users.id})`
      : sql<number>`(SELECT count(*)::int FROM enquiries WHERE user_id = ${users.id} AND venue_id = ${venueId})`,
  })
    .from(users)
    .where(and(match.where(userName, users.organizationName, users.email), venueUsers))
    .orderBy(desc(match.rank(userName, users.organizationName, users.email)), users.email)
    .limit(LIMIT);

  // A lead is found through its enquiries here; its guest email is permanent,
  // so a lead whose layout was later claimed is still found.
  const venueLeads = venueId === null
    ? undefined
    : sql`EXISTS (SELECT 1 FROM enquiries WHERE guest_email = ${guestLeads.email} AND venue_id = ${venueId})`;
  const leadsQuery = db.select({
    id: guestLeads.id,
    email: guestLeads.email,
    phone: guestLeads.phone,
    name: guestLeads.name,
    enquiryCount: venueId === null
      ? sql<number>`(SELECT count(*)::int FROM enquiries WHERE guest_email = ${guestLeads.email})`
      : sql<number>`(SELECT count(*)::int FROM enquiries WHERE guest_email = ${guestLeads.email} AND venue_id = ${venueId})`,
    convertedToUserId: guestLeads.convertedToUserId,
  })
    .from(guestLeads)
    .where(and(match.where(guestLeads.name, guestLeads.email), venueLeads))
    .orderBy(desc(match.rank(guestLeads.name, guestLeads.email)), guestLeads.email)
    .limit(LIMIT);

  const configurationsQuery = db.select({
    id: configurations.id,
    name: configurations.name,
    spaceName: spaces.name,
    userName: sql<string | null>`(SELECT name FROM users WHERE id = ${configurations.userId})`,
    createdAt: configurations.createdAt,
  })
    .from(configurations)
    .leftJoin(spaces, eq(spaces.id, configurations.spaceId))
    .where(and(match.where(configurations.name), isNull(configurations.deletedAt), inVenue(configurations.venueId)))
    .orderBy(desc(match.rank(configurations.name)), desc(configurations.createdAt))
    .limit(LIMIT);

  const [foundUsers, foundLeads, foundConfigurations] = await Promise.all([usersQuery, leadsQuery, configurationsQuery]);
  if (!scope.commercial) {
    return {
      users: foundUsers, guestLeads: foundLeads, configurations: foundConfigurations,
      contacts: [], accounts: [], deals: [], proposals: [],
    };
  }

  const contactsQuery = db.select({
    id: contacts.id,
    name: contacts.name,
    email: contacts.email,
    phone: contacts.phone,
    accountName: clientAccounts.name,
  })
    .from(contacts)
    .leftJoin(clientAccounts, and(eq(clientAccounts.id, contacts.clientAccountId), isNull(clientAccounts.deletedAt)))
    .where(and(match.where(contacts.name, contacts.email), isNull(contacts.deletedAt), inVenue(contacts.venueId)))
    .orderBy(desc(match.rank(contacts.name, contacts.email)), contacts.name)
    .limit(LIMIT);

  const accountsQuery = db.select({
    id: clientAccounts.id,
    name: clientAccounts.name,
    accountType: clientAccounts.accountType,
    primaryContactId: clientAccounts.primaryContactId,
  })
    .from(clientAccounts)
    .where(and(match.where(clientAccounts.name), isNull(clientAccounts.deletedAt), inVenue(clientAccounts.venueId)))
    .orderBy(desc(match.rank(clientAccounts.name)), clientAccounts.name)
    .limit(LIMIT);

  // A deal is found by its title, or by the name of its client.
  const dealsQuery = db.select({
    id: opportunities.id,
    title: opportunities.title,
    stage: opportunities.stage,
    preferredDate: opportunities.preferredDate,
    guestCount: opportunities.guestCount,
    contactName: contacts.name,
  })
    .from(opportunities)
    .leftJoin(contacts, and(eq(contacts.id, opportunities.primaryContactId), isNull(contacts.deletedAt)))
    .where(and(
      or(match.where(opportunities.title), match.where(sql`COALESCE(${contacts.name}, '')`)),
      isNull(opportunities.deletedAt),
      inVenue(opportunities.venueId),
    ))
    .orderBy(desc(match.rank(opportunities.title, sql`COALESCE(${contacts.name}, '')`)), desc(opportunities.updatedAt))
    .limit(LIMIT);

  const proposalsQuery = db.select({
    id: proposals.id,
    title: proposals.title,
    status: proposals.status,
    currentVersion: proposals.currentVersion,
    opportunityId: proposals.opportunityId,
    sentAt: proposals.sentAt,
  })
    .from(proposals)
    .where(and(match.where(proposals.title), isNull(proposals.deletedAt), inVenue(proposals.venueId)))
    .orderBy(desc(match.rank(proposals.title)), desc(proposals.updatedAt))
    .limit(LIMIT);

  const [foundContacts, foundAccounts, foundDeals, foundProposals] = await Promise.all([
    contactsQuery, accountsQuery, dealsQuery, proposalsQuery,
  ]);
  return {
    users: foundUsers, guestLeads: foundLeads, configurations: foundConfigurations,
    contacts: foundContacts, accounts: foundAccounts, deals: foundDeals, proposals: foundProposals,
  };
}

// ---------------------------------------------------------------------------
// A contact's profile: who they are, their organisation, their deals and the
// proposals on them. The commercial record, so the commercial roles only; a
// contact at another venue is answered as not found, never as forbidden.
// ---------------------------------------------------------------------------

export interface ContactProfile {
  readonly contact: {
    id: string; venueId: string; name: string; email: string; phone: string | null; roleLabel: string | null;
    sourceEnquiryId: string | null; createdAt: Date;
    account: { id: string; name: string } | null;
  };
  readonly deals: readonly {
    id: string; title: string; stage: string; preferredDate: string | null; guestCount: number | null;
    estimatedValueMinor: number; currency: string; updatedAt: Date;
  }[];
  readonly proposals: readonly {
    id: string; opportunityId: string | null; title: string; status: string; currentVersion: number; sentAt: Date | null;
  }[];
}

export async function contactProfile(db: Database, contactId: string, venueId: string | null): Promise<ContactProfile | null> {
  const [row] = await db.select({
    id: contacts.id,
    venueId: contacts.venueId,
    name: contacts.name,
    email: contacts.email,
    phone: contacts.phone,
    roleLabel: contacts.roleLabel,
    sourceEnquiryId: contacts.sourceEnquiryId,
    createdAt: contacts.createdAt,
    accountId: clientAccounts.id,
    accountName: clientAccounts.name,
  })
    .from(contacts)
    .leftJoin(clientAccounts, and(eq(clientAccounts.id, contacts.clientAccountId), isNull(clientAccounts.deletedAt)))
    .where(and(eq(contacts.id, contactId), isNull(contacts.deletedAt), venueId === null ? undefined : eq(contacts.venueId, venueId)))
    .limit(1);
  if (row === undefined) return null;
  const deals = await db.select({
    id: opportunities.id,
    title: opportunities.title,
    stage: opportunities.stage,
    preferredDate: opportunities.preferredDate,
    guestCount: opportunities.guestCount,
    estimatedValueMinor: opportunities.estimatedValueMinor,
    currency: opportunities.currency,
    updatedAt: opportunities.updatedAt,
  })
    .from(opportunities)
    .where(and(eq(opportunities.primaryContactId, row.id), eq(opportunities.venueId, row.venueId), isNull(opportunities.deletedAt)))
    .orderBy(desc(opportunities.updatedAt));
  const dealIds = deals.map((deal) => deal.id);
  const dealProposals = dealIds.length === 0 ? [] : await db.select({
    id: proposals.id,
    opportunityId: proposals.opportunityId,
    title: proposals.title,
    status: proposals.status,
    currentVersion: proposals.currentVersion,
    sentAt: proposals.sentAt,
  })
    .from(proposals)
    .where(and(inArray(proposals.opportunityId, dealIds), eq(proposals.venueId, row.venueId), isNull(proposals.deletedAt)))
    .orderBy(desc(proposals.updatedAt));
  const { accountId, accountName, ...contact } = row;
  return {
    contact: { ...contact, account: accountId === null || accountName === null ? null : { id: accountId, name: accountName } },
    deals,
    proposals: dealProposals,
  };
}
