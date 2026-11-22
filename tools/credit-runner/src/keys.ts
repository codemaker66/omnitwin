import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** An Anthropic Console API key: one line, `sk-ant-` then the secret. */
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,}$/u;

export async function keyFilePresent(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Reads and shape-checks a key. Error messages never include the file's contents. */
export async function readKey(file: string): Promise<string> {
  const key = (await readFile(file, "utf8")).trim();
  if (!KEY_SHAPE.test(key)) {
    throw new Error(`${file} does not hold an Anthropic API key (expected a single line starting with sk-ant-)`);
  }
  return key;
}

const ACE = /^(.+?):((?:\([^)]*\))+)$/u;

/**
 * Principals an `icacls` listing grants access to, other than the expected
 * ones (the owner, SYSTEM and Administrators). DENY entries are ignored.
 */
export function unexpectedPrincipals(icaclsOutput: string, file: string, expected: readonly string[]): string[] {
  const allowed = new Set(expected.map((name) => name.toLowerCase()));
  const found = new Set<string>();
  for (const raw of icaclsOutput.split(/\r?\n/u)) {
    let line = raw.trim();
    // The first entry shares its line with the file name.
    if (line.toLowerCase().startsWith(file.toLowerCase())) line = line.slice(file.length).trim();
    const match = ACE.exec(line);
    if (match === null) continue;
    const principal = match[1] ?? "";
    const rights = match[2] ?? "";
    if (!rights.includes("(DENY)") && !allowed.has(principal.toLowerCase())) found.add(principal);
  }
  return [...found];
}

/** Returns the reasons a key file is readable by more than its owner; empty when it is private. */
export async function keyFileExposure(file: string): Promise<string[]> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("icacls", [file], { windowsHide: true });
    const owner = `${process.env.USERDOMAIN ?? ""}\\${userInfo().username}`;
    return unexpectedPrincipals(stdout, file, [owner, "NT AUTHORITY\\SYSTEM", "BUILTIN\\Administrators"]).map(
      (principal) => `readable by '${principal}'`,
    );
  }
  const mode = (await stat(file)).mode & 0o077;
  return mode === 0 ? [] : [`mode allows group/other access (${(mode | 0o600).toString(8)})`];
}
