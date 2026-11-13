import {
  siteHost,
  type CaptureFreshness,
  type CaptureInclude,
  type Competitor,
  type CompetitorCapture,
  type CompetitorPageCheck,
  type DealLostTo,
  type MarketContextLine,
  type PageCheckRun,
  type PriceBasis,
  type VatStatement,
} from "@omnitwin/types";
import { parsePoundsToMinor } from "../../../lib/money-input.js";
import { dateWords, momentWords, moneyWords } from "./pricing-desk-format.js";

// ---------------------------------------------------------------------------
// The competitor watch's words, kept pure so they are tested apart from the
// screen. Every figure is said with its basis, its year, what it includes,
// its VAT, who saw it, when, and where; never averaged, ranked or compared.
// ---------------------------------------------------------------------------

export const FRESHNESS_WORDS: Readonly<Record<CaptureFreshness, string>> = {
  current: "Current",
  check_due: "Check due",
  stale: "Stale",
  source_gone: "Source gone",
  unverified: "Unverified",
};

/** What each state means, said where the state is shown. */
export const FRESHNESS_HINTS: Readonly<Record<CaptureFreshness, string>> = {
  current: "Seen in the last 90 days, and the page has not changed since.",
  check_due: "Seen over 90 days ago, or the page has changed since. Look again and record what it says now.",
  stale: "Over 180 days old, or its year has passed. Not shown beside a suggestion.",
  source_gone: "The page or brochure has gone, or now says the price is on request. Not shown beside a suggestion.",
  unverified: "The page gave no year for this figure. Not shown beside a suggestion.",
};

export const INCLUDE_WORDS: Readonly<Record<CaptureInclude, string>> = {
  room_hire: "room hire",
  catering: "catering",
  drinks: "drinks",
  evening_food: "evening food",
  ceremony_room: "the ceremony room",
  entertainment: "music or entertainment",
  accommodation: "bedrooms",
};

export const VAT_WORDS: Readonly<Record<VatStatement, string>> = {
  included: "VAT included",
  excluded: "plus VAT",
  not_stated: "VAT not stated",
};

/** "a, b and c". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/** Pence from what a person typed, "11,000" and "£130.50" included. */
export function poundsTyped(input: string): number | null {
  const trimmed = input.trim().replace(/^£/u, "");
  const plain = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/u.test(trimmed) ? trimmed.replaceAll(",", "") : trimmed;
  const minor = parsePoundsToMinor(plain);
  return minor === null || minor <= 0 ? null : minor;
}

/** The figure with its basis: "£130 a head, at least 150 guests",
 *  "£11,000 for 50 guests", "£2,995 in total". */
export function figureWords(figure: { readonly amountMinor: number; readonly currency: string; readonly priceBasis: PriceBasis; readonly guests: number | null }): string {
  const money = moneyWords(figure.amountMinor, figure.currency);
  if (figure.priceBasis === "per_head") {
    return figure.guests === null ? `${money} a head` : `${money} a head, at least ${figure.guests.toLocaleString("en-GB")} guests`;
  }
  return figure.guests === null ? `${money} in total` : `${money} for ${figure.guests.toLocaleString("en-GB")} guests`;
}

/** "For 2027", or that the page gave no year. */
export function yearWords(priceYear: number | null): string {
  return priceYear === null ? "Year not stated" : `For ${String(priceYear)}`;
}

/** "Includes room hire, catering and drinks; also a piper." */
export function includesWords(includes: readonly CaptureInclude[], note: string | null): string {
  const listed = includes.map((entry) => INCLUDE_WORDS[entry]);
  const extra = note === null || note.trim() === "" ? null : note.trim().replace(/\.$/u, "");
  if (listed.length === 0) return extra === null ? "What it includes was not recorded." : `Includes: ${extra}.`;
  return extra === null ? `Includes ${listWords(listed)}.` : `Includes ${listWords(listed)}; also ${extra}.`;
}

/** "Own site, grandcentral.vocohotels.com" or "Brochure, files.example.org". */
export function sourceWords(kind: CompetitorCapture["sourceKind"], url: string): string {
  const host = siteHost(url) ?? url;
  return `${kind === "own_page" ? "Own site" : "Brochure"}, ${host}`;
}

/** "Seen 17 Oct 2026 by Callum Reid". */
export function seenWords(seenOn: string, by: string | null): string {
  return by === null ? `Seen ${dateWords(seenOn)}` : `Seen ${dateWords(seenOn)} by ${by}`;
}

/** The captures still standing, newest first, and those a newer one replaced. */
export function splitCaptures(captures: readonly CompetitorCapture[]): { readonly standing: CompetitorCapture[]; readonly replaced: CompetitorCapture[] } {
  return {
    standing: captures.filter((capture) => capture.supersededById === null),
    replaced: captures.filter((capture) => capture.supersededById !== null),
  };
}

/** The newest standing figure, for the competitor's row. */
export function latestFigure(competitor: Pick<Competitor, "captures">): CompetitorCapture | null {
  return splitCaptures(competitor.captures).standing[0] ?? null;
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export function tierWords(tier: Competitor["tier"]): string {
  return tier === "primary" ? "Primary" : "Secondary";
}

/** "Next review 17 Apr 2027", or since when it has been due. */
export function reviewWords(competitor: Pick<Competitor, "reviewDue" | "reviewDueOn">): string {
  return competitor.reviewDue ? `Review due since ${dateWords(competitor.reviewDueOn)}` : `Next review ${dateWords(competitor.reviewDueOn)}`;
}

export interface CompetitorGroup {
  readonly key: Competitor["tier"];
  readonly heading: string;
  readonly competitors: readonly Competitor[];
}

/** Primary, then secondary, each in the order the API keeps (by name). */
export function groupCompetitors(competitors: readonly Competitor[]): CompetitorGroup[] {
  return (["primary", "secondary"] as const).flatMap((tier) => {
    const members = competitors.filter((competitor) => competitor.tier === tier);
    return members.length === 0 ? [] : [{ key: tier, heading: tier === "primary" ? "Primary set" : "Secondary set", competitors: members }];
  });
}

export type Attention = "page_changed" | "review_due";

/** What needs a person: a changed page and a review that has come round. */
export function attentionOf(competitor: Pick<Competitor, "pageCheck" | "reviewDue">): readonly Attention[] {
  return [
    ...(competitor.pageCheck.changedAt !== null ? ["page_changed" as const] : []),
    ...(competitor.reviewDue ? ["review_due" as const] : []),
  ];
}

export const ATTENTION_WORDS: Readonly<Record<Attention, string>> = {
  page_changed: "Page changed: re-capture",
  review_due: "Review due",
};

export function watchSummary(competitors: readonly Competitor[]): string {
  if (competitors.length === 0) return "No venues in the set yet.";
  const changed = competitors.filter((competitor) => competitor.pageCheck.changedAt !== null).length;
  const due = competitors.filter((competitor) => competitor.reviewDue).length;
  const parts = [
    `${competitors.length === 1 ? "1 venue" : `${competitors.length.toLocaleString("en-GB")} venues`} in the set`,
    ...(changed > 0 ? [`${changed === 1 ? "1 page" : `${changed.toLocaleString("en-GB")} pages`} changed`] : []),
    ...(due > 0 ? [`${due === 1 ? "1 review" : `${due.toLocaleString("en-GB")} reviews`} due`] : []),
  ];
  return `${listWords(parts)}.`;
}

// ---------------------------------------------------------------------------
// The page check
// ---------------------------------------------------------------------------

function statusSuffix(status: number | null): string {
  return status === null ? "" : ` (HTTP ${String(status)})`;
}

/** The page check's state in plain sentences, on the venue's clock. */
export function pageCheckWords(check: CompetitorPageCheck, timeZone: string): string {
  if (check.allowedAt === null) {
    return "Off. It is turned on once someone has read the site's terms and its robots.txt and found that both allow it.";
  }
  const allowed = `Allowed by ${check.allowedByName ?? "someone no longer on the team"}, ${momentWords(check.allowedAt, timeZone)}.`;
  if (check.checkedAt === null || check.outcome === null) return `${allowed} Not checked yet.`;
  const when = `Checked ${momentWords(check.checkedAt, timeZone)}`;
  const next = check.nextCheckAfter === null ? "" : ` Next check from ${momentWords(check.nextCheckAfter, timeZone)}.`;
  switch (check.outcome) {
    case "first_seen": return `${when}: page read and noted.${next}`;
    case "unchanged": return `${when}: no change.${next}`;
    case "changed": return `${when}: the page has changed.${next}`;
    case "robots_disallowed": return `${when}: its robots.txt does not allow the page to be read, so it was not.${next}`;
    case "refused": return `${when}: the site refused${statusSuffix(check.httpStatus)}, so it is left alone for four weeks.${next}`;
    case "not_found": return `${when}: the page has gone${statusSuffix(check.httpStatus)}. Check its address, or mark its figures Source gone.${next}`;
    case "moved": return `${when}: the page now sends readers elsewhere. Check its address.${next}`;
    case "failed": return `${when}: the page could not be read${statusSuffix(check.httpStatus)}.${next}`;
  }
}

/** What "Check the pages now" did, in counts. */
export function runWords(run: PageCheckRun): string {
  const count = (outcome: string): number => run.results.filter((result) => result.outcome === outcome).length;
  const read = run.results.filter((result) => result.outcome !== "not_allowed" && result.outcome !== "not_due").length;
  const parts: string[] = [];
  if (count("changed") > 0) parts.push(`${String(count("changed"))} changed`);
  if (count("unchanged") > 0) parts.push(`${String(count("unchanged"))} unchanged`);
  if (count("first_seen") > 0) parts.push(`${String(count("first_seen"))} read for the first time`);
  const problems = count("refused") + count("failed") + count("not_found") + count("moved") + count("robots_disallowed");
  if (problems > 0) parts.push(`${String(problems)} not read; each venue says why`);
  const head = read === 0 ? "No page was due a check." : `Checked ${read === 1 ? "1 page" : `${String(read)} pages`}: ${listWords(parts)}.`;
  const notDue = count("not_due");
  const off = count("not_allowed");
  return [
    head,
    ...(notDue > 0 ? [`${String(notDue)} read in the last week, so left until the week comes round.`] : []),
    ...(off > 0 ? [`${String(off)} with the check off.`] : []),
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Beside a suggestion
// ---------------------------------------------------------------------------

/** One line of the market context card, every fact with its figure. */
export function contextLineWords(line: MarketContextLine): { readonly title: string; readonly figure: string; readonly terms: string; readonly provenance: string } {
  return {
    title: `${line.competitorName} · ${line.packageName}`,
    figure: figureWords(line),
    terms: `${yearWords(line.priceYear)} · ${VAT_WORDS[line.vat]} · ${includesWords(line.includes, line.includesNote)}`,
    provenance: `${seenWords(line.seenOn, line.capturedByName)} · ${sourceWords(line.sourceKind, line.sourceUrl)}`,
  };
}

// ---------------------------------------------------------------------------
// Who won a lost deal
// ---------------------------------------------------------------------------

/** "Lost to voco Grand Central. Client's figure, unverified: £11,500 in total." */
export function lostToWords(lostTo: DealLostTo): string {
  const figure = lostTo.clientFigureMinor === null || lostTo.clientFigureBasis === null
    ? ""
    : ` Client's figure, unverified: ${figureWords({ amountMinor: lostTo.clientFigureMinor, currency: lostTo.currency, priceBasis: lostTo.clientFigureBasis, guests: null })}.`;
  return `Lost to ${lostTo.name}.${figure}`;
}
