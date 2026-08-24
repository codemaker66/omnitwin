const SAFE_GIT_PASSTHROUGH_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

/**
 * Git boundary checks run while the parent process may hold a bearer token or
 * long-lived storage credential. Pass only process-launch essentials plus
 * deterministic, non-interactive Git controls to the child.
 */
export function safeGitChildEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_GLOBAL: platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
  for (const key of SAFE_GIT_PASSTHROUGH_KEYS) {
    const value = source[key];
    if (value !== undefined) child[key] = value;
  }
  if (platform === "win32") {
    const windowsRoot = source["SystemRoot"] ??
      source["SYSTEMROOT"] ??
      source["WINDIR"];
    const drive = windowsRoot === undefined
      ? undefined
      : /^([A-Za-z]:)[\\/]/u.exec(windowsRoot)?.[1]?.toUpperCase();
    if (drive !== undefined) {
      child.SystemDrive = drive;
      const programData = source["ProgramData"];
      child.ProgramData = programData !== undefined &&
          programData.trim() === programData &&
          !hasControlCharacter(programData) &&
          programData.toUpperCase().startsWith(`${drive}\\`)
        ? programData
        : `${drive}\\ProgramData`;
    }
    child.PATHEXT ??= ".COM;.EXE;.BAT;.CMD";
  }
  return child;
}
