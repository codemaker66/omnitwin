import { describe, expect, it } from "vitest";

import {
  GrandHallT554StrictJsonError,
  parseGrandHallT554StrictJson,
} from "../grand-hall-t554-strict-json.js";

describe("Grand Hall T-554 strict JSON", () => {
  it("preserves valid nested JSON semantics", () => {
    const value = parseGrandHallT554StrictJson(
      Buffer.from('{"scope":{"accepted":false},"rows":[1,null,"two"]}', "utf8"),
    );

    expect(value).toEqual({
      scope: { accepted: false },
      rows: [1, null, "two"],
    });
  });

  it("rejects duplicate authority keys even when one spelling uses an escape", () => {
    const bytes = Buffer.from(
      String.raw`{"authority":"none","\u0061uthority":"human_accepted"}`,
      "utf8",
    );

    expect(() => parseGrandHallT554StrictJson(bytes)).toThrowError(
      GrandHallT554StrictJsonError,
    );
    expect(() => parseGrandHallT554StrictJson(bytes)).toThrowError(
      /Duplicate JSON object key "authority"/u,
    );
  });

  it.each([
    String.raw`{"__proto__":null}`,
    String.raw`{"constr\u0075ctor":null}`,
    String.raw`{"prototype":null}`,
  ])("rejects prohibited object keys", (text) => {
    expect(() => parseGrandHallT554StrictJson(Buffer.from(text, "utf8")))
      .toThrowError(/Prohibited JSON object key/u);
  });
});
