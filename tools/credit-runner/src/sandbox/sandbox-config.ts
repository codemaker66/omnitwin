import { z } from "zod";

/**
 * `sandbox.config.json` (git-ignored; `sandbox.config.example.json` beside it
 * is the template, and a test parses it with this schema).
 */
export const sandboxConfigSchema = z
  .object({
    workRoot: z.string().min(1),
    ledgerFile: z.string().min(1),
    keyDir: z.string().min(1),
    keyFile: z.string().regex(/^[\w.-]+$/u),
    lane: z.string().min(1),
    laneCapUsd: z.number().positive(),
    orgCapUsd: z.number().positive(),
  })
  .strict();

export type SandboxConfig = z.infer<typeof sandboxConfigSchema>;
