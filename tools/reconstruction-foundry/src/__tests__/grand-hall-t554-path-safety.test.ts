import { describe, expect, it } from "vitest";

import { isSafeGrandHallT554RelativePath } from "../grand-hall-t554-path-safety.js";

describe("Grand Hall T-554 relative-path safety", () => {
  it("accepts a canonical mask path", () => {
    expect(isSafeGrandHallT554RelativePath("masks/sweep-001.png")).toBe(true);
  });

  it.each([
    ["bidirectional control", "masks/sweep-\u202e100.png"],
    ["C0 control", "masks/sweep-\u0001001.png"],
    ["unpaired surrogate", "masks/sweep-\ud800.png"],
  ])("rejects a path containing a %s", (_label, path) => {
    expect(isSafeGrandHallT554RelativePath(path)).toBe(false);
  });

  it.each([
    ["061C", "\u061c"],
    ["200E", "\u200e"],
    ["200F", "\u200f"],
    ["202A", "\u202a"],
    ["202B", "\u202b"],
    ["202C", "\u202c"],
    ["202D", "\u202d"],
    ["202E", "\u202e"],
    ["2066", "\u2066"],
    ["2067", "\u2067"],
    ["2068", "\u2068"],
    ["2069", "\u2069"],
  ])("rejects Unicode Bidi_Control U+%s", (_codePoint, control) => {
    expect(isSafeGrandHallT554RelativePath(`masks/sweep-${control}001.png`)).toBe(false);
  });

  it.each([
    "masks/COM¹",
    "masks/com².PNG",
    "LPT³.log",
    "masks/lPt¹.review.png",
  ])("rejects a Windows superscript device alias %s", (path) => {
    expect(isSafeGrandHallT554RelativePath(path)).toBe(false);
  });

  it.each([
    "masks/COM⁴.png",
    "masks/COM¹-copy.png",
    "masks/XCOM¹.png",
    "masks/LPT¹0.png",
    "masks/COM0.png",
  ])("accepts a non-device near-miss %s", (path) => {
    expect(isSafeGrandHallT554RelativePath(path)).toBe(true);
  });
});
