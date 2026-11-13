import { ACESFilmicToneMapping, NeutralToneMapping, NoToneMapping, type ToneMapping } from "three";

/** A captured room is shown as photographed: splats already carry the camera's
 * own response, and three r186 ignores `Material.toneMapped`, so the film curve
 * must come off the whole canvas while a capture is shown (T-639). The Grand
 * Hall's model is coloured from the same scan's photographs and draws under
 * the Khronos PBR Neutral curve, which rolls off the highlights of lit
 * furniture and lamps. Neutral also takes up to 0.04 out of every channel (its
 * toe), which darkens the photographs: the canvas swaps in the same curve with
 * that toe adjustable where the renderer can take one (lib/film-toe.ts,
 * components/scene/CaptureToneMapping.tsx). Other scenes keep R3F's default
 * ACES curve. */
export function captureToneMapping(captureShown: boolean, photographedRoom = false): ToneMapping {
  if (captureShown) return NoToneMapping;
  return photographedRoom ? NeutralToneMapping : ACESFilmicToneMapping;
}
