import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { Breadcrumb, ErrorEvent } from "@sentry/node";
import { DrizzleQueryError } from "drizzle-orm";
import { registerErrorNormalizer } from "../middleware/error-normalizer.js";
import {
  REDACTED_PARAMS_MARKER,
  REDACTED_QUERY_MARKER,
  errorLogSerializer,
  requestLogSerializer,
  scrubBreadcrumb,
  scrubErrorEvent,
  scrubErrorMessage,
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

// ---------------------------------------------------------------------------
// Error values. drizzle-orm's DrizzleQueryError writes its parameters into
// the message ("Failed query: <sql>\nparams: <values>") and wraps the pg error
// whose `detail` quotes the offending row. Neither may reach the error log or
// a Sentry exception.
// ---------------------------------------------------------------------------

const PHONE = "0141 555 0100";
const SQL = 'insert into "contact_methods" ("contact_id", "kind", "value") values ($1, $2, $3)';
const CONSTRAINT = "contact_methods_value_key";

/** The shape node-postgres gives a unique-violation: personal data in detail and where. */
function pgUniqueViolation(): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${CONSTRAINT}"`), {
    name: "error",
    severity: "ERROR",
    code: "23505",
    detail: `Key (contact_id, kind, value)=(c1, email, ${EMAIL}) already exists.`,
    hint: undefined,
    where: `SQL statement for ${EMAIL}`,
    schema: "public",
    table: "contact_methods",
    column: "value",
    constraint: CONSTRAINT,
    routine: "_bt_check_unique",
  });
}

function drizzleQueryError(): DrizzleQueryError {
  return new DrizzleQueryError(SQL, ["c1", "email", EMAIL, PHONE], pgUniqueViolation());
}

describe("scrubErrorMessage", () => {
  it("replaces a DrizzleQueryError's parameters and keeps the SQL", () => {
    const message = `Failed query: ${SQL}\nparams: c1,email,${EMAIL},${PHONE}`;
    const out = scrubErrorMessage(message);
    expect(out).toBe(`Failed query: ${SQL}\n${REDACTED_PARAMS_MARKER}`);
    expect(out).not.toContain("aileen");
    expect(out).not.toContain("0141");
  });

  it("works on the message of a real DrizzleQueryError", () => {
    const out = scrubErrorMessage(drizzleQueryError().message);
    expect(out).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
  });

  it("redacts a parameters block that itself spans several lines, but stops at the stack", () => {
    const stack = [
      `Error: Failed query: ${SQL}`,
      `params: c1,email,${EMAIL},12 High Street`,
      "Glasgow G1 1AA",
      "    at PgPreparedQuery.queryWithCache (file.js:1:1)",
      "    at async handler (file.js:2:2)",
    ].join("\n");
    const out = scrubErrorMessage(stack);
    expect(out).not.toContain("aileen");
    expect(out).not.toContain("High Street");
    expect(out).not.toContain("G1 1AA");
    expect(out).toContain("    at PgPreparedQuery.queryWithCache (file.js:1:1)");
    expect(out).toContain("    at async handler (file.js:2:2)");
    expect(out).toContain(`Error: Failed query: ${SQL}\nparams: [redacted]\n    at`);
  });

  it("stops the block at a following 'caused by:' line", () => {
    const out = scrubErrorMessage(`Failed query: ${SQL}\nparams: ${EMAIL}\ncaused by: connection reset`);
    expect(out).toBe(`Failed query: ${SQL}\nparams: [redacted]\ncaused by: connection reset`);
  });

  it("leaves a message with no params unchanged", () => {
    expect(scrubErrorMessage("connection terminated unexpectedly")).toBe("connection terminated unexpectedly");
    expect(scrubErrorMessage("")).toBe("");
    // 'params' mid-line is not a parameters block.
    expect(scrubErrorMessage("route params: id is required")).toBe("route params: id is required");
  });
});

describe("errorLogSerializer", () => {
  it("keeps the diagnostic fields and drops query values, detail and where, down the cause chain", () => {
    const serialised = errorLogSerializer(drizzleQueryError());

    expect(serialised.type).toBe("DrizzleQueryError");
    expect(serialised.message).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
    expect(serialised.stack).toContain(REDACTED_PARAMS_MARKER);
    expect(serialised).not.toHaveProperty("params");
    expect(serialised).not.toHaveProperty("query");

    const cause = serialised["cause"] as Record<string, unknown>;
    expect(cause["type"]).toBe("Error");
    expect(cause["message"]).toBe(`duplicate key value violates unique constraint "${CONSTRAINT}"`);
    expect(cause["code"]).toBe("23505");
    expect(cause["constraint"]).toBe(CONSTRAINT);
    expect(cause["table"]).toBe("contact_methods");
    expect(cause["column"]).toBe("value");
    expect(cause["routine"]).toBe("_bt_check_unique");
    expect(cause["severity"]).toBe("ERROR");
    expect(cause).not.toHaveProperty("detail");
    expect(cause).not.toHaveProperty("where");
    expect(cause["stack"]).toEqual(expect.any(String));
  });

  it("leaves no email or phone anywhere in the serialised output", () => {
    const text = JSON.stringify(errorLogSerializer(drizzleQueryError()));
    expect(text).not.toContain("aileen");
    expect(text).not.toContain("example.test");
    expect(text).not.toContain("0141");
  });

  it("scrubs the stack, which begins with the message", () => {
    const err = drizzleQueryError();
    expect(err.stack).toContain(EMAIL);
    const serialised = errorLogSerializer(err);
    expect(serialised.stack).not.toContain(EMAIL);
    expect(serialised.stack).toContain("    at ");
  });

  it("scrubs a personal-data property even when it is on a nested cause two levels down", () => {
    const outer = new Error("outer", {
      cause: new Error("middle", { cause: Object.assign(new Error("inner"), { detail: EMAIL, code: "23505" }) }),
    });
    const text = JSON.stringify(errorLogSerializer(outer));
    expect(text).not.toContain("aileen");
    expect(text).toContain("23505");
  });

  it("copes with a circular cause chain", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(() => JSON.stringify(errorLogSerializer(a))).not.toThrow();
  });

  it("serialises a thrown non-error as a scrubbed message", () => {
    const serialised = errorLogSerializer(`Failed query: ${SQL}\nparams: ${EMAIL}`);
    expect(serialised.type).toBe("NonError");
    expect(serialised.message).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
  });

  it("keeps the email out of the real Fastify error log, which leaks it by default", async () => {
    async function logOutput(withSerializer: boolean): Promise<string> {
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
          ...(withSerializer ? { serializers: { err: errorLogSerializer } } : {}),
        },
      });
      registerErrorNormalizer(app);
      app.post("/people", () => {
        throw drizzleQueryError();
      });
      const response = await app.inject({ method: "POST", url: "/people" });
      await app.close();
      expect(response.statusCode).toBe(500);
      return chunks.join("");
    }

    // The baseline really does leak, so the comparison is meaningful.
    expect(await logOutput(false)).toContain(EMAIL);

    const redacted = await logOutput(true);
    expect(redacted).toContain("request errored");
    expect(redacted).not.toContain("aileen");
    expect(redacted).not.toContain("example.test");
    expect(redacted).not.toContain("0141");
    // Still diagnosable: the constraint and code survive.
    expect(redacted).toContain(CONSTRAINT);
    expect(redacted).toContain("23505");
  });
});

describe("scrubErrorEvent exception values", () => {
  it("redacts parameters in every exception value, including linked causes", () => {
    const event: ErrorEvent = {
      type: undefined,
      exception: {
        values: [
          { type: "error", value: `duplicate key value violates unique constraint "${CONSTRAINT}"` },
          { type: "DrizzleQueryError", value: `Failed query: ${SQL}\nparams: c1,email,${EMAIL},${PHONE}` },
          { type: "Error" },
        ],
      },
    };
    const out = scrubErrorEvent(event);
    expect(out.exception?.values?.[0]?.value).toBe(`duplicate key value violates unique constraint "${CONSTRAINT}"`);
    expect(out.exception?.values?.[1]?.value).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
    expect(out.exception?.values?.[2]).toEqual({ type: "Error" });
    const text = JSON.stringify(out);
    expect(text).not.toContain("aileen");
    expect(text).not.toContain("0141");
  });

  it("still scrubs the request when exception values are present", () => {
    const out = scrubErrorEvent({
      type: undefined,
      request: { url: `https://api.example.test/people/search?q=${EMAIL}` },
      exception: { values: [{ value: `Failed query: ${SQL}\nparams: ${EMAIL}` }] },
    });
    expect(out.request?.url).toBe("https://api.example.test/people/search?[redacted]");
    expect(out.exception?.values?.[0]?.value).toBe(`Failed query: ${SQL}\nparams: [redacted]`);
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

  it("removes the query and fragment @sentry/node-core moves out of an outgoing request's url", () => {
    // @sentry/node-core 10.60 (utils/outgoingFetchRequest.js getBreadcrumbData)
    // writes the url without its query, then the query and fragment as their own keys.
    const crumb: Breadcrumb = {
      type: "http",
      category: "http",
      data: {
        url: "https://api.example.test/clients/search",
        "http.method": "GET",
        "http.query": "?q=Aileen",
        "http.fragment": "#top",
        status_code: 200,
      },
    };
    const out = scrubBreadcrumb(crumb);
    expect(JSON.stringify(out)).not.toContain("Aileen");
    expect(out.data).toEqual({ url: "https://api.example.test/clients/search", "http.method": "GET", status_code: 200 });
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
