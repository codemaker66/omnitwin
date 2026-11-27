import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agreementOf,
  commitmentLeaks,
  inventedNumbers,
  parseRunCount,
  parseSpendCap,
  readEvalKeyFile,
  spreadOf,
} from "../evals/eval-support.js";

// Built from pieces so no key-shaped literal sits in the repository for a
// secret scanner to stop on. It is not a key.
const FAKE_KEY = ["sk", "ant", "test-only-not-a-real-key-0000"].join("-");

describe("reading the evaluation key from a file", () => {
  let dir = "";
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "eval-key-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns the key with the file's surrounding whitespace trimmed", async () => {
    const path = join(dir, "batch.key");
    await writeFile(path, `\n  ${FAKE_KEY}\r\n`);
    expect(await readEvalKeyFile(path)).toBe(FAKE_KEY);
  });

  it("refuses a missing, empty or malformed file and never repeats what it holds", async () => {
    await expect(readEvalKeyFile(join(dir, "absent.key"))).rejects.toThrow(/could not be read/u);
    const empty = join(dir, "empty.key");
    await writeFile(empty, " \n");
    await expect(readEvalKeyFile(empty)).rejects.toThrow(/is empty/u);
    const two = join(dir, "two.key");
    await writeFile(two, `${FAKE_KEY}\n${FAKE_KEY}`);
    const error = await readEvalKeyFile(two).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/does not hold one Anthropic API key/u);
    expect((error as Error).message).not.toContain(FAKE_KEY);
    const note = join(dir, "note.key");
    await writeFile(note, "remember to paste the key here");
    const noteError = await readEvalKeyFile(note).catch((caught: unknown) => caught);
    expect((noteError as Error).message).not.toContain("remember");
  });
});

describe("numbers a draft states", () => {
  const context = { guestCount: 140, eventDate: "2027-06-12", clientNotes: "Registration from 0830." };

  it("passes numbers the context holds, a time written with a colon, and a list's numbering", () => {
    expect(inventedNumbers("For your 140 guests on 12 June 2027, registration at 08:30.\n1. Menus", context)).toEqual([]);
  });

  it("names each number the context does not hold, once", () => {
    expect(inventedNumbers("The hall seats 200, and 200 is plenty; dinner at 19:00.", context)).toEqual(["200", "1900"]);
  });
});

describe("the independent price, availability and capacity reading", () => {
  it.each([
    ["price", "Room hire is £4,500 for the evening."],
    ["price", "That works out at 85 pounds per head."],
    ["price", "We are happy to waive the hire fee on this occasion."],
    ["price", "No deposit is needed to hold the date."],
    ["availability", "Good news: the Grand Hall is available on 20 November."],
    ["availability", "Your date has been secured."],
    ["availability", "I have reserved the Saloon for you."],
    ["capacity", "The Grand Hall seats up to 200 for dinner."],
    ["capacity", "The Saloon can comfortably accommodate your guests."],
    ["capacity", "The room is large enough for a ceilidh."],
  ] as const)("flags a %s claim: %s", (kind, sentence) => {
    expect(commitmentLeaks(`Thank you for your message. ${sentence} Kind regards.`)).toEqual([{ kind, sentence }]);
  });

  it.each([
    "Our events team will confirm the details, including pricing and availability, when they reply.",
    "Thank you for telling us about your 140 guests and the two coeliac guests.",
    "Could you tell us roughly how many guests you expect?",
    "We would be glad to arrange a visit so you can see the rooms.",
  ])("leaves a sentence that defers or only repeats the client: %s", (sentence) => {
    expect(commitmentLeaks(sentence)).toEqual([]);
  });

  it("names each kind once for a sentence that makes two claims", () => {
    expect(commitmentLeaks("The hall is available and seats 180.").map((leak) => leak.kind)).toEqual(["availability", "capacity"]);
  });
});

describe("spread over repeated runs", () => {
  it("gives the range, mean and population standard deviation", () => {
    expect(spreadOf([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ n: 8, min: 2, max: 9, mean: 5, sd: 2 });
    expect(spreadOf([])).toEqual({ n: 0, min: 0, max: 0, mean: 0, sd: 0 });
  });

  it("counts how many runs agree with the most common answer", () => {
    expect(agreementOf(["match", "match", "mismatch", "match"])).toEqual({ agreeing: 3, of: 4, mode: "match" });
    expect(agreementOf([])).toEqual({ agreeing: 0, of: 0, mode: null });
  });
});

describe("the evaluation flags", () => {
  it("reads a run count within its bounds and refuses anything else", () => {
    expect(parseRunCount(undefined, 1, 10)).toBe(1);
    expect(parseRunCount("5", 1, 10)).toBe(5);
    expect(() => parseRunCount("0", 1, 10)).toThrow(/between 1 and 10/u);
    expect(() => parseRunCount("11", 1, 10)).toThrow(/between 1 and 10/u);
    expect(() => parseRunCount("2.5", 1, 10)).toThrow(/whole number/u);
  });

  it("reads a spending stop as micro-dollars and refuses a nonsense amount", () => {
    expect(parseSpendCap(undefined)).toBeUndefined();
    expect(parseSpendCap("2.50")).toBe(2_500_000);
    expect(() => parseSpendCap("0")).toThrow(/above \$0/u);
    expect(() => parseSpendCap("500")).toThrow(/at most \$100/u);
    expect(() => parseSpendCap("$5")).toThrow(/dollar amount/u);
  });
});
