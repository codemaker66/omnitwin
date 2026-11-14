import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { captureToneMapping } from "../../lib/capture-display.js";

/** Sets the canvas tone mapping for a captured room and restores it on unmount. */
export function CaptureToneMapping({ captureShown, photographedRoom = false }: { readonly captureShown: boolean; readonly photographedRoom?: boolean }): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const previous = gl.toneMapping;
    gl.toneMapping = captureToneMapping(captureShown, photographedRoom);
    invalidate();
    return () => { gl.toneMapping = previous; invalidate(); };
  }, [gl, invalidate, captureShown, photographedRoom]);
  return null;
}
