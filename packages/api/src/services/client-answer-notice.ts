// ---------------------------------------------------------------------------
// What the venue team is told when a client answers a proposal (roadmap X1).
//
// The notice used to read "Client approved proposal" over "Client approved the
// proposal.", which left a booker to find out which proposal, which version
// and who. It now says who answered, what they did and to which proposal, and
// under it the version they answered and their own words. It opens that
// proposal on the Proposals desk.
//
// The name is the one given on the client's page, as given: the link reaches
// whoever it is forwarded to, so nothing here claims more than that.
// ---------------------------------------------------------------------------

export type ClientAnswerAct = "accepted" | "changes" | "comment";

export interface ClientAnswerNoticeInput {
  readonly act: ClientAnswerAct;
  readonly proposalTitle: string;
  /** The version the client answered; null for one answered before any was saved. */
  readonly version: number | null;
  /** The name given on the page, if any. */
  readonly name: string | null | undefined;
  /** What the client wrote, if anything. */
  readonly words: string | null | undefined;
}

export interface ClientAnswerNotice {
  /** At most 180 characters: the change feed's and the notification's limit. */
  readonly title: string;
  /** At most 800 characters. */
  readonly summary: string;
  /** At most 160 characters: the change feed's actor limit. */
  readonly actorLabel: string;
}

const ACT_WORDS: Readonly<Record<ClientAnswerAct, string>> = {
  accepted: "accepted",
  changes: "asked for changes to",
  comment: "wrote about",
};

/** Trimmed to a limit, with an ellipsis where it was cut. */
function clipped(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function clientAnswerNotice(input: ClientAnswerNoticeInput): ClientAnswerNotice {
  const name = input.name?.trim() ?? "";
  const who = name === "" ? "The client" : clipped(name, 80);
  const words = input.words?.trim() ?? "";
  const parts = [
    input.version === null ? null : `Version ${String(input.version)}.`,
    words === "" ? null : `“${clipped(words, 700)}”`,
  ].filter((part): part is string => part !== null);
  return {
    title: clipped(`${who} ${ACT_WORDS[input.act]} ${input.proposalTitle.trim()}`, 180),
    summary: parts.length === 0 ? "Answered on the client's page." : parts.join(" "),
    actorLabel: name === "" ? "Client" : clipped(name, 160),
  };
}

/** Where a notice about a proposal takes the venue team: the proposal, open on
 *  the Proposals desk. */
export function proposalDeskPath(proposalId: string): string {
  return `/dashboard?view=proposals&proposal=${encodeURIComponent(proposalId)}`;
}
