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

  it("routes staff to /plan (current behavior — not in the dashboard group)", () => {
    // Documenting that staff is NOT in the dashboard-default group.
    // If this is a bug, the assertion will fail loudly when the fix
    // lands, prompting the test author to confirm the new intent.
    expect(getDefaultRoute("staff")).toBe("/plan");
  });

  it("routes unknown roles to /plan (fail-soft default)", () => {
    expect(getDefaultRoute("")).toBe("/plan");
    expect(getDefaultRoute("future_role")).toBe("/plan");
    expect(getDefaultRoute("ADMIN")).toBe("/plan"); // case-sensitive
  });
});
