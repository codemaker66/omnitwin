import { describe, it, expect } from "vitest";
import {
  ProposalVersionPayloadSchema,
  findUnsupportedProposalClaim,
} from "@omnitwin/types";
import {
  buildShareProposalDraft,
  buildShareVersionPayloadCandidate,
} from "../cockpit-share-model.js";
import { BAR_CATALOGUE_SLUG } from "../guest-flow-layout-input.js";
import { CATALOGUE_ITEMS, type CatalogueItem } from "../catalogue.js";
import type { PlacedItem } from "../placement.js";

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}

const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");
const stage = (): CatalogueItem => find((c) => c.category === "stage", "stage");
const bar = (): CatalogueItem => find((c) => c.slug === BAR_CATALOGUE_SLUG, "bar");

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, groupId: null,
  }));
}

const ROOM = { roomWidthM: 21, roomLengthM: 10 } as const;
const GRAND_HALL = {
  kind: "published",
  capacity: { theatre: 250, classroom: 80, dinner: 180, reception: 250 },
  source: "Published guide · Trades Hall · 9 Jul 2026",
} as const;

describe("buildShareProposalDraft", () => {
  it("derives covers, tables and features from the live layout", () => {
    const items = [...place(roundTable(), 18), ...place(chair(), 144), ...place(stage(), 1), ...place(bar(), 1)];
    const draft = buildShareProposalDraft({ ...ROOM, placedItems: items, plannedGuestCount: 144, titleOverride: null });
    expect(draft.summary.covers).toBe(144);
    expect(draft.summary.coversSource).toBe("guest-count");
    expect(draft.summary.roundTables).toBe(18);
    expect(draft.summary.chairs).toBe(144);
    expect(draft.summary.features).toEqual(["Stage", "Bar"]);
    expect(draft.layoutSummary).toContain("Seating for 144");
    expect(draft.layoutSummary).toContain("18 round tables");
    expect(draft.layoutSummary).toContain("a stage and a bar");
  });

  it("includes the room dimensions and floor area in the room summary", () => {
    const draft = buildShareProposalDraft({ ...ROOM, placedItems: [], plannedGuestCount: null, titleOverride: null });
    expect(draft.roomSummary).toBe("21.0 m × 10.0 m floor · 210 m²");
  });

  it("states the venue's published figure for the layout, with who stated it, never a computed count", () => {
    const items = [...place(roundTable(), 10), ...place(chair(), 80)];
    const draft = buildShareProposalDraft({
      ...ROOM, placedItems: items, plannedGuestCount: 80, titleOverride: null, roomName: "Grand Hall", published: GRAND_HALL,
    });
    expect(draft.capacityNote).toBe(
      "The venue publishes 180 for dinner in the Grand Hall (Published guide · Trades Hall · 9 Jul 2026). "
      + "Final numbers depend on the layout and are confirmed by the venue team.",
    );
    expect(draft.capacityNote).not.toMatch(/\b(140|147|comfortable|within)\b/i);
    expect(findUnsupportedProposalClaim(draft.capacityNote)).toBeNull();
  });

  it("says plainly when the plan is above the published figure, and who decides", () => {
    const items = [...place(roundTable(), 25), ...place(chair(), 200)];
    const draft = buildShareProposalDraft({
      ...ROOM, placedItems: items, plannedGuestCount: 200, titleOverride: null, roomName: "Grand Hall", published: GRAND_HALL,
    });
    expect(draft.capacityNote).toContain("200 guests is more than the published 180 for dinner; the venue team will say what is possible.");
  });

  it("reads standing poseur tables against the published reception figure", () => {
    const poseur = find((c) => c.slug.startsWith("poseur-table"), "poseur table");
    const draft = buildShareProposalDraft({
      ...ROOM, placedItems: place(poseur, 20), plannedGuestCount: 200, titleOverride: null, roomName: "Grand Hall", published: GRAND_HALL,
    });
    expect(draft.capacityNote).toContain("The venue publishes 250 for reception in the Grand Hall");
  });

  it("names who confirms the capacity when nothing is published, with no count", () => {
    const items = [...place(roundTable(), 10), ...place(chair(), 80)];
    const draft = buildShareProposalDraft({ ...ROOM, placedItems: items, plannedGuestCount: 80, titleOverride: null });
    expect(draft.capacityNote).toBe("The venue team confirms the capacity of this room for this layout.");
  });

  it("falls back to a layout-derived title and uses the override when given", () => {
    const items = place(chair(), 60);
    const defaulted = buildShareProposalDraft({ ...ROOM, placedItems: items, plannedGuestCount: 60, titleOverride: "  " });
    expect(defaulted.title).toBe("Event plan for 60 guests");
    const overridden = buildShareProposalDraft({ ...ROOM, placedItems: items, plannedGuestCount: 60, titleOverride: "Autumn Gala" });
    expect(overridden.title).toBe("Autumn Gala");
    const empty = buildShareProposalDraft({ ...ROOM, placedItems: [], plannedGuestCount: null, titleOverride: null });
    expect(empty.title).toBe("Event plan");
  });

  it("describes an empty layout honestly", () => {
    const draft = buildShareProposalDraft({ ...ROOM, placedItems: [], plannedGuestCount: null, titleOverride: null });
    expect(draft.summary.covers).toBe(0);
    expect(draft.summary.coversSource).toBe("none");
    expect(draft.layoutSummary).toBe("An open-plan layout, ready to dress.");
  });
});

describe("buildShareVersionPayloadCandidate", () => {
  it("produces a payload that passes the real proposal-version schema", () => {
    const items = [...place(roundTable(), 12), ...place(chair(), 100)];
    const draft = buildShareProposalDraft({ ...ROOM, placedItems: items, plannedGuestCount: 100, titleOverride: null });
    const candidate = buildShareVersionPayloadCandidate(draft, CONFIG_ID, "  Looking forward to hosting you.  ");
    const parsed = ProposalVersionPayloadSchema.safeParse(candidate);
    expect(parsed.success).toBe(true);
    expect(candidate.configurationId).toBe(CONFIG_ID);
    expect(candidate.quote).toBeNull();
    expect(candidate.clientMessage).toBe("Looking forward to hosting you.");
    expect(candidate.roomSummary).toBe(draft.roomSummary);
    expect(candidate.layoutSummary).toBe(draft.layoutSummary);
  });

  it("nulls a blank client message and accepts a null configuration id", () => {
    const draft = buildShareProposalDraft({ ...ROOM, placedItems: [], plannedGuestCount: null, titleOverride: null });
    const candidate = buildShareVersionPayloadCandidate(draft, null, "   ");
    expect(candidate.clientMessage).toBeNull();
    expect(candidate.configurationId).toBeNull();
    expect(ProposalVersionPayloadSchema.safeParse(candidate).success).toBe(true);
  });
});
