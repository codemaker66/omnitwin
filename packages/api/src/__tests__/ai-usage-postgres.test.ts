import Anthropic from "@anthropic-ai/sdk";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AIUsageSummarySchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { aiUsageRoutes } from "../routes/ai-usage.js";
import { HttpAIGenerationAdapter } from "../services/ai-assistant.js";
import { AnthropicAIGenerationAdapter, buildAnthropicDraftRequest } from "../services/anthropic-draft-adapter.js";
import {
  AIBudgetReachedError,
  ANTHROPIC_PRICE_TABLE,
  PostgresAIUsageMeter,
  TallyAIUsageMeter,
  reserveForAnthropicRequest,
  type AIUsageCall,
  type AIUsageHold,
  type AIUsageLog,
  type AIUsageMeter,
  type AIUsageResult,
} from "../services/ai-usage.js";
import { EVENT_BRIEF_ANSWER_SCHEMA, EVENT_BRIEF_SYSTEM_PROMPT } from "../services/event-brief-draft.js";
import { migrationText, tagEndingWith } from "./migration-text.js";

// ---------------------------------------------------------------------------
// T-656 on migrated PostgreSQL: the AI usage ledger and each venue's monthly
// allowance, where their guarantees live.
//
//   - The migration makes the ledger append-only (no update, delete or
//     truncate) and holds every row to its shape.
//   - A call through the Anthropic adapter (the real SDK, only its HTTP
//     boundary replaced) is one row: the venue, the person, the feature, the
//     model that served it, its request id, its tokens and its exact cost in
//     micro-dollars, for an answer, a refusal rescued by the fallback, a
//     refusal, a cut-off and a failure; and one structured log line with no
//     words, person or key in it.
//   - A provider that reports no usage (the bespoke HTTP gateway, here with
//     as long a name as the environment allows) is charged each call's whole
//     reservation, its row marked as an estimate, and is held to the
//     allowance like Claude.
//   - The allowance blocks at its boundary, counts only this UTC month, keeps
//     venues apart, and cannot be overshot by concurrent calls: a burst
//     reserves under a per-venue advisory lock, so exactly as many calls run
//     as their worst cases fit.
//   - A reservation left by a process that died lapses.
//   - GET /venues/:venueId/ai-usage answers the venue's own managers and
//     admins and platform admins, with the right sums; every other role, and
//     every other venue's people, are refused.
//
// Never loads .env or DATABASE_URL: only the explicit disposable platform
// cluster (127.0.0.1:55477/venviewer_platform_test), migrated by the platform
// gate and again here. Each test owns fresh venues and people.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("AI usage PostgreSQL tests require the explicit disposable platform database");
  }
}

interface LogLine { readonly level: "info" | "warn" | "error"; readonly fields: Record<string, unknown> }

function recordingLog(): { readonly log: AIUsageLog; readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  const write = (level: LogLine["level"]) => (fields: unknown): void => {
    lines.push({ level, fields: fields as Record<string, unknown> });
  };
  const log: AIUsageLog = { info: write("info"), warn: write("warn"), error: write("error") };
  return { log, lines };
}

const quiet: AIUsageLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

interface Person { readonly id: string; readonly role: string; readonly venueId: string | null; readonly platformRole: "none" | "admin" }

describe.skipIf(target === undefined)("AI usage ledger and allowance on migrated PostgreSQL", () => {
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({
      connectionString: target,
      application_name: `t656_ai_usage_${randomUUID()}`,
      max: 12,
      options: "-c statement_timeout=20000 -c lock_timeout=15000",
    });
    const name = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name;
    expect(name).toBe("venviewer_platform_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
  }, 300_000);

  afterAll(async () => { await pool.end(); });

  async function venue(): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.venues).values({ id, name: "TEST ONLY T-656 AI usage", slug: `t656-${id}`, address: "Disposable fixture" });
    return id;
  }

  async function person(role: string, venueId: string | null, platformRole: "none" | "admin" = "none"): Promise<Person> {
    const id = randomUUID();
    await db.insert(schema.users).values({ id, venueId, name: "Fixture person", email: `${id}@t656.invalid`, role, platformRole });
    return { id, role, venueId, platformRole };
  }

  function call(venueId: string, userId: string, reserveMicroUsd: number): AIUsageCall {
    return {
      venueId, userId, feature: "event_brief", provider: "anthropic", requestedModel: "claude-opus-5-5",
      priceTableVersion: ANTHROPIC_PRICE_TABLE.version, reserveMicroUsd,
    };
  }

  function spent(costMicroUsd: number): AIUsageResult {
    return {
      outcome: "ok", model: "claude-opus-5-5", requestId: null, inputTokens: 1, outputTokens: 1,
      cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costMicroUsd, attempts: [],
    };
  }

  /** A row written straight into the ledger, this month or last. */
  async function recorded(row: {
    readonly venueId: string;
    readonly userId: string;
    readonly feature: string;
    readonly outcome: string;
    readonly costMicroUsd: number;
    readonly tokens?: readonly [number, number, number, number];
    readonly at?: "this month" | "last month";
  }): Promise<void> {
    const [input, output, write, read] = row.tokens ?? [0, 0, 0, 0];
    const at = row.at === "last month"
      ? "(date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - interval '1 day'"
      : "now()";
    await pool.query(
      `INSERT INTO ai_usage_ledger (venue_id, user_id, feature, provider, requested_model, model, request_id,
         input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, outcome, cost_micro_usd,
         price_table_version, attempts, created_at)
       VALUES ($1, $2, $3, 'anthropic', 'claude-opus-5-5', 'claude-opus-5-5', NULL, $4, $5, $6, $7, $8, $9,
         'anthropic-2026-10-13', '[]'::jsonb, ${at})`,
      [row.venueId, row.userId, row.feature, input, output, write, read, row.outcome, row.costMicroUsd],
    );
  }

  async function ledgerFor(venueId: string): Promise<Record<string, unknown>[]> {
    return (await pool.query<Record<string, unknown>>(
      "SELECT * FROM ai_usage_ledger WHERE venue_id = $1 ORDER BY created_at, id", [venueId],
    )).rows;
  }

  async function heldFor(venueId: string): Promise<number> {
    const row = (await pool.query<{ held: string }>(
      "SELECT coalesce(sum(reserved_micro_usd), 0)::text AS held FROM ai_usage_reservations WHERE venue_id = $1", [venueId],
    )).rows[0];
    return Number(row?.held ?? "0");
  }

  describe("the migration", () => {
    it("is journaled, and makes the ledger append-only", async () => {
      expect(await tagEndingWith("ai_usage_ledger")).toMatch(/^\d{4}_ai_usage_ledger$/u);
      expect(await migrationText("ai_usage_ledger")).toContain("CREATE TRIGGER ai_usage_ledger_no_truncate");
      const venueId = await venue();
      // A person of no venue, so only the ledger holds the venue.
      const who = await person("admin", null);
      await recorded({ venueId, userId: who.id, feature: "event_brief", outcome: "ok", costMicroUsd: 1_000 });
      await expect(pool.query("UPDATE ai_usage_ledger SET cost_micro_usd = 0 WHERE venue_id = $1", [venueId])).rejects.toThrow(/append-only/u);
      await expect(pool.query("DELETE FROM ai_usage_ledger WHERE venue_id = $1", [venueId])).rejects.toThrow(/append-only/u);
      await expect(pool.query("TRUNCATE ai_usage_ledger")).rejects.toThrow(/append-only/u);
      expect(await ledgerFor(venueId)).toHaveLength(1);
      // A venue with usage cannot be deleted from under its rows.
      await expect(pool.query("DELETE FROM venues WHERE id = $1", [venueId])).rejects.toThrow(/ai_usage_ledger/u);
    });

    it("holds every row to its shape", async () => {
      const venueId = await venue();
      const who = await person("manager", venueId);
      const base = { venueId, userId: who.id, feature: "event_brief", outcome: "ok", costMicroUsd: 1 };
      await expect(recorded({ ...base, outcome: "free" })).rejects.toThrow(/ai_usage_ledger_outcome/u);
      await expect(recorded({ ...base, feature: "free_chat" })).rejects.toThrow(/ai_usage_ledger_feature/u);
      await expect(recorded({ ...base, costMicroUsd: -1 })).rejects.toThrow(/ai_usage_ledger_cost/u);
      await expect(recorded({ ...base, tokens: [-1, 0, 0, 0] })).rejects.toThrow(/ai_usage_ledger_tokens/u);
      // A call the allowance refused was never made: nothing used, nothing owed.
      await expect(recorded({ ...base, outcome: "budget_blocked", costMicroUsd: 0, tokens: [1, 0, 0, 0] })).rejects.toThrow(/ai_usage_ledger_blocked/u);
      await expect(recorded({ ...base, outcome: "budget_blocked", costMicroUsd: 5 })).rejects.toThrow(/ai_usage_ledger_blocked/u);
      await expect(recorded({ ...base, venueId: randomUUID() })).rejects.toThrow(/foreign key/u);
      await expect(pool.query(
        "INSERT INTO ai_usage_reservations (venue_id, reserved_micro_usd, expires_at) VALUES ($1, 0, now() + interval '1 minute')", [venueId],
      )).rejects.toThrow(/ai_usage_reservations_amount/u);
      expect(await ledgerFor(venueId)).toEqual([]);
    });
  });

  describe("calls through the Anthropic adapter", () => {
    it("records each call once, as it ended, at its exact cost, and logs counts and money only", async () => {
      const venueId = await venue();
      const who = await person("staff", venueId);
      const { log, lines } = recordingLog();
      const answers: { readonly status?: number; readonly body: unknown }[] = [
        { body: {
          id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: "Dear Morgan, thank you.", citations: null }], stop_reason: "end_turn", stop_sequence: null, stop_details: null,
          usage: { input_tokens: 1_200, output_tokens: 800, cache_creation_input_tokens: 1_000, cache_read_input_tokens: 2_000 },
        } },
        { body: {
          id: "msg_2", type: "message", role: "assistant", model: "claude-opus-4-8",
          content: [{ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } }, { type: "text", text: "Dear Morgan.", citations: null }],
          stop_reason: "end_turn", stop_sequence: null, stop_details: null,
          usage: {
            input_tokens: 412, output_tokens: 264,
            iterations: [
              { type: "message", model: "claude-opus-5-5", input_tokens: 535, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
              { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 412, output_tokens: 264, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
            ],
          },
        } },
        { body: {
          id: "msg_3", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: "refusal", stop_sequence: null,
          stop_details: { type: "refusal", category: "bio", explanation: null }, usage: { input_tokens: 300, output_tokens: 0 },
        } },
        { body: {
          id: "msg_4", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: "{\"fields\":", citations: null }], stop_reason: "max_tokens", stop_sequence: null, stop_details: null,
          usage: { input_tokens: 2_000, output_tokens: 16_000, cache_read_input_tokens: 1_100 },
        } },
        { status: 529, body: { type: "error", error: { type: "overloaded_error", message: "test overload" } } },
      ];
      let served = 0;
      const fakeFetch = vi.fn((): Promise<Response> => {
        const next = answers[served];
        served += 1;
        return Promise.resolve(new Response(JSON.stringify(next?.body ?? {}), {
          status: next?.status ?? 200,
          headers: { "content-type": "application/json", "request-id": `req_t656_${String(served)}`, "x-should-retry": "false" },
        }));
      });
      const client = new Anthropic({ apiKey: "test-key-not-real", baseURL: "https://api.anthropic.com", fetch: fakeFetch, maxRetries: 0 });
      const adapter = new AnthropicAIGenerationAdapter({
        model: "claude-opus-5-5", apiKey: "test-key-not-real",
        usage: new PostgresAIUsageMeter(db, { monthlyLimitMicroUsd: 50_000_000, log }),
        send: (request) => client.beta.messages.create(request),
      });
      const attribution = { venueId, userId: who.id };
      const draft = { useCase: "proposal_draft", instructions: "Rules.", prompt: "", context: { clientName: "Morgan" } } as const;
      const brief = { useCase: "event_brief", system: EVENT_BRIEF_SYSTEM_PROMPT, prompt: "Dinner for 80.", schema: EVENT_BRIEF_ANSWER_SCHEMA, cacheSystem: true } as const;

      await expect(adapter.generateText(draft, attribution)).resolves.toBe("Dear Morgan, thank you.");
      await expect(adapter.generateText(draft, attribution)).resolves.toBe("Dear Morgan.");
      await expect(adapter.generateText(draft, attribution)).rejects.toThrow("declined");
      await expect(adapter.generateStructured(brief, attribution)).rejects.toThrow("cut off");
      await expect(adapter.generateStructured(brief, attribution)).rejects.toBeInstanceOf(Anthropic.APIError);

      const rows = await ledgerFor(venueId);
      expect(rows.map((row) => [row["feature"], row["outcome"], row["model"], row["request_id"],
        row["input_tokens"], row["output_tokens"], row["cache_creation_input_tokens"], row["cache_read_input_tokens"], row["cost_micro_usd"]]))
        .toEqual([
          // 1,200 at $4, 1,000 written at $5, 2,000 read at $0.20 and 800 out at $20.
          ["proposal_draft", "ok", "claude-opus-5-5", "req_t656_1", 1_200, 800, 1_000, 2_000, String(4_800 + 5_000 + 400 + 16_000)],
          // Declined by Opus 5.5 (535 at $4), served by Opus 4.8 (412 at $5, 264 at $25).
          ["proposal_draft", "ok", "claude-opus-4-8", "req_t656_2", 947, 264, 0, 0, String(2_140 + 2_060 + 6_600)],
          // A biology refusal before any output is billed: 300 at $4.
          ["proposal_draft", "refusal", "claude-opus-5-5", "req_t656_3", 300, 0, 0, 0, String(1_200)],
          // Cut off: 2,000 at $4, 1,100 read at $0.20 and 16,000 out at $20.
          ["event_brief", "max_tokens", "claude-opus-5-5", "req_t656_4", 2_000, 16_000, 0, 1_100, String(8_000 + 220 + 320_000)],
          ["event_brief", "error", "claude-opus-5-5", "req_t656_5", 0, 0, 0, 0, "0"],
        ]);
      for (const row of rows) {
        expect(row).toMatchObject({ venue_id: venueId, user_id: who.id, provider: "anthropic", requested_model: "claude-opus-5-5", price_table_version: "anthropic-2026-10-13" });
      }
      const fallback = rows[1]?.["attempts"] as readonly { readonly kind: string; readonly model: string; readonly costMicroUsd: number }[];
      expect(fallback.map((attempt) => [attempt.kind, attempt.model, attempt.costMicroUsd]))
        .toEqual([["message", "claude-opus-5-5", 2_140], ["fallback_message", "claude-opus-4-8", 8_660]]);
      expect(JSON.stringify(rows)).not.toMatch(/Morgan|Dinner for 80/u);
      expect(await heldFor(venueId)).toBe(0);

      const recordedLines = lines.filter((line) => line.level === "info" && line.fields["event"] === "ai_usage");
      expect(recordedLines).toHaveLength(5);
      expect(recordedLines[0]?.fields).toEqual({
        event: "ai_usage", feature: "proposal_draft", provider: "anthropic", model: "claude-opus-5-5", requestedModel: "claude-opus-5-5",
        outcome: "ok", venueId, requestId: "req_t656_1", inputTokens: 1_200, outputTokens: 800,
        cacheCreationInputTokens: 1_000, cacheReadInputTokens: 2_000, costMicroUsd: 26_200, priceTableVersion: "anthropic-2026-10-13",
      });
      expect(JSON.stringify(lines)).not.toMatch(new RegExp(`Morgan|Dinner for 80|test-key-not-real|${who.id}`, "u"));
    });
  });

  describe("a provider that reports no usage (the bespoke HTTP gateway)", () => {
    it("is charged each call's whole reservation, marked as an estimate, and held to the allowance", async () => {
      const venueId = await venue();
      const who = await person("staff", venueId);
      const attribution = { venueId, userId: who.id };
      const { log, lines } = recordingLog();
      // As long a provider name as AI_ASSISTANT_PROVIDER allows: 80 characters.
      const provider = `gateway-${"g".repeat(72)}`;
      const input = { useCase: "enquiry_summary", instructions: "Rules.", prompt: "Rules. Ninety guests.", context: { guests: 90 } } as const;
      const send = vi.fn((): Promise<Response> => Promise.resolve(new Response(JSON.stringify({ text: "Ninety guests." }), {
        status: 200, headers: { "content-type": "application/json" },
      })));
      const gatewayOver = (usage: AIUsageMeter): HttpAIGenerationAdapter => new HttpAIGenerationAdapter({
        provider, model: "gateway-model", baseUrl: "https://ai.example.test/draft", apiKey: "test-key-not-real", usage, send,
      });
      // What one call is charged, learnt in memory first: the allowance then fits exactly two.
      const probe = new TallyAIUsageMeter();
      await gatewayOver(probe).generateText(input, attribution);
      const charge = probe.costMicroUsd;
      const gateway = gatewayOver(new PostgresAIUsageMeter(db, { monthlyLimitMicroUsd: 2 * charge, log }));

      await expect(gateway.generateText(input, attribution)).resolves.toBe("Ninety guests.");
      await expect(gateway.generateText(input, attribution)).resolves.toBe("Ninety guests.");
      await expect(gateway.generateText(input, attribution)).rejects.toBeInstanceOf(AIBudgetReachedError);
      // The probe's call and two more: the third was never sent.
      expect(send).toHaveBeenCalledTimes(3);

      const rows = await ledgerFor(venueId);
      expect(rows.map((row) => [row["provider"], row["outcome"], row["model"], row["input_tokens"], row["output_tokens"], row["cost_micro_usd"]]))
        .toEqual([
          [provider, "ok", "gateway-model", 0, 0, String(charge)],
          [provider, "ok", "gateway-model", 0, 0, String(charge)],
          [provider, "budget_blocked", "gateway-model", 0, 0, "0"],
        ]);
      for (const row of rows.slice(0, 2)) {
        expect(row["attempts"]).toEqual([expect.objectContaining({ priced: "estimate", billed: true, costMicroUsd: charge })]);
      }
      expect(lines.filter((line) => line.level === "warn" && line.fields["event"] === "ai_usage_estimated")).toHaveLength(2);
      expect(await heldFor(venueId)).toBe(0);
    });
  });

  describe("the allowance", () => {
    it("lets a call through only while its worst case fits this month's allowance, to the micro-dollar", async () => {
      const venueId = await venue();
      const otherVenueId = await venue();
      const who = await person("staff", venueId);
      const elsewhere = await person("staff", otherVenueId);
      const { log, lines } = recordingLog();
      const meter = new PostgresAIUsageMeter(db, { monthlyLimitMicroUsd: 1_000_000, log });
      await recorded({ venueId, userId: who.id, feature: "event_brief", outcome: "ok", costMicroUsd: 900_000, at: "last month" });
      await recorded({ venueId, userId: who.id, feature: "event_brief", outcome: "ok", costMicroUsd: 600_000 });

      // 600,000 spent this month and 400,000 reserved is exactly the allowance: allowed.
      const first = await meter.hold(call(venueId, who.id, 400_000));
      expect(await heldFor(venueId)).toBe(400_000);
      // One micro-dollar more is not.
      await expect(meter.hold(call(venueId, who.id, 1))).rejects.toBeInstanceOf(AIBudgetReachedError);
      // Another venue's allowance is its own.
      const theirs = await meter.hold(call(otherVenueId, elsewhere.id, 999_999));

      // The first call cost 100,000 of the 400,000 it held; settling twice records it once.
      await first.settle(spent(100_000));
      await first.settle(spent(100_000));
      expect(await heldFor(venueId)).toBe(0);
      const last = await meter.hold(call(venueId, who.id, 300_000));
      await expect(meter.hold(call(venueId, who.id, 1))).rejects.toBeInstanceOf(AIBudgetReachedError);
      await last.settle(spent(300_000));
      await theirs.settle(spent(1));

      const rows = await ledgerFor(venueId);
      expect(rows.map((row) => [row["outcome"], row["cost_micro_usd"]])).toEqual([
        ["ok", "900000"], ["ok", "600000"], ["budget_blocked", "0"], ["ok", "100000"], ["budget_blocked", "0"], ["ok", "300000"],
      ]);
      for (const row of rows.filter((entry) => entry["outcome"] === "budget_blocked")) {
        expect(row).toMatchObject({ input_tokens: 0, output_tokens: 0, request_id: null, model: "claude-opus-5-5", feature: "event_brief" });
      }
      const refused = lines.filter((line) => line.level === "warn");
      expect(refused).toHaveLength(2);
      expect(refused[0]?.fields).toMatchObject({
        event: "ai_usage", outcome: "budget_blocked", venueId, spentMicroUsd: 600_000, heldMicroUsd: 400_000, reserveMicroUsd: 1, limitMicroUsd: 1_000_000,
      });
    });

    it("lets exactly as many concurrent calls run as their worst cases fit, and refuses the rest", async () => {
      const venueId = await venue();
      const who = await person("staff", venueId);
      const meter = new PostgresAIUsageMeter(db, { monthlyLimitMicroUsd: 500_000, log: quiet });
      const burst = await Promise.allSettled(Array.from({ length: 20 }, () => meter.hold(call(venueId, who.id, 100_000))));
      const held = burst.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
      const refusals = burst.flatMap((outcome) => outcome.status === "rejected" ? [outcome.reason as unknown] : []);
      expect(held).toHaveLength(5);
      expect(refusals).toHaveLength(15);
      expect(refusals.every((reason) => reason instanceof AIBudgetReachedError)).toBe(true);
      expect(await heldFor(venueId)).toBe(500_000);
      // Each spends its whole worst case: the month lands on the allowance, never past it.
      await Promise.all(held.map((hold) => hold.settle(spent(100_000))));
      await expect(meter.hold(call(venueId, who.id, 1))).rejects.toBeInstanceOf(AIBudgetReachedError);
      const rows = await ledgerFor(venueId);
      expect(rows.filter((row) => row["outcome"] === "ok")).toHaveLength(5);
      expect(rows.filter((row) => row["outcome"] === "budget_blocked")).toHaveLength(16);
      expect(rows.reduce((total, row) => total + Number(row["cost_micro_usd"]), 0)).toBe(500_000);
    });

    it("sends only the drafts whose worst cases fit when a burst arrives at once", async () => {
      const venueId = await venue();
      const who = await person("staff", venueId);
      const input = { useCase: "enquiry_summary", instructions: "Rules.", prompt: "", context: { guests: 90 } } as const;
      const reserve = reserveForAnthropicRequest(ANTHROPIC_PRICE_TABLE, buildAnthropicDraftRequest("claude-opus-5-5", input));
      const BURST = 10;
      // Every allowance decision is made before any call answers, so none of
      // the answered calls' (small) real costs can free room mid-burst.
      let decided = 0;
      let release: () => void = () => undefined;
      const allDecided = new Promise<void>((done) => { release = done; });
      const inner = new PostgresAIUsageMeter(db, { monthlyLimitMicroUsd: 3 * reserve, log: quiet });
      const counted: AIUsageMeter = {
        hold: async (request: AIUsageCall): Promise<AIUsageHold> => {
          try {
            return await inner.hold(request);
          } finally {
            decided += 1;
            if (decided === BURST) release();
          }
        },
      };
      const burstFetch = vi.fn(async (): Promise<Response> => {
        await allDecided;
        return new Response(JSON.stringify({
          id: "msg_burst", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: "Ninety guests.", citations: null }], stop_reason: "end_turn", stop_sequence: null, stop_details: null,
          usage: { input_tokens: 100, output_tokens: 100 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      });
      const client = new Anthropic({ apiKey: "test-key-not-real", baseURL: "https://api.anthropic.com", fetch: burstFetch, maxRetries: 0 });
      const adapter = new AnthropicAIGenerationAdapter({
        model: "claude-opus-5-5", apiKey: "test-key-not-real", usage: counted, send: (request) => client.beta.messages.create(request),
      });
      const burst = await Promise.allSettled(Array.from({ length: BURST }, () => adapter.generateText(input, { venueId, userId: who.id })));
      expect(burst.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(3);
      expect(burst.filter((outcome) => outcome.status === "rejected" && outcome.reason instanceof AIBudgetReachedError)).toHaveLength(7);
      expect(burstFetch).toHaveBeenCalledTimes(3);
      const rows = await ledgerFor(venueId);
      expect(rows.filter((row) => row["outcome"] === "ok")).toHaveLength(3);
      expect(rows.filter((row) => row["outcome"] === "budget_blocked")).toHaveLength(7);
      // 100 in at $4 and 100 out at $20, three times.
      expect(rows.reduce((total, row) => total + Number(row["cost_micro_usd"]), 0)).toBe(3 * (400 + 2_000));
      expect(await heldFor(venueId)).toBe(0);
    });

    it("lets a reservation left by a process that died lapse", async () => {
      const venueId = await venue();
      const who = await person("staff", venueId);
      await pool.query(
        `INSERT INTO ai_usage_reservations (venue_id, reserved_micro_usd, created_at, expires_at)
         VALUES ($1, 1000000, now() - interval '20 minutes', now() - interval '10 minutes')`,
        [venueId],
      );
      const meter = new PostgresAIUsageMeter(db, { monthlyLimitMicroUsd: 1_000_000, log: quiet });
      const hold = await meter.hold(call(venueId, who.id, 1_000_000));
      expect(await heldFor(venueId)).toBe(1_000_000);
      expect((await pool.query("SELECT count(*)::int AS n FROM ai_usage_reservations WHERE venue_id = $1 AND expires_at <= now()", [venueId])).rows[0])
        .toEqual({ n: 0 });
      await hold.settle(spent(5));
      expect(await heldFor(venueId)).toBe(0);
    });
  });

  describe("GET /venues/:venueId/ai-usage", () => {
    let server: FastifyInstance;
    let venueId: string;
    let otherVenueId: string;
    const people = new Map<string, Person>();

    beforeAll(async () => {
      venueId = await venue();
      otherVenueId = await venue();
      for (const role of ["manager", "admin", "staff", "sales", "hallkeeper", "client", "planner"]) {
        people.set(role, await person(role, venueId));
      }
      people.set("elsewhere", await person("manager", otherVenueId));
      people.set("platform", await person("admin", null, "admin"));
      const by = member("staff").id;
      await recorded({ venueId, userId: by, feature: "event_brief", outcome: "ok", costMicroUsd: 1_000, tokens: [100, 50, 10, 20] });
      await recorded({ venueId, userId: by, feature: "event_brief", outcome: "refusal", costMicroUsd: 0, tokens: [30, 0, 0, 0] });
      await recorded({ venueId, userId: by, feature: "proposal_draft", outcome: "ok", costMicroUsd: 2_000, tokens: [200, 100, 0, 0] });
      await recorded({ venueId, userId: by, feature: "proposal_draft", outcome: "budget_blocked", costMicroUsd: 0 });
      await recorded({ venueId, userId: by, feature: "event_brief", outcome: "ok", costMicroUsd: 5_000, tokens: [500, 250, 0, 0], at: "last month" });
      await recorded({ venueId: otherVenueId, userId: member("elsewhere").id, feature: "event_brief", outcome: "ok", costMicroUsd: 99_999 });
      await pool.query("INSERT INTO ai_usage_reservations (venue_id, reserved_micro_usd, expires_at) VALUES ($1, 300, now() + interval '5 minutes')", [venueId]);
      server = Fastify();
      await server.register(aiUsageRoutes, { db, env: { AI_VENUE_MONTHLY_BUDGET_USD: 50 }, prefix: "/venues" });
      await server.ready();
    }, 120_000);

    afterAll(async () => { await server.close(); });

    function member(key: string): Person {
      const who = people.get(key);
      if (who === undefined) throw new Error(`fixture person ${key} missing`);
      return who;
    }

    function signedIn(key: string): { authorization: string } {
      const who = member(key);
      return { authorization: `Bearer ${JSON.stringify({ id: who.id, email: `${who.id}@t656.invalid`, role: who.role, platformRole: who.platformRole, venueId: who.venueId })}` };
    }

    async function read(key: string, forVenue: string, query = "?months=2") {
      const res = await server.inject({ method: "GET", url: `/venues/${forVenue}/ai-usage${query}`, headers: signedIn(key) });
      return { statusCode: res.statusCode, body: res.json<Record<string, unknown>>() };
    }

    it("answers the venue's manager with its usage by month and feature, and this month's allowance", async () => {
      const res = await read("manager", venueId);
      expect(res.statusCode).toBe(200);
      const summary = AIUsageSummarySchema.parse(res.body["data"]);
      expect(summary.allowance).toMatchObject({ limitMicroUsd: 50_000_000, spentMicroUsd: 3_000, heldMicroUsd: 300, remainingMicroUsd: 49_996_700 });
      expect(summary.months).toHaveLength(2);
      expect(summary.months[0]?.month).toBe(summary.allowance.month);
      expect(summary.months[0]).toMatchObject({ calls: 3, costMicroUsd: 3_000 });
      expect(summary.months[0]?.features).toEqual([
        {
          feature: "proposal_draft", calls: 1, outcomes: { ok: 1, refusal: 0, max_tokens: 0, error: 0, budget_blocked: 1 },
          inputTokens: 200, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costMicroUsd: 2_000,
        },
        {
          feature: "event_brief", calls: 2, outcomes: { ok: 1, refusal: 1, max_tokens: 0, error: 0, budget_blocked: 0 },
          inputTokens: 130, outputTokens: 50, cacheCreationInputTokens: 10, cacheReadInputTokens: 20, costMicroUsd: 1_000,
        },
      ]);
      expect(summary.months[1]).toMatchObject({ calls: 1, costMicroUsd: 5_000 });
      // Another venue's 99,999 is nowhere in it: only this venue's 3,000 and 5,000.
      const features = summary.months.flatMap((month) => month.features);
      expect(features.reduce((sum, feature) => sum + feature.costMicroUsd, 0)).toBe(8_000);
    });

    it("answers the venue's admin, and a platform admin for any venue", async () => {
      expect((await read("admin", venueId)).statusCode).toBe(200);
      expect((await read("platform", venueId)).statusCode).toBe(200);
      const theirs = await read("platform", otherVenueId);
      expect(theirs.statusCode).toBe(200);
      expect(AIUsageSummarySchema.parse(theirs.body["data"]).allowance.spentMicroUsd).toBe(99_999);
    });

    it.each(["staff", "sales", "hallkeeper", "client", "planner"])("refuses the venue's %s: what AI costs is for its managers", async (key) => {
      const res = await read(key, venueId);
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: "Insufficient permissions", code: "FORBIDDEN" });
    });

    it("refuses another venue's manager, and a manager asking for another venue", async () => {
      expect((await read("elsewhere", venueId)).statusCode).toBe(403);
      expect((await read("manager", otherVenueId)).statusCode).toBe(403);
    });

    it("refuses what is not a question it answers", async () => {
      expect((await read("manager", venueId, "?months=0")).statusCode).toBe(400);
      expect((await read("manager", venueId, "?months=25")).statusCode).toBe(400);
      expect((await read("manager", venueId, "?months=2&venueId=x")).statusCode).toBe(400);
      expect((await read("manager", "not-a-venue")).statusCode).toBe(400);
      expect((await read("platform", randomUUID())).statusCode).toBe(404);
      const anonymous = await server.inject({ method: "GET", url: `/venues/${venueId}/ai-usage` });
      expect(anonymous.statusCode).toBe(401);
    });
  });
});
