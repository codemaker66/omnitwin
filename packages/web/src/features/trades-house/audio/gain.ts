// -----------------------------------------------------------------------------
// gain — decibel arithmetic shared by the mixer and its tests. Amplitude
// decibels throughout (20·log10), because every value here is a gain, not a
// power.
// -----------------------------------------------------------------------------

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  return 20 * Math.log10(linear);
}

/**
 * The level a table of bus gains would sum to if every bus carried a
 * full-scale signal at once, in dBFS. The mixer's law is that this stays at
 * or below -3 dBFS, which is what makes the compressor a crash guard rather
 * than a limiter.
 */
export function busSumDbfs(table: Readonly<Record<string, number>>): number {
  const linearSum = Object.values(table).reduce((sum, db) => sum + dbToLinear(db), 0);
  return linearToDb(linearSum);
}
