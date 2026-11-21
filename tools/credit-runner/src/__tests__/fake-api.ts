import type { BetaManagedAgentsEventParams } from "@anthropic-ai/sdk/resources/beta/sessions/events";
import type { SessionCreateParams } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import type { AgentRef, EnvironmentRef, EventStream, OutputFile, SandboxApi, SessionEvent, SessionRef, SessionTotals } from "../sandbox/api.js";

export const HEAD = "a".repeat(40);

export interface Connection {
  readonly history: readonly SessionEvent[];
  readonly stream: readonly SessionEvent[];
  readonly dropAfter?: number;
}

/** null: listed but refused, as the API refuses the session's copies of its inputs. */
export const DEFAULT_FILES: Record<string, string | null> = {
  "verify.mjs": null,
  // As the Files API names it: the bare file name, without the patches/ folder.
  "0001-Match-robots.patch": `From ${HEAD} Mon Sep 17 00:00:00 2001\nSubject: fix\n`,
  "diff.patch": "diff --git a/x b/x\n+fixed\n",
  "report.md": "## Summary\nFixed.\n",
};

export class FakeApi implements SandboxApi {
  readonly sessions: SessionCreateParams[] = [];
  readonly sent: BetaManagedAgentsEventParams[] = [];
  readonly uploads: { name: string; data: string }[] = [];
  agentUpdates = 0;
  agentCreates = 0;
  environmentCreates = 0;
  failOutputs = false;
  private connection = 0;
  private listed = 0;

  constructor(
    private readonly connections: readonly Connection[],
    private readonly files: Record<string, string | null> = DEFAULT_FILES,
  ) {}

  createEnvironment = (): Promise<EnvironmentRef> => {
    this.environmentCreates += 1;
    return Promise.resolve({ id: "env_1", archived_at: null });
  };
  retrieveEnvironment = (): Promise<EnvironmentRef> => Promise.resolve({ id: "env_1", archived_at: null });
  createAgent = (): Promise<AgentRef> => {
    this.agentCreates += 1;
    return Promise.resolve({ id: "agent_1", version: 1 });
  };
  retrieveAgent = (): Promise<AgentRef> => Promise.resolve({ id: "agent_1", version: 1 + this.agentUpdates });
  updateAgent = (): Promise<AgentRef> => {
    this.agentUpdates += 1;
    return Promise.resolve({ id: "agent_1", version: 1 + this.agentUpdates });
  };
  uploadFile = (name: string, data: string) => {
    this.uploads.push({ name, data });
    return Promise.resolve(`file_${String(this.uploads.length)}`);
  };
  createSession = (params: SessionCreateParams): Promise<SessionRef> => {
    this.sessions.push(params);
    return Promise.resolve({ id: "sesn_1", status: "running" });
  };
  retrieveSession = (): Promise<SessionTotals> =>
    Promise.resolve({
      id: "sesn_1",
      status: "idle",
      usage: {
        list_cost: { amount: "287", currency: "USD" },
        active_seconds: 600,
        input_tokens: 110,
        output_tokens: 55,
        cache_read_input_tokens: 3000,
        cache_creation: { ephemeral_5m_input_tokens: 200 },
      },
    });
  openStream = (): Promise<EventStream> => {
    const connection = this.connections[Math.min(this.connection, this.connections.length - 1)];
    this.connection += 1;
    const events = connection?.stream ?? [];
    const dropAfter = connection?.dropAfter;
    return Promise.resolve({
      events: (async function* () {
        for (const [index, event] of events.entries()) {
          if (dropAfter !== undefined && index === dropAfter) throw new Error("socket hang up");
          await Promise.resolve();
          yield event;
        }
      })(),
      close: () => undefined,
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
    this.sent.push(...events);
    return Promise.resolve();
  };
  listOutputFiles = (): Promise<OutputFile[]> => {
    if (this.failOutputs) return Promise.reject(new Error("files API down"));
    return Promise.resolve(Object.entries(this.files).map(([filename, text], index) => ({ id: `out_${String(index)}`, filename, sizeBytes: text?.length ?? 0 })));
  };
  downloadFile = (id: string): Promise<Buffer | null> => {
    const text = Object.values(this.files)[Number(id.slice("out_".length))];
    return Promise.resolve(text === null || text === undefined ? null : Buffer.from(text, "utf8"));
  };
}
