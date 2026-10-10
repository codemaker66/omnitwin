import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { PMREMGenerator, type RenderTarget } from "three/webgpu";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import { renderHallEnvironment } from "./hall-environment.js";
import { HALL_MOODS, type HallMoodName } from "./hall-mood.js";

/**
 * Installs a warm interior as the scene's reflection environment for the
 * given mood, so gilt, chrome, glass and varnish have a room to reflect.
 * One generator and one texture serve every mood: a new mood re-renders the
 * same texture, so its filters compile once and no material is rebuilt.
 * Restores the previous environment on unmount. Reflections are a
 * refinement: if the renderer cannot build them the scene simply goes without.
 */
export function HallEnvironment({ mood }: { readonly mood: HallMoodName }): null {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const environment = useRef<{ readonly generator: PMREMGenerator; target: RenderTarget | null } | null>(null);

  useEffect(() => {
    const renderer = getNativeRenderer(gl);
    if (renderer === null) return undefined;
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    const created = { generator: new PMREMGenerator(renderer), target: null as RenderTarget | null };
    environment.current = created;
    return () => {
      if (created.target !== null && scene.environment === created.target.texture) {
        scene.environment = previous;
        scene.environmentIntensity = previousIntensity;
      }
      created.target?.dispose();
      created.generator.dispose();
      if (environment.current === created) environment.current = null;
      invalidate();
    };
  }, [gl, invalidate, scene]);

  useEffect(() => {
    const renderer = getNativeRenderer(gl);
    const current = environment.current;
    if (renderer === null || current === null) return;
    try {
      current.target = renderHallEnvironment(renderer, current.generator, HALL_MOODS[mood], current.target);
      scene.environment = current.target.texture;
      scene.environmentIntensity = HALL_MOODS[mood].reflections;
      invalidate();
    } catch {
      // Without reflections the hall is still the hall.
    }
  }, [gl, invalidate, mood, scene]);

  return null;
}
