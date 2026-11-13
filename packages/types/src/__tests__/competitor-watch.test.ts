import { describe, expect, it } from "vitest";
import {
  CaptureCreateSchema,
  CompetitorCreateSchema,
  OpportunityLostToSchema,
  SUGGESTED_COMPETITOR_SET,
  captureFreshness,
  captureSourceRefusal,
  isOnWebsite,
  isReviewDue,
  listingSiteOf,
  pricePageRefusal,
  reviewDueFrom,
  siteHost,
  websiteRefusal,
} from "../competitor-watch.js";
import { UpdateOpportunitySchema } from "../commercial-spine.js";

const TODAY = "2026-10-17";

function capture(seenOn: string, priceYear: number | null = 2027, sourceGoneAt: string | null = null) {
  return { seenOn, priceYear, sourceGoneAt };
}

describe("how far a capture can be relied on", () => {
  it("is Current within 90 days, its year not passed, the page unchanged since", () => {
    expect(captureFreshness(capture("2026-10-17"), TODAY, null)).toBe("current");
    expect(captureFreshness(capture("2026-07-19"), TODAY, null)).toBe("current");
  });

  it("is due a check from 91 days, or when the page changed after it was seen", () => {
    expect(captureFreshness(capture("2026-07-18"), TODAY, null)).toBe("check_due");
    expect(captureFreshness(capture("2026-10-01"), TODAY, "2026-10-10")).toBe("check_due");
    // Seen on or after the change: the figure is the changed page's.
    expect(captureFreshness(capture("2026-10-10"), TODAY, "2026-10-10")).toBe("current");
  });

  it("is Stale over 180 days, or once its year has passed", () => {
    expect(captureFreshness(capture("2026-04-20"), TODAY, null)).toBe("check_due");
    expect(captureFreshness(capture("2026-04-19"), TODAY, null)).toBe("stale");
    expect(captureFreshness(capture("2026-10-01", 2025), TODAY, null)).toBe("stale");
    expect(captureFreshness(capture("2026-10-01", 2026), TODAY, null)).toBe("current");
  });

  it("is Source gone once marked, whatever its age", () => {
    expect(captureFreshness(capture("2026-10-17", 2027, "2026-10-17T10:00:00Z"), TODAY, null)).toBe("source_gone");
  });

  it("is Unverified when the page states no year", () => {
    expect(captureFreshness(capture("2026-10-17", null), TODAY, null)).toBe("unverified");
  });
});

describe("the set's review date", () => {
  it("falls six months on, the 31st keeping to a short month's end", () => {
    expect(reviewDueFrom("2026-10-17")).toBe("2027-04-17");
    expect(reviewDueFrom("2026-08-31")).toBe("2027-02-28");
    expect(reviewDueFrom("2027-08-31")).toBe("2028-02-29");
    expect(reviewDueFrom("2026-03-15")).toBe("2026-09-15");
  });

  it("is due on the day itself", () => {
    expect(isReviewDue("2026-10-17", TODAY)).toBe(true);
    expect(isReviewDue("2026-10-18", TODAY)).toBe(false);
  });
});

describe("addresses", () => {
  it("reads the host a person recognises", () => {
    expect(siteHost("https://www.Glasgowartclub.co.uk/hire")).toBe("glasgowartclub.co.uk");
    expect(siteHost("ftp://example.com")).toBeNull();
    expect(siteHost("not an address")).toBeNull();
  });

  it("knows listing sites and their subdomains", () => {
    expect(listingSiteOf("https://bridebook.com/uk/wedding-venues/x")).toBe("bridebook.com");
    expect(listingSiteOf("https://www.tagvenue.com/venues/x")).toBe("tagvenue.com");
    expect(listingSiteOf("https://uk.hitched.co.uk/x")).toBe("hitched.co.uk");
    expect(listingSiteOf("https://tietheknot.scot/venue/the-exchange")).toBe("tietheknot.scot");
    expect(listingSiteOf("https://merchantshouse.org.uk/")).toBeNull();
    // A look-alike is not the listing site.
    expect(listingSiteOf("https://notbridebook.com/")).toBeNull();
  });

  it("sees a page as the venue's own only on its website or a subdomain", () => {
    expect(isOnWebsite("https://grandcentral.vocohotels.com/wedding-packages/", "https://grandcentral.vocohotels.com")).toBe(true);
    expect(isOnWebsite("https://shop.merchantshouse.org.uk/x", "https://merchantshouse.org.uk")).toBe(true);
    expect(isOnWebsite("https://merchantshouse.org.uk.evil.example/x", "https://merchantshouse.org.uk")).toBe(false);
  });

  it("refuses a listing site as a capture's source, with the way forward", () => {
    const refusal = captureSourceRefusal("https://bridebook.com/uk/x", "own_page", "https://thecorinthianclub.co.uk");
    expect(refusal).toContain("bridebook.com");
    expect(refusal).toContain("own page or brochure");
    expect(captureSourceRefusal("https://www.tagvenue.com/x", "brochure", null)).toContain("tagvenue.com");
  });

  it("needs an own page on the venue's website, and lets a brochure live elsewhere", () => {
    expect(captureSourceRefusal("https://grandcentral.vocohotels.com/wedding-packages/", "own_page", "https://grandcentral.vocohotels.com")).toBeNull();
    expect(captureSourceRefusal("https://files.example.org/brochure.pdf", "own_page", "https://grandcentral.vocohotels.com")).toContain("Choose Brochure");
    expect(captureSourceRefusal("https://files.example.org/brochure.pdf", "brochure", "https://grandcentral.vocohotels.com")).toBeNull();
    expect(captureSourceRefusal("https://example.org/x", "own_page", null)).toContain("Add the venue's website first");
    expect(captureSourceRefusal("javascript:alert(1)", "brochure", null)).toContain("full address");
  });

  it("checks only https pages on the venue's own website, never a listing site", () => {
    expect(pricePageRefusal("https://grandcentral.vocohotels.com/wedding-packages/", "https://grandcentral.vocohotels.com")).toBeNull();
    expect(pricePageRefusal("http://grandcentral.vocohotels.com/x", "https://grandcentral.vocohotels.com")).toContain("https://");
    expect(pricePageRefusal("https://bridebook.com/x", "https://bridebook.com")).toContain("never checked");
    expect(pricePageRefusal("https://elsewhere.example/x", "https://grandcentral.vocohotels.com")).toContain("own website");
    expect(pricePageRefusal("https://user:pw@grandcentral.vocohotels.com/x", "https://grandcentral.vocohotels.com")).toContain("without a name or password");
    expect(websiteRefusal("https://www.hirespace.com/x")).toContain("hirespace.com");
  });
});

describe("what a write must carry", () => {
  const capture = {
    sourceUrl: "https://grandcentral.vocohotels.com/wedding-packages/",
    sourceKind: "own_page",
    seenOn: "2026-10-17",
    packageName: "Grand Central Package",
    amountMinor: 13000,
    priceBasis: "per_head",
    guests: 150,
    priceYear: 2027,
    includes: ["room_hire", "catering"],
    includesNote: null,
    vat: "not_stated",
    evidenceFileId: null,
    note: null,
    supersedesId: null,
  } as const;

  it("a capture: its date, basis, year, inclusions and VAT", () => {
    expect(CaptureCreateSchema.parse(capture).currency).toBe("GBP");
    expect(CaptureCreateSchema.safeParse({ ...capture, seenOn: "2026-02-30" }).success).toBe(false);
    expect(CaptureCreateSchema.safeParse({ ...capture, includes: ["catering", "catering"] }).success).toBe(false);
    expect(CaptureCreateSchema.safeParse({ ...capture, amountMinor: 0 }).success).toBe(false);
    expect(CaptureCreateSchema.safeParse({ ...capture, currency: "EUR" }).success).toBe(false);
    expect(CaptureCreateSchema.safeParse({ ...capture, guessed: true }).success).toBe(false);
  });

  it("a competitor: a name and the reason it is in the set", () => {
    expect(CompetitorCreateSchema.safeParse({ name: "X", website: null, pricePageUrl: null, tier: "primary", reason: "  " }).success).toBe(false);
    expect(CompetitorCreateSchema.safeParse({ name: "X", website: null, pricePageUrl: null, tier: "watch", reason: "Same street" }).success).toBe(false);
  });

  it("who won a lost deal: one venue, and a figure only with its basis", () => {
    const set = { competitorId: "11111111-1111-4111-8111-111111111111", otherName: null, clientFigureMinor: null, clientFigureBasis: null };
    expect(OpportunityLostToSchema.safeParse(set).success).toBe(true);
    expect(OpportunityLostToSchema.safeParse({ ...set, competitorId: null, otherName: "Òran Mór" }).success).toBe(true);
    expect(OpportunityLostToSchema.safeParse({ ...set, otherName: "Both" }).success).toBe(false);
    expect(OpportunityLostToSchema.safeParse({ ...set, competitorId: null }).success).toBe(false);
    expect(OpportunityLostToSchema.safeParse({ ...set, clientFigureMinor: 950000 }).success).toBe(false);
    expect(OpportunityLostToSchema.safeParse({ ...set, clientFigureMinor: 950000, clientFigureBasis: "fixed" }).success).toBe(true);
    expect(UpdateOpportunitySchema.safeParse({ stage: "lost", note: "Chose another venue", lostTo: set }).success).toBe(true);
  });
});

describe("the suggested set", () => {
  it("is the approved six primary and four secondary venues, each with its reason", () => {
    expect(SUGGESTED_COMPETITOR_SET.filter((venue) => venue.tier === "primary").map((venue) => venue.name)).toEqual([
      "The Merchants House of Glasgow",
      "The Exchange, Royal Exchange Square",
      "Citation, Wilson Street",
      "1599 at the Royal College",
      "The Corinthian Club",
      "voco Grand Central",
    ]);
    expect(SUGGESTED_COMPETITOR_SET.filter((venue) => venue.tier === "secondary").map((venue) => venue.name)).toEqual([
      "Kelvingrove Art Gallery and Museum",
      "University of Glasgow, Bute Hall",
      "Kimpton Blythswood Square",
      "Glasgow Art Club",
    ]);
    for (const venue of SUGGESTED_COMPETITOR_SET) {
      expect(CompetitorCreateSchema.safeParse(venue).success, venue.name).toBe(true);
    }
  });

  it("names only the venues' own sites, and pages the check could read", () => {
    for (const venue of SUGGESTED_COMPETITOR_SET) {
      if (venue.website !== null) expect(websiteRefusal(venue.website), venue.name).toBeNull();
      if (venue.pricePageUrl !== null) expect(pricePageRefusal(venue.pricePageUrl, venue.website), venue.name).toBeNull();
    }
  });
});
