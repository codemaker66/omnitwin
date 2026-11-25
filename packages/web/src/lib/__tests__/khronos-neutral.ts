// ---------------------------------------------------------------------------
// Khronos PBR Neutral on plain numbers, for the film toe's tests.
//
// A port of three's own neutralToneMapping (three/src/nodes/display/
// ToneMappingFunctions.js), which is a shader function and cannot be run here.
// THREE_NEUTRAL_SOURCE is that function's body as it read when the port was
// taken; film-toe-graph.test.ts compares it with the installed three, so a
// three that changes its Neutral fails a test and this port is read against
// the new source before anything trusts it again.
// ---------------------------------------------------------------------------

/** three's neutralToneMapping on plain numbers: `colour` in linear light, times `exposure`, through the curve. */
export function khronosNeutral(colour: readonly [number, number, number], exposure: number): [number, number, number] {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  let [r, g, b] = [colour[0] * exposure, colour[1] * exposure, colour[2] * exposure];
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= offset; g -= offset; b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < startCompression) return [r, g, b];
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const scale = newPeak / peak;
  const mixBy = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return [r * scale * (1 - mixBy) + newPeak * mixBy, g * scale * (1 - mixBy) + newPeak * mixBy, b * scale * (1 - mixBy) + newPeak * mixBy];
}

/** The three version the port was taken from. */
export const THREE_NEUTRAL_VERSION = "0.186.0";

/** The body of three's neutralToneMapping at that version, its whitespace collapsed to single spaces. */
export const THREE_NEUTRAL_SOURCE = [
  "const StartCompression = float( 0.8 - 0.04 );",
  "const Desaturation = float( 0.15 );",
  "color = color.mul( exposure );",
  "const x = min( color.r, min( color.g, color.b ) );",
  "const offset = select( x.lessThan( 0.08 ), x.sub( mul( 6.25, x.mul( x ) ) ), 0.04 );",
  "color.subAssign( offset );",
  "const peak = max( color.r, max( color.g, color.b ) );",
  "If( peak.lessThan( StartCompression ), () => { return color; } );",
  "const d = sub( 1, StartCompression );",
  "const newPeak = sub( 1, d.mul( d ).div( peak.add( d.sub( StartCompression ) ) ) );",
  "color.mulAssign( newPeak.div( peak ) );",
  "const g = sub( 1, div( 1, Desaturation.mul( peak.sub( newPeak ) ).add( 1 ) ) );",
  "return mix( color, vec3( newPeak ), g );",
].join(" ");
