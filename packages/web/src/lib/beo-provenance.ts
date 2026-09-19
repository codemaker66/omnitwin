// ---------------------------------------------------------------------------
// Split the compiler's provenance lines out of the BEO body.
//
// `ops-compiler.ts` writes the internal BEO as plain prose with a few
// provenance lines mixed in — a snapshot hash, a compiler digest. Both are
// real and worth keeping: they are how anyone proves which approved snapshot
// a handoff came from. But a 64-character hex digest printed in the middle of
// the page a hallkeeper prints is developer vocabulary on a user-facing
// surface, and it pushes the sentences that matter further down.
//
// So the wording stays in the block and the digests fold into a provenance
// note the reader can open. Nothing is removed, and the compiler's own output
// is untouched — the supplier portal reads it.
//
// Deliberately conservative: a line is provenance only when it carries a long
// hex run. A prose line that merely mentions a snapshot stays in the body.
// ---------------------------------------------------------------------------

/** 32+ hex characters — a digest, never a word a hallkeeper would read. */
const DIGEST = /\b[0-9a-f]{32,}\b/iu;

export interface BeoProvenanceSplit {
  /** The BEO as a hallkeeper should read it. */
  readonly body: string;
  /** The provenance lines, in the order the compiler wrote them. */
  readonly provenance: readonly string[];
}

export function splitBeoProvenance(raw: string): BeoProvenanceSplit {
  const lines = raw.split("\n");
  const body: string[] = [];
  const provenance: string[] = [];

  for (const line of lines) {
    if (DIGEST.test(line)) provenance.push(line.trim());
    else body.push(line);
  }

  // Collapse the blank lines a removed provenance line would leave behind, so
  // the prose does not end up with a gap where a hash used to be.
  const tidied = body
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return { body: tidied, provenance };
}
