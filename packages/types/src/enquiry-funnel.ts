import { z } from "zod";
import { UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// The enquiry funnel (migration 0100; run-first item 1 of the 16 October 2026
// report "Deeper upgrades across the Venviewer stack").
//
// Detecting a booking-rate lift at one venue would need about 1,090 enquiries
// per arm, far beyond a heritage venue's year, so the venue's value is judged
// on leading measures: hours to the first substantive reply, how complete an
// enquiry arrives, show-rounds per booking, days to a decision on a hold, and
// where enquiries come from. This module is their shared vocabulary.
//
// Everything is recorded by the server inside the venue's tenancy, nothing is
// stored on a visitor's device, and nothing follows an anonymous visitor: the
// privacy page says Venviewer runs no analytics product, and that stays true.
// What a page may add is attached only to an enquiry or a proposal the person
// chose to send or open. Two such inputs can only come from a browser (where
// the person came from, and a walk through the twin). The server accepts
// both, and no page sends either until the privacy notice describes them and
// people have a simple way to object (PECR Schedule A1 paragraph 5, in force
// since 5 February 2026; Blake, 19 October 2026).
// ---------------------------------------------------------------------------

const IsoInstantSchema = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------------------
// The first substantive reply
//
// enquiries.first_response_* holds the earliest reply Venviewer knows of: when
// it was made, who made it, how, and when Venviewer learned of it. Two kinds of
// reply reach it. Venviewer sees its own: a proposal marked sent, and the
// enquiry's approval or decline emailed to the guest. A person reports the
// rest, sent or said outside Venviewer (an email from the venue's own mailbox,
// a call). The automatic acknowledgement a guest receives on sending is never
// a reply. An earlier reply reported later replaces a later one, so the stamp
// only ever moves earlier and concurrent writers agree on the earliest.
// ---------------------------------------------------------------------------

/** Replies a person reports: sent or said outside Venviewer. */
export const REPORTED_RESPONSE_CHANNELS = ["email", "phone", "in_person", "video_call", "text_message"] as const;
export const ReportedResponseChannelSchema = z.enum(REPORTED_RESPONSE_CHANNELS);
export type ReportedResponseChannel = z.infer<typeof ReportedResponseChannelSchema>;

/** Replies Venviewer itself sent, so their time is the server's own. */
export const RECORDED_RESPONSE_CHANNELS = ["proposal", "decision"] as const;
export type RecordedResponseChannel = (typeof RECORDED_RESPONSE_CHANNELS)[number];

export const FIRST_RESPONSE_CHANNELS = [...REPORTED_RESPONSE_CHANNELS, ...RECORDED_RESPONSE_CHANNELS] as const;
export const FirstResponseChannelSchema = z.enum(FIRST_RESPONSE_CHANNELS);
export type FirstResponseChannel = z.infer<typeof FirstResponseChannelSchema>;

/** How far ahead of the server's clock a reported time may be (a phone set a
 *  minute fast). Anything later is refused; anything within it is recorded as
 *  the server's now, since a reply cannot be made after it is recorded. */
export const FIRST_RESPONSE_FUTURE_SKEW_MS = 2 * 60_000;

/** How far back someone may date a reply they report, unless they are the
 *  venue's admin or manager: reply time is the measure the team is judged on,
 *  so a reply dated well into the past is a manager's to record. */
export const FIRST_RESPONSE_REPORT_WINDOW_DAYS = 7;
export const FIRST_RESPONSE_BACKDATING_ROLES = ["admin", "manager"] as const;

/** The enquiry fields that are the venue's own measurements, never shown to
 *  the enquiry's customer: when and how the venue first replied, and where
 *  the person was found. */
export const ENQUIRY_FUNNEL_FIELDS = [
  "firstResponseAt",
  "firstResponseBy",
  "firstResponseChannel",
  "firstResponseRecordedAt",
  "referrerHost",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "acquisitionChannel",
] as const;

/** A person reporting a reply made outside Venviewer. `respondedAt` defaults
 *  to now and `respondedBy` to the person reporting it. */
export const RecordFirstResponseSchema = z
  .object({
    channel: ReportedResponseChannelSchema,
    respondedAt: IsoInstantSchema.optional(),
    respondedBy: UserIdSchema.optional(),
  })
  .strict();
export type RecordFirstResponseInput = z.infer<typeof RecordFirstResponseSchema>;

export const FirstResponseSchema = z.object({
  at: IsoInstantSchema,
  /** Null only once the person who replied has been deleted. */
  byUserId: UserIdSchema.nullable(),
  channel: FirstResponseChannelSchema,
  /** When Venviewer learned of it: the same instant as `at` for a reply it
   *  sent itself, later for one a person reported afterwards. */
  recordedAt: IsoInstantSchema,
});
export type FirstResponse = z.infer<typeof FirstResponseSchema>;

export const RecordFirstResponseResultSchema = z.object({
  enquiryId: z.uuid(),
  firstResponse: FirstResponseSchema,
  /** False when the enquiry already had an earlier (or the same) reply. */
  changed: z.boolean(),
});
export type RecordFirstResponseResult = z.infer<typeof RecordFirstResponseResultSchema>;

// ---------------------------------------------------------------------------
// The reply-time alarm (run-first item 3)
//
// A booking enquiry still waiting for its first reply this long after it was
// sent is flagged on the Enquiries desk. The venue's operating settings hold
// no reply threshold yet, so every venue uses this default until one is added
// there. It counts wall-clock hours, weekends and nights included: business
// hours need the venue's staffed hours, which Venviewer does not hold yet.
// ---------------------------------------------------------------------------

export const ENQUIRY_REPLY_ALARM_DEFAULT_HOURS = 24;
/** The alarm flags enquiries that arrived from this instant: the day the
 *  desk could first record a reply made outside Venviewer. Before it, a reply
 *  by phone or from the venue's own mailbox could not be recorded, so "no
 *  reply recorded" said nothing about an older enquiry, and most of them
 *  could no longer be cleared (a reply more than a week old is the venue's
 *  admin's or manager's to record). The desk still lists them by age. */
export const ENQUIRY_REPLY_ALARM_FROM = "2026-10-29T00:00:00.000Z";
/** How many flagged enquiries the alarm names, the most recently flagged
 *  first, as the desk lists them; the count covers them all. */
export const ENQUIRY_REPLY_ALARM_LIST_LIMIT = 200;
/** The stages in which an enquiry still waits on the venue: a decision is
 *  itself a reply, and a withdrawn or archived one waits on nobody. */
export const ENQUIRY_REPLY_AWAITING_STATES = ["submitted", "under_review"] as const;

export const ReplyAlarmEnquirySchema = z.object({
  id: z.uuid(),
  /** When it was sent: its first move to submitted, or when it was made. */
  arrivedAt: IsoInstantSchema,
});
export type ReplyAlarmEnquiry = z.infer<typeof ReplyAlarmEnquirySchema>;

export const ReplyAlarmSchema = z.object({
  thresholdHours: z.number().int().positive(),
  /** The server's clock when the alarm was read: a reader times its next
   *  read from this, never from its own clock. */
  asOf: IsoInstantSchema,
  /** Every booking enquiry of the venue past the threshold with no reply. */
  overdue: z.number().int().nonnegative(),
  /** The one that has waited longest; null when none is past the threshold. */
  longest: ReplyAlarmEnquirySchema.nullable(),
  /** The most recently flagged first, at most ENQUIRY_REPLY_ALARM_LIST_LIMIT. */
  enquiries: z.array(ReplyAlarmEnquirySchema),
  /** When the next enquiry still inside the threshold passes it, if none of
   *  them is answered first; null when none is waiting. */
  nextDueAt: IsoInstantSchema.nullable(),
});
export type ReplyAlarm = z.infer<typeof ReplyAlarmSchema>;

// ---------------------------------------------------------------------------
// Where an enquiry came from
//
// enquiries.source is the touchpoint the enquiry arrived by (the website's
// form, the planner, a phone call). The acquisition channel is where the
// person found the venue before that: a listing site, an AI assistant, a
// search engine, a campaign. They differ: a planner enquiry can come from a
// listing. The channel is worked out on the server from the referring site's
// host and three of the landing page's UTM tags (source, medium, campaign),
// the only parts kept: never the referring page's path or query, never
// utm_term or utm_content (email tools put per-recipient ids there), and never
// a tag that looks like an email address or a link. NULL means nothing was captured (an older enquiry, or one sent by a
// page that does not send attribution); "direct" means it was captured and
// named no source.
// ---------------------------------------------------------------------------

export const ACQUISITION_CHANNELS = [
  "assistant",
  "listing",
  "paid",
  "email",
  "social",
  "search",
  "venue_website",
  "referral",
  "other",
  "direct",
] as const;
export const AcquisitionChannelSchema = z.enum(ACQUISITION_CHANNELS);
export type AcquisitionChannel = z.infer<typeof AcquisitionChannelSchema>;

/** The UTM tags read and kept. utm_term and utm_content are neither. */
export const UTM_FIELDS = ["source", "medium", "campaign"] as const;
export type UtmField = (typeof UTM_FIELDS)[number];

/** Longest UTM value or referring host the database keeps. */
export const UTM_VALUE_MAX = 100;
export const REFERRER_HOST_MAX = 253;

/** Longest raw input read; anything beyond is cut, never refused. */
const REFERRER_INPUT_MAX = 2048;
const UTM_INPUT_MAX = 500;

const UtmInputSchema = z.string().transform((value) => value.slice(0, UTM_INPUT_MAX)).optional();

/**
 * What a page may send beside an enquiry: the page that sent the person
 * (document.referrer) and the landing page's UTM tags. All optional; an
 * empty object means "captured, nothing there". Forgiving by design, because
 * attribution must never cost a guest their enquiry: a key it does not know
 * (`utm_id`, `utm_term`, a fingerprint) is dropped and never stored, an
 * over-long value is cut, and the guest enquiry drops attribution it cannot
 * read at all.
 */
export const EnquiryAttributionSchema = z.object({
  referrer: z.string().transform((value) => value.slice(0, REFERRER_INPUT_MAX)).optional(),
  utm: z
    .object({
      source: UtmInputSchema,
      medium: UtmInputSchema,
      campaign: UtmInputSchema,
    })
    .optional(),
});
export type EnquiryAttribution = z.infer<typeof EnquiryAttributionSchema>;

type HostChannel = "assistant" | "listing" | "email" | "social" | "search";

/**
 * Hosts (and Android app ids, which an Android browser sends as the referrer
 * of a link opened from an app) for each channel a host can decide. A host
 * matches an entry when it is the entry or a subdomain of it. Checked in the
 * order classifyAcquisition lists the channels, so gemini.google.com is an
 * assistant before google.com is a search engine. The listing sites are the
 * UK venue and wedding directories, Scotland's and Glasgow's included.
 */
export const ACQUISITION_HOSTS: Readonly<Record<HostChannel, readonly string[]>> = {
  assistant: [
    "chatgpt.com", "chat.openai.com", "openai.com", "claude.ai", "claude.com", "perplexity.ai",
    "gemini.google.com", "bard.google.com", "copilot.microsoft.com", "copilot.cloud.microsoft",
    "meta.ai", "grok.com", "chat.deepseek.com", "you.com", "poe.com", "chat.mistral.ai",
    "com.openai.chatgpt", "com.anthropic.claude", "ai.perplexity.app.android",
  ],
  listing: [
    "hitched.co.uk", "bridebook.com", "bridebook.co.uk", "hirespace.com", "tagvenue.com",
    "venuedirectory.com", "venuefinder.com", "venuescanner.com", "headbox.com", "squaremeal.co.uk",
    "guidesforbrides.co.uk", "coolplaces.co.uk", "uniquevenues.com", "addtoevent.co.uk",
    "scottishweddingdirectory.com", "weddingwire.co.uk", "weddingwire.com", "theknot.com",
    "visitscotland.com", "conventionglasgow.com", "peoplemakeglasgow.com",
  ],
  email: [
    "mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com",
    "mail.yahoo.com", "mail.aol.com", "mail.proton.me", "webmail.btinternet.com",
    "com.google.android.gm", "com.microsoft.office.outlook",
  ],
  social: [
    "facebook.com", "fb.com", "messenger.com", "instagram.com", "linkedin.com", "lnkd.in", "t.co",
    "x.com", "twitter.com", "pinterest.com", "pinterest.co.uk", "pin.it", "tiktok.com", "reddit.com",
    "youtube.com", "youtu.be", "threads.net", "nextdoor.co.uk", "nextdoor.com", "wa.me", "whatsapp.com",
    "com.facebook.katana", "com.instagram.android", "com.linkedin.android", "com.zhiliaoapp.musically",
  ],
  search: [
    "bing.com", "duckduckgo.com", "search.yahoo.com", "yahoo.com", "ecosia.org", "yandex.com",
    "yandex.ru", "baidu.com", "startpage.com", "search.brave.com", "qwant.com", "ask.com",
    "com.google.android.googlequicksearchbox",
  ],
};

/** Google's search hosts: google.com, www.google.co.uk, google.com.au,
 *  google.de. Not its other products (docs., drive., sites.google.com): those
 *  are referrals, and mail. and gemini. are read as email and assistant first. */
const GOOGLE_SEARCH_HOST = /^(?:www\.)?google\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/u;

/** utm_source values that name a channel without a host. */
const ACQUISITION_SOURCE_TOKENS: Readonly<Record<HostChannel, readonly string[]>> = {
  assistant: ["chatgpt", "openai", "claude", "perplexity", "gemini", "copilot", "deepseek", "grok", "meta_ai"],
  listing: [
    "hitched", "bridebook", "hirespace", "hire_space", "tagvenue", "venuedirectory", "venuefinder",
    "squaremeal", "guidesforbrides", "coolplaces", "scottishweddingdirectory", "weddingwire", "visitscotland",
  ],
  email: ["email", "newsletter", "mailchimp", "gmail", "outlook"],
  social: ["facebook", "fb", "instagram", "ig", "linkedin", "twitter", "x", "pinterest", "tiktok", "reddit", "youtube", "threads", "whatsapp"],
  search: ["google", "bing", "duckduckgo", "yahoo", "ecosia"],
};

/** utm_medium values, by the channel they name. */
const ACQUISITION_MEDIA = {
  paid: [
    "cpc", "ppc", "paid", "paidsearch", "paid_search", "paid-search", "paidsocial", "paid_social",
    "paid-social", "display", "cpm", "banner", "retargeting", "sponsored", "ads",
  ],
  listing: ["listing", "directory", "marketplace"],
  email: ["email", "e-mail", "e_mail", "newsletter"],
  social: ["social", "social-media", "social_media", "organic_social", "sm"],
  search: ["organic", "search", "seo"],
  referral: ["referral", "affiliate", "partner"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

function hostMatches(host: string, entries: readonly string[]): boolean {
  return entries.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function withoutWww(host: string): string {
  return host.replace(/^www\./u, "");
}

/** An address rather than a name: an IPv4 dotted quad or an IPv6 literal. */
function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host);
}

/** A hostname or an Android app id as the database keeps it, the same rule as
 *  enquiries_referrer_host_shape: lowercase letters, digits, hyphens and
 *  underscores in at least two dot-separated labels. International names
 *  arrive in their punycode form (xn--…), which fits. */
const REFERRER_HOST_SHAPE = /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/u;

/**
 * The referring page's host, lowercased, without a leading "www." and never
 * its path or query: "https://www.Hitched.co.uk/venues/x?q=1" gives
 * "hitched.co.uk". An Android app referrer ("android-app://com.google.android.gm/")
 * gives its app id and nothing after it. Anything else gives null: not a URL,
 * another scheme, too long, an IP address, a name with no dot (localhost, an
 * intranet host), or anything that is not plainly a hostname, none of which
 * is a place a person found the venue.
 */
export function normaliseReferrerHost(referrer: string): string | null {
  const trimmed = referrer.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  let host: string;
  if (url.protocol === "http:" || url.protocol === "https:") {
    host = url.hostname;
  } else if (url.protocol === "android-app:") {
    host = url.host;
  } else {
    return null;
  }
  host = host.toLowerCase().replace(/\.+$/u, "");
  if (isIpLiteral(host)) return null;
  host = withoutWww(host);
  if (host.length > REFERRER_HOST_MAX || !REFERRER_HOST_SHAPE.test(host)) return null;
  return host;
}

/** Undo percent-encoding, as many layers as a campaign tool applied (they
 *  double-encode), so "jo%2540example.com" is read as the address it is. */
function percentDecoded(value: string): string {
  let current = value;
  for (let layer = 0; layer < 3; layer += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (decoded === current) return current;
    current = decoded;
  }
  return current;
}

/**
 * A UTM tag as the database keeps it: percent-decoded, trimmed, lowercased,
 * inner spaces collapsed, only letters and digits of any script and . _ - +
 * kept, and at most UTM_VALUE_MAX characters. A value holding an "@" (written
 * plainly, full-width or percent-encoded) or a link is dropped whole: a
 * campaign label is neither, and campaign tools sometimes put the recipient's
 * address, or a link made for them, in a tag.
 */
export function normaliseUtmValue(value: string | undefined): string | null {
  if (value === undefined) return null;
  const lowered = percentDecoded(value.normalize("NFKC")).normalize("NFKC").trim().toLowerCase();
  if (lowered.includes("@") || lowered.includes("://") || lowered.startsWith("www.")) return null;
  const kept = lowered.replace(/\s+/gu, " ").replace(/[^\p{L}\p{N} ._\-+]/gu, "").trim();
  if (kept === "") return null;
  return kept.slice(0, UTM_VALUE_MAX).trim();
}

/** Where Venviewer's and the venue's own pages are, so a referrer from them
 *  is read for what it is. */
export interface AcquisitionContext {
  /** Venviewer's own hosts: a referrer from one is navigation inside the
   *  site, not a source, and is not kept. */
  readonly siteHosts: readonly string[];
  /** The venue's own website: a person sent from it came from the venue. */
  readonly venueHosts: readonly string[];
}

export interface AcquisitionSignals {
  readonly referrerHost: string | null;
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  /** Whether any UTM tag was present at all. */
  readonly tagged: boolean;
}

function namesChannel(signals: AcquisitionSignals, channel: HostChannel): boolean {
  const { referrerHost, utmSource } = signals;
  const isGoogleSearch = (host: string): boolean => channel === "search" && GOOGLE_SEARCH_HOST.test(host);
  if (referrerHost !== null && (hostMatches(referrerHost, ACQUISITION_HOSTS[channel]) || isGoogleSearch(referrerHost))) {
    return true;
  }
  if (utmSource === null) return false;
  const source = withoutWww(utmSource);
  return ACQUISITION_SOURCE_TOKENS[channel].includes(source)
    || hostMatches(source, ACQUISITION_HOSTS[channel])
    || isGoogleSearch(source);
}

function mediumIs(signals: AcquisitionSignals, channel: keyof typeof ACQUISITION_MEDIA): boolean {
  const media: readonly string[] = ACQUISITION_MEDIA[channel];
  return signals.utmMedium !== null && media.includes(signals.utmMedium);
}

/**
 * The channel, first match wins. An assistant or a listing site decides
 * before paid media, so a listing's sponsored link is still the listing's
 * (its fee is the cost being compared); paid search and paid social are
 * "paid". Then email, social and search; then the venue's own website; then
 * any other referring site; a tag that names nothing known is "other"; and a
 * visit with neither a referrer nor a tag is "direct".
 */
export function classifyAcquisition(signals: AcquisitionSignals, context: AcquisitionContext): AcquisitionChannel {
  if (namesChannel(signals, "assistant")) return "assistant";
  if (namesChannel(signals, "listing") || mediumIs(signals, "listing")) return "listing";
  if (mediumIs(signals, "paid")) return "paid";
  if (mediumIs(signals, "email") || namesChannel(signals, "email")) return "email";
  if (mediumIs(signals, "social") || namesChannel(signals, "social")) return "social";
  if (mediumIs(signals, "search") || namesChannel(signals, "search")) return "search";
  const venueHosts = context.venueHosts.map(withoutWww);
  if (signals.referrerHost !== null && hostMatches(signals.referrerHost, venueHosts)) return "venue_website";
  if (signals.referrerHost !== null || mediumIs(signals, "referral")) return "referral";
  if (signals.tagged) return "other";
  return "direct";
}

/** What the database keeps for an enquiry's attribution. */
export interface EnquiryAttributionRecord {
  readonly referrerHost: string | null;
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly acquisitionChannel: AcquisitionChannel;
}

/** The kept form of what a page sent: the referring host (dropped when it is
 *  Venviewer's own), the cleaned tags, and the channel they name. */
export function attributeEnquiry(attribution: EnquiryAttribution, context: AcquisitionContext): EnquiryAttributionRecord {
  const host = attribution.referrer === undefined ? null : normaliseReferrerHost(attribution.referrer);
  const referrerHost = host !== null && hostMatches(host, context.siteHosts.map(withoutWww)) ? null : host;
  const utm = attribution.utm ?? {};
  const tags = {
    utmSource: normaliseUtmValue(utm.source),
    utmMedium: normaliseUtmValue(utm.medium),
    utmCampaign: normaliseUtmValue(utm.campaign),
  };
  // Tagged is whether the page carried any tag, read before cleaning: a tag
  // kept as nothing (an email address dropped, a value of only punctuation)
  // still says the visit came from a campaign, so it is "other", not "direct".
  const tagged = UTM_FIELDS.some((field) => (utm[field] ?? "").trim() !== "");
  return {
    referrerHost,
    ...tags,
    acquisitionChannel: classifyAcquisition(
      { referrerHost, utmSource: tags.utmSource, utmMedium: tags.utmMedium, tagged },
      context,
    ),
  };
}

// ---------------------------------------------------------------------------
// Proposal link views
//
// proposal_share_tokens.view_count counts visits: an opening of the link at
// least PROPOSAL_VIEW_VISIT_GAP_MINUTES after the one before, so the client
// page's own refetches and a reader's reloads count once. first_viewed_at is
// the first. A link opened before counting began (migration 0100) has neither
// known: both are NULL for it, never a guess.
// ---------------------------------------------------------------------------

export const PROPOSAL_VIEW_VISIT_GAP_MINUTES = 30;

// ---------------------------------------------------------------------------
// Engagement events (venue_engagement_events)
//
// A moment of interest attached to one enquiry or one proposal of the venue's:
// the enquiry the person sent, or the proposal they opened. A row holds the
// venue, that enquiry or proposal, the room when one is named, the kind and
// when it was recorded: never a device, an address, a cookie or a session, and
// never anything about a visitor who sent and opened nothing. It goes when its
// enquiry or proposal goes, and after ENGAGEMENT_RETENTION_MONTHS in any case,
// the enquiry's own retention period on the privacy page.
//   twin_walk_30s  the person walked the venue's twin for 30 seconds: before
//                  sending the enquiry, or from the proposal's page
// ---------------------------------------------------------------------------

export const ENGAGEMENT_EVENT_KINDS = ["twin_walk_30s"] as const;
export const EngagementEventKindSchema = z.enum(ENGAGEMENT_EVENT_KINDS);
export type EngagementEventKind = z.infer<typeof EngagementEventKindSchema>;

/** Seconds of walking that make a twin_walk_30s. */
export const TWIN_WALK_ENGAGED_SECONDS = 30;

/** How long an engagement event is kept: the 24 months the privacy page
 *  gives an enquiry, counted here from when the event was recorded. */
export const ENGAGEMENT_RETENTION_MONTHS = 24;

/** The same moment on the same proposal within this window is one moment. */
export const ENGAGEMENT_REPEAT_WINDOW_MINUTES = 30;

const ENGAGEMENT_KIND_SET: ReadonlySet<string> = new Set(ENGAGEMENT_EVENT_KINDS);

function isEngagementKind(value: unknown): value is EngagementEventKind {
  return typeof value === "string" && ENGAGEMENT_KIND_SET.has(value);
}

/** What an enquiry may carry of what happened before it was sent: each known
 *  kind once. Like attribution it never costs the guest their enquiry: a
 *  repeated kind counts once and a kind this release does not know is dropped. */
export const EnquiryEngagementSchema = z
  .array(z.unknown())
  .max(16)
  .transform((items): EngagementEventKind[] => [...new Set(items.filter(isEngagementKind))]);
export type EnquiryEngagement = z.infer<typeof EnquiryEngagementSchema>;

/** What a proposal's page sends: the moment, and nothing about the reader. */
export const RecordProposalEngagementSchema = z
  .object({ kind: EngagementEventKindSchema })
  .strict();
export type RecordProposalEngagementInput = z.infer<typeof RecordProposalEngagementSchema>;
