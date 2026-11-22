import Anthropic, { toFile, type ClientOptions, type Middleware } from "@anthropic-ai/sdk";
import type { AgentCreateParams, AgentUpdateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { BetaEnvironment, EnvironmentCreateParams, EnvironmentUpdateParams } from "@anthropic-ai/sdk/resources/beta/environments/environments";
import type {
  BetaManagedAgentsEventParams,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { BetaManagedAgentsSession, SessionCreateParams } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import { isWorkspaceKey } from "../keys.js";
import { chunksOf, OutputTimeoutError, writeCapped } from "./outputs.js";

/** One event, as the live stream or the history list returns it. */
export type SessionEvent = BetaManagedAgentsStreamSessionEvents | BetaManagedAgentsSessionEvent;

export interface OutputFile {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: number;
}

export interface EventStream {
  readonly events: AsyncIterable<SessionEvent>;
  close(): void;
}

/** The parts of each resource the launcher reads. */
export type EnvironmentRef = Pick<BetaEnvironment, "id" | "archived_at" | "config">;

/** One entry of an agent's tools, as far as the launcher checks it: a toolset's switches, or what an MCP toolset or custom tool is. */
export interface AgentTool {
  readonly type: string;
  readonly name?: string;
  readonly mcp_server_name?: string;
  readonly default_config?: { readonly enabled: boolean };
  readonly configs?: readonly { readonly name: string; readonly enabled: boolean }[];
}

/**
 * An agent's model, as agents.retrieve returns it in SDK 0.131
 * (BetaManagedAgentsModelConfig): the id, the effort as `{ type }` (always
 * present, the per-model default when none was set; a bare level is read too),
 * and the speed (`fast` is priced higher; absent means standard).
 */
export interface AgentModel {
  readonly id: string;
  readonly effort?: { readonly type: string } | string | null | undefined;
  readonly speed?: string | null | undefined;
}

/** An agent version, as far as the launcher checks its boundary (BetaManagedAgentsAgent fits it). */
export interface AgentRef {
  readonly id: string;
  readonly version: number;
  readonly model: AgentModel;
  readonly system: string | null;
  readonly tools: readonly AgentTool[];
  readonly mcp_servers: readonly { readonly name: string }[];
  /** Non-null when the agent may start other agents, with their own tools. */
  readonly multiagent: object | null;
  readonly skills: readonly { readonly skill_id: string }[];
  readonly metadata: Readonly<Record<string, string>>;
}
export type SessionRef = Pick<BetaManagedAgentsSession, "id" | "status">;
export type SessionTotals = Pick<BetaManagedAgentsSession, "id" | "status" | "usage">;
export type SessionListing = Pick<BetaManagedAgentsSession, "id" | "status" | "metadata">;

/**
 * Creating a session is never retried by the SDK (a retried create can start a
 * second session nobody follows), and the whole create, response body
 * included, gives up after a minute; the launcher looks the session up by its
 * metadata instead when the outcome is unclear.
 */
export const CREATE_SESSION_TIMEOUT_MS = 60_000;

/** One output's whole download, body included, before it is abandoned. */
export const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * Runs `request` with an abort signal and fails it with `timedOut()` once `ms`
 * pass, response body included: the SDK's own timeout stops once the headers
 * arrive. The abort also ends a body still being read.
 */
async function withDeadline<T>(ms: number, request: (signal: AbortSignal) => Promise<T>, timedOut: () => Error): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timedOut());
    }, ms);
  });
  const pending = request(controller.signal);
  // Once the deadline has answered, the request's own late failure is not reported.
  pending.catch(() => undefined);
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a failed create may still have made a session. Only an answer in
 * which the server refused (a 4xx other than 408: a 429, a credit or a
 * validation error) says nothing was created. Anything else may have reached
 * the server: a broken or timed-out connection, a 408 or 5xx, or a 2xx whose
 * body broke, stalled or held no session.
 */
export function isAmbiguousFailure(error: unknown): boolean {
  const refused = error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 408;
  return !refused;
}

/**
 * The Managed Agents calls the launcher makes, behind one seam so the session
 * loop can be tested without the network. sdkSandboxApi is the only
 * implementation that talks to Anthropic.
 */
export interface SandboxApi {
  createEnvironment(params: EnvironmentCreateParams): Promise<EnvironmentRef>;
  retrieveEnvironment(id: string): Promise<EnvironmentRef>;
  updateEnvironment(id: string, params: EnvironmentUpdateParams): Promise<EnvironmentRef>;
  createAgent(params: AgentCreateParams): Promise<AgentRef>;
  /** The given version (the one sessions are pinned to), or the latest when none is given. */
  retrieveAgent(id: string, version?: number): Promise<AgentRef>;
  updateAgent(id: string, params: AgentUpdateParams): Promise<AgentRef>;
  uploadFile(name: string, data: string): Promise<string>;
  /** One attempt, no retries: see CREATE_SESSION_TIMEOUT_MS. */
  createSession(params: SessionCreateParams): Promise<SessionRef>;
  retrieveSession(id: string): Promise<SessionTotals>;
  /** Every session created at or after `createdSince` (an ISO time), archived ones included, across all pages. */
  listSessions(createdSince: string): AsyncIterable<SessionListing>;
  /** Archives a session the launcher could not stop, so it cannot be resumed. */
  archiveSession(id: string): Promise<void>;
  openStream(sessionId: string): Promise<EventStream>;
  listEvents(sessionId: string): AsyncIterable<SessionEvent>;
  sendEvents(sessionId: string, events: BetaManagedAgentsEventParams[]): Promise<void>;
  listOutputFiles(sessionId: string): Promise<OutputFile[]>;
  /**
   * Streams one output to `destination`, cut off past `maxBytes` (an
   * OutputTooLargeError) or DOWNLOAD_TIMEOUT_MS (an OutputTimeoutError), the
   * partial file removed before either is thrown. "not-downloadable" for a
   * file the API will not serve, such as an input mounted into the session.
   */
  downloadFile(fileId: string, destination: string, maxBytes: number): Promise<"saved" | "not-downloadable">;
}

/**
 * The session's file list also holds its own copies of the uploaded inputs,
 * which the API refuses with `file_not_downloadable` (seen on the A4 trial).
 */
function isNotDownloadable(error: unknown): boolean {
  if (!(error instanceof Anthropic.BadRequestError)) return false;
  const body: unknown = error.error;
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const inner: unknown = body.error;
  if (typeof inner !== "object" || inner === null || !("details" in inner)) return false;
  const details: unknown = inner.details;
  return typeof details === "object" && details !== null && "error_code" in details && details.error_code === "file_not_downloadable";
}

/** The only host the key is ever sent to. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com";

/**
 * Environment variables through which the SDK would send the key, or another
 * credential, somewhere else or with extra headers. The client sets its host
 * and its auth itself, so ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN would be
 * ignored; the SDK always adds ANTHROPIC_CUSTOM_HEADERS, which keyOnlyToAnthropic
 * then drops or refuses. Any of them set to something else refuses the start,
 * so nobody believes they took effect (ANTHROPIC_BASE_URL may be the official
 * host, which a Claude Code shell exports). A variable is named, never its value.
 */
export function anthropicEnvironmentProblems(env: NodeJS.ProcessEnv): string[] {
  const value = (name: string): string => env[name]?.trim() ?? "";
  const problems: string[] = [];
  const baseUrl = value("ANTHROPIC_BASE_URL");
  if (baseUrl !== "" && baseUrl.replace(/\/+$/u, "") !== ANTHROPIC_API_URL) problems.push(`ANTHROPIC_BASE_URL is set to a host other than ${ANTHROPIC_API_URL}`);
  if (value("ANTHROPIC_AUTH_TOKEN") !== "") problems.push("ANTHROPIC_AUTH_TOKEN is set");
  if (value("ANTHROPIC_CUSTOM_HEADERS") !== "") problems.push("ANTHROPIC_CUSTOM_HEADERS is set");
  return problems;
}

type Fetch = NonNullable<ClientOptions["fetch"]>;

const MAX_REDIRECTS = 5;

/**
 * Every header SDK 0.131 builds for the launcher's requests besides the key,
 * read from its request builder (client.ts buildHeaders, the platform headers,
 * each resource's anthropic-beta and accept, the stainless helper headers): the
 * only ones forwarded. It has no idempotency header; the retry count is
 * x-stainless-retry-count. A header with any other name, from
 * ANTHROPIC_CUSTOM_HEADERS for one, is dropped. Names only: a forwarded header
 * keeps the value the client built.
 */
const FORWARDED_HEADERS: ReadonlySet<string> = new Set([
  "accept",
  "anthropic-beta",
  "anthropic-version",
  "content-type",
  "user-agent",
  "x-stainless-arch",
  "x-stainless-helper",
  "x-stainless-helper-method",
  "x-stainless-lang",
  "x-stainless-os",
  "x-stainless-package-version",
  "x-stainless-retry-count",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-timeout",
]);

/** Headers that carry an identity of their own: any of them refuses the request rather than being dropped quietly. */
const IDENTITY_HEADERS: ReadonlySet<string> = new Set(["authorization", "proxy-authorization", "cookie"]);

/** The Files API's content endpoint: the one answer that may come from another host (storage, say). */
const FILE_CONTENT_PATH = /^\/v1\/files\/[^/]+\/content$/u;

/**
 * A request the key guard will not send or follow. Retrying cannot change the
 * answer, so the client passes it to the caller as it is (refusalsAreFinal).
 * Its message holds nothing a server sent (no Location, host or path): the
 * SDK retries any error whose text says "timed out", "time out" or "timeout".
 */
class KeyGuardRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyGuardRefusal";
  }
}

/**
 * Refuses a key that is not one line of the workspace-key shape (isWorkspaceKey,
 * the rule readKey holds a key file to) before it reaches a client or a header:
 * fetch's own error for a header value it cannot send quotes the value whole.
 * The reason names no part of the key.
 */
function refuseMalformedKey(apiKey: string): void {
  if (!isWorkspaceKey(apiKey)) {
    throw new Error("refusing the key: it is not one line in the shape of a workspace API key, so it is neither sent nor shown (read it from its key file with readKey)");
  }
}

function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/**
 * The headers to send: only FORWARDED_HEADERS, and X-Api-Key, which must be
 * `apiKey`. An identity header, or any other key, refuses the request.
 */
function forwardedHeaders(apiKey: string, built: Headers): Headers {
  const forwarded = new Headers();
  for (const [name, value] of built) {
    if (IDENTITY_HEADERS.has(name)) throw new KeyGuardRefusal(`refusing a request that carries a ${name} header: the launcher sends its own key and no other credential`);
    if (FORWARDED_HEADERS.has(name)) forwarded.set(name, value);
  }
  if (built.get("x-api-key") !== apiKey) throw new KeyGuardRefusal("refusing a request whose X-Api-Key is not the launcher's key");
  forwarded.set("x-api-key", apiKey);
  return forwarded;
}

/**
 * Wraps `next` so a request goes only to ANTHROPIC_API_URL, with only headers
 * whose names the SDK builds (FORWARDED_HEADERS) and `apiKey` as X-Api-Key; an
 * Authorization, a cookie or another key refuses it. Redirects are followed
 * here rather than by fetch (which forwards X-Api-Key to another host). A
 * redirect within ANTHROPIC_API_URL keeps the headers. One to another host is
 * followed only when the request's first URL is a GET or HEAD of a file's
 * content (FILE_CONTENT_PATH: a download handed to storage), with the key
 * removed for the rest of the chain; every JSON endpoint refuses it, so no
 * status, cost or event comes from another host. Any other method is followed
 * only through a same-origin 307 or 308 (which keep the method and body); a
 * 301, 302 or 303 of it, or a redirect off the origin, is refused. A target
 * that is not https, or a Location that cannot be read, is never followed. At
 * most five redirects. Every refusal is a KeyGuardRefusal. A key that is not
 * of the workspace shape is refused before the guard is made.
 */
export function keyOnlyToAnthropic(apiKey: string, next: Fetch = globalThis.fetch): Fetch {
  refuseMalformedKey(apiKey);
  return async (input, init) => {
    let url = new URL(urlOf(input));
    if (url.origin !== ANTHROPIC_API_URL) throw new KeyGuardRefusal(`refusing a request to ${url.origin}: the key goes only to ${ANTHROPIC_API_URL}`);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = forwardedHeaders(apiKey, new Headers(init?.headers));
    const download = (method === "GET" || method === "HEAD") && FILE_CONTENT_PATH.test(url.pathname);
    for (let hops = 0; ; hops += 1) {
      const response = await next(url.href, { ...init, method, headers, redirect: "manual" });
      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || location === null) return response;
      await response.body?.cancel();
      if (hops === MAX_REDIRECTS) throw new KeyGuardRefusal(`more than ${String(MAX_REDIRECTS)} redirects from ${ANTHROPIC_API_URL}`);
      // A Location that cannot be parsed is refused here: a TypeError from fetch would be retried as a connection failure.
      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        throw new KeyGuardRefusal("refusing to follow a redirect whose Location cannot be read");
      }
      if (target.protocol !== "https:") throw new KeyGuardRefusal("refusing to follow a redirect to a scheme other than https: only https is followed");
      if (method !== "GET" && method !== "HEAD") {
        // Only a 307 or 308 keeps the method and the body by definition; a 301, 302 or 303 would re-send as GET (or re-POST), so none is followed.
        if (response.status !== 307 && response.status !== 308) throw new KeyGuardRefusal(`refusing to follow a ${String(response.status)} redirect of a ${method} request`);
        if (target.origin !== url.origin) throw new KeyGuardRefusal(`refusing to follow a ${method} redirect to another host`);
      } else if (target.origin !== url.origin || target.origin !== ANTHROPIC_API_URL) {
        if (!download) throw new KeyGuardRefusal(`refusing to follow a ${method} redirect to another host: only a file download may leave ${ANTHROPIC_API_URL}`);
        headers.delete("x-api-key");
      }
      url = target;
    }
  };
}

/**
 * SDK 0.131 retries an error thrown by its fetch as a connection failure (twice
 * more by default) and then wraps it as "Connection error."; an error thrown by
 * middleware reaches the caller as it is, unless it, or an error in its cause
 * chain, came from fetch or is an abort, an APIConnectionError or a
 * RetryableError (client.ts makeRequest, core/middleware.ts isRetryableError).
 * So a KeyGuardRefusal is thrown again from here as a new error with no cause:
 * it is never re-sent, and the caller sees its reason. Real connection failures
 * keep the SDK's retries.
 */
const refusalsAreFinal: Middleware = async (request, next) => {
  try {
    return await next(request);
  } catch (error) {
    if (error instanceof KeyGuardRefusal) throw new KeyGuardRefusal(error.message);
    throw error;
  }
};

/**
 * The key is passed in from the key file and handed straight to the client;
 * it never enters process.env, a log or an error message. One that is not a
 * single line of the workspace-key shape is refused first, before any client
 * is built, with a reason that names no part of it. It goes only to
 * ANTHROPIC_API_URL, as the X-Api-Key header and no other credential, through
 * keyOnlyToAnthropic. That guard allow-lists header names and the key's value,
 * and refuses an identity header; every other value is the one the client
 * built. The client fixes its host and auth, but the SDK reads process.env
 * whatever `env` says, and ANTHROPIC_CUSTOM_HEADERS can override the value of
 * an allowed name (anthropic-version, anthropic-beta or user-agent). The start
 * check below refuses that variable whenever it is set in `env`, which is
 * process.env except in tests: `env` and `fetchImpl` are test seams.
 */
export function sdkSandboxApi(apiKey: string, fetchImpl?: Fetch, env: NodeJS.ProcessEnv = process.env): SandboxApi {
  refuseMalformedKey(apiKey);
  const problems = anthropicEnvironmentProblems(env);
  if (problems.length > 0) {
    throw new Error(`refusing to start: ${problems.join("; ")}. Unset ${problems.length === 1 ? "it" : "them"} in this shell; the launcher talks only to ${ANTHROPIC_API_URL}.`);
  }
  const client = new Anthropic({ apiKey, authToken: null, baseURL: ANTHROPIC_API_URL, fetch: keyOnlyToAnthropic(apiKey, fetchImpl), middleware: [refusalsAreFinal] });
  return {
    createEnvironment: (params) => client.beta.environments.create(params),
    retrieveEnvironment: (id) => client.beta.environments.retrieve(id),
    updateEnvironment: (id, params) => client.beta.environments.update(id, params),
    createAgent: (params) => client.beta.agents.create(params),
    retrieveAgent: (id, version) => client.beta.agents.retrieve(id, version === undefined ? {} : { version }),
    updateAgent: (id, params) => client.beta.agents.update(id, params),
    async uploadFile(name, data) {
      const file = await client.files.upload({ file: await toFile(Buffer.from(data, "utf8"), name) });
      return file.id;
    },
    async createSession(params) {
      const session = await withDeadline(
        CREATE_SESSION_TIMEOUT_MS,
        (signal) => client.beta.sessions.create(params, { maxRetries: 0, timeout: CREATE_SESSION_TIMEOUT_MS, signal }),
        () => new Anthropic.APIConnectionTimeoutError({ message: `creating the session took over ${String(CREATE_SESSION_TIMEOUT_MS / 1000)} s, response included` }),
      );
      // A 2xx whose body is not a session (the SDK hands back a text body as a string).
      const raw: unknown = session;
      if (typeof raw !== "object" || raw === null || !("id" in raw) || typeof raw.id !== "string" || raw.id === "") {
        throw new Error("the create response held no session id");
      }
      return { id: session.id, status: session.status };
    },
    retrieveSession: (id) => client.beta.sessions.retrieve(id),
    async *listSessions(createdSince) {
      for await (const session of client.beta.sessions.list({ "created_at[gte]": createdSince, include_archived: true })) {
        yield { id: session.id, status: session.status, metadata: session.metadata };
      }
    },
    async archiveSession(id) {
      await client.beta.sessions.archive(id);
    },
    async openStream(sessionId) {
      const stream = await client.beta.sessions.events.stream(sessionId);
      return {
        events: stream,
        close: () => {
          stream.controller.abort();
        },
      };
    },
    listEvents: (sessionId) => client.beta.sessions.events.list(sessionId),
    async sendEvents(sessionId, events) {
      await client.beta.sessions.events.send(sessionId, { events });
    },
    async listOutputFiles(sessionId) {
      // Filtering by session needs the managed-agents beta, which the files
      // namespace does not add by itself.
      const files: OutputFile[] = [];
      for await (const file of client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] })) {
        files.push({ id: file.id, filename: file.filename, sizeBytes: file.size_bytes });
      }
      return files;
    },
    async downloadFile(fileId, destination, maxBytes) {
      // One deadline over the whole download. At the deadline the request is
      // aborted and the body's reader cancelled (chunksOf), and writeCapped
      // removes the partial file before the OutputTimeoutError reaches the caller.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort(new OutputTimeoutError(DOWNLOAD_TIMEOUT_MS));
      }, DOWNLOAD_TIMEOUT_MS);
      try {
        let response: Response;
        try {
          response = await untilAborted(client.files.download(fileId, {}, { signal: controller.signal }), controller.signal);
        } catch (error) {
          if (controller.signal.aborted) throw new OutputTimeoutError(DOWNLOAD_TIMEOUT_MS);
          if (isNotDownloadable(error)) return "not-downloadable";
          throw error;
        }
        // Streamed to disk a chunk at a time, never buffered whole.
        await writeCapped(response.body === null ? [] : chunksOf(response.body, controller.signal), destination, maxBytes);
        return "saved";
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** `pending`, or a rejection as soon as `signal` aborts, whichever comes first: a request that ignores the abort is not waited for. */
function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  // Once the abort has answered, the request's own late failure is not reported.
  pending.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new Error("aborted"));
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
