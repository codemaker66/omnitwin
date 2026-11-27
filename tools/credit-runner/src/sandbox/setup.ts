import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentCreateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { BetaLimitedNetwork, EnvironmentCreateParams } from "@anthropic-ai/sdk/resources/beta/environments/environments";
import { z } from "zod";
import { AGENT_EFFORT, AGENT_MODEL } from "../task.js";
import type { AgentModel, AgentRef, EnvironmentRef, SandboxApi } from "./api.js";
import { promptSha } from "./brief.js";

export const ENVIRONMENT_NAME = "venviewer-night-sandbox";
export const AGENT_NAME = "venviewer-night-fixer";

/**
 * Deny-by-default egress. Package registries are open for pnpm, github.com
 * for fetching the public repo, nodejs.org in case the image's Node is older
 * than the repo's 22.18 floor. No MCP server is reachable.
 */
const NETWORKING: BetaLimitedNetwork = {
  type: "limited",
  allow_package_managers: true,
  allow_mcp_servers: false,
  allowed_hosts: ["github.com", "nodejs.org"],
};

const TOOLSET = "agent_toolset_20260401";
const WEB_TOOLS = ["web_fetch", "web_search"] as const;
/** The toolset's tools the agent may have on: bash and the file tools. */
const TOOLSET_TOOLS: ReadonlySet<string> = new Set(["bash", "edit", "read", "write", "glob", "grep"]);

/**
 * The container: Anthropic's cloud, with NETWORKING. Postgres comes from
 * Ubuntu's packages so the database suites can run.
 */
export function environmentParams(): EnvironmentCreateParams {
  return {
    name: ENVIRONMENT_NAME,
    description: "Venviewer night runs: public repo only, no credentials, limited egress.",
    config: {
      type: "cloud",
      networking: { ...NETWORKING, allowed_hosts: [...NETWORKING.allowed_hosts] },
      packages: { apt: ["postgresql"], npm: ["pnpm@9.15.4"] },
    },
    metadata: { lane: "sandbox" },
  };
}

/**
 * Bash and file tools only. The web tools are off, and there is no MCP server
 * and no skill. Calls run without asking (`always_allow`): the container holds
 * no secret and reaches no service that accepts writes, so a pause for approval
 * would only stall an unattended run.
 */
export function agentParams(system: string): AgentCreateParams {
  return {
    name: AGENT_NAME,
    description: "Fixes one checked Venviewer defect per session and returns a patch for review.",
    model: { id: AGENT_MODEL, effort: AGENT_EFFORT },
    system,
    tools: [
      {
        type: TOOLSET,
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
        configs: WEB_TOOLS.map((name) => ({ name, enabled: false })),
      },
    ],
    mcp_servers: [],
    skills: [],
    metadata: { promptSha: promptSha(system) },
  };
}

/** A host as DNS compares it: letter case and a trailing dot make no difference. */
function dnsName(host: string): string {
  return host.toLowerCase().replace(/\.$/u, "");
}

/**
 * How the live environment differs from what the code sets up: anything but a
 * cloud container with exactly NETWORKING (its host list, compared as DNS
 * names, and its MCP and registry switches). Empty when it matches.
 */
export function environmentDifferences(environment: EnvironmentRef): string[] {
  const { config } = environment;
  if (config.type !== "cloud") return [`it is ${config.type}, not a cloud container`];
  const { networking } = config;
  if (networking.type !== "limited") return [`its networking is ${networking.type}, not limited`];
  const differences: string[] = [];
  const wanted = new Set(NETWORKING.allowed_hosts.map(dnsName));
  const allowed = new Set(networking.allowed_hosts.map(dnsName));
  const extra = [...allowed].filter((host) => !wanted.has(host));
  const missing = [...wanted].filter((host) => !allowed.has(host));
  if (extra.length > 0) differences.push(`it allows ${extra.join(", ")}, which the code does not`);
  if (missing.length > 0) differences.push(`it no longer allows ${missing.join(", ")}`);
  if (networking.allow_mcp_servers !== NETWORKING.allow_mcp_servers) {
    differences.push(networking.allow_mcp_servers ? "it allows MCP servers" : "it does not allow MCP servers");
  }
  if (networking.allow_package_managers !== NETWORKING.allow_package_managers) {
    differences.push(networking.allow_package_managers ? "it allows the package registries" : "it does not allow the package registries");
  }
  return differences;
}

/** The effort level of an agent's model, whichever form the API gives it in; null when it gives none. */
function effortOf(effort: AgentModel["effort"]): string | null {
  if (effort === undefined || effort === null) return null;
  return typeof effort === "string" ? effort : effort.type;
}

/**
 * How an agent version differs from what the code sets up (agentParams): its
 * model id, effort or speed; its system prompt (compared by promptSha, so the
 * message names hashes, not the text); and anything beyond one agent toolset
 * whose only enabled tools are bash and the file tools (TOOLSET_TOOLS), with
 * one config per tool name: an MCP toolset, a custom tool, a web tool or any
 * other tool switched on, an MCP server, other agents it may start, a skill. A
 * web tool whose switch is missing takes the toolset's default, and an unknown
 * default counts as on. Empty when it matches.
 */
export function agentDifferences(agent: AgentRef, system: string): string[] {
  const differences: string[] = [];
  if (agent.model.id !== AGENT_MODEL) differences.push(`it runs ${agent.model.id}, not ${AGENT_MODEL}`);
  const effort = effortOf(agent.model.effort);
  if (effort === null) differences.push(`its effort is not reported, so it cannot be held to ${AGENT_EFFORT}`);
  else if (effort !== AGENT_EFFORT) differences.push(`its effort is ${effort}, not ${AGENT_EFFORT}`);
  const speed = agent.model.speed ?? "standard";
  if (speed !== "standard") differences.push(`its speed is ${speed}, not standard`);
  if (agent.system !== system) {
    differences.push(`its system prompt (sha ${agent.system === null ? "none" : promptSha(agent.system)}) is not the one this code sets up (sha ${promptSha(system)})`);
  }
  for (const tool of agent.tools) {
    if (tool.type === "mcp_toolset") differences.push(`it has an MCP toolset (${tool.mcp_server_name ?? "unnamed"})`);
    else if (tool.type === "custom") differences.push(`it has a custom tool (${tool.name ?? "unnamed"})`);
    else if (tool.type !== TOOLSET) differences.push(`it has a tool of type ${tool.type}`);
  }
  const toolsets = agent.tools.filter((tool) => tool.type === TOOLSET);
  if (toolsets.length !== 1) differences.push(`it has ${String(toolsets.length)} agent toolsets, not one`);
  for (const toolset of toolsets) {
    const configs = toolset.configs ?? [];
    const named = new Map<string, number>();
    for (const config of configs) named.set(config.name, (named.get(config.name) ?? 0) + 1);
    // Two configs for one tool leave which one the platform applies unknown.
    for (const [name, count] of named) if (count > 1) differences.push(`it has ${String(count)} configs named ${name}`);
    const on = new Set(configs.filter((config) => config.enabled && !TOOLSET_TOOLS.has(config.name)).map((config) => config.name));
    for (const name of WEB_TOOLS) if (!named.has(name) && (toolset.default_config?.enabled ?? true)) on.add(name);
    for (const name of on) differences.push(`${name} is on`);
  }
  if (agent.mcp_servers.length > 0) differences.push(`it has MCP servers (${agent.mcp_servers.map((server) => server.name).join(", ")})`);
  if (agent.multiagent !== null) differences.push("it can start other agents (multiagent is set)");
  if (agent.skills.length > 0) differences.push(`it has skills (${agent.skills.map((skill) => skill.skill_id).join(", ")})`);
  return differences;
}

const stateSchema = z.object({
  environmentId: z.string(),
  agentId: z.string(),
  agentVersion: z.number().int().positive(),
  promptSha: z.string(),
  /** Hashes of the whole params each was last created or updated with; absent from a state file written before they were kept. */
  agentSha: z.string().optional(),
  environmentSha: z.string().optional(),
});

export type SandboxState = z.infer<typeof stateSchema>;

export async function readState(file: string): Promise<SandboxState | null> {
  try {
    return stateSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes the state to a temporary file beside it, then renames that over it,
 * so the file holds the last state or the new one, never part of one: a
 * second stop signal before the create ends the process at once, perhaps
 * inside this write. A write that fails removes its temporary file.
 */
async function writeState(file: string, state: SandboxState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** A short hash of a whole params object, to notice any change to it. */
function paramsSha(params: object): string {
  return promptSha(JSON.stringify(params));
}

/**
 * Creates the environment and the agent once and records their ids. Later
 * calls reuse them; each is updated (the agent to a new version) when the
 * hash of its whole params changed, not only the system prompt's. Then, on
 * every setup and every run, the live environment and the agent version that
 * sessions are pinned to are checked against what the code sets up (its
 * networking; the agent's model, effort, speed, system prompt, tools, MCP
 * servers, other agents and skills): any difference, such as an edit in the
 * Console, refuses the start and says what differs.
 */
export async function ensureSandbox(api: SandboxApi, stateFile: string, system: string, log: (line: string) => void): Promise<SandboxState> {
  const environmentWanted = environmentParams();
  const environmentSha = paramsSha(environmentWanted);
  const agentWanted = agentParams(system);
  const agentSha = paramsSha(agentWanted);
  const known = await readState(stateFile);

  let environment: EnvironmentRef;
  if (known === null) {
    environment = await api.createEnvironment(environmentWanted);
    log(`Created environment ${environment.id}.`);
  } else {
    environment = await api.retrieveEnvironment(known.environmentId);
    if (environment.archived_at !== null) throw new Error(`environment ${known.environmentId} is archived; remove ${stateFile} to create a new one`);
    if (known.environmentSha !== environmentSha) {
      const { name, description, config, metadata } = environmentWanted;
      environment = await api.updateEnvironment(known.environmentId, { name, description, config, metadata });
      log(`Updated environment ${environment.id} (its settings changed).`);
    }
  }

  let agent: { readonly id: string; readonly version: number };
  if (known === null) {
    agent = await api.createAgent(agentWanted);
    log(`Created agent ${agent.id} version ${String(agent.version)}.`);
  } else if (known.agentSha !== agentSha) {
    const current = await api.retrieveAgent(known.agentId);
    const { name, description, model, system: prompt, tools, mcp_servers, skills, metadata } = agentWanted;
    // An update keeps whatever it omits, so every field is sent, skills emptied
    // and every metadata key of the current version cleared first: nothing set
    // on a newer version (in the Console, say) carries over.
    const cleared: Record<string, string | null> = Object.fromEntries(Object.keys(current.metadata).map((key) => [key, null]));
    agent = await api.updateAgent(known.agentId, {
      version: current.version,
      name,
      description,
      model,
      system: prompt,
      tools,
      mcp_servers,
      skills,
      multiagent: null,
      metadata: { ...cleared, ...metadata },
    });
    log(`Updated agent ${agent.id} to version ${String(agent.version)} (its settings changed).`);
  } else {
    agent = { id: known.agentId, version: known.agentVersion };
  }

  const state: SandboxState = { environmentId: environment.id, agentId: agent.id, agentVersion: agent.version, promptSha: promptSha(system), agentSha, environmentSha };
  await writeState(stateFile, state);

  const differences = [...environmentDifferences(environment), ...agentDifferences(await api.retrieveAgent(agent.id, agent.version), system)];
  if (differences.length > 0) {
    throw new Error(
      `the sandbox no longer matches what this launcher sets up: ${differences.join("; ")}. Put it back in the Console, or remove ${stateFile} so that setup creates a new environment and agent.`,
    );
  }
  return state;
}
