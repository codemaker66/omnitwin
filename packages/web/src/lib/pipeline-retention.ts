// ---------------------------------------------------------------------------
// Pipeline retention — compile each render pipeline once per renderer
//
// Three.js forgets a compiled render pipeline, and its shader programs, as
// soon as the last drawn object using it is disposed. The planner's overlays
// (selection outlines, clearance rings, the marquee, circulation lines, name
// plates) unmount whenever they are not needed, so each return compiled its
// shaders again in the middle of a click, drag or orbit: tens of milliseconds
// on a desktop GPU, several dropped frames on a phone. The planner draws a
// small, bounded set of pipelines, so it keeps every one for the renderer's
// life instead.
//
// Three exposes no setting for this. Its pipeline cache drops entries through
// two internal release methods (three r186: Pipelines._releasePipeline and
// Pipelines._releaseProgram); retention replaces them on one renderer's cache.
// pipeline-retention.test.ts pins that contract against the installed three,
// so an upgrade that changes it fails a test instead of silently recompiling.
// ---------------------------------------------------------------------------

interface ReleasingPipelineCache {
  _releasePipeline: (pipeline: unknown) => void;
  _releaseProgram: (program: unknown) => void;
}

function isReleasingPipelineCache(value: unknown): value is ReleasingPipelineCache {
  return typeof value === "object" && value !== null
    && "_releasePipeline" in value && typeof value._releasePipeline === "function"
    && "_releaseProgram" in value && typeof value._releaseProgram === "function";
}

function keep(): void { /* retained for the renderer's life */ }

/**
 * Makes an initialised native renderer keep every render pipeline and shader
 * program it compiles. Returns a function restoring three's own release, or
 * null when the renderer has no pipeline cache of the expected shape (not yet
 * initialised, or a three version this does not recognise).
 */
export function retainCompiledPipelines(renderer: object): (() => void) | null {
  const cache = "_pipelines" in renderer ? renderer._pipelines : null;
  if (!isReleasingPipelineCache(cache)) return null;
  const { _releasePipeline: releasePipeline, _releaseProgram: releaseProgram } = cache;
  cache._releasePipeline = keep;
  cache._releaseProgram = keep;
  return () => {
    cache._releasePipeline = releasePipeline;
    cache._releaseProgram = releaseProgram;
  };
}
