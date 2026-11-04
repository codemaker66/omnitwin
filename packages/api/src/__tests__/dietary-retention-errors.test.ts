import { drizzle } from "drizzle-orm/neon-serverless";
import { describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { DietaryRetentionError, removeLapsedDietaryNotes } from "../services/dietary-retention.js";

// The retention pass runs nightly in a job whose log is public with the
// repository, and a database error can quote the failing row, note and all
// ("Failing row contains (…)"). Whatever fails in the pass, reading or
// writing, comes back as a DietaryRetentionError that carries the SQLSTATE
// and nothing else.

const NOTE = "Table 4: two guests, sesame and shellfish";

function databaseError(code?: string): Error {
  const error = new Error(`new row for relation "configurations" violates check constraint; Failing row contains (${NOTE})`);
  return code === undefined ? error : Object.assign(error, { code, detail: `Failing row contains (${NOTE})` });
}

/** A query chain that resolves to `rows` however it is finished. */
function chain(rows: readonly unknown[]): unknown {
  const link: Record<string, unknown> = {};
  for (const step of ["from", "where", "set", "returning"]) link[step] = (): unknown => link;
  link["then"] = (resolve: (value: readonly unknown[]) => unknown): unknown => resolve(rows);
  return link;
}

/** A database whose reads fail with `error`. */
function readFails(error: Error): Database {
  return Object.assign(drizzle.mock({ schema }), { select: (): never => { throw error; } });
}

/** A database that finds one lapsed layout, then fails to clear its note.
 *  Its pieces hold no notes, so the piece-note pass (one transaction per
 *  layout) finds nothing and the allergy note's write is the one that fails. */
function writeFails(error: Error): Database {
  return Object.assign(drizzle.mock({ schema }), {
    select: () => chain([{ id: "00000000-0000-4000-8000-000000000001" }]),
    update: (): never => { throw error; },
    transaction: (run: (tx: { select: () => unknown }) => unknown) => Promise.resolve(run({ select: () => chain([]) })),
  });
}

async function failureOf(db: Database): Promise<InstanceType<typeof DietaryRetentionError>> {
  const failure = await removeLapsedDietaryNotes(db).then(
    () => { throw new Error("the pass should have failed"); },
    (error: unknown) => error,
  );
  if (!(failure instanceof DietaryRetentionError)) throw new Error("not a DietaryRetentionError");
  return failure;
}

function expectNoNote(failure: Error): void {
  expect(failure.cause).toBeUndefined();
  const everythingLogged = [failure.message, failure.stack ?? "", JSON.stringify(failure)].join("\n");
  expect(everythingLogged).not.toMatch(/sesame|shellfish/u);
}

describe("removeLapsedDietaryNotes keeps the note out of its errors", () => {
  it("when finding the lapsed layouts fails", async () => {
    const failure = await failureOf(readFails(databaseError("57014")));
    expect(failure.sqlState).toBe("57014");
    expect(failure.message).toBe("Allergy note retention pass failed (SQLSTATE 57014)");
    expectNoNote(failure);
  });

  it("when clearing a note fails", async () => {
    const failure = await failureOf(writeFails(databaseError("23514")));
    expect(failure.sqlState).toBe("23514");
    expectNoNote(failure);
  });

  it("when the failure has no SQLSTATE at all", async () => {
    const failure = await failureOf(readFails(databaseError()));
    expect(failure.sqlState).toBeNull();
    expect(failure.message).toBe("Allergy note retention pass failed");
    expectNoNote(failure);
  });
});
