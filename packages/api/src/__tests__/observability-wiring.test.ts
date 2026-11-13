import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/node";
import { HEALTH_REDACTING_LOG_HOOKS, apiLoggerOptions } from "../observability/health-redaction.js";
import {
  REDACTED_PARAMS_MARKER,
  errorLogSerializer,
  requestLogSerializer,
  scrubBreadcrumb,
  scrubTransaction,
} from "../observability/redact.js";
import { buildSentryOptions } from "../observability/sentry.js";

// ---------------------------------------------------------------------------
// The wiring: the redaction in observability/redact.ts reaches the server only
// through master's logger builder (apiLoggerOptions) and the Sentry options
// builder. A merge once dropped it from both, so the builders themselves are
// checked here, and the production logger is run for real. No database.
// ---------------------------------------------------------------------------

const TERM = "Aileen";
const EMAIL = "aileen@example.test";
const NOTE = "Table 2: fictional walnut allergy";

describe("the API logger's options", () => {
  it.each(["development", "production"] as const)("carry the query and error redaction and the allergy-note hook in %s", (mode) => {
    const options = apiLoggerOptions(mode);
    if (options === false) throw new Error(`${mode} must log`);
    expect(options.serializers?.req).toBe(requestLogSerializer);
    expect(options.serializers?.err).toBe(errorLogSerializer);
    expect(options.hooks?.streamWrite).toBe(HEALTH_REDACTING_LOG_HOOKS.streamWrite);
  });

  it("stay off under test", () => {
    expect(apiLoggerOptions("test")).toBe(false);
  });

  it("keep a search term, query parameters and an allergy note out of the real production log", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) { lines.push(chunk.toString("utf8")); done(); },
    });
    const options = apiLoggerOptions("production");
    if (options === false) throw new Error("production must log");
    const server = Fastify({ logger: { ...options, stream } });
    server.get("/people/search", (_request, reply) => reply.send({ data: [] }));
    await server.ready();

    const response = await server.inject({ method: "GET", url: `/people/search?q=${TERM}` });
    expect(response.statusCode).toBe(200);
    const dbError = Object.assign(
      new Error(`Failed query: select "id" from "contacts" where "email" = $1\nparams: ${EMAIL}`),
      { code: "23505", detail: `Key (email)=(${EMAIL}) already exists.` },
    );
    server.log.error({ err: dbError }, "request errored");
    server.log.info({ body: { otherAllergies: NOTE } }, "saving the layout");
    await server.close();

    const output = lines.join("");
    expect(output).not.toContain(TERM);
    expect(output).not.toContain(EMAIL);
    expect(output).not.toContain("walnut");
    expect(output).toContain("/people/search?[redacted]");
    expect(output).toContain(REDACTED_PARAMS_MARKER);
    expect(output).toContain("23505");
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();
  });
});

describe("the API's Sentry options", () => {
  const options = buildSentryOptions({
    SENTRY_DSN: "https://public@o0.ingest.example.test/1",
    NODE_ENV: "production",
    SENTRY_TRACES_SAMPLE_RATE: 0.1,
  });

  it("carry the settings and every redaction hook", () => {
    expect(options.dsn).toBe("https://public@o0.ingest.example.test/1");
    expect(options.environment).toBe("production");
    expect(options.tracesSampleRate).toBe(0.1);
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeSendTransaction).toBe(scrubTransaction);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
  });

  it("name SENTRY_ENVIRONMENT over NODE_ENV when it is set", () => {
    expect(buildSentryOptions({ NODE_ENV: "production", SENTRY_ENVIRONMENT: "staging", SENTRY_TRACES_SAMPLE_RATE: 0 }).environment)
      .toBe("staging");
  });

  it("send an error event through both scrubbers: the query, the parameters and the allergy note", async () => {
    const beforeSend = options.beforeSend;
    if (beforeSend === undefined) throw new Error("beforeSend missing");
    const event: ErrorEvent = {
      type: undefined,
      message: `update failed: {"otherAllergies":"${NOTE}"}`,
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value: `Failed query: select "id" from "contacts" where "email" = $1\nparams: ${EMAIL}`,
        }],
      },
      request: {
        url: `https://api.example.test/people/search?q=${TERM}`,
        query_string: `q=${TERM}`,
        data: JSON.stringify({ email: EMAIL }),
        headers: { authorization: "Bearer fictional-token", cookie: "c=d", "user-agent": "test" },
      },
      extra: { metadata: { instructions: { dietary: { vegan: 1, otherAllergies: NOTE } } } },
    };

    const scrubbed = await beforeSend(event, {});
    if (scrubbed === null) throw new Error("the event was dropped");
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain(TERM);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain("walnut");
    expect(text).not.toContain("fictional-token");
    // scrubErrorEvent (observability/redact.ts): the url's query and the parameters.
    expect(scrubbed.request?.url).toBe("https://api.example.test/people/search?[redacted]");
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      `Failed query: select "id" from "contacts" where "email" = $1\n${REDACTED_PARAMS_MARKER}`,
    );
    // scrubApiSentryEvent (observability/health-redaction.ts): the note, wherever it sits.
    expect(scrubbed.extra?.["metadata"]).toEqual({ instructions: { dietary: { vegan: 1, otherAllergies: "[redacted]" } } });
    expect(scrubbed.request?.headers).toEqual({ "user-agent": "test" });
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.query_string).toBeUndefined();
  });
});
