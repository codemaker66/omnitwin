import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  readBoundedHistoricalRuntimeMember,
  tryAcquireHistoricalRuntimeTransfer,
} from "../routes/historical-runtime-members.js";

describe("historical runtime member transfer bounds", () => {
  it("admits at most four response-buffered transfers and releases idempotently", () => {
    const releases: (() => void)[] = [];
    try {
      for (let index = 0; index < 4; index += 1) {
        const release = tryAcquireHistoricalRuntimeTransfer();
        expect(release).not.toBeNull();
        if (release !== null) releases.push(release);
      }
      expect(tryAcquireHistoricalRuntimeTransfer()).toBeNull();

      const first = releases.shift();
      expect(first).toBeDefined();
      first?.();
      first?.();
      const replacement = tryAcquireHistoricalRuntimeTransfer();
      expect(replacement).not.toBeNull();
      if (replacement !== null) releases.push(replacement);
    } finally {
      for (const release of releases) release();
    }
  });

  it("returns only an exact bounded body", async () => {
    const signal = new AbortController().signal;
    const bytes = await readBoundedHistoricalRuntimeMember(
      Readable.from([Buffer.from("exact")]),
      5,
      signal,
    );
    expect(bytes.toString("utf8")).toBe("exact");

    await expect(readBoundedHistoricalRuntimeMember(
      Readable.from([Buffer.from("short")]),
      6,
      signal,
    )).rejects.toThrow("did not match its exact size");
  });

  it("destroys an in-flight body when the browser/upstream signal aborts", async () => {
    const controller = new AbortController();
    const body = new PassThrough();
    const reading = readBoundedHistoricalRuntimeMember(body, 4, controller.signal);
    body.write(Buffer.from([1]));
    controller.abort(new DOMException("scrubbed away", "AbortError"));

    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(body.destroyed).toBe(true);
  });
});
