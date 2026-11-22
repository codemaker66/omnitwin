/**
 * The allow-list of environment variable names a child process may inherit.
 *
 * A child started by the runner or the shift must not receive whatever the
 * launching shell holds (session tokens, hosted-service tokens, database URLs).
 * It gets a fixed list of what Windows, git, node and pnpm need, plus any extra
 * names a caller passes explicitly.
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

export function isPassed(name: string, passEnv: readonly string[] = []): boolean {
  const lower = name.toLowerCase();
  return PASSED.has(lower) || passEnv.some((extra) => extra.toLowerCase() === lower);
}
