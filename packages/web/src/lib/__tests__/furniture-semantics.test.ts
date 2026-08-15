import { CANONICAL_ASSETS } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { getCatalogueItemBySlug } from "../catalogue.js";
import {
  appliedTableLinenStyle,
  canRestOnFurnitureSurface,
  canApplyTableLinenToItem,
  effectiveTableLinenStyle,
  intrinsicTableLinenStyle,
  isDiningTableItem,
  isPassiveFreestandingAvFloorItem,
  isPoseurTableItem,
  isTableMountableAvItem,
} from "../furniture-semantics.js";

function item(slug: string): NonNullable<ReturnType<typeof getCatalogueItemBySlug>> {
  const resolved = getCatalogueItemBySlug(slug);
  if (resolved === undefined) throw new Error(`missing catalogue fixture: ${slug}`);
  return resolved;
}

describe("furniture planning semantics", () => {
  it("classifies the canonical mic stand as passive freestanding AV floor equipment", () => {
    const micStand = item("mic-stand");

    expect(isPassiveFreestandingAvFloorItem(micStand)).toBe(true);
    expect(isTableMountableAvItem(micStand)).toBe(false);
    expect(CANONICAL_ASSETS.find((asset) => asset.slug === "mic-stand")?.equipmentTags).toEqual([]);
  });

  it.each(["projector", "laptop", "microphone"])(
    "classifies %s as explicitly table-mountable AV",
    (slug) => {
      expect(isTableMountableAvItem(item(slug))).toBe(true);
      expect(isPassiveFreestandingAvFloorItem(item(slug))).toBe(false);
    },
  );

  it("allows all catalogue items on stages but only explicit tabletop AV on tables", () => {
    const stage = item("platform");
    const table = item("trestle-6ft");
    const micStand = item("mic-stand");
    const laptop = item("laptop");

    expect(canRestOnFurnitureSurface(micStand, stage)).toBe(true);
    expect(canRestOnFurnitureSurface(stage, stage)).toBe(true);
    expect(canRestOnFurnitureSurface(laptop, table)).toBe(true);
    expect(canRestOnFurnitureSurface(micStand, table)).toBe(false);
    expect(canRestOnFurnitureSurface(item("banquet-chair"), table)).toBe(false);
  });

  it.each(["poseur-table", "poseur-table-black", "poseur-table-white"])(
    "classifies %s as standing rather than seated dining",
    (slug) => {
      expect(isPoseurTableItem(item(slug))).toBe(true);
      expect(isDiningTableItem(item(slug))).toBe(false);
    },
  );

  it.each(["round-table-6ft", "trestle-6ft", "trestle-4ft"])(
    "keeps %s in seated-dining workflows",
    (slug) => {
      expect(isPoseurTableItem(item(slug))).toBe(false);
      expect(isDiningTableItem(item(slug))).toBe(true);
    },
  );

  it("does not classify non-table furniture as poseur or dining", () => {
    const chair = item("banquet-chair");
    expect(isPoseurTableItem(chair)).toBe(false);
    expect(isDiningTableItem(chair)).toBe(false);
  });

  it("classifies only the two clothed poseur variants as intrinsic linen", () => {
    expect(intrinsicTableLinenStyle(item("poseur-table-black"))).toBe("black");
    expect(intrinsicTableLinenStyle(item("poseur-table-white"))).toBe("white");
    expect(intrinsicTableLinenStyle(item("poseur-table"))).toBeNull();
    expect(intrinsicTableLinenStyle(item("round-table-6ft"))).toBeNull();
    expect(intrinsicTableLinenStyle(item("banquet-chair"))).toBeNull();
  });

  it("keeps bare poseurs linen-eligible while intrinsic variants reject overlays", () => {
    expect(canApplyTableLinenToItem(item("poseur-table"))).toBe(true);
    expect(canApplyTableLinenToItem(item("round-table-6ft"))).toBe(true);
    expect(canApplyTableLinenToItem(item("poseur-table-black"))).toBe(false);
    expect(canApplyTableLinenToItem(item("poseur-table-white"))).toBe(false);
    expect(canApplyTableLinenToItem(item("banquet-chair"))).toBe(false);
  });

  it("derives effective linen without converting intrinsic linen into applied state", () => {
    const bareState = { clothed: false, clothStyle: null } as const;
    const legacyAppliedState = { clothed: true, clothStyle: null } as const;
    const whiteAppliedState = { clothed: true, clothStyle: "white" } as const;

    expect(effectiveTableLinenStyle(item("poseur-table-black"), bareState)).toBe("black");
    expect(effectiveTableLinenStyle(item("poseur-table-white"), bareState)).toBe("white");
    expect(effectiveTableLinenStyle(item("poseur-table-black"), whiteAppliedState)).toBe("black");
    expect(effectiveTableLinenStyle(item("poseur-table-white"), legacyAppliedState)).toBe("white");
    expect(appliedTableLinenStyle(item("poseur-table-black"), whiteAppliedState)).toBeNull();
    expect(appliedTableLinenStyle(item("poseur-table-white"), whiteAppliedState)).toBeNull();

    expect(effectiveTableLinenStyle(item("poseur-table"), bareState)).toBeNull();
    expect(effectiveTableLinenStyle(item("poseur-table"), whiteAppliedState)).toBe("white");
    expect(effectiveTableLinenStyle(item("round-table-6ft"), legacyAppliedState)).toBe("black");
  });
});
