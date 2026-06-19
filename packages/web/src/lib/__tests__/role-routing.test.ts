import { describe, it, expect } from "vitest";
import { getDefaultRoute } from "../role-routing.js";

// ---------------------------------------------------------------------------
// role-routing — post-login default-route picker
//
// Pins the current behavior so a future change to this logic forces a
// deliberate test update. The function is small but load-bearing:
// every first-login redirect, every role-switch, every "home" link
// consults it.
// ---------------------------------------------------------------------------

describe("getDefaultRoute", () => {
  it("routes admin to /dashboard", () => {
    expect(getDefaultRoute("admin")).toBe("/dashboard");
  });

  it("routes hallkeeper to /dashboard", () => {
    expect(getDefaultRoute("hallkeeper")).toBe("/dashboard");
  });

  it("routes planner to /dashboard", () => {
    expect(getDefaultRoute("planner")).toBe("/dashboard");
  });

  it("routes client to /plan (default)", () => {
    expect(getDefaultRoute("client")).toBe("/plan");
  });

  it("routes staff to /dashboard (now in the dashboard-default group)", () => {
    // staff was promoted into the dashboard-default group alongside
    // admin/hallkeeper/planner/executive; client and unknown roles still
    // fall through to /plan.
    expect(getDefaultRoute("staff")).toBe("/dashboard");
  });

  it("routes executive to /dashboard", () => {
    expect(getDefaultRoute("executive")).toBe("/dashboard");
  });

  it("routes unknown roles to /plan (fail-soft default)", () => {
    expect(getDefaultRoute("")).toBe("/plan");
    expect(getDefaultRoute("future_role")).toBe("/plan");
    expect(getDefaultRoute("ADMIN")).toBe("/plan"); // case-sensitive
  });
});
