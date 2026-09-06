import { describe, expect, it } from "vitest";
import { CAPTION_DEBOUNCE_MS, createCaptionStore, type CaptionStore } from "../captions.js";
import { manualClock, type ManualClock } from "./fake-audio-context.js";

interface Rig {
  readonly store: CaptionStore;
  readonly clock: ManualClock;
  /** Every text published, in order. */
  readonly published: string[];
}

function rig(): Rig {
  const clock = manualClock();
  const store = createCaptionStore({ schedule: clock.schedule });
  const published: string[] = [];
  store.subscribe(() => {
    published.push(store.getSnapshot().text);
  });
  return { store, clock, published };
}

describe("caption store", () => {
  it("publishes a lone caption at once, in the same frame as its spring and cue", () => {
    const { store, published } = rig();
    expect(store.getSnapshot()).toEqual({ text: "", seq: 0 });
    store.announce("[the chain swings]");
    expect(store.getSnapshot()).toEqual({ text: "[the chain swings]", seq: 1 });
    expect(published).toEqual(["[the chain swings]"]);
  });

  it("coalesces a storm: the last caption inside the 750 ms window wins when it closes", () => {
    const { store, clock, published } = rig();
    store.announce("[a ring spreads]");
    clock.advance(100);
    store.announce("[the lid lifts]");
    clock.advance(100);
    store.announce("[a coin]");
    expect(published).toEqual(["[a ring spreads]"]);
    clock.advance(CAPTION_DEBOUNCE_MS - 200 - 1);
    expect(published).toEqual(["[a ring spreads]"]);
    clock.advance(1);
    expect(published).toEqual(["[a ring spreads]", "[a coin]"]);
    expect(store.getSnapshot().seq).toBe(2);
  });

  it("keeps the window open after a trailing publish, so a continuous storm reads once per 750 ms", () => {
    const { store, clock, published } = rig();
    store.announce("one");
    store.announce("two");
    clock.advance(CAPTION_DEBOUNCE_MS);
    expect(published).toEqual(["one", "two"]);
    store.announce("three");
    expect(published).toEqual(["one", "two"]);
    clock.advance(CAPTION_DEBOUNCE_MS);
    expect(published).toEqual(["one", "two", "three"]);
    // Quiet for a window: the next one is immediate again.
    clock.advance(CAPTION_DEBOUNCE_MS);
    store.announce("four");
    expect(published).toEqual(["one", "two", "three", "four"]);
  });

  it("re-announces an identical caption by bumping the sequence", () => {
    const { store, clock } = rig();
    store.announce("[the swallow is gone]");
    clock.advance(CAPTION_DEBOUNCE_MS);
    store.announce("[the swallow is gone]");
    expect(store.getSnapshot()).toEqual({ text: "[the swallow is gone]", seq: 2 });
  });

  it("is silent while the voice plays, and drops a caption that was waiting for the window", () => {
    const { store, clock, published } = rig();
    store.announce("before");
    store.announce("held");
    store.setVoicePlaying(true);
    expect(store.voicePlaying).toBe(true);
    store.announce("(he is still speaking)");
    clock.advance(CAPTION_DEBOUNCE_MS * 2);
    expect(published).toEqual(["before"]);
    store.setVoicePlaying(false);
    store.announce("after");
    expect(published).toEqual(["before", "after"]);
  });

  it("hands useSyncExternalStore a stable snapshot and honours unsubscribe", () => {
    const { store } = rig();
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.announce("x");
    expect(calls).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
    unsubscribe();
    store.setVoicePlaying(false);
    store.announce("y");
    expect(calls).toBe(1);
  });

  it("dispose cancels the open window and ignores everything after", () => {
    const { store, clock, published } = rig();
    store.announce("first");
    store.announce("never");
    store.dispose();
    clock.advance(CAPTION_DEBOUNCE_MS * 2);
    store.announce("after dispose");
    expect(published).toEqual(["first"]);
    expect(store.getSnapshot().text).toBe("first");
  });
});
