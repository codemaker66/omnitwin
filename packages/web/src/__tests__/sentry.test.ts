import type { Breadcrumb, Event } from "@sentry/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initBrowserSentry,
  parseSentrySampleRate,
  readBrowserSentryConfig,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  withoutIds,
  withoutQuery,
} from "../observability/sentry.js";

/** A breadcrumb the scrubber keeps (fetch, xhr, navigation and clicks are kept; console ones are dropped). */
function kept(breadcrumb: Breadcrumb): Breadcrumb {
  const scrubbed = scrubSentryBreadcrumb(breadcrumb);
  if (scrubbed === null) throw new Error("The breadcrumb was dropped");
  return scrubbed;
}

describe("browser Sentry config", () => {
  it("is disabled when the browser DSN is absent", () => {
    expect(readBrowserSentryConfig({ MODE: "production" })).toBeNull();
  });

  it("normalizes optional browser Sentry settings", () => {
    expect(readBrowserSentryConfig({
      MODE: "production",
      VITE_SENTRY_DSN: " https://public@example.ingest.sentry.io/1 ",
      VITE_SENTRY_ENVIRONMENT: " production ",
      VITE_SENTRY_RELEASE: " abc123 ",
      VITE_SENTRY_TRACES_SAMPLE_RATE: "0.25",
    })).toEqual({
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "production",
      release: "abc123",
      tracesSampleRate: 0.25,
    });
  });

  it("uses a zero traces sample rate for unset or invalid values", () => {
    expect(parseSentrySampleRate(undefined)).toBe(0);
    expect(parseSentrySampleRate("")).toBe(0);
    expect(parseSentrySampleRate("-1")).toBe(0);
    expect(parseSentrySampleRate("1.5")).toBe(0);
    expect(parseSentrySampleRate("nope")).toBe(0);
    expect(parseSentrySampleRate("1")).toBe(1);
  });

  it("does not import or initialize Sentry when no DSN is configured", async () => {
    await expect(initBrowserSentry({ MODE: "test" })).resolves.toBeUndefined();
  });
});

describe("browser Sentry event scrubber", () => {
  it("removes request payload, headers, cookies, query strings, user, and extras", () => {
    const event: Event = {
      request: {
        url: "https://app.venviewer.com/dev/trades-hall-visual?email=client@example.com#view",
        method: "POST",
        headers: { authorization: "Bearer secret" },
        cookies: { session: "secret" },
        query_string: "email=client@example.com",
        data: { notes: "private event brief" },
      },
      user: { email: "client@example.com", ip_address: "127.0.0.1" },
      extra: { form: "private event brief" },
    };

    expect(scrubSentryEvent(event)).toEqual({
      request: {
        url: "https://app.venviewer.com/dev/trades-hall-visual",
        method: "POST",
      },
    });
  });

  it("keeps relative paths but strips query strings", () => {
    const event: Event = {
      request: {
        url: "/register?plan=professional",
        method: "GET",
      },
    };

    expect(scrubSentryEvent(event).request).toEqual({
      url: "/register",
      method: "GET",
    });
  });
});

describe("browser Sentry breadcrumbs and search terms", () => {
  it("cuts the query and fragment from a url, and leaves one with neither alone", () => {
    expect(withoutQuery("/clients/search?q=Aileen")).toBe("/clients/search?[redacted]");
    expect(withoutQuery("https://api.example.test/people/search?q=0141%20496%200000#top"))
      .toBe("https://api.example.test/people/search?[redacted]");
    expect(withoutQuery("/auth/callback#access_token=fictional")).toBe("/auth/callback#[redacted]");
    expect(withoutQuery("/dashboard#view?q=Aileen")).toBe("/dashboard#[redacted]");
    expect(withoutQuery("/clients/search")).toBe("/clients/search");
  });

  it("keeps a client search term out of a fetch breadcrumb", () => {
    const breadcrumb: Breadcrumb = {
      category: "fetch",
      type: "http",
      level: "info",
      data: { method: "GET", url: "https://api.example.test/clients/search?q=Aileen", status_code: 200 },
    };

    const scrubbed = scrubSentryBreadcrumb(breadcrumb);
    expect(JSON.stringify(scrubbed)).not.toContain("Aileen");
    expect(scrubbed).toEqual({
      category: "fetch",
      type: "http",
      level: "info",
      data: { method: "GET", url: "https://api.example.test/clients/search?[redacted]", status_code: 200 },
    });
  });

  it("does the same for an xhr breadcrumb", () => {
    const scrubbed = kept({
      category: "xhr",
      type: "http",
      data: { method: "GET", url: "/clients/search?q=aileen%40example.test", status_code: 200 },
    });
    expect(scrubbed.data?.["url"]).toBe("/clients/search?[redacted]");
  });

  it("keeps the query out of a navigation breadcrumb's from and to", () => {
    const scrubbed = kept({
      category: "navigation",
      data: { from: "/dashboard?view=search&q=Aileen", to: "/clients?q=Aileen#top" },
    });
    expect(JSON.stringify(scrubbed)).not.toContain("Aileen");
    expect(scrubbed.data).toEqual({ from: "/dashboard?[redacted]", to: "/clients?[redacted]" });
  });

  it("leaves a breadcrumb with no url, and the caller's breadcrumb, as they were", () => {
    const click: Breadcrumb = { category: "ui.click", message: "button.find" };
    expect(scrubSentryBreadcrumb(click)).toEqual({ category: "ui.click", message: "button.find" });
    const original: Breadcrumb = { category: "fetch", data: { url: "/clients/search?q=Aileen" } };
    scrubSentryBreadcrumb(original);
    expect(original.data?.["url"]).toBe("/clients/search?q=Aileen");
  });

  it("drops console breadcrumbs, which can quote a layout's own words", () => {
    expect(scrubSentryBreadcrumb({ category: "console", level: "error", message: "[editor-store] save failed: Smith wedding top table", data: { arguments: ["x"] } })).toBeNull();
  });

  it("keeps a guest layout's id and a shared plan's token out of every url", () => {
    expect(withoutIds("/plan/7f1fb7a2-5210-57b1-9108-11255c059520")).toBe("/plan/:id");
    expect(withoutIds("/plan/tour-config-0001?mode=walk")).toBe("/plan/:id?mode=walk");
    expect(withoutIds("/plan-view/Zq3kP9vR2mW7xY1tB8nC4dF")).toBe("/plan-view/:id");
    expect(withoutIds("https://api.example.test/public/configurations/abc123/objects/batch")).toBe("https://api.example.test/public/configurations/:id/objects/batch");
    expect(withoutIds("/supplier-share/short")).toBe("/supplier-share/:id");
    expect(withoutIds("/dashboard/clients")).toBe("/dashboard/clients");
    expect(withoutIds("/plan")).toBe("/plan");
    expect(kept({ category: "fetch", data: { url: "https://api.example.test/public/configurations/abc123?revision=4" } }).data?.["url"])
      .toBe("https://api.example.test/public/configurations/:id?[redacted]");
    expect(kept({ category: "navigation", data: { from: "/plan/abc123", to: "/plan-view/Zq3kP9vR2mW7xY1tB8nC4dF" } }).data)
      .toEqual({ from: "/plan/:id", to: "/plan-view/:id" });
    expect(scrubSentryEvent({ request: { url: "https://venviewer.com/plan/abc123?x=1" } }).request).toEqual({ url: "https://venviewer.com/plan/:id" });
  });
});

describe("browser Sentry event scrubber and guests' allergy notes", () => {
  it("scrubs the note from the error message, breadcrumbs and contexts, and keeps the rest", () => {
    const note = "Table 4: severe sesame allergy";
    const metadata = JSON.stringify({ instructions: { dietary: { vegan: 2, otherAllergies: note } } });
    const event: Event = {
      message: `Save failed: ${metadata}`,
      exception: { values: [{ type: "ApiError", value: `Validation failed for ${metadata}` }] },
      breadcrumbs: [{ category: "console", message: `saving ${metadata}`, data: { arguments: [{ otherAllergies: note }] } }],
      contexts: { planner: { dietary: { vegan: 2, otherAllergies: note } } },
    };

    const scrubbed = scrubSentryEvent(event);
    expect(JSON.stringify(scrubbed)).not.toContain("sesame");
    expect(scrubbed.exception?.values?.[0]?.type).toBe("ApiError");
    expect(scrubbed.contexts?.["planner"]).toEqual({ dietary: { vegan: 2, otherAllergies: "[redacted]" } });
  });
});

describe("browser Sentry loading", () => {
  const DSN = "https://public@example.ingest.sentry.io/1";

  afterEach(() => {
    vi.doUnmock("../observability/sentry-sdk.js");
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadWithSdk() {
    vi.resetModules();
    const scope = { setTag: vi.fn(), setContext: vi.fn() };
    const sdk = {
      init: vi.fn(),
      browserApiErrorsIntegration: vi.fn((options: object) => ({ name: "BrowserApiErrors", options })),
      captureException: vi.fn(),
      withScope: vi.fn((callback: (value: typeof scope) => void) => {
        callback(scope);
      }),
    };
    vi.doMock("../observability/sentry-sdk.js", () => sdk);
    const sentry = await import("../observability/sentry.js");
    return { sentry, sdk, scope };
  }

  it("initializes once through the named SDK entry points with the scrubber", async () => {
    const { sentry, sdk } = await loadWithSdk();

    await sentry.initBrowserSentry({ MODE: "production", VITE_SENTRY_DSN: DSN });
    await sentry.initBrowserSentry({ MODE: "production", VITE_SENTRY_DSN: DSN });

    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: DSN,
      environment: "production",
      sendDefaultPii: false,
      beforeSend: sentry.scrubSentryErrorEvent,
      beforeBreadcrumb: sentry.scrubSentryBreadcrumb,
    }));
  });

  it("stops wrapping animation frames and event listeners, and keeps every other default", async () => {
    const { sentry, sdk } = await loadWithSdk();

    await sentry.initBrowserSentry({ MODE: "production", VITE_SENTRY_DSN: DSN });

    const options = sdk.init.mock.calls[0]?.[0] as { integrations: (defaults: { name: string }[]) => { name: string }[] };
    const defaults = [{ name: "InboundFilters" }, { name: "BrowserApiErrors" }, { name: "Breadcrumbs" }];
    const chosen = options.integrations(defaults);
    expect(chosen.map((integration) => integration.name)).toEqual(["InboundFilters", "BrowserApiErrors", "Breadcrumbs"]);
    expect(sdk.browserApiErrorsIntegration).toHaveBeenCalledWith({ requestAnimationFrame: false, eventTarget: false });
    expect(chosen[1]).toBe(sdk.browserApiErrorsIntegration.mock.results[0]?.value);
    expect(chosen[0]).toBe(defaults[0]);
    expect(chosen[2]).toBe(defaults[2]);
  });

  it("reports boundary errors with a trimmed component stack", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", DSN);
    const { sentry, sdk, scope } = await loadWithSdk();
    const error = new Error("render failed");

    await sentry.captureBoundaryError(error, { componentStack: "\n    at Planner\n" });

    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(scope.setTag).toHaveBeenCalledWith("boundary", "AppErrorBoundary");
    expect(scope.setContext).toHaveBeenCalledWith("react", { componentStack: "at Planner" });
    expect(sdk.captureException).toHaveBeenCalledWith(error);
  });
});
