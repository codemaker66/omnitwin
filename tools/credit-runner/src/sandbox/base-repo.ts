import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { git } from "../git.js";
import { describeError } from "../task.js";

/**
 * Runs `use` in a throwaway repository holding one commit of `repoUrl`,
 * fetched by its sha through a named remote with `--filter=blob:none --depth 1`.
 * The commit and its trees arrive at once (a few hundred KB for this
 * repository) and git fetches a blob only when a command reads it. Nothing is
 * written to any other checkout. The folder is removed afterwards; a failure to
 * remove it is logged and never replaces `use`'s result.
 */
export async function withBaseCommit<T>(
  repoUrl: string,
  sha: string,
  use: (repo: string, scratch: string) => Promise<T>,
  log: (line: string) => void = () => undefined,
  /** Test seam. */
  remove: (folder: string) => Promise<void> = (folder) => rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
): Promise<T> {
  const scratch = await mkdtemp(path.join(tmpdir(), "credit-runner-base-"));
  try {
    const repo = path.join(scratch, "repo");
    await git(scratch, ["init", "--quiet", repo]);
    await git(repo, ["remote", "add", "origin", repoUrl]);
    await git(repo, ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--filter=blob:none", "--depth", "1", "origin", sha]);
    return await use(repo, scratch);
  } finally {
    await remove(scratch).catch((error: unknown) => {
      log(`Could not remove a throwaway repository (${describeError(error)}).`);
    });
  }
}

/** The commit `refs/heads/master` points at, read with `git ls-remote`: no repository is needed and nothing is written. */
export async function remoteMasterSha(repoUrl: string): Promise<string> {
  const listing = await git(tmpdir(), ["ls-remote", repoUrl, "refs/heads/master"]);
  const sha = listing.split(/\s+/u)[0] ?? "";
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error("could not read master's commit from the repository");
  return sha;
}
