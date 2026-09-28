import { occasionLabel, type ProposalVersionPayload } from "@omnitwin/types";
import type { DeskProposal, ProposalDeskGroup, ProposalHistoryEntry } from "../../../api/proposals.js";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../../../lib/money-input.js";
import { proposalStatusWords } from "../clients/clients-desk-format.js";
import { relativeAge, venueMoment, type SummaryPart } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The Proposals desk's words (roadmap X1): the groups a booker works in, what
// each row says about when it last moved, the opening sentence, where a new
// version starts from and what it changes, and the proposal's history told
// as what happened rather than as status codes.
// ---------------------------------------------------------------------------

export type ProposalFilter = ProposalDeskGroup | "all";

/** Each group's statuses, as the API groups them (GET /proposals/desk). */
export const GROUP_STATUSES: Readonly<Record<ProposalDeskGroup, readonly string[]>> = {
  waiting: ["changes_requested"],
  drafts: ["draft"],
  with_client: ["sent"],
  accepted: ["accepted"],
  closed: ["declined", "withdrawn", "expired", "archived"],
};

export const GROUP_ORDER: readonly ProposalDeskGroup[] = ["waiting", "drafts", "with_client", "accepted", "closed"];

const GROUP_WORDS: Readonly<Record<ProposalDeskGroup, string>> = {
  waiting: "Waiting on you",
  drafts: "Drafts",
  with_client: "With the client",
  accepted: "Accepted",
  closed: "Closed",
};

export function groupWords(group: ProposalDeskGroup): string {
  return GROUP_WORDS[group];
}

export function groupOf(status: string): ProposalDeskGroup {
  return GROUP_ORDER.find((group) => GROUP_STATUSES[group].includes(status)) ?? "closed";
}

/** Copper for what the client sent back, amber for a draft in hand, sage for
 *  accepted, brick for what is closed; with the client is quiet. */
export type ProposalTone = "new" | "review" | "withdrawn" | "approved" | "declined";

const GROUP_TONES: Readonly<Record<ProposalDeskGroup, ProposalTone>> = {
  waiting: "new",
  drafts: "review",
  with_client: "withdrawn",
  accepted: "approved",
  closed: "declined",
};

export function groupTone(group: ProposalDeskGroup): ProposalTone {
  return GROUP_TONES[group];
}

export function proposalTone(status: string): ProposalTone {
  if (status === "declined") return "declined";
  if (status === "withdrawn" || status === "expired" || status === "archived") return "withdrawn";
  return GROUP_TONES[groupOf(status)];
}

export { proposalStatusWords };

export interface ProposalGroup {
  readonly key: ProposalDeskGroup;
  readonly label: string;
  readonly rows: readonly DeskProposal[];
}

/** The rows under their groups, in the order a booker works them, keeping
 *  each group's own order (the API's: most recently changed first). */
export function groupRows(rows: readonly DeskProposal[]): readonly ProposalGroup[] {
  return GROUP_ORDER
    .map((key) => ({ key, label: GROUP_WORDS[key], rows: rows.filter((row) => groupOf(row.status) === key) }))
    .filter((group) => group.rows.length > 0);
}

function money(minor: number, currency: string): string {
  return formatMinorAsCurrency(minor, currency).replace(/\.00$/u, "");
}

/** "Ailsa Henderson · Wedding · 160 guests · £18,400" as its parts. */
export function rowDetails(row: DeskProposal): string[] {
  return [
    row.clientName,
    occasionLabel(row.eventType),
    row.guestCount === null ? null : `${row.guestCount.toLocaleString("en-GB")} ${row.guestCount === 1 ? "guest" : "guests"}`,
    row.latestTotalMinor === null ? null : money(row.latestTotalMinor, row.latestCurrency ?? "GBP"),
  ].filter((part): part is string => part !== null);
}

/** Whether the client's link has been opened since the proposal was last
 *  sent: "opened yesterday", "not opened yet". A link can be opened by anyone
 *  it reaches, so this says the link was opened, never who opened it. */
export function linkOpenedWords(linkOpenedAt: string | null, nowMs: number): string {
  const at = linkOpenedAt ?? null;
  if (at === null) return "not opened yet";
  const age = relativeAge(at, nowMs);
  return age === null ? "opened" : `opened ${age}`;
}

/** The panel's sentence for the same: "The link was last opened Tue 29 Sep,
 *  14:10." With no link made nothing records opens; the older share code
 *  records none. */
export function linkOpenedSentence(linkOpenedAt: string | null, hasLink = true): string {
  if (!hasLink) return "It has no link that records being opened. Issue a new link if the client needs one.";
  const at = (linkOpenedAt ?? null) === null ? null : venueMoment(linkOpenedAt ?? "");
  return at === null ? "The link has not been opened since it was sent." : `The link was last opened ${at}.`;
}

type LayoutFields = Pick<DeskProposal, "configurationId" | "layoutRoomName" | "layoutFromEnquiry">;

/** The layout a proposal carries, as its panel names it: the client's own
 *  from their enquiry and its room, another layout's room, one removed, or
 *  none. Nothing when the API does not say, so nothing untrue is shown. Once
 *  it is with the client, a removed layout is not said: the version they were
 *  sent keeps its drawing. */
export function layoutFact(proposal: LayoutFields, inHand = true): { readonly words: string; readonly muted: boolean } | null {
  if (proposal.layoutRoomName === undefined) return null;
  if (proposal.configurationId === null) return { words: "None", muted: true };
  if (proposal.layoutRoomName === null) return inHand ? { words: "Removed", muted: true } : null;
  return {
    words: proposal.layoutFromEnquiry === true ? `Their own, ${proposal.layoutRoomName}` : proposal.layoutRoomName,
    muted: false,
  };
}

/** What the composer says of the layout a version will carry, only while
 *  there is one to take. It promises no drawing: a layout with nothing
 *  placed has none. Preview shows only a saved version, so it is offered for
 *  this one once it is saved. */
export function composerLayoutLine(proposal: LayoutFields): string | null {
  if (proposal.configurationId === null || proposal.layoutRoomName === undefined || proposal.layoutRoomName === null) return null;
  const whose = proposal.layoutFromEnquiry === true ? "Their layout" : "The layout";
  return `${whose} is taken as it stands when you save. Once the version is saved, Preview as the client shows it as they will see it.`;
}

/** Which version the client's link shows, beside the latest saved: "; the
 *  client's link shows version 2", or that a closed link showed it. */
export function linkVersionWords(row: Pick<DeskProposal, "sentVersion" | "currentVersion"> & Partial<Pick<DeskProposal, "linkOpen">>): string {
  const sent = row.sentVersion ?? null;
  if (sent === null || sent === row.currentVersion) return "";
  return row.linkOpen === false
    ? `; the client's link, which showed version ${String(sent)}, no longer opens`
    : `; the client's link shows version ${String(sent)}`;
}

/** When the proposal last moved, beside its status: "Sent 3 days ago,
 *  opened yesterday", "Version 2, changed today". A proposal in hand says its
 *  version, since a new one saved since the client asked is the booker's own
 *  change. */
export function rowWhen(
  row: Pick<DeskProposal, "status" | "sentAt" | "updatedAt" | "currentVersion" | "linkOpenedAt"> & Partial<Pick<DeskProposal, "lastSentAt" | "hasLink">>,
  nowMs: number,
): string {
  const age = (iso: string): string => relativeAge(iso, nowMs) ?? "";
  switch (row.status) {
    case "draft":
    case "changes_requested":
      return row.currentVersion === 0 ? "Nothing written yet" : `Version ${String(row.currentVersion)}, changed ${age(row.updatedAt)}`;
    case "sent": {
      const sent = `Sent ${age(row.lastSentAt ?? row.sentAt ?? row.updatedAt)}`;
      return row.hasLink === false ? sent : `${sent}, ${linkOpenedWords(row.linkOpenedAt, nowMs)}`;
    }
    default:
      return `${proposalStatusWords(row.status)} ${age(row.updatedAt)}`;
  }
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

/** "2 clients asked for changes, and 3 drafts are yours to finish. 4
 *  proposals are with clients." Null until the list has been read. */
export function proposalsSummary(counts: Readonly<Record<string, number>> | null): readonly SummaryPart[] | null {
  if (counts === null) return null;
  const waiting = counts["changes_requested"] ?? 0;
  const drafts = counts["draft"] ?? 0;
  const out = counts["sent"] ?? 0;
  const owed: SummaryPart[] = waiting > 0 && drafts > 0
    ? [{ strong: count(waiting, "client", "clients"), tone: "new" }, " asked for changes, and ", { strong: count(drafts, "draft", "drafts") },
      drafts === 1 ? " is yours to finish." : " are yours to finish."]
    : waiting > 0
      ? [{ strong: count(waiting, "client", "clients"), tone: "new" }, " asked for changes."]
      : drafts > 0
        ? [{ strong: count(drafts, "draft", "drafts") }, drafts === 1 ? " is yours to finish." : " are yours to finish."]
        : ["Nothing is waiting on you."];
  const withClients: SummaryPart[] = out === 0 ? []
    : [" ", { strong: count(out, "proposal", "proposals") }, out === 1 ? " is with a client." : " are with clients."];
  return [...owed, ...withClients];
}

// ---------------------------------------------------------------------------
// A new version starts from the latest one, and says what it changes
// ---------------------------------------------------------------------------

export interface QuoteLineDraft {
  readonly description: string;
  readonly quantity: string;
  readonly pounds: string;
}

export const EMPTY_LINE: QuoteLineDraft = { description: "", quantity: "1", pounds: "" };

export interface ComposerDraft {
  readonly message: string;
  readonly capacityNote: string;
  readonly lines: readonly QuoteLineDraft[];
}

export const EMPTY_DRAFT: ComposerDraft = { message: "", capacityNote: "", lines: [] };

/** A version that did not save, and which composer wrote it: that composer
 *  still holds the words; once it is gone they are shown to copy. */
export interface KeptVersion {
  readonly draft: ComposerDraft;
  readonly composer: number;
}

/** The latest version's words and quote, ready to be changed rather than
 *  typed again. */
export function draftFromVersion(payload: ProposalVersionPayload | null): ComposerDraft {
  if (payload === null) return EMPTY_DRAFT;
  return {
    message: payload.clientMessage ?? "",
    capacityNote: payload.capacityNote ?? "",
    lines: (payload.quote?.lineItems ?? []).map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      pounds: (item.unitAmountMinor / 100).toFixed(2).replace(/\.00$/u, ""),
    })),
  };
}

interface ReadLine { readonly description: string; readonly quantity: number; readonly unitMinor: number }

function readLines(lines: readonly QuoteLineDraft[]): readonly ReadLine[] | null {
  const read: ReadLine[] = [];
  for (const line of lines) {
    const quantity = Number(line.quantity);
    const unitMinor = parsePoundsToMinor(line.pounds);
    if (line.description.trim() === "" || !Number.isInteger(quantity) || quantity < 1 || unitMinor === null) return null;
    read.push({ description: line.description.trim(), quantity, unitMinor });
  }
  return read;
}

function sameLines(a: readonly ReadLine[], b: readonly ReadLine[]): boolean {
  return a.length === b.length && a.every((line, index) => {
    const other = b[index];
    return other !== undefined && other.description === line.description && other.quantity === line.quantity && other.unitMinor === line.unitMinor;
  });
}

/** What the new version changes from the latest one: "the message", "the
 *  quote, £18,400 to £18,900". Empty when nothing is changed yet. A quote
 *  whose lines cannot all be read yet is "the quote" without a total. */
export function draftChanges(from: ProposalVersionPayload | null, draft: ComposerDraft): readonly string[] {
  if (from === null) return [];
  const changes: string[] = [];
  if ((from.clientMessage ?? "") !== draft.message.trim()) changes.push("the message");
  if ((from.capacityNote ?? "") !== draft.capacityNote.trim()) changes.push("the capacity note");
  const before: readonly ReadLine[] = (from.quote?.lineItems ?? [])
    .map((item) => ({ description: item.description, quantity: item.quantity, unitMinor: item.unitAmountMinor }));
  const after = readLines(draft.lines);
  if (after === null) {
    changes.push("the quote");
  } else if (!sameLines(before, after)) {
    const currency = from.quote?.currency ?? "GBP";
    const beforeTotal = from.quote?.totalMinor ?? 0;
    const afterTotal = after.reduce((sum, line) => sum + line.quantity * line.unitMinor, 0);
    changes.push(beforeTotal === afterTotal ? "the quote" : `the quote, ${money(beforeTotal, currency)} to ${money(afterTotal, currency)}`);
  }
  return changes;
}

/** "the message, the capacity note and the quote". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** Where the composer starts, and what the person has changed in it. It
 *  speaks only of what is typed here: the layout's drawing and the event's
 *  details are taken afresh when the version is saved. */
export function composerStartWords(fromVersion: number | null, changes: readonly string[]): string {
  if (fromVersion === null) return "The first version.";
  const start = `Starts from version ${String(fromVersion)}.`;
  return changes.length === 0
    ? `${start} You have not changed anything here yet.`
    : `${start} You have changed ${listWords(changes)}.`;
}

/** What the version started from shows its client that a new one does not
 *  carry: the editor's Share lens writes descriptions of the room and layout
 *  that the composer has no place for. Nothing when there is none. */
export function notCarriedWords(from: ProposalVersionPayload | null): string | null {
  if (from === null) return null;
  const room = (from.roomSummary ?? null) !== null;
  const layout = (from.layoutSummary ?? null) !== null;
  const included = (from.packageSummary ?? []).length > 0;
  const sentences: string[] = [];
  if (room && layout) sentences.push("Its descriptions of the room and layout are not carried over.");
  else if (room) sentences.push("Its description of the room is not carried over.");
  else if (layout) sentences.push("Its description of the layout is not carried over.");
  if (included) sentences.push("Its list of what is included is not carried over.");
  return sentences.length === 0 ? null : sentences.join(" ");
}

// ---------------------------------------------------------------------------
// The history, told as what happened
// ---------------------------------------------------------------------------

export interface HistoryMoment {
  readonly key: string;
  readonly at: string;
  readonly sentence: string;
  readonly quote: string | null;
}

function historySentence(entry: ProposalHistoryEntry): string {
  const byClient = entry.changedBy === null;
  switch (entry.toStatus) {
    case "sent": return "Sent to the client.";
    case "changes_requested": return byClient ? "The client asked for changes." : "Marked as changes asked for.";
    case "accepted": return byClient ? "The client accepted it." : "Marked accepted.";
    case "declined": return byClient ? "The client declined it." : "Marked declined.";
    case "withdrawn": return "Withdrawn.";
    case "expired": return "It ran out.";
    case "archived": return "Archived.";
    case "draft": return "Back to a draft.";
    default: return `Now ${proposalStatusWords(entry.toStatus).toLowerCase()}.`;
  }
}

/** Every move, newest first, with what was said about it, and when the
 *  proposal was started. */
export function historyMoments(history: readonly ProposalHistoryEntry[], startedAt: string | null): readonly HistoryMoment[] {
  const moments: HistoryMoment[] = history.map((entry) => {
    const note = entry.note === null ? "" : entry.note.trim();
    return { key: `move:${entry.id}`, at: entry.createdAt, sentence: historySentence(entry), quote: note === "" ? null : note };
  });
  if (startedAt !== null) moments.push({ key: "started", at: startedAt, sentence: "The proposal was started.", quote: null });
  return moments.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
