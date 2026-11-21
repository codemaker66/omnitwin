import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentCreateParams } from "@anthropic-ai/sdk/resources/beta/agents/agents";
import type { EnvironmentCreateParams } from "@anthropic-ai/sdk/resources/beta/environments/environments";
import { z } from "zod";
import type { Effort } from "../task.js";
import type { SandboxApi } from "./api.js";
import { promptSha } from "./brief.js";

export const ENVIRONMENT_NAME = "venviewer-night-sandbox";
export const AGENT_NAME = "venviewer-night-fixer";
export const AGENT_MODEL = "claude-opus-5-5";
export const AGENT_EFFORT: Effort = "high";

/**
 * The container: Anthropic's cloud, deny-by-default egress. Package
 * registries are open for pnpm, github.com for fetching the public repo,
 * nodejs.org in case the image's Node is older than the repo's 22.18 floor.
 * Postgres comes from Ubuntu's packages so the database suites can run.
 */
export function environmentParams(): EnvironmentCreateParams {
  return {
    name: ENVIRONMENT_NAME,
    description: "Venviewer night runs: public repo only, no credentials, limited egress.",
    config: {
      type: "cloud",
      networking: {
        type: "limited",
        allow_package_managers: true,
        allow_mcp_servers: false,
        allowed_hosts: ["github.com", "nodejs.org"],
      },
      packages: { apt: ["postgresql"], npm: ["pnpm@9.15.4"] },
    },
    metadata: { lane: "sandbox" },
  };
}

/**
 * Bash and file tools only. The web tools are off. Calls run without asking
 * (`always_allow`): the container holds no secret and reaches no service that
 * accepts writes, so a pause for approval would only stall an unattended run.
 */
export function agentParams(system: string): AgentCreateParams {
  return {
    name: AGENT_NAME,
    description: "Fixes one checked Venviewer defect per session and returns a patch for review.",
    model: { id: AGENT_MODEL, effort: AGENT_EFFORT },
    system,
    tools: [
      {
        type: "agent_toolset_20260401",
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
        configs: [
          { name: "web_fetch", enabled: false },
          { name: "web_search", enabled: false },
        ],
      },
    ],
    metadata: { promptSha: promptSha(system) },
  };
}

const stateSchema = z.object({
  environmentId: z.string(),
  agentId: z.string(),
  agentVersion: z.number().int().positive(),
  promptSha: z.string(),
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

async function writeState(file: string, state: SandboxState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Creates the environment and the agent once and records their ids. Later
 * calls reuse them; the agent is updated (a new version, not a new agent)
 * only when its system prompt changed.
 */
export async function ensureSandbox(api: SandboxApi, stateFile: string, system: string, log: (line: string) => void): Promise<SandboxState> {
  const sha = promptSha(system);
  const known = await readState(stateFile);
  let environmentId = known?.environmentId;
  if (environmentId === undefined) {
    environmentId = (await api.createEnvironment(environmentParams())).id;
    log(`Created environment ${environmentId}.`);
  } else {
    const environment = await api.retrieveEnvironment(environmentId);
    if (environment.archived_at !== null) throw new Error(`environment ${environmentId} is archived; remove ${stateFile} to create a new one`);
  }

  let state: SandboxState;
  if (known === null) {
    const agent = await api.createAgent(agentParams(system));
    log(`Created agent ${agent.id} version ${String(agent.version)}.`);
    state = { environmentId, agentId: agent.id, agentVersion: agent.version, promptSha: sha };
  } else if (known.promptSha !== sha) {
    const current = await api.retrieveAgent(known.agentId);
    const params = agentParams(system);
    const agent = await api.updateAgent(known.agentId, {
      version: current.version,
      system: params.system,
      model: params.model,
      tools: params.tools,
      metadata: params.metadata,
    });
    log(`Updated agent ${agent.id} to version ${String(agent.version)} (the system prompt changed).`);
    state = { environmentId, agentId: agent.id, agentVersion: agent.version, promptSha: sha };
  } else {
    state = { ...known, environmentId };
  }
  await writeState(stateFile, state);
  return state;
}
