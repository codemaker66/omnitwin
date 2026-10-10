import { useEffect, useState } from "react";
import { usePerfStore } from "../stores/perf-store.js";
import { formatFrameTime, formatTriangles, TOGGLE_KEY } from "../lib/perf.js";
import { PERF_REFRESH_MS } from "../lib/perf-profiler.js";
import { longTasksSupported, profilerClipboardReport, refreshProfiler, setLongTaskObservation, setProfilerForeground } from "../lib/perf-runtime.js";
import type { PerfMetrics } from "../lib/perf-profiler.js";

const BOTTLENECK_LABELS: Record<PerfMetrics["bottleneck"]["kind"], string> = {
  gpu: "GPU", cpu: "CPU", headroom: "Headroom", idle: "Idle", unknown: "—",
};
import { ActivityIndicator, ActivityStatus } from "./shared/Activity.js";
import { useIsNarrowViewport } from "../hooks/use-media-query.js";
import "./PerfOverlay.css";

function isClipboardWriter(value: unknown): value is Pick<Clipboard, "writeText"> {
  return typeof value === "object" && value !== null && "writeText" in value
    && typeof value.writeText === "function";
}

/**
 * Opt-in, accessible profiler. The 20-second window refreshes on wall time,
 * even when a demand-rendered scene stops drawing. Hidden/paused costs no poll.
 */
export function PerfOverlay(): React.ReactElement | null {
  const visible = usePerfStore((s) => s.visible);
  const metrics = usePerfStore((s) => s.metrics);
  const paused = usePerfStore((s) => s.paused);
  const generation = usePerfStore((s) => s.generation);
  const [copyState, setCopyState] = useState<"ready" | "working" | "copied" | "failed">("ready");
  // A phone opens on three figures so the stage stays usable while measuring;
  // a choice either way holds until the page is left.
  const narrow = useIsNarrowViewport();
  const [expandedChoice, setExpandedChoice] = useState<boolean | null>(null);
  const expanded = expandedChoice ?? !narrow;
  const optedIn = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("profiler") === "1";
  const available = import.meta.env.DEV || optedIn;

  useEffect(() => {
    if (optedIn && !usePerfStore.getState().visible) usePerfStore.getState().toggle();
  }, [optedIn]);

  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey
        || (target instanceof HTMLElement && (target.isContentEditable
          || target.closest("input, textarea, select, [role='textbox']") !== null))) return;
      if (event.code === TOGGLE_KEY) usePerfStore.getState().toggle();
      if (event.code === "Escape" && usePerfStore.getState().visible) usePerfStore.getState().toggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [available]);

  useEffect(() => {
    if (!visible || paused) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const visibility = (): void => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      const foreground = document.visibilityState !== "hidden";
      setProfilerForeground(foreground);
      if (foreground) {
        refreshProfiler();
        timer = setInterval(refreshProfiler, PERF_REFRESH_MS);
      }
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    setLongTaskObservation(true);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      setLongTaskObservation(false);
    };
  }, [visible, paused, generation]);

  // Keep ordinary routes unobstructed. Development retains the keyboard
  // shortcut; the closed touch launcher is reserved for explicit URL opt-in.
  if (!optedIn && !visible) return null;
  if (!visible) return <button type="button" className="perf-launcher" onClick={() => { usePerfStore.getState().toggle(); }} aria-label="Open performance profiler">Profiler</button>;

  const copy = async (): Promise<void> => {
    setCopyState("working");
    try {
      const clipboard: unknown = navigator.clipboard;
      if (!isClipboardWriter(clipboard)) throw new Error("Clipboard unavailable");
      await clipboard.writeText(profilerClipboardReport());
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  const ms = (value: number | null): string => value === null ? "—" : formatFrameTime(value);
  const count = (value: number | null): string => value === null ? "—" : formatTriangles(Math.round(value));
  const { bottleneck } = metrics;
  const pace = bottleneck.busyPct === null ? BOTTLENECK_LABELS[bottleneck.kind] : `${BOTTLENECK_LABELS[bottleneck.kind]} ${String(Math.round(bottleneck.busyPct))}%`;
  const close = (): void => { usePerfStore.getState().toggle(); };

  if (!expanded) {
    const fps = metrics.fps.toFixed(0);
    const p95 = ms(metrics.frameP95Ms);
    return (
      <section className="perf-panel perf-panel--compact" aria-label="Performance profiler" data-testid="perf-overlay">
        <button type="button" className="perf-compact" onClick={() => { setExpandedChoice(true); }}
          aria-label={`${fps} frames a second, p95 ${p95}, ${pace}. Show every figure`}>
          <span><strong>{fps}</strong> fps</span>
          <span>p95 <strong>{p95}</strong></span>
          <span>{pace}</span>
        </button>
        <button type="button" className="perf-close" onClick={close} aria-label="Close performance profiler">×</button>
      </section>
    );
  }

  const drawnShare = metrics.drawnSplats !== null && metrics.splats !== null && metrics.splats > 0
    ? ` · ${String(Math.round(100 * metrics.drawnSplats / metrics.splats))}%` : "";
  // Twelve figures chosen to locate the cost: how fast, how steady, which side
  // (CPU, GPU draw, GPU compute) sets the pace, and what the GPU is asked to do.
  const stats = [
    { label: "Rendered FPS", value: metrics.fps.toFixed(1), detail: "Main render submissions per wall-clock second, including idle time; not compositor presentation." },
    { label: "Frame mean", value: metrics.intervalCount ? ms(metrics.frameTimeMs) : "—", detail: "Mean complete frame interval ending in the rolling window; may start before its boundary. Long stalls are retained." },
    { label: "Frame p95", value: ms(metrics.frameP95Ms), detail: "95% of measured submitted-frame intervals are at or below this value (nearest rank)." },
    { label: "Frame p99", value: ms(metrics.frameP99Ms), detail: "99% of measured submitted-frame intervals are at or below this value (nearest rank). Spikes here with a steady mean point to hitches, not throughput." },
    { label: "Bottleneck", value: pace, detail: "Which side sets the frame time: the busier of CPU submission and GPU time as a share of the frame interval. GPU: reduce drawn splats or pixels; CPU: reduce per-frame script or draw calls; Headroom (under 60%): the display or on-demand rendering sets the pace." },
    { label: "CPU submission", value: ms(metrics.cpuSubmitMs), detail: "Mean synchronous draw and native scene update time. Other browser work is not included." },
    { label: "GPU draw", value: ms(metrics.gpuRenderMs), detail: `WebGPU render-pass timestamps: splats, meshes and the output pass. Sampled at most once per second (${String(metrics.gpuSampleCount)} samples); unavailable on WebGL or unsupported hardware.` },
    { label: "GPU sort + light", value: ms(metrics.gpuComputeMs), detail: "WebGPU compute timestamps: the splat depth sort and view-dependent lighting, averaged over sampled draws (0 when a draw needed neither)." },
    { label: "Splats drawn", value: `${count(metrics.drawnSplats ?? metrics.splats)}${drawnShare}`, detail: `Splats the latest GPU sort kept after culling what the camera cannot see, of ${count(metrics.splats)} loaded. WebGL draws every loaded splat.` },
    { label: "Draw calls", value: count(metrics.drawCalls), detail: "Mean geometry draw calls per submitted frame." },
    longTasksSupported()
      ? { label: "Long tasks", value: String(metrics.longTaskCount), detail: `Main-thread tasks over 50 ms in the window${metrics.longTaskWorstMs === null ? "" : `; worst ${formatFrameTime(metrics.longTaskWorstMs)}, total ${formatFrameTime(metrics.longTaskTotalMs)}`}. Each one is a visible hitch.` }
      : { label: "Long tasks", value: "—", detail: "This browser does not report main-thread long tasks." },
    { label: "Tracked memory", value: metrics.rendererMb === null ? "—" : `${metrics.rendererMb.toFixed(1)} MiB`, detail: `Mean allocation tracked by Three for buffers, textures and other renderer resources. Not total physical VRAM.${metrics.jsHeapMb === null ? "" : ` JavaScript heap ${metrics.jsHeapMb.toFixed(0)} MiB.`}` },
  ];

  return (
    <section className="perf-panel" aria-label="Performance profiler" data-testid="perf-overlay">
      <header className="perf-header">
        <div><span className="perf-eyebrow">Venviewer / diagnostics</span><h2>Performance</h2></div>
        <div className="perf-header-actions">
          {narrow && <button type="button" className="perf-close" onClick={() => { setExpandedChoice(false); }} aria-label="Show fewer performance figures">–</button>}
          <button type="button" className="perf-close" onClick={close} aria-label="Close performance profiler">×</button>
        </div>
      </header>
      <div className="perf-status" data-rating={metrics.rating}>
        {paused ? "Paused · Play starts a fresh window" : metrics.status === "idle" ? "No frames in 1s · window continues to age"
          : metrics.status === "warming" ? <ActivityStatus progress={metrics.windowSeconds * 5}>Collecting {metrics.windowSeconds.toFixed(1)} / 20s</ActivityStatus>
            : "Live · rolling 20-second window"}
      </div>
      <dl className="perf-grid">{stats.map((stat, index) => <div className="perf-stat" key={stat.label} title={stat.detail}>
        <dt><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{stat.label}</dt><dd>{stat.value}</dd>
      </div>)}</dl>
      <div className="perf-controls">
        <button type="button" onClick={() => { usePerfStore.getState().togglePaused(); }}>{paused ? "Play" : "Pause"}</button>
        <button type="button" onClick={() => { usePerfStore.getState().reset(); }}>Reset</button>
        <button type="button" onClick={() => { void copy(); }} disabled={copyState === "working"} aria-busy={copyState === "working"}>
          {copyState === "working" && <ActivityIndicator size={16} />}{copyState === "working" ? "Copying…" : "Copy report"}
        </button>
      </div>
      <p className="perf-note">{metrics.sampleCount.toLocaleString()} frames · averages unless marked p95/p99 · GPU sampled separately · — unavailable</p>
      {(metrics.sortTimeMs !== null || metrics.sortAgeMs !== null) && <p className="perf-note">
        Worker sort (WebGL): {ms(metrics.sortTimeMs)} per sort · order age {ms(metrics.sortAgeMs)}{metrics.sortBacklog === null ? "" : ` · ${metrics.sortBacklog.toFixed(1)} pending`}
      </p>}
      {metrics.capacityLimited && <p className="perf-note" role="alert">Sample capacity reached; frame rate and percentiles are incomplete.</p>}
      <details className="perf-definitions"><summary>Measurement details</summary><ul>{stats.map((stat) => <li key={stat.label}><strong>{stat.label}.</strong> {stat.detail}</li>)}</ul></details>
      <p className="perf-copy-status" role="status">{copyState === "copied" ? "Report copied as JSON." : copyState === "failed" ? "Clipboard unavailable or permission denied. Try Copy report again." : ""}</p>
    </section>
  );
}
