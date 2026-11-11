import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { gunzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerErrorNormalizer } from "../middleware/error-normalizer.js";
import { apiLoggerOptions } from "../observability/health-redaction.js";
import { buildSentryCapture, initSentry } from "../observability/sentry.js";
import { PLAN_CLAIM_SECRET_HEADER } from "../services/configuration-claim-secrets.js";

// ---------------------------------------------------------------------------
// The API's errors reach Sentry once, through one path, and carry no visitor
// IP, share token or credential (a sign-in token, a cookie, a guest plan's
// claim secret). The real SDK is initialised against a local stand-in for
// Sentry's ingest (an http server on loopback that keeps every envelope), so
// what is asserted is what would leave the process, transactions included.
// The server is wired as index.ts wires it (Sentry first, then Fastify with
// the error normaliser and its capture hook) and called over real http, so
// the SDK's http instrumentation records the request as in production.
// No database.
// ---------------------------------------------------------------------------

const TOKEN = "tok_SECRET_share_0123456789";
/** The visitor, as Railway's proxy reports them in X-Forwarded-For. */
const VISITOR_IP = "203.0.113.77";
const GUEST_EMAIL = "jane.guest@example.com";
const NOTE = "Severe peanut allergy";
/** A guest plan's claim secret, shaped as services/configuration-claim-secrets.ts
 *  makes one (32 random bytes, base64url). The web app sends it in
 *  X-Plan-Claim-Secret; whoever holds it can claim the plan and read its notes. */
const CLAIM_SECRET = "Cq7e4lRQL_WFKznWkyQKOhXPwYZWA985lb-D9oHBSLg";
/** The sign-in provider's session token (a JWT) as the browser holds it, in
 *  the `__session` cookie. */
const SESSION_COOKIE_TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18ycENhbmFyeUtpZCJ9.eyJzaWQiOiJzZXNzXzJwQ2FuYXJ5U2Vzc2lvbiIsInN1YiI6InVzZXJfMnBDYW5hcnlVc2VyIiwiZXhwIjoxNzk0MzU1MjYwfQ.Tbv0ZU_5wFRsLtfWhWSG750Jk5lvcsDu";
/** A second cookie, whose name no SDK word list catches. */
const OTHER_COOKIE = "vv_returning";
const OTHER_COOKIE_VALUE = "rt_7hQ2mZx9KpL4wN8s";
/** A session token as the web app sends it to the API, in Authorization:
 *  Bearer. Its own session and signature, so a failure says which slot. */
const BEARER_TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18ycENhbmFyeUtpZCJ9.eyJzaWQiOiJzZXNzXzJwQ2FuYXJ5QmVhcmVyIiwic3ViIjoidXNlcl8ycENhbmFyeVVzZXIiLCJleHAiOjE3OTQzNTUzMjB9.Ac1FimF80SQ8bAdy4T-g22SxmJtE75sB";
/** Every credential a request below carries, by what it is. */
const CREDENTIALS: Readonly<Record<string, string>> = {
  "the claim secret": CLAIM_SECRET,
  "the __session cookie": SESSION_COOKIE_TOKEN,
  [`the ${OTHER_COOKIE} cookie`]: OTHER_COOKIE_VALUE,
  "the bearer token": BEARER_TOKEN,
};
/** A header no scrubber drops and no SDK word list masks. Where its value
 *  shows up, a credential header's value would have shown up. */
const CONTROL_HEADER = "x-venviewer-control";
const CONTROL = "control-6Wq1Zr";
/** The attributes the SDK writes for a credential header, in any casing; for
 *  a cookie header, one per cookie: `http.request.header.cookie.<name>`. */
const CREDENTIAL_ATTRIBUTE = /^http\.request\.header\.(cookie|authorization|x_plan_claim_secret)(\.|$)/iu;

interface SentEvent {
  readonly level?: string;
  readonly transaction?: string;
  readonly tags?: Record<string, string>;
  readonly contexts?: Record<string, unknown> & { readonly trace?: { readonly data?: Record<string, unknown> } };
  readonly request?: { readonly url?: string; readonly headers?: Record<string, string>; readonly cookies?: Record<string, string> };
  readonly user?: { readonly ip_address?: string };
  readonly exception?: { readonly values?: readonly { readonly value?: string; readonly mechanism?: { readonly type?: string } }[] };
  readonly spans?: readonly { readonly data?: Record<string, unknown> }[];
}

/** The span attribute the SDK writes for a request header
 *  (@sentry/core 10.60 utils/request.js httpHeadersToSpanAttributes). */
const headerAttribute = (header: string): string => `http.request.header.${header.replaceAll("-", "_")}`;

/** Every place a value sits in the envelopes received so far, as a path such
 *  as `envelope 3 line 2.request.cookies.__session`, so a failure names the
 *  slot. Every line of every envelope is searched, whatever its item type. */
function wherever(value: string, envelopes: readonly string[]): string[] {
  const found: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      if (node.includes(value)) found.push(path);
    } else if (Array.isArray(node)) {
      node.forEach((child: unknown, index) => { visit(child, `${path}[${String(index)}]`); });
    } else if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        if (key.includes(value)) found.push(`${path} (key "${key}")`);
        visit(child, `${path}.${key}`);
      }
    }
  };
  envelopes.forEach((envelope, envelopeIndex) => {
    envelope.split("\n").filter((line) => line.trim() !== "").forEach((line, lineIndex) => {
      visit(JSON.parse(line) as unknown, `envelope ${String(envelopeIndex)} line ${String(lineIndex)}`);
    });
  });
  return found;
}

/** The items of one type in the envelopes received so far (an envelope is
 *  newline-separated JSON: its header, then item header and payload pairs). */
function itemsIn(envelopes: readonly string[], type: "event" | "transaction"): { event: SentEvent; raw: string }[] {
  const items: { event: SentEvent; raw: string }[] = [];
  for (const envelope of envelopes) {
    const lines = envelope.split("\n").filter((line) => line.trim() !== "");
    for (let index = 1; index + 1 < lines.length; index += 2) {
      const header = JSON.parse(lines[index] ?? "{}") as { type?: string };
      const payload = lines[index + 1] ?? "{}";
      if (header.type === type) items.push({ event: JSON.parse(payload) as SentEvent, raw: payload });
    }
  }
  return items;
}
const eventsIn = (envelopes: readonly string[]): { event: SentEvent; raw: string }[] => itemsIn(envelopes, "event");

describe("the API's errors in Sentry", () => {
  const envelopes: string[] = [];
  const logLines: string[] = [];
  /** The headers of every request the API received, as its routes see them. */
  const received: IncomingHttpHeaders[] = [];
  let ingest: Server;
  let server: FastifyInstance;
  let base = "";
  let flush: (timeout: number) => Promise<boolean>;

  beforeAll(async () => {
    ingest = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      request.on("end", () => {
        // The SDK's transport gzips an envelope over 32 KB (@sentry/node-core
        // 10.60 transports/http.js); unread, it would hide what it carries.
        const body = Buffer.concat(chunks);
        envelopes.push((request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => { ingest.listen(0, "127.0.0.1", resolve); });
    const { port } = ingest.address() as AddressInfo;
    const env = {
      SENTRY_DSN: `http://public@127.0.0.1:${String(port)}/1`,
      NODE_ENV: "production",
      SENTRY_TRACES_SAMPLE_RATE: 1,
    } as const;

    // The SDK's transport honours http_proxy; the stand-in ingest is local.
    vi.stubEnv("http_proxy", "");
    vi.stubEnv("HTTP_PROXY", "");
    // As index.ts: Sentry before Fastify, so its instrumentation sees the server.
    await initSentry(env);
    flush = (await import("@sentry/node")).flush;

    const loggerOptions = apiLoggerOptions("production");
    if (loggerOptions === false) throw new Error("production logs");
    const stream = new Writable({ write(chunk: Buffer, _encoding, done) { logLines.push(chunk.toString("utf8")); done(); } });
    server = Fastify({ logger: { ...loggerOptions, stream } });
    const capture = await buildSentryCapture(env);
    expect(capture).toBeTypeOf("function");
    registerErrorNormalizer(server, { onServerError: capture });
    server.addHook("onRequest", (request, _reply, done) => { received.push({ ...request.headers }); done(); });

    server.get("/boom", () => { throw new Error("the database fell over"); });
    server.get("/missing", () => { throw Object.assign(new Error("No such proposal"), { statusCode: 404 }); });
    server.post("/invalid", (request) => z.object({ guests: z.number() }).parse(request.body));
    server.post("/proposal-share/:token/approve", () => { throw new Error("approval could not be stored"); });
    server.get("/clients/search", () => ({ data: [] }));
    await server.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${String((server.server.address() as AddressInfo).port)}`;
  }, 60_000);

  /** Calls the API as a signed-in browser could: every request carries a
   *  bearer token, the session cookie and another cookie, the guest plan's
   *  claim secret, and the control header beside them. */
  async function call(method: string, path: string, body?: unknown): Promise<number> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "x-forwarded-for": VISITOR_IP,
        Authorization: `Bearer ${BEARER_TOKEN}`,
        Cookie: `__session=${SESSION_COOKIE_TOKEN}; ${OTHER_COOKIE}=${OTHER_COOKIE_VALUE}`,
        "X-Plan-Claim-Secret": CLAIM_SECRET,
        "X-Venviewer-Control": CONTROL,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await response.arrayBuffer();
    return response.status;
  }

  /** A GET with its header lines exactly as given: names in any case, a
   *  header repeated on several lines. */
  function rawCall(path: string, headerLines: readonly string[]): Promise<number> {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(`${base}${path}`, { method: "GET", headers: ["Host", base.slice("http://".length), ...headerLines] }, (response) => {
        response.resume();
        response.on("end", () => { resolve(response.statusCode ?? 0); });
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  afterAll(async () => {
    vi.unstubAllEnvs();
    await server?.close();
    await new Promise<void>((resolve) => { ingest?.close(() => { resolve(); }); });
  });

  it("captures each server error once, with its route, and never an error that answers 4xx", async () => {
    expect(await call("GET", "/boom")).toBe(500);
    expect(await call("GET", "/missing")).toBe(404);
    expect(await call("POST", "/invalid", { guests: "many" })).toBe(400);
    expect(await call("POST", `/proposal-share/${TOKEN}/approve`, { name: "Jane Guest", email: GUEST_EMAIL, dietary: NOTE })).toBe(500);
    expect(await call("GET", `/clients/search?q=${encodeURIComponent(GUEST_EMAIL)}`)).toBe(200);
    expect(await flush(5_000)).toBe(true);

    const events = eventsIn(envelopes);
    expect(events.map(({ event }) => event.exception?.values?.[0]?.value).sort())
      .toEqual(["approval could not be stored", "the database fell over"]);
    for (const { event } of events) {
      // The normaliser's hook, not the SDK's automatic Fastify capture.
      expect(event.exception?.values?.[0]?.mechanism?.type).not.toBe("auto.function.fastify");
      expect(event.tags?.["route.url"]).toMatch(/^\/(boom|proposal-share\/:token\/approve)$/u);
    }
  });

  it("sends neither the visitor's IP address, the share token nor the request body, in events or transactions", () => {
    const approval = eventsIn(envelopes).find(({ event }) => event.tags?.["route.url"] === "/proposal-share/:token/approve");
    expect(approval).toBeDefined();
    // The request id joins the event to its log line; no address beside it.
    expect(approval?.event.contexts?.["request"]).toEqual({ id: expect.any(String) as unknown });
    expect(approval?.event.user?.ip_address).toBeUndefined();
    expect(approval?.event.request?.url).toBe(`${base}/proposal-share/:token/approve`);
    expect(approval?.raw).not.toContain(TOKEN);
    // Nor in the approval's transaction and its spans.
    const transaction = itemsIn(envelopes, "transaction").find(({ event }) => event.transaction === "POST /proposal-share/:token/approve");
    expect(transaction).toBeDefined();
    expect(transaction?.raw).not.toContain(TOKEN);
    expect(transaction?.raw).not.toContain(VISITOR_IP);
    expect(itemsIn(envelopes, "transaction").some(({ event }) => event.transaction === "GET /clients/search")).toBe(true);
    // Nor anywhere else: no envelope holds the token, the visitor's address,
    // the request body (the guest's email and allergy note) or the search term.
    const everything = envelopes.join("\n");
    for (const secret of [TOKEN, VISITOR_IP, GUEST_EMAIL, encodeURIComponent(GUEST_EMAIL), "jane.guest", "peanut"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("keeps the share token out of the request log", () => {
    const text = logLines.join("");
    expect(text).toContain("/proposal-share/:token/approve");
    expect(text).not.toContain(TOKEN);
  });

  it("sends no credential anywhere: no sign-in token, cookie or claim secret in any event, transaction, span or log line", async () => {
    // One more server error, its header names cased as a client may send
    // them and the cookies split over two lines (Node joins them with "; ").
    expect(await rawCall("/boom", [
      "x-forwarded-for", VISITOR_IP,
      "AUTHORIZATION", `Bearer ${BEARER_TOKEN}`,
      "COOKIE", `__session=${SESSION_COOKIE_TOKEN}`,
      "cookie", `${OTHER_COOKIE}=${OTHER_COOKIE_VALUE}`,
      "X-PLAN-CLAIM-SECRET", CLAIM_SECRET,
      "X-Venviewer-Control", CONTROL,
    ])).toBe(500);
    expect(await flush(5_000)).toBe(true);

    const events = eventsIn(envelopes);
    // The API's transactions, not the stand-in ingest's own (it is an http
    // server in this process, so the SDK traces the envelopes it receives).
    const transactions = itemsIn(envelopes, "transaction").filter(({ event }) => event.request?.url?.startsWith(base) === true);
    // Every request carried every credential, and the API received them.
    expect(received.length).toBeGreaterThanOrEqual(6);
    for (const headers of received) {
      expect(headers[PLAN_CLAIM_SECRET_HEADER]).toBe(CLAIM_SECRET);
      expect(headers.authorization).toBe(`Bearer ${BEARER_TOKEN}`);
      expect(headers.cookie).toBe(`__session=${SESSION_COOKIE_TOKEN}; ${OTHER_COOKIE}=${OTHER_COOKIE_VALUE}`);
    }
    // Not vacuous: the header beside them, which nothing scrubs, reached every
    // slot a credential header would: each event's and each transaction's
    // request headers, and the header attribute on each transaction's trace.
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(transactions.length).toBeGreaterThanOrEqual(4);
    const name = (event: SentEvent): string => event.transaction ?? event.exception?.values?.[0]?.value ?? "?";
    expect([...events, ...transactions]
      .filter(({ event }) => event.request?.headers?.[CONTROL_HEADER] !== CONTROL)
      .map(({ event }) => `${name(event)}: ${JSON.stringify(event.request)}`)).toEqual([]);
    expect(transactions
      .filter(({ event }) => event.contexts?.trace?.data?.[headerAttribute(CONTROL_HEADER)] !== CONTROL)
      .map(({ event }) => `${name(event)}: ${JSON.stringify(event.contexts?.trace?.data)}`)).toEqual([]);
    // The slots that would hold them: no parsed cookies on any event or
    // transaction, and no credential header's attribute on any trace or span.
    // (Soft, so one run names every slot that leaks.)
    expect.soft([...events, ...transactions].filter(({ event }) => event.request?.cookies !== undefined)
      .map(({ event }) => `${name(event)}: ${JSON.stringify(event.request?.cookies)}`)).toEqual([]);
    const attributeKeys = transactions.flatMap(({ event }) => [event.contexts?.trace?.data, ...(event.spans ?? []).map((span) => span.data)])
      .flatMap((data) => Object.keys(data ?? {}));
    expect.soft(attributeKeys.filter((key) => CREDENTIAL_ATTRIBUTE.test(key))).toEqual([]);
    // The values: in no slot of any envelope, nor in their raw text, nor in
    // the request log.
    const log = logLines.join("");
    expect(log).toContain("/boom");
    for (const [what, value] of Object.entries(CREDENTIALS)) {
      expect.soft(wherever(value, envelopes), what).toEqual([]);
      expect.soft(envelopes.join("\n"), what).not.toContain(value);
      expect.soft(log, what).not.toContain(value);
    }
  });
});
