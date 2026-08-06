// -----------------------------------------------------------------------------
// The Convener's voice — the parts that can be wrong silently.
//
// Audio playback itself is not unit-testable in happy-dom, and pretending
// otherwise would only test the mock. What IS testable is everything deciding
// WHAT plays and WHEN a character appears — and those are exactly the places
// where a bug yields a subtly desynchronised performance rather than an error
// anybody would notice.
// -----------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetConvenerVoiceForTests,
  __setConvenerVoiceIndexForTests,
  charsSpokenBy,
  isConvenerVoiceMuted,
  loadConvenerVoice,
  setConvenerVoiceMuted,
  type ConvenerVoiceLine,
} from "../convener-voice.js";

afterEach(() => {
  __resetConvenerVoiceForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("charsSpokenBy", () => {
  // "Aye." — one timestamp per character, as eleven_v3 returns them.
  const times = [0, 100, 200, 300];

  it("shows nothing before the first character is spoken", () => {
    expect(charsSpokenBy(times, -1)).toBe(0);
  });

  it("reveals a character exactly ON its start time, not after it", () => {
    // Strictly-greater would hold every character back a whole frame, which
    // across a 340-character reveal reads as lagging behind the voice.
    expect(charsSpokenBy(times, 0)).toBe(1);
    expect(charsSpokenBy(times, 100)).toBe(2);
  });

  it("reveals only what has been said at a moment between characters", () => {
    expect(charsSpokenBy(times, 150)).toBe(2);
    expect(charsSpokenBy(times, 299)).toBe(3);
  });

  it("never exceeds the line once the audio runs past the last character", () => {
    // Audio has trailing silence, so currentTime keeps climbing after the last
    // character. Returning 5 here would slice past the end of the string.
    expect(charsSpokenBy(times, 10_000)).toBe(4);
  });

  it("handles an empty timing array without spinning", () => {
    expect(charsSpokenBy([], 500)).toBe(0);
  });

  it("agrees with a linear scan across a realistic line", () => {
    // The binary search is an optimisation; this pins it to the obvious
    // implementation it replaced, across a 200-character line.
    const long = Array.from({ length: 200 }, (_, i) => i * 37);
    for (let t = -50; t <= 200 * 37 + 50; t += 13) {
      const scanned = long.filter((at) => at <= t).length;
      expect(charsSpokenBy(long, t)).toBe(scanned);
    }
  });
});

describe("loadConvenerVoice", () => {
  function stubManifest(body: unknown, ok = true): void {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 404,
      json: () => Promise.resolve(body),
    }));
  }

  it("indexes a line under BOTH its display and speech text", async () => {
    // They are identical today; the split exists so a Scots spelling that trips
    // the TTS can be spoken differently from how it is written. A caller
    // holding either string must still find the audio.
    stubManifest({
      entries: {
        abc123: {
          id: "doze",
          displayText: "Naebody hurries a Craft.",
          speechText: "Nobody hurries a Craft.",
          file: "abc123.mp3",
          charStartTimesMs: [0, 40],
        },
      },
    });
    const index = await loadConvenerVoice();
    expect(index.get("Naebody hurries a Craft.")?.file).toBe("abc123.mp3");
    expect(index.get("Nobody hurries a Craft.")?.file).toBe("abc123.mp3");
  });

  it("skips entries with no timings rather than indexing something half-usable", async () => {
    stubManifest({
      entries: {
        good: { speechText: "Aye.", file: "good.mp3", charStartTimesMs: [0] },
        noTimes: { speechText: "Mm.", file: "bad.mp3", charStartTimesMs: null },
        empty: { speechText: "Hm.", file: "bad2.mp3", charStartTimesMs: [] },
        noFile: { speechText: "Ach.", charStartTimesMs: [0] },
      },
    });
    const index = await loadConvenerVoice();
    expect(index.get("Aye.")).toBeDefined();
    expect(index.get("Mm.")).toBeUndefined();
    expect(index.get("Hm.")).toBeUndefined();
    expect(index.get("Ach.")).toBeUndefined();
  });

  it("returns an empty index when the manifest is missing, so the quiz still runs", async () => {
    // The whole point: no audio must degrade to the silent typewriter, never to
    // a broken quiz. A 404 on a static asset is a deploy slip, not a reason the
    // visitor cannot answer twelve questions.
    stubManifest({}, false);
    await expect(loadConvenerVoice()).resolves.toEqual(new Map());
  });

  it("returns an empty index when the network rejects outright", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadConvenerVoice()).resolves.toEqual(new Map());
  });

  it("fetches once however many times it is asked", async () => {
    // Every portrait mount calls this. Re-fetching per mount would re-download
    // the manifest on each compact/wide switch.
    stubManifest({ entries: {} });
    await Promise.all([loadConvenerVoice(), loadConvenerVoice(), loadConvenerVoice()]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("the mute preference", () => {
  it("defaults to audible", () => {
    expect(isConvenerVoiceMuted()).toBe(false);
  });

  it("round-trips through storage so the choice survives a reload", () => {
    setConvenerVoiceMuted(true);
    expect(isConvenerVoiceMuted()).toBe(true);
    setConvenerVoiceMuted(false);
    expect(isConvenerVoiceMuted()).toBe(false);
  });

  it("stays audible rather than throwing when storage is unavailable", () => {
    // Safari private mode throws on setItem. A blocked preference must cost the
    // visitor a preference, not the page.
    //
    // Replacing the whole object, not spying on Storage.prototype: happy-dom's
    // localStorage does not route through that prototype, so a prototype spy
    // silently fails to intercept and the test passes for the wrong reason —
    // it did here, by actually WRITING the value it meant to block.
    const boom = (): never => { throw new Error("blocked"); };
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 },
    });
    try {
      expect(() => { setConvenerVoiceMuted(true); }).not.toThrow();
      expect(isConvenerVoiceMuted()).toBe(false);
    } finally {
      Object.defineProperty(window, "localStorage", { configurable: true, value: original });
    }
  });
});

describe("the test seam", () => {
  it("installs an index without touching the network", async () => {
    const line: ConvenerVoiceLine = {
      file: "x.mp3",
      speechText: "Aye.",
      charStartTimesMs: [0, 10, 20, 30],
    };
    __setConvenerVoiceIndexForTests(new Map([["Aye.", line]]));
    vi.stubGlobal("fetch", vi.fn());
    const index = await loadConvenerVoice();
    expect(index.get("Aye.")).toBe(line);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
