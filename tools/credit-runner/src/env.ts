/**
 * Environment for the processes the runner starts.
 *
 * The runner may be launched from inside a Claude Code session (which exports
 * ANTHROPIC_BASE_URL and ~30 CLAUDE_CODE_* session variables) or from a shell
 * holding tokens for OpenAI, GitHub, Railway and the rest. None of that may reach
 * a run: a stray base URL or OAuth variable could route a run to Blake's Max
 * plan, and any token is one an agent could misuse. So a child gets a fixed
 * allow-list of what Windows, git, node and pnpm need, plus guards that make
 * pushes and hosted CLIs fail. Anything else must be named in the config's
 * `passEnv`.
 */

export type ChildEnv = Readonly<Record<string, string>>;

/** Names passed through, compared case-insensitively (Windows variable names are). */
const PASSED = new Set(
  [
    // Windows system
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "OS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "NUMBER_OF_PROCESSORS",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "CommonProgramFiles(x86)",
    "CommonProgramW6432",
    "ALLUSERSPROFILE",
    "PUBLIC",
    // The user's folders and identity (git and node look these up)
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERNAME",
    "USERDOMAIN",
    "COMPUTERNAME",
    "USER",
    "LOGNAME",
    "SHELL",
    // Locale and terminal
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TZ",
    // Toolchain locations
    "PNPM_HOME",
    "NVM_HOME",
    "NVM_SYMLINK",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    // Network plumbing (no credentials)
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
  ].map((name) => name.toLowerCase()),
);

/** Push URL that no git transport understands, so `git push` fails before any network call. */
export const PUSH_DISABLED_URL = "credit-runner-push-disabled://push-is-disabled-for-unattended-runs";

export function isPassed(name: string, passEnv: readonly string[] = []): boolean {
  const lower = name.toLowerCase();
  return PASSED.has(lower) || passEnv.some((extra) => extra.toLowerCase() === lower);
}

/** Environment for install, acceptance and other tool processes: no Anthropic key at all. */
export function toolChildEnv(parent: NodeJS.ProcessEnv, passEnv: readonly string[] = []): ChildEnv {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && isPassed(name, passEnv)) env[name] = value;
  }
  // git: never prompt, push to a dead URL, and use no credential helper (an
  // empty helper value resets the list), so nothing can authenticate a push.
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "never";
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_0 = "remote.origin.pushurl";
  env.GIT_CONFIG_VALUE_0 = PUSH_DISABLED_URL;
  env.GIT_CONFIG_KEY_1 = "credential.helper";
  env.GIT_CONFIG_VALUE_1 = "";
  // Hosted CLIs prefer an env token over a stored login; a dead one makes them fail.
  env.GH_TOKEN = "credit-runner-has-no-github-access";
  env.RAILWAY_TOKEN = "credit-runner-has-no-railway-access";
  // cmd.exe would otherwise run a `pnpm.cmd` or `vitest.cmd` from the current
  // folder ahead of PATH, letting a committed script fake the acceptance result.
  env.NoDefaultCurrentDirectoryInExePath = "1";
  return env;
}

/**
 * Environment for one `claude -p --bare` run. The key exists only here, in the
 * child's environment block; it is never written to the runner's own process
 * environment, to disk, or to a log.
 */
export function claudeChildEnv(
  parent: NodeJS.ProcessEnv,
  apiKey: string,
  configDir: string,
  passEnv: readonly string[] = [],
): ChildEnv {
  return {
    ...toolChildEnv(parent, passEnv),
    ANTHROPIC_API_KEY: apiKey,
    // An isolated config folder holds no Max-plan login, so even a fallback has nothing to use.
    CLAUDE_CONFIG_DIR: configDir,
    DISABLE_AUTOUPDATER: "1",
  };
}
