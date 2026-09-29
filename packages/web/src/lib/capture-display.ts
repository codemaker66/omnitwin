import { ACESFilmicToneMapping, NoToneMapping, type ToneMapping } from "three";

/** A captured room is shown as photographed: splats already carry the camera's
 * own response, and three r186 ignores `Material.toneMapped`, so the film curve
 * must come off the whole canvas while a capture is shown (T-639). Other scenes
 * keep R3F's default ACES curve. */
export function captureToneMapping(captureShown: boolean): ToneMapping {
  return captureShown ? NoToneMapping : ACESFilmicToneMapping;
}
