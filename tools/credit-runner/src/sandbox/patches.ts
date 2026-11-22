import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { git, GIT_TIMEOUT_MS, gitResult, isTestFile } from "../git.js";
import { withBaseCommit } from "./base-repo.js";
import { REPO_URL } from "./brief.js";

/**
 * What the returned format-patch files would do to the base commit, read by
 * git on this machine and never from anything the agent printed.
 *
 * The patches are read in a throwaway repository holding the base commit's
 * trees (base-repo.ts; git fetches into it the few blobs it reads). `git
 * mailsplit` and `git mailinfo` split each file as `git am` would, then `git
 * apply --check` (against the base in the throwaway index), `--numstat -z`
 * (forwards and reversed, for new and old names) and `--summary` (created,
 * deleted and mode-changed files) read them, and `git ls-tree` reads the
 * base's own entry for every path they name. To classify binary files as git
 * does, a series that passes `--check` is then applied to the throwaway
 * index one patch at a time, and nowhere else (filesGitCallsBinary).
 */
export interface PatchInspection {
  /** The `From <sha>` of each format-patch file, in file order (null: none). */
  readonly commits: readonly (string | null)[];
  /** Why the patches cannot go to a person as they are. */
  readonly problems: readonly string[];
  /** Every path the patches write, delete or move, by its old and its new name. */
  readonly touched: readonly string[];
  /** Paths that do not exist at the base and do after the patches: new files and the targets of renames and copies. */
  readonly created: readonly string[];
  readonly deleted: readonly string[];
  /** Old names of renamed or copied files. */
  readonly movedAway: readonly string[];
  /**
   * Binary patch sections, whose content the patch does not show as text, and
   * files whose content one of the commits changes while git's own diff of
   * that commit calls them binary (filesGitCallsBinary), which `git log -p`
   * and a commit-by-commit view show as "Binary files differ".
   */
  readonly binary: readonly string[];
  /** Code files (JavaScript or TypeScript, not tests) that the patches give lines and take none from, other than new files. */
  readonly addOnlyCode: readonly string[];
  /**
   * What the patches would put in the public record, for the secret scan:
   * authors, subjects and messages as `git am` reads them, every added line
   * and every path. Read as plain text, so no attribute can hide a line.
   */
  readonly addedText: string;
  /** One entry per path for the review: A added (a new file or a rename's target), M modified, D deleted, R renamed or copied from. */
  readonly changed: readonly string[];
}

/** A JavaScript or TypeScript file, whose new names a test can fail on when the change is taken away. */
const CODE_FILE = /\.[cm]?[jt]sx?$/iu;

/**
 * Why the git on this machine cannot run the review, from what `git --version`
 * printed; null when it can. The review reads each step's attributes from the
 * base with `--attr-source`, which git 2.41.0 brought: an older git refuses
 * the option, and every run is then rejected as "could not be inspected".
 */
export function gitVersionProblem(versionOutput: string): string | null {
  const line = versionOutput.trim();
  const match = /^git version (\d+)\.(\d+)/u.exec(line);
  if (match === null) return `could not read git's version from ${JSON.stringify(line.slice(0, 80))}; the review needs git 2.41 or newer`;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major > 2 || (major === 2 && minor >= 41)) return null;
  return `git ${String(major)}.${String(minor)} is older than 2.41, which the review needs for --attr-source: every run would be rejected as "could not be inspected" after it is paid for; upgrade git`;
}

/** The modes a returned patch may create or leave: a regular or an executable file. */
const REGULAR_MODES = new Set(["100644", "100755"]);

function modeName(mode: string): string {
  if (mode === "120000") return "symlink";
  if (mode === "160000") return "submodule link (gitlink)";
  return `file of mode ${mode}`;
}

/** The commit a `git format-patch` file was made from: its first line is `From <sha> <date>`. */
export function patchCommit(patchText: string): string | null {
  return /^From ([0-9a-f]{40}) /u.exec(patchText)?.[1] ?? null;
}

const C_ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** Undoes git's C-style quoting of a path (used for a name holding a quote, a backslash or a control character). */
export function unquoteGitPath(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const chars = Array.from(text.slice(1, -1));
  const bytes: number[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = chars[index + 1] ?? "";
    if (/^[0-7]$/u.test(next)) {
      bytes.push(Number.parseInt(chars.slice(index + 1, index + 4).join(""), 8));
      index += 3;
      continue;
    }
    const code = C_ESCAPES[next];
    if (code === undefined) throw new Error(`unknown escape \\${next} in ${text}`);
    bytes.push(code);
    index += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

interface NumstatEntry {
  readonly added: number | null;
  readonly removed: number | null;
  readonly name: string;
}

function parseNumstat(output: string): NumstatEntry[] {
  return output
    .split("\0")
    .filter((entry) => entry !== "")
    .map((entry) => {
      const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/u.exec(entry);
      if (match === null) throw new Error(`git printed an unreadable numstat entry: ${JSON.stringify(entry)}`);
      const count = (value: string | undefined): number | null => (value === undefined || value === "-" ? null : Number(value));
      return { added: count(match[1]), removed: count(match[2]), name: match[3] ?? "" };
    });
}

function tail(text: string, chars = 600): string {
  const trimmed = text.trim();
  return trimmed.length > chars ? `…${trimmed.slice(-chars)}` : trimmed;
}

/** A git call stopped at its time limit, as a reason: the run is rejected for the limit, not for the patches. */
function stoppedAt(command: string): string {
  return `${command} ran past its ${String(GIT_TIMEOUT_MS / 60_000)}-minute limit and was stopped`;
}

function hasControlCharacter(name: string): boolean {
  return Array.from(name).some((char) => (char.codePointAt(0) ?? 0) < 0x20 || char === "\u007f");
}

/** One path of `git diff --raw`: its status letter and its blob before and after (all zeros where it is absent). */
interface RawEntry {
  readonly status: string;
  readonly before: string;
  readonly after: string;
}

/**
 * The paths one step of the series shows as "Binary files differ": the
 * change from the tree `before` to the throwaway index, read by `git diff
 * --raw --numstat`. git calls a file binary (numstat prints `-`) for a NUL in
 * the first 8,000 bytes of either side, or a base .gitattributes that unsets
 * diff for the path (`-diff`, or `binary`), and `git log -p` and format-patch
 * then print "Binary files differ" only where the content changed. So a mode
 * change alone (an M whose blob stays the same) is left out, and so is an
 * exact rename (a blob deleted and the same blob added under another name,
 * which git's rename detection always pairs), though numstat prints `-` for
 * both. A path numstat names but --raw does not counts as binary.
 */
async function binaryInStep(repo: string, scratch: string, baseSha: string, before: string): Promise<string[]> {
  const output = await git(repo, [
    "-c",
    "core.ignorecase=false",
    "-c",
    `core.attributesFile=${path.join(scratch, "no-global-attributes")}`,
    `--attr-source=${baseSha}`,
    "diff",
    "--cached",
    "-z",
    "--raw",
    "--numstat",
    "--no-renames",
    "--no-abbrev",
    "--no-textconv",
    "--no-ext-diff",
    before,
  ]);
  // With -z, a --raw entry is a `:` header and then its path; every other entry is a numstat line.
  const raw = new Map<string, RawEntry>();
  const binary: string[] = [];
  const tokens = output.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "") continue;
    if (token.startsWith(":")) {
      const header = /^:[0-7]{6} [0-7]{6} ([0-9a-f]+) ([0-9a-f]+) ([A-Z])[0-9]*$/u.exec(token);
      const file = tokens[index + 1];
      if (header === null || file === undefined || file === "") throw new Error(`git diff --raw printed an unreadable entry: ${JSON.stringify(token)}`);
      const [, from = "", to = "", status = ""] = header;
      raw.set(file, { status, before: from, after: to });
      index += 1;
    } else {
      for (const entry of parseNumstat(token)) if (entry.added === null) binary.push(entry.name);
    }
  }
  const unchanged = new Set<string>();
  const deletedBlobs = new Map<string, string[]>();
  for (const [file, entry] of raw) {
    if (entry.status === "M" && entry.before === entry.after) unchanged.add(file);
    if (entry.status === "D") deletedBlobs.set(entry.before, [...(deletedBlobs.get(entry.before) ?? []), file]);
  }
  for (const [file, entry] of raw) {
    if (entry.status !== "A") continue;
    const renamedFrom = deletedBlobs.get(entry.after)?.shift();
    if (renamedFrom === undefined) continue;
    unchanged.add(renamedFrom);
    unchanged.add(file);
  }
  return binary.filter((file) => !unchanged.has(file));
}

/**
 * The files git itself shows as a binary change in any one of the commits, as
 * `git log -p` and a commit-by-commit view on GitHub do (binaryInStep). Each
 * commit is judged on its own, so a NUL that one commit adds and a later one
 * takes out again still counts: nobody could read either commit there,
 * whatever the patch wrote, though the series' net change reads as text.
 *
 * The patches are applied to the throwaway index only, one at a time (it holds
 * the base; git fetches the blobs it needs into the throwaway repository), and
 * each step is compared with the tree before it. That tree is written with
 * `git write-tree --missing-ok`: without it, git first fetches every blob the
 * index names and the throwaway repository lacks, which is the whole base,
 * though the tree only names them. The base's .gitattributes decides every
 * step, not one the series edits (`--attr-source`, git 2.41 or newer), a
 * global attributes file is left out, and patterns match names by case, as on
 * Linux and GitHub, though a Windows clone would otherwise ignore case. Text
 * conversion and external diff drivers are off.
 */
async function filesGitCallsBinary(repo: string, scratch: string, baseSha: string, steps: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  let before = baseSha;
  for (const [index, step] of steps.entries()) {
    await git(repo, ["apply", "--cached", "--whitespace=nowarn", step]);
    for (const file of await binaryInStep(repo, scratch, baseSha, before)) found.add(file);
    if (index < steps.length - 1) before = await git(repo, ["write-tree", "--missing-ok"]);
  }
  return [...found];
}

function emptyInspection(commits: readonly (string | null)[], problems: readonly string[], texts: readonly string[]): PatchInspection {
  return {
    commits,
    problems,
    touched: [],
    created: [],
    deleted: [],
    movedAway: [],
    binary: [],
    addOnlyCode: [],
    addedText: texts.join("\n"),
    changed: [],
  };
}

/** Reads the returned format-patch files, in file order, against the base commit. */
export async function inspectPatches(
  files: readonly string[],
  options: { readonly baseSha: string; readonly repoUrl?: string | undefined; readonly log?: ((line: string) => void) | undefined },
): Promise<PatchInspection> {
  const problems: string[] = [];
  const commits: (string | null)[] = [];
  const texts: string[] = [];
  try {
    return await withBaseCommit(
      options.repoUrl ?? REPO_URL,
      options.baseSha,
      async (repo, scratch) => {
        await git(repo, ["read-tree", options.baseSha]);

        // Each file as `git am` would read it: exactly one message, split into
        // the commit message and the patch by git itself.
        const bodies: string[] = [];
        const bodyFiles: string[] = [];
        for (const [index, file] of files.entries()) {
          const name = path.basename(file);
          commits.push(patchCommit((await readFile(file)).toString("utf8")));
          const splitDir = path.join(scratch, `split-${String(index)}`);
          await mkdir(splitDir);
          const split = await gitResult(repo, ["mailsplit", `-o${splitDir}`, file]);
          if (split.timedOut) {
            problems.push(`${name} could not be split: ${stoppedAt("git mailsplit")}`);
            continue;
          }
          if (split.code !== 0 || split.stdout.trim() !== "1") {
            problems.push(`${name} holds ${split.code === 0 ? split.stdout.trim() : "no readable"} message(s), not exactly one`);
            continue;
          }
          const message = path.join(scratch, `message-${String(index)}`);
          const body = path.join(scratch, `patch-${String(index)}`);
          const info = await gitResult(repo, ["mailinfo", message, body], await readFile(path.join(splitDir, "0001")));
          if (info.code !== 0) {
            problems.push(`${name} could not be read as a commit: ${info.timedOut ? stoppedAt("git mailinfo") : tail(info.stderr)}`);
            continue;
          }
          const bodyText = await readFile(body, "utf8");
          if (!/^diff --git /mu.test(bodyText)) problems.push(`${name} holds no change`);
          bodies.push(bodyText);
          bodyFiles.push(body);
          texts.push(info.stdout, await readFile(message, "utf8"));
          // One at a time: spreading a large patch's lines into push() would overflow the call stack.
          for (const line of bodyText.split("\n")) if (line.startsWith("+")) texts.push(line);
        }
        if (bodies.length === 0) return emptyInspection(commits, problems, texts);

        // One input, so a file changed by more than one commit is checked against
        // the result of the earlier ones, as `git am` would apply them.
        const series = path.join(scratch, "series.diff");
        await writeFile(series, bodies.join("\n"));
        const check = await gitResult(repo, ["apply", "--cached", "--check", "--whitespace=nowarn", series]);
        if (check.timedOut) problems.push(`the patches could not be checked against the base ${options.baseSha}: ${stoppedAt("git apply --check")}`);
        else if (check.code !== 0) problems.push(`the patches do not apply to the base ${options.baseSha}: ${tail(check.stderr)}`);

        const forward = parseNumstat(await git(repo, ["apply", "--numstat", "-z", series]));
        const reversed = parseNumstat(await git(repo, ["apply", "--numstat", "-z", "-R", series]));
        const newNames = new Set(forward.map((entry) => entry.name));
        const oldNames = new Set(reversed.map((entry) => entry.name));
        const touched = [...new Set([...newNames, ...oldNames])];
        for (const name of touched) texts.push(name);
        const control = touched.filter(hasControlCharacter);
        if (control.length > 0) {
          problems.push(`a path holds a control character: ${control.map((name) => JSON.stringify(name)).join(", ")}`);
          return { ...emptyInspection(commits, problems, texts), touched };
        }

        const deleted = new Set<string>();
        for (const line of (await git(repo, ["apply", "--summary", series])).split("\n")) {
          if (line.trim() === "") continue;
          const createOrDelete = /^ (create|delete) mode ([0-7]{6}) (.+)$/u.exec(line);
          const modeChange = /^ mode change ([0-7]{6}) => ([0-7]{6})(?: (.+))?$/u.exec(line);
          if (createOrDelete !== null) {
            const [, kind = "", mode = "", quoted = ""] = createOrDelete;
            const file = unquoteGitPath(quoted);
            if (!newNames.has(file)) {
              problems.push(`the patch summary names a file the patches do not: ${JSON.stringify(file)}`);
              continue;
            }
            if (kind === "delete") deleted.add(file);
            if (!REGULAR_MODES.has(mode)) problems.push(`${file}: ${kind === "create" ? "creates" : "removes"} a ${modeName(mode)}`);
          } else if (modeChange !== null) {
            const [, from = "", to = "", file = "(renamed file)"] = modeChange;
            for (const mode of [from, to]) {
              if (!REGULAR_MODES.has(mode)) problems.push(`${file}: changes a mode ${from} => ${to}, a ${modeName(mode)}`);
            }
          } else if (!/^ (rename|copy|rewrite) .+ \(\d+%\)$/u.test(line)) {
            problems.push(`git apply --summary printed a line the launcher cannot read: ${JSON.stringify(line)}`);
          }
        }

        // The base's own entry for every path: a file that keeps its mode keeps
        // the base's (a modified symlink or submodule link shows no mode line),
        // and a new name the base lacks is a new file or a rename's target.
        const atBase = new Set<string>();
        for (let start = 0; start < touched.length; start += 200) {
          const listing = await git(repo, ["--literal-pathspecs", "ls-tree", "-r", "-z", options.baseSha, "--", ...touched.slice(start, start + 200)]);
          for (const entry of listing.split("\0")) {
            const match = /^([0-7]{6}) \S+ [0-9a-f]+\t([\s\S]+)$/u.exec(entry);
            if (match === null) continue;
            const [, mode = "", file = ""] = match;
            atBase.add(file);
            if (!REGULAR_MODES.has(mode)) problems.push(`${file}: is a ${modeName(mode)} at the base`);
          }
        }

        const movedAway = [...oldNames].filter((name) => !newNames.has(name));
        const created = [...newNames].filter((name) => !atBase.has(name) && !deleted.has(name));
        // A binary patch section hides its content from the scan whatever it
        // holds; git's diff of each applied commit classifies everything else.
        // A series that does not apply is rejected already and is not applied.
        const binary = [
          ...new Set([
            ...forward.filter((entry) => entry.added === null).map((entry) => entry.name),
            ...(check.code === 0 ? await filesGitCallsBinary(repo, scratch, options.baseSha, bodyFiles) : []),
          ]),
        ];
        const isCreated = new Set(created);
        // Each code file's lines over the whole series, so one that only gains
        // lines is found whatever the other files lose (new files are flagged apart).
        const codeLines = new Map<string, { readonly added: number; readonly removed: number; readonly binary: boolean }>();
        for (const entry of forward) {
          if (isTestFile(entry.name) || !CODE_FILE.test(entry.name)) continue;
          const sum = codeLines.get(entry.name) ?? { added: 0, removed: 0, binary: false };
          codeLines.set(entry.name, { added: sum.added + (entry.added ?? 0), removed: sum.removed + (entry.removed ?? 0), binary: sum.binary || entry.added === null });
        }
        const addOnlyCode = [...codeLines].filter(([name, sum]) => !sum.binary && sum.added > 0 && sum.removed === 0 && !isCreated.has(name)).map(([name]) => name);
        const changed = [
          ...[...newNames].map((name) => `${isCreated.has(name) ? "A" : deleted.has(name) ? "D" : "M"} ${name}`),
          ...movedAway.map((name) => `R ${name}`),
        ];
        return {
          commits,
          problems,
          touched,
          created,
          deleted: [...deleted],
          movedAway,
          binary,
          addOnlyCode,
          addedText: texts.join("\n"),
          changed,
        };
      },
      options.log,
    );
  } catch (error) {
    problems.push(`the patches could not be inspected: ${tail(error instanceof Error ? error.message : String(error))}`);
    return emptyInspection(commits, problems, texts);
  }
}
