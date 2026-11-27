import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// GHSA-mrhx-c7xc-m3w5, replayed against signed-in routes: a 1 MiB body that is
// one long list of bad elements (the server takes up to 2 MB). Without a
// ceiling zod reports one issue per element: 349,521 issues, about +100 MB of
// heap and a reply tens of megabytes long (.claude/gotchas/zod4-semantics.md).
// With one, the refusal names the list once and the reply stays small. Each
// route validates its body before it reads the database, so a mock database
// is enough; nothing is written.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

const VENUE = "00000000-0000-4000-8000-0000000000a1";
const LOADOUT = "00000000-0000-4000-8000-0000000000b1";

function bearer(role: string): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id: `u-${role}`, email: `${role}@example.test`, role, platformRole: "none", venueId: VENUE })}` };
}

/** 349,521 empty objects as a JSON array: just over 1 MiB. */
const MEBIBYTE_LIST = `[${"{},".repeat(349_520)}{}]`;

interface Refusal {
  readonly status: number;
  readonly bytes: number;
  readonly details: readonly { readonly code: string; readonly path: readonly (string | number)[]; readonly maximum?: number }[];
}

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

async function send(method: "GET" | "POST", url: string, role: string, payload?: string): Promise<Refusal> {
  const res = await server.inject({
    method, url, headers: { ...bearer(role), ...(payload === undefined ? {} : { "content-type": "application/json" }) },
    ...(payload === undefined ? {} : { payload }),
  });
  const body = res.json<{ details?: Refusal["details"] }>();
  return { status: res.statusCode, bytes: res.payload.length, details: body.details ?? [] };
}

describe("a 1 MiB list against a signed-in route", () => {
  it("refuses a loadout's photo order with one issue, not one per element", async () => {
    const payload = `{"photoIds":${MEBIBYTE_LIST}}`;
    expect(payload.length).toBeGreaterThan(1_048_576);

    const refused = await send("POST", `/loadouts/${LOADOUT}/photos/reorder`, "staff", payload);

    expect(refused.status).toBe(400);
    expect(refused.details).toHaveLength(1);
    expect(refused.details[0]).toMatchObject({ code: "too_big", path: ["photoIds"], maximum: 500 });
    expect(refused.bytes).toBeLessThan(1_000);
  });

  it("refuses a pricing rule's tiers the same way", async () => {
    const payload = `{"name":"Grand Hall evening","type":"flat_rate","amount":2800,"tiers":${MEBIBYTE_LIST}}`;

    const refused = await send("POST", `/venues/${VENUE}/pricing`, "manager", payload);

    expect(refused.status).toBe(400);
    expect(refused.details.filter((issue) => issue.code === "too_big" && issue.path.join(".") === "tiers")).toHaveLength(1);
    expect(refused.details.length).toBeLessThan(10);
    expect(refused.bytes).toBeLessThan(2_000);
  });

  it("refuses an AI draft's context by its size, before it is read", async () => {
    const payload = `{"useCase":"enquiry_summary","context":{"items":${MEBIBYTE_LIST}}}`;

    const refused = await send("POST", "/ai/drafts", "staff", payload);

    expect(refused.status).toBe(400);
    expect(refused.details).toHaveLength(1);
    expect(refused.details[0]).toMatchObject({ code: "too_big", path: ["context"] });
    expect(refused.bytes).toBeLessThan(1_000);
  });

  it("refuses an enquiry states filter longer than the states there are", async () => {
    const states = Array.from({ length: 1_500 }, (_, index) => `s${String(index)}`).join(",");

    const refused = await send("GET", `/enquiries?states=${states}`, "staff");

    expect(refused.status).toBe(400);
    expect(refused.details).toHaveLength(1);
    expect(refused.details[0]).toMatchObject({ code: "too_big", path: ["states"] });
  });
});
