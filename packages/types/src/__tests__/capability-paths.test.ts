import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PATH_PREFIXES,
  templateCapabilityPaths,
  templateCapabilityPathsDeep,
} from "../capability-paths.js";

// ---------------------------------------------------------------------------
// The segment after a capability prefix never leaves as itself; every other
// path, and the text around a url, stays as it was.
// ---------------------------------------------------------------------------

const TOKEN = "tok_SECRET123";

describe("templateCapabilityPaths", () => {
  it.each([
    ["/proposal-share/tok_SECRET123", "/proposal-share/:token"],
    ["/supplier-share/tok_SECRET123", "/supplier-share/:token"],
    ["/plan-view/tok_SECRET123", "/plan-view/:token"],
    ["/proposal/AB12CD", "/proposal/:token"],
    ["/plan/2b9f1c3e-5d8a-4c1b-9e7f-0a1b2c3d4e5f", "/plan/:token"],
    ["/public/plan-views/tok_SECRET123/plan.pdf", "/public/plan-views/:token/plan.pdf"],
    ["/public/proposals/AB12CD/respond", "/public/proposals/:token/respond"],
    ["/public/configurations/2b9f1c3e-5d8a-4c1b-9e7f-0a1b2c3d4e5f/objects/batch", "/public/configurations/:token/objects/batch"],
    ["https://api.venviewer.com/proposal-share/tok_SECRET123/approve?[redacted]", "https://api.venviewer.com/proposal-share/:token/approve?[redacted]"],
    ["https://venviewer.com/plan-view/tok_SECRET123#[redacted]", "https://venviewer.com/plan-view/:token#[redacted]"],
  ])("templates %s", (input, expected) => {
    expect(templateCapabilityPaths(input)).toBe(expected);
  });

  it.each([
    "/dashboard/proposals",
    "/dashboard/proposals/7d3c",
    "/proposals/7d3c/versions",
    "/proposal-preview/7d3c",
    "/floor-plan/7d3c",
    "/v/trades-hall/plan",
    "/plan",
    "/plan-views",
    "/venues/trades-hall/rooms/grand-hall",
  ])("leaves %s alone", (input) => {
    expect(templateCapabilityPaths(input)).toBe(input);
  });

  it("templates whatever the case, as the router matches paths", () => {
    expect(templateCapabilityPaths("https://venviewer.com/Proposal-Share/tok_SECRET123")).toBe("https://venviewer.com/Proposal-Share/:token");
    expect(templateCapabilityPaths("/PLAN-VIEW/tok_SECRET123")).toBe("/PLAN-VIEW/:token");
  });

  const LAYOUT = "2b9f1c3e-5d8a-4c1b-9e7f-0a1b2c3d4e5f";
  it.each([
    [`/configurations/${LAYOUT}/claim`, "/configurations/:token/claim"],
    [`https://api.venviewer.com/configurations/${LAYOUT}/objects/batch`, "https://api.venviewer.com/configurations/:token/objects/batch"],
    [`wss://api.venviewer.com/ws/configurations/${LAYOUT}`, "wss://api.venviewer.com/ws/configurations/:token"],
    [`/hallkeeper/${LAYOUT}`, "/hallkeeper/:token"],
    [`/blueprint/${LAYOUT.toUpperCase()}`, "/blueprint/:token"],
  ])("templates a layout's id in %s", (input, expected) => {
    expect(templateCapabilityPaths(input)).toBe(expected);
  });

  it.each(["/configurations/summaries", "/configurations/reviews", "/hallkeeper/today", "/hallkeeper/walkthrough", "/blueprint"])(
    "keeps the route named in words, %s",
    (input) => { expect(templateCapabilityPaths(input)).toBe(input); },
  );

  it("templates every url in a message and keeps the words around them", () => {
    expect(templateCapabilityPaths(`GET https://api.venviewer.com/proposal-share/${TOKEN}/approve failed (from /plan-view/${TOKEN}), retrying`))
      .toBe("GET https://api.venviewer.com/proposal-share/:token/approve failed (from /plan-view/:token), retrying");
  });

  it("stops at a JSON string's quote and escape, so a log line stays JSON", () => {
    const line = JSON.stringify({ msg: `opened "/proposal-share/${TOKEN}"`, url: `/supplier-share/${TOKEN}` });
    const templated = templateCapabilityPaths(line);
    expect(templated).not.toContain(TOKEN);
    expect(JSON.parse(templated)).toEqual({ msg: "opened \"/proposal-share/:token\"", url: "/supplier-share/:token" });
  });

  it("is idempotent", () => {
    const once = templateCapabilityPaths(`/proposal-share/${TOKEN}/approve`);
    expect(templateCapabilityPaths(once)).toBe(once);
  });

  it("names each prefix without its slashes", () => {
    for (const prefix of CAPABILITY_PATH_PREFIXES) {
      expect(prefix.startsWith("/") || prefix.endsWith("/")).toBe(false);
    }
  });
});

describe("templateCapabilityPathsDeep", () => {
  it("templates strings at any depth and leaves the input untouched", () => {
    const event = {
      request: { url: `https://venviewer.com/proposal-share/${TOKEN}` },
      breadcrumbs: [
        { category: "fetch", data: { url: `https://api.venviewer.com/proposal-share/${TOKEN}/approve?[redacted]`, status_code: 500 } },
        { category: "navigation", data: { from: `/plan-view/${TOKEN}`, to: "/dashboard/proposals" } },
        { category: "console", message: `failed to load /supplier-share/${TOKEN}` },
      ],
      exception: { values: [{ value: `Request to /plan/${TOKEN} failed` }] },
      count: 3,
      flag: true,
      nothing: null,
    };
    const before = JSON.stringify(event);

    const templated = templateCapabilityPathsDeep(event);

    expect(JSON.stringify(event)).toBe(before);
    expect(JSON.stringify(templated)).not.toContain(TOKEN);
    expect(templated.breadcrumbs[1]?.data?.to).toBe("/dashboard/proposals");
    expect(templated.breadcrumbs[0]?.data?.status_code).toBe(500);
    expect(templated.count).toBe(3);
    expect(templated.nothing).toBeNull();
  });

  it("is safe on cycles and leaves class instances alone", () => {
    const when = new Date(0);
    const node: { url: string; when: Date; self?: unknown } = { url: `/plan-view/${TOKEN}`, when };
    node.self = node;
    const templated = templateCapabilityPathsDeep(node);
    expect(templated.url).toBe("/plan-view/:token");
    expect(templated.when).toBe(when);
    expect(templated.self).toBe(templated);
  });
});
