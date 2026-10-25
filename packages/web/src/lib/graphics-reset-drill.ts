/**
 * `?graphicsReset=<seconds>[:never]`: a drill for real devices (the device day).
 *
 * After the view has drawn for that long, take its graphics away exactly as a
 * browser does: destroy the WebGPU device, or lose the WebGL context through
 * WEBGL_lose_context and hand it back a second later (or never, with
 * `:never`). Recovery can then be watched on a phone without a cable and an
 * inspector. It affects only a page whose own address asks for it, and runs
 * once per view, so a restored view is never taken away again.
 */
export interface GraphicsResetDrill {
  readonly afterMs: number;
  /** False for `:never`: the browser keeps the context, so the view needs a new canvas. */
  readonly handBack: boolean;
}

const LONGEST_WAIT_S = 600;
const HAND_BACK_MS = 1_000;

export function readGraphicsResetDrill(search: string): GraphicsResetDrill | null {
  const value = new URLSearchParams(search).get("graphicsReset");
  if (value === null) return null;
  const [seconds = "", mode] = value.split(":");
  const parsed = Number(seconds);
  if (seconds === "" || !Number.isFinite(parsed) || parsed < 0 || parsed > LONGEST_WAIT_S) return null;
  if (mode !== undefined && mode !== "never") return null;
  return { afterMs: Math.round(parsed * 1_000), handBack: mode === undefined };
}

interface DrillLoseContext { loseContext(): void; restoreContext(): void }
interface DrillTarget {
  /** The view's WebGPU device; null on WebGL. */
  readonly device: { destroy(): void } | null;
  readonly canvas: { getContext(kind: "webgl2"): { getExtension(name: "WEBGL_lose_context"): DrillLoseContext | null } | null } | null;
}

const drilled = new WeakSet();

/** Schedules the drill for one view (`owner`); returns a cancel for a view that goes away first. */
export function startGraphicsResetDrill(owner: object, drill: GraphicsResetDrill, target: DrillTarget): () => void {
  if (drilled.has(owner)) return () => undefined;
  const timer = setTimeout(() => {
    drilled.add(owner);
    if (target.device !== null) {
      target.device.destroy();
      return;
    }
    const extension = target.canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context") ?? null;
    if (extension === null) return;
    extension.loseContext();
    // Not cancelled with the view: a browser that took a context away hands it back regardless.
    if (drill.handBack) setTimeout(() => { extension.restoreContext(); }, HAND_BACK_MS);
  }, drill.afterMs);
  return () => { clearTimeout(timer); };
}
