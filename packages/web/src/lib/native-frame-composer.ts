// ---------------------------------------------------------------------------
// Native frame composers
//
// The native canvas draws its automatic main view with `renderer.render(scene,
// camera)`. A scene that wants a post-processing pipeline registers a composer
// for its renderer instead: the canvas then calls the composer in place of
// that draw, inside the same frame pacing, profiling and failure handling, so
// a pipeline never needs its own animation loop. One composer per renderer;
// the latest registration wins and its release restores the plain draw.
// ---------------------------------------------------------------------------

/** Draws one complete main-view frame (every pass and the final output). */
export type NativeFrameComposer = () => void;

const composers = new WeakMap<object, NativeFrameComposer>();

/** Registers `composer` for `renderer`; the returned function releases it. */
export function registerNativeFrameComposer(renderer: object, composer: NativeFrameComposer): () => void {
  composers.set(renderer, composer);
  return () => {
    if (composers.get(renderer) === composer) composers.delete(renderer);
  };
}

/** The composer drawing `renderer`'s main view, or null for the plain draw. */
export function nativeFrameComposer(renderer: object): NativeFrameComposer | null {
  return composers.get(renderer) ?? null;
}
