import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("proof-carrying Event Architect integration", () => {
  it("keeps frozen facts server-owned and every route authenticated", async () => {
    const source = await readFile(resolve("src/routes/event-architect.ts"), "utf8");
    expect(source).toContain('server.post("/runs", { preHandler: [authenticate] }');
    expect(source).toContain('server.get("/runs/:runId", { preHandler: [authenticate] }');
    expect(source).toContain('server.post("/candidates/:candidateId/select", { preHandler: [authenticate] }');
    expect(source).toContain("CreateEventArchitectRunInputSchema.safeParse(request.body)");
    expect(source).not.toContain("EventArchitectRequestSchema.safeParse(request.body)");
    expect(source).toContain('code: "NOT_FOUND"');
  });

  it("materialises candidates, snapshots, validation, and revisions atomically", async () => {
    const source = await readFile(resolve("src/services/event-architect.ts"), "utf8");
    expect(source).toContain("return db.transaction(async (tx) =>");
    expect(source).toContain("tx.insert(configurations)");
    expect(source).toContain("tx.insert(placedObjects)");
    expect(source).toContain("tx.insert(configurationLayoutRevisions)");
    expect(source).toContain("tx.insert(canonicalLayoutSnapshots)");
    expect(source).toContain("tx.insert(layoutValidationRuns)");
    expect(source).toContain("tx.insert(eventArchitectCandidates)");
    expect(source).toContain("pricingCatalogue: null");
    expect(source).toContain("assertCatalogueReady");
    expect(source).not.toContain("compliance");
    expect(source).not.toContain("certif");
  });

  it("persists digest and selection invariants at the database boundary", async () => {
    const sql = await readFile(resolve("drizzle/0047_event_architect_proof.sql"), "utf8");
    expect(sql).toContain('CREATE TABLE "canonical_layout_snapshots"');
    expect(sql).toContain('CREATE TABLE "layout_validation_runs"');
    expect(sql).toContain('CREATE TABLE "event_architect_runs"');
    expect(sql).toContain('CREATE TABLE "event_architect_candidates"');
    expect(sql).toContain('"event_architect_runs_actor_idempotency_unique"');
    expect(sql).toContain('"event_architect_runs_selection_complete"');
    expect(sql).toContain('"event_architect_candidates_rank_range"');
    expect(sql).toContain("^[a-f0-9]{64}$");
  });
});
