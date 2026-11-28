// ---------------------------------------------------------------------------
// The named one-line changes the spine links' mutation check runs
// (spine-link-mutants.ts), and the cases each must turn red. Each change is
// the exact text it replaces, found once in its file, and the text put in its
// place. The rule a change breaks is said in plain words; the cases are named
// by their titles in the suites below.
// ---------------------------------------------------------------------------

export const ERASURE = "src/services/people-erasure.ts";
export const ROUTE = "src/routes/enquiries.ts";
export const LINKS = "src/__tests__/people-erasure-spine-links-postgres.test.ts";
export const GUARD = "src/__tests__/enquiry-name-writers-guard.test.ts";

export type Source = typeof ERASURE | typeof ROUTE;
export type Suite = typeof LINKS | typeof GUARD;

export const CASES = {
  passWhateverPoints: { suite: LINKS, title: "the 24-month pass, removing a kept person's enquiry that never became a booking, renames the event the join made for it while it holds the name the join copied, whatever still points at it" },
  passTypedName: { suite: LINKS, title: "the 24-month pass leaves a name staff typed since on such an event something points at, and clears only the client name the join copied" },
  passTypedClient: { suite: LINKS, title: "the 24-month pass leaves a client name staff typed since on such an event something points at, and renames it" },
  passNothingPoints: { suite: LINKS, title: "the 24-month pass names an event the join made for a removed enquiry, that nothing points at, Event, whatever it holds" },
  passOwned: { suite: LINKS, title: "an event the join made that is a deal's or a client account's own is in use: the pass leaves its typed name" },
  passPhase: { suite: LINKS, title: "an event the join made whose phase something points at is in use: the pass leaves its typed name" },
  passDealProposal: { suite: LINKS, title: "the 24-month pass clears the client name the join copied onto events it made for the removed enquiry's deal and proposal, never their names" },
  passStillExists: { suite: LINKS, title: "the 24-month pass leaves an event the join made for an enquiry of theirs that still exists" },
  passJoinedOnly: { suite: LINKS, title: "the 24-month pass leaves an event the join only joined a removed enquiry to" },
  passOutOfReach: { suite: LINKS, title: "the 24-month pass leaves a same-named event the join made for an enquiry gone elsewhere, which the removed enquiry does not reach" },
  passPadded: { suite: LINKS, title: "the 24-month pass compares a name written with spaces around it as the join trimmed it" },
  passWentEarlier: { suite: LINKS, title: "the 24-month pass renames an event the join made for an enquiry of theirs that went earlier, when the enquiry it removes now points at it" },
  passNearDealProposal: { suite: LINKS, title: "the 24-month pass clears the client name the join copied onto events it made for a deal and a proposal another live person leads, made from the removed enquiry, never their names" },
  passUndone: { suite: LINKS, title: "the 24-month pass leaves an event whose made record is undone" },
  passOtherVenue: { suite: LINKS, title: "the 24-month pass leaves an event whose made record is another venue's" },
  editFollows: { suite: LINKS, title: "an edit of an enquiry's name carries the join's copy: the event made for it follows in name and client" },
  editTypedSince: { suite: LINKS, title: "an edit of an enquiry's name leaves a column of its event typed since" },
  editDealProposal: { suite: LINKS, title: "an edit of an enquiry's name carries the client name of the events the join made for its deal and its proposal, never their names" },
  editNotCopied: { suite: LINKS, title: "an edit to a name the join would not copy gives the event the join's own name and no client" },
  editUnchanged: { suite: LINKS, title: "an edit that does not change an enquiry's name touches none of its events" },
  editVenue: { suite: LINKS, title: "an edit of an enquiry's name touches no event of another venue, and none through a made row of another venue" },
  editInForce: { suite: LINKS, title: "an edit of an enquiry's name follows only made rows in force: not an undone one, nor one the join only joined" },
  editJoinFirst: { suite: LINKS, title: "the join holding the enquiry while an edit arrives: the edit waits for the join's commit, then the event the join made follows the new name" },
  editTwoEdits: { suite: LINKS, title: "two edits of an enquiry's name at once: the second reads the name the first wrote, under the enquiry's lock, and the event follows both" },
  editWholeWay: { suite: LINKS, title: "the whole way: the join names the event, staff rename the enquiry, and the 24-month pass removing it leaves the event neither name" },
  guardPlaces: { suite: GUARD, title: "places every write to the enquiries table in the production code" },
  guardFinds: { suite: GUARD, title: "finds the edit, which carries the copies, and the writers that cannot write the name" },
} as const satisfies Record<string, { readonly suite: Suite; readonly title: string }>;

export type CaseKey = keyof typeof CASES;

export interface Mutant {
  /** A plain description of the change. */
  readonly name: string;
  readonly file: Source;
  /** The exact text replaced, found once in the file. */
  readonly from: string;
  readonly to: string;
  /** The rule the change breaks, in plain words. */
  readonly rule: string;
  /** The cases that must each fail on an assertion under the change, all of one suite. */
  readonly cases: readonly CaseKey[];
}

export const MUTANTS: readonly Mutant[] = [
  // The 24-month pass's rename (unnameLeftEvents, pointedAtEvent, joinedNameOf).
  {
    name: "the rule for an event nothing points at, removed", file: ERASURE,
    from: 'const orphan = sql`(${forGoneEnquiry} and ${unused})`;', to: 'const orphan = sql`false`;',
    rule: "An event the join made for a removed enquiry that nothing points at, and no deal or account owns, is named Event and loses its client, whatever they hold.",
    cases: ["passNothingPoints"],
  },
  {
    name: "rows that point at the event itself, not counted", file: ERASURE,
    from: "return key.toEvent ? onEvent : onPhase;", to: "return key.toEvent ? sql`false` : onPhase;",
    rule: "A row with a key to the event makes it in use, so a name or client typed on it since stays.",
    cases: ["passTypedName", "passTypedClient"],
  },
  {
    name: "rows that point at one of the event's phases, not counted", file: ERASURE,
    from: "return key.toEvent ? onEvent : onPhase;", to: "return key.toEvent ? onEvent : sql`false`;",
    rule: "A row with a key to one of the event's phases makes it in use, so a name typed on it since stays.",
    cases: ["passPhase"],
  },
  {
    name: "the event's own deal, not counted", file: ERASURE,
    from: 'const ownsNothing = sql`"ev"."opportunity_id" is null and "ev"."client_account_id" is null`;',
    to: 'const ownsNothing = sql`"ev"."client_account_id" is null`;',
    rule: "An event a deal owns is in use, so a name typed on it since stays.",
    cases: ["passOwned"],
  },
  {
    name: "the event's own client account, not counted", file: ERASURE,
    from: 'const ownsNothing = sql`"ev"."opportunity_id" is null and "ev"."client_account_id" is null`;',
    to: 'const ownsNothing = sql`"ev"."opportunity_id" is null`;',
    rule: "An event a client account owns is in use, so a name typed on it since stays.",
    cases: ["passOwned"],
  },
  {
    name: "the name renamed only when nothing points at the event", file: ERASURE,
    from: 'const nameGoes = sql`(${orphan} or (${forGoneEnquiry} and ${holdsCopy(sql`"ev"."name"`)}))`;', to: "const nameGoes = orphan;",
    rule: "The pass renames an event made for a removed enquiry while its name is the join's copy, whatever points at it.",
    cases: ["passWhateverPoints", "passTypedClient", "passPadded"],
  },
  {
    name: "the client cleared only when nothing points at the event", file: ERASURE,
    from: 'const clientGoes = sql`(${orphan} or ((${forGoneEnquiry} or ${forItsDealOrProposal}) and ${holdsCopy(sql`"ev"."client_name"`)}))`;',
    to: "const clientGoes = orphan;",
    rule: "The pass clears a client name that is the join's copy of the removed enquiry's name, whatever points at the event.",
    cases: ["passWhateverPoints", "passTypedName", "passPadded", "passDealProposal"],
  },
  {
    name: "the client of the deal's and the proposal's events kept", file: ERASURE,
    from: '((${forGoneEnquiry} or ${forItsDealOrProposal}) and ${holdsCopy(sql`"ev"."client_name"`)})',
    to: '(${forGoneEnquiry} and ${holdsCopy(sql`"ev"."client_name"`)})',
    rule: "The pass clears the client name the join copied onto events it made for the removed enquiry's deal and proposal.",
    cases: ["passDealProposal"],
  },
  {
    name: "the name of the deal's and the proposal's events renamed too", file: ERASURE,
    from: '(${forGoneEnquiry} and ${holdsCopy(sql`"ev"."name"`)})',
    to: '((${forGoneEnquiry} or ${forItsDealOrProposal}) and ${holdsCopy(sql`"ev"."name"`)})',
    rule: "The pass never renames an event made for the removed enquiry's deal or proposal: its name is the deal's or the proposal's.",
    cases: ["passDealProposal"],
  },
  {
    name: "client name cleared whatever it holds", file: ERASURE,
    from: '"client_name" = case when ${clientGoes} then null else "ev"."client_name" end', to: '"client_name" = null',
    rule: "The pass clears a client name only when it is the join's copy, or nothing points at the event: a client name staff typed stays.",
    cases: ["passTypedClient"],
  },
  {
    name: "an event made for an enquiry that still exists, counted as gone", file: ERASURE,
    from: 'not exists (select 1 from "enquiries" as "gone" where "gone"."id" = "made"."subject_id")', to: "true",
    rule: "The pass leaves an event the join made for an enquiry that still exists.",
    cases: ["passStillExists"],
  },
  {
    name: "a record of a join that made no event, counted as made", file: ERASURE,
    from: 'and "made"."event_made" and "made"."undone_at" is null and ${subject})', to: 'and "made"."undone_at" is null and ${subject})',
    rule: "The pass renames only events the join made, never one it only joined an enquiry to.",
    cases: ["passJoinedOnly"],
  },
  {
    name: "an undone record, counted as in force", file: ERASURE,
    from: 'and "made"."event_made" and "made"."undone_at" is null and ${subject})', to: 'and "made"."event_made" and ${subject})',
    rule: "The pass reads only the join's records in force: an undone record is not the join's copy.",
    cases: ["passUndone"],
  },
  {
    name: "a record of another venue, counted", file: ERASURE,
    from: 'where "made"."event_id" = "ev"."id" and "made"."venue_id" = ${records.venueId}', to: 'where "made"."event_id" = "ev"."id"',
    rule: "The pass reads only the join's records of the removed enquiry's venue.",
    cases: ["passOtherVenue"],
  },
  {
    name: "events beyond the removed enquiry's reach, included", file: ERASURE,
    from: 'where "ev"."id" in (${sql.join(reached.map((id) => sql`${id}::uuid`), sql`, `)})', to: "where true",
    rule: "The pass changes only the events the removed person's records reach.",
    cases: ["passOutOfReach"],
  },
  {
    name: "the name compared untrimmed", file: ERASURE,
    from: "const trimmed = name.trim();", to: "const trimmed = name;",
    rule: "A name is compared as the join cut it: trimmed, at most 200 characters.",
    cases: ["passPadded"],
  },
  {
    name: "only the enquiries removed in this pass counted as gone", file: ERASURE,
    from: 'not exists (select 1 from "enquiries" as "gone" where "gone"."id" = "made"."subject_id")',
    to: '"made"."subject_id" in (${sql.join(removed.map((row) => sql`${row.id}::uuid`), sql`, `)})',
    rule: "An event the join made for an enquiry that went earlier counts as made for a gone enquiry.",
    cases: ["passWentEarlier"],
  },
  {
    name: "the nearby deals left out", file: ERASURE,
    from: 'among(sql`"made"."subject_id"`, [...records.dealIds, ...records.nearby.dealIds])', to: 'among(sql`"made"."subject_id"`, [...records.dealIds])',
    rule: "The pass clears the copied client name on the event of a deal made from the removed enquiry that another live person leads.",
    cases: ["passNearDealProposal"],
  },
  {
    name: "the nearby proposals left out", file: ERASURE,
    from: 'among(sql`"made"."subject_id"`, [...records.proposalIds, ...records.nearby.proposalIds])', to: 'among(sql`"made"."subject_id"`, [...records.proposalIds])',
    rule: "The pass clears the copied client name on the event of a proposal on a deal another live person leads, made from the removed enquiry.",
    cases: ["passNearDealProposal"],
  },
  // The edit (writeEnquiryEdit, followEnquiryName).
  {
    name: "the edit no longer carries the copies", file: ROUTE,
    from: "await followEnquiryName(tx, { enquiryId: row.id, venueId: row.venueId, from: held.name, to: row.name });", to: "",
    rule: "An edit of an enquiry's name carries the join's copies onto the events made from it.",
    cases: ["editFollows", "editTypedSince", "editDealProposal", "editNotCopied", "editJoinFirst", "editTwoEdits", "editWholeWay"],
  },
  {
    name: "the edit no longer carries the copies, read by the writers guard", file: ROUTE,
    from: "await followEnquiryName(tx, { enquiryId: row.id, venueId: row.venueId, from: held.name, to: row.name });", to: "",
    rule: "Every writer of an enquiry's name that the guard can read carries the join's copies.",
    cases: ["guardPlaces", "guardFinds"],
  },
  {
    name: "the old name read without the enquiry's lock", file: ROUTE,
    from: '.where(eq(enquiries.id, enquiryId)).for("no key update");', to: ".where(eq(enquiries.id, enquiryId));",
    rule: "The edit reads the name it replaces under the enquiry's lock, so a second edit reads the first one's name.",
    cases: ["editTwoEdits"],
  },
  {
    name: "an unchanged name followed too", file: ROUTE,
    from: "if (held !== undefined && row !== undefined && held.name !== row.name) {", to: "if (held !== undefined && row !== undefined) {",
    rule: "An edit that keeps the name writes no event.",
    cases: ["editUnchanged"],
  },
  {
    name: "events of another venue followed", file: ERASURE,
    from: 'where "ev"."venue_id" = ${input.venueId}', to: "where true",
    rule: "An edit changes only events of the enquiry's own venue.",
    cases: ["editVenue"],
  },
  {
    name: "records of another venue followed", file: ERASURE,
    from: 'const inForce = sql`"made"."event_id" = "ev"."id" and "made"."venue_id" = ${input.venueId}', to: 'const inForce = sql`"made"."event_id" = "ev"."id"',
    rule: "An edit follows only the join's records of the enquiry's own venue.",
    cases: ["editVenue"],
  },
  {
    name: "a record of a join that made no event, followed", file: ERASURE,
    from: '      and "made"."event_made" and "made"."undone_at" is null`;', to: '      and "made"."undone_at" is null`;',
    rule: "An edit follows only records where the join made the event.",
    cases: ["editInForce"],
  },
  {
    name: "an undone record, followed", file: ERASURE,
    from: '      and "made"."event_made" and "made"."undone_at" is null`;', to: '      and "made"."event_made"`;',
    rule: "An edit never follows a record that is undone.",
    cases: ["editInForce"],
  },
  {
    name: "another enquiry's events followed", file: ERASURE,
    from: "and \"made\".\"subject_kind\" = 'enquiry' and \"made\".\"subject_id\" = ${enquiryId})", to: "and \"made\".\"subject_kind\" = 'enquiry')",
    rule: "An edit follows only the events the join made for that enquiry, not those of another enquiry with the same name.",
    cases: ["editTypedSince"],
  },
  {
    name: "another enquiry's deals followed", file: ERASURE,
    from: '"made"."subject_id" in (select d."id" from "opportunities" as d where d."source_enquiry_id" = ${enquiryId})', to: "true",
    rule: "An edit carries the client name only onto events the join made for deals made from that enquiry.",
    cases: ["editDealProposal"],
  },
  {
    name: "another enquiry's proposals followed", file: ERASURE,
    from: '"made"."subject_id" in (select p."id" from "proposals" as p where p."enquiry_id" = ${enquiryId})', to: "true",
    rule: "An edit carries the client name only onto events the join made for that enquiry's proposals.",
    cases: ["editDealProposal"],
  },
  {
    name: "the name followed whatever it holds", file: ERASURE,
    from: 'const nameFollows = sql`(${forIt} and "ev"."name" = ${before})`;', to: "const nameFollows = forIt;",
    rule: "An edit renames an event only while its name is still the old name as the join wrote it.",
    cases: ["editTypedSince"],
  },
  {
    name: "the client followed whatever it holds", file: ERASURE,
    from: 'const clientFollows = sql`((${forIt} or ${forItsDealOrProposal}) and "ev"."client_name" = ${before})`;',
    to: "const clientFollows = sql`(${forIt} or ${forItsDealOrProposal})`;",
    rule: "An edit changes a client name only while it is still the old name as the join wrote it.",
    cases: ["editTypedSince"],
  },
  {
    name: "the client of the deal's and the proposal's events not followed", file: ERASURE,
    from: 'const clientFollows = sql`((${forIt} or ${forItsDealOrProposal}) and "ev"."client_name" = ${before})`;',
    to: 'const clientFollows = sql`(${forIt} and "ev"."client_name" = ${before})`;',
    rule: "An edit carries the client name of the events the join made for the enquiry's deal and proposal.",
    cases: ["editDealProposal"],
  },
  {
    name: "the name of the deal's and the proposal's events followed too", file: ERASURE,
    from: 'const nameFollows = sql`(${forIt} and "ev"."name" = ${before})`;',
    to: 'const nameFollows = sql`((${forIt} or ${forItsDealOrProposal}) and "ev"."name" = ${before})`;',
    rule: "An edit never renames an event made for the enquiry's deal or proposal.",
    cases: ["editDealProposal"],
  },
  {
    name: "the new name written as given", file: ERASURE,
    from: "const [after] = joinedNameOf(input.to);", to: "const after = sql`${input.to}`;",
    rule: "An edit writes the new name as the join would: trimmed and cut, or Event and no client when the join would copy none.",
    cases: ["editNotCopied"],
  },
];

/** Rules proven elsewhere, not by a change here: said under the table. */
export const PROVEN_ELSEWHERE: readonly string[] = [
  "The edit runs in one transaction: writeEnquiryEdit takes only a transaction, so a call outside db.transaction fails the typecheck.",
];
