import { describe, expect, it } from "vitest";
import { getCanonicalAssetBySlug } from "@omnitwin/types";
import {
  EquipmentIntakeSchema,
  SOURCE_TO_CATALOGUE_SLUG,
  deterministicUuid,
  parseCliOptions,
  planStockImport,
  type EquipmentIntake,
} from "../import-venue-stock.js";

const VENUE = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const REASON = "initial intake 2026-09-05";

function intake(records: readonly Record<string, unknown>[]): EquipmentIntake {
  return EquipmentIntakeSchema.parse({
    record_kind: "source_intake_not_operational_import",
    received_on: "2026-09-05",
    equipment_records: records,
  });
}

const chiavari = {
  source_record_id: "chiavari-wedding-chair",
  name: "Chiavari wedding chair",
  category: "chair",
  reported_quantity: 200,
  quantity_status: "founder_confirmed",
};

describe("planStockImport", () => {
  it("records a confirmed count against its catalogue identity", () => {
    const plan = planStockImport(intake([chiavari]), { venueId: VENUE, actorUserId: ACTOR, reason: REASON });
    expect(plan.adjustments).toHaveLength(1);
    const [adjustment] = plan.adjustments;
    expect(adjustment?.ownedQuantity).toBe(200);
    expect(adjustment?.assetDefinitionId).toBe(getCanonicalAssetBySlug("chiavari-chair")?.id);
    expect(plan.skipped).toEqual([]);
  });

  // The source reports what is physically there. It establishes nothing about
  // damage or availability, and the 20-damaged/190-reserved figures that
  // circulated in design fixtures are not venue facts.
  it("writes damaged and unavailable as zero and never carries fixture figures across", () => {
    const plan = planStockImport(
      intake([{ ...chiavari, damaged_quantity: 20, reserved_quantity: 190 }]),
      { venueId: VENUE, actorUserId: ACTOR, reason: REASON },
    );
    expect(plan.adjustments[0]?.damagedQuantity).toBe(0);
    expect(plan.adjustments[0]?.unavailableQuantity).toBe(0);
  });

  it("skips a record with no confirmed quantity instead of recording zero", () => {
    const plan = planStockImport(
      intake([{ ...chiavari, reported_quantity: null, quantity_status: "unresolved" }]),
      { venueId: VENUE, actorUserId: ACTOR, reason: REASON },
    );
    expect(plan.adjustments).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("no_confirmed_quantity");
  });

  it("skips a record with no catalogue identity rather than guessing one", () => {
    const plan = planStockImport(
      intake([{ source_record_id: "booster", name: "Booster seat", category: "booster_seat",
        reported_quantity: 5, quantity_status: "reported" }]),
      { venueId: VENUE, actorUserId: ACTOR, reason: REASON },
    );
    expect(plan.adjustments).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("no_catalogue_identity");
  });

  it("is deterministic, so a re-run replays instead of doubling the stock", () => {
    const options = { venueId: VENUE, actorUserId: ACTOR, reason: REASON };
    const first = planStockImport(intake([chiavari]), options);
    const second = planStockImport(intake([chiavari]), options);
    expect(first.adjustments[0]?.commandId).toBe(second.adjustments[0]?.commandId);
    // A different stated reason is a different, deliberate import.
    const relabelled = planStockImport(intake([chiavari]), { ...options, reason: "annual recount" });
    expect(relabelled.adjustments[0]?.commandId).not.toBe(first.adjustments[0]?.commandId);
  });

  it("keeps every source record accounted for, recorded or skipped", () => {
    const records = [chiavari,
      { ...chiavari, source_record_id: "booster", name: "Booster seat" },
      { ...chiavari, source_record_id: "linen-white", name: "White table linen", reported_quantity: null }];
    const plan = planStockImport(intake(records), { venueId: VENUE, actorUserId: ACTOR, reason: REASON });
    expect(plan.adjustments.length + plan.skipped.length).toBe(records.length);
    expect(plan.sourceRecordCount).toBe(records.length);
  });
});

describe("SOURCE_TO_CATALOGUE_SLUG", () => {
  it("only names catalogue items that exist", () => {
    for (const [sourceRecordId, slug] of Object.entries(SOURCE_TO_CATALOGUE_SLUG)) {
      expect(getCanonicalAssetBySlug(slug), `${sourceRecordId} -> ${slug}`).toBeDefined();
    }
  });

  it("maps each catalogue item at most once, so no two counts collide", () => {
    const slugs = Object.values(SOURCE_TO_CATALOGUE_SLUG);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("parseCliOptions", () => {
  const base = ["--source", "intake.json", "--venue", VENUE, "--actor", ACTOR, "--reason", REASON];

  it("defaults to a dry run", () => {
    const options = parseCliOptions(base);
    expect(options.apply).toBe(false);
    expect(options.databaseUrl).toBeNull();
    expect(options.backupBranch).toBeNull();
  });

  it("refuses to apply without a recorded backup branch", () => {
    expect(() => parseCliOptions([...base, "--database-url", "postgres://x/y", "--apply"]))
      .toThrow(/--backup-branch/u);
  });

  it("refuses to apply without a database url", () => {
    expect(() => parseCliOptions([...base, "--apply", "--backup-branch", "br-123"]))
      .toThrow(/--database-url/u);
  });

  it("accepts a fully specified apply", () => {
    const options = parseCliOptions([...base, "--database-url", "postgres://x/y", "--apply", "--backup-branch", "br-123"]);
    expect(options.apply).toBe(true);
    expect(options.backupBranch).toBe("br-123");
  });

  it("requires every identifying argument", () => {
    expect(() => parseCliOptions(["--source", "intake.json"])).toThrow(/--venue is required/u);
  });
});

describe("deterministicUuid", () => {
  it("reproduces the catalogue's own UUID v5 derivation", () => {
    expect(deterministicUuid("round-table-6ft")).toBe("a1ef4d89-7786-5878-bee1-87b3fac28200");
    expect(deterministicUuid("banquet-chair")).toBe("4dfcae64-b6e3-54f8-817f-af041edab935");
  });
});
