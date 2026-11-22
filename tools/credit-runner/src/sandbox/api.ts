import Anthropic, { toFile, type ClientOptions } from "@anthropic-ai/sdk";
import type { BetaManagedAgentsAgent, AgentCreateParams, AgentUpdateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { BetaEnvironment, EnvironmentCreateParams } from "@anthropic-ai/sdk/resources/beta/environments/environments";
import type {
  BetaManagedAgentsEventParams,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { BetaManagedAgentsSession, SessionCreateParams } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";

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
export type EnvironmentRef = Pick<BetaEnvironment, "id" | "archived_at">;
export type AgentRef = Pick<BetaManagedAgentsAgent, "id" | "version">;
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
  createAgent(params: AgentCreateParams): Promise<AgentRef>;
  retrieveAgent(id: string): Promise<AgentRef>;
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
  /** Null for a file the API will not serve, such as an input mounted into the session. */
  downloadFile(fileId: string): Promise<Buffer | null>;
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

/**
 * The key is passed in from the key file and handed straight to the client;
 * it never enters process.env, a log or an error message.
 */
export function sdkSandboxApi(apiKey: string, baseURL?: string, fetchImpl?: ClientOptions["fetch"]): SandboxApi {
  const client = new Anthropic({ apiKey, ...(baseURL === undefined ? {} : { baseURL }), ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }) });
  return {
    createEnvironment: (params) => client.beta.environments.create(params),
    retrieveEnvironment: (id) => client.beta.environments.retrieve(id),
    createAgent: (params) => client.beta.agents.create(params),
    retrieveAgent: (id) => client.beta.agents.retrieve(id),
    updateAgent: (id, params) => client.beta.agents.update(id, params),
    async uploadFile(name, data) {
      const file = await client.files.upload({ file: await toFile(Buffer.from(data, "utf8"), name) });
      return file.id;
    },
    async createSession(params) {
      // The SDK's own timeout stops once the headers arrive; the body is read
      // after. One deadline covers both, and its abort also ends a body read.
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Anthropic.APIConnectionTimeoutError({ message: `creating the session took over ${String(CREATE_SESSION_TIMEOUT_MS / 1000)} s, response included` }));
        }, CREATE_SESSION_TIMEOUT_MS);
      });
      const request = client.beta.sessions.create(params, { maxRetries: 0, timeout: CREATE_SESSION_TIMEOUT_MS, signal: controller.signal });
      // Once the deadline has answered, the request's own late failure is not reported.
      request.catch(() => undefined);
      try {
        const session = await Promise.race([request, deadline]);
        // A 2xx whose body is not a session (the SDK hands back a text body as a string).
        const raw: unknown = session;
        if (typeof raw !== "object" || raw === null || !("id" in raw) || typeof raw.id !== "string" || raw.id === "") {
          throw new Error("the create response held no session id");
        }
        return { id: session.id, status: session.status };
      } finally {
        clearTimeout(timer);
      }
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
    async downloadFile(fileId) {
      try {
        const response = await client.files.download(fileId);
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (isNotDownloadable(error)) return null;
        throw error;
      }
    },
  };
}
