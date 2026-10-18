import { describe, expect, it } from "vitest";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";
import {
  GENERIC_ESTIMATE_LABEL,
  PUBLISHED_CAPACITY_LABEL,
  guestsAbovePublished,
  plannerLayoutStyle,
  plannerViewerIsVenueStaff,
  publishedCapacityFor,
  publishedCapacityRows,
  publishedFormatForStyle,
  type PlannerViewerAuth,
} from "../planner-truth.js";

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}

const poseur = (): CatalogueItem => find((c) => c.slug.startsWith("poseur-table"), "poseur table");
const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");

describe("publishedFormatForStyle — which published figure a layout is read against", () => {
  it("reads the planner's cocktail style as the venue's standing reception", () => {
    expect(publishedFormatForStyle("cocktail")).toBe("reception");
  });

  it("reads both dinner styles as seated dinner covers, and theatre as theatre", () => {
    expect(publishedFormatForStyle("dinner-rounds")).toBe("dinner");
    expect(publishedFormatForStyle("dinner-banquet")).toBe("dinner");
    expect(publishedFormatForStyle("theatre")).toBe("theatre");
  });

  it("infers no figure for styles the venue publishes nothing for", () => {
    for (const style of ["ceremony", "cabaret", "boardroom", "custom"] as const) {
      expect(publishedFormatForStyle(style)).toBeNull();
    }
  });
});

describe("publishedCapacityFor — only Trades Hall's own rooms carry its figures", () => {
  it("states the Grand Hall's published figures and who stated them", () => {
    const answer = publishedCapacityFor({ slug: "grand-hall", tradesHall: true });
    expect(answer).toEqual({
      kind: "published",
      capacity: { theatre: 250, classroom: 80, dinner: 180, reception: 250 },
      source: "Published guide · Trades Hall · 9 Jul 2026",
    });
    expect(PUBLISHED_CAPACITY_LABEL).toBe("Published guide · Trades Hall · 9 Jul 2026");
  });

  it("is still reading while the venue is unknown, and has nothing without a room", () => {
    expect(publishedCapacityFor({ slug: "grand-hall", tradesHall: null })).toEqual({ kind: "reading" });
    expect(publishedCapacityFor(null)).toEqual({ kind: "not-published" });
  });

  it("never lends Trades Hall's figures to another venue's room of the same name", () => {
    expect(publishedCapacityFor({ slug: "grand-hall", tradesHall: false })).toEqual({ kind: "not-published" });
  });

  it("invents nothing for a Trades Hall space the venue publishes no figure for", () => {
    expect(publishedCapacityFor({ slug: "cellar", tradesHall: true })).toEqual({ kind: "not-published" });
    expect(publishedCapacityFor({ slug: "__proto__", tradesHall: true })).toEqual({ kind: "not-published" });
  });

  it("lists the figures in the venue's order and marks the layout's format", () => {
    const rows = publishedCapacityRows({ theatre: 250, classroom: 80, dinner: 180, reception: 250 }, "reception");
    expect(rows.map((row) => row.format)).toEqual(["theatre", "classroom", "dinner", "reception"]);
    expect(rows.filter((row) => row.onFloor).map((row) => row.format)).toEqual(["reception"]);
  });
});

describe("guestsAbovePublished — the one thing worth saying about a count", () => {
  const grandHall = { theatre: 250, classroom: 80, dinner: 180, reception: 250 };

  it("says nothing at or below the published figure: under it is not a confirmation", () => {
    expect(guestsAbovePublished(180, grandHall, "dinner")).toBeNull();
    expect(guestsAbovePublished(120, grandHall, "dinner")).toBeNull();
  });

  it("says plainly when the count is above it", () => {
    expect(guestsAbovePublished(260, grandHall, "reception")).toBe("260 guests is more than the published 250 for reception.");
    expect(guestsAbovePublished(1, { ...grandHall, reception: 0 }, "reception")).toBe("1 guest is more than the published 0 for reception.");
  });

  it("says nothing without a count, a format or a sensible number", () => {
    expect(guestsAbovePublished(null, grandHall, "dinner")).toBeNull();
    expect(guestsAbovePublished(400, grandHall, null)).toBeNull();
    expect(guestsAbovePublished(Number.NaN, grandHall, "dinner")).toBeNull();
    expect(guestsAbovePublished(0, grandHall, "dinner")).toBeNull();
  });

  it("labels any computed count as an estimate, never as the room's capacity", () => {
    expect(GENERIC_ESTIMATE_LABEL).toBe("Estimate at generic spacing");
  });
});

describe("plannerLayoutStyle — the layout on the floor, read as the venue publishes", () => {
  it("reads standing poseur tables with no seats as a standing reception", () => {
    expect(plannerLayoutStyle(place(poseur(), 20))).toBe("cocktail");
  });

  it("lets seating decide when there are seats", () => {
    expect(plannerLayoutStyle([...place(poseur(), 4), ...place(chair(), 40)])).toBe("theatre");
    expect(plannerLayoutStyle([...place(roundTable(), 6), ...place(chair(), 48)])).toBe("dinner-rounds");
  });

  it("is a custom layout on an empty floor", () => {
    expect(plannerLayoutStyle([])).toBe("custom");
  });
});

describe("plannerViewerIsVenueStaff — staff of the venue whose room is open", () => {
  const VENUE = "venue-trades-hall";
  function viewer(role: string, venueId: string | null, platformRole: "none" | "admin" = "none"): PlannerViewerAuth {
    return { isLoading: false, isAuthenticated: true, user: { role, platformRole, venueId } };
  }

  it("admits the venue's floor team at its own venue", () => {
    for (const role of ["admin", "manager", "staff", "hallkeeper"]) {
      expect(plannerViewerIsVenueStaff(viewer(role, VENUE), VENUE), role).toBe(true);
    }
  });

  it("refuses another venue's floor team, clients, planners and visitors", () => {
    expect(plannerViewerIsVenueStaff(viewer("staff", "venue-elsewhere"), VENUE)).toBe(false);
    expect(plannerViewerIsVenueStaff(viewer("client", null), VENUE)).toBe(false);
    expect(plannerViewerIsVenueStaff(viewer("planner", VENUE), VENUE)).toBe(false);
    expect(plannerViewerIsVenueStaff({ isLoading: false, isAuthenticated: false, user: null }, VENUE)).toBe(false);
  });

  it("refuses while sign-in is still loading, and when no venue is open", () => {
    expect(plannerViewerIsVenueStaff({ ...viewer("staff", VENUE), isLoading: true }, VENUE)).toBe(false);
    expect(plannerViewerIsVenueStaff(viewer("staff", VENUE), null)).toBe(false);
  });

  it("admits a platform administrator", () => {
    expect(plannerViewerIsVenueStaff(viewer("client", null, "admin"), VENUE)).toBe(true);
  });
});
