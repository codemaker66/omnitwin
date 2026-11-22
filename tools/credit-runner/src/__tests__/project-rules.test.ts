import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nightRulesFromAgentsMd } from "../project-rules.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Text an unattended run must never be told: deployment, live checks, delivery, or where secrets live. */
const NEVER_REACHES_A_RUN = [
  /deploy/iu,
  /live[- ](?:flow|verification|check|site|app|production|environment)/iu,
  /through delivery/iu,
  /shipping contract/iu,
  /deploy-secrets/iu,
  /docs\/sessions\//u,
  /docs\/state\/tasks\.md/u,
  /Ask only for a material decision/u,
];

const SAMPLE = [
  "# Venviewer — working in this repository",
  "",
  "Intro paragraph that stays.",
  "",
  "## Current delivery instruction — 7 September 2026",
  "",
  "Requested product changes include deployment and live verification.",
  "",
  "## Local CMS credentials",
  "",
  "Credentials are stored outside Git at `C:/Users/u/deploy-secrets/x.json`.",
  "",
  "## Start with the actual task",
  "",
  "Read GOAL.md, then the [task protocol](docs/state/tasks.md#shepherd-protocol).",
  "",
  "Ask only for a material decision, information or authorization actually missing.",
  "",
  "Use existing tests and add regression coverage for changed behavior.",
  "",
  "## Build and verify real behavior",
  "",
  "TypeScript stays strict, with no `any`.",
  "",
  "Keep updates concise. Record durable decisions in `docs/sessions/YYYY-MM-DD.md`.",
  "",
].join("\n");

describe("nightRulesFromAgentsMd", () => {
  it("drops the delivery and credentials sections and keeps the engineering rules", () => {
    const rules = nightRulesFromAgentsMd(SAMPLE);
    expect(rules).toContain("Intro paragraph that stays.");
    expect(rules).toContain("## Start with the actual task");
    expect(rules).toContain("Use existing tests and add regression coverage for changed behavior.");
    expect(rules).toContain("TypeScript stays strict, with no `any`.");
    expect(rules).not.toContain("Current delivery instruction");
    expect(rules).not.toContain("deployment and live verification");
    expect(rules).not.toContain("Local CMS credentials");
  });

  it("drops the sentences that send an unattended run to secrets, the task list, the session logs or the user, and keeps their neighbours", () => {
    const rules = nightRulesFromAgentsMd(SAMPLE);
    for (const pattern of NEVER_REACHES_A_RUN) expect(rules).not.toMatch(pattern);
    // The same paragraph's other sentence survives: filtering is by sentence, not by paragraph.
    expect(rules).toContain("Keep updates concise.");
  });

  it("drops deployment text from a reworded AGENTS.md, whatever section it sits in", () => {
    const reworded = [
      "# Rules",
      "",
      "## Own the outcome",
      "",
      "Investigate and verify until the work is complete. Requested changes include deployment and a check of the changed live flow. Carry the requested change through delivery. Preserve other work in the shared tree.",
      "",
      "- Run the affected tests.",
      "- Deploy to production when the tests pass.",
      "",
    ].join("\n");
    const rules = nightRulesFromAgentsMd(reworded);
    for (const pattern of NEVER_REACHES_A_RUN) expect(rules).not.toMatch(pattern);
    expect(rules).toContain("Investigate and verify until the work is complete.");
    expect(rules).toContain("Preserve other work in the shared tree.");
    expect(rules).toContain("- Run the affected tests.");
  });

  it("refuses text that still names a secrets folder or a local path after filtering", () => {
    // A sentence naming deploy-secrets is dropped...
    expect(nightRulesFromAgentsMd("# Rules\n\n## Build\n\nThe keys live in deploy-secrets.\n")).not.toContain("deploy-secrets");
    // ...but a heading is not a sentence, so a section titled with it must throw rather than pass through.
    expect(() => nightRulesFromAgentsMd("# Rules\n\n## Where deploy-secrets live\n")).toThrow(/secrets folder/u);
    expect(() => nightRulesFromAgentsMd("# Rules\n\n## Keys under C:\\Users\\u\\keys\n")).toThrow(/local path/u);
  });

  it("passes no deployment, live-verification or secrets text on from the repository's real AGENTS.md", async () => {
    const agentsMd = await readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
    const rules = nightRulesFromAgentsMd(agentsMd);
    for (const pattern of NEVER_REACHES_A_RUN) expect(rules).not.toMatch(pattern);
    // The engineering rules survive.
    expect(rules).toMatch(/TypeScript stays strict/u);
    expect(rules).toMatch(/regression coverage/u);
    expect(rules).toMatch(/Inspect git status/u);
  });
});
