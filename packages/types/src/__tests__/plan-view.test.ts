import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IssuedPlanViewLinkSchema,
  PlanViewSchema,
  PlanViewTokenSchema,
  VISITOR_PLAN_PROVENANCE,
} from "../plan-view.js";

// The view-only link's contract (fix-first item 11): the token shape the API
// issues and the web page accepts, and the projection a recipient reads.

const VIEW = {
  venueName: "Trades Hall Glasgow",
  venueAddress: "85 Glassford Street, Glasgow G1 1UH",
  timezone: "Europe/London",
  roomName: "Grand Hall",
  planName: null,
  provenance: VISITOR_PLAN_PROVENANCE,
  lastChangedAt: "2026-10-17T13:02:00.000Z",
  linkExpiresAt: "2026-11-16T13:02:00.000Z",
  outline: [{ x: -10, z: -5 }, { x: 10, z: -5 }, { x: 10, z: 5 }, { x: -10, z: 5 }],
  objects: [{
    name: "Velvet Banquet Chair", category: "chair", x: 0, z: 0.4, rotationY: 0, scale: 1,
    widthM: 0.42, depthM: 0.58, collisionType: "box",
  }],
  items: [{ name: "Velvet Banquet Chair", category: "chair", count: 1 }],
} as const;

describe("view-only link contract", () => {
  it("accepts exactly the tokens the API makes: 32 random bytes, unpadded base64url", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(PlanViewTokenSchema.safeParse(randomBytes(32).toString("base64url")).success).toBe(true);
    }
    for (const bad of ["", "short", `${"A".repeat(42)}=`, "A".repeat(44), `${"A".repeat(42)}/`, "a".repeat(64)]) {
      expect(PlanViewTokenSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("reads a plan that carries the provenance line, and refuses one that does not", () => {
    expect(PlanViewSchema.parse(VIEW).provenance).toBe("Drawn by a visitor; not reviewed by the venue.");
    expect(PlanViewSchema.safeParse({ ...VIEW, provenance: "Approved by the venue." }).success).toBe(false);
  });

  it("has no place for an id, a short code or a price: unknown fields are dropped", () => {
    const parsed = PlanViewSchema.parse({ ...VIEW, configurationId: "secret", shortCode: "abc123", total: "£5,044" });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(VIEW).sort());
  });

  it("returns the token only with the link it was made for", () => {
    const token = randomBytes(32).toString("base64url");
    const link = IssuedPlanViewLinkSchema.parse({
      id: "8f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      prefix: token.slice(0, 8),
      createdAt: "2026-10-17T13:02:00.000Z",
      expiresAt: "2026-11-16T13:02:00.000Z",
      token,
    });
    expect(link.token).toBe(token);
  });
});
