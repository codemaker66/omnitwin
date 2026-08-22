import { describe, expect, it } from "vitest";
import type { JwtUser } from "../middleware/auth.js";
import {
  canAccessExactGrandHallRuntime,
  isExactGrandHallRuntimeStorageKey,
  isExactGrandHallRuntimeStorageSet,
  isExactGrandHallRuntimeTarget,
} from "../lib/grand-hall-runtime-access.js";

const TRADES_HALL_VENUE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_VENUE_ID = "10000000-0000-4000-8000-000000000002";

function user(
  role: string,
  venueId: string | null,
  platformRole: JwtUser["platformRole"] = "none",
): JwtUser {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    email: "venue-user@example.test",
    name: "Venue user",
    role,
    platformRole,
    venueId,
  };
}

describe("exact Grand Hall runtime access", () => {
  it("recognises only the exact Trades Hall Grand Hall target", () => {
    expect(isExactGrandHallRuntimeTarget("trades-hall", "grand-hall")).toBe(true);
    expect(isExactGrandHallRuntimeTarget("trades-hall", "reception-room")).toBe(false);
    expect(isExactGrandHallRuntimeTarget("other-venue", "grand-hall")).toBe(false);
  });

  it("accepts only canonical members beneath the exact Grand Hall storage namespace", () => {
    expect(isExactGrandHallRuntimeStorageKey(
      "r2:venues/trades-hall/rooms/grand-hall/exact/member.sog",
    )).toBe(true);
    expect(isExactGrandHallRuntimeStorageKey(
      "/venues/trades-hall/rooms/grand-hall/exact/member.spz",
    )).toBe(true);

    for (const rejected of [
      "r2:venues/trades-hall/rooms/reception-room/exact/member.sog",
      "r2:venues/other-venue/rooms/grand-hall/exact/member.sog",
      "r2:venues/trades-hall/rooms/grand-hall-copy/exact/member.sog",
      "r2:venues/trades-hall/rooms/grand-hall/",
      "r2:venues/trades-hall/rooms/grand-hall/../reception-room/member.sog",
      "r2:venues/trades-hall/rooms/grand-hall/exact\\member.sog",
      "r2:venues/trades-hall/rooms/grand-hall//member.sog",
    ]) {
      expect(isExactGrandHallRuntimeStorageKey(rejected)).toBe(false);
    }
  });

  it("binds every Grand Hall package member to protected room storage", () => {
    const exactMember = {
      r2Key: "r2:venues/trades-hall/rooms/grand-hall/exact/member.sog",
      externalUrl: null,
    };
    expect(isExactGrandHallRuntimeStorageSet(
      "trades-hall",
      "grand-hall",
      [exactMember],
    )).toBe(true);
    expect(isExactGrandHallRuntimeStorageSet(
      "trades-hall",
      "grand-hall",
      [{ ...exactMember, r2Key: "r2:venues/trades-hall/rooms/reception-room/member.sog" }],
    )).toBe(false);
    expect(isExactGrandHallRuntimeStorageSet(
      "trades-hall",
      "grand-hall",
      [{ ...exactMember, externalUrl: "https://assets.example.test/member.sog" }],
    )).toBe(false);
    expect(isExactGrandHallRuntimeStorageSet("trades-hall", "grand-hall", [])).toBe(false);

    // Other package targets retain their existing platform-admin workflow.
    expect(isExactGrandHallRuntimeStorageSet(
      "trades-hall",
      "reception-room",
      [{ r2Key: null, externalUrl: "https://assets.example.test/member.sog" }],
    )).toBe(true);
  });

  it.each(["admin", "staff", "hallkeeper"])(
    "admits an assigned venue %s through the existing venue-management boundary",
    (role) => {
      expect(canAccessExactGrandHallRuntime(
        user(role, TRADES_HALL_VENUE_ID),
        TRADES_HALL_VENUE_ID,
      )).toBe(true);
    },
  );

  it("preserves platform-admin access independently of venue assignment", () => {
    expect(canAccessExactGrandHallRuntime(
      user("admin", null, "admin"),
      TRADES_HALL_VENUE_ID,
    )).toBe(true);
  });

  it.each([
    user("staff", OTHER_VENUE_ID),
    user("planner", TRADES_HALL_VENUE_ID),
    user("client", TRADES_HALL_VENUE_ID),
    user("admin", null),
  ])("rejects users outside the private venue-management boundary", (candidate) => {
    expect(canAccessExactGrandHallRuntime(candidate, TRADES_HALL_VENUE_ID)).toBe(false);
  });
});
