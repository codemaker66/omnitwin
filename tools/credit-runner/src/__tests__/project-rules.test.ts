import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nightRulesFromAgentsMd } from "../project-rules.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

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
  "Credentials are stored outside Git at `C:/Users/blake/deploy-secrets/x.json`.",
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

  it("drops paragraphs that send an unattended run to secrets, the task list, the session logs or the user", () => {
    const rules = nightRulesFromAgentsMd(SAMPLE);
    expect(rules).not.toContain("deploy-secrets");
    expect(rules).not.toContain("docs/state/tasks.md");
    expect(rules).not.toContain("docs/sessions/");
    expect(rules).not.toContain("Ask only for a material decision");
  });

  it("refuses text that still names deploy-secrets after filtering", () => {
    // A paragraph naming deploy-secrets is dropped whole...
    expect(nightRulesFromAgentsMd("# Rules\n\n## Build\n\nThe keys live in deploy-secrets.\n")).not.toContain("deploy-secrets");
    // ...but a heading is not a paragraph, so a section titled with it must throw rather than pass through.
    expect(() => nightRulesFromAgentsMd("# Rules\n\n## Where deploy-secrets live\n")).toThrow(/deploy-secrets/u);
  });

  it("never passes deploy-secrets on from the repository's real AGENTS.md", async () => {
    const agentsMd = await readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
    const rules = nightRulesFromAgentsMd(agentsMd);
    expect(rules).not.toMatch(/deploy-secrets/iu);
    expect(rules).not.toMatch(/docs\/sessions\//u);
    // The engineering rules survive.
    expect(rules).toMatch(/TypeScript stays strict/u);
    expect(rules).toMatch(/regression coverage/u);
  });
});
