import type { Breadcrumb, Event } from "@sentry/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initBrowserSentry,
  parseSentrySampleRate,
  readBrowserSentryConfig,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  withoutQuery,
} from "../observability/sentry.js";

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
    const scrubbed = scrubSentryBreadcrumb({
      category: "xhr",
      type: "http",
      data: { method: "GET", url: "/clients/search?q=aileen%40example.test", status_code: 200 },
    });
    expect(scrubbed.data?.["url"]).toBe("/clients/search?[redacted]");
  });

  it("keeps the query out of a navigation breadcrumb's from and to", () => {
    const scrubbed = scrubSentryBreadcrumb({
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
