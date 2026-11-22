import { homedir } from "node:os";
import { z } from "zod";

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "expected a YYYY-MM-DD date");

/** Expands a leading `%USERPROFILE%` or `~` to the user's home folder. */
export function expandHome(input: string, home: string = homedir()): string {
  return input.replace(/^%USERPROFILE%/iu, home).replace(/^~(?=$|[\\/])/u, home);
}
