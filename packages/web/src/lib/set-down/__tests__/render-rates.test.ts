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
/** The seeds brightness is held over: a median over ten is too noisy to hold to a few percent (below). */
const BRIGHTNESS_SEEDS_44K = Array.from({ length: 40 }, (_, i) => i + 1);
/**
 * How far the median brightness of seeds 1-40 at 44.1 kHz may sit from 48 kHz's: 5 % (ruling R93, after #416's
 * review, NC9). Measured, the median at 44.1 kHz over the median at 48 kHz: -0.2 % (Chiavari), -2.1 % (deck),
 * -0.0 % (mic stand), +1.2 % (round table), so 2.9 % of margin on the worst.
 *
 * One seed alone moves -5..+7 % for the chair and the deck and -14..+11 % for the rattling pieces, as its noises are
 * drawn sample by sample, so a median of a few seeds is noisy itself: resampled from seeds 1-60, the 40-seed figure
 * scatters by up to 1.9 % (the round table) and the 10-seed one by up to 2.7 %. Until 16 November this check held
 * seeds 1-10 to 3 %: the mic stand read +2.98 % there, 0.02 % inside the bound (the review took the comment's older
 * +2.1 % and put the margin at 0.8 %), and its seeds 31-40 read -3.3 %, while over seeds 1-40 it reads -0.04 %:
 * noise, not the rate. 5 % over 40 seeds sits about 2.6 of that scatter away from no change, so a re-roll of the
 * noise does not fail it, and a rate-dependent filter or constant that moves the brightness by more does.
 */
const BRIGHTNESS_44K = 0.05;

describe("a set-down at 44.1 kHz against 48 kHz (ruling R52)", () => {
  // This holds by construction: the renderer levels every play to a loudness set by its speed alone (render.ts,
  // rulings R36 and R45), read by the same momentary measure as this, so with the limiter idle the two rates agree
  // whatever the rate does to the sound. What it checks is that a seed draws the same speed at both rates. The guard
  // against a rate-dependent filter or constant is the brightness check below (#416's review, NC9).
  it.each(AT_44K)("plays %s within 0.1 dB of loudness, seed by seed: the leveller's own target, so the same speed drawn at both rates", (slug) => {
    for (const seed of SEEDS_44K) {
      const at44 = setDown(slug, "oak-boards-joists", { seed, sampleRate: 44100 });
      const at48 = setDown(slug, "oak-boards-joists", { seed });
      expect(at44.sampleRate).toBe(44100);
      expect(Math.abs(loudness(at44) - loudness(at48)), `seed ${String(seed)}`).toBeLessThan(0.1);
    }
  });

  it.each(AT_44K)("keeps %s's brightness: the median over seeds 1-40 of its power-weighted mean frequency within five percent", (slug) => {
    const brightness = (sampleRate: number): number =>
      median(BRIGHTNESS_SEEDS_44K.map((seed) => {
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
