import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "expected a YYYY-MM-DD date");

const orgSchema = z.object({
  /** Short id used in logs and the ledger, e.g. "batch". */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
  /** The Console organisation name, shown in reports. */
  name: z.string().min(1),
  /** Bare file name inside keyDir holding this org's API key. */
  keyFile: z.string().regex(/^[\w.-]+$/u, "keyFile must be a bare file name inside keyDir"),
  /** The monthly credit grant, used only to show an estimate in the report. */
  grantUsd: z.number().positive().optional(),
  /** Last day the grant can be spent. Orgs past it are skipped; sooner expiries are spent first. */
  expires: isoDateSchema.optional(),
});

export type Org = z.infer<typeof orgSchema>;

const configSchema = z
  .object({
    /** Total spend allowed per night across all tasks, in USD. */
    nightlyCapUsd: z.number().positive().max(500),
    /** Worktrees and the isolated Claude config live here (fast drive). */
    runsRoot: z.string().min(1),
    /** Reports, ledger and logs live here (bulk drive). */
    outputRoot: z.string().min(1),
    /** Folder holding one key file per org; %USERPROFILE% and ~ are expanded. */
    keyDir: z.string().min(1),
    /** Default base for task branches. */
    baseRef: z.string().min(1),
    /** Prefix for runner branches, e.g. "credit/". */
    branchPrefix: z.string().regex(/^[a-z][a-z0-9-]*\/$/u),
    /** The Claude Code executable plus any leading arguments. */
    claudeCommand: z.array(z.string().min(1)).min(1),
    /**
     * Extra environment variable names passed to runs, beyond env.ts's fixed
     * allow-list. Anthropic and Claude variables can never be passed.
     */
    passEnv: z
      .array(
        z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_()]*$/u)
          .refine((name) => !/^(ANTHROPIC_|CLAUDE)/iu.test(name), "Anthropic and Claude variables cannot be passed to runs"),
      )
      .default([]),
    orgs: z.array(orgSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const org of config.orgs) {
      if (seen.has(org.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate org id '${org.id}'`, path: ["orgs"] });
      }
      seen.add(org.id);
    }
  });

export type RunnerConfig = z.infer<typeof configSchema>;

export function expandHome(input: string, home: string = homedir()): string {
  return input.replace(/^%USERPROFILE%/iu, home).replace(/^~(?=$|[\\/])/u, home);
}

export function parseConfig(raw: unknown): RunnerConfig {
  const parsed = configSchema.parse(raw);
  return {
    ...parsed,
    keyDir: path.resolve(expandHome(parsed.keyDir)),
    runsRoot: path.resolve(expandHome(parsed.runsRoot)),
    outputRoot: path.resolve(expandHome(parsed.outputRoot)),
  };
}

export async function loadConfig(file: string): Promise<RunnerConfig> {
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  return parseConfig(raw);
}
