import { ACESFilmicToneMapping, NeutralToneMapping, NoToneMapping, type ToneMapping } from "three";

/** A captured room is shown as photographed: splats already carry the camera's
 * own response, and three r186 ignores `Material.toneMapped`, so the film curve
 * must come off the whole canvas while a capture is shown (T-639). The Grand
 * Hall's model is coloured from the same scan's photographs and draws under
 * the Khronos PBR Neutral curve, which rolls off the highlights of lit
 * furniture and lamps. Neutral also takes up to 0.04 out of every channel (its
 * toe): right for the lit furniture, whose colours were tuned under it, but it
 * darkens the photographs, which can give that light back in their own
 * materials (lib/film-toe.ts). Other scenes keep R3F's default ACES curve. */
export function captureToneMapping(captureShown: boolean, photographedRoom = false): ToneMapping {
  if (captureShown) return NoToneMapping;
  return photographedRoom ? NeutralToneMapping : ACESFilmicToneMapping;
}
