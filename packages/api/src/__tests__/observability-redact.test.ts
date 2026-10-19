import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { Breadcrumb, ErrorEvent } from "@sentry/node";
import {
  REDACTED_QUERY_MARKER,
  requestLogSerializer,
  scrubBreadcrumb,
  scrubErrorEvent,
  scrubTransaction,
  withoutQuery,
  type ScrubbableTransaction,
} from "../observability/redact.js";

// ---------------------------------------------------------------------------
// Query strings carry search terms (a client's name, email or phone), so
// they never reach the request log or an error report. No database needed.
// ---------------------------------------------------------------------------

const EMAIL = "aileen.murray@example.test";
const PHONE_QUERY = "q=0141%20555%200100";

describe("withoutQuery", () => {
  it("cuts a relative URL at the first question mark and leaves a marker", () => {
    expect(withoutQuery("/people/search?q=Aileen")).toBe("/people/search?[redacted]");
  });

  it("handles an absolute URL, dropping the query and the fragment", () => {
    expect(withoutQuery("https://api.example.test/people/search?q=x#frag")).toBe(
      "https://api.example.test/people/search?[redacted]",
    );
  });

  it("returns a URL with no query unchanged", () => {
    expect(withoutQuery("/people/search")).toBe("/people/search");
    expect(withoutQuery("https://api.example.test/health")).toBe("https://api.example.test/health");
  });

  it("leaves a fragment-only URL unchanged", () => {
    expect(withoutQuery("/docs#section")).toBe("/docs#section");
  });

  it("keeps an email in the query out of the result", () => {
    const out = withoutQuery(`/clients/search?q=${EMAIL}&limit=5`);
    expect(out).toBe("/clients/search?[redacted]");
    expect(out).not.toContain("aileen");
  });

  it("keeps a phone number in the query out of the result", () => {
    const out = withoutQuery(`/clients/search?${PHONE_QUERY}`);
    expect(out).toBe("/clients/search?[redacted]");
    expect(out).not.toContain("0141");
  });

  it("treats an empty query as a query", () => {
    expect(withoutQuery("/people/search?")).toBe("/people/search?[redacted]");
  });

  it("exposes the marker it appends", () => {
    expect(REDACTED_QUERY_MARKER).toBe("?[redacted]");
  });
});

describe("requestLogSerializer", () => {
  it("serialises the fields Fastify logs by default, with only the url redacted", () => {
    const serialised = requestLogSerializer({
      method: "GET",
      url: `/people/search?q=${EMAIL}`,
      headers: { "accept-version": "1.0.0" },
      host: "api.example.test",
      ip: "203.0.113.7",
      socket: { remotePort: 51234 },
    });
    expect(serialised).toEqual({
      method: "GET",
      url: "/people/search?[redacted]",
      version: "1.0.0",
      host: "api.example.test",
      remoteAddress: "203.0.113.7",
      remotePort: 51234,
    });
  });

  it("tolerates a request with no headers and no socket", () => {
    const serialised = requestLogSerializer({
      method: "POST",
      url: "/enquiries",
      host: "api.example.test",
      ip: "203.0.113.8",
    });
    expect(serialised).toEqual({
      method: "POST",
      url: "/enquiries",
      version: undefined,
      host: "api.example.test",
      remoteAddress: "203.0.113.8",
      remotePort: undefined,
    });
  });

  it("matches Fastify's default serializer key for key, and keeps the search term out of the real log", async () => {
    async function logLines(withSerializer: boolean): Promise<Record<string, unknown>[]> {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk: Buffer, _encoding, callback): void {
          chunks.push(chunk.toString("utf8"));
          callback();
        },
      });
      const app = Fastify({
        logger: {
          level: "info",
          stream,
          ...(withSerializer ? { serializers: { req: requestLogSerializer } } : {}),
        },
      });
      app.get("/people/search", () => ({ ok: true }));
      await app.inject({ method: "GET", url: `/people/search?q=${EMAIL}` });
      await app.close();
      return chunks
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    const defaults = await logLines(false);
    const redacted = await logLines(true);

    const defaultReq = defaults.find((line) => "req" in line)?.["req"] as Record<string, unknown>;
    const redactedReq = redacted.find((line) => "req" in line)?.["req"] as Record<string, unknown>;

    // The baseline really does leak, so the comparison is meaningful.
    expect(JSON.stringify(defaults)).toContain("aileen.murray");
    // After the change nothing in any line carries the term.
    expect(JSON.stringify(redacted)).not.toContain("aileen");
    expect(redactedReq["url"]).toBe("/people/search?[redacted]");

    // Same field set as the default (JSON drops undefined values on both sides).
    expect(Object.keys(redactedReq).sort()).toEqual(Object.keys(defaultReq).sort());
    for (const key of Object.keys(defaultReq)) {
      if (key === "url") continue;
      expect(redactedReq[key]).toEqual(defaultReq[key]);
    }
  });
});

describe("scrubErrorEvent", () => {
  it("keeps the existing behaviour: no body, no query_string, no authorization or cookie", () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: "https://api.example.test/enquiries",
        method: "POST",
        data: { email: EMAIL },
        query_string: `q=${EMAIL}`,
        headers: {
          authorization: "Bearer synthetic-token",
          cookie: "session=synthetic",
          "user-agent": "vitest",
        },
      },
    };
    const out = scrubErrorEvent(event);
    expect(out.request?.data).toBeUndefined();
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.headers).toEqual({ "user-agent": "vitest" });
    expect(out.request?.method).toBe("POST");
    expect(out.request?.url).toBe("https://api.example.test/enquiries");
  });

  it("also strips the query from request.url", () => {
    const out = scrubErrorEvent({
      type: undefined,
      request: { url: `https://api.example.test/people/search?q=${EMAIL}` },
    });
    expect(out.request?.url).toBe("https://api.example.test/people/search?[redacted]");
  });

  it("passes an event with no request through untouched", () => {
    const event: ErrorEvent = { type: undefined, message: "boom" };
    expect(scrubErrorEvent(event)).toEqual({ type: undefined, message: "boom" });
  });
});

describe("scrubBreadcrumb", () => {
  it("strips the query from an http breadcrumb's data.url and message", () => {
    const crumb: Breadcrumb = {
      type: "http",
      category: "http",
      message: `GET https://api.example.test/clients/search?${PHONE_QUERY}`,
      data: {
        url: `https://api.example.test/clients/search?${PHONE_QUERY}`,
        method: "GET",
        status_code: 200,
      },
    };
    const out = scrubBreadcrumb(crumb);
    expect(out).not.toBeNull();
    expect(out?.data).toEqual({
      url: "https://api.example.test/clients/search?[redacted]",
      method: "GET",
      status_code: 200,
    });
    expect(out?.message).toBe("GET https://api.example.test/clients/search?[redacted]");
  });

  it("leaves a non-http breadcrumb's message alone", () => {
    const crumb: Breadcrumb = { category: "console", message: "what is this? a question" };
    expect(scrubBreadcrumb(crumb)).toEqual({ category: "console", message: "what is this? a question" });
  });

  it("ignores a non-string data.url", () => {
    const crumb: Breadcrumb = { type: "http", data: { url: 42 } };
    expect(scrubBreadcrumb(crumb)).toEqual({ type: "http", data: { url: 42 } });
  });

  it("passes a breadcrumb with no data through", () => {
    expect(scrubBreadcrumb({ message: "hello" })).toEqual({ message: "hello" });
  });
});

describe("scrubTransaction", () => {
  function transaction(): ScrubbableTransaction {
    return {
      type: "transaction",
      request: {
        url: `https://api.example.test/people/search?q=${EMAIL}`,
        query_string: `q=${EMAIL}`,
        method: "GET",
      },
      contexts: {
        trace: {
          trace_id: "00000000000000000000000000000001",
          span_id: "0000000000000001",
          data: {
            "url.full": `https://api.example.test/people/search?q=${EMAIL}`,
            "http.target": `/people/search?q=${EMAIL}`,
            "url.query": `q=${EMAIL}`,
            "http.method": "GET",
          },
        },
      },
      spans: [
        {
          trace_id: "00000000000000000000000000000001",
          span_id: "0000000000000002",
          start_timestamp: 1,
          data: {
            "http.url": `https://api.example.test/clients/search?${PHONE_QUERY}`,
            "url.full": `https://api.example.test/clients/search?${PHONE_QUERY}`,
            "http.target": `/clients/search?${PHONE_QUERY}`,
            "url.query": PHONE_QUERY,
            "http.status_code": 200,
          },
        },
        {
          trace_id: "00000000000000000000000000000001",
          span_id: "0000000000000003",
          start_timestamp: 2,
          data: { "db.system": "postgresql" },
        },
      ],
    };
  }

  it("scrubs request.url and query_string", () => {
    const out = scrubTransaction(transaction());
    expect(out.request?.url).toBe("https://api.example.test/people/search?[redacted]");
    expect(out.request?.query_string).toBeUndefined();
    expect(out.request?.method).toBe("GET");
  });

  it("scrubs the trace context data", () => {
    const out = scrubTransaction(transaction());
    expect(out.contexts?.trace?.data).toEqual({
      "url.full": "https://api.example.test/people/search?[redacted]",
      "http.target": "/people/search?[redacted]",
      "http.method": "GET",
    });
  });

  it("scrubs every span's data and leaves unrelated attributes alone", () => {
    const out = scrubTransaction(transaction());
    expect(out.spans?.[0]?.data).toEqual({
      "http.url": "https://api.example.test/clients/search?[redacted]",
      "url.full": "https://api.example.test/clients/search?[redacted]",
      "http.target": "/clients/search?[redacted]",
      "http.status_code": 200,
    });
    expect(out.spans?.[1]?.data).toEqual({ "db.system": "postgresql" });
  });

  it("leaves no trace of either search term anywhere in the transaction", () => {
    const serialised = JSON.stringify(scrubTransaction(transaction()));
    expect(serialised).not.toContain("aileen");
    expect(serialised).not.toContain("0141");
  });

  it("ignores URL attributes that are not strings and a transaction with no spans or contexts", () => {
    const out = scrubTransaction({
      type: "transaction",
      spans: [
        {
          trace_id: "00000000000000000000000000000001",
          span_id: "0000000000000004",
          start_timestamp: 3,
          data: { "url.full": 7 },
        },
      ],
    });
    expect(out.spans?.[0]?.data).toEqual({ "url.full": 7 });
    expect(scrubTransaction({ type: "transaction" })).toEqual({ type: "transaction" });
  });
});
