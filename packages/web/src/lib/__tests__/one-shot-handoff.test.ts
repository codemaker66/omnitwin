import { describe, expect, it } from "vitest";
import { createOneShotHandoff } from "../one-shot-handoff.js";

describe("createOneShotHandoff", () => {
  it("gives the offered value to the next take for the same key, once", () => {
    const handoff = createOneShotHandoff<string>(1_000, () => 0);
    handoff.offer("a", "value");
    expect(handoff.take("a")).toBe("value");
    expect(handoff.take("a")).toBeNull();
  });

  it("discards the value when the next take names another key", () => {
    const handoff = createOneShotHandoff<string>(1_000, () => 0);
    handoff.offer("a", "value");
    expect(handoff.take("b")).toBeNull();
    expect(handoff.take("a")).toBeNull();
  });

  it("keeps only the latest offer", () => {
    const handoff = createOneShotHandoff<string>(1_000, () => 0);
    handoff.offer("a", "first");
    handoff.offer("b", "second");
    expect(handoff.take("a")).toBeNull();
    handoff.offer("a", "third");
    expect(handoff.take("a")).toBe("third");
  });

  it("expires after the age limit", () => {
    let now = 0;
    const handoff = createOneShotHandoff<string>(1_000, () => now);
    handoff.offer("a", "value");
    now = 1_000;
    expect(handoff.take("a")).toBe("value");
    handoff.offer("a", "value");
    now = 2_001;
    expect(handoff.take("a")).toBeNull();
  });

  it("can be cleared", () => {
    const handoff = createOneShotHandoff<string>(1_000, () => 0);
    handoff.offer("a", "value");
    handoff.clear();
    expect(handoff.take("a")).toBeNull();
  });
});
