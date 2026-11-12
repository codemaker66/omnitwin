// ---------------------------------------------------------------------------
// Native frame composers
//
// The native canvas draws its automatic main view with `renderer.render(scene,
// camera)`. A scene that wants a post-processing pipeline registers a composer
// for its renderer instead: the canvas then calls the composer in place of
// that draw, inside the same frame pacing, profiling and failure handling, so
// a pipeline never needs its own animation loop. One composer per renderer;
// the latest registration wins and its release restores the plain draw. A
// composer may also say how to compile its own passes ahead of their first
// draw (lib/native-precompile.ts), for whatever newly arrives in the scene.
// ---------------------------------------------------------------------------

/** Draws one complete main-view frame (every pass and the final output). */
export type NativeFrameComposer = () => void;

/** Compiles the composer's scene passes for what the scene holds now, without drawing them (lib/native-precompile.ts's job). */
export type NativeFramePrecompile = (signal: AbortSignal) => Promise<void>;

const composers = new WeakMap<object, NativeFrameComposer>();
const precompiles = new WeakMap<NativeFrameComposer, NativeFramePrecompile>();

/** Registers `composer` for `renderer`; the returned function releases it. */
export function registerNativeFrameComposer(renderer: object, composer: NativeFrameComposer, precompile?: NativeFramePrecompile): () => void {
  composers.set(renderer, composer);
  if (precompile !== undefined) precompiles.set(composer, precompile);
  return () => {
    if (composers.get(renderer) === composer) composers.delete(renderer);
  };
}

/** The composer drawing `renderer`'s main view, or null for the plain draw. */
export function nativeFrameComposer(renderer: object): NativeFrameComposer | null {
  return composers.get(renderer) ?? null;
}

/** How `renderer`'s composer compiles its passes ahead of drawing them, or null (none, or no composer). */
export function nativeFramePrecompile(renderer: object): NativeFramePrecompile | null {
  const composer = composers.get(renderer);
  return composer === undefined ? null : precompiles.get(composer) ?? null;
}
