import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { CustomToneMapping, NeutralToneMapping } from "three";
import { captureToneMapping } from "../../lib/capture-display.js";
import { DEFAULT_FILM_TOE, filmToeFromSearch, registerPhotographToneMapping, setFilmToe } from "../../lib/film-toe.js";

/**
 * Sets the canvas tone mapping for a captured room and restores it on unmount.
 * The photographed room draws through Neutral with an adjustable toe
 * (lib/film-toe.ts) on a renderer that takes a custom curve; `?toe=` in the
 * page address picks a toe to look with, and without it the default draws.
 */
export function CaptureToneMapping({ captureShown, photographedRoom = false }: { readonly captureShown: boolean; readonly photographedRoom?: boolean }): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const previous = gl.toneMapping;
    const mapping = captureToneMapping(captureShown, photographedRoom);
    const ownCurve = mapping === NeutralToneMapping && registerPhotographToneMapping(gl);
    if (ownCurve) setFilmToe(filmToeFromSearch(window.location.search) ?? DEFAULT_FILM_TOE);
    gl.toneMapping = ownCurve ? CustomToneMapping : mapping;
    invalidate();
    return () => { gl.toneMapping = previous; invalidate(); };
  }, [gl, invalidate, captureShown, photographedRoom]);
  return null;
}
