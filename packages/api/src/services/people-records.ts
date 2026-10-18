import { and, isNull, type SQL } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { clientAccounts, contacts } from "../db/schema.js";

// ---------------------------------------------------------------------------
// The People Book's records (T-665): the shared connection types and the
// "live" predicates every People Book query uses.
//
// A person is live while it is neither deleted, merged nor erased; a merged
// person is a tombstone (merged_into_id and deleted_at set together) and is
// never deleted. An organisation is live while it is neither deleted nor
// merged.
// ---------------------------------------------------------------------------

/** A transaction on the People Book's database. */
export type PeopleTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The database itself or a transaction on it. */
export type PeopleConn = Database | PeopleTx;

/** A live person, on the unaliased `contacts` table. */
export function liveContact(): SQL {
  const live = and(isNull(contacts.deletedAt), isNull(contacts.mergedIntoId), isNull(contacts.erasedAt));
  if (live === undefined) throw new Error("The live person predicate is empty");
  return live;
}

/** A live organisation or household, on the unaliased `client_accounts` table. */
export function liveAccount(): SQL {
  const live = and(isNull(clientAccounts.deletedAt), isNull(clientAccounts.mergedIntoId));
  if (live === undefined) throw new Error("The live organisation predicate is empty");
  return live;
}
