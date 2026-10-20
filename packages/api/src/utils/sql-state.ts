// ---------------------------------------------------------------------------
// What a database error says about itself, safely: its SQLSTATE, never its
// message (drizzle builds that from the query's parameters, which can hold a
// guest's name or email).
// ---------------------------------------------------------------------------

/** A SQLSTATE (five digits or capitals) on a value, or null. */
function codeOn(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("code" in value)) return null;
  const code = value.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? code : null;
}

/**
 * The SQLSTATE of a database error: on the error itself (the driver's), or on
 * its cause (drizzle wraps the driver's error); null when there is none.
 */
export function sqlStateOf(error: unknown): string | null {
  return codeOn(error) ?? (error instanceof Error ? codeOn(error.cause) : null);
}

/** The lock conflicts PostgreSQL ends by rolling one transaction back whole:
 *  a deadlock, or a serialisation failure. The same write may then succeed. */
export type LockConflictCode = "40P01" | "40001";

/** The lock conflict an error is, or null for any other error. */
export function lockConflictOf(error: unknown): LockConflictCode | null {
  const code = sqlStateOf(error);
  return code === "40P01" || code === "40001" ? code : null;
}

/** The answer to a write PostgreSQL rolled back for a lock conflict (409). */
export const RETRY_ANSWER = {
  error: "Someone else changed this at the same moment. Please try again.",
  code: "RETRY",
} as const;
