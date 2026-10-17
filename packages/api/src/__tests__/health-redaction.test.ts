import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { apiLoggerOptions, scrubApiSentryEvent } from "../observability/health-redaction.js";

// ---------------------------------------------------------------------------
// Guests' allergy notes never reach a log line or an error report
// (fix-first item 18). The logger is exercised for real: a Fastify instance
// built from the API's own logger options writes into a captured stream.
// ---------------------------------------------------------------------------

const NOTE = "Table 4: severe sesame allergy; one guest coeliac";
const metadata = { instructions: { dietary: { vegetarian: 12, otherAllergies: NOTE } } };

function capturedLogger(): { readonly lines: string[]; readonly server: ReturnType<typeof Fastify> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) { lines.push(chunk.toString("utf8")); done(); },
  });
  const options = apiLoggerOptions("production");
  if (options === false) throw new Error("production must log");
  return { lines, server: Fastify({ logger: { ...options, stream } }) };
}

describe("the API logger", () => {
  it("logs in development and production, each with the redaction hook, and not under test", () => {
    for (const mode of ["development", "production"] as const) {
      const options = apiLoggerOptions(mode);
      expect(options === false ? null : options.hooks?.streamWrite).toBeTypeOf("function");
    }
    expect(apiLoggerOptions("test")).toBe(false);
  });

  it("scrubs the note from a logged body, a database error and a plain message", async () => {
    const { lines, server } = capturedLogger();
    await server.ready();
    const dbError = Object.assign(
      new Error(`Failed query: update "configurations" set "metadata" = $1\nparams: ${JSON.stringify(metadata)}`),
      { detail: `Failing row contains (${JSON.stringify(metadata)})`, code: "23514" },
    );
    server.log.info({ body: { metadata } }, "saving the layout");
    server.log.error({ err: dbError }, "request errored");
    server.log.warn(`otherAllergies=${NOTE.split(";")[0] ?? ""}; retrying`);
    await server.close();

    const output = lines.join("");
    expect(output).not.toContain("sesame");
    expect(output).not.toContain("coeliac");
    expect(output).toContain("[redacted]");
    // What the operator needs is still there.
    expect(output).toContain("request errored");
    expect(output).toContain("23514");
    expect(output).toContain("\"vegetarian\":12");
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();
  });
});

describe("the API's Sentry beforeSend", () => {
  it("drops the body, query and credentials, and scrubs the note everywhere else", () => {
    const event = {
      message: `update failed: {"otherAllergies":"${NOTE}"}`,
      exception: { values: [{ type: "DrizzleQueryError", value: `params: ${JSON.stringify(metadata)}` }] },
      breadcrumbs: [{ category: "query", message: "insert", data: { params: [JSON.stringify(metadata)] } }],
      extra: { metadata },
      request: {
        url: "https://api.example.test/configurations/x",
        data: JSON.stringify(metadata),
        query_string: "a=b",
        headers: { authorization: "Bearer secret", cookie: "c=d", "user-agent": "test" } as Record<string, string>,
      },
    };
    const scrubbed = scrubApiSentryEvent(event);
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain("sesame");
    expect(text).not.toContain("secret");
    expect(scrubbed.request.data).toBeUndefined();
    expect(scrubbed.request.query_string).toBeUndefined();
    expect(scrubbed.request.headers).toEqual({ "user-agent": "test" });
    expect(scrubbed.exception.values[0]?.type).toBe("DrizzleQueryError");
    expect(scrubbed.extra.metadata.instructions.dietary).toEqual({ vegetarian: 12, otherAllergies: "[redacted]" });
  });
});
