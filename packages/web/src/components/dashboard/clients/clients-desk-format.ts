import { occasionLabel } from "@omnitwin/types";
import type {
  AccountSearchResult, ClientUser, ConfigSearchResult, ContactProfile, ContactSearchResult, DealSearchResult,
  GuestLead, ProposalSearchResult, RecentEnquiry, SearchResults,
} from "../../../api/clients.js";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import { eventDateLong, venueMoment } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// Words and shapes for the Clients desk (roadmap X1).
//
// A client is a signed-in client (user), a guest who enquired (lead), or a
// contact on the commercial record. The desk lists them with the
// organisations, deals, proposals and layouts a search finds, and keeps the
// one open in the address as ?client=<kind>:<id>.
// ---------------------------------------------------------------------------

export type ClientKind = "user" | "lead" | "contact";

export interface ClientRef {
  readonly kind: ClientKind;
  readonly id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KINDS: readonly ClientKind[] = ["user", "lead", "contact"];

/** `?client=contact:<uuid>` as a reference, or null for anything else. */
export function clientRefFromSearchValue(value: string | null): ClientRef | null {
  if (value === null) return null;
  const [kind, id, ...rest] = value.trim().split(":");
  if (rest.length > 0 || id === undefined || !UUID.test(id)) return null;
  const known = KINDS.find((candidate) => candidate === kind);
  return known === undefined ? null : { kind: known, id: id.toLowerCase() };
}

export function clientRefToSearchValue(ref: ClientRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function sameClient(a: ClientRef | null, b: ClientRef | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.id === b.id;
}

/** "AH" for Ailsa Henderson; an email's first letter when that is all there is. */
export function initials(name: string): string {
  const words = name.replace(/@.*/u, "").split(/[\s._-]+/u).filter((word) => /\p{L}/u.test(word));
  const letters = words.length === 1 ? [words[0]?.[0]] : [words[0]?.[0], words.at(-1)?.[0]];
  return letters.filter((letter): letter is string => letter !== undefined).join("").toUpperCase() || "·";
}

const DEAL_STAGE_WORDS: Readonly<Record<string, string>> = {
  new: "New",
  qualified: "Qualified",
  proposal_drafting: "Proposal drafting",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

export function dealStageWords(stage: string): string {
  return DEAL_STAGE_WORDS[stage] ?? "In the pipeline";
}

const PROPOSAL_STATUS_WORDS: Readonly<Record<string, string>> = {
  draft: "Draft",
  sent: "With the client",
  changes_requested: "Changes asked for",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
  archived: "Archived",
};

export function proposalStatusWords(status: string): string {
  return PROPOSAL_STATUS_WORDS[status] ?? "Proposal";
}

const ENQUIRY_STATE_WORDS: Readonly<Record<string, string>> = {
  submitted: "New",
  under_review: "In review",
  approved: "Approved",
  rejected: "Declined",
  withdrawn: "Withdrawn",
  archived: "Done",
};

export function enquiryStateWords(state: string): string {
  return ENQUIRY_STATE_WORDS[state] ?? "Enquiry";
}

// ---------------------------------------------------------------------------
// Rows: what a search, or the list before one, shows
// ---------------------------------------------------------------------------

export type ResultRow =
  | { readonly key: string; readonly kind: "user"; readonly title: string; readonly detail: string; readonly ref: ClientRef }
  | { readonly key: string; readonly kind: "lead"; readonly title: string; readonly detail: string; readonly ref: ClientRef }
  | { readonly key: string; readonly kind: "contact"; readonly title: string; readonly detail: string; readonly ref: ClientRef }
  | { readonly key: string; readonly kind: "account"; readonly title: string; readonly detail: string; readonly ref: ClientRef | null }
  | { readonly key: string; readonly kind: "deal"; readonly title: string; readonly detail: string; readonly id: string; readonly date: string | null }
  | { readonly key: string; readonly kind: "proposal"; readonly title: string; readonly detail: string; readonly id: string; readonly version: number }
  | { readonly key: string; readonly kind: "layout"; readonly title: string; readonly detail: string; readonly id: string }
  | { readonly key: string; readonly kind: "enquiry"; readonly title: string; readonly detail: string; readonly enquiryId: string;
      readonly ref: ClientRef | null; readonly date: string | null; readonly state: string };

export interface ResultGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ResultRow[];
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

function userRow(user: ClientUser): ResultRow {
  const details = [user.organizationName, user.email, plural(user.enquiryCount, "enquiry", "enquiries")];
  return {
    key: `user:${user.id}`, kind: "user", title: user.displayName ?? user.email,
    detail: details.filter((part): part is string => part !== null).join(" · "), ref: { kind: "user", id: user.id },
  };
}

function leadRow(lead: GuestLead): ResultRow {
  const details = [lead.name === null ? null : lead.email, plural(lead.enquiryCount, "enquiry", "enquiries"),
    lead.convertedToUserId === null ? null : "now has an account"];
  return {
    key: `lead:${lead.id}`, kind: "lead", title: lead.name ?? lead.email,
    detail: details.filter((part): part is string => part !== null).join(" · "), ref: { kind: "lead", id: lead.id },
  };
}

function contactRow(contact: ContactSearchResult): ResultRow {
  return {
    key: `contact:${contact.id}`, kind: "contact", title: contact.name,
    detail: [contact.accountName, contact.email].filter((part): part is string => part !== null).join(" · "),
    ref: { kind: "contact", id: contact.id },
  };
}

function accountRow(account: AccountSearchResult): ResultRow {
  return {
    key: `account:${account.id}`, kind: "account", title: account.name,
    detail: account.primaryContactId === null ? "No contact recorded yet" : "Opens on its main contact",
    ref: account.primaryContactId === null ? null : { kind: "contact", id: account.primaryContactId },
  };
}

function dealRow(deal: DealSearchResult): ResultRow {
  const details = [dealStageWords(deal.stage), deal.contactName,
    deal.guestCount === null ? null : plural(deal.guestCount, "guest", "guests")];
  return {
    key: `deal:${deal.id}`, kind: "deal", title: deal.title, id: deal.id, date: deal.preferredDate,
    detail: details.filter((part): part is string => part !== null).join(" · "),
  };
}

function proposalRow(proposal: ProposalSearchResult): ResultRow {
  const sent = proposal.sentAt === null ? null : venueMoment(proposal.sentAt);
  return {
    key: `proposal:${proposal.id}`, kind: "proposal", title: proposal.title, id: proposal.id, version: proposal.currentVersion,
    detail: [proposalStatusWords(proposal.status), sent === null ? null : `sent ${sent}`].filter((part): part is string => part !== null).join(" · "),
  };
}

function layoutRow(layout: ConfigSearchResult): ResultRow {
  return {
    key: `layout:${layout.id}`, kind: "layout", title: layout.name, id: layout.id,
    detail: [layout.spaceName, layout.userName].filter((part): part is string => part !== null).join(" · "),
  };
}

/** A search's findings, grouped as a booker thinks of them: people first. */
export function groupResults(results: SearchResults): ResultGroup[] {
  const groups: ResultGroup[] = [
    { key: "people", label: "People", rows: [...results.contacts.map(contactRow), ...results.users.map(userRow), ...results.guestLeads.map(leadRow)] },
    { key: "organisations", label: "Organisations", rows: results.accounts.map(accountRow) },
    { key: "deals", label: "Deals", rows: results.deals.map(dealRow) },
    { key: "proposals", label: "Proposals", rows: results.proposals.map(proposalRow) },
    { key: "layouts", label: "Layouts", rows: results.configurations.map(layoutRow) },
  ];
  return groups.filter((group) => group.rows.length > 0);
}

function enquiryRow(enquiry: RecentEnquiry): ResultRow {
  const name = enquiry.guestName ?? enquiry.name;
  const ref: ClientRef | null = enquiry.userId !== null ? { kind: "user", id: enquiry.userId }
    : enquiry.leadId !== null ? { kind: "lead", id: enquiry.leadId } : null;
  return {
    key: `enquiry:${enquiry.id}`, kind: "enquiry", title: name, enquiryId: enquiry.id, ref, date: enquiry.preferredDate,
    state: enquiry.state,
    detail: [occasionLabel(enquiry.eventType), enquiry.guestEmail ?? enquiry.email].filter((part): part is string => part !== null).join(" · "),
  };
}

/** Before anything is typed: whose events come next, then who was last in touch. */
export function groupStartingPoints(upcoming: readonly RecentEnquiry[], recent: readonly RecentEnquiry[]): ResultGroup[] {
  const upcomingIds = new Set(upcoming.map((enquiry) => enquiry.id));
  return [
    { key: "upcoming", label: "Coming up", rows: upcoming.map(enquiryRow) },
    { key: "recent", label: "Recently in touch", rows: recent.filter((enquiry) => !upcomingIds.has(enquiry.id)).map(enquiryRow) },
  ].filter((group) => group.rows.length > 0);
}

/** The words a row is read out as. */
export function rowLabel(row: ResultRow): string {
  const kind: Readonly<Record<ResultRow["kind"], string>> = {
    user: "client", lead: "guest", contact: "contact", account: "organisation", deal: "deal", proposal: "proposal",
    layout: "layout, opens in a new tab", enquiry: "enquiry",
  };
  const date = "date" in row ? eventDateLong(row.date) : null;
  return [row.title, kind[row.kind], date, row.detail === "" ? null : row.detail]
    .filter((part): part is string => part !== null).join(", ");
}

// ---------------------------------------------------------------------------
// A contact's lifetime, in a few facts and a timeline
// ---------------------------------------------------------------------------

export interface LifetimeFact {
  readonly value: string;
  readonly label: string;
  /** "words" for a value that is a date or a phrase rather than a count;
   *  "muted" for one that says there is nothing yet. */
  readonly tone?: "words" | "muted";
}

/** Deals, proposals, and what won deals were worth, each currency its own sum. */
export function contactFacts(profile: ContactProfile): LifetimeFact[] {
  const wonByCurrency = new Map<string, number>();
  for (const deal of profile.deals) {
    if (deal.stage === "won") wonByCurrency.set(deal.currency, (wonByCurrency.get(deal.currency) ?? 0) + deal.estimatedValueMinor);
  }
  const won = [...wonByCurrency].map(([currency, minor]) => formatMinorAsCurrency(minor, currency)).join(" + ");
  return [
    { value: profile.deals.length.toLocaleString("en-GB"), label: profile.deals.length === 1 ? "deal" : "deals" },
    { value: profile.proposals.length.toLocaleString("en-GB"), label: profile.proposals.length === 1 ? "proposal" : "proposals" },
    won === "" ? { value: "None yet", label: "won", tone: "muted" } : { value: won, label: "won" },
  ];
}

export interface TimelineMoment {
  readonly key: string;
  readonly at: string;
  readonly sentence: string;
}

/** What happened with this contact, newest first. */
export function contactTimeline(profile: ContactProfile): TimelineMoment[] {
  const moments: TimelineMoment[] = [
    { key: "contact", at: profile.contact.createdAt, sentence: "Became a contact." },
    ...profile.deals.map((deal) => ({
      key: `deal:${deal.id}`, at: deal.updatedAt, sentence: `${deal.title}: ${dealStageWords(deal.stage).toLowerCase()}.`,
    })),
    ...profile.proposals.flatMap((proposal) => proposal.sentAt === null ? [] : [{
      key: `proposal:${proposal.id}`, at: proposal.sentAt,
      sentence: `${proposal.title} sent (version ${proposal.currentVersion.toLocaleString("en-GB")}).`,
    }]),
  ];
  return moments.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
