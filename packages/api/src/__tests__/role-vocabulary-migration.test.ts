import { EVENT_PLAN_AUDIENCE_ROLES, USER_ROLES } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { checkListValues, migrationText, sqlWithoutComments } from "./migration-text.js";

// The role vocabulary now lives in three places: USER_ROLES in
// @omnitwin/types, the CHECK constraints in the vocabulary migration, and the
// mirrored check() in db/schema.ts. A migration cannot import TypeScript, so
// the SQL copy is unavoidable — but an unpinned copy lets the database accept
// a value the Zod union rejects on read, or reject one the application is
// already issuing, and neither shows up until a real person hits it. This is
// the instrument the catalogue already has, pointed at the roles: it turns
// "these two PRs must merge together" from a paragraph in a report into a
// failing test.
//
// Audience roles are deliberately the LONGER list. EVENT_PLAN_AUDIENCE_ROLES
// is USER_ROLES plus `supplier` and `executive`, which remain valid audiences
// for a change feed or a notification even though neither is a user role and
// neither has a UI branch any more. Asserting against the exported constant
// keeps that distinction honest instead of hardcoding ten strings here.

const USER_ROLE_CHECKS = ["users_role_check", "user_invitations_role_check"];

const AUDIENCE_CHECKS = [
  "event_plan_changes_actor_role_check",
  "event_plan_notifications_role_check",
  "event_plan_change_ack_role_check",
  "event_mission_events_actor_role_check",
  "event_mission_ack_role_check",
  "event_mission_sessions_role_check",
];

const VOCABULARY = "_vocabulary_checks_and_hot_path_indexes";

describe("the migration's role vocabulary is pinned to @omnitwin/types", () => {
  it("gives every user-role CHECK exactly USER_ROLES", async () => {
    const sql = await migrationText(VOCABULARY);
    for (const constraint of USER_ROLE_CHECKS) {
      expect([...checkListValues(sql, constraint)].sort(), constraint)
        .toEqual([...USER_ROLES].sort());
    }
  });

  it("gives the widened audience list exactly EVENT_PLAN_AUDIENCE_ROLES", async () => {
    const sql = await migrationText(VOCABULARY);
    // The six audience CHECKs are rebuilt from one `widened` constant, so the
    // constant is what to pin; the constraint names are checked separately so
    // the set cannot quietly shrink.
    const widened = /widened constant text :=\s*'([\s\S]*?)';/u.exec(sql)?.[1];
    expect(widened, "the audience widening should declare a single shared list").toBeDefined();
    const declared = [...(widened ?? "").matchAll(/''([^']+)''/gu)].map((match) => match[1] ?? "");
    expect([...declared].sort()).toEqual([...EVENT_PLAN_AUDIENCE_ROLES].sort());
    for (const constraint of AUDIENCE_CHECKS) {
      expect(sql, `${constraint} should be rebuilt from the shared list`).toContain(constraint);
    }
  });

  it("gives the jsonb audience containment exactly EVENT_PLAN_AUDIENCE_ROLES", async () => {
    const sql = await migrationText(VOCABULARY);
    const containment = /audience_roles" <@ '\[([^\]]*)\]'::jsonb/u.exec(sql)?.[1];
    expect(containment, "the jsonb audience check should declare a containment array").toBeDefined();
    const declared = [...(containment ?? "").matchAll(/"([^"]+)"/gu)].map((match) => match[1] ?? "");
    expect([...declared].sort()).toEqual([...EVENT_PLAN_AUDIENCE_ROLES].sort());
  });

  it("keeps supplier and executive as audiences, though neither is a user role", async () => {
    // Guards the distinction itself: if someone "tidies" the audience list down
    // to USER_ROLES, a stored supplier notification stops validating.
    expect(USER_ROLES).not.toContain("supplier");
    expect(USER_ROLES).not.toContain("executive");
    expect(EVENT_PLAN_AUDIENCE_ROLES).toContain("supplier");
    expect(EVENT_PLAN_AUDIENCE_ROLES).toContain("executive");
    const sql = await migrationText(VOCABULARY);
    expect(checkListValues(sql, "users_role_check")).not.toContain("supplier");
  });
});

describe("the vocabulary migration widens safely", () => {
  it("asserts the stored audience roles by name before dropping any constraint", async () => {
    const sql = await migrationText(VOCABULARY);
    // The drop-and-re-add does revalidate, but it fails with an anonymous
    // "violated by some row" — the exact failure mode the named pre-flight
    // assertions exist to replace.
    // Read the code, not the prose: this file's own header quotes the phrase
    // below while arguing about it, which is a false match.
    const code = sqlWithoutComments(sql);
    expect(code).toContain("AUDIENCE_ROLE_VOCABULARY");
    expect(code.indexOf("AUDIENCE_ROLE_VOCABULARY"))
      .toBeLessThan(code.indexOf("DROP CONSTRAINT IF EXISTS"));
  });

  it("qualifies every pg_constraint lookup by table", async () => {
    const sql = await migrationText(VOCABULARY);
    // Constraint names are unique per table, not per database. The repo's own
    // route_atomicity_<uuid> test schemas build these same tables from
    // schema.ts, so an unqualified `conname = …` can match a constraint in
    // another schema, silently skip adding this one, and leave a same-named
    // constraint with the wrong body in place.
    const lookups = [...sqlWithoutComments(sql).matchAll(/FROM pg_constraint\s+WHERE([^)]*)\)/gu)]
      .map((match) => match[1] ?? "");
    expect(lookups.length, "the migration should look constraints up at all").toBeGreaterThan(0);
    for (const lookup of lookups) {
      expect(lookup.replace(/\s+/gu, " ").trim(), "unqualified pg_constraint lookup")
        .toContain("conrelid");
    }
  });
});

describe("the accessories reconcile migration", () => {
  const ACCESSORIES = "_accessories_reconcile";
  const UNOWNED = [
    "Ivory Tablecloth", "Rectangular Ivory Tablecloth", "Gold Organza Runner",
    "Floral Centrepiece (low)", "Acrylic Table Number", "LED Pillar Candle",
    "Gold Chair Sash", "Black Stage Skirt", "HDMI Cable (5m)", "Bottled Water (500ml)",
  ];

  it("names exactly the ten dressings removed from ACCESSORY_RULES", async () => {
    const sql = await migrationText(ACCESSORIES);
    const listed = [...(/unowned constant text\[\] := ARRAY\[([\s\S]*?)\];/u.exec(sql)?.[1] ?? "")
      .matchAll(/'([^']+)'/gu)].map((match) => match[1] ?? "");
    expect([...listed].sort()).toEqual([...UNOWNED].sort());
  });

  it("removes by that explicit list, never by 'everything not in the rules'", async () => {
    // Comments stripped: the migration explains that it is NOT derived from
    // "everything not in the rules", and that sentence matched the very
    // pattern meant to prove the predicate is not a NOT IN.
    const code = sqlWithoutComments(await migrationText(ACCESSORIES));
    // A derived predicate would also remove a row an administrator added
    // through some future catalogue screen. This one can only touch the ten.
    expect(code).toMatch(/FROM asset_accessories WHERE name = ANY \(unowned\)/u);
    expect(code).not.toMatch(/NOT IN/iu);
    expect(code).not.toMatch(/\bDROP\s+TABLE\b/iu);
    expect(code).not.toMatch(/\bTRUNCATE\b/iu);
    // And it touches no other table at all.
    const written = [...code.matchAll(/(?:DELETE FROM|INSERT INTO|UPDATE)\s+(\w+)/gu)]
      .map((match) => match[1]);
    expect([...new Set(written)]).toEqual(["asset_accessories"]);
  });

  it("reports what it removed and refuses an unexpected scope", async () => {
    const sql = await migrationText(ACCESSORIES);
    expect(sql).toContain("EXPECTED_UNOWNED_NAMES constant integer := 10");
    expect(sql).toContain("ACCESSORIES_RECONCILE_UNEXPECTED_SCOPE");
    expect(sql).toMatch(/GET DIAGNOSTICS removed = ROW_COUNT/u);
    expect(sql).toMatch(/RAISE NOTICE '[^']*row\(s\) removed'/u);
  });
});

describe("the catalogue reconcile refuses a surprise", () => {
  it("caps the retirement at the number the release plan named", async () => {
    const code = sqlWithoutComments(await migrationText("_catalogue_reconcile"));
    expect(code).toContain("EXPECTED_RETIREMENTS constant integer := 8");
    expect(code).toContain("CATALOGUE_RECONCILE_UNEXPECTED_SCOPE");
    // The count has to be taken BEFORE the loop that renames, or the guard is
    // reporting on rows it has already changed.
    expect(code.indexOf("CATALOGUE_RECONCILE_UNEXPECTED_SCOPE"))
      .toBeLessThan(code.indexOf("UPDATE asset_definitions SET name"));
  });
});
