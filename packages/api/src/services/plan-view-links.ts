import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  PLAN_VIEW_LINK_DAYS,
  PLAN_VIEW_LINK_LIMIT,
  PlanViewSchema,
  VISITOR_PLAN_PROVENANCE,
  type IssuedPlanViewLink,
  type PlanView,
  type PlanViewLink,
} from "@omnitwin/types";
import { configurations, configurationViewTokens } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { loadVisitorPlan, summariseVisitorPlanItems, type VisitorPlan } from "./visitor-plan-pdf.js";

// ---------------------------------------------------------------------------
// View-only links to a visitor's plan (fix-first item 11, 16 Oct 2026 brief).
//
// The boundary that shapes this file: an anonymous plan's configuration id is
// its edit capability (POST /public/configurations/:id/objects/batch needs
// nothing else). So the organiser, who holds that id, asks for a separate
// token; the recipient only ever holds the token, and the token only ever
// reads.
//
//   * The token is 32 random bytes (256 bits), base64url. It is returned once,
//     when it is made, and stored only as its SHA-256. Its first eight
//     characters are kept so a link can be recognised, never rebuilt.
//   * A token resolves to one configuration, under the same read rule as the
//     plan's PDF (a live public preview whose room belongs to its venue). A
//     claimed, deleted or swept plan answers nothing, whatever the token.
//   * Every link expires PLAN_VIEW_LINK_DAYS after it is made, and its
//     organiser can stop it sooner. A working link keeps its plan out of the
//     72-hour sweep (services/cleanup.ts); an expired or stopped one does not.
//   * The projection a token reads carries no configuration id, short code,
//     planner address or price.
// ---------------------------------------------------------------------------

/** Characters of the token kept in the clear, to recognise a link. */
export const PLAN_VIEW_TOKEN_PREFIX_LENGTH = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

export function generatePlanViewToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPlanViewToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A link works until its organiser stops it or its time runs out. */
function working(now: Date) {
  return and(isNull(configurationViewTokens.revokedAt), gt(configurationViewTokens.expiresAt, now));
}

function linkOf(row: {
  readonly id: string;
  readonly tokenPrefix: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}): PlanViewLink {
  return {
    id: row.id,
    prefix: row.tokenPrefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** The organiser's capability: the id of a live, unclaimed public preview. */
async function isLivePublicPreview(db: Database, configId: string): Promise<boolean> {
  const [plan] = await db.select({ id: configurations.id })
    .from(configurations)
    .where(and(
      eq(configurations.id, configId),
      eq(configurations.isPublicPreview, true),
      isNull(configurations.deletedAt),
    ))
    .limit(1);
  return plan !== undefined;
}

export type IssuePlanViewLinkResult =
  | { readonly kind: "issued"; readonly link: IssuedPlanViewLink }
  | { readonly kind: "not_found" }
  | { readonly kind: "limit" };

/**
 * Make a view-only link for a plan. Only a plan its PDF could be drawn from
 * may have one, and at most PLAN_VIEW_LINK_LIMIT work at once.
 */
export async function issuePlanViewLink(
  db: Database,
  configId: string,
  now: Date = new Date(),
): Promise<IssuePlanViewLinkResult> {
  // The PDF's read rule, room and venue included: a link must never show a
  // plan the organiser could not print.
  if (await loadVisitorPlan(db, configId) === null) return { kind: "not_found" };

  const token = generatePlanViewToken();
  const expiresAt = new Date(now.getTime() + PLAN_VIEW_LINK_DAYS * DAY_MS);

  return db.transaction(async (tx): Promise<IssuePlanViewLinkResult> => {
    // Holding the plan's row makes two requests at once count one after the
    // other, so neither can take a place the other already took.
    const [plan] = await tx.select({ id: configurations.id })
      .from(configurations)
      .where(and(
        eq(configurations.id, configId),
        eq(configurations.isPublicPreview, true),
        isNull(configurations.deletedAt),
      ))
      .limit(1)
      .for("update");
    if (plan === undefined) return { kind: "not_found" };

    const [counted] = await tx.select({ live: sql<number>`count(*)::int` })
      .from(configurationViewTokens)
      .where(and(eq(configurationViewTokens.configurationId, configId), working(now)));
    if ((counted?.live ?? 0) >= PLAN_VIEW_LINK_LIMIT) return { kind: "limit" };

    const [row] = await tx.insert(configurationViewTokens).values({
      configurationId: configId,
      tokenPrefix: token.slice(0, PLAN_VIEW_TOKEN_PREFIX_LENGTH),
      tokenHash: hashPlanViewToken(token),
      createdAt: now,
      expiresAt,
    }).returning();
    if (row === undefined) throw new Error("configuration_view_tokens insert returned no row");
    return { kind: "issued", link: { ...linkOf(row), token } };
  });
}

/** A plan's working links, newest first; null when the id is not a live preview. */
export async function listPlanViewLinks(
  db: Database,
  configId: string,
  now: Date = new Date(),
): Promise<readonly PlanViewLink[] | null> {
  if (!await isLivePublicPreview(db, configId)) return null;
  const rows = await db.select({
    id: configurationViewTokens.id,
    tokenPrefix: configurationViewTokens.tokenPrefix,
    createdAt: configurationViewTokens.createdAt,
    expiresAt: configurationViewTokens.expiresAt,
  })
    .from(configurationViewTokens)
    .where(and(eq(configurationViewTokens.configurationId, configId), working(now)))
    .orderBy(desc(configurationViewTokens.createdAt), desc(configurationViewTokens.id));
  return rows.map(linkOf);
}

/**
 * Stop one of a plan's links. Only the plan's own id can stop its links; a
 * link of another plan answers as if it did not exist. Stopping a link that
 * is already stopped keeps the time it was first stopped.
 */
export async function revokePlanViewLink(
  db: Database,
  configId: string,
  linkId: string,
  now: Date = new Date(),
): Promise<"revoked" | "not_found"> {
  if (!await isLivePublicPreview(db, configId)) return "not_found";
  const [row] = await db.update(configurationViewTokens)
    .set({ revokedAt: sql`coalesce(${configurationViewTokens.revokedAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(
      eq(configurationViewTokens.id, linkId),
      eq(configurationViewTokens.configurationId, configId),
    ))
    .returning({ id: configurationViewTokens.id });
  return row === undefined ? "not_found" : "revoked";
}

export interface ResolvedPlanView {
  readonly plan: VisitorPlan;
  readonly expiresAt: Date;
}

/** The plan a working token shows, or null for any token that does not work. */
export async function resolvePlanViewToken(
  db: Database,
  token: string,
  now: Date = new Date(),
): Promise<ResolvedPlanView | null> {
  const [link] = await db.select({
    configurationId: configurationViewTokens.configurationId,
    expiresAt: configurationViewTokens.expiresAt,
  })
    .from(configurationViewTokens)
    .where(and(eq(configurationViewTokens.tokenHash, hashPlanViewToken(token)), working(now)))
    .limit(1);
  if (link === undefined) return null;
  const plan = await loadVisitorPlan(db, link.configurationId);
  return plan === null ? null : { plan, expiresAt: link.expiresAt };
}

/** What the recipient's page reads: footprints and names, never an id or a price. */
export function planViewOf(plan: VisitorPlan, linkExpiresAt: Date): PlanView {
  return PlanViewSchema.parse({
    venueName: plan.venueName,
    venueAddress: plan.venueAddress,
    timezone: plan.timezone,
    roomName: plan.roomName,
    planName: plan.planName,
    provenance: VISITOR_PLAN_PROVENANCE,
    lastChangedAt: plan.lastChangedAt.toISOString(),
    linkExpiresAt: linkExpiresAt.toISOString(),
    outline: plan.floorPlan.outline.map(({ x, z }) => ({ x, z })),
    objects: plan.floorPlan.objects.map((object) => ({
      name: object.name,
      category: object.category,
      x: object.x,
      z: object.z,
      rotationY: object.rotationY,
      scale: object.scale,
      widthM: object.widthM,
      depthM: object.depthM,
      collisionType: object.collisionType,
    })),
    items: summariseVisitorPlanItems(plan.floorPlan).map(({ name, category, count }) => ({ name, category, count })),
  });
}
