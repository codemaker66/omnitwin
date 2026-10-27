import { z } from "zod";
import { dayNumber } from "./pricing-desk.js";
import { isCalendarDate } from "./event-brief-draft.js";

// ---------------------------------------------------------------------------
// The competitor watch (Blake approved the proposal on 17 October 2026):
// a dated notebook beside the Pricing desk, never a pricing input.
//
//   1. The comp set: the venues the office compares itself with, each with
//      the reason it is in the set and a review date six months out.
//   2. Price captures: one dated, sourced record per figure a person saw on
//      a competitor's own page or brochure. Append-only: a figure is never
//      edited, only replaced by a newer capture that names it.
//   3. Who a deal was lost to, recorded with the existing "Mark lost" reason.
//   4. A page-change check, only where a person recorded that the site's
//      terms and robots.txt allow it: a hash and a date, never a price.
//
// The rules that keep it lawful and honest (the proposal's "never do" list,
// and the CMA's guidance on pricing algorithms and information exchange):
//   - every record belongs to one venue; nothing is pooled across venues;
//   - no competitor figure is read by the suggestion maths
//     (services/pricing-advice.ts) or by anything that sets a price;
//   - a figure is shown with its source, the date it was seen and its basis,
//     never averaged, ranked or offered to "match";
//   - listings sites and marketplaces are never a source and never checked;
//   - a client's figure for a rival is the client's report, unverified, and
//     never appears beside the rival's name on the watch.
// ---------------------------------------------------------------------------

export const COMPETITOR_TIERS = ["primary", "secondary"] as const;
export const CompetitorTierSchema = z.enum(COMPETITOR_TIERS);
export type CompetitorTier = z.infer<typeof CompetitorTierSchema>;

/** A small, deliberately chosen set (hotel practice is four to eight). */
export const COMPETITOR_SET_LIMIT = 12;
/** Sets are reviewed at least twice a year. */
export const COMPETITOR_REVIEW_MONTHS = 6;

export const CAPTURE_SOURCE_KINDS = ["own_page", "brochure"] as const;
export const CaptureSourceKindSchema = z.enum(CAPTURE_SOURCE_KINDS);
export type CaptureSourceKind = z.infer<typeof CaptureSourceKindSchema>;

export const PRICE_BASES = ["per_head", "fixed"] as const;
export const PriceBasisSchema = z.enum(PRICE_BASES);
export type PriceBasis = z.infer<typeof PriceBasisSchema>;

export const VAT_STATEMENTS = ["included", "excluded", "not_stated"] as const;
export const VatStatementSchema = z.enum(VAT_STATEMENTS);
export type VatStatement = z.infer<typeof VatStatementSchema>;

/** What a package says it includes, as a checklist; anything else goes in
 *  the note beside it. */
export const CAPTURE_INCLUDES = [
  "room_hire",
  "catering",
  "drinks",
  "evening_food",
  "ceremony_room",
  "entertainment",
  "accommodation",
] as const;
export const CaptureIncludeSchema = z.enum(CAPTURE_INCLUDES);
export type CaptureInclude = z.infer<typeof CaptureIncludeSchema>;

/**
 * How far a capture can be relied on today.
 *   current      seen in the last 90 days, its year not passed, and no page
 *                change found since it was seen;
 *   check_due    90 to 180 days old, or the page changed since;
 *   stale        over 180 days old, or its price year has passed;
 *   source_gone  a person marked the page or brochure gone, or "on request";
 *   unverified   the page states no year for the figure.
 * Only current captures appear beside a pricing suggestion.
 */
export const CAPTURE_FRESHNESS = ["current", "check_due", "stale", "source_gone", "unverified"] as const;
export const CaptureFreshnessSchema = z.enum(CAPTURE_FRESHNESS);
export type CaptureFreshness = z.infer<typeof CaptureFreshnessSchema>;

export const CAPTURE_CURRENT_DAYS = 90;
export const CAPTURE_STALE_AFTER_DAYS = 180;

/** At most this many lines beside one suggestion. */
export const MARKET_CONTEXT_LIMIT = 6;

/** A real calendar date: "2026-02-30" is not one. */
const DateOnlySchema = z.string().refine(isCalendarDate, "Not a date");

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Sites that list many venues (directories, marketplaces, review and search
 * sites). A figure from one is not the venue's own, the proposal's legal
 * notes rule them out as sources, and their terms bar automated access, so
 * they are refused as a capture's source and as a page to check. A listing
 * can still point a person to the venue's own page.
 */
export const LISTING_SITE_HOSTS = [
  "bridebook.com",
  "bridebook.co.uk",
  "tagvenue.com",
  "hirespace.com",
  "hitched.co.uk",
  "tietheknot.scot",
  "venuefinder.com",
  "venuedirectory.com",
  "headbox.com",
  "coolplaces.co.uk",
  "wedding-venues.co.uk",
  "confetti.co.uk",
  "weddingwire.com",
  "weddingwire.co.uk",
  "theknot.com",
  "tripadvisor.com",
  "tripadvisor.co.uk",
  "google.com",
  "google.co.uk",
  "bing.com",
] as const;

/** The host a person would recognise: lower case, without "www.". */
export function siteHost(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (host === "") return null;
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** The listing site an address belongs to, if any. */
export function listingSiteOf(url: string): string | null {
  const host = siteHost(url);
  if (host === null) return null;
  return LISTING_SITE_HOSTS.find((listing) => host === listing || host.endsWith(`.${listing}`)) ?? null;
}

/** Whether `url` is on the venue's website, or one of its subdomains. */
export function isOnWebsite(url: string, website: string): boolean {
  const host = siteHost(url);
  const site = siteHost(website);
  if (host === null || site === null) return false;
  return host === site || host.endsWith(`.${site}`);
}

/** Why a website address cannot be kept; null when it can. */
export function websiteRefusal(url: string): string | null {
  if (siteHost(url) === null) return "Use the website's full address, starting https://.";
  const listing = listingSiteOf(url);
  if (listing !== null) return `That address is on ${listing}, a site that lists many venues. Use the venue's own website.`;
  return null;
}

/**
 * Why a capture's source cannot be used; null when it can. An own page
 * must be on the venue's website; a brochure may be kept elsewhere (a file
 * host, say), but never on a listing site.
 */
export function captureSourceRefusal(url: string, kind: CaptureSourceKind, website: string | null): string | null {
  if (siteHost(url) === null) return "Use the page's full address, starting https://.";
  const listing = listingSiteOf(url);
  if (listing !== null) {
    return `That address is on ${listing}, a site that lists many venues. Record the figure from the venue's own page or brochure, and use the listing only to find it.`;
  }
  if (kind === "own_page") {
    if (website === null) return "Add the venue's website first, so the page can be seen to be theirs.";
    if (!isOnWebsite(url, website)) {
      return `That page is not on ${siteHost(website) ?? "the venue's website"}, the venue's website. Choose Brochure if it is their own brochure kept elsewhere.`;
    }
  }
  return null;
}

/** Why a page cannot be checked for changes; null when it can. */
export function pricePageRefusal(url: string, website: string | null): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "Use the page's full address, starting https://."; }
  if (parsed.protocol !== "https:") return "The page check reads only https:// addresses.";
  if (parsed.username !== "" || parsed.password !== "") return "Use the page's address without a name or password in it.";
  const listing = listingSiteOf(url);
  if (listing !== null) return `That address is on ${listing}, a site that lists many venues. It is never checked.`;
  if (website === null) return "Add the venue's website first, so the page can be seen to be theirs.";
  if (!isOnWebsite(url, website)) {
    return `The page to check must be on the venue's own website, ${siteHost(website) ?? "its website"}.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** The date six months after `date` ("YYYY-MM-DD"); the 31st of a short
 *  month falls back to its last day. */
export function reviewDueFrom(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = month - 1 + COMPETITOR_REVIEW_MONTHS;
  const y = year + Math.floor(target / 12);
  const m = target % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
}

export function isReviewDue(reviewDueOn: string, today: string): boolean {
  return reviewDueOn <= today;
}

export interface FreshnessFields {
  readonly seenOn: string;
  readonly priceYear: number | null;
  readonly sourceGoneAt: string | null;
}

/**
 * How far a capture can be relied on on `today` (both "YYYY-MM-DD").
 * `pageChangedOn` is the date the competitor's page was last found changed
 * and not yet answered (re-captured or dismissed), or null.
 */
export function captureFreshness(capture: FreshnessFields, today: string, pageChangedOn: string | null): CaptureFreshness {
  if (capture.sourceGoneAt !== null) return "source_gone";
  if (capture.priceYear === null) return "unverified";
  const seen = dayNumber(capture.seenOn);
  const now = dayNumber(today);
  if (seen === null || now === null) return "unverified";
  const age = now - seen;
  if (age > CAPTURE_STALE_AFTER_DAYS || capture.priceYear < Number(today.slice(0, 4))) return "stale";
  if (age > CAPTURE_CURRENT_DAYS || (pageChangedOn !== null && capture.seenOn < pageChangedOn)) return "check_due";
  return "current";
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const NameSchema = z.string().trim().min(1, "Give the venue's name").max(160);
const ReasonSchema = z.string().trim().min(1, "Say why it is in the set").max(400);
const UrlSchema = z.string().trim().max(2000);

export const CompetitorCreateSchema = z.object({
  name: NameSchema,
  website: UrlSchema.nullable(),
  pricePageUrl: UrlSchema.nullable(),
  tier: CompetitorTierSchema,
  reason: ReasonSchema,
}).strict();
export type CompetitorCreate = z.infer<typeof CompetitorCreateSchema>;

export const CompetitorUpdateSchema = CompetitorCreateSchema.partial().strict()
  .refine((body) => Object.keys(body).length > 0, "Nothing to change");
export type CompetitorUpdate = z.infer<typeof CompetitorUpdateSchema>;

/** The guests a figure is for: the minimum for a price a head, the number
 *  the total covers for a fixed price. */
const GuestsSchema = z.number().int().min(1).max(5000);

export const CaptureCreateSchema = z.object({
  sourceUrl: UrlSchema.min(1),
  sourceKind: CaptureSourceKindSchema,
  seenOn: DateOnlySchema,
  packageName: z.string().trim().min(1, "Give the package's name").max(160),
  amountMinor: z.number().int().min(1).max(100_000_000),
  currency: z.literal("GBP").default("GBP"),
  priceBasis: PriceBasisSchema,
  guests: GuestsSchema.nullable(),
  /** The year the figure is for, as the page states it; null when the page
   *  states none (the capture is then Unverified). */
  priceYear: z.number().int().min(2000).max(2100).nullable(),
  includes: z.array(CaptureIncludeSchema).max(CAPTURE_INCLUDES.length)
    .refine((list) => new Set(list).size === list.length, "Each item once"),
  includesNote: z.string().trim().max(400).nullable(),
  vat: VatStatementSchema,
  evidenceFileId: z.uuid().nullable(),
  note: z.string().trim().max(1000).nullable(),
  /** The capture this figure replaces, for the same competitor. */
  supersedesId: z.uuid().nullable(),
}).strict();
export type CaptureCreate = z.infer<typeof CaptureCreateSchema>;
export type CaptureCreateInput = z.input<typeof CaptureCreateSchema>;

/** A person's record that the site's terms and robots.txt were read and
 *  allow the page check. Both must be ticked. */
export const PageCheckPermissionSchema = z.object({
  termsRead: z.literal(true),
  robotsRead: z.literal(true),
}).strict();
export type PageCheckPermission = z.infer<typeof PageCheckPermissionSchema>;

/**
 * Who won a lost deal, given with the reason when the deal is marked lost
 * (PATCH /opportunities/:id). One of a competitor in the set or another
 * venue by name; a figure the client volunteered is kept as the client's
 * report, unverified.
 */
export const OpportunityLostToSchema = z.object({
  competitorId: z.uuid().nullable(),
  otherName: z.string().trim().min(1).max(160).nullable(),
  clientFigureMinor: z.number().int().min(1).max(100_000_000).nullable(),
  clientFigureBasis: PriceBasisSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.competitorId === null) === (value.otherName === null)) {
    ctx.addIssue({ code: "custom", path: ["competitorId"], message: "Name one venue: from the set, or another by name" });
  }
  if ((value.clientFigureMinor === null) !== (value.clientFigureBasis === null)) {
    ctx.addIssue({ code: "custom", path: ["clientFigureBasis"], message: "A figure needs its basis: a head, or in total" });
  }
});
export type OpportunityLostTo = z.infer<typeof OpportunityLostToSchema>;

/** Who won, as a deal's timeline tells it. */
export const DealLostToSchema = z.object({
  name: z.string(),
  competitorId: z.uuid().nullable(),
  clientFigureMinor: z.number().int().positive().nullable(),
  clientFigureBasis: PriceBasisSchema.nullable(),
  currency: z.string().length(3),
});
export type DealLostTo = z.infer<typeof DealLostToSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const PAGE_CHECK_OUTCOMES = [
  "first_seen",
  "unchanged",
  "changed",
  "robots_disallowed",
  "refused",
  "not_found",
  "moved",
  "failed",
] as const;
export const PageCheckOutcomeSchema = z.enum(PAGE_CHECK_OUTCOMES);
export type PageCheckOutcome = z.infer<typeof PageCheckOutcomeSchema>;

const InstantSchema = z.iso.datetime({ offset: true });

export const CompetitorCaptureSchema = z.object({
  id: z.uuid(),
  competitorId: z.uuid(),
  sourceUrl: z.string(),
  sourceKind: CaptureSourceKindSchema,
  seenOn: DateOnlySchema,
  capturedAt: InstantSchema,
  capturedByName: z.string().nullable(),
  packageName: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  priceBasis: PriceBasisSchema,
  guests: z.number().int().positive().nullable(),
  priceYear: z.number().int().nullable(),
  includes: z.array(CaptureIncludeSchema),
  includesNote: z.string().nullable(),
  vat: VatStatementSchema,
  evidenceFileId: z.uuid().nullable(),
  note: z.string().nullable(),
  supersedesId: z.uuid().nullable(),
  /** The newer capture that replaced this one, if any. */
  supersededById: z.uuid().nullable(),
  sourceGoneAt: InstantSchema.nullable(),
  sourceGoneByName: z.string().nullable(),
  freshness: CaptureFreshnessSchema,
});
export type CompetitorCapture = z.infer<typeof CompetitorCaptureSchema>;

export const CompetitorPageCheckSchema = z.object({
  /** When a person recorded that the terms and robots.txt allow the check,
   *  and who; null while the check is off. */
  allowedAt: InstantSchema.nullable(),
  allowedByName: z.string().nullable(),
  checkedAt: InstantSchema.nullable(),
  outcome: PageCheckOutcomeSchema.nullable(),
  httpStatus: z.number().int().nullable(),
  /** The earliest a check may run again: at most weekly, longer after a
   *  site refused one. */
  nextCheckAfter: InstantSchema.nullable(),
  /** When the page was found changed, while no one has re-captured it or
   *  dismissed the change; null otherwise. */
  changedAt: InstantSchema.nullable(),
});
export type CompetitorPageCheck = z.infer<typeof CompetitorPageCheckSchema>;

export const CompetitorLossesSchema = z.object({
  /** Deals marked lost to this venue in the last twelve months. */
  count: z.number().int().nonnegative(),
  /** The newest few, with the reason given. Never the client's figure. */
  recent: z.array(z.object({
    at: InstantSchema,
    dealTitle: z.string(),
    reason: z.string().nullable(),
  })),
});
export type CompetitorLosses = z.infer<typeof CompetitorLossesSchema>;

export const CompetitorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  website: z.string().nullable(),
  pricePageUrl: z.string().nullable(),
  tier: CompetitorTierSchema,
  reason: z.string(),
  reviewDueOn: DateOnlySchema,
  reviewDue: z.boolean(),
  reviewedAt: InstantSchema.nullable(),
  reviewedByName: z.string().nullable(),
  addedAt: InstantSchema,
  addedByName: z.string().nullable(),
  pageCheck: CompetitorPageCheckSchema,
  /** Newest first, replaced ones included. */
  captures: z.array(CompetitorCaptureSchema),
  losses: CompetitorLossesSchema,
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const CompetitorWatchSchema = z.object({
  /** The venue's own date today, which freshness is judged against. */
  today: DateOnlySchema,
  timezone: z.string(),
  limit: z.number().int().positive(),
  /** Whether "Start from the suggested set" is offered: this venue has a
   *  suggested set, and its own set is empty. */
  suggestedSetOffered: z.boolean(),
  competitors: z.array(CompetitorSchema),
});
export type CompetitorWatch = z.infer<typeof CompetitorWatchSchema>;

export const MarketContextLineSchema = z.object({
  captureId: z.uuid(),
  competitorId: z.uuid(),
  competitorName: z.string(),
  tier: CompetitorTierSchema,
  packageName: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  priceBasis: PriceBasisSchema,
  guests: z.number().int().positive().nullable(),
  priceYear: z.number().int(),
  includes: z.array(CaptureIncludeSchema),
  includesNote: z.string().nullable(),
  vat: VatStatementSchema,
  seenOn: DateOnlySchema,
  capturedByName: z.string().nullable(),
  sourceUrl: z.string(),
  sourceKind: CaptureSourceKindSchema,
});
export type MarketContextLine = z.infer<typeof MarketContextLineSchema>;

/** The Current figures for one year, as context beside a suggestion. In the
 *  set's order (primary first, then by name): never by price. */
export const MarketContextSchema = z.object({
  year: z.number().int(),
  today: DateOnlySchema,
  lines: z.array(MarketContextLineSchema).max(MARKET_CONTEXT_LIMIT),
  /** Current figures for the year beyond the lines shown. */
  more: z.number().int().nonnegative(),
  /** Figures for the year that are due a check, and so not shown. */
  checkDue: z.number().int().nonnegative(),
});
export type MarketContext = z.infer<typeof MarketContextSchema>;

/** The set by name, for choosing who won a lost deal. */
export const CompetitorNamesSchema = z.array(z.object({ id: z.uuid(), name: z.string() }));
export type CompetitorNames = z.infer<typeof CompetitorNamesSchema>;

export const PageCheckResultSchema = z.object({
  competitorId: z.uuid(),
  outcome: z.union([PageCheckOutcomeSchema, z.enum(["not_due", "not_allowed"])]),
  nextCheckAfter: InstantSchema.nullable(),
});
export type PageCheckResult = z.infer<typeof PageCheckResultSchema>;

export const PageCheckRunSchema = z.object({
  checkedAt: InstantSchema,
  results: z.array(PageCheckResultSchema),
});
export type PageCheckRun = z.infer<typeof PageCheckRunSchema>;

// ---------------------------------------------------------------------------
// The suggested set for Trades Hall Glasgow
//
// From the competitor-watch proposal of 17 October 2026, approved by Blake
// the same day. Names, websites and the reason each is in the set; the
// figures the proposal saw are not carried here, so every price in the
// watch is one the office captured itself, dated and sourced. Websites are
// left blank where the proposal named no address. The page to check is the
// one the proposal read; checking stays off until a person records that the
// site's terms and robots.txt allow it.
// ---------------------------------------------------------------------------

export interface SuggestedCompetitor {
  readonly name: string;
  readonly tier: CompetitorTier;
  readonly reason: string;
  readonly website: string | null;
  readonly pricePageUrl: string | null;
}

export const SUGGESTED_COMPETITOR_SET: readonly SuggestedCompetitor[] = [
  {
    name: "The Merchants House of Glasgow",
    tier: "primary",
    reason: "The nearest heritage twin: a historic hall on George Square with the same couple and corporate profile; exclusive use up to 120 guests.",
    website: "https://merchantshouse.org.uk",
    pricePageUrl: "https://merchantshouse.org.uk/wedding-packages/",
  },
  {
    name: "The Exchange, Royal Exchange Square",
    tier: "primary",
    reason: "A converted Merchant City landmark sold for exclusive use to the same budget buyer, with actively marketed fixed packages; evening up to 200.",
    website: "https://theexchangeglasgow.co.uk",
    pricePageUrl: "https://theexchangeglasgow.co.uk/weddings/",
  },
  {
    name: "Citation, Wilson Street",
    tier: "primary",
    reason: "Same neighbourhood and buyer in the Merchant City, and it also sells a twilight format, as Trades Hall does.",
    website: "https://www.citation-glasgow.com",
    pricePageUrl: "https://www.citation-glasgow.com/wedding-venues-glasgow/",
  },
  {
    name: "1599 at the Royal College",
    tier: "primary",
    reason: "A historic professional hall with per-head packages that a couple can set directly beside a hotel's; wedding breakfast up to 120.",
    website: null,
    pricePageUrl: null,
  },
  {
    name: "The Corinthian Club",
    tier: "primary",
    reason: "Same street and the same listed-building story, and the only central rival whose reception scale (250) reaches the Grand Hall.",
    website: "https://thecorinthianclub.co.uk",
    pricePageUrl: "https://thecorinthianclub.co.uk/private-hire/weddings",
  },
  {
    name: "voco Grand Central",
    tier: "primary",
    reason: "The only rival that publishes headline prices on its own site, and the only one matching the Grand Hall's scale for weddings of 150 and more.",
    website: "https://grandcentral.vocohotels.com",
    pricePageUrl: "https://grandcentral.vocohotels.com/wedding-packages/",
  },
  {
    name: "Kelvingrove Art Gallery and Museum",
    tier: "secondary",
    reason: "Cross-shopped for a large civic event (Centre Hall banquet 450), though it has no daytime hire.",
    website: "https://www.glasgowlife.org.uk",
    pricePageUrl: "https://www.glasgowlife.org.uk/venue-hire/kelvingrove-art-gallery-and-museum",
  },
  {
    name: "University of Glasgow, Bute Hall",
    tier: "secondary",
    reason: "Cross-shopped for large heritage weddings and corporate dinners (ceremony up to 250), in the West End rather than the city centre.",
    website: "https://www.gla.ac.uk",
    pricePageUrl: "https://www.gla.ac.uk/myglasgow/eventsconferences/weddings/",
  },
  {
    name: "Kimpton Blythswood Square",
    tier: "secondary",
    reason: "Its Monte Carlo Suite (64 seated, 80 evening) is cross-shopped with the Saloon and the Robert Adam Room.",
    website: "https://www.kimptonblythswoodsquare.com",
    pricePageUrl: "https://www.kimptonblythswoodsquare.com/glasgow-wedding-venues",
  },
  {
    name: "Glasgow Art Club",
    tier: "secondary",
    reason: "A small, intimate heritage rival to the rooms that seat 60 for dinner.",
    website: "https://www.glasgowartclub.co.uk",
    pricePageUrl: null,
  },
];
