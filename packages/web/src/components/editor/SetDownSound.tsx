import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Camera } from "three";
import { subscribeFurnitureLandings, type FurnitureLandingListener } from "../../lib/furniture-motion.js";
import { getPlannerSoundSettings, logSetDownDrop, subscribePlannerSound, subscribePlannerSoundArmed } from "../../lib/sound-registry.js";
import type { SetDownDriver } from "./set-down-driver.js";

// ---------------------------------------------------------------------------
// SetDownSound: the always-mounted shell of the furniture's set-down sound
// (T-700, ruling R78). It hears the motion's landings from its mount, and
// loads the driver, which brings the engine, only when it may be needed: at
// the planner's first idle while sound is on, and at the first gesture at the
// latest (the registry's arming). The driver starts the Worker at arming.
// Until it has loaded, a landing that reaches its contact frame is dropped and
// counted on the tap. Mounted after FurnitureMotion, its frame runs after the
// motion's, so the contacts a frame heard are played in that same frame.
// ---------------------------------------------------------------------------

/** The longest the idle import waits for the browser to be idle. */
const IDLE_TIMEOUT_MS = 2_000;
/** Where the browser has no idle callback (Safari), the import waits this long after the planner mounts. */
const IDLE_FALLBACK_MS = 1_000;

interface IdleHost {
  requestIdleCallback?: (callback: () => void, options?: { readonly timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/** Runs `work` when the browser is next idle; returns the cancel. */
function whenIdle(work: () => void): () => void {
  const host: IdleHost = window;
  const { requestIdleCallback, cancelIdleCallback } = host;
  if (requestIdleCallback !== undefined && cancelIdleCallback !== undefined) {
    const handle = requestIdleCallback.call(window, work, { timeout: IDLE_TIMEOUT_MS });
    return () => { cancelIdleCallback.call(window, handle); };
  }
  const timer = window.setTimeout(work, IDLE_FALLBACK_MS);
  return () => { window.clearTimeout(timer); };
}

/** Reported, never swallowed (as the landings' listeners, R86). */
function reportAsync(error: unknown): void {
  const host: { reportError?: (error: unknown) => void } = globalThis;
  if (typeof host.reportError === "function") host.reportError(error);
  else queueMicrotask(() => { throw error; });
}

export function SetDownSound(): null {
  const camera = useThree((state) => state.camera);
  const cameraRef = useRef<Camera>(camera);
  const driverRef = useRef<SetDownDriver | null>(null);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    let disposed = false;
    let loading = false;
    let cancelIdle: (() => void) | null = null;
    /** Pieces that started down before the driver had loaded: their contacts are counted as dropped. */
    const unheard = new Set<string>();

    const load = (): void => {
      if (loading || disposed) return;
      loading = true;
      cancelIdle?.();
      cancelIdle = null;
      import("./set-down-driver.js").then((driver) => {
        if (!disposed) driverRef.current = driver.startSetDownDriver(() => cameraRef.current);
      }).catch((error: unknown) => {
        loading = false;
        reportAsync(new Error("The set-down sound did not load", { cause: error }));
      });
    };

    const loadWhenIdle = (): void => {
      if (loading || disposed || cancelIdle !== null || getPlannerSoundSettings().mode === "off") return;
      cancelIdle = whenIdle(() => {
        cancelIdle = null;
        if (getPlannerSoundSettings().mode !== "off") load();
      });
    };

    const listener: FurnitureLandingListener = {
      pickedUp: (id, heavy) => { driverRef.current?.pickedUp(id, heavy); },
      dropStarted: (id, landing, handSpeed, delaySeconds) => {
        const driver = driverRef.current;
        if (driver === null) {
          unheard.add(id);
          return;
        }
        unheard.delete(id);
        driver.dropStarted(id, landing, handSpeed, delaySeconds);
      },
      touchedDown: (id, landing, contactSpeed, handSpeed) => {
        if (unheard.delete(id)) {
          logSetDownDrop({ drop: "not-loaded" });
          return;
        }
        driverRef.current?.touchedDown(id, landing, contactSpeed, handSpeed);
      },
      landedInPlace: (id, landing, handSpeed) => {
        const driver = driverRef.current;
        if (driver === null) logSetDownDrop({ drop: "not-loaded" });
        else driver.landedInPlace(id, landing, handSpeed);
      },
    };

    const stopLandings = subscribeFurnitureLandings(listener);
    const stopSettings = subscribePlannerSound(loadWhenIdle);
    const stopArmed = subscribePlannerSoundArmed(load);
    loadWhenIdle();
    return () => {
      disposed = true;
      stopLandings();
      stopSettings();
      stopArmed();
      cancelIdle?.();
      cancelIdle = null;
      unheard.clear();
      driverRef.current?.dispose();
      driverRef.current = null;
    };
  }, []);

  useFrame((_state, delta) => {
    driverRef.current?.frame(delta);
  });

  return null;
}
