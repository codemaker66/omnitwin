import { describe, expect, it } from "vitest";
import {
  MCP_SESSIONLESS_BUDGET,
  MCP_SESSION_BUDGET,
  MCP_SESSION_IDLE_MS,
  PublicMcpBudget,
  decodeBudgetKey,
  encodeBudgetKey,
  type BudgetKey,
} from "../services/public-mcp-budget.js";

// ---------------------------------------------------------------------------
// The public MCP's per-session budget (fix-first item 4). The route tests in
// public-mcp.test.ts drive it through real clients; these pin the window,
// session recognition and the caps that keep its memory bounded.
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-10-01T11:00:00.000Z");
const HOUR = 60 * 60_000;
const SMALL = { requests: 2, dates: 10, windowMs: HOUR };

function ids(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
  };
}

describe("PublicMcpBudget", () => {
  it("allows a conversation a year of dates an hour, and a shared address more", () => {
    expect(MCP_SESSION_BUDGET).toEqual({ requests: 60, dates: 366, windowMs: HOUR });
    expect(MCP_SESSIONLESS_BUDGET.requests).toBeGreaterThan(MCP_SESSION_BUDGET.requests);
    expect(MCP_SESSIONLESS_BUDGET.dates).toBeGreaterThan(MCP_SESSION_BUDGET.dates);
  });

  it("refuses past the allowance without spending, and starts afresh when the window ends", () => {
    const budget = new PublicMcpBudget({ session: SMALL, sessionless: SMALL });
    const key: BudgetKey = { kind: "caller", id: "203.0.113.9 agent" };
    expect(budget.chargeDates(key, 7, T0)).toEqual({ ok: true });
    expect(budget.chargeDates(key, 4, T0 + 1)).toEqual({
      ok: false, measure: "dates", limit: 10, kind: "caller", retryAtMs: T0 + HOUR,
    });
    expect(budget.chargeDates(key, 3, T0 + 2)).toEqual({ ok: true });
    expect(budget.chargeDates(key, 1, T0 + 3).ok).toBe(false);
    expect(budget.chargeDates(key, 10, T0 + HOUR)).toEqual({ ok: true });
  });

  it("counts requests and dates separately", () => {
    const budget = new PublicMcpBudget({ session: SMALL, sessionless: SMALL });
    const key: BudgetKey = { kind: "caller", id: "a" };
    expect(budget.chargeRequest(key, T0).ok).toBe(true);
    expect(budget.chargeRequest(key, T0).ok).toBe(true);
    expect(budget.chargeRequest(key, T0)).toMatchObject({ ok: false, measure: "requests", limit: 2 });
    expect(budget.chargeDates(key, 10, T0).ok).toBe(true);
  });

  it("recognises only session ids it issued, and forgets them after the idle window", () => {
    const budget = new PublicMcpBudget({ newSessionId: ids() });
    const id = budget.issueSession(T0);
    const caller = { ip: "203.0.113.9", userAgent: "assistant/1.0" };
    expect(budget.keyFor({ ...caller, sessionId: id.toUpperCase() }, T0 + 1)).toEqual({ kind: "session", id });
    expect(budget.keyFor({ ...caller, sessionId: "00000000-0000-4000-8000-999999999999" }, T0))
      .toEqual({ kind: "caller", id: "203.0.113.9 assistant/1.0" });
    expect(budget.keyFor({ ...caller, sessionId: "not-a-uuid" }, T0).kind).toBe("caller");
    expect(budget.keyFor({ ...caller, sessionId: undefined }, T0).kind).toBe("caller");
    // Use keeps it alive; idleness ends it.
    expect(budget.keyFor({ ...caller, sessionId: id }, T0 + MCP_SESSION_IDLE_MS - 1).kind).toBe("session");
    expect(budget.keyFor({ ...caller, sessionId: id }, T0 + 2 * MCP_SESSION_IDLE_MS).kind).toBe("caller");
    expect(budget.keyFor({ ...caller, sessionId: id }, T0 + 2 * MCP_SESSION_IDLE_MS + 1).kind).toBe("caller");
  });

  it("keeps a bounded number of sessions and budgets, dropping the longest unused", () => {
    const budget = new PublicMcpBudget({ newSessionId: ids(), maxSessions: 2, maxKeys: 2, session: SMALL, sessionless: SMALL });
    const caller = { ip: "198.51.100.1", userAgent: undefined };
    const first = budget.issueSession(T0);
    budget.issueSession(T0);
    budget.issueSession(T0);
    expect(budget.keyFor({ ...caller, sessionId: first }, T0).kind).toBe("caller");

    const a: BudgetKey = { kind: "caller", id: "a" };
    expect(budget.chargeRequest(a, T0).ok).toBe(true);
    expect(budget.chargeRequest(a, T0).ok).toBe(true);
    budget.chargeRequest({ kind: "caller", id: "b" }, T0);
    budget.chargeRequest({ kind: "caller", id: "c" }, T0);
    // "a" was evicted, so it starts again rather than growing the map.
    expect(budget.chargeRequest(a, T0).ok).toBe(true);
  });

  it("bounds the user agent it keys on", () => {
    const budget = new PublicMcpBudget();
    const key = budget.keyFor({ sessionId: undefined, ip: "192.0.2.1", userAgent: "x".repeat(5_000) }, T0);
    expect(key.id.length).toBeLessThan(220);
  });

  it("round-trips the key the route hands the tools, and refuses anything else", () => {
    const key: BudgetKey = { kind: "caller", id: "192.0.2.1 Mozilla/5.0 (x; y) %zz" };
    expect(decodeBudgetKey(encodeBudgetKey(key))).toEqual(key);
    expect(decodeBudgetKey(null)).toBeNull();
    expect(decodeBudgetKey("admin:everything")).toBeNull();
    expect(decodeBudgetKey("session")).toBeNull();
    expect(decodeBudgetKey("caller:%E0%A4%A")).toBeNull();
  });
});
