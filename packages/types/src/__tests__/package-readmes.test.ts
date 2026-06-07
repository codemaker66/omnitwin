import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../../..");

const PACKAGE_READMES = [
  {
    path: "packages/api/README.md",
    required: [
      "@omnitwin/api",
      "Fastify API service",
      "Owns",
      "Does Not Own",
      "pnpm --filter @omnitwin/api typecheck",
      "Contract Rules",
    ],
  },
  {
    path: "packages/types/README.md",
    required: [
      "@omnitwin/types",
      "Shared TypeScript and Zod contract package",
      "Owns",
      "Does Not Own",
      "pnpm --filter @omnitwin/types typecheck",
      "Contract Rules",
    ],
  },
  {
    path: "packages/web/README.md",
    required: [
      "@omnitwin/web",
      "React, Vite, and React Three Fiber",
      "Owns",
      "Does Not Own",
      "pnpm --filter @omnitwin/web typecheck",
      "Runtime Asset Rules",
    ],
  },
] as const;

const UNSAFE_README_PHRASES = [
  "fire approved",
  "certified safe",
  "legally compliant",
  "survey-grade",
  "approved for occupancy",
  "guaranteed accessible",
  "Black Label",
  "production ready",
  "photoreal digital twin",
] as const;

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), "utf-8");
}

describe("package READMEs", () => {
  it("documents each workspace package boundary and local gate", async () => {
    const missing: string[] = [];

    for (const readme of PACKAGE_READMES) {
      const content = await readRepoFile(readme.path);
      for (const phrase of readme.required) {
        if (!content.includes(phrase)) {
          missing.push(`${readme.path}: ${phrase}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("keeps package READMEs free of unsupported claim phrases", async () => {
    const hits: string[] = [];

    for (const readme of PACKAGE_READMES) {
      const content = (await readRepoFile(readme.path)).toLowerCase();
      for (const phrase of UNSAFE_README_PHRASES) {
        if (content.includes(phrase.toLowerCase())) {
          hits.push(`${readme.path}: ${phrase}`);
        }
      }
    }

    expect(hits).toEqual([]);
  });
});
