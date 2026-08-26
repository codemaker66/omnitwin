import { beforeEach, describe, expect, it } from "vitest";
import { useArrivalStore } from "../arrival-store.js";

const s = () => useArrivalStore.getState();

describe("arrival phase machine", () => {
  beforeEach(() => {
    s().reset();
  });

  it("boots in loading and flies once tiles are ready", () => {
    expect(s().phase).toBe("loading");
    s().tilesReady();
    expect(s().phase).toBe("flight");
  });

  it("reduced motion goes straight to arrived, skipping the flight", () => {
    s().setReducedMotion(true);
    s().tilesReady();
    expect(s().phase).toBe("arrived");
  });

  it("skip only acts during flight", () => {
    s().skip();
    expect(s().phase).toBe("loading");
    s().tilesReady();
    s().skip();
    expect(s().phase).toBe("arrived");
  });

  it("explode round-trips arrived ⇄ exploded and refuses from flight", () => {
    s().tilesReady();
    s().explode();
    expect(s().phase).toBe("flight"); // refused
    s().flightDone();
    s().explode();
    expect(s().phase).toBe("exploded");
    s().reassemble();
    expect(s().phase).toBe("arrived");
  });

  it("fail wins from any phase and keeps the FIRST reason", () => {
    s().tilesReady();
    s().fail("tiles");
    s().fail("webgl");
    expect(s().phase).toBe("fallback");
    expect(s().failReason).toBe("tiles");
  });

  it("no transition escapes fallback except reset", () => {
    s().fail("no-key");
    s().tilesReady();
    s().flightDone();
    s().explode();
    expect(s().phase).toBe("fallback");
    s().reset();
    expect(s().phase).toBe("loading");
    expect(s().failReason).toBeNull();
  });
});
