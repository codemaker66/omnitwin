import { describe, expect, it } from "vitest";
import { authRouteWithReturnTo, getAuthReturnTo, getSafeReturnTo } from "../auth-return.js";

describe("getSafeReturnTo", () => {
  it.each([
    "/",
    "/dashboard?view=reviews",
    "/hallkeeper/today",
    "/diary?view=week&date=2026-09-07#booking-123",
    "/plan/abcd?space=grand-hall&eventId=event-123",
    "/v/trades-hall-glasgow/plan?space=reception-room",
    "/plan?room=Robert%20Adam%20Room&note=100%25%20ready#saved%20layout",
    "/plan?reference=https%3A%2F%2Fexample.com%2Froom&label=%2Flogin",
    "/room/Grand%20Hall",
    "/room/100%25",
    "/application",
  ])("preserves internal path, query and fragment: %s", (destination) => {
    expect(getSafeReturnTo(destination)).toBe(destination);
  });

  it.each([
    undefined, null, "", "dashboard", "https://example.com/plan", "javascript:alert(1)",
    "//example.com/plan", "///example.com", "/\\example.com", "/plan\\next",
    "/plan\n", "/plan\t?room=grand-hall", "/plan?note=\u0000",
    "/%2fexample.com", "/%2F%2Fexample.com", "/%252fexample.com", "/%25252Fexample.com",
    "/plan%2fother", "/%5cexample.com", "/%255cexample.com", "/%250aexample.com",
    "/plan?note=%5C", "/plan?note=%0A", "/plan?note=%7f",
    "/plan%", "/plan%2", "/plan%GG", "/plan?room=%GG", "/plan#%GG",
    "/login", "/login/", "/login?returnTo=/dashboard", "/login#sign-in",
    "/LOGIN", "/register", "/register/verify", "/onboard?tier=venue", "/app#home",
    "/oauth-consent", "/oauth-consent/", "/oauth-consent?client_id=external", "/oauth-consent#review",
    "/%6cogin", "/%256cogin", "/%61pp", "/x/../register", "/x/%2e%2e/onboard",
    "/x/%252e%252e/app", "/./login",
  ])("rejects unsafe or looping destination: %s", (destination) => {
    expect(getSafeReturnTo(destination)).toBeNull();
  });
});

describe("auth return navigation", () => {
  it("carries the original destination through sign-in and registration", () => {
    const destination = "/diary?view=week&date=2026-09-07#booking-123";
    const signIn = authRouteWithReturnTo("/login", destination);
    expect(signIn.startsWith("/login?returnTo=")).toBe(true);
    expect(getAuthReturnTo(new URL(signIn, "https://venviewer.com").search)).toBe(destination);

    const registration = authRouteWithReturnTo("/register", getAuthReturnTo(signIn.slice(signIn.indexOf("?"))) ?? "");
    expect(getAuthReturnTo(new URL(registration, "https://venviewer.com").search)).toBe(destination);
  });

  it("decodes the outer parameter once and preserves encoded room parameters", () => {
    const destination = "/plan?room=Robert%20Adam%20Room&reference=https%3A%2F%2Fexample.com";
    const route = authRouteWithReturnTo("/login", destination);
    expect(getAuthReturnTo(new URL(route, "https://venviewer.com").search)).toBe(destination);
  });

  it("ignores absent and malicious return parameters", () => {
    expect(getAuthReturnTo("?view=week")).toBeNull();
    expect(getAuthReturnTo("?returnTo=https%3A%2F%2Fexample.com")).toBeNull();
    expect(getAuthReturnTo("?returnTo=%2F%252Fexample.com")).toBeNull();
    expect(getAuthReturnTo("?returnTo=%2Flogin%3FreturnTo%3D%2Fdiary")).toBeNull();
  });

  it("omits invalid destinations when making auth links", () => {
    expect(authRouteWithReturnTo("/login", "//example.com")).toBe("/login");
    expect(authRouteWithReturnTo("/register", "/login")).toBe("/register");
  });
});
