import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { FoundryIntegrityError } from "./errors.js";

const SAFE_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$/u;

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return fromRoot === "" || (
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

export function assertSafeBundlePath(relativePath: string): void {
  if (!SAFE_RELATIVE_PATH.test(relativePath)) {
    throw new FoundryIntegrityError("UNSAFE_BUNDLE_PATH", `Unsafe bundle path: ${relativePath}`);
  }
  const parts = relativePath.split("/");
  if (
    parts.some((part) => part === "" || part === "." || part === "..") ||
    relativePath.includes("\\") ||
    relativePath.includes("%") ||
    relativePath.includes(":")
  ) {
    throw new FoundryIntegrityError("UNSAFE_BUNDLE_PATH", `Unsafe bundle path: ${relativePath}`);
  }
}

export function resolveBundlePath(root: string, relativePath: string): string {
  assertSafeBundlePath(relativePath);
  const candidate = resolve(root, ...relativePath.split("/"));
  if (candidate === resolve(root) || !isWithin(resolve(root), candidate)) {
    throw new FoundryIntegrityError("BUNDLE_PATH_ESCAPE", `Bundle path escapes its root: ${relativePath}`);
  }
  return candidate;
}

export async function canonicalBundleRoot(input: string): Promise<string> {
  const requested = resolve(input);
  const requestedMetadata = await lstat(requested);
  if (requestedMetadata.isSymbolicLink()) {
    throw new FoundryIntegrityError("BUNDLE_ROOT_SYMLINK", `Twin bundle root cannot be a symbolic link: ${requested}`);
  }
  const canonical = await realpath(requested);
  if (!(await stat(canonical)).isDirectory()) {
    throw new FoundryIntegrityError("BUNDLE_ROOT_NOT_DIRECTORY", `Twin bundle root is not a directory: ${canonical}`);
  }
  const metadata = await lstat(canonical);
  if (metadata.isSymbolicLink()) {
    throw new FoundryIntegrityError("BUNDLE_ROOT_SYMLINK", `Twin bundle root cannot be a symbolic link: ${canonical}`);
  }
  return canonical;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : null;
}

async function resolveThroughExistingAncestor(input: string): Promise<string> {
  let cursor = resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(cursor), ...suffix.reverse());
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new FoundryIntegrityError("OUTPUT_ANCESTOR_MISSING", `Cannot resolve output directory: ${input}`);
    }
    suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
}

export async function assertDisjointOutput(sourceRoot: string, outputRoot: string): Promise<string> {
  const source = await canonicalBundleRoot(sourceRoot);
  const output = await resolveThroughExistingAncestor(outputRoot);
  if (isWithin(source, output) || isWithin(output, source)) {
    throw new FoundryIntegrityError(
      "OUTPUT_OVERLAPS_SOURCE",
      `Foundry evidence output must not contain or sit inside the source Twin bundle: ${output}`,
    );
  }
  return output;
}

export interface SafeBundleFile {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export async function listSafeBundleFiles(rootInput: string): Promise<readonly SafeBundleFile[]> {
  const root = await canonicalBundleRoot(rootInput);
  const files: SafeBundleFile[] = [];
  const caseFolded = new Map<string, string>();

  async function walk(directory: string, parentParts: readonly string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const parts = [...parentParts, entry.name];
      const relativePath = parts.join("/");
      assertSafeBundlePath(relativePath);
      const absolutePath = resolve(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        throw new FoundryIntegrityError("BUNDLE_SYMLINK", `Symbolic links are not accepted in Twin bundles: ${relativePath}`);
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        await walk(absolutePath, parts);
        continue;
      }
      if (!entry.isFile() || !metadata.isFile()) {
        throw new FoundryIntegrityError("BUNDLE_NON_REGULAR_ENTRY", `Twin bundle entries must be regular files: ${relativePath}`);
      }
      const canonicalParent = await realpath(directory);
      if (resolve(canonicalParent, entry.name) !== absolutePath || !isWithin(root, absolutePath)) {
        throw new FoundryIntegrityError("BUNDLE_PATH_ESCAPE", `Twin bundle path resolves outside its root: ${relativePath}`);
      }
      const folded = relativePath.toLocaleLowerCase("en-US");
      const collision = caseFolded.get(folded);
      if (collision !== undefined) {
        throw new FoundryIntegrityError(
          "BUNDLE_CASE_COLLISION",
          `Case-insensitive bundle path collision: ${collision} and ${relativePath}`,
        );
      }
      caseFolded.set(folded, relativePath);
      files.push({ absolutePath, relativePath });
    }
  }

  await walk(root, []);
  return files;
}
