import { describe, expect, it, vi } from "vitest";
import { brightnessHz } from "../analysis.js";
import { bodyFor } from "../bodies.js";
import type { Mode } from "../modes.js";
import { renderSetDown } from "../render.js";
import { inputFor, loudness, setDown } from "./set-down-kit.js";

// ---------------------------------------------------------------------------
// The renderer at the rates devices run at (T-700, rulings R52 and R53). A
// play is deterministic at each rate, not across rates: its noises are drawn
// sample by sample. What a seed decides about the piece itself (its speed,
// its feet and every mode's frequency, decay and gain) is the same at every
// rate, and so are its loudness and its brightness, near enough to hear none.
// ---------------------------------------------------------------------------

/** Every mode the renderer draws (part modes, then surface modes), recorded while `modes` is set. */
const recorder = vi.hoisted(() => ({ modes: null as (readonly number[])[] | null }));

vi.mock("../modes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modes.js")>();
  const record = (modes: readonly Mode[]): readonly Mode[] => {
    recorder.modes?.push(modes.flatMap((mode) => [mode.hz, mode.t60, mode.gain]));
    return modes;
  };
  return {
    ...actual,
    partModes: (...args: Parameters<typeof actual.partModes>) => record(actual.partModes(...args)),
    surfaceModes: (...args: Parameters<typeof actual.surfaceModes>) => record(actual.surfaceModes(...args)),
  };
});

/** The modes one play of `slug` on oak draws at `sampleRate`, in the order it draws them. */
function modesDrawn(slug: string, seed: number, sampleRate: number): (readonly number[])[] {
  recorder.modes = [];
  renderSetDown(inputFor(slug, "oak-boards-joists", { seed, sampleRate }));
  const drawn = recorder.modes;
  recorder.modes = null;
  return drawn;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** The pieces held at 44.1 kHz (ruling R52): a chair, a deck, a steel stand and a folding round, the last two with rattling legs. */
const AT_44K = ["chiavari-chair", "staging-deck-6x4", "mic-stand", "round-table-6ft-white"] as const;
const SEEDS_44K = Array.from({ length: 10 }, (_, i) => i + 1);
/**
 * How far the median brightness of seeds 1-10 at 44.1 kHz may sit from 48 kHz's: a few percent. Measured as the
 * median of each seed's ratio: -0.6 % (Chiavari), -2.2 % (deck), +2.1 % (mic stand), +1.3 % (round table). One
 * seed alone moves further (-10..+13 % for the rattling pieces), as its noises are drawn sample by sample.
 */
const BRIGHTNESS_44K = 0.03;

describe("a set-down at 44.1 kHz against 48 kHz (ruling R52)", () => {
  it.each(AT_44K)("plays %s within 0.1 dB of loudness, seed by seed", (slug) => {
    for (const seed of SEEDS_44K) {
      const at44 = setDown(slug, "oak-boards-joists", { seed, sampleRate: 44100 });
      const at48 = setDown(slug, "oak-boards-joists", { seed });
      expect(at44.sampleRate).toBe(44100);
      expect(Math.abs(loudness(at44) - loudness(at48)), `seed ${String(seed)}`).toBeLessThan(0.1);
    }
  });

  it.each(AT_44K)("keeps %s's brightness: the median over seeds 1-10 of its power-weighted mean frequency within a few percent", (slug) => {
    const brightness = (sampleRate: number): number =>
      median(SEEDS_44K.map((seed) => {
        const render = setDown(slug, "oak-boards-joists", { seed, sampleRate });
        return brightnessHz(render.left, render.sampleRate);
      }));
    const at48 = brightness(48000);
    expect(at48).toBeGreaterThan(0);
    expect(Math.abs(brightness(44100) / at48 - 1)).toBeLessThan(BRIGHTNESS_44K);
  });
});

describe("a seed's play at 44.1, 48 and 96 kHz", () => {
  it.each(["round-table-6ft-white", "mic-stand", "room-divider"])(
    "draws %s's part and surface modes the same at every rate, its rattle on a stream of its own (ruling R53)",
    (slug) => {
      expect(bodyFor(slug).legRattle).toBe(true);
      for (const seed of [1, 2, 3]) {
        const at48 = modesDrawn(slug, seed, 48000);
        // The parts' banks and the oak's: something is drawn, and all of it is compared.
        expect(at48.length, `seed ${String(seed)}`).toBeGreaterThanOrEqual(bodyFor(slug).parts.length + 1);
        expect(modesDrawn(slug, seed, 44100), `seed ${String(seed)} at 44.1 kHz`).toEqual(at48);
        expect(modesDrawn(slug, seed, 96000), `seed ${String(seed)} at 96 kHz`).toEqual(at48);
      }
    },
  );
});
