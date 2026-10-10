import { describe, expect, it } from "vitest";
import { retainCompiledPipelines } from "../pipeline-retention.js";

// The contract retention relies on, exercised on three's own pipeline cache
// (three r186 src/renderers/common/Pipelines.js, which ships no types): when
// the last render object using a pipeline is deleted, the cache releases the
// pipeline and its programs through _releasePipeline and _releaseProgram.
interface Program { readonly code: string; readonly stage: "vertex" | "fragment"; usedTimes: number }
interface PipelineCache {
  readonly caches: Map<string, unknown>;
  readonly programs: { readonly vertex: Map<string, unknown>; readonly fragment: Map<string, unknown> };
  get(object: object): { pipeline?: unknown };
  delete(object: object): unknown;
}

function isPipelineCache(value: unknown): value is PipelineCache {
  return typeof value === "object" && value !== null
    && "caches" in value && value.caches instanceof Map
    && "programs" in value && typeof value.programs === "object" && value.programs !== null
    && "get" in value && typeof value.get === "function"
    && "delete" in value && typeof value.delete === "function";
}

async function threePipelineCache(): Promise<PipelineCache> {
  const specifier = "three/src/renderers/common/Pipelines.js";
  const loaded: unknown = await import(/* @vite-ignore */ specifier);
  if (typeof loaded !== "object" || loaded === null || !("default" in loaded) || typeof loaded.default !== "function") {
    throw new Error("three no longer ships its Pipelines cache where retention expects it");
  }
  const info = { destroyProgram: (): void => { /* counters only */ } };
  const cache: unknown = Reflect.construct(loaded.default, [{}, {}, info]);
  if (!isPipelineCache(cache)) throw new Error("three's Pipelines cache changed shape");
  return cache;
}

/** One cached pipeline with its two programs, used by one render object. */
function cachePipeline(cache: PipelineCache): { readonly renderObject: object; readonly pipeline: object } {
  const vertexProgram: Program = { code: "vertex-code", stage: "vertex", usedTimes: 1 };
  const fragmentProgram: Program = { code: "fragment-code", stage: "fragment", usedTimes: 1 };
  const pipeline = { cacheKey: "outline", usedTimes: 1, isComputePipeline: false, vertexProgram, fragmentProgram };
  cache.caches.set(pipeline.cacheKey, pipeline);
  cache.programs.vertex.set(vertexProgram.code, vertexProgram);
  cache.programs.fragment.set(fragmentProgram.code, fragmentProgram);
  const renderObject = {};
  cache.get(renderObject).pipeline = pipeline;
  return { renderObject, pipeline };
}

describe("retainCompiledPipelines", () => {
  it("three drops a pipeline when its last user goes, without retention", async () => {
    const cache = await threePipelineCache();
    const { renderObject } = cachePipeline(cache);
    cache.delete(renderObject);
    expect(cache.caches.size).toBe(0);
    expect(cache.programs.vertex.size).toBe(0);
    expect(cache.programs.fragment.size).toBe(0);
  });

  it("keeps the pipeline and its programs once retention is installed", async () => {
    const cache = await threePipelineCache();
    const { renderObject, pipeline } = cachePipeline(cache);
    const restore = retainCompiledPipelines({ _pipelines: cache });
    expect(restore).not.toBeNull();
    cache.delete(renderObject);
    expect(cache.caches.get("outline")).toBe(pipeline);
    expect(cache.programs.vertex.has("vertex-code")).toBe(true);
    expect(cache.programs.fragment.has("fragment-code")).toBe(true);

    restore?.();
    const next = cachePipeline(cache);
    cache.delete(next.renderObject);
    expect(cache.caches.size).toBe(0);
  });

  it("does nothing to a renderer that has no pipeline cache yet", () => {
    expect(retainCompiledPipelines({})).toBeNull();
    expect(retainCompiledPipelines({ _pipelines: null })).toBeNull();
  });
});
