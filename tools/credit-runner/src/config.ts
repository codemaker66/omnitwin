import { homedir } from "node:os";

/** Expands a leading `%USERPROFILE%` or `~` to the user's home folder. */
export function expandHome(input: string, home: string = homedir()): string {
  return input.replace(/^%USERPROFILE%/iu, home).replace(/^~(?=$|[\\/])/u, home);
}
