import { and, eq, sql } from "drizzle-orm";
import { isUsablePhone, normaliseEmail, type ContactPointInput } from "@omnitwin/types";
import { contactPoints, contacts, enquiries } from "../db/schema.js";
import { insertPerson, liveContact, lockPerson, type PeopleTx } from "./people-records.js";

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

async function makePerson(tx: PeopleTx, enquiry: EnquiryForLink, ownerUserId: string | null): Promise<LinkOutcome> {
  const points: ContactPointInput[] = [{ kind: "email", value: enquiry.email, label: "other", isPrimary: true }];
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
  return { outcome: "created", contactId };
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
  const key = normaliseEmail(enquiry.email);
  if (key === null || key.length > POINT_MAX || enquiry.email.trim().length > POINT_MAX) return AMBIGUOUS;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${personEmailLockKey(enquiry.venueId, key)}, 0))`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found = await emailHolders(tx, enquiry.venueId, key);
    const holder = found[0];
    if (holder === undefined) return makePerson(tx, enquiry, options.ownerUserId);
    if (found.length > 1) {
      return options.whenShared === "leave" ? AMBIGUOUS : makePerson(tx, enquiry, options.ownerUserId);
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
