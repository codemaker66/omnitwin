import type { Event } from "@sentry/react";
import { describe, expect, it } from "vitest";
import {
  initBrowserSentry,
  parseSentrySampleRate,
  readBrowserSentryConfig,
  scrubSentryEvent,
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
