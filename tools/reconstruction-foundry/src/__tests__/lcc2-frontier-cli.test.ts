import { describe, expect, it } from "vitest";
import { parseLcc2FrontierArguments } from "../lcc2-frontier-cli.js";

describe("LCC2 frontier CLI arguments", () => {
  it("accepts one explicit manifest and environment decision", () => {
    expect(parseLcc2FrontierArguments([
      "--manifest",
      "C:\\captures\\room.lcc2",
      "--environment",
      "exclude",
    ])).toEqual({
      manifestPath: "C:\\captures\\room.lcc2",
      environmentPolicy: "exclude",
    });
    expect(parseLcc2FrontierArguments(["--help"])).toBeNull();
  });

  it.each([
    [[], /both --manifest and --environment are required/iu],
    [["--manifest", "scene.lcc2"], /both --manifest and --environment are required/iu],
    [["--environment", "automatic"], /must be exactly include or exclude/iu],
    [["--unknown"], /unknown or incomplete argument/iu],
    [["--manifest", "a", "--manifest", "b", "--environment", "exclude"], /only once/iu],
  ])("rejects an incomplete or ambiguous invocation %#", (arguments_, expected) => {
    expect(() => parseLcc2FrontierArguments(arguments_)).toThrow(expected);
  });
});
