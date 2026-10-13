import { ACESFilmicToneMapping, NeutralToneMapping, NoToneMapping, type ToneMapping } from "three";

/** A captured room is shown as photographed: splats already carry the camera's
 * own response, and three r186 ignores `Material.toneMapped`, so the film curve
 * must come off the whole canvas while a capture is shown (T-639). The Grand
 * Hall's model is coloured from the same scan's photographs, so it keeps them
 * as photographed too, under the Khronos PBR Neutral curve: that leaves the
 * photographs' mid-tones as they are while still rolling off the highlights of
 * lit furniture and lamps. Other scenes keep R3F's default ACES curve. */
export function captureToneMapping(captureShown: boolean, photographedRoom = false): ToneMapping {
  if (captureShown) return NoToneMapping;
  return photographedRoom ? NeutralToneMapping : ACESFilmicToneMapping;
}
