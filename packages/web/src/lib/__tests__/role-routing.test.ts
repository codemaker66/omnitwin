import { describe, it, expect } from "vitest";
import { CLIENT_HOME_ROUTE, getDefaultRoute } from "../role-routing.js";

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

  it("takes hallkeepers directly to their working day", () => {
    expect(getDefaultRoute("hallkeeper")).toBe("/hallkeeper/today");
  });

  it("keeps platform administration ahead of the venue-role destination", () => {
    expect(getDefaultRoute("hallkeeper", "admin")).toBe("/dashboard?view=onboarding");
    expect(getDefaultRoute("admin", "admin")).toBe("/dashboard?view=onboarding");
  });

  it("lands a planner on their own events and plans, never the staff dashboard (fix-first 12)", () => {
    // The planner is still admitted to /dashboard (WORKSPACE_ROLES), so this
    // pins the order: the client's side is decided before the workspace.
    expect(getDefaultRoute("planner")).toBe("/events");
    expect(getDefaultRoute("planner")).toBe(CLIENT_HOME_ROUTE);
  });

  it("lands a client on their own events and plans", () => {
    expect(getDefaultRoute("client")).toBe("/events");
  });

  it("keeps platform administration ahead of the client's home", () => {
    expect(getDefaultRoute("planner", "admin")).toBe("/dashboard?view=onboarding");
    expect(getDefaultRoute("client", "admin")).toBe("/dashboard?view=onboarding");
  });

  it("sends no venue role to the client's home", () => {
    for (const role of ["admin", "manager", "staff", "sales", "hallkeeper"]) {
      expect(getDefaultRoute(role), role).not.toBe(CLIENT_HOME_ROUTE);
    }
  });

  it("routes staff to /dashboard", () => {
    expect(getDefaultRoute("staff")).toBe("/dashboard");
  });

  it("routes manager and sales to /dashboard (goal 18 §6 decision 6a)", () => {
    expect(getDefaultRoute("manager")).toBe("/dashboard");
    expect(getDefaultRoute("sales")).toBe("/dashboard");
  });

  it("routes a caterer to /plan — it holds no venue-wide surface", () => {
    expect(getDefaultRoute("caterer")).toBe("/plan");
  });

  it("routes the retired executive name to /plan with every other unknown role", () => {
    expect(getDefaultRoute("executive")).toBe("/plan");
  });

  it("routes unknown roles to /plan (fail-soft default)", () => {
    expect(getDefaultRoute("")).toBe("/plan");
    expect(getDefaultRoute("future_role")).toBe("/plan");
    expect(getDefaultRoute("ADMIN")).toBe("/plan"); // case-sensitive
  });
});
