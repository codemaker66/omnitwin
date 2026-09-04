import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomSplatLadder, RoomSplatSource } from "../data/room-splat-bundles.js";
import type { SparkSplatErrorEvent, SparkSplatLoadEvent } from "../components/scene/SparkSplatLayer.js";

export interface RoomSplatProgress {
  /** Finest tiles decoded or failed; the coarse cover is not counted. */
  readonly settled: number;
  readonly total: number;
  readonly splats: number;
  readonly failed: number;
  /** All finest requests settled, possibly with failures. */
  readonly complete: boolean;
  /** Room geometry decoded. This is not a compositor/pixel-present signal. */
  readonly firstView: boolean;
}

export type SplatDeliveryStage = "coarse" | "sharpening" | "sharp";
const PROGRESS_INTERVAL_MS = 400;
// Keep the coarse request alone on slow links; only a stuck request should
// force the fine requests to compete with it. See RoomSplatScene's ladder.
const COARSE_WAIT_MS = 15_000;

function mountedSources(ladder: RoomSplatLadder, stage: SplatDeliveryStage): readonly RoomSplatSource[] {
  return [
    ...ladder.environment,
    ...(stage === "sharp" ? [] : ladder.coarse),
    ...(stage === "coarse" ? [] : ladder.sharp),
  ];
}

/**
 * Shared walkthrough/planner delivery. Handlers remain stable while the
 * ladder advances: Spark keys its resource lifetime on their identities.
 * A new source ladder owns fresh callbacks and maps, so a disposed room's
 * delayed decode cannot advance its replacement. Equivalent arrays do not
 * restart delivery. Consumers key tiles by `key` plus URL when sources change.
 */
export function useSplatDelivery(
  ladder: RoomSplatLadder,
  onProgress?: (progress: RoomSplatProgress) => void,
) {
  const key = JSON.stringify([ladder.environment, ladder.coarse, ladder.sharp]);
  const session = useMemo(() => {
    // Decode the canonical identity so the session is independent of array
    // allocation at the call site without suppressing dependency checks.
    const [environment, coarse, sharp] = JSON.parse(key) as [RoomSplatSource[], RoomSplatSource[], RoomSplatSource[]];
    const sources: RoomSplatLadder = { environment, coarse, sharp };
    const progress: RoomSplatProgress = {
      settled: 0, total: sharp.length, splats: 0, failed: 0, complete: false, firstView: false,
    };
    return {
      sources,
      known: new Set([...environment, ...coarse, ...sharp].map((s) => s.url)),
      geometry: new Set([...coarse, ...sharp].map((s) => s.url)),
      firstDecodedAtMs: null as number | null,
      loaded: new Map<string, number>(),
      failed: new Set<string>(),
      initial: { stage: (coarse.length > 0 ? "coarse" : "sharpening") as SplatDeliveryStage, progress },
    };
  }, [key]);
  const [snapshot, setSnapshot] = useState(() => ({ session, ...session.initial }));
  const current = snapshot.session === session ? snapshot : { session, ...session.initial };
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  const onLoad = useCallback((event: SparkSplatLoadEvent) => {
    if (!session.known.has(event.url)) return;
    session.loaded.set(event.url, event.splatCount);
    session.failed.delete(event.url);
    if (session.geometry.has(event.url) && session.firstDecodedAtMs === null) session.firstDecodedAtMs = performance.now();
  }, [session]);
  const onError = useCallback((event: SparkSplatErrorEvent) => {
    if (session.known.has(event.url) && !session.loaded.has(event.url)) session.failed.add(event.url);
  }, [session]);

  useEffect(() => {
    let stage = session.initial.stage;
    let waitedMs = 0;
    let last: RoomSplatProgress | null = null;
    const { sources, loaded, failed } = session;
    if (session.known.size === 0) return;
    const isSettled = (url: string) => loaded.has(url) || failed.has(url);
    const timer = setInterval(() => {
      waitedMs += PROGRESS_INTERVAL_MS;
      const fineLoaded = sources.sharp.filter((s) => loaded.has(s.url)).length;
      const settled = sources.sharp.filter((s) => isSettled(s.url)).length;
      const total = sources.sharp.length;
      // Failed fine tiles leave holes. Keep the whole coarse room underneath
      // until every finest tile actually decoded, even after requests settle.
      if (total > 0 && fineLoaded === total) stage = "sharp";
      else if (stage !== "coarse" || sources.coarse.every((s) => isSettled(s.url)) || waitedMs >= COARSE_WAIT_MS) stage = "sharpening";
      const drawn = mountedSources(sources, stage);
      const progress: RoomSplatProgress = {
        settled, total,
        splats: drawn.reduce((sum, s) => sum + (loaded.get(s.url) ?? 0), 0),
        failed: sources.sharp.filter((s) => failed.has(s.url)).length,
        complete: total > 0 && settled === total,
        firstView: sources.coarse.some((s) => loaded.has(s.url)) || fineLoaded > 0,
      };
      if (last === null || Object.keys(progress).some((field) => progress[field as keyof RoomSplatProgress] !== last?.[field as keyof RoomSplatProgress])) {
        last = progress;
        onProgressRef.current?.(progress);
      }
      setSnapshot((previous) => previous.session === session && previous.stage === stage && previous.progress === last
        ? previous : { session, stage, progress: last ?? progress });
      // A retained coarse cover can arrive after every fine request failed.
      // Keep observing it (and the sky) so decode telemetry is not frozen at
      // an empty room. Unchanged reports still cause no React updates.
      if (progress.complete && drawn.every((s) => isSettled(s.url))) clearInterval(timer);
    }, PROGRESS_INTERVAL_MS);
    return () => { clearInterval(timer); };
  }, [session]);

  const mounted = useMemo(() => mountedSources(session.sources, current.stage), [session, current.stage]);
  return { key, mounted, stage: current.stage, progress: current.progress, firstDecodedAtMs: session.firstDecodedAtMs, onLoad, onError };
}
