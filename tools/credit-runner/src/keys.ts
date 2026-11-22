import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A workspace API key from the Console, the only kind the runner takes: one
 * line, `sk-ant-api`, two digits and a dash, then the secret. An allow-list, so
 * a credential of any other kind is refused, a new one included.
 */
const KEY_SHAPE = /^sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}$/u;

/**
 * Whether `key` is one line of that shape and nothing else: the one rule for
 * readKey and for the client (sdkSandboxApi refuses any other key before it is
 * built, so nothing else is ever put in a header or an error).
 */
export function isWorkspaceKey(key: string): boolean {
  return KEY_SHAPE.test(key);
}

export async function keyFilePresent(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Other Anthropic credentials, named so a refusal says what was stored: an
 * Admin API key manages the whole organization, and the others are not
 * Console API keys (the client sends X-Api-Key only, so they would fail with a
 * bare 401).
 */
const OTHER_KINDS: readonly (readonly [RegExp, string])[] = [
  [/^sk-ant-admin/iu, "an Admin API key (sk-ant-admin...), which the runner must never hold"],
  [/^sk-ant-oat/iu, "an OAuth access token (sk-ant-oat...), not a Console API key"],
  [/^sk-ant-ort/iu, "an OAuth refresh token (sk-ant-ort...), not a Console API key"],
  [/^sk-ant-sid/iu, "a session key (sk-ant-sid...), not a Console API key"],
];

/** Reads and shape-checks a key. Error messages never include the file's contents. */
export async function readKey(file: string): Promise<string> {
  const key = (await readFile(file, "utf8")).trim();
  for (const [kind, what] of OTHER_KINDS) {
    if (kind.test(key)) throw new Error(`${file} holds ${what}; store a workspace API key (sk-ant-api...) for the runner instead`);
  }
  if (!isWorkspaceKey(key)) {
    throw new Error(`${file} does not hold an Anthropic API key the runner takes (expected a single line: sk-ant-api, two digits and a dash, then the key)`);
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
