import type { FastifyBaseLogger } from "fastify";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  holdPromotionActionPath,
  PromotionDraftSchema,
  toEventPlanAudienceRole,
  type EventPlanAudienceRole,
  type PromotionDraft,
  type PromotionDraftRecipientSource,
} from "@omnitwin/types";
import {
  bookings,
  clientAccounts,
  contacts,
  enquiries,
  eventPlanNotifications,
  events,
  spaces,
  users,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import type { JwtUser } from "../middleware/auth.js";
import { emit } from "../observability/event-bus.js";
import { canManageCommercial } from "../utils/query.js";
import { userDisplayName } from "../utils/user-display-name.js";
import { formatVenueDay } from "./hold-reminders.js";

// ---------------------------------------------------------------------------
// The 2nd option moves up (Blake, 26 September 2026; fix-first item 8).
//
// "When a 1st option lapses or is released and the 2nd moves up, the 2nd
// option's owner is told in the app and given a drafted email to their client
// to review and send. Nothing is sent automatically."
//
// writePromotionNotices runs INSIDE the transaction that resequences the
// ladder (booking-mutations.ts), so the new 1st option and the notice that
// says so commit or vanish together. It covers every exit that resequences:
// released, expired (lapsed) and lost.
//
// The notice goes to the hold's owner by name. Owners who do not write the
// Diary (sales, manager: DIARY_WRITE_ROLES is staff and admin) are told who in
// the office will confirm or release it: the person who just moved the
// ladder, who is by construction someone who writes the Diary. A hold with
// no owner, or an owner who has left the venue, goes to the office as a whole
// so it is not left with nobody.
//
// The drafted email is composed when it is read, from the hold as it stands
// then, and is addressed to the client contact of record: the event's client
// account's main contact, otherwise the person who made the enquiry. No
// address is copied into the notification itself.
// ---------------------------------------------------------------------------

type Conn = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type HoldExit = "released" | "expired" | "lost";

/** A survivor of the ladder that has just become 1st option. */
export interface PromotedHoldForNotice {
  readonly id: string;
  readonly title: string;
  readonly ownerUserId: string | null;
  readonly jointFlag: boolean;
  readonly startsAt: Date;
}

/** What the transport announces after commit (notification.created). */
export interface PromotionNotice {
  readonly bookingId: string;
  readonly venueId: string;
  readonly notificationIds: readonly string[];
  readonly recipientUserIds: readonly string[];
  readonly audienceRoles: readonly EventPlanAudienceRole[];
  readonly title: string;
}

/** The roles that write the Diary, passed in by booking-mutations.ts (which
 *  owns DIARY_WRITE_ROLES) so this module does not import it back. */
export interface PromotionNoticeRoles {
  readonly diaryWriteRoles: ReadonlySet<string>;
  readonly holdOwnerRoles: ReadonlySet<string>;
}

/** A hold that became 1st option, as the ladder held it before the exit. */
export interface PromotedLadderHold {
  readonly id: string;
  readonly rank: number | null;
  readonly jointFlag: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * The promoted holds that now share 1st option with another. Joint holds move
 * up together: same original rank, both joint-flagged, contesting the same
 * time. One exit can promote two separate slots (the departed hold bridged
 * them), so a joint flag on each is not enough; they must overlap.
 */
export function jointlyPromoted(promoted: readonly PromotedLadderHold[]): ReadonlySet<string> {
  const joint = new Set<string>();
  for (const hold of promoted) {
    if (!hold.jointFlag || hold.rank === null) continue;
    const partner = promoted.some((other) => other.id !== hold.id
      && other.jointFlag
      && other.rank === hold.rank
      && other.startsAt.getTime() < hold.endsAt.getTime()
      && hold.startsAt.getTime() < other.endsAt.getTime());
    if (partner) joint.add(hold.id);
  }
  return joint;
}

const EXIT_WORDS: Readonly<Record<HoldExit, string>> = {
  released: "released",
  expired: "marked as lapsed",
  lost: "marked as lost",
};

const OFFICE_FALLBACK = "the office (a member of staff or an administrator)";

export interface PromotionNoticeText {
  readonly title: string;
  readonly body: string;
}

/** The notice's words. Pure: the tests pin the copy. */
export function composePromotionNotice(input: {
  readonly holdTitle: string;
  readonly spaceName: string;
  readonly venueDay: string;
  readonly joint: boolean;
  readonly exit: HoldExit;
  readonly movedBy: string | null;
  /** Who in the office confirms or releases it: null when the reader writes
   *  the Diary themselves. */
  readonly officeContact: string | null;
  readonly owned: boolean;
}): PromotionNoticeText {
  const position = input.joint ? "Joint 1st option" : "1st option";
  const title = input.owned
    ? `Now ${input.joint ? "joint 1st option" : "1st option"}: ${input.venueDay}, ${input.spaceName}`
    : `${position}, no owner: ${input.venueDay}, ${input.spaceName}`;
  const by = input.movedBy === null ? "" : ` by ${input.movedBy}`;
  const sentences = [
    `${input.holdTitle} has moved up. The hold ahead of it was ${EXIT_WORDS[input.exit]}${by}.`,
  ];
  if (input.owned) {
    sentences.push("A drafted email to your client is ready for you to read, change and send from your own email. Nothing has been sent.");
    if (input.officeContact !== null) {
      const office = input.officeContact === OFFICE_FALLBACK ? OFFICE_FALLBACK : `${input.officeContact} in the office`;
      sentences.push(`When the client answers, ${office} will confirm or release the hold.`);
    }
  } else {
    sentences.push("Nobody owns this hold now. Give it an owner in the Diary so the client hears from someone; a drafted email is ready. Nothing has been sent.");
  }
  return { title, body: sentences.join(" ") };
}

function bounded(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Venue-local calendar day, YYYY-MM-DD, for the Diary's goto. */
function londonDay(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London",
  }).formatToParts(instant);
  const part = (type: "year" | "month" | "day"): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Write one notice per hold that became 1st option, in the caller's
 * transaction. Returns what to announce once it commits.
 */
export async function writePromotionNotices(
  conn: Conn,
  input: {
    readonly venueId: string;
    readonly spaceId: string;
    readonly exit: HoldExit;
    readonly actorUserId: string;
    readonly promoted: readonly PromotedHoldForNotice[];
    readonly roles: PromotionNoticeRoles;
  },
): Promise<readonly PromotionNotice[]> {
  if (input.promoted.length === 0) return [];

  const [space] = await conn.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, input.spaceId)).limit(1);
  const spaceName = space?.name ?? "the room";

  const people = [...new Set([input.actorUserId, ...input.promoted.flatMap((hold) => hold.ownerUserId ?? [])])];
  const rows = await conn
    .select({ id: users.id, role: users.role, venueId: users.venueId, name: userDisplayName })
    .from(users)
    .where(inArray(users.id, people));
  const byId = new Map(rows.map((row) => [row.id, row]));

  const actor = byId.get(input.actorUserId);
  const movedBy = actor?.name ?? null;
  const actorIsOffice = actor !== undefined && actor.venueId === input.venueId
    && input.roles.diaryWriteRoles.has(actor.role);
  const officeContact = actorIsOffice && actor.name !== null ? actor.name : OFFICE_FALLBACK;

  const notices: PromotionNotice[] = [];
  for (const hold of input.promoted) {
    const owner = hold.ownerUserId === null ? undefined : byId.get(hold.ownerUserId);
    const ownerWorksHere = owner !== undefined && owner.venueId === input.venueId
      && input.roles.holdOwnerRoles.has(owner.role);
    const text = composePromotionNotice({
      holdTitle: hold.title,
      spaceName,
      venueDay: formatVenueDay(hold.startsAt),
      joint: hold.jointFlag,
      exit: input.exit,
      movedBy,
      officeContact: ownerWorksHere && !input.roles.diaryWriteRoles.has(owner.role) ? officeContact : null,
      owned: ownerWorksHere,
    });
    const actionPath = holdPromotionActionPath(londonDay(hold.startsAt), hold.id);

    const audience: { role: EventPlanAudienceRole; recipient: string | null }[] = ownerWorksHere
      ? [{ role: toEventPlanAudienceRole(owner.role), recipient: owner.id }]
      : [...input.roles.diaryWriteRoles].map((role) => ({ role: toEventPlanAudienceRole(role), recipient: null }));

    const written = await conn.insert(eventPlanNotifications).values(audience.map((entry) => ({
      changeId: null,
      eventId: null,
      venueId: input.venueId,
      audienceRole: entry.role,
      recipientUserId: entry.recipient,
      title: bounded(text.title, 180),
      body: bounded(text.body, 1000),
      severity: "attention" as const,
      actionPath,
    }))).returning({ id: eventPlanNotifications.id });

    notices.push({
      bookingId: hold.id,
      venueId: input.venueId,
      notificationIds: written.map((row) => row.id),
      recipientUserIds: audience.flatMap((entry) => entry.recipient ?? []),
      audienceRoles: audience.flatMap((entry) => entry.recipient === null ? [entry.role] : []),
      title: bounded(text.title, 180),
    });
  }
  return notices;
}

/** After commit: the bell on the owner's (or the office's) nav moves now,
 *  not on their next navigation. Both transports call this. */
export function announcePromotionNotices(
  log: FastifyBaseLogger,
  notices: readonly PromotionNotice[] | undefined,
): void {
  if (notices === undefined) return;
  const at = new Date().toISOString();
  for (const notice of notices) {
    if (notice.notificationIds.length === 0) continue;
    emit(log, "notification.created", {
      venueId: notice.venueId,
      audienceRoles: notice.audienceRoles,
      recipientUserIds: notice.recipientUserIds,
      notificationIds: notice.notificationIds,
      title: notice.title,
      severity: "attention",
      at,
    });
  }
}

// --- the drafted email -----------------------------------------------------

function firstName(fullName: string): string | null {
  const first = fullName.trim().split(/\s+/u)[0];
  return first === undefined || first.length === 0 ? null : first;
}

function roomPhrase(spaceName: string): string {
  return /^the\s/iu.test(spaceName) ? spaceName : `the ${spaceName}`;
}

/** The email's words. Pure: the tests pin the copy. Plain and factual, in the
 *  venue's vocabulary; the person sending it can change anything. */
export function composePromotionDraft(input: {
  readonly contactName: string | null;
  readonly spaceName: string;
  readonly venueName: string;
  readonly venueDay: string;
  readonly joint: boolean;
  /** Only a decision date still ahead is offered to the client. */
  readonly decisionDay: string | null;
  readonly senderName: string | null;
}): { readonly subject: string; readonly body: string } {
  const greetingName = input.contactName === null ? null : firstName(input.contactName);
  const position = input.joint ? "joint 1st option" : "1st option";
  const lines = [
    greetingName === null ? "Hello," : `Dear ${greetingName},`,
    "",
    `Your provisional booking of ${roomPhrase(input.spaceName)} on ${input.venueDay} is now ${position}.`,
    "",
    input.decisionDay === null
      ? "Please let me know whether you would like to confirm, and I will take you through the next steps."
      : `I can hold the date for you until ${input.decisionDay}. Please let me know by then whether you would like to confirm.`,
    "",
    "If your plans have changed, a short reply is enough and I will release the date.",
    "",
    "Kind regards,",
    "",
    ...(input.senderName === null ? [] : [input.senderName]),
    input.venueName,
  ];
  return {
    subject: `Your date at ${input.venueName}: ${input.venueDay}, ${input.spaceName}`,
    body: lines.join("\n"),
  };
}

export type PromotionDraftResult =
  | { readonly ok: true; readonly draft: PromotionDraft }
  | { readonly ok: false; readonly status: 403 | 404 | 409; readonly code: string; readonly error: string };

/** The client contact of record for a hold: the event's client account's
 *  main contact, else the enquirer. A main contact with no email (the People
 *  Book, 0098, lets a person have none) cannot be written to, so the enquirer
 *  is asked instead. */
async function recipientFor(
  db: Database,
  hold: { readonly eventId: string | null; readonly enquiryId: string | null; readonly venueId: string },
): Promise<{ name: string; email: string; source: PromotionDraftRecipientSource } | null> {
  if (hold.eventId !== null) {
    const [contact] = await db
      .select({ name: contacts.name, email: contacts.email })
      .from(events)
      .innerJoin(clientAccounts, and(eq(clientAccounts.id, events.clientAccountId), isNull(clientAccounts.deletedAt)))
      .innerJoin(contacts, and(eq(contacts.id, clientAccounts.primaryContactId), isNull(contacts.deletedAt)))
      .where(and(eq(events.id, hold.eventId), eq(events.venueId, hold.venueId)))
      .limit(1);
    if (contact !== undefined && contact.email !== null) {
      return { name: contact.name, email: contact.email, source: "client_contact" };
    }
  }
  if (hold.enquiryId !== null) {
    const [enquiry] = await db
      .select({ name: enquiries.name, email: enquiries.email })
      .from(enquiries)
      .where(and(eq(enquiries.id, hold.enquiryId), eq(enquiries.venueId, hold.venueId)))
      .limit(1);
    if (enquiry !== undefined) return { ...enquiry, source: "enquiry" };
  }
  return null;
}

/**
 * The drafted email for a hold that is 1st option now. Read by the people
 * who work the pipeline at the hold's venue; composed from the hold as it
 * stands, so a hold that has since moved on says so instead.
 */
export async function loadPromotionDraft(
  db: Database,
  reader: Pick<JwtUser, "id" | "role" | "venueId" | "platformRole">,
  bookingId: string,
  now: Date = new Date(),
): Promise<PromotionDraftResult> {
  const [hold] = await db
    .select({
      id: bookings.id, venueId: bookings.venueId, kind: bookings.kind, status: bookings.status, rank: bookings.rank,
      jointFlag: bookings.jointFlag, startsAt: bookings.startsAt, decisionAt: bookings.decisionAt,
      eventId: bookings.eventId, enquiryId: bookings.enquiryId, spaceName: spaces.name, venueName: venues.name,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(venues, eq(venues.id, bookings.venueId))
    .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)))
    .limit(1);
  if (hold === undefined) {
    return { ok: false, status: 404, code: "BOOKING_NOT_FOUND", error: "Booking not found" };
  }
  if (!canManageCommercial(reader, hold.venueId)) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
  }
  if (hold.kind !== "hold" || hold.status !== "active" || hold.rank !== 1) {
    return {
      ok: false,
      status: 409,
      code: "NOT_FIRST_OPTION",
      error: "This hold is no longer 1st option, so there is nothing to send. Open it in the Diary to see where it stands.",
    };
  }

  const [sender] = await db.select({ name: userDisplayName }).from(users).where(eq(users.id, reader.id)).limit(1);
  const to = await recipientFor(db, hold);
  const decisionAhead = hold.decisionAt !== null && hold.decisionAt.getTime() > now.getTime();
  const text = composePromotionDraft({
    contactName: to?.name ?? null,
    spaceName: hold.spaceName,
    venueName: hold.venueName,
    venueDay: formatVenueDay(hold.startsAt),
    joint: hold.jointFlag,
    decisionDay: decisionAhead && hold.decisionAt !== null ? formatVenueDay(hold.decisionAt) : null,
    senderName: sender?.name ?? null,
  });
  const recipient = to === null ? null : PromotionDraftSchema.shape.to.safeParse(to);
  const draft = PromotionDraftSchema.parse({
    bookingId: hold.id,
    // An address the schema refuses (a malformed legacy email) is not
    // offered: the reader is told no address is recorded instead.
    to: recipient !== null && recipient.success ? recipient.data : null,
    subject: bounded(text.subject, 300),
    body: bounded(text.body, 4000),
  });
  return { ok: true, draft };
}
