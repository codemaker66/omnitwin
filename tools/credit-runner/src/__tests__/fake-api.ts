import type { AgentCreateParams, AgentUpdateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { EnvironmentCreateParams, EnvironmentUpdateParams } from "@anthropic-ai/sdk/resources/beta/environments/environments";
import type { BetaManagedAgentsEventParams } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { SessionCreateParams } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import type {
  AgentRef,
  EnvironmentRef,
  EventStream,
  OutputFile,
  SandboxApi,
  SessionEvent,
  SessionListing,
  SessionRef,
  SessionTotals,
} from "../sandbox/api.js";
import { writeCapped } from "../sandbox/outputs.js";
import { agentParams, environmentParams } from "../sandbox/setup.js";

/** An environment as the API returns it, from the params it was created or updated with. */
function liveEnvironmentConfig(config: EnvironmentCreateParams["config"]): EnvironmentRef["config"] {
  if (config?.type !== "cloud") return { type: "self_hosted" };
  const net = config.networking;
  const packages = config.packages;
  return {
    type: "cloud",
    networking:
      net?.type === "limited"
        ? { type: "limited", allow_mcp_servers: net.allow_mcp_servers ?? false, allow_package_managers: net.allow_package_managers ?? false, allowed_hosts: [...(net.allowed_hosts ?? [])] }
        : { type: "unrestricted" },
    packages: {
      apt: [...(packages?.apt ?? [])],
      cargo: [...(packages?.cargo ?? [])],
      gem: [...(packages?.gem ?? [])],
      go: [...(packages?.go ?? [])],
      npm: [...(packages?.npm ?? [])],
      pip: [...(packages?.pip ?? [])],
    },
  };
}

/** An agent version as the API returns it, from the params it was created or updated with. */
function liveAgent(version: number, params: Pick<AgentUpdateParams, "tools" | "mcp_servers" | "multiagent">, previous?: AgentRef): AgentRef {
  return {
    id: "agent_1",
    version,
    tools:
      params.tools === undefined
        ? (previous?.tools ?? [])
        : (params.tools ?? []).map((tool) =>
            tool.type === "agent_toolset_20260401"
              ? {
                  type: tool.type,
                  default_config: { enabled: tool.default_config?.enabled ?? true },
                  configs: (tool.configs ?? []).map((config) => ({ name: config.name, enabled: config.enabled ?? true })),
                }
              : tool.type === "mcp_toolset"
                ? { type: tool.type, mcp_server_name: tool.mcp_server_name }
                : { type: tool.type, name: tool.name },
          ),
    mcp_servers: params.mcp_servers === undefined ? (previous?.mcp_servers ?? []) : (params.mcp_servers ?? []).map((server) => ({ name: server.name })),
    multiagent: params.multiagent === undefined ? (previous?.multiagent ?? null) : params.multiagent,
  };
}

export const HEAD = "a".repeat(40);

export interface Connection {
  readonly history: readonly SessionEvent[];
  readonly stream: readonly SessionEvent[];
  readonly dropAfter?: number;
  /** After its events, the stream stays open until the launcher closes it: a session that goes quiet. */
  readonly hang?: boolean;
}

/** null: listed but refused, as the API refuses the session's copies of its inputs. */
export const DEFAULT_FILES: Record<string, string | null> = {
  "verify.mjs": null,
  // As the Files API names it: the bare file name, without the patches/ folder.
  "0001-Match-robots.patch": `From ${HEAD} Mon Sep 17 00:00:00 2001\nSubject: fix\n`,
  "diff.patch": "diff --git a/x b/x\n+fixed\n",
  "report.md": "## Summary\nFixed.\n",
};

/** What a send attempt does: arrive, fail before arriving, or arrive and still report a failure. */
export type SendOutcome = "ok" | "fail" | "fail-after-delivery";

export class FakeApi implements SandboxApi {
  readonly sessions: SessionCreateParams[] = [];
  /** Events that reached the session. */
  readonly sent: BetaManagedAgentsEventParams[] = [];
  /** Every send, including the ones that failed. */
  readonly sendAttempts: BetaManagedAgentsEventParams[] = [];
  readonly uploads: { name: string; data: string }[] = [];
  readonly archived: string[] = [];
  agentUpdates = 0;
  agentCreates = 0;
  environmentCreates = 0;
  /** The params each create and update was sent. */
  readonly environmentParams: EnvironmentCreateParams[] = [];
  readonly environmentUpdates: EnvironmentUpdateParams[] = [];
  readonly agentParams: AgentCreateParams[] = [];
  readonly agentUpdateParams: AgentUpdateParams[] = [];
  /** Someone changed the environment, or the agent the launcher runs, in the Console. */
  liveEnvironmentOverride: EnvironmentRef["config"] | null = null;
  liveAgentOverride: Partial<Omit<AgentRef, "id" | "version">> | null = null;
  /** Until a test creates or changes them, the environment and agent are as an earlier run of this code made them. */
  private environmentConfig: EnvironmentRef["config"] = liveEnvironmentConfig(environmentParams().config);
  private readonly agentVersions = new Map<number, AgentRef>();
  failOutputs = false;
  /** Thrown by createSession; with `createdAnyway` the session exists all the same, as after a reset connection. */
  createError: Error | null = null;
  createdAnyway = false;
  /** listSessions fails this many times before it answers. */
  listFailures = 0;
  listCalls = 0;
  /** Sessions already in the list before this run's create, such as an earlier run of the same task. */
  earlierSessions: SessionListing[] = [];
  /** Sizes the Files API lists, by output name, where they differ from the text's own. */
  listedSizes: Record<string, number> = {};
  /** The outputs downloadFile was asked for, by name. */
  readonly downloads: string[] = [];
  /** Streams opened: one per connection. */
  opened = 0;
  failArchive = false;
  /** The status each retrieveSession call reports, in turn; the last repeats. */
  statuses: string[] = ["idle"];
  /** The platform's list cost in cents; null when the platform does not report one. */
  listCostCents: string | null = "287";
  /** retrieveSession fails this many times before it answers. */
  retrieveFailures = 0;
  sendOutcome: (event: BetaManagedAgentsEventParams, attempt: number) => SendOutcome = () => "ok";
  private readonly created: SessionListing[] = [];
  private connection = 0;
  private listed = 0;
  private retrieved = 0;

  constructor(
    private readonly connections: readonly Connection[],
    private readonly files: Record<string, string | null> = DEFAULT_FILES,
  ) {}

  createEnvironment = (params: EnvironmentCreateParams): Promise<EnvironmentRef> => {
    this.environmentCreates += 1;
    this.environmentParams.push(params);
    this.environmentConfig = liveEnvironmentConfig(params.config);
    return Promise.resolve(this.liveEnvironment());
  };
  retrieveEnvironment = (): Promise<EnvironmentRef> => Promise.resolve(this.liveEnvironment());
  updateEnvironment = (_id: string, params: EnvironmentUpdateParams): Promise<EnvironmentRef> => {
    this.environmentUpdates.push(params);
    if (params.config !== undefined) this.environmentConfig = liveEnvironmentConfig(params.config);
    return Promise.resolve(this.liveEnvironment());
  };
  createAgent = (params: AgentCreateParams): Promise<AgentRef> => {
    this.agentCreates += 1;
    this.agentParams.push(params);
    this.agentVersions.set(1, liveAgent(1, params));
    return Promise.resolve(this.agentAt(1));
  };
  /** The given version, or the latest; as the Console shows it, where a test has someone change it there. */
  retrieveAgent = (_id: string, version?: number): Promise<AgentRef> => Promise.resolve(this.agentAt(version ?? this.agentVersions.size));
  updateAgent = (_id: string, params: AgentUpdateParams): Promise<AgentRef> => {
    this.agentUpdates += 1;
    this.agentUpdateParams.push(params);
    const version = this.agentVersions.size + 1;
    this.agentVersions.set(version, liveAgent(version, params, this.agentVersions.get(version - 1)));
    return Promise.resolve(this.agentAt(version));
  };
  private liveEnvironment(): EnvironmentRef {
    return { id: "env_1", archived_at: null, config: this.liveEnvironmentOverride ?? this.environmentConfig };
  }
  private agentAt(version: number): AgentRef {
    const agent = this.agentVersions.get(version) ?? liveAgent(version, agentParams("an earlier run's prompt"));
    return this.liveAgentOverride === null ? agent : { ...agent, ...this.liveAgentOverride };
  }
  uploadFile = (name: string, data: string) => {
    this.uploads.push({ name, data });
    return Promise.resolve(`file_${String(this.uploads.length)}`);
  };
  createSession = (params: SessionCreateParams): Promise<SessionRef> => {
    this.sessions.push(params);
    if (this.createError === null || this.createdAnyway) this.created.push({ id: "sesn_1", status: "running", metadata: { ...params.metadata } });
    return this.createError === null ? Promise.resolve({ id: "sesn_1", status: "running" }) : Promise.reject(this.createError);
  };
  retrieveSession = (): Promise<SessionTotals> => {
    if (this.retrieveFailures > 0) {
      this.retrieveFailures -= 1;
      return Promise.reject(new Error("status unavailable"));
    }
    const status = this.statuses[Math.min(this.retrieved, this.statuses.length - 1)] ?? "idle";
    this.retrieved += 1;
    return Promise.resolve({
      id: "sesn_1",
      status: status as SessionTotals["status"],
      usage: {
        ...(this.listCostCents === null ? {} : { list_cost: { amount: this.listCostCents, currency: "USD" } }),
        active_seconds: 600,
        input_tokens: 110,
        output_tokens: 55,
        cache_read_input_tokens: 3000,
        cache_creation: { ephemeral_5m_input_tokens: 200 },
      },
    });
  };
  listSessions = (): AsyncIterable<SessionListing> => {
    this.listCalls += 1;
    const fail = this.listFailures > 0;
    if (fail) this.listFailures -= 1;
    const sessions: SessionListing[] = [{ id: "sesn_other", status: "idle", metadata: { lane: "sandbox", job: "other" } }, ...this.earlierSessions, ...this.created];
    return (async function* () {
      await Promise.resolve();
      if (fail) throw new Error("connection reset");
      for (const session of sessions) yield session;
    })();
  };
  archiveSession = (id: string): Promise<void> => {
    if (this.failArchive) return Promise.reject(new Error("archive refused"));
    this.archived.push(id);
    return Promise.resolve();
  };
  openStream = (): Promise<EventStream> => {
    const connection = this.connections[Math.min(this.connection, this.connections.length - 1)];
    this.connection += 1;
    this.opened += 1;
    const events = connection?.stream ?? [];
    const dropAfter = connection?.dropAfter;
    const hang = connection?.hang === true;
    let release: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      release = resolve;
    });
    return Promise.resolve({
      events: (async function* () {
        for (const [index, event] of events.entries()) {
          if (dropAfter !== undefined && index === dropAfter) throw new Error("socket hang up");
          await Promise.resolve();
          yield event;
        }
        if (hang) await closed;
      })(),
      close: () => {
        release();
      },
    });
  };
  listEvents = (): AsyncIterable<SessionEvent> => {
    const history = this.connections[Math.min(this.listed, this.connections.length - 1)]?.history ?? [];
    this.listed += 1;
    return (async function* () {
      for (const event of history) {
        await Promise.resolve();
        yield event;
      }
    })();
  };
  sendEvents = (_id: string, events: BetaManagedAgentsEventParams[]) => {
    this.sendAttempts.push(...events);
    const first = events[0];
    const outcome = first === undefined ? "ok" : this.sendOutcome(first, this.sendAttempts.length);
    if (outcome !== "fail") this.sent.push(...events);
    return outcome === "ok" ? Promise.resolve() : Promise.reject(new Error("429 Too Many Requests"));
  };
  listOutputFiles = (): Promise<OutputFile[]> => {
    if (this.failOutputs) return Promise.reject(new Error("files API down"));
    return Promise.resolve(
      Object.entries(this.files).map(([filename, text], index) => ({
        id: `out_${String(index)}`,
        filename,
        sizeBytes: this.listedSizes[filename] ?? Buffer.byteLength(text ?? "", "utf8"),
      })),
    );
  };
  downloadFile = async (id: string, destination: string, maxBytes: number): Promise<"saved" | "not-downloadable"> => {
    const filename = Object.keys(this.files)[Number(id.slice("out_".length))] ?? "";
    this.downloads.push(filename);
    const text = this.files[filename];
    if (text === null || text === undefined) return "not-downloadable";
    await writeCapped([Buffer.from(text, "utf8")], destination, maxBytes);
    return "saved";
  };
}
