import { describe, expect, it } from "vitest";
import { DietaryMemoryWriteError, guardDietaryMemoryWrite } from "../services/dietary-memory.js";

// ---------------------------------------------------------------------------
// A remembered allergy note never reaches a log line or an error report
// through a failed write. PostgreSQL describes the failing row in a check or
// not-null violation ("Failing row contains (...)"), and Drizzle repeats the
// query's parameters in its own error; either could carry the note. The
// store copies the note inside the database (so it is never a parameter) and
// every write goes through guardDietaryMemoryWrite, which keeps the SQLSTATE
// only. The happy paths and the database's own constraints are proven in
// remembered-dietary-notes-postgres.
// ---------------------------------------------------------------------------

const NOTE = "Two guests: sesame, severe";

function databaseError(): Error {
  const pgError = Object.assign(new Error('new row for relation "remembered_dietary_notes" violates check constraint'), {
    code: "23514",
    detail: `Failing row contains (1, 2, 3, ${NOTE}, wording).`,
  });
  return Object.assign(new Error(`Failed query: insert into remembered_dietary_notes\nparams: ${NOTE}`), { cause: pgError });
}

function everythingIn(error: DietaryMemoryWriteError): string {
  const own = Object.fromEntries(Object.getOwnPropertyNames(error).map((key) => [key, String(Reflect.get(error, key))]));
  return JSON.stringify(own);
}

describe("a failed write to the remembered notes", () => {
  it("keeps the SQLSTATE and nothing the database said about the row", () => {
    const error = new DietaryMemoryWriteError(databaseError());
    expect(error.message).toBe("Remembered dietary note write failed (SQLSTATE 23514)");
    expect(error.sqlState).toBe("23514");
    expect("cause" in error).toBe(false);
    expect(everythingIn(error)).not.toContain("sesame");
  });

  it("says so plainly when the failure carries no SQLSTATE", () => {
    expect(new DietaryMemoryWriteError(new Error(NOTE)).message).toBe("Remembered dietary note write failed");
  });

  it("comes back from every guarded write in place of the database's own error", async () => {
    const attempt = guardDietaryMemoryWrite(() => Promise.reject(databaseError()));
    await expect(attempt).rejects.toBeInstanceOf(DietaryMemoryWriteError);
    await expect(attempt).rejects.toThrow(/^Remembered dietary note write failed \(SQLSTATE 23514\)$/u);
    await expect(guardDietaryMemoryWrite(() => Promise.resolve(7))).resolves.toBe(7);
  });
});
