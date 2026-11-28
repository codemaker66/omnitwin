import { git } from "../git.js";
import { nightRulesFromAgentsMd } from "../project-rules.js";
import { remoteMasterSha, withBaseCommit } from "./base-repo.js";
import { REPO_URL } from "./brief.js";

/**
 * The base every run starts from, and AGENTS.md at that commit.
 *
 * Nothing is written to the checkout the CLI is run from: not FETCH_HEAD, not a
 * remote-tracking ref, not its object store. The commit is looked up with
 * `git ls-remote` and fetched, trees only, into a throwaway repository; git
 * then fetches the one blob it reads (AGENTS.md).
 */
export async function masterFacts(repoUrl: string = REPO_URL, log?: (line: string) => void): Promise<{ baseSha: string; projectRules: string }> {
  const baseSha = await remoteMasterSha(repoUrl);
  const agentsMd = await withBaseCommit(repoUrl, baseSha, (repo) => git(repo, ["show", `${baseSha}:AGENTS.md`]), log);
  return { baseSha, projectRules: nightRulesFromAgentsMd(agentsMd) };
}
