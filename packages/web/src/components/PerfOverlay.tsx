import { useEffect, useState } from "react";
import { usePerfStore } from "../stores/perf-store.js";
import { formatFrameTime, formatTriangles, TOGGLE_KEY } from "../lib/perf.js";
import { PERF_REFRESH_MS } from "../lib/perf-profiler.js";
import { profilerClipboardReport, refreshProfiler, setProfilerForeground } from "../lib/perf-runtime.js";
import { ActivityIndicator, ActivityStatus } from "./shared/Activity.js";
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
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
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
  const stats = [
    { label: "Rendered FPS", value: metrics.fps.toFixed(1), detail: "Main render submissions per wall-clock second, including idle time; not compositor presentation." },
    { label: "Frame mean", value: metrics.intervalCount ? ms(metrics.frameTimeMs) : "—", detail: "Mean complete frame interval ending in the rolling window; may start before its boundary. Long stalls are retained." },
    { label: "Frame p95", value: ms(metrics.frameP95Ms), detail: "95% of measured submitted-frame intervals are at or below this value (nearest rank)." },
    { label: "Frame p99", value: ms(metrics.frameP99Ms), detail: "99% of measured submitted-frame intervals are at or below this value (nearest rank)." },
    { label: "CPU submission", value: ms(metrics.cpuSubmitMs), detail: "Mean synchronous draw and native scene update time. Other browser work is not included." },
    { label: "GPU render + compute", value: ms(metrics.gpuTimeMs), detail: `WebGPU hardware timestamp mean, sampled at most once per second (${String(metrics.gpuSampleCount)} samples). Unavailable on WebGL or unsupported hardware; never inferred from queue completion.` },
    { label: "Draw calls", value: count(metrics.drawCalls), detail: "Mean geometry draw calls per submitted frame." },
    { label: "Triangles", value: count(metrics.triangles), detail: "Mean rendered triangle primitives per submitted frame, including splat quads." },
    { label: "Gaussian splats", value: count(metrics.splats), detail: "Mean active native Gaussian instances per submitted frame." },
    { label: "Tracked memory", value: metrics.rendererMb === null ? "—" : `${metrics.rendererMb.toFixed(1)} MiB`, detail: "Mean allocation tracked by Three for buffers, textures and other renderer resources. Not total physical VRAM or JS heap." },
    { label: "Sort duration", value: ms(metrics.sortTimeMs), detail: "Mean reported completed sort duration at submitted frames; unavailable if the active path does not report it." },
    { label: "Sort order age", value: ms(metrics.sortAgeMs), detail: "Mean age of the active sort order at submitted frames; unavailable if the active path does not report it." },
  ];

  return (
    <section className="perf-panel" aria-label="Performance profiler" data-testid="perf-overlay">
      <header className="perf-header">
        <div><span className="perf-eyebrow">Venviewer / diagnostics</span><h2>Performance</h2></div>
        <button type="button" className="perf-close" onClick={() => { usePerfStore.getState().toggle(); }} aria-label="Close performance profiler">×</button>
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
      {metrics.sortBacklog !== null && <p className="perf-note">Sort requests pending, mean: {metrics.sortBacklog.toFixed(1)}</p>}
      {metrics.capacityLimited && <p className="perf-note" role="alert">Sample capacity reached; frame rate and percentiles are incomplete.</p>}
      <details className="perf-definitions"><summary>Measurement details</summary><ul>{stats.map((stat) => <li key={stat.label}><strong>{stat.label}.</strong> {stat.detail}</li>)}</ul></details>
      <p className="perf-copy-status" role="status">{copyState === "copied" ? "Report copied as JSON." : copyState === "failed" ? "Clipboard unavailable or permission denied. Try Copy report again." : ""}</p>
    </section>
  );
}
