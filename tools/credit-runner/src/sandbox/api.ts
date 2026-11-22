import Anthropic, { toFile, type ClientOptions } from "@anthropic-ai/sdk";
import type { AgentCreateParams, AgentUpdateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { BetaEnvironment, EnvironmentCreateParams, EnvironmentUpdateParams } from "@anthropic-ai/sdk/resources/beta/environments/environments";
import type {
  BetaManagedAgentsEventParams,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { BetaManagedAgentsSession, SessionCreateParams } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
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

/** An agent version, as far as the launcher checks its boundary (BetaManagedAgentsAgent fits it). */
export interface AgentRef {
  readonly id: string;
  readonly version: number;
  readonly tools: readonly AgentTool[];
  readonly mcp_servers: readonly { readonly name: string }[];
  /** Non-null when the agent may start other agents, with their own tools. */
  readonly multiagent: object | null;
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
   * OutputTooLargeError, the partial file removed). "not-downloadable" for a
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
 * ignored; the SDK always adds ANTHROPIC_CUSTOM_HEADERS. Any of them set to
 * something else refuses the start, so nobody believes they took effect
 * (ANTHROPIC_BASE_URL may be the official host, which a Claude Code shell
 * exports). A variable is named, never its value.
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

/**
 * The key is passed in from the key file and handed straight to the client;
 * it never enters process.env, a log or an error message. It goes only to
 * ANTHROPIC_API_URL, as the X-Api-Key header and no other credential.
 * `env` is a test seam: the SDK itself reads process.env.
 */
export function sdkSandboxApi(apiKey: string, fetchImpl?: ClientOptions["fetch"], env: NodeJS.ProcessEnv = process.env): SandboxApi {
  const problems = anthropicEnvironmentProblems(env);
  if (problems.length > 0) {
    throw new Error(`refusing to start: ${problems.join("; ")}. Unset ${problems.length === 1 ? "it" : "them"} in this shell; the launcher talks only to ${ANTHROPIC_API_URL}.`);
  }
  const client = new Anthropic({ apiKey, authToken: null, baseURL: ANTHROPIC_API_URL, ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }) });
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
    downloadFile: (fileId, destination, maxBytes) =>
      withDeadline(
        DOWNLOAD_TIMEOUT_MS,
        async (signal): Promise<"saved" | "not-downloadable"> => {
          let response: Response;
          try {
            response = await client.files.download(fileId, {}, { signal });
          } catch (error) {
            if (isNotDownloadable(error)) return "not-downloadable";
            throw error;
          }
          // Streamed to disk a chunk at a time, never buffered whole.
          await writeCapped(response.body === null ? [] : chunksOf(response.body), destination, maxBytes);
          return "saved";
        },
        () => new OutputTimeoutError(DOWNLOAD_TIMEOUT_MS),
      ),
  };
}
