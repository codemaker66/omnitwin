/**
 * Locale-independent UTF-16 code-unit ordering for canonical artifacts.
 */
export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
