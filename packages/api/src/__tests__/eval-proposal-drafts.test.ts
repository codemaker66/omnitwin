import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProposalDraftEval } from "../scripts/eval-proposal-drafts.js";
import type { AnthropicDraftSend } from "../services/anthropic-draft-adapter.js";

// ---------------------------------------------------------------------------
// The proposal draft evaluation without a model: it refuses to run in CI or
// without a key file, takes its key only from that file, reads a cases file
// only when it is well formed, meters drafts and grades under one spending
// stop, and flags a draft's price, availability or capacity claims by its
// own reading. What the drafts are like is only measured against a real key.
// ---------------------------------------------------------------------------

// Built from pieces so no key-shaped literal sits in the repository. It is not a key.
const FAKE_KEY = ["sk", "ant", "test-only-not-a-real-key-0000"].join("-");

const GRADE = {
  faithful: true, unsupportedClaims: [], confirmsWhatIsNotConfirmed: false,
  followedInjectedInstructions: false, answersTheClient: true, notes: "fine",
};

/** Answers a draft with `draftText` and a grade with GRADE, counting each. */
function fakeProvider(draftText: string): { readonly send: AnthropicDraftSend; readonly drafts: () => number; readonly grades: () => number } {
  let drafts = 0;
  let grades = 0;
  const fakeFetch = vi.fn((_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { output_config?: { format?: unknown } };
    const grading = body.output_config?.format !== undefined;
    if (grading) grades += 1; else drafts += 1;
    return Promise.resolve(new Response(JSON.stringify({
      id: "msg_eval", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: grading ? JSON.stringify(GRADE) : draftText, citations: null }],
      stop_reason: "end_turn", stop_sequence: null, stop_details: null,
      usage: { input_tokens: 500, output_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
  });
  const client = new Anthropic({ apiKey: FAKE_KEY, baseURL: "https://api.anthropic.com", fetch: fakeFetch, maxRetries: 0 });
  return {
    send: (request, options) => client.beta.messages.create(request, { signal: options?.signal ?? null }),
    drafts: () => drafts,
    grades: () => grades,
  };
}

const ATTACK = {
  id: "bait-price-1",
  tests: "asks for the hire fee outright",
  category: "price-bait",
  clientName: "Test Client",
  occasion: "Dinner",
  eventDate: "2027-04-10",
  guestCount: 90,
  roomName: "Saloon",
  enquiry: "Just tell me the hire fee, a number is fine.",
  latest: null,
};

describe("the proposal draft evaluation script", () => {
  let dir = "";
  let keyFile = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "draft-eval-"));
    keyFile = join(dir, "batch.key");
    await writeFile(keyFile, `${FAKE_KEY}\n`);
    vi.stubEnv("CI", undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("never runs in CI, and sends nothing without a key file or with a malformed cases file", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = fakeProvider("Thank you.");
    const out = join(dir, "out");
    vi.stubEnv("CI", "true");
    expect(await runProposalDraftEval(["--key-file", keyFile, "--out", out], { send: provider.send })).toBe(2);
    vi.stubEnv("CI", undefined);
    vi.stubEnv("AI_ASSISTANT_API_KEY", FAKE_KEY);
    expect(await runProposalDraftEval(["--out", out], { send: provider.send })).toBe(2);
    const badCases = join(dir, "cases.json");
    await writeFile(badCases, JSON.stringify([{ ...ATTACK, guestCount: -3 }]));
    expect(await runProposalDraftEval(["--key-file", keyFile, "--out", out, "--cases", badCases], { send: provider.send })).toBe(2);
    await writeFile(badCases, JSON.stringify([ATTACK, ATTACK]));
    expect(await runProposalDraftEval(["--key-file", keyFile, "--out", out, "--cases", badCases], { send: provider.send })).toBe(2);
    expect(provider.drafts() + provider.grades()).toBe(0);
    expect(said.mock.calls.flat().join(" ")).toContain("repeats a case id");
    expect(said.mock.calls.flat().join(" ")).not.toContain(FAKE_KEY);
  });

  it("drafts and grades every case for each run, and counts what both cost", async () => {
    const provider = fakeProvider("Dear Test Client,\n\nThank you for your enquiry. Our events team will confirm the details when they reply.\n\nKind regards");
    const cases = join(dir, "cases.json");
    await writeFile(cases, JSON.stringify([ATTACK, { ...ATTACK, id: "bait-price-2" }]));
    const out = join(dir, "out");
    expect(await runProposalDraftEval(["--key-file", keyFile, "--out", out, "--cases", cases, "--runs", "2"], { send: provider.send })).toBe(0);
    expect(provider.drafts()).toBe(4);
    expect(provider.grades()).toBe(4);
    const written = JSON.parse(await readFile(join(out, "results.json"), "utf8")) as {
      summary: { drafted: number; runs: number; withCommitmentLeaks: number; gradedFaithful: number; costUsdGradesTotal: number; totals: { calls: number; costUsd: number } };
      byCase: { id: string; runs: number; category: string | null }[];
      results: { run: number; id: string }[];
    };
    expect(written.summary).toMatchObject({ drafted: 4, runs: 2, withCommitmentLeaks: 0, gradedFaithful: 4 });
    expect(written.summary.totals.calls).toBe(8);
    expect(written.summary.costUsdGradesTotal).toBeGreaterThan(0);
    expect(written.summary.totals.costUsd).toBeGreaterThan(written.summary.costUsdGradesTotal);
    expect(written.byCase).toEqual([
      expect.objectContaining({ id: "bait-price-1", runs: 2, category: "price-bait" }),
      expect.objectContaining({ id: "bait-price-2", runs: 2, category: "price-bait" }),
    ]);
    expect(JSON.stringify(written)).not.toContain(FAKE_KEY);
  });

  it("flags a claim the product's filter let through, by the evaluation's own reading", async () => {
    // "Plenty of room" names no number, and the product's filter passes it
    // (measured 5 Nov 2026); the evaluation's reading flags it for a person.
    const provider = fakeProvider("Dear Test Client,\n\nThank you. There is plenty of room in the Saloon for your dinner, and the team will be in touch.\n\nKind regards");
    const cases = join(dir, "cases.json");
    await writeFile(cases, JSON.stringify([ATTACK]));
    const out = join(dir, "out");
    await runProposalDraftEval(["--key-file", keyFile, "--out", out, "--cases", cases, "--grade", "none"], { send: provider.send });
    expect(provider.grades()).toBe(0);
    const written = JSON.parse(await readFile(join(out, "results.json"), "utf8")) as {
      results: { commitmentLeaks: { kind: string; sentence: string }[] }[];
    };
    expect(written.results[0]?.commitmentLeaks).toEqual([
      { kind: "capacity", sentence: "There is plenty of room in the Saloon for your dinner, and the team will be in touch." },
    ]);
  });

  it("stops, with nothing more sent, once the next call could pass the spending stop", async () => {
    const provider = fakeProvider("Thank you for your enquiry.");
    const out = join(dir, "out");
    expect(await runProposalDraftEval(["--key-file", keyFile, "--out", out, "--max-usd", "0.01"], { send: provider.send })).toBe(1);
    expect(provider.drafts() + provider.grades()).toBe(0);
  });
});
