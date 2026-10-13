import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { closedLoopSegments } from "../loop-segments.js";

// Resolved from the package, like the other source guards (the test DOM's
// module URLs are not file URLs).
const COMPONENTS = resolve("src/components");

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.(tsx?|ts)$/u.test(name) ? [path] : [];
  });
}

describe("closedLoopSegments", () => {
  it("joins every point to the next and the last back to the first", () => {
    const square = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
    expect([...closedLoopSegments(square)]).toEqual([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 0, 1,
      1, 0, 1, 0, 0, 1,
      0, 0, 1, 0, 0, 0,
    ]);
  });

  it("returns nothing for no points", () => {
    expect(closedLoopSegments(new Float32Array(0))).toHaveLength(0);
  });

  it("is what components draw closed outlines with: the native renderer skips LineLoop", () => {
    const offenders = sources(COMPONENTS).filter((path) => /<lineLoop\b|new LineLoop\(/u.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
