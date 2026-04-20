import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { reviewSessions, users } from "../db/schema.js";

// ---------------------------------------------------------------------------
// Review-sessions service — polling-based presence tracking
//
// Contract:
//   1. Client heartbeats every ~10s while the review detail is open
//      via `heartbeatReviewSession`. Upsert; one row per (config, user).
//   2. Client polls `listActiveReviewers` to render the "who is
//      viewing" badge. Active = last_seen_at within 30s.
//   3. Periodic `cleanupStaleReviewSessions` prunes rows older than
//      a configurable window (default 5 min) to keep the table
//      small. Called from /admin/cleanup or a scheduled job.
//
// The decision logic (is this row active?) is a pure function so it
// can be unit-tested without a DB.
// ---------------------------------------------------------------------------

/**
 * Default window for "currently viewing" classification. The client
 * heartbeats at 10s — 30s gives headroom for two missed beats
 * (network blip, tab background) before a viewer is dropped.
 */
export const ACTIVE_WINDOW_MS = 30_000;

/** Default retention window for stale-row cleanup. */
export const STALE_WINDOW_MS = 5 * 60_000;

export interface ActiveReviewer {
  readonly userId: string;
  readonly displayName: string;
  readonly lastSeenAt: string;
}

/**
 * Pure helper — given a list of session rows and a clock, return the
 * subset whose `lastSeenAt` is within `windowMs` of `now`. Exported
 * for direct unit testing.
 */
export function filterActiveViewers<T extends { lastSeenAt: Date }>(
  rows: readonly T[],
  now: Date,
  windowMs: number,
): T[] {
  const cutoffMs = now.getTime() - windowMs;
  return rows.filter((r) => r.lastSeenAt.getTime() >= cutoffMs);
}

/**
 * Record a heartbeat for (configId, userId). Upserts — one row per
 * pair. Returns void; callers don't need the row back.
 *
 * Uses Postgres `ON CONFLICT DO UPDATE` to avoid a select-then-write
 * round-trip — a single statement per heartbeat matters when many
 * staff browse many configs.
 */
export async function heartbeatReviewSession(
  db: Database,
  configId: string,
  userId: string,
): Promise<void> {
  await db.insert(reviewSessions)
    .values({ configurationId: configId, userId })
    .onConflictDoUpdate({
      target: [reviewSessions.configurationId, reviewSessions.userId],
      set: { lastSeenAt: sql`NOW()` },
    });
}

/**
 * List active viewers for a config. Joins users to resolve the
 * display name — never returns raw user UUIDs to callers (same
 * PII posture as /review/history). Excludes the caller themselves
 * so the UI doesn't show "you" in the presence badge.
 */
export async function listActiveReviewers(
  db: Database,
  configId: string,
  callerUserId: string,
  windowMs: number = ACTIVE_WINDOW_MS,
): Promise<readonly ActiveReviewer[]> {
  const cutoff = new Date(Date.now() - windowMs);
  const rows = await db.select({
    userId: reviewSessions.userId,
    lastSeenAt: reviewSessions.lastSeenAt,
    displayName: users.displayName,
    name: users.name,
  })
    .from(reviewSessions)
    .innerJoin(users, eq(reviewSessions.userId, users.id))
    .where(and(
      eq(reviewSessions.configurationId, configId),
      gte(reviewSessions.lastSeenAt, cutoff),
    ));

  return rows
    .filter((r) => r.userId !== callerUserId)
    .map((r) => ({
      userId: r.userId,
      displayName: r.displayName ?? r.name,
      lastSeenAt: r.lastSeenAt.toISOString(),
    }));
}

/**
 * Explicit leave — the client fires this on unmount. Optional but
 * gives a snappier "user closed the tab" signal than waiting for the
 * next cleanup pass. Idempotent (DELETE of missing row = 0 affected).
 */
export async function endReviewSession(
  db: Database,
  configId: string,
  userId: string,
): Promise<void> {
  await db.delete(reviewSessions)
    .where(and(
      eq(reviewSessions.configurationId, configId),
      eq(reviewSessions.userId, userId),
    ));
}

/**
 * Prune rows older than `staleMs`. Safe to call from a cron / admin
 * endpoint. Returns the number deleted for ops observability.
 */
export async function cleanupStaleReviewSessions(
  db: Database,
  staleMs: number = STALE_WINDOW_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const result = await db.delete(reviewSessions)
    .where(lt(reviewSessions.lastSeenAt, cutoff))
    .returning({ userId: reviewSessions.userId });
  return result.length;
}
