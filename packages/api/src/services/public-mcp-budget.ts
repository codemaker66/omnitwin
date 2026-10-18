import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// A per-session budget for the public MCP (fix-first item 4, 16 October 2026),
// on top of the shared per-IP rate limit.
//
// The per-IP limit (120 a minute) guards the server's CPU; it is generous on
// purpose, because AI assistants call from shared cloud addresses. It does
// nothing to stop one conversation from walking the whole two-year diary:
// 731 dates is eight calls. This budget bounds what one session may ask in an
// hour, in requests and in dates of availability read.
//
// What a "session" is. The transport is stateless, so the SDK issues none.
// For 2025-era clients (the initialize handshake, which is what assistants'
// connectors speak today) the route issues an Mcp-Session-Id on the
// initialize answer; the protocol obliges the client to send it back on every
// later request, and the stateless transport ignores it. Only ids this
// process issued count: an id nobody issued is treated as no id, so making
// one up per request buys nothing. A caller with no recognised session
// (2026-07-28 clients have no handshake, and scripts may skip it) is budgeted
// by its address and user agent together, with a larger allowance because
// several people's conversations can share one assistant's address.
//
// Limits. A determined caller can still open a new session per handshake, so
// this is a bound on a session, not on a person; the per-IP limit stays the
// floor beneath it. State is in memory, per API process, like the rate
// limiter's own store, and every map is capped so callers cannot grow it.
// ---------------------------------------------------------------------------

export interface BudgetLimits {
  /** MCP requests (any POST) per window. */
  readonly requests: number;
  /** Dates of availability, summed over check_availability answers, per window. */
  readonly dates: number;
  readonly windowMs: number;
}

const HOUR_MS = 60 * 60_000;

/** One recognised session: an assistant's conversation. A year of dates, or
 *  four full 92-day questions, in an hour. */
export const MCP_SESSION_BUDGET: BudgetLimits = { requests: 60, dates: 366, windowMs: HOUR_MS };
/** A caller with no recognised session, by address and user agent. Larger,
 *  because several people's conversations can share one assistant's address. */
export const MCP_SESSIONLESS_BUDGET: BudgetLimits = { requests: 240, dates: 732, windowMs: HOUR_MS };

/** How long an issued session id stays recognised after its last use. */
export const MCP_SESSION_IDLE_MS = 24 * HOUR_MS;
const MAX_SESSIONS = 20_000;
const MAX_BUDGET_KEYS = 20_000;
const USER_AGENT_KEY_LENGTH = 200;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Whose budget a request draws on. */
export interface BudgetKey {
  readonly kind: "session" | "caller";
  readonly id: string;
}

export type BudgetDecision =
  | { readonly ok: true }
  | {
    readonly ok: false;
    /** Which allowance ran out, and its size. */
    readonly measure: "requests" | "dates";
    readonly limit: number;
    readonly kind: BudgetKey["kind"];
    /** When the window that ran out ends. */
    readonly retryAtMs: number;
  };

interface Usage {
  readonly startedAtMs: number;
  requests: number;
  dates: number;
}

export interface PublicMcpBudgetOptions {
  readonly session?: BudgetLimits;
  readonly sessionless?: BudgetLimits;
  readonly maxSessions?: number;
  readonly maxKeys?: number;
  readonly sessionIdleMs?: number;
  readonly newSessionId?: () => string;
}

/** Map with insertion-order eviction: touching an entry moves it to the end. */
function touch<V>(map: Map<string, V>, key: string, value: V, cap: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > cap) {
    const oldest = map.keys().next();
    if (oldest.done === true) break;
    map.delete(oldest.value);
  }
}

export class PublicMcpBudget {
  private readonly limits: Readonly<Record<BudgetKey["kind"], BudgetLimits>>;
  private readonly maxSessions: number;
  private readonly maxKeys: number;
  private readonly sessionIdleMs: number;
  private readonly newSessionId: () => string;
  /** Issued session id → when it was last used. */
  private readonly sessions = new Map<string, number>();
  private readonly usage = new Map<string, Usage>();

  constructor(options: PublicMcpBudgetOptions = {}) {
    this.limits = {
      session: options.session ?? MCP_SESSION_BUDGET,
      caller: options.sessionless ?? MCP_SESSIONLESS_BUDGET,
    };
    this.maxSessions = options.maxSessions ?? MAX_SESSIONS;
    this.maxKeys = options.maxKeys ?? MAX_BUDGET_KEYS;
    this.sessionIdleMs = options.sessionIdleMs ?? MCP_SESSION_IDLE_MS;
    this.newSessionId = options.newSessionId ?? randomUUID;
  }

  limitsFor(kind: BudgetKey["kind"]): BudgetLimits {
    return this.limits[kind];
  }

  /** A new session id for an initialize answer. */
  issueSession(nowMs: number): string {
    const id = this.newSessionId();
    touch(this.sessions, id, nowMs, this.maxSessions);
    return id;
  }

  /** The budget a request draws on: its session when it carries an id this
   *  process issued and has seen within the idle window, otherwise its
   *  address and user agent. */
  keyFor(input: {
    readonly sessionId: string | undefined;
    readonly ip: string;
    readonly userAgent: string | undefined;
  }, nowMs: number): BudgetKey {
    const id = input.sessionId?.trim().toLowerCase();
    if (id !== undefined && SESSION_ID_PATTERN.test(id)) {
      const lastSeen = this.sessions.get(id);
      if (lastSeen !== undefined && nowMs - lastSeen < this.sessionIdleMs) {
        touch(this.sessions, id, nowMs, this.maxSessions);
        return { kind: "session", id };
      }
      if (lastSeen !== undefined) this.sessions.delete(id);
    }
    const agent = (input.userAgent ?? "").slice(0, USER_AGENT_KEY_LENGTH);
    return { kind: "caller", id: `${input.ip} ${agent}` };
  }

  /** Spends one request, or refuses without spending it. */
  chargeRequest(key: BudgetKey, nowMs: number): BudgetDecision {
    return this.charge(key, "requests", 1, nowMs);
  }

  /** Spends `dates` dates of availability, or refuses without spending any,
   *  so a smaller question can still fit in what is left. */
  chargeDates(key: BudgetKey, dates: number, nowMs: number): BudgetDecision {
    return this.charge(key, "dates", Math.max(0, Math.ceil(dates)), nowMs);
  }

  private charge(key: BudgetKey, measure: "requests" | "dates", cost: number, nowMs: number): BudgetDecision {
    const limits = this.limits[key.kind];
    const slot = `${key.kind}:${key.id}`;
    const existing = this.usage.get(slot);
    const usage: Usage = existing !== undefined && nowMs - existing.startedAtMs < limits.windowMs
      ? existing
      : { startedAtMs: nowMs, requests: 0, dates: 0 };
    const limit = limits[measure];
    if (usage[measure] + cost > limit) {
      touch(this.usage, slot, usage, this.maxKeys);
      return { ok: false, measure, limit, kind: key.kind, retryAtMs: usage.startedAtMs + limits.windowMs };
    }
    usage[measure] += cost;
    touch(this.usage, slot, usage, this.maxKeys);
    return { ok: true };
  }
}

/** The header the route sets on the request it hands the MCP handler, naming
 *  the budget a tool call draws on. Anything a caller sends under this name
 *  is removed first. */
export const MCP_BUDGET_KEY_HEADER = "x-venviewer-mcp-budget";

export function encodeBudgetKey(key: BudgetKey): string {
  return `${key.kind}:${encodeURIComponent(key.id)}`;
}

export function decodeBudgetKey(value: string | null | undefined): BudgetKey | null {
  if (value === null || value === undefined) return null;
  const colon = value.indexOf(":");
  if (colon === -1) return null;
  const kind = value.slice(0, colon);
  if (kind !== "session" && kind !== "caller") return null;
  try {
    return { kind, id: decodeURIComponent(value.slice(colon + 1)) };
  } catch {
    return null;
  }
}
