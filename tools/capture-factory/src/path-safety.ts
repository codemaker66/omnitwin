import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function errorCode(error: unknown): unknown {
  if (error !== null && typeof error === "object" && "code" in error) {
    return error.code;
  }
  return undefined;
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(comparable(parent), comparable(candidate));
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== ".." && !isAbsolute(pathFromParent))
  );
}

async function resolveThroughExistingAncestor(input: string): Promise<string> {
  let cursor = resolve(input);
  const suffix: string[] = [];
  let parent = dirname(cursor);
  while (parent !== cursor) {
    try {
      const existing = await realpath(cursor);
      return resolve(existing, ...suffix.reverse());
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") {
        throw new Error(`Cannot resolve destination path ${input}`, { cause: error });
      }
    }
    suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
    parent = dirname(cursor);
  }
  try {
    const existingRoot = await realpath(cursor);
    return resolve(existingRoot, ...suffix.reverse());
  } catch (error: unknown) {
    throw new Error(`Cannot find an existing ancestor for destination ${input}`, { cause: error });
  }
}

export async function canonicalSourceRoot(input: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(resolve(input));
  } catch (error: unknown) {
    throw new Error(`Cannot resolve capture source ${input}`, { cause: error });
  }
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error(`Capture source is not a directory: ${canonical}`);
  }
  return canonical;
}

export async function assertDisjointDestination(
  sourceRoot: string,
  destination: string,
): Promise<string> {
  const resolvedDestination = await resolveThroughExistingAncestor(destination);
  if (isWithin(sourceRoot, resolvedDestination)) {
    throw new Error(`Destination must not be inside capture source: ${resolvedDestination}`);
  }
  if (isWithin(resolvedDestination, sourceRoot)) {
    throw new Error(`Destination must not contain capture source: ${resolvedDestination}`);
  }
  return resolvedDestination;
}

export function resolveContainedPath(root: string, relativePath: string): string {
  const parts = relativePath.split("/");
  if (
    relativePath === "" ||
    relativePath.includes("\\") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe relative path: ${relativePath}`);
  }
  const candidate = resolve(root, ...parts);
  if (!isWithin(root, candidate) || candidate === root) {
    throw new Error(`Path escapes root ${root}: ${relativePath}`);
  }
  return candidate;
}

export async function assertRegularNonLink(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Symbolic links are not accepted as capture evidence: ${path}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Capture evidence must be a regular file: ${path}`);
  }
}

export function toCanonicalRelativePath(parts: readonly string[]): string {
  return parts.join("/");
}

export function childPath(root: string, parts: readonly string[]): string {
  return join(root, ...parts);
}
