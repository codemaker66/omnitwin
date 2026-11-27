// ---------------------------------------------------------------------------
// The octave bands the set-down engine measures and renders in (T-700).
//
// Every material, piece and room is described by one number per band, from
// 125 Hz to 8 kHz. Where a source has no 8 kHz value, its 4 kHz value stands in.
// ---------------------------------------------------------------------------

/** The centre frequency of each octave band, in Hz. */
export const OCTAVE_BANDS_HZ = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

/** One value for each of the seven octave bands, lowest first. */
export type BandValues = readonly [number, number, number, number, number, number, number];

/** Applies `f` to each band's value (with its index) and returns the new values. */
export function bandMap(values: BandValues, f: (v: number, i: number) => number): BandValues {
  return [
    f(values[0], 0),
    f(values[1], 1),
    f(values[2], 2),
    f(values[3], 3),
    f(values[4], 4),
    f(values[5], 5),
    f(values[6], 6),
  ];
}
