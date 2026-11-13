import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readBuildTimestamp } from "../lib/build-stamp.js";

// builtAt in /health/version sat at 24 September beside current commits because
// it came from a hand-set service variable. These pin that the image's own
// stamp file wins over the variable, and that the older sources still answer
// where no file exists.

describe("readBuildTimestamp", () => {
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "build-stamp-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports the image's stamp file over a stale BUILD_TIMESTAMP variable", () => {
    const file = join(dir, "stamped");
    writeFileSync(file, "2026-10-19T21:00:00Z\n");
    expect(readBuildTimestamp({ BUILD_STAMP_FILE: file, BUILD_TIMESTAMP: "2026-09-24T08:00:00Z" }))
      .toBe("2026-10-19T21:00:00Z");
  });

  it("falls back to BUILD_TIMESTAMP when the image carries no stamp file", () => {
    expect(readBuildTimestamp({ BUILD_STAMP_FILE: join(dir, "absent"), BUILD_TIMESTAMP: "2026-01-01T00:00:00Z" }))
      .toBe("2026-01-01T00:00:00Z");
  });

  it("falls back to dev when nothing is stamped", () => {
    expect(readBuildTimestamp({ BUILD_STAMP_FILE: join(dir, "absent") })).toBe("dev");
  });

  it("reads each stamp file once: it cannot change while the process runs", () => {
    const file = join(dir, "once");
    writeFileSync(file, "2026-10-19T21:00:00Z\n");
    expect(readBuildTimestamp({ BUILD_STAMP_FILE: file })).toBe("2026-10-19T21:00:00Z");
    writeFileSync(file, "2026-10-20T09:00:00Z\n");
    expect(readBuildTimestamp({ BUILD_STAMP_FILE: file })).toBe("2026-10-19T21:00:00Z");
  });

  it("ignores a stamp file that is empty or not a date", () => {
    const empty = join(dir, "empty");
    const junk = join(dir, "junk");
    writeFileSync(empty, "\n");
    writeFileSync(junk, "not a time");
    expect(readBuildTimestamp({ BUILD_STAMP_FILE: empty, BUILD_TIMESTAMP: "2026-01-01T00:00:00Z" }))
      .toBe("2026-01-01T00:00:00Z");
    expect(readBuildTimestamp({ BUILD_STAMP_FILE: junk })).toBe("dev");
  });
});
