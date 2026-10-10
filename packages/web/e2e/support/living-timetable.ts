import type { Page } from "@playwright/test";
import type { Coordinator } from "./diary-live.js";

// ---------------------------------------------------------------------------
// Living-timetable e2e support (goal 19 S4, T-651).
//
// Three identities against the REAL stack: the office, a hallkeeper and a
// client, all Clerk TEST users (`+clerk_test`, OTP 424242, no real mail) whose
// emails match seeded rows with clerkId NULL, so the first sign-in links each
// to its seeded role (the same mechanics as the Diary coordinators). They are
// provisioned by infra/dev-db/provision-clerk-test-users.mjs and seeded by
// packages/api/src/db/seed.ts; the password is the coordinators' constant.
//
// Everything the spec writes goes through the API from inside the signed-in
// page, with the page's own Clerk token and an Idempotency-Key on every POST,
// so the e2e exercises the real doors (auth, CORS, the ledger), never a
// fixture.
// ---------------------------------------------------------------------------

export const OFFICE: Coordinator = {
  email: "office+clerk_test@tradeshall.co.uk",
  username: "isla-office",
  name: "Isla Office",
};

export const HALLKEEPER: Coordinator = {
  email: "hallkeeper+clerk_test@tradeshall.co.uk",
  username: "callum-hallkeeper",
  name: "Callum Hallkeeper",
};

export const CLIENT: Coordinator = {
  email: "client+clerk_test@tradeshall.co.uk",
  username: "morag-client",
  name: "Morag Client",
};

export interface ApiOutcome {
  readonly status: number;
  readonly body: unknown;
  readonly replay: string | null;
}

/** The `data` envelope of a successful answer, or the whole body. */
export function unwrap(outcome: ApiOutcome): unknown {
  const body = outcome.body;
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as { readonly data: unknown }).data;
  }
  return body;
}

/**
 * Calls the API from inside the page as the signed-in person: the page's own
 * Clerk session token, real CORS, and the Idempotency-Key the ledger dedupes
 * on. The token never leaves the page.
 */
export async function api(
  page: Page,
  apiOrigin: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { readonly body?: unknown; readonly idempotencyKey?: string } = {},
): Promise<ApiOutcome> {
  // The ledger refuses a header that disagrees with the body's own key, so a
  // body that carries one sets the header too.
  const bodyKey = typeof options.body === "object" && options.body !== null && "idempotencyKey" in options.body
    && typeof (options.body as { readonly idempotencyKey: unknown }).idempotencyKey === "string"
    ? (options.body as { readonly idempotencyKey: string }).idempotencyKey
    : null;
  return page.evaluate(
    async (input: {
      readonly apiOrigin: string;
      readonly method: string;
      readonly path: string;
      readonly body: unknown;
      readonly idempotencyKey: string | null;
    }) => {
      const clerk = (
        window as { Clerk?: { session?: { getToken: () => Promise<string | null> } } }
      ).Clerk;
      const token = (await clerk?.session?.getToken()) ?? null;
      if (token === null) throw new Error("no Clerk session token in page");
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (input.body !== undefined) headers["Content-Type"] = "application/json";
      if (input.idempotencyKey !== null) headers["Idempotency-Key"] = input.idempotencyKey;
      const response = await fetch(`${input.apiOrigin}${input.path}`, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed, replay: response.headers.get("idempotency-replay") };
    },
    {
      apiOrigin,
      method,
      path,
      body: options.body,
      idempotencyKey: options.idempotencyKey ?? bodyKey,
    },
  );
}

/**
 * Waits until the page's Clerk instance holds a session. Sign-in resolves the
 * moment the URL leaves /login; the destination may still be hydrating (a
 * client's default landing is the planner, heavy in a headless browser), so
 * nothing asks the API for a token before this.
 */
export async function awaitClerkSession(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const clerk = (window as { Clerk?: { session?: unknown } }).Clerk;
      return clerk?.session !== undefined && clerk.session !== null;
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Europe/London's offset from UTC at this instant, in milliseconds. */
export function londonOffsetMs(at: Date): number {
  const asLondon = new Date(at.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const asUtc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  return asLondon.getTime() - asUtc.getTime();
}

/** The venue-local day holding `at`, as UTC instants [start, end). */
export function londonDay(at: Date): { readonly startMs: number; readonly endMs: number } {
  const offset = londonOffsetMs(at);
  const localMs = at.getTime() + offset;
  const dayStartLocal = Math.floor(localMs / 86_400_000) * 86_400_000;
  return { startMs: dayStartLocal - offset, endMs: dayStartLocal - offset + 86_400_000 };
}

export interface Interval {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * A window of `durationMs` inside [dayStartMs, dayEndMs) that touches none of
 * `taken`, as near `preferredStartMs` as the room allows: tried at the
 * preference, then later and earlier in half-hour steps. Null when the day
 * is full.
 */
export function freeWindow(
  taken: readonly Interval[],
  day: Interval,
  preferredStartMs: number,
  durationMs: number,
): Interval | null {
  const step = 30 * 60_000;
  const clashes = (candidate: Interval): boolean =>
    taken.some((busy) => candidate.startMs < busy.endMs && busy.startMs < candidate.endMs);
  const fits = (startMs: number): Interval | null => {
    const candidate = { startMs, endMs: startMs + durationMs };
    if (candidate.startMs < day.startMs || candidate.endMs > day.endMs) return null;
    return clashes(candidate) ? null : candidate;
  };
  for (let offset = 0; offset < 86_400_000; offset += step) {
    const later = fits(preferredStartMs + offset);
    if (later !== null) return later;
    if (offset > 0) {
      const earlier = fits(preferredStartMs - offset);
      if (earlier !== null) return earlier;
    }
  }
  return null;
}
