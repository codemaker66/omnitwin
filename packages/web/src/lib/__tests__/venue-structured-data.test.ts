import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_PUBLIC_PROFILE,
  TRADES_HALL_PUBLISHED_ROOM_NAMES,
  TRADES_HALL_ROOM_CAPACITIES,
  type PublicVenueProfile,
} from "@omnitwin/types";
import { venueJsonLd, venueJsonLdScript, type JsonLdValue } from "../venue-structured-data.js";
import { VENUE_STRUCTURED_DATA_MARKER, injectVenueStructuredData } from "../venue-structured-data-plugin.js";

// ---------------------------------------------------------------------------
// The front door's schema.org description (T-649): built only from the shared
// venue truth, valid against the schema.org vocabulary (a v30.1 subset in
// fixtures/, generated from schema.org's published JSON-LD), and written into
// index.html beside the existing meta tags.
// ---------------------------------------------------------------------------

const VocabularySchema = z.object({
  version: z.string(),
  types: z.record(z.object({ ancestors: z.array(z.string()), properties: z.array(z.string()) })),
  ranges: z.record(z.array(z.string())),
});
const vocabulary = VocabularySchema.parse(JSON.parse(
  readFileSync(new URL("./fixtures/schema-org-venue-vocabulary.json", import.meta.url), "utf8"),
));

type JsonLdObject = { readonly [key: string]: JsonLdValue };

function isObject(value: JsonLdValue): value is JsonLdObject {
  return typeof value === "object" && !Array.isArray(value);
}

/** Every node with an @type, depth first. */
function nodes(value: JsonLdValue): JsonLdObject[] {
  if (Array.isArray(value)) return value.flatMap((item: JsonLdValue) => nodes(item));
  if (!isObject(value)) return [];
  const own = typeof value["@type"] === "string" ? [value] : [];
  return [...own, ...Object.values(value).flatMap((child) => nodes(child))];
}

/** Every string value (not key) in the document. */
function stringValues(value: JsonLdValue): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [];
  if (Array.isArray(value)) return value.flatMap((item: JsonLdValue) => stringValues(item));
  return Object.values(value).flatMap((child) => stringValues(child));
}

const INDEX_HTML = readFileSync("index.html", "utf8");

describe("the venue's schema.org description", () => {
  const document = venueJsonLd();

  it("is an EventVenue with its address, page, official website and published rooms", () => {
    expect(document).toMatchObject({
      "@context": "https://schema.org",
      "@type": "EventVenue",
      name: "Trades Hall of Glasgow",
      url: "https://venviewer.com/",
      sameAs: ["https://www.tradeshallglasgow.co.uk/"],
      address: {
        "@type": "PostalAddress",
        streetAddress: "85 Glassford Street",
        addressLocality: "Glasgow",
        postalCode: "G1 1UH",
        addressCountry: "GB",
      },
    });
    const rooms = document["containsPlace"];
    expect(Array.isArray(rooms) && rooms.map((room) => isObject(room) ? room["name"] : null))
      .toEqual(Object.values(TRADES_HALL_PUBLISHED_ROOM_NAMES));
  });

  it("states each room's capacity as its largest published layout figure, and no building total", () => {
    const rooms = document["containsPlace"];
    if (!Array.isArray(rooms)) throw new Error("containsPlace must be a list");
    const slugs = Object.keys(TRADES_HALL_ROOM_CAPACITIES) as (keyof typeof TRADES_HALL_ROOM_CAPACITIES)[];
    for (const [index, slug] of slugs.entries()) {
      const capacity = TRADES_HALL_ROOM_CAPACITIES[slug];
      const room: JsonLdValue | undefined = rooms[index];
      expect(room !== undefined && isObject(room) ? room["maximumAttendeeCapacity"] : null)
        .toBe(Math.max(...CAPACITY_FORMATS.map((format) => capacity[format.key])));
    }
    expect(document["maximumAttendeeCapacity"]).toBeUndefined();
  });

  it("states no capacity for a room the venue publishes none for", () => {
    const profile: PublicVenueProfile = {
      ...TRADES_HALL_PUBLIC_PROFILE,
      publishedRoomNames: { ...TRADES_HALL_PUBLIC_PROFILE.publishedRoomNames, kitchen: "The Kitchen" },
    };
    const rooms = venueJsonLd(profile)["containsPlace"];
    const kitchen = Array.isArray(rooms) ? rooms.find((room) => isObject(room) && room["name"] === "The Kitchen") : undefined;
    expect(kitchen).toEqual({ "@type": "MeetingRoom", name: "The Kitchen" });
  });

  it(`uses only types and properties schema.org defines (vocabulary ${vocabulary.version})`, () => {
    for (const node of nodes(document)) {
      const type = node["@type"];
      if (typeof type !== "string") throw new Error("Every node names its type");
      const definition = vocabulary.types[type];
      expect(definition, `schema.org type ${type}`).toBeDefined();
      for (const property of Object.keys(node).filter((key) => !key.startsWith("@"))) {
        expect(definition?.properties, `${type}.${property}`).toContain(property);
      }
    }
    // containsPlace takes Places; maximumAttendeeCapacity is an Integer.
    expect(vocabulary.ranges["containsPlace"]).toEqual(["Place"]);
    expect(vocabulary.types["MeetingRoom"]?.ancestors).toContain("Place");
    expect(vocabulary.ranges["maximumAttendeeCapacity"]).toEqual(["Integer"]);
    for (const node of nodes(document)) {
      const capacity = node["maximumAttendeeCapacity"];
      if (capacity !== undefined) expect(Number.isInteger(capacity)).toBe(true);
    }
  });

  it("drops the earlier block's email, which schema.org does not define for a Place", () => {
    expect(vocabulary.types["EventVenue"]?.properties).not.toContain("email");
    expect(document["email"]).toBeUndefined();
  });

  it("is made only of the venue's published facts — nothing from bookings or clients", () => {
    const published = new Set<string>([
      "https://schema.org", "EventVenue", "MeetingRoom", "PostalAddress",
      TRADES_HALL_PUBLIC_PROFILE.name,
      TRADES_HALL_PUBLIC_PROFILE.alternateName,
      TRADES_HALL_PUBLIC_PROFILE.venviewerUrl,
      `${TRADES_HALL_PUBLIC_PROFILE.venviewerUrl}#venue`,
      TRADES_HALL_PUBLIC_PROFILE.officialWebsite,
      TRADES_HALL_PUBLIC_PROFILE.image,
      TRADES_HALL_PUBLIC_PROFILE.telephone,
      ...Object.values(TRADES_HALL_PUBLIC_PROFILE.address),
      ...Object.values(TRADES_HALL_PUBLISHED_ROOM_NAMES),
    ]);
    for (const value of stringValues(document)) expect(published, value).toContain(value);
  });

  it("cannot close its script element early, whatever a name contains", () => {
    const script = venueJsonLdScript({ ...TRADES_HALL_PUBLIC_PROFILE, name: "</script><script>alert(1)</script>" });
    expect(script.match(/<\/script>/gu)).toHaveLength(1);
    expect(script.endsWith("</script>")).toBe(true);
  });
});

describe("index.html", () => {
  it("holds one marker for the description and no hand-written copy of it", () => {
    expect(INDEX_HTML.split(VENUE_STRUCTURED_DATA_MARKER)).toHaveLength(2);
    expect(INDEX_HTML).not.toContain("application/ld+json");
  });

  it("receives exactly one description at build time, beside the unchanged meta tags", () => {
    const built = injectVenueStructuredData(INDEX_HTML);
    const scripts = [...built.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)];
    expect(scripts).toHaveLength(1);
    expect(JSON.parse(scripts[0]?.[1] ?? "")).toEqual(venueJsonLd());
    expect(built).not.toContain(VENUE_STRUCTURED_DATA_MARKER);
    for (const tag of [
      '<link rel="canonical" href="https://venviewer.com/" />',
      '<meta property="og:title"',
      '<meta property="og:description"',
      '<meta property="og:image" content="https://venviewer.com/images/venue/trades-hall-exterior-og.jpg" />',
      '<meta name="twitter:card" content="summary_large_image" />',
      '<meta name="description"',
    ]) {
      expect(built).toContain(tag);
    }
  });

  it("leaves a page without the marker untouched", () => {
    expect(injectVenueStructuredData("<html></html>")).toBe("<html></html>");
  });
});
