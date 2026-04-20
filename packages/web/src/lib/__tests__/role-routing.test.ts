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

  it("routes client to /editor (default)", () => {
    expect(getDefaultRoute("client")).toBe("/editor");
  });

  it("routes staff to /editor (current behavior — not in the dashboard group)", () => {
    // Documenting that staff is NOT in the dashboard-default group.
    // If this is a bug, the assertion will fail loudly when the fix
    // lands, prompting the test author to confirm the new intent.
    expect(getDefaultRoute("staff")).toBe("/editor");
  });

  it("routes unknown roles to /editor (fail-soft default)", () => {
    expect(getDefaultRoute("")).toBe("/editor");
    expect(getDefaultRoute("future_role")).toBe("/editor");
    expect(getDefaultRoute("ADMIN")).toBe("/editor"); // case-sensitive
  });
});
