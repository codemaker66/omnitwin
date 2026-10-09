import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { Texture } from "three";
import { PMREMGenerator } from "three/webgpu";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { renderHallEnvironment } from "./hall-environment.js";
import { HALL_MOODS, type HallMoodName } from "./hall-mood.js";

/**
 * Installs a warm interior as the scene's reflection environment for the
 * given mood, so gilt, chrome, glass and varnish have a room to reflect.
 * Restores the previous environment on change or unmount. Reflections are a
 * refinement: if the renderer cannot build them the scene simply goes without.
 */
export function HallEnvironment({ mood }: { readonly mood: HallMoodName }): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  // One generator per renderer, so a change of mood does not recompile its filters.
  const generatorRef = useRef<PMREMGenerator | null>(null);
  useEffect(() => () => {
    generatorRef.current?.dispose();
    generatorRef.current = null;
  }, [gl]);

  useEffect(() => {
    const renderer = getNativeRenderer(gl);
    if (renderer === null) return undefined;
    const generator = generatorRef.current ?? new PMREMGenerator(renderer);
    generatorRef.current = generator;
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    let environment: { texture: Texture; dispose: () => void } | null = null;
    try {
      environment = renderHallEnvironment(renderer, generator, HALL_MOODS[mood]);
      scene.environment = environment.texture;
      scene.environmentIntensity = HALL_MOODS[mood].reflections;
      invalidate();
    } catch {
      environment = null;
    }
    return () => {
      if (environment !== null && scene.environment === environment.texture) {
        scene.environment = previous;
        scene.environmentIntensity = previousIntensity;
      }
      environment?.dispose();
      invalidate();
    };
  }, [gl, invalidate, mood, scene]);

  return null;
}
