import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Response-validation tests for the migrated API client modules.
//
// api-client.test.ts already pins the generic validation MECHANISM in
// client.ts. These tests pin that each module's response schema is (a) wired
// into the right call and (b) faithful to the live server shape: a correctly
// shaped payload parses, and a drifted payload (wrong type / missing field)
// throws ApiError(RESPONSE_VALIDATION_ERROR) instead of reaching components.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Import AFTER stubbing fetch so the modules bind to the mock.
const { ApiError } = await import("../client.js");
const { _resetTokenGetterForTests } = await import("../auth-bridge.js");
const loadouts = await import("../loadouts.js");
const enquiries = await import("../enquiries.js");
const pricing = await import("../pricing.js");
const spaces = await import("../spaces.js");
const uploads = await import("../uploads.js");

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  _resetTokenGetterForTests();
});

async function expectValidationError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow(ApiError);
  try {
    await promise;
  } catch (err) {
    expect((err as InstanceType<typeof ApiError>).code).toBe("RESPONSE_VALIDATION_ERROR");
  }
}

describe("loadouts response validation", () => {
  const validDetail = {
    id: "l1", spaceId: "s1", venueId: "v1", name: "Gala", description: null,
    createdAt: "2026-06-06T10:00:00.000Z", updatedAt: "2026-06-06T10:00:00.000Z",
    photos: [{ id: "p1", fileId: "f1", caption: null, sortOrder: 0, fileKey: "k", filename: "a.jpg", contentType: "image/jpeg" }],
  };

  it("parses a valid loadout detail", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: validDetail }));
    const result = await loadouts.getLoadout("v1", "s1", "l1");
    expect(result.photos[0]?.filename).toBe("a.jpg");
  });

  it("rejects a loadout list whose photoCount drifted to a string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [
      { id: "l1", name: "Gala", description: null, createdAt: "x", photoCount: "3", coverFileKey: null },
    ] }));
    await expectValidationError(loadouts.listLoadouts("v1", "s1"));
  });
});

describe("enquiries response validation", () => {
  const validEnquiry = {
    id: "e1", venueId: "v1", spaceId: "s1", configurationId: null, userId: null,
    guestEmail: null, guestPhone: null, guestName: null, state: "new", name: "A",
    email: "a@b.com", preferredDate: null, eventType: null, estimatedGuests: null,
    message: null, createdAt: "2026-06-06T10:00:00.000Z", updatedAt: "2026-06-06T10:00:00.000Z",
  };

  it("parses a valid enquiry list", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [validEnquiry] }));
    const result = await enquiries.listEnquiries();
    expect(result[0]?.email).toBe("a@b.com");
  });

  it("rejects an enquiry missing the required email field", async () => {
    const { email: _omit, ...broken } = validEnquiry;
    fetchMock.mockResolvedValue(jsonResponse({ data: [broken] }));
    await expectValidationError(enquiries.listEnquiries());
  });
});

describe("pricing response validation", () => {
  const validRule = {
    id: "r1", venueId: "v1", spaceId: null, name: "Hire", type: "flat_rate",
    amount: "1200.00", currency: "GBP", minHours: null, minGuests: null,
    isActive: true, validFrom: null, validTo: null,
  };

  it("parses a valid pricing rule (amount as string)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [validRule] }));
    const result = await pricing.listPricingRules("v1");
    expect(result[0]?.amount).toBe("1200.00");
  });

  it("rejects a pricing rule whose amount drifted to a number", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ ...validRule, amount: 1200 }] }));
    await expectValidationError(pricing.listPricingRules("v1"));
  });
});

describe("spaces response validation", () => {
  const validSpace = {
    id: "s1", venueId: "v1", name: "Grand Hall", slug: "grand-hall",
    widthM: "21", lengthM: "10.5", heightM: "7",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }],
  };
  const validVenue = {
    id: "v1", name: "Trades Hall", slug: "trades-hall", address: "85 Glassford St",
    logoUrl: null, brandColour: null,
  };

  it("parses a valid venue detail with nested spaces", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { ...validVenue, spaces: [validSpace] } }));
    const result = await spaces.getVenue("v1");
    expect(result.spaces[0]?.slug).toBe("grand-hall");
  });

  it("rejects a space whose floorPlanOutline point is malformed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ ...validSpace, floorPlanOutline: [{ x: 0 }] }] }));
    await expectValidationError(spaces.listSpaces("v1"));
  });
});

describe("uploads response validation", () => {
  const validPresign = {
    uploadUrl: "https://r2/put", fileKey: "k", publicUrl: null, readUrl: null,
    fileId: "f1", visibility: "private",
  };

  it("parses a valid presign response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: validPresign }));
    const result = await uploads.getPresignedUrl("a.jpg", "image/jpeg", 100, "loadout", "l1");
    expect(result.fileId).toBe("f1");
  });

  it("rejects a presign response with an invalid visibility value", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { ...validPresign, visibility: "secret" } }));
    await expectValidationError(uploads.getPresignedUrl("a.jpg", "image/jpeg", 100, "loadout", "l1"));
  });
});
