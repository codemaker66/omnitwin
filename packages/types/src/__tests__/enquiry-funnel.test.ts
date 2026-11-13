import { describe, expect, it } from "vitest";
import {
  ACQUISITION_CHANNELS,
  ACQUISITION_HOSTS,
  BookViewingSchema,
  CreateBookingSchema,
  EnquiryAttributionSchema,
  EnquiryEngagementSchema,
  FIRST_RESPONSE_CHANNELS,
  GuestEnquirySchema,
  RECORDED_RESPONSE_CHANNELS,
  REPORTED_RESPONSE_CHANNELS,
  RecordFirstResponseSchema,
  RecordProposalEngagementSchema,
  TransitionBookingSchema,
  UTM_VALUE_MAX,
  attributeEnquiry,
  classifyAcquisition,
  normaliseReferrerHost,
  normaliseUtmValue,
  type AcquisitionContext,
  type AcquisitionSignals,
} from "../index.js";

// ---------------------------------------------------------------------------
// The enquiry funnel's vocabulary (migration 0100): what is kept of where a
// person came from, the channel it names, and the shapes each funnel write
// accepts. The API and any page share these, so a page can never send what the
// server would refuse, and the server never keeps more than this says.
// ---------------------------------------------------------------------------

const CONTEXT: AcquisitionContext = {
  siteHosts: ["venviewer.com", "localhost"],
  venueHosts: ["www.tradeshallglasgow.co.uk"],
};

function signals(partial: Partial<AcquisitionSignals>): AcquisitionSignals {
  return { referrerHost: null, utmSource: null, utmMedium: null, tagged: false, ...partial };
}

describe("the referring host", () => {
  it.each([
    ["https://www.Hitched.co.uk/venues/trades-hall?ref=abc#top", "hitched.co.uk"],
    ["http://chat.openai.com/c/123", "chat.openai.com"],
    ["https://google.co.uk/", "google.co.uk"],
    ["https://claude.ai.", "claude.ai"],
    ["android-app://com.google.android.gm/", "com.google.android.gm"],
    ["android-app://com.linkedin.android", "com.linkedin.android"],
  ])("keeps only the host of %s", (referrer, host) => {
    expect(normaliseReferrerHost(referrer)).toBe(host);
  });

  it.each([
    [""],
    ["   "],
    ["not a url"],
    ["javascript:alert(1)"],
    ["mailto:info@example.test"],
    ["file:///C:/secret.txt"],
    [`https://${"a".repeat(250)}.example/`],
    // Never an address, markup or a spreadsheet formula, whatever the scheme carries.
    ["android-app:jane.doe@example.com"],
    ["android-app:<img src=x onerror=alert(1)>"],
    ['android-app:=HYPERLINK("http://evil","x")'],
    ['http://a"b.com/'],
    // An address or a name with no dot is not a place a person found the venue.
    ["https://[::1]/"],
    ["https://192.168.0.1/"],
    ["http://localhost:5173/fresh"],
    ["https://www./"],
  ])("keeps nothing of %j", (referrer) => {
    expect(normaliseReferrerHost(referrer)).toBeNull();
  });

  it("keeps an international name in its punycode form and strips every trailing dot", () => {
    expect(normaliseReferrerHost("https://Bücher.example/")).toBe("xn--bcher-kva.example");
    expect(normaliseReferrerHost("https://example.com../x")).toBe("example.com");
  });
});

describe("a UTM tag", () => {
  it("is trimmed, lowercased, spaces collapsed, and only plain characters kept", () => {
    expect(normaliseUtmValue("  Autumn   2026!  ")).toBe("autumn 2026");
    expect(normaliseUtmValue("Spring_Fair-25 + Hall.A")).toBe("spring_fair-25 + hall.a");
    expect(normaliseUtmValue("ＦＵＬＬ\u3000ＷＩＤＴＨ")).toBe("full width");
  });

  it("is dropped whole when it holds an email address, however it is written, or a link", () => {
    expect(normaliseUtmValue("jo.bloggs@example.com")).toBeNull();
    expect(normaliseUtmValue("newsletter-jo@example")).toBeNull();
    // Percent-encoded once, twice, and with a full-width percent or at sign.
    expect(normaliseUtmValue("jane.doe%40example.com")).toBeNull();
    expect(normaliseUtmValue("jo%2540example.com")).toBeNull();
    expect(normaliseUtmValue("jo\uFF0540example.com")).toBeNull();
    expect(normaliseUtmValue("jo\uFF20example.com")).toBeNull();
    // A link made for the recipient.
    expect(normaliseUtmValue("https://example.com/reset/9f8e7d6c5b4a")).toBeNull();
    expect(normaliseUtmValue("www.example.com/offer")).toBeNull();
  });

  it("keeps a name in any script, drops path and colon characters, and keeps nothing of nothing", () => {
    expect(normaliseUtmValue("日本 2026")).toBe("日本 2026");
    expect(normaliseUtmValue("spring/fair:a")).toBe("springfaira");
    expect(normaliseUtmValue("!!!")).toBeNull();
    expect(normaliseUtmValue("")).toBeNull();
    expect(normaliseUtmValue(undefined)).toBeNull();
  });

  it("is cut to the length the database keeps", () => {
    const kept = normaliseUtmValue("x".repeat(400));
    expect(kept).toHaveLength(UTM_VALUE_MAX);
  });
});

describe("the acquisition channel", () => {
  it.each<[string, Partial<AcquisitionSignals>, (typeof ACQUISITION_CHANNELS)[number]]>([
    ["an assistant's referrer", { referrerHost: "chatgpt.com" }, "assistant"],
    ["an assistant's app", { referrerHost: "com.openai.chatgpt" }, "assistant"],
    ["an assistant's tag", { utmSource: "chatgpt.com", tagged: true }, "assistant"],
    ["Gemini before Google search", { referrerHost: "gemini.google.com" }, "assistant"],
    ["a listing site", { referrerHost: "hitched.co.uk" }, "listing"],
    ["a listing site's sponsored link", { referrerHost: "bridebook.com", utmMedium: "cpc", tagged: true }, "listing"],
    ["a listing tag", { utmSource: "hitched", tagged: true }, "listing"],
    ["a directory medium", { utmMedium: "directory", tagged: true }, "listing"],
    ["Scotland's directory", { referrerHost: "scottishweddingdirectory.com" }, "listing"],
    ["paid search", { referrerHost: "google.com", utmSource: "google", utmMedium: "cpc", tagged: true }, "paid"],
    ["paid social", { utmSource: "facebook", utmMedium: "paid_social", tagged: true }, "paid"],
    ["a webmail referrer", { referrerHost: "mail.google.com" }, "email"],
    ["a newsletter tag", { utmMedium: "newsletter", utmSource: "mailchimp", tagged: true }, "email"],
    ["social", { referrerHost: "l.instagram.com" }, "social"],
    ["a short link", { referrerHost: "t.co" }, "social"],
    ["Google search, any country", { referrerHost: "google.co.uk" }, "search"],
    ["Google search, its www host", { referrerHost: "www.google.com.au" }, "search"],
    ["another Google product", { referrerHost: "docs.google.com" }, "referral"],
    ["Bing", { referrerHost: "bing.com" }, "search"],
    ["the Google app", { referrerHost: "com.google.android.googlequicksearchbox" }, "search"],
    ["the venue's own website", { referrerHost: "tradeshallglasgow.co.uk" }, "venue_website"],
    ["another site", { referrerHost: "glasgowlive.co.uk" }, "referral"],
    ["an affiliate tag", { utmMedium: "affiliate", tagged: true }, "referral"],
    ["a tag naming nothing known", { tagged: true }, "other"],
    ["nothing at all", {}, "direct"],
  ])("reads %s", (_label, partial, channel) => {
    expect(classifyAcquisition(signals(partial), CONTEXT)).toBe(channel);
  });

  it("matches a host only at a label boundary", () => {
    expect(classifyAcquisition(signals({ referrerHost: "nothitched.co.uk" }), CONTEXT)).toBe("referral");
    expect(classifyAcquisition(signals({ referrerHost: "hitched.co.uk.evil.example" }), CONTEXT)).toBe("referral");
    expect(classifyAcquisition(signals({ referrerHost: "mygoogle.com" }), CONTEXT)).toBe("referral");
  });

  it("lists every host channel in lowercase, without a scheme or a path", () => {
    for (const hosts of Object.values(ACQUISITION_HOSTS)) {
      for (const host of hosts) expect(host).toMatch(/^[a-z0-9.-]+$/u);
    }
  });
});

describe("an enquiry's attribution as kept", () => {
  it("keeps the host and three cleaned tags and names the channel", () => {
    expect(attributeEnquiry({
      referrer: "https://www.hitched.co.uk/x?ref=1",
      utm: { source: "Hitched", medium: "listing", campaign: "Autumn 2026" },
    }, CONTEXT)).toEqual({
      referrerHost: "hitched.co.uk",
      utmSource: "hitched",
      utmMedium: "listing",
      utmCampaign: "autumn 2026",
      acquisitionChannel: "listing",
    });
  });

  it("drops Venviewer's own pages as a referrer, a subdomain and www included", () => {
    for (const referrer of ["https://venviewer.com/rooms", "https://www.venviewer.com/", "https://api.venviewer.com/x", "http://localhost:5173/fresh"]) {
      expect(attributeEnquiry({ referrer }, CONTEXT)).toMatchObject({ referrerHost: null, acquisitionChannel: "direct" });
    }
  });

  it("reads an empty capture as direct, and a tag kept as nothing as tagged", () => {
    expect(attributeEnquiry({}, CONTEXT).acquisitionChannel).toBe("direct");
    // The only tag held an email address and was dropped, but the visit came
    // tagged, so it is a campaign this cannot place: other, not direct.
    expect(attributeEnquiry({ utm: { campaign: "jo@example.com" } }, CONTEXT)).toMatchObject({ utmCampaign: null, acquisitionChannel: "other" });
  });

  it("drops what it does not read and cuts what is too long, never refusing the enquiry", () => {
    const parsed = EnquiryAttributionSchema.parse({
      referrer: `https://hitched.co.uk/${"x".repeat(3000)}`,
      fingerprint: "abc",
      utm: { source: "x".repeat(900), term: "per-recipient-id", content: "variant-b", id: "123" },
    });
    expect(Object.keys(parsed).sort()).toEqual(["referrer", "utm"]);
    expect(parsed.utm).toEqual({ source: "x".repeat(500) });
    expect(parsed.referrer).toHaveLength(2048);
  });

  it("rides the guest enquiry, which keeps each known engagement kind once and drops what it cannot read", () => {
    const base = { venueSlug: "trades-hall-glasgow", email: "guest@example.test" };
    expect(GuestEnquirySchema.safeParse(base).success).toBe(true);
    expect(GuestEnquirySchema.parse({ ...base, attribution: { referrer: "https://hitched.co.uk" }, engagement: ["twin_walk_30s"] }))
      .toMatchObject({ attribution: { referrer: "https://hitched.co.uk" }, engagement: ["twin_walk_30s"] });
    expect(GuestEnquirySchema.parse({ ...base, engagement: ["twin_walk_30s", "twin_walk_30s", "page_view"] }).engagement).toEqual(["twin_walk_30s"]);
    // Unreadable attribution or engagement is dropped; the enquiry stands.
    const unreadable = GuestEnquirySchema.parse({ ...base, attribution: "https://hitched.co.uk", engagement: { kind: "twin_walk_30s" } });
    expect(unreadable.attribution).toBeUndefined();
    expect(unreadable.engagement).toBeUndefined();
    expect(EnquiryEngagementSchema.parse([])).toEqual([]);
  });
});

describe("the first reply's shapes", () => {
  it("lets a person report only the channels they can, never Venviewer's own", () => {
    expect([...FIRST_RESPONSE_CHANNELS].sort()).toEqual([...REPORTED_RESPONSE_CHANNELS, ...RECORDED_RESPONSE_CHANNELS].sort());
    for (const channel of REPORTED_RESPONSE_CHANNELS) {
      expect(RecordFirstResponseSchema.safeParse({ channel }).success, channel).toBe(true);
    }
    for (const channel of RECORDED_RESPONSE_CHANNELS) {
      expect(RecordFirstResponseSchema.safeParse({ channel }).success, channel).toBe(false);
    }
  });

  it("takes an instant with its offset, a person by id, and nothing else", () => {
    expect(RecordFirstResponseSchema.safeParse({ channel: "phone", respondedAt: "2026-10-20T09:15:00+01:00" }).success).toBe(true);
    expect(RecordFirstResponseSchema.safeParse({ channel: "phone", respondedAt: "20 October, 9am" }).success).toBe(false);
    expect(RecordFirstResponseSchema.safeParse({ channel: "phone", respondedBy: "Moira" }).success).toBe(false);
    expect(RecordFirstResponseSchema.safeParse({ channel: "phone", note: "called back" }).success).toBe(false);
  });

  it("takes only a known engagement kind from a proposal page", () => {
    expect(RecordProposalEngagementSchema.safeParse({ kind: "twin_walk_30s" }).success).toBe(true);
    expect(RecordProposalEngagementSchema.safeParse({ kind: "twin_walk_30s", visitorId: "abc" }).success).toBe(false);
  });
});

describe("viewings and lost reasons in the Diary's shapes", () => {
  const when = { startsAt: "2026-11-03T14:00:00.000Z", endsAt: "2026-11-03T14:45:00.000Z" };
  const enquiryId = "8f1f6a8e-7c4e-4a39-9d4d-0b4cf0f2f8a1";

  it("books a viewing for an enquiry over a real interval, with nothing a hold needs", () => {
    expect(BookViewingSchema.safeParse({ enquiryId, ...when }).success).toBe(true);
    expect(BookViewingSchema.safeParse({ enquiryId, startsAt: when.endsAt, endsAt: when.startsAt }).success).toBe(false);
    expect(BookViewingSchema.safeParse({ enquiryId, ...when, rank: 1 }).success).toBe(false);
    expect(BookViewingSchema.safeParse({ enquiryId, ...when, eventId: enquiryId }).success).toBe(false);
  });

  it("refuses a viewing that names an event, and keeps option numbers for holds", () => {
    const base = { venueId: enquiryId, spaceId: "9a1f6a8e-7c4e-4a39-9d4d-0b4cf0f2f8a1", title: "Walk-in", ...when };
    expect(CreateBookingSchema.safeParse({ ...base, kind: "viewing" }).success).toBe(true);
    expect(CreateBookingSchema.safeParse({ ...base, kind: "viewing", eventId: enquiryId }).success).toBe(false);
    expect(CreateBookingSchema.safeParse({ ...base, kind: "viewing", rank: 1 }).success).toBe(false);
  });

  it("takes a lost reason only with a loss, and only from the list", () => {
    expect(TransitionBookingSchema.safeParse({ toState: "lost", lostReason: "chose_elsewhere" }).success).toBe(true);
    expect(TransitionBookingSchema.safeParse({ toState: "lost" }).success).toBe(true);
    expect(TransitionBookingSchema.safeParse({ toState: "released", lostReason: "price" }).success).toBe(false);
    expect(TransitionBookingSchema.safeParse({ toState: "lost", lostReason: "weather" }).success).toBe(false);
  });
});
