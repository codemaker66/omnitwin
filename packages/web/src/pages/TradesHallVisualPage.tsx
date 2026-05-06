import { useCallback, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useSearchParams } from "react-router-dom";
import { GrandHallRoom } from "../components/GrandHallRoom.js";
import {
  SparkSplatLayer,
  type SparkSplatErrorEvent,
  type SparkSplatLoadEvent,
} from "../components/scene/SparkSplatLayer.js";
import {
  parseRuntimeSplatUrl,
  runtimeSplatUrlFromSearchParams,
} from "../lib/runtime-visual-asset.js";

type VisualMode = "hybrid" | "mesh" | "splat";
type LoadStatus = "empty" | "invalid" | "loading" | "loaded" | "error";

interface VisualState {
  readonly status: LoadStatus;
  readonly message: string;
  readonly splatCount: number | null;
}

const EMPTY_STATE: VisualState = {
  status: "empty",
  message: "No real asset loaded yet",
  splatCount: null,
};

const MODES: readonly { readonly value: VisualMode; readonly label: string }[] = [
  { value: "hybrid", label: "Hybrid" },
  { value: "mesh", label: "Mesh" },
  { value: "splat", label: "Splat" },
] as const;

function statusTone(status: LoadStatus): string {
  switch (status) {
    case "loaded":
      return "#9fcf9b";
    case "loading":
      return "#d8ad4a";
    case "invalid":
    case "error":
      return "#e2a198";
    case "empty":
      return "#d6c9b8";
  }
}

function displayStatus(state: VisualState): string {
  if (state.status === "loaded" && state.splatCount !== null) {
    return `${state.message} (${state.splatCount.toLocaleString()} splats)`;
  }
  return state.message;
}

export function TradesHallVisualPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryAsset = useMemo(() => runtimeSplatUrlFromSearchParams(searchParams), [searchParams]);
  const [draftUrl, setDraftUrl] = useState(queryAsset.url ?? "");
  const [mode, setMode] = useState<VisualMode>("hybrid");
  const [opacity, setOpacity] = useState(0.82);
  const [visualState, setVisualState] = useState<VisualState>(() => {
    if (queryAsset.error !== null) {
      return { status: "invalid", message: queryAsset.error, splatCount: null };
    }
    return queryAsset.ok ? { status: "loading", message: "Loading runtime asset", splatCount: null } : EMPTY_STATE;
  });

  const parsedDraft = useMemo(() => parseRuntimeSplatUrl(draftUrl), [draftUrl]);
  const activeAsset = queryAsset.ok && queryAsset.url !== null ? queryAsset : null;
  const activeAssetUrl = activeAsset?.url ?? null;
  const meshVisible = mode === "hybrid" || mode === "mesh";
  const splatVisible = mode === "hybrid" || mode === "splat";

  const submitUrl = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = parseRuntimeSplatUrl(draftUrl);
    if (!next.ok || next.url === null) {
      setVisualState({
        status: next.error === null ? "empty" : "invalid",
        message: next.error ?? EMPTY_STATE.message,
        splatCount: null,
      });
      if (next.error === null) {
        setSearchParams({}, { replace: true });
      }
      return;
    }

    setVisualState({ status: "loading", message: "Loading runtime asset", splatCount: null });
    setSearchParams({ splatUrl: next.url }, { replace: true });
  }, [draftUrl, setSearchParams]);

  const handleLoad = useCallback((event: SparkSplatLoadEvent) => {
    setVisualState({
      status: "loaded",
      message: "Runtime asset loaded, not yet verified/signed.",
      splatCount: event.splatCount,
    });
  }, []);

  const handleError = useCallback((event: SparkSplatErrorEvent) => {
    setVisualState({
      status: "error",
      message: event.error.message,
      splatCount: null,
    });
  }, []);

  return (
    <main style={{
      position: "fixed",
      inset: 0,
      overflow: "hidden",
      background: "#11110f",
      color: "#f7efe2",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 48, near: 0.1, far: 160, position: [9, 6.5, 15] }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#f7f4ed"]} />
        {meshVisible && <GrandHallRoom />}
        {activeAssetUrl !== null && (
          <SparkSplatLayer
            url={activeAssetUrl}
            visible={splatVisible}
            opacity={opacity}
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
        <OrbitControls
          makeDefault
          target={[0, 1.6, 0]}
          minDistance={4}
          maxDistance={38}
          maxPolarAngle={Math.PI * 0.49}
        />
      </Canvas>

      <section
        aria-label="Internal visual layer controls"
        style={{
          position: "absolute",
          left: 24,
          top: 24,
          width: "min(460px, calc(100vw - 48px))",
          padding: 18,
          border: "1px solid rgba(216, 173, 74, 0.36)",
          background: "rgba(16, 16, 15, 0.84)",
          boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
          backdropFilter: "blur(18px)",
        }}
      >
        <p style={{
          margin: "0 0 8px",
          color: "#d8ad4a",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: "0.13em",
          textTransform: "uppercase",
        }}>
          Internal visual layer test
        </p>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.1, letterSpacing: 0 }}>
          Trades Hall runtime asset loader
        </h1>
        <p style={{ margin: "10px 0 16px", color: "#d6c9b8", lineHeight: 1.45 }}>
          Internal visual layer test. Not a verified photoreal runtime package.
        </p>

        <form onSubmit={submitUrl}>
          <label
            htmlFor="splat-url"
            style={{
              display: "block",
              marginBottom: 8,
              fontSize: 11,
              color: "#a99b88",
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Splat URL
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="splat-url"
              value={draftUrl}
              onChange={(event) => { setDraftUrl(event.currentTarget.value); }}
              placeholder="https://.../scene.ply"
              spellCheck={false}
              style={{
                flex: 1,
                minWidth: 0,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.08)",
                color: "#f7efe2",
                borderRadius: 8,
                padding: "11px 12px",
                fontSize: 14,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={!parsedDraft.ok}
              style={{
                border: "1px solid rgba(216, 173, 74, 0.6)",
                background: parsedDraft.ok ? "#caa337" : "rgba(255,255,255,0.08)",
                color: parsedDraft.ok ? "#17130c" : "#8d8375",
                borderRadius: 8,
                padding: "0 14px",
                fontWeight: 800,
                cursor: parsedDraft.ok ? "pointer" : "not-allowed",
              }}
            >
              Load
            </button>
          </div>
          {parsedDraft.error !== null && (
            <p style={{ margin: "8px 0 0", color: "#e2a198", fontSize: 13 }}>
              {parsedDraft.error}
            </p>
          )}
        </form>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => { setMode(item.value); }}
              style={{
                flex: 1,
                border: mode === item.value ? "1px solid rgba(216, 173, 74, 0.78)" : "1px solid rgba(255,255,255,0.16)",
                background: mode === item.value ? "rgba(216, 173, 74, 0.2)" : "rgba(255,255,255,0.06)",
                color: mode === item.value ? "#f5d36d" : "#d6c9b8",
                borderRadius: 8,
                minHeight: 38,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label
          htmlFor="splat-opacity"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 10,
            alignItems: "center",
            marginTop: 14,
            color: "#d6c9b8",
            fontSize: 13,
          }}
        >
          <span>Splat opacity</span>
          <span>{Math.round(opacity * 100)}%</span>
          <input
            id="splat-opacity"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(event) => { setOpacity(Number(event.currentTarget.value)); }}
            style={{ gridColumn: "1 / -1", width: "100%" }}
          />
        </label>

        <div style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid rgba(255,255,255,0.12)",
          fontSize: 13,
          lineHeight: 1.45,
        }}>
          <div style={{ color: statusTone(visualState.status), fontWeight: 800 }}>
            {displayStatus(visualState)}
          </div>
          <div style={{
            marginTop: 8,
            color: "#a99b88",
            overflowWrap: "anywhere",
          }}>
            Current URL: {activeAssetUrl ?? "none"}
          </div>
        </div>
      </section>
    </main>
  );
}
