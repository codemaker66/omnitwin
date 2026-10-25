import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { ActivityStatus } from "../components/shared/Activity.js";
import { readGraphicsResetDrill, startGraphicsResetDrill } from "../lib/graphics-reset-drill.js";
import {
  createNativeRendererRecovery, type NativeRecoveryPhase, type NativeRendererRecovery,
} from "../lib/native-renderer-recovery.js";

// -----------------------------------------------------------------------------
// The tour's graphics coming back after the browser takes them away.
//
// The tour draws with a classic WebGLRenderer, which restores itself in place
// when the browser hands a lost context back: three rebuilds its GL state and
// re-uploads every texture from the bitmap it still holds (texture-residency.ts
// keeps the real pixels for exactly this). What it cannot do is ask a demand
// loop for the frame that shows the room again, say anything while the room is
// gone, or get a new canvas when the context never returns. This does those,
// on the same policy as the native views (lib/native-renderer-recovery.ts).
// -----------------------------------------------------------------------------

/** What the watch inside the Canvas tells the recovery outside it. */
interface TwinCanvasReporter {
  lost(canvasKey: number): void;
  restored(canvasKey: number): void;
  drew(canvasKey: number): void;
  bind(canvasKey: number, invalidate: () => void): void;
}

function TwinContextLossWatch({ canvasKey, reporter }: {
  readonly canvasKey: number;
  readonly reporter: TwinCanvasReporter;
}): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    reporter.bind(canvasKey, invalidate);
    const canvas = gl.domElement;
    const lost = (event: Event): void => {
      // Without this the browser never restores the context. Three's own
      // listener does it too; the tour's recovery must not depend on that.
      event.preventDefault();
      reporter.lost(canvasKey);
    };
    const restored = (): void => {
      reporter.restored(canvasKey);
      invalidate();
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    // The device-day drill (lib/graphics-reset-drill.ts), once per tour.
    const drill = readGraphicsResetDrill(window.location.search);
    const stopDrill = drill === null ? null : startGraphicsResetDrill(reporter, drill, { device: null, canvas });
    return () => {
      stopDrill?.();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };
  }, [canvasKey, gl, invalidate, reporter]);
  useFrame(() => { reporter.drew(canvasKey); });
  return null;
}

export interface TwinGraphicsRecovery {
  /** Key the tour's Canvas with this: it changes only to give the tour a new canvas. */
  readonly canvasKey: number;
  /** Mount inside the Canvas. */
  readonly watch: ReactElement;
  /** Render over the canvas; null while the tour is drawing. */
  readonly notice: ReactElement | null;
}

const COVER: CSSProperties = {
  // The lost canvas shows nothing true; cover it, and take the gestures meant for it.
  position: "absolute", inset: 0, zIndex: 30,
  display: "grid", placeItems: "safe center", padding: 24,
  boxSizing: "border-box", textAlign: "center",
  background: "var(--black-2, #07100f)", color: "var(--ink, #fbf2df)",
  fontFamily: "var(--ui, system-ui, sans-serif)", pointerEvents: "auto",
};

const TRY_AGAIN: CSSProperties = {
  marginTop: 16, padding: "10px 20px", borderRadius: 999,
  border: "1px solid var(--rule, rgba(216, 174, 91, 0.28))", background: "transparent",
  color: "inherit", font: "inherit", cursor: "pointer",
};

export function useTwinGraphicsRecovery(): TwinGraphicsRecovery {
  const [canvasKey, setCanvasKey] = useState(0);
  const [phase, setPhase] = useState<NativeRecoveryPhase>({ kind: "running" });
  const recovery = useRef<NativeRendererRecovery | null>(null);
  const currentKey = useRef(0);
  const invalidate = useRef<(() => void) | null>(null);
  /** The attempt in flight, settled by the first frame drawn on the canvas it expects. */
  const pending = useRef<{ readonly canvasKey: number; readonly resolve: () => void } | null>(null);

  useEffect(() => {
    const controller = createNativeRendererRecovery({
      restore: (mode) => new Promise<void>((resolve) => {
        if (mode === "remount") {
          // A new canvas and context: the room is drawn again from scratch.
          currentKey.current += 1;
          pending.current = { canvasKey: currentKey.current, resolve };
          setCanvasKey(currentKey.current);
        } else {
          // The same context, handed back and already rebuilt by three.
          pending.current = { canvasKey: currentKey.current, resolve };
          invalidate.current?.();
        }
      }),
      onPhase: setPhase,
    });
    recovery.current = controller;
    return () => {
      controller.dispose();
      if (recovery.current === controller) recovery.current = null;
    };
  }, []);

  const reporter = useMemo<TwinCanvasReporter>(() => ({
    lost: (key) => { if (key === currentKey.current) recovery.current?.lost("WebGL"); },
    restored: (key) => { if (key === currentKey.current) recovery.current?.contextRestored(); },
    drew: (key) => {
      const attempt = pending.current;
      if (attempt === null || attempt.canvasKey !== key) return;
      pending.current = null;
      attempt.resolve();
    },
    bind: (key, next) => { if (key === currentKey.current) invalidate.current = next; },
  }), []);

  const tryAgain = (): void => {
    recovery.current?.reset();
    currentKey.current += 1;
    setCanvasKey(currentKey.current);
  };

  const recovering = phase.kind !== "running" && phase.kind !== "failed";
  const notice = recovering ? (
    <div style={COVER}>
      <div style={{ width: "100%", maxWidth: 420, lineHeight: 1.5 }}>
        <ActivityStatus variant="panel">Restoring the 3D view…</ActivityStatus>
        <p style={{ margin: "14px 0 0" }}>The browser reset this page’s graphics.</p>
      </div>
    </div>
  ) : phase.kind === "failed" ? (
    <section role="alert" style={COVER}>
      <div style={{ width: "100%", maxWidth: 420, lineHeight: 1.5 }}>
        <p style={{ margin: 0 }}>The 3D view stopped. Try again in a moment.</p>
        <button type="button" onClick={tryAgain} style={TRY_AGAIN}>Try again</button>
      </div>
    </section>
  ) : null;

  return {
    canvasKey,
    watch: <TwinContextLossWatch key={canvasKey} canvasKey={canvasKey} reporter={reporter} />,
    notice,
  };
}
