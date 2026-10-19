import { and, eq, sql } from "drizzle-orm";
import { isUsablePhone, normaliseEmail, type ContactPointInput } from "@omnitwin/types";
import { accountMemberships, clientAccounts, contactPoints, contacts, enquiries } from "../db/schema.js";
import { insertOrganisation, lockOrganisation, type OrganisationRow } from "./people-organisations.js";
import {
  adoptLegacyMirror,
  insertPerson,
  liveAccount,
  liveContact,
  lockPerson,
  refreshContactMirror,
  type PeopleTx,
} from "./people-records.js";

// ---------------------------------------------------------------------------
// An enquiry and its person (T-665).
//
// An enquiry belongs to the venue's one live person who holds its email,
// however it was typed. Nobody holding it makes a new person from the
// enquiry. Two people holding it (a couple, the wedding norm) is a choice
// nobody may make for them: a public enquiry links neither and makes no
// third, while a colleague working the enquiry ("Create opportunity", Task
// 10) gets a new person rather than one of the two chosen at random.
//
// Every writer that finds or makes a person by email takes the advisory lock
// for the venue and the normalised email first, then looks, so two enquiries
// from one new email make one person. It is the first lock on the People Book
// in the transaction: then the one person found, FOR UPDATE, then the
// enquiry that points at them.
//
// The public enquiry route inserts its enquiry before this lock is taken.
// That is safe only because the new row is invisible to every other
// transaction until commit, so no one can wait on it; it is not a precedent
// for taking a row lock before an advisory lock. The route runs this function
// in a savepoint: should it throw, the savepoint is rolled back and the
// transaction-level advisory lock taken inside it is released with it, which
// is safe, because nothing the lock guarded was written.
//
// "Create opportunity" (routes/crm.ts from-enquiry) works an enquiry a
// colleague has chosen. Its deal is with the person the enquiry is linked to
// while they are live, else the person found or made by its email as above;
// and joins that person's primary organisation, else a household made for
// them. Its locks, in order: the route's crm-from-enquiry lock; this email
// lock, which ensureEnquiryPerson takes before locking anyone, even when the
// link answers, so falling back to the email never takes an advisory lock
// after a row lock; the person; the enquiry; then the organisation the deal
// joins. An organisation is only ever locked after its person here, never
// before.
// ---------------------------------------------------------------------------

/** The lock every writer that finds or makes a person by their email takes. */
export function personEmailLockKey(venueId: string, normalisedEmail: string): string {
  return `people-email:${venueId}:${normalisedEmail}`;
}

export type EnquiryForLink = {
  id: string;
  venueId: string;
  contactId: string | null;
  email: string;
  name: string | null;
  phone: string | null;
};

export type LinkOutcome =
  | { outcome: "linked" | "created"; contactId: string }
  | { outcome: "ambiguous"; contactId: null };

const AMBIGUOUS: LinkOutcome = { outcome: "ambiguous", contactId: null };

// The columns a new person's details land in: contact_points.value and
// display_value, contacts.name and contacts.phone. Like the backfill (0096), an
// email that does not fit is left out rather than cut short, a phone that does
// not fit is not kept, and a name is cut to fit.
const POINT_MAX = 255;
const NAME_MAX = 200;
const PHONE_MAX = 50;

/** The enquiry's email as a point's value, or null when it cannot be one
 *  (nothing left once trimmed, or too long to keep). */
function emailKeyOf(enquiry: EnquiryForLink): string | null {
  const key = normaliseEmail(enquiry.email);
  if (key === null || key.length > POINT_MAX || enquiry.email.trim().length > POINT_MAX) return null;
  return key;
}

/** Takes the email's lock for the transaction (a second take by the same
 *  transaction returns at once). */
async function lockEmail(tx: PeopleTx, venueId: string, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${personEmailLockKey(venueId, key)}, 0))`);
}

/** At most two of the venue's live people who hold the email, lowest id first. */
async function emailHolders(tx: PeopleTx, venueId: string, key: string): Promise<string[]> {
  const rows = await tx.selectDistinct({ id: contactPoints.contactId }).from(contactPoints)
    .innerJoin(contacts, and(eq(contacts.id, contactPoints.contactId), eq(contacts.venueId, contactPoints.venueId)))
    .where(and(eq(contactPoints.venueId, venueId), eq(contactPoints.kind, "email"), eq(contactPoints.value, key), liveContact()))
    .orderBy(contactPoints.contactId)
    .limit(2);
  return rows.map((row) => row.id);
}

/** Points the enquiry at its person; it must be the enquiry at that venue. */
async function pointEnquiryAt(tx: PeopleTx, enquiry: EnquiryForLink, contactId: string): Promise<void> {
  const linked = await tx.update(enquiries).set({ contactId })
    .where(and(eq(enquiries.id, enquiry.id), eq(enquiries.venueId, enquiry.venueId)))
    .returning({ id: enquiries.id });
  if (linked.length !== 1) throw new Error("The enquiry to link is not at its venue");
}

/** The name a new person is made with: the guest's own, else their email. */
function nameOf(enquiry: EnquiryForLink): string {
  const given = enquiry.name?.trim() ?? "";
  return (given === "" ? enquiry.email.trim() : given).slice(0, NAME_MAX);
}

/** A new person from the enquiry, the enquiry pointed at them; their id. The
 *  email is their primary point unless it cannot be one. */
async function makePerson(tx: PeopleTx, enquiry: EnquiryForLink, ownerUserId: string | null, keepEmail: boolean): Promise<string> {
  const points: ContactPointInput[] = keepEmail
    ? [{ kind: "email", value: enquiry.email, label: "other", isPrimary: true }]
    : [];
  const phone = enquiry.phone?.trim() ?? "";
  if (phone !== "" && phone.length <= PHONE_MAX && isUsablePhone(phone)) {
    points.push({ kind: "phone", value: phone, label: "other", isPrimary: true });
  }
  const contactId = await insertPerson(tx, {
    venueId: enquiry.venueId,
    name: nameOf(enquiry),
    ownerUserId,
    sourceEnquiryId: enquiry.id,
    lastContactAt: new Date(),
    contactPoints: points,
  });
  await pointEnquiryAt(tx, enquiry, contactId);
  return contactId;
}

/**
 * Links the enquiry to the venue's one live person who holds its email, or
 * makes them from it when nobody does. When two people hold it, "leave"
 * links neither and writes nothing; "create" makes a new person. A person
 * merged away between the look and the lock has had their points moved to
 * the survivor, so the look is taken once more. Linking writes no point or
 * membership: it moves the person's last contact forward and nothing else,
 * so their mirrors stand as they are.
 */
export async function linkEnquiryToPerson(
  tx: PeopleTx,
  enquiry: EnquiryForLink,
  options: { ownerUserId: string | null; whenShared: "leave" | "create" },
): Promise<LinkOutcome> {
  const key = emailKeyOf(enquiry);
  if (key === null) return AMBIGUOUS;
  await lockEmail(tx, enquiry.venueId, key);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found = await emailHolders(tx, enquiry.venueId, key);
    const holder = found[0];
    if (holder === undefined) {
      return { outcome: "created", contactId: await makePerson(tx, enquiry, options.ownerUserId, true) };
    }
    if (found.length > 1) {
      return options.whenShared === "leave"
        ? AMBIGUOUS
        : { outcome: "created", contactId: await makePerson(tx, enquiry, options.ownerUserId, true) };
    }
    const locked = await lockPerson(tx, enquiry.venueId, holder);
    if (locked.state !== "live") continue;
    await pointEnquiryAt(tx, enquiry, holder);
    await tx.update(contacts).set({ lastContactAt: sql`GREATEST(${contacts.lastContactAt}, now())` })
      .where(and(eq(contacts.id, holder), eq(contacts.venueId, enquiry.venueId)));
    return { outcome: "linked", contactId: holder };
  }
  return AMBIGUOUS;
}

/**
 * The person "Create opportunity" makes a deal with, locked and live: the one
 * the enquiry is linked to while they are live at its venue; otherwise the
 * one linkEnquiryToPerson finds or makes by the enquiry's email, a new person
 * when two people share it; or, when the email cannot be a point, a new
 * person without it. The email's lock comes first, before anyone is locked.
 * A linked person who is no longer live keeps the row lock taken to find
 * that out; nothing is written to them.
 */
export async function ensureEnquiryPerson(
  tx: PeopleTx,
  enquiry: EnquiryForLink,
  ownerUserId: string | null,
): Promise<{ contactId: string; created: boolean }> {
  const key = emailKeyOf(enquiry);
  if (key !== null) await lockEmail(tx, enquiry.venueId, key);

  if (enquiry.contactId !== null) {
    const linked = await lockPerson(tx, enquiry.venueId, enquiry.contactId);
    if (linked.state === "live") return { contactId: linked.row.id, created: false };
  }
  if (key === null) return { contactId: await makePerson(tx, enquiry, ownerUserId, false), created: true };

  const outcome = await linkEnquiryToPerson(tx, enquiry, { ownerUserId, whenShared: "create" });
  // With "create" and a usable email, only a holder merged away twice between
  // the look and the lock answers ambiguous; the press can be made again.
  if (outcome.outcome === "ambiguous") throw new Error("The enquiry's person was merged away while being found");
  return { contactId: outcome.contactId, created: outcome.outcome === "created" };
}

/** The person's primary membership's organisation, while it is live. */
async function primaryAccountId(tx: PeopleTx, person: { id: string; venueId: string }): Promise<string | undefined> {
  const [row] = await tx.select({ id: clientAccounts.id }).from(accountMemberships)
    .innerJoin(clientAccounts, and(
      eq(clientAccounts.id, accountMemberships.clientAccountId),
      eq(clientAccounts.venueId, accountMemberships.venueId),
    ))
    .where(and(
      eq(accountMemberships.contactId, person.id),
      eq(accountMemberships.venueId, person.venueId),
      eq(accountMemberships.isPrimary, true),
      liveAccount(),
    ))
    .limit(1);
  return row?.id;
}

/** A new household named after the person, who is its primary contact and
 *  joins it as their primary membership; then their mirrors. */
async function joinNewHousehold(
  tx: PeopleTx,
  person: { id: string; venueId: string; name: string },
  input: { sourceEnquiryId: string; createdBy: string; ownerUserId: string | null },
): Promise<OrganisationRow> {
  const accountId = await insertOrganisation(tx, {
    venueId: person.venueId,
    name: person.name,
    kind: "household",
    ownerUserId: input.ownerUserId,
    createdBy: input.createdBy,
    primaryContactId: person.id,
    sourceEnquiryId: input.sourceEnquiryId,
  });
  // The person holds no primary membership now (the refresh before the look
  // found no live organisation to promote), so this one can be primary.
  // Target-less, as the other People Book writes; an insert that wrote
  // nothing is an error, never a household nobody belongs to.
  const [membership] = await tx.insert(accountMemberships).values({
    venueId: person.venueId,
    contactId: person.id,
    clientAccountId: accountId,
    isPrimary: true,
    createdAt: sql`clock_timestamp()`,
    updatedAt: sql`clock_timestamp()`,
  }).onConflictDoNothing().returning({ id: accountMemberships.id });
  if (membership === undefined) throw new Error("The household's membership was not written");
  await refreshContactMirror(tx, person.id);
  const account = await lockOrganisation(tx, person.venueId, accountId);
  if (account === undefined) throw new Error("The new household could not be read back");
  return account;
}

/**
 * The organisation a deal with this person joins: their primary membership's
 * live organisation, or else a new household named after them (account type
 * event_client, the person its primary contact) that becomes their primary
 * membership. The person must be locked and live (ensureEnquiryPerson); they
 * are taken again here for their row. What an older writer left on them is
 * adopted first, so someone the create-from-enquiry before T-665 wrote, with
 * an account but no membership, joins that account rather than a new one;
 * then their mirrors are rewritten. The organisation is locked after the
 * person, so it stays live until the deal is written.
 */
export async function ensurePrimaryAccount(
  tx: PeopleTx,
  person: { id: string; venueId: string; name: string },
  input: { sourceEnquiryId: string; createdBy: string; ownerUserId: string | null },
): Promise<{ account: OrganisationRow; created: boolean }> {
  const locked = await lockPerson(tx, person.venueId, person.id);
  if (locked.state !== "live") throw new Error("The person a deal joins must be live");
  await adoptLegacyMirror(tx, locked.row);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Settles the primaries before the look: a primary membership whose
    // organisation has closed stops being primary, and the oldest live one
    // takes its place.
    await refreshContactMirror(tx, person.id);
    const accountId = await primaryAccountId(tx, person);
    if (accountId === undefined) return { account: await joinNewHousehold(tx, person, input), created: true };
    const account = await lockOrganisation(tx, person.venueId, accountId);
    if (account !== undefined) return { account, created: false };
    // Closed between the look and the lock: settle and look once more.
  }
  throw new Error("The person's organisation closed while the deal was being made");
}
