import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { JwtUser } from "./auth.js";

// ---------------------------------------------------------------------------
// Rate-limit identity — which bucket a request draws from.
//
// @fastify/rate-limit keys each request in its onRequest hook, before a
// route's `authenticate` preHandler has verified anything, so a keyGenerator
// reading `request.user` always saw undefined and every request shared its
// client IP's bucket: a venue team behind one office address shared 100
// requests a minute.
//
// Keying on an unverified token claim would let a forged token mint a fresh
// bucket, and verifying tokens before the limiter would put that work in
// front of the flood gate. Instead the server remembers each bearer token that
// `authenticate` has already accepted (learned when its response completes)
// and keys later requests carrying that exact token by the verified user id:
//
//   - a known token draws from `user:<id>`, whichever IP it arrives from;
//   - anything else — no token, a new token, a forged or expired one, or one
//     that failed authentication — draws from `ip:<address>`, as before, so
//     unverified requests stay limited before any token verification runs.
//
// A token's first request is therefore charged to its IP; every later request
// with it is charged to the user. Tokens are held only as SHA-256 digests,
// for no longer than their own `exp` claim or ten minutes, and at most
// 10,000 at once (oldest dropped first).
// ---------------------------------------------------------------------------

const MAX_REMEMBERED_TOKENS = 10_000;
const MAX_REMEMBER_MS = 10 * 60_000;

interface RememberedToken {
  readonly userId: string;
  readonly expiresAtMs: number;
}

type KeyedRequest = Pick<FastifyRequest, "headers" | "ip">;
/** `user` is declared on every request, but only authenticate() assigns it. */
type AnsweredRequest = Pick<FastifyRequest, "headers"> & { readonly user?: JwtUser };

export interface RateLimitIdentity {
  /** keyGenerator for @fastify/rate-limit (runs at onRequest). */
  readonly keyFor: (request: KeyedRequest) => string;
  /** onResponse hook body: remember a token that authenticate() accepted. */
  readonly learn: (request: AnsweredRequest) => void;
}

/** Same header parsing as authenticate(). */
function bearerToken(request: Pick<FastifyRequest, "headers">): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  return token.length > 0 ? token : null;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Read `exp` from a token authenticate() has just verified; test-mode JSON
 *  tokens and anything unparseable fall back to the ten-minute ceiling. */
function rememberUntil(token: string, nowMs: number): number {
  const ceiling = nowMs + MAX_REMEMBER_MS;
  const payload = token.split(".")[1];
  if (payload === undefined) return ceiling;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const exp: unknown = typeof claims === "object" && claims !== null ? Reflect.get(claims, "exp") : undefined;
    return typeof exp === "number" && Number.isFinite(exp) ? Math.min(exp * 1000, ceiling) : ceiling;
  } catch {
    return ceiling;
  }
}

export function createRateLimitIdentity(now: () => number = Date.now): RateLimitIdentity {
  const verified = new Map<string, RememberedToken>();

  return {
    keyFor(request) {
      const token = bearerToken(request);
      if (token !== null) {
        const key = digest(token);
        const remembered = verified.get(key);
        if (remembered !== undefined) {
          if (remembered.expiresAtMs > now()) return `user:${remembered.userId}`;
          verified.delete(key);
        }
      }
      return `ip:${request.ip}`;
    },

    learn(request) {
      const user = request.user;
      if (user === undefined || user.id.length === 0) return;
      const token = bearerToken(request);
      if (token === null) return;
      const key = digest(token);
      const nowMs = now();
      const remembered = verified.get(key);
      if (remembered?.userId === user.id && remembered.expiresAtMs > nowMs) return;
      const expiresAtMs = rememberUntil(token, nowMs);
      if (expiresAtMs <= nowMs) return;
      verified.delete(key);
      verified.set(key, { userId: user.id, expiresAtMs });
      while (verified.size > MAX_REMEMBERED_TOKENS) {
        const oldest = verified.keys().next();
        if (oldest.done === true) break;
        verified.delete(oldest.value);
      }
    },
  };
}
