// ---------------------------------------------------------------------------
// Ye Auld Convener — the talking portrait
//
// A React rebuild of the proven rig: gold frame, candle sconces, the painted
// patron whose eyes follow your pointer like a magical painting. Everything
// hot-path runs through refs — the gaze spring writes SVG transforms inside
// one rAF loop, the typewriter writes textContent directly — so a moving
// pointer never causes a React render.
//
// Behaviour (pokes escalate, he dozes at 45s, waking is free) lives in the
// pure reducer in convener-state.ts; gaze numbers live in convener-gaze.ts.
// ---------------------------------------------------------------------------

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useMediaQuery } from "../../../hooks/use-media-query.js";
import {
  charsSpokenBy,
  getConvenerVoicePlayer,
  isConvenerVoiceMuted,
  loadConvenerVoice,
  setConvenerVoiceMuted,
  type ConvenerVoiceLine,
  type ConvenerVoicePlayer,
} from "./convener-voice.js";
import {
  GAZE_FOLLOW_OMEGA,
  GAZE_GLANCE_OMEGA,
  gazeTargetForPointer,
  nextBlinkDelayMs,
  nextWanderDelayMs,
  stepCriticallyDampedSpring,
  wanderTarget,
  type GazeRect,
  type SpringState,
} from "./convener-gaze.js";
import {
  clearUtterance,
  initialConvenerState,
  reduceConvener,
  type ConvenerEvent,
  type ConvenerState,
} from "./convener-state.js";
import "./ConvenerPortrait.css";

const TYPE_DEFAULT_CPS = 52;
const TYPE_HOLD_DEFAULT_MS = 350;
const MOUTH_TALK_INTERVAL_MS = 115;
const FLAME_FLICKER_INTERVAL_MS = 90;
const BLINK_HOLD_MS = 120;
const GLANCE_BROW_MS = 600;
const DOZE_TICK_MS = 4_000;
const ACTIVITY_THROTTLE_MS = 5_000;
const POINTER_FRESH_MS = 2_000;

export type ConvenerMouth = "rest" | "open" | "smile" | "press";

export interface ConvenerSayOptions {
  /** Highlights the bubble gold — his reaction voice. */
  readonly quip?: boolean;
  readonly cps?: number;
  /** Pause after the last character before the promise resolves. */
  readonly holdMs?: number;
  /**
   * Mirror the line into the polite live region (default true). Theatre the
   * user did not ask for — doze, wake, the return to the resting line — must
   * NOT interrupt a screen reader mid-question.
   */
  readonly announce?: boolean;
}

export interface ConvenerHandle {
  /** Speak a line; resolves after it is fully shown plus the hold. */
  readonly say: (text: string, options?: ConvenerSayOptions) => Promise<void>;
  /** Glance toward a viewport point — e.g. the option under the pointer. */
  readonly glanceAt: (clientX: number, clientY: number) => void;
  readonly express: (mouth: ConvenerMouth, ms?: number) => void;
  readonly setMull: (on: boolean) => void;
  readonly setLean: (on: boolean) => void;
  /**
   * Speak a line WITHOUT writing it into his bubble. His reply to an answer is
   * shown in its own panel beside the options — the bubble keeps holding the
   * scene, so the question stays readable while he comments on it — but a
   * talking portrait that falls silent exactly when he reacts is worse than one
   * that never spoke. No-op when muted or when the line has no audio.
   */
  readonly speakAside: (text: string) => void;
}

interface ConvenerPortraitProps {
  readonly compact?: boolean;
  readonly className?: string;
  /**
   * The line he returns to after self-initiated theatre (pokes, waking). On
   * narrow viewports his bubble is the ONLY visible rendering of the question
   * prompt, so wandering off-script must never leave it lost.
   */
  readonly restingLine?: string | null;
}

interface ReducerAction {
  readonly event: ConvenerEvent;
  readonly nowMs: number;
  readonly clear?: boolean;
}

function convenerReducer(state: ConvenerState, action: ReducerAction): ConvenerState {
  if (action.clear === true) return clearUtterance(state);
  return reduceConvener(state, action.event, action.nowMs);
}

export const ConvenerPortrait = forwardRef<ConvenerHandle, ConvenerPortraitProps>(
  function ConvenerPortrait({ compact = false, className, restingLine = null }, handleRef): ReactElement {
    const uid = useId();
    const gradient = useCallback((name: string): string => `cnv-${uid}-${name}`, [uid]);
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

    const [state, dispatch] = useReducer(
      convenerReducer,
      undefined,
      () => initialConvenerState(Date.now()),
    );
    const [speaking, setSpeaking] = useState(false);
    const [quip, setQuip] = useState(false);
    const [mull, setMullState] = useState(false);
    const [lean, setLeanState] = useState(false);
    // Read once from storage: the visitor's choice should survive a reload, and
    // reading it per line would be a synchronous storage hit inside say().
    const [voiceMuted, setVoiceMutedState] = useState<boolean>(() => isConvenerVoiceMuted());

    const rootRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLButtonElement>(null);
    const gazeLRef = useRef<SVGGElement>(null);
    const gazeRRef = useRef<SVGGElement>(null);
    const lidLRef = useRef<SVGRectElement>(null);
    const lidRRef = useRef<SVGRectElement>(null);
    const flameLRef = useRef<SVGPathElement>(null);
    const flameRRef = useRef<SVGPathElement>(null);
    const glowLRef = useRef<SVGEllipseElement>(null);
    const glowRRef = useRef<SVGEllipseElement>(null);
    const mouthRefs = useRef<Partial<Record<ConvenerMouth, SVGElement | null>>>({});
    const typedRef = useRef<HTMLSpanElement>(null);
    const liveRef = useRef<HTMLParagraphElement>(null);

    // Hot-path mutables — never React state.
    const rectRef = useRef<GazeRect | null>(null);
    const springX = useRef<SpringState>({ value: 0, velocity: 0 });
    const springY = useRef<SpringState>({ value: 0, velocity: 0 });
    const targetRef = useRef({ dx: 0, dy: 0 });
    const omegaRef = useRef(GAZE_FOLLOW_OMEGA);
    const lastPointerAtRef = useRef(0);
    const lastActivityDispatchRef = useRef(0);
    const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const typeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const talkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // The hold timer gets a DEDICATED ref: a stale hold firing into the next
    // line would truncate it and resolve its promise early (the quiz would
    // advance without the reaction beat). finishSay always cancels it.
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sayResolveRef = useRef<(() => void) | null>(null);
    const sayGenRef = useRef(0);
    const lastGazeWriteRef = useRef("");
    const restingLineRef = useRef<string | null>(restingLine);
    restingLineRef.current = restingLine;
    const dozingRef = useRef(false);
    dozingRef.current = state.dozing;
    const mullRef = useRef(false);
    mullRef.current = mull;
    const reducedMotionRef = useRef(reducedMotion);
    reducedMotionRef.current = reducedMotion;

    // ---- voice ----
    // The player is created lazily and lives for the whole session: iOS grants
    // playback per audio ELEMENT on a user gesture, so one reused element is
    // the only arrangement where lines after the first are allowed to sound.
    const playerRef = useRef<ConvenerVoicePlayer | null>(null);
    const voiceIndexRef = useRef<ReadonlyMap<string, ConvenerVoiceLine> | null>(null);
    const voiceRafRef = useRef<number | null>(null);
    const voiceMutedRef = useRef(voiceMuted);
    voiceMutedRef.current = voiceMuted;

    const later = useCallback((fn: () => void, ms: number): void => {
      const id = setTimeout(() => {
        timeoutsRef.current.delete(id);
        fn();
      }, ms);
      timeoutsRef.current.add(id);
    }, []);

    const setMouth = useCallback((mouth: ConvenerMouth): void => {
      for (const key of ["rest", "open", "smile", "press"] as const) {
        const el = mouthRefs.current[key];
        if (el) el.style.display = key === mouth ? "" : "none";
      }
    }, []);

    const stopTalk = useCallback((): void => {
      if (talkIntervalRef.current !== null) clearInterval(talkIntervalRef.current);
      talkIntervalRef.current = null;
      setMouth("rest");
    }, [setMouth]);

    const startTalk = useCallback((): void => {
      stopTalk();
      let open = false;
      talkIntervalRef.current = setInterval(() => {
        open = !open;
        setMouth(open ? "open" : "rest");
      }, MOUTH_TALK_INTERVAL_MS);
    }, [setMouth, stopTalk]);

    const express = useCallback((mouth: ConvenerMouth, ms = 1_600): void => {
      stopTalk();
      setMouth(mouth);
      if (mouth === "smile") rootRef.current?.classList.add("is-raise");
      later(() => {
        setMouth("rest");
        rootRef.current?.classList.remove("is-raise");
      }, ms);
    }, [later, setMouth, stopTalk]);

    const finishSay = useCallback((): void => {
      if (typeIntervalRef.current !== null) clearInterval(typeIntervalRef.current);
      typeIntervalRef.current = null;
      if (voiceRafRef.current !== null) cancelAnimationFrame(voiceRafRef.current);
      voiceRafRef.current = null;
      playerRef.current?.stop();
      if (holdTimerRef.current !== null) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      stopTalk();
      setSpeaking(false);
      const resolve = sayResolveRef.current;
      sayResolveRef.current = null;
      resolve?.();
    }, [stopTalk]);

    /** Arms the post-line hold. Owned by holdTimerRef so retargeting kills it. */
    const armHold = useCallback((ms: number): void => {
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        finishSay();
      }, ms);
    }, [finishSay]);

    const fullTextRef = useRef("");

    const say = useCallback((text: string, options?: ConvenerSayOptions): Promise<void> => {
      // A new line retargets: whoever awaited the old one is released so the
      // quiz can never stall behind an interrupted sentence.
      finishSay();
      sayGenRef.current += 1;
      fullTextRef.current = text;
      setQuip(options?.quip ?? false);
      setSpeaking(true);
      // Screen readers get the whole line once; the typewriter is theatre.
      // Unsolicited theatre (doze/wake/resting return) passes announce: false.
      if (options?.announce !== false && liveRef.current) liveRef.current.textContent = text;

      const holdMs = options?.holdMs ?? TYPE_HOLD_DEFAULT_MS;
      const myGen = sayGenRef.current;
      return new Promise<void>((resolve) => {
        sayResolveRef.current = resolve;

        /** The behaviour that existed before he had a voice. */
        const typeOnARate = (): void => {
          if (reducedMotionRef.current) {
            // Instant text, but hold for as long as the typewriter would have
            // taken — reduced motion must never mean reduced reading time.
            if (typedRef.current) typedRef.current.textContent = text;
            const typeMs = Math.round((text.length * 1_000) / (options?.cps ?? TYPE_DEFAULT_CPS));
            armHold(holdMs + typeMs);
            return;
          }
          const cps = options?.cps ?? TYPE_DEFAULT_CPS;
          let shown = 0;
          if (typedRef.current) typedRef.current.textContent = "";
          startTalk();
          typeIntervalRef.current = setInterval(() => {
            shown += 1;
            if (typedRef.current) typedRef.current.textContent = text.slice(0, shown);
            if (shown >= text.length) {
              if (typeIntervalRef.current !== null) clearInterval(typeIntervalRef.current);
              typeIntervalRef.current = null;
              stopTalk();
              armHold(holdMs);
            }
          }, Math.max(8, Math.round(1_000 / cps)));
        };

        // The index is awaited, not merely read. The portrait mounts and speaks
        // its first line in the same tick, so reading a ref here found null
        // every time and the opening scene — the one line every visitor hears
        // — was always silent. The promise is memoised, so this costs one
        // microtask once the manifest has landed.
        const resolveLine = voiceMutedRef.current
          ? Promise.resolve(undefined)
          : (voiceIndexRef.current === null
            ? loadConvenerVoice().then((index) => {
                voiceIndexRef.current = index;
                return index.get(text);
              })
            : Promise.resolve(voiceIndexRef.current.get(text)));

        // Nothing is shown until the audio actually starts. Painting the first
        // characters optimistically and then discovering playback was refused
        // would leave half a sentence frozen on screen.
        if (typedRef.current) typedRef.current.textContent = "";
        void resolveLine.then(async (line) => {
          const player = playerRef.current;
          // A newer line retargeted us while the manifest or audio was being
          // fetched. That say() already called finishSay; painting here would
          // write an abandoned sentence over the current one.
          if (sayGenRef.current !== myGen) return;
          if (line === undefined || player === null || voiceMutedRef.current) {
            typeOnARate();
            return;
          }
          const audio = await player.play(line);
          if (sayGenRef.current !== myGen) return;
          if (audio === null) {
            typeOnARate();
            return;
          }
          if (reducedMotionRef.current && typedRef.current) {
            typedRef.current.textContent = text;
          }
          startTalk();
          const times = line.charStartTimesMs;
          const step = (): void => {
            if (sayGenRef.current !== myGen) return;
            const elapsed = audio.currentTime * 1_000;
            if (!reducedMotionRef.current && typedRef.current) {
              // The audio element's own clock, read fresh every frame, so a
              // stall to buffer holds the text back with the voice rather than
              // letting a second timer run on ahead.
              typedRef.current.textContent = text.slice(0, charsSpokenBy(times, elapsed));
            }
            if (audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration)) {
              voiceRafRef.current = null;
              if (typedRef.current) typedRef.current.textContent = text;
              stopTalk();
              armHold(holdMs);
              return;
            }
            voiceRafRef.current = requestAnimationFrame(step);
          };
          voiceRafRef.current = requestAnimationFrame(step);
        });
      });
    }, [armHold, finishSay, startTalk, stopTalk]);

    const skipTyping = useCallback((): void => {
      if (!speaking) return;
      if (typedRef.current) typedRef.current.textContent = fullTextRef.current;
      finishSay();
    }, [finishSay, speaking]);

    const invalidateRect = useCallback((): void => {
      rectRef.current = null;
    }, []);

    const measuredRect = useCallback((): GazeRect | null => {
      if (rectRef.current === null && frameRef.current !== null) {
        const rect = frameRef.current.getBoundingClientRect();
        rectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      }
      return rectRef.current;
    }, []);

    const glanceAt = useCallback((clientX: number, clientY: number): void => {
      const rect = measuredRect();
      if (rect === null) return;
      omegaRef.current = GAZE_GLANCE_OMEGA;
      targetRef.current = gazeTargetForPointer(rect, clientX, clientY);
      const root = rootRef.current;
      if (root !== null && !root.classList.contains("is-raise")) {
        root.classList.add("is-raise");
        later(() => { root.classList.remove("is-raise"); }, GLANCE_BROW_MS);
      }
    }, [later, measuredRect]);

    /** Audio + mouth only; the bubble is left holding whatever it holds. */
    const speakAside = useCallback((text: string): void => {
      // Retarget first: this cancels any line in flight, releases whoever was
      // awaiting it, and bumps the generation so the old rAF loop stops
      // painting the bubble.
      finishSay();
      sayGenRef.current += 1;
      const myGen = sayGenRef.current;
      if (voiceMutedRef.current) return;

      const resolveLine = voiceIndexRef.current === null
        ? loadConvenerVoice().then((index) => {
            voiceIndexRef.current = index;
            return index.get(text);
          })
        : Promise.resolve(voiceIndexRef.current.get(text));

      void resolveLine.then(async (line) => {
        const player = playerRef.current;
        if (sayGenRef.current !== myGen) return;
        // Silence rather than a fallback typewriter: the panel already shows
        // this text in full, so there is nothing for a typewriter to reveal.
        if (line === undefined || player === null || voiceMutedRef.current) return;
        const audio = await player.play(line);
        if (audio === null || sayGenRef.current !== myGen) return;
        startTalk();
        const step = (): void => {
          if (sayGenRef.current !== myGen) return;
          if (audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration)) {
            voiceRafRef.current = null;
            stopTalk();
            return;
          }
          voiceRafRef.current = requestAnimationFrame(step);
        };
        voiceRafRef.current = requestAnimationFrame(step);
      });
    }, [finishSay, startTalk, stopTalk]);

    const toggleVoiceMuted = useCallback((): void => {
      setVoiceMutedState((wasMuted) => {
        const nowMuted = !wasMuted;
        setConvenerVoiceMuted(nowMuted);
        // Silence takes effect on the line being spoken, not the next one:
        // muting a man mid-sentence and still hearing him finish is a bug.
        if (nowMuted) playerRef.current?.stop();
        return nowMuted;
      });
    }, []);

    useImperativeHandle(handleRef, (): ConvenerHandle => ({
      say,
      glanceAt,
      express,
      setMull: setMullState,
      setLean: setLeanState,
      speakAside,
    }), [express, glanceAt, say, speakAside]);

    // ---- the one rAF loop: gaze spring + candle flames ----
    useEffect(() => {
      let raf = 0;
      let lastTs = performance.now();
      let lastFlicker = 0;
      let hidden = document.hidden;

      const frame = (ts: number): void => {
        const dt = Math.min(0.25, (ts - lastTs) / 1_000);
        lastTs = ts;

        const target = targetRef.current;
        if (reducedMotionRef.current) {
          springX.current = { value: target.dx, velocity: 0 };
          springY.current = { value: target.dy, velocity: 0 };
        } else {
          springX.current = stepCriticallyDampedSpring(springX.current, target.dx, dt, omegaRef.current);
          springY.current = stepCriticallyDampedSpring(springY.current, target.dy, dt, omegaRef.current);
        }
        // Gate on "changed since last write", never on "spring unsettled":
        // the reduced-motion snap lands EXACTLY on target, which reads as
        // settled on the same frame and would freeze the stare forever.
        const transform = `translate(${springX.current.value.toFixed(2)} ${springY.current.value.toFixed(2)})`;
        if (transform !== lastGazeWriteRef.current) {
          lastGazeWriteRef.current = transform;
          gazeLRef.current?.setAttribute("transform", transform);
          gazeRRef.current?.setAttribute("transform", transform);
        }

        if (!reducedMotionRef.current && ts - lastFlicker > FLAME_FLICKER_INTERVAL_MS) {
          lastFlicker = ts;
          for (const flame of [flameLRef.current, flameRRef.current]) {
            if (flame) {
              flame.style.transform =
                `scaleY(${(0.82 + Math.random() * 0.36).toFixed(3)}) skewX(${(Math.random() * 12 - 6).toFixed(2)}deg)`;
            }
          }
          for (const glow of [glowLRef.current, glowRRef.current]) {
            if (glow) glow.style.opacity = (0.38 + Math.random() * 0.28).toFixed(3);
          }
        }

        raf = requestAnimationFrame(frame);
      };

      const onVisibility = (): void => {
        if (document.hidden && !hidden) {
          hidden = true;
          cancelAnimationFrame(raf);
        } else if (!document.hidden && hidden) {
          hidden = false;
          lastTs = performance.now();
          raf = requestAnimationFrame(frame);
        }
      };

      if (!hidden) raf = requestAnimationFrame(frame);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }, []);

    // ---- pointer follow, activity, rect invalidation ----
    useEffect(() => {
      function onAnyActivity(): void {
        const now = Date.now();
        if (dozingRef.current || now - lastActivityDispatchRef.current > ACTIVITY_THROTTLE_MS) {
          lastActivityDispatchRef.current = now;
          dispatch({ event: { type: "activity" }, nowMs: now });
        }
      }

      const onPointerMove = (event: PointerEvent): void => {
        lastPointerAtRef.current = performance.now();
        if (!mullRef.current && !dozingRef.current) {
          const rect = measuredRect();
          if (rect !== null) {
            omegaRef.current = GAZE_FOLLOW_OMEGA;
            targetRef.current = gazeTargetForPointer(rect, event.clientX, event.clientY);
          }
        }
        onAnyActivity();
      };

      const passive = { passive: true } as const;
      document.addEventListener("pointermove", onPointerMove, passive);
      document.addEventListener("pointerdown", onAnyActivity, passive);
      document.addEventListener("keydown", onAnyActivity, passive);
      document.addEventListener("touchstart", onAnyActivity, passive);
      window.addEventListener("resize", invalidateRect, passive);
      window.addEventListener("scroll", invalidateRect, { passive: true, capture: true });
      return () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerdown", onAnyActivity);
        document.removeEventListener("keydown", onAnyActivity);
        document.removeEventListener("touchstart", onAnyActivity);
        window.removeEventListener("resize", invalidateRect);
        window.removeEventListener("scroll", invalidateRect, { capture: true });
      };
    }, [invalidateRect, measuredRect]);

    // ---- doze ticker ----
    useEffect(() => {
      const id = setInterval(() => {
        dispatch({ event: { type: "tick" }, nowMs: Date.now() });
      }, DOZE_TICK_MS);
      return () => { clearInterval(id); };
    }, []);

    // ---- blink + wander schedules ----
    useEffect(() => {
      let alive = true;

      const blink = (): void => {
        if (!alive) return;
        if (!dozingRef.current) {
          for (const lid of [lidLRef.current, lidRRef.current]) {
            if (lid) lid.style.transform = "scaleY(1)";
          }
          later(() => {
            for (const lid of [lidLRef.current, lidRRef.current]) {
              if (lid) lid.style.transform = "scaleY(0)";
            }
          }, BLINK_HOLD_MS);
        }
        later(blink, nextBlinkDelayMs(Math.random));
      };

      const wander = (): void => {
        if (!alive) return;
        const pointerFresh = performance.now() - lastPointerAtRef.current < POINTER_FRESH_MS;
        if (!reducedMotionRef.current && !mullRef.current && !dozingRef.current && !pointerFresh) {
          const target = wanderTarget(Math.random);
          if (target !== null) {
            omegaRef.current = GAZE_FOLLOW_OMEGA;
            targetRef.current = target;
          }
        }
        later(wander, nextWanderDelayMs(Math.random));
      };

      later(blink, 1_400);
      later(wander, 2_000);
      return () => {
        alive = false;
      };
    }, [later]);

    // ---- reducer utterances become speech ----
    const utterance = state.utterance;
    useEffect(() => {
      if (utterance === null) return;
      dispatch({ event: { type: "tick" }, nowMs: Date.now(), clear: true });
      if (utterance.kind === "wake") express("press", 700);
      else if (utterance.kind === "poke") express(state.pokeCount % 3 === 2 ? "press" : "smile", 900);
      // Pokes are feedback to the user's own action — announce them. Doze and
      // wake are theatre nobody asked for — keep them out of the live region.
      const sayPromise = say(utterance.text, {
        quip: utterance.kind !== "doze",
        announce: utterance.kind === "poke",
      });
      const myGen = sayGenRef.current;
      void sayPromise.then(() => {
        // On narrow viewports the bubble is the prompt's only visible home, so
        // after his aside finishes he returns to the question — unless a newer
        // line (or sleep) took the floor in the meantime.
        if (utterance.kind === "doze") return;
        const resting = restingLineRef.current;
        if (resting !== null && resting.length > 0 && sayGenRef.current === myGen && !dozingRef.current) {
          void say(resting, { announce: false });
        }
      });
    }, [express, say, state.pokeCount, utterance]);

    // ---- the scene speaks itself ----
    // He performs whatever restingLine currently holds. Owning this here
    // rather than having the page call say() on mount removes an effect
    // ordering hazard: under StrictMode the parent's say() could start the
    // typewriter and the child's own remount cleanup would then clear it,
    // leaving a caret blinking over an empty bubble forever.
    useEffect(() => {
      if (restingLine === null || restingLine.length === 0) return;
      void say(restingLine, { cps: 58 });
    }, [restingLine, say]);

    // ---- mull steers the gaze aside, like the original ----
    useEffect(() => {
      targetRef.current = mull ? { dx: -4, dy: -3 } : { dx: 0, dy: 0 };
    }, [mull]);

    // ---- keyboard skip: Escape ends the current line early ----
    useEffect(() => {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") skipTyping();
      };
      document.addEventListener("keydown", onKeyDown);
      return () => { document.removeEventListener("keydown", onKeyDown); };
    }, [skipTyping]);

    // ---- the voice: the session's player, manifest fetched once ----
    useEffect(() => {
      const player = getConvenerVoicePlayer();
      playerRef.current = player;
      let live = true;
      void loadConvenerVoice().then((index) => {
        // A manifest that arrives after unmount must not resurrect anything.
        if (live) voiceIndexRef.current = index;
      });
      return () => {
        live = false;
        playerRef.current = null;
        // Stopped, never disposed: the element carries Safari's unlock for the
        // whole visit, and this component remounts (compact/wide, screen
        // changes) far more often than the visit ends.
        player.stop();
      };
    }, []);

    // ---- unmount: every timer dies, every await resolves ----
    useEffect(() => {
      const timeouts = timeoutsRef.current;
      return () => {
        for (const id of timeouts) clearTimeout(id);
        timeouts.clear();
        if (typeIntervalRef.current !== null) clearInterval(typeIntervalRef.current);
        if (talkIntervalRef.current !== null) clearInterval(talkIntervalRef.current);
        if (voiceRafRef.current !== null) cancelAnimationFrame(voiceRafRef.current);
        voiceRafRef.current = null;
        if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
        sayResolveRef.current?.();
        sayResolveRef.current = null;
      };
    }, []);

    const onPoke = useCallback((): void => {
      lastActivityDispatchRef.current = Date.now();
      dispatch({ event: { type: "poke" }, nowMs: Date.now() });
    }, []);

    const classes = [
      "convener",
      compact ? "is-compact" : "",
      mull ? "is-mull" : "",
      lean ? "is-lean" : "",
      state.dozing ? "is-doze" : "",
      className ?? "",
    ].filter(Boolean).join(" ");

    return (
      <div className={classes} ref={rootRef}>
        <button
          type="button"
          className="convener-frame"
          ref={frameRef}
          onClick={onPoke}
          aria-label="Ye Auld Convener — poke the portrait"
        >
          <svg viewBox="0 0 400 470" role="img" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id={gradient("frame")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e9c878" /><stop offset=".22" stopColor="#b98d3e" />
                <stop offset=".5" stopColor="#8a651f" /><stop offset=".78" stopColor="#c99c4a" />
                <stop offset="1" stopColor="#7a571a" />
              </linearGradient>
              <linearGradient id={gradient("framein")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5c4214" /><stop offset="1" stopColor="#8a651f" />
              </linearGradient>
              <radialGradient id={gradient("paintbg")} cx=".5" cy=".34" r=".9">
                <stop offset="0" stopColor="#3d2c1c" /><stop offset=".55" stopColor="#221710" />
                <stop offset="1" stopColor="#0d0906" />
              </radialGradient>
              <linearGradient id={gradient("skin")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f0d6ae" /><stop offset=".62" stopColor="#d8a97c" />
                <stop offset="1" stopColor="#a97a52" />
              </linearGradient>
              <linearGradient id={gradient("beard")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fbf8f0" /><stop offset=".6" stopColor="#ddd6c7" />
                <stop offset="1" stopColor="#a59d8c" />
              </linearGradient>
              <linearGradient id={gradient("collar")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f8f3e5" /><stop offset="1" stopColor="#c9c0aa" />
              </linearGradient>
              <linearGradient id={gradient("doublet")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#2e2a24" /><stop offset=".5" stopColor="#16130f" />
                <stop offset="1" stopColor="#0a0806" />
              </linearGradient>
              <linearGradient id={gradient("curtain")} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#7c221a" /><stop offset=".55" stopColor="#571512" />
                <stop offset="1" stopColor="#320b09" />
              </linearGradient>
              <linearGradient id={gradient("plaque")} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#d9b465" /><stop offset=".5" stopColor="#a67e33" />
                <stop offset="1" stopColor="#c59d4d" />
              </linearGradient>
              <radialGradient id={gradient("candle")} cx=".5" cy=".5" r=".5">
                <stop offset="0" stopColor="#ffd98a" stopOpacity=".9" />
                <stop offset=".4" stopColor="#ff9d3c" stopOpacity=".55" />
                <stop offset="1" stopColor="#ff7a00" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={gradient("headglow")} cx=".5" cy=".5" r=".5">
                <stop offset="0" stopColor="#6a4c2a" stopOpacity=".85" />
                <stop offset="1" stopColor="#6a4c2a" stopOpacity="0" />
              </radialGradient>
              {/* flame body: blue base, amber heart, smoke-thin tip */}
              <linearGradient id={gradient("flame")} x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#3f6ad8" stopOpacity=".85" />
                <stop offset=".16" stopColor="#ffb02e" />
                <stop offset=".45" stopColor="#ffdf8a" />
                <stop offset=".8" stopColor="#ffca5f" stopOpacity=".92" />
                <stop offset="1" stopColor="#ff8a2b" stopOpacity=".25" />
              </linearGradient>
              <radialGradient id={gradient("bloom")} cx=".5" cy=".5" r=".5">
                <stop offset="0" stopColor="#ffe0a2" stopOpacity=".85" />
                <stop offset=".28" stopColor="#ffab48" stopOpacity=".42" />
                <stop offset=".62" stopColor="#e87a1e" stopOpacity=".16" />
                <stop offset="1" stopColor="#c85f10" stopOpacity="0" />
              </radialGradient>
              <linearGradient id={gradient("wax")} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#6d6152" />
                <stop offset=".34" stopColor="#e8dcc4" />
                <stop offset=".62" stopColor="#cbbda0" />
                <stop offset="1" stopColor="#5d5344" />
              </linearGradient>
              {/* the dark that makes the light mean something */}
              <radialGradient id={gradient("vignette")} cx=".5" cy=".42" r=".78">
                <stop offset="0" stopColor="#000" stopOpacity="0" />
                <stop offset=".55" stopColor="#000" stopOpacity=".12" />
                <stop offset=".82" stopColor="#000" stopOpacity=".62" />
                <stop offset="1" stopColor="#000" stopOpacity=".92" />
              </radialGradient>
              {/* canvas tooth — keeps the flats from reading as plastic */}
              <filter id={gradient("grain")} x="0" y="0" width="100%" height="100%">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n" />
                <feColorMatrix in="n" type="saturate" values="0" />
              </filter>
              <clipPath id={gradient("clip")}><rect x="58" y="40" width="284" height="356" rx="3" /></clipPath>
            </defs>

            {/* The candles used to hang outside the frame as 8px slivers —
                present, flickering, and far too small to see. They now stand
                inside the painting, in front of him, where their light is the
                reason the scene is lit at all. */}

            {/* frame */}
            <rect x="44" y="26" width="312" height="384" rx="10" fill={`url(#${gradient("frame")})`} stroke="#4a3410" strokeWidth="2" />
            <rect x="52" y="34" width="296" height="368" rx="6" fill={`url(#${gradient("framein")})`} />
            <rect x="58" y="40" width="284" height="356" rx="3" fill={`url(#${gradient("paintbg")})`} />
            <g fill="#e9c878" stroke="#6e4f16" strokeWidth=".8">
              <circle cx="44" cy="26" r="9" /><circle cx="356" cy="26" r="9" />
              <circle cx="44" cy="410" r="9" /><circle cx="356" cy="410" r="9" />
              <path d="M178 18 q22 -14 44 0 l-8 8 q-14 -9 -28 0z" />
            </g>
            <g fill="none" stroke="#e6cf9b" strokeWidth="1" opacity=".5">
              <path d="M60 30 h60 M280 30 h60 M60 406 h60 M280 406 h60" />
            </g>

            {/* the painting */}
            <g clipPath={`url(#${gradient("clip")})`}>
              <g className="convener-fig">
                {/* backdrop: near-dark, warmed from the candle side */}
                <rect x="58" y="40" width="284" height="356" fill="#150d06" />
                <ellipse cx="168" cy="176" rx="185" ry="205" fill={`url(#${gradient("headglow")})`} opacity=".9" />
                {/* the clerk's ledger shelves, barely out of the dark */}
                <g opacity=".5">
                  <rect x="62" y="70" width="76" height="4" fill="#2b1d10" />
                  <rect x="62" y="130" width="76" height="4" fill="#2b1d10" />
                  <rect x="62" y="190" width="70" height="4" fill="#271a0e" />
                  <g fill="#241708">
                    <rect x="66" y="44" width="9" height="26" /><rect x="77" y="40" width="8" height="30" /><rect x="87" y="46" width="10" height="24" /><rect x="99" y="42" width="7" height="28" /><rect x="108" y="45" width="9" height="25" /><rect x="119" y="41" width="8" height="29" />
                    <rect x="64" y="104" width="8" height="26" /><rect x="74" y="100" width="10" height="30" /><rect x="86" y="106" width="8" height="24" /><rect x="96" y="102" width="9" height="28" /><rect x="107" y="105" width="7" height="25" /><rect x="116" y="101" width="10" height="29" />
                    <rect x="66" y="164" width="9" height="26" /><rect x="77" y="160" width="8" height="30" /><rect x="87" y="166" width="9" height="24" /><rect x="98" y="162" width="8" height="28" />
                  </g>
                  <g fill="#4a3018" opacity=".5">
                    <rect x="78" y="46" width="1.6" height="20" /><rect x="98" y="108" width="1.6" height="18" /><rect x="88" y="168" width="1.6" height="18" />
                  </g>
                </g>
                {/* curtain: deep folds, candle catching the near edge */}
                <path d="M282 40 q34 66 22 176 q-10 86 26 180 l14 0 l0 -356 z" fill={`url(#${gradient("curtain")})`} />
                <path d="M292 40 q28 72 16 182 q-8 78 22 174" fill="none" stroke="#8a2a1e" strokeWidth="8" opacity=".5" />
                <path d="M306 40 q20 88 10 196 q-6 66 16 160" fill="none" stroke="#2a0806" strokeWidth="9" opacity=".7" />
                <path d="M318 40 q14 92 6 190" fill="none" stroke="#93372a" strokeWidth="3.5" opacity=".45" />
                {/* fur-lined gown over the doublet */}
                <path d="M84 396 q6 -84 56 -104 q28 -12 60 -12 q32 0 60 12 q50 20 56 104z" fill={`url(#${gradient("doublet")})`} />
                <path d="M96 396 q10 -66 44 -88 q-8 34 -4 88z" fill="#26201a" opacity=".9" />
                <path d="M304 396 q-10 -66 -44 -88 q8 34 4 88z" fill="#211b15" opacity=".9" />
                <g stroke="#3d342a" strokeWidth="1.1" opacity=".7" fill="none">
                  <path d="M104 366 q4 -3 8 0 M100 378 q4 -3 8 0 M112 372 q4 -3 8 0" />
                  <path d="M288 366 q4 -3 8 0 M292 378 q4 -3 8 0 M280 372 q4 -3 8 0" />
                </g>
                <path d="M92 396 q6 -74 52 -96 l6 4 q-42 22 -50 92z" fill="#c98f4a" opacity=".2" />
                {/* the falling band — the wide linen collar of the 1600s */}
                <path d="M148 302 q52 26 104 0 l16 34 q-68 30 -136 0 z" fill={`url(#${gradient("collar")})`} />
                <path d="M148 302 q52 26 104 0 l16 34 q-68 30 -136 0 z" fill="none" stroke="#9d947c" strokeWidth="1.1" opacity=".75" />
                <path d="M200 316 v22" stroke="#b3a98f" strokeWidth="1.1" opacity=".8" />
                <path d="M196 324 q-3 8 -7 10 M204 324 q3 8 7 10" stroke="#cfc4a6" strokeWidth="1.3" fill="none" opacity=".9" />
                <path d="M150 306 q10 14 22 20 M250 306 q-10 14 -22 20" stroke="#a89f87" strokeWidth="1" fill="none" opacity=".5" />
                {/* chain of office — his one permitted vanity */}
                <g>
                  <path d="M154 344 q46 36 92 -2" fill="none" stroke="#8a651f" strokeWidth="4.4" strokeLinecap="round" opacity=".9" />
                  <path d="M154 344 q46 36 92 -2" fill="none" stroke="#cda85f" strokeWidth="2.4" strokeDasharray="2 4.5" strokeLinecap="round" />
                  <circle cx="200" cy="374" r="14" fill="#8a651f" />
                  <circle cx="199" cy="373" r="13" fill="#c99c4a" stroke="#6e4f16" strokeWidth="1.4" />
                  <circle cx="199" cy="373" r="9" fill="none" stroke="#8a651f" strokeWidth="1" opacity=".8" />
                  <g stroke="#4a3410" strokeWidth=".9" strokeLinecap="round">
                    <path d="M193 379 L205 367 M196 380 L205 371 M199 381 L205 375 M205 379 L193 367 M202 380 L193 371 M199 381 L193 375" />
                    <path d="M194 373 h10" strokeWidth="1.4" />
                  </g>
                  <path d="M192 366 a9 9 0 0 1 8 -5" stroke="#f4dda2" strokeWidth="1.2" fill="none" opacity=".8" />
                </g>
                <g className="convener-head">
                  <ellipse cx="145" cy="230" rx="8.5" ry="13.5" fill={`url(#${gradient("skin")})`} />
                  <ellipse cx="255" cy="230" rx="8.5" ry="13.5" fill={`url(#${gradient("skin")})`} />
                  <path d="M142 226 q3 6 1.5 11 M258 226 q-3 6 -1.5 11" stroke="#a5765a" strokeWidth="1.1" fill="none" opacity=".6" />
                  <path d="M152 194 q0 -46 48 -46 q48 0 48 46 q0 36 -11 56 q-13 26 -37 26 q-24 0 -37 -26 q-11 -20 -11 -56z" fill={`url(#${gradient("skin")})`} />
                  {/* chiaroscuro: candle to his right hand, our left */}
                  <path d="M152 194 q0 -46 48 -46 l0 128 q-24 0 -37 -26 q-11 -20 -11 -56z" fill="#ffdfae" opacity=".14" />
                  <path d="M248 194 q0 -46 -48 -46 l0 128 q24 0 37 -26 q11 -20 11 -56z" fill="#6e4326" opacity=".2" />
                  <path d="M236 172 q10 22 4 52 q-4 22 -14 36 q14 -6 20 -32 q4 -26 -10 -56z" fill="#5c3a22" opacity=".16" />
                  {/* a high forehead that has carried four centuries of minutes */}
                  <path d="M166 168 q34 -10 68 0" stroke="#b98a5e" strokeWidth="1.2" fill="none" opacity=".45" />
                  <path d="M170 158 q30 -9 60 0" stroke="#b98a5e" strokeWidth="1" fill="none" opacity=".35" />
                  <path d="M175 149 q25 -7 50 0" stroke="#b98a5e" strokeWidth=".9" fill="none" opacity=".25" />
                  <ellipse cx="182" cy="160" rx="20" ry="10" fill="#ffe7bd" opacity=".18" />
                  {/* sockets and the bags beneath — age drawn around the living eyes */}
                  <path d="M158 212 q14 -7 28 -1" stroke="#8a5a38" strokeWidth="2.2" fill="none" opacity=".3" />
                  <path d="M214 211 q14 -6 28 1" stroke="#7c4f30" strokeWidth="2.2" fill="none" opacity=".38" />
                  <path d="M160 230 q12 7 24 2" stroke="#a06e48" strokeWidth="1.4" fill="none" opacity=".45" />
                  <path d="M216 232 q12 5 24 -2" stroke="#8a5a38" strokeWidth="1.4" fill="none" opacity=".5" />
                  <path d="M163 236 q10 4 19 1" stroke="#a06e48" strokeWidth="1" fill="none" opacity=".28" />
                  {/* the cheeks and nose of a man who takes his dram medicinally */}
                  <ellipse cx="165" cy="247" rx="12" ry="8.5" fill="#c25a40" opacity=".26" />
                  <ellipse cx="235" cy="247" rx="12" ry="8.5" fill="#b04e38" opacity=".3" />
                  <path d="M192 246 q-4 -22 8 -32 q12 10 8 32 q-2 9 -8 10 q-6 -1 -8 -10z" fill="#dda471" />
                  <path d="M200 216 q-5 18 -8 26 q3 8 8 8 q5 0 8 -8 q-3 -8 -8 -26z" fill="#cf9464" opacity=".85" />
                  <path d="M190 242 q4 7 10 7 q6 0 10 -7" stroke="#96603a" strokeWidth="1.3" fill="none" opacity=".65" />
                  <ellipse cx="197" cy="246" rx="4.5" ry="3.4" fill="#c96a4a" opacity=".36" />
                  <ellipse cx="194" cy="228" rx="3" ry="7" fill="#ffdfae" opacity=".32" />
                  <path d="M186 246 q-2 3 -4 4 M214 246 q2 3 4 4" stroke="#96603a" strokeWidth="1.1" fill="none" opacity=".55" />
                  <path d="M180 252 q-6 10 -4 18 M220 252 q6 10 4 18" stroke="#96603a" strokeWidth="1.2" fill="none" opacity=".45" />
                  {/* THE BEARD — one man, one beard: sideburn to jaw to chin, whole */}
                  <path d="M149 224 q-5 34 9 56 q8 13 20 20 l7 -11 q-15 -18 -15 -43 q0 -12 -6 -24z" fill={`url(#${gradient("beard")})`} />
                  <path d="M251 224 q5 34 -9 56 q-8 13 -20 20 l-7 -11 q15 -18 15 -43 q0 -12 6 -24z" fill={`url(#${gradient("beard")})`} />
                  <path d="M164 274 q14 16 36 16 q22 0 36 -16 q9 16 3 31 q-10 23 -39 23 q-29 0 -39 -23 q-6 -15 3 -31z" fill={`url(#${gradient("beard")})`} />
                  <path d="M176 296 q24 14 48 0 q-6 14 -24 15 q-18 -1 -24 -15z" fill="#8f877a" opacity=".3" />
                  <path d="M172 290 q5 13 12 19 M228 290 q-5 13 -12 19 M200 306 v16 M187 300 q2 9 6 13 M213 300 q-2 9 -6 13" stroke="#b8b09d" strokeWidth="1.2" fill="none" opacity=".65" />
                  {/* moustache, framing the mouth without gagging the actor */}
                  <path d="M199 252 q-15 -3 -25 8 q-6 7 -3 13 q5 -6 12 -7 q9 -1 16 3 z" fill={`url(#${gradient("beard")})`} />
                  <path d="M201 252 q15 -3 25 8 q6 7 3 13 q-5 -6 -12 -7 q-9 -1 -16 3 z" fill={`url(#${gradient("beard")})`} />
                  <path d="M178 266 q-3 4 -2 7 M222 266 q3 4 2 7" stroke="#cfc8b8" strokeWidth="1.4" fill="none" opacity=".8" />
                  <g>
                    <path
                      ref={(el) => { mouthRefs.current.rest = el; }}
                      d="M186 272 q14 6 28 0" fill="none" stroke="#7c4638" strokeWidth="2.4" strokeLinecap="round"
                    />
                    <ellipse
                      ref={(el) => { mouthRefs.current.open = el; }}
                      cx="200" cy="274" rx="9" ry="6.5" fill="#4a2620" style={{ display: "none" }}
                    />
                    <path
                      ref={(el) => { mouthRefs.current.smile = el; }}
                      d="M184 270 q16 12 32 0" fill="none" stroke="#7c4638" strokeWidth="2.4" strokeLinecap="round" style={{ display: "none" }}
                    />
                    <path
                      ref={(el) => { mouthRefs.current.press = el; }}
                      d="M187 272 h26" fill="none" stroke="#7c4638" strokeWidth="2.2" strokeLinecap="round" style={{ display: "none" }}
                    />
                  </g>
                  {/* (nose painted with the face above; nothing may cover the mouth) */}
                  {/* Eyes. The old ones read as a mascot because they were
                      big, round, evenly bright and perfectly symmetrical. These
                      are smaller, almond, set deep in shadow, with the sclera
                      shaded top-down so the lid reads as having weight. The
                      gaze groups keep their original centres so the spring rig
                      is untouched. */}
                  <g>
                    <path d="M162 220.5 q10 -8.5 20.5 -0.5 q-10 7.5 -20.5 0.5 z" fill="#0f0b07" opacity=".55" />
                    <path d="M162.6 220.4 q9.6 -7.8 19.4 -0.4 q-9.6 6.9 -19.4 0.4 z" fill="#efe7d6" />
                    <path d="M162.6 220.4 q9.6 -7.8 19.4 -0.4 q-4 1.4 -9.6 1.6 q-6 .2 -9.8 -1.2 z" fill="#c9bda6" opacity=".55" />
                    <g ref={gazeLRef}>
                      <circle cx="172" cy="220" r="4.1" fill="#5a4a34" />
                      <circle cx="172" cy="220" r="4.1" fill="none" stroke="#2a1d10" strokeWidth=".9" opacity=".8" />
                      <circle cx="172" cy="220.4" r="2" fill="#0b0805" />
                      <circle cx="173.4" cy="218.5" r=".95" fill="#fff8e6" opacity=".95" />
                      <circle cx="170.6" cy="221.6" r=".5" fill="#c98a3e" opacity=".5" />
                    </g>
                    {/* upper lash line, heaviest at the outer corner */}
                    <path d="M161.8 220.4 q10 -8.6 20.6 -0.6" fill="none" stroke="#3d2b18" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M163 224.4 q9 3.6 18.4 -1.2" fill="none" stroke="#a37d55" strokeWidth=".9" opacity=".65" />
                    <rect className="convener-lid" ref={lidLRef} x="161" y="212" width="22" height="9.6" fill={`url(#${gradient("skin")})`} style={{ transformOrigin: "172px 213px" }} />
                  </g>
                  <g>
                    <path d="M238 220.5 q-10 -8.5 -20.5 -0.5 q10 7.5 20.5 0.5 z" fill="#0f0b07" opacity=".62" />
                    <path d="M237.4 220.4 q-9.6 -7.8 -19.4 -0.4 q9.6 6.9 19.4 0.4 z" fill="#e7dfcd" />
                    <path d="M237.4 220.4 q-9.6 -7.8 -19.4 -0.4 q4 1.4 9.6 1.6 q6 .2 9.8 -1.2 z" fill="#bfb299" opacity=".6" />
                    <g ref={gazeRRef}>
                      <circle cx="228" cy="220" r="4.1" fill="#54452f" />
                      <circle cx="228" cy="220" r="4.1" fill="none" stroke="#2a1d10" strokeWidth=".9" opacity=".8" />
                      <circle cx="228" cy="220.4" r="2" fill="#0b0805" />
                      <circle cx="229.4" cy="218.5" r=".8" fill="#fff8e6" opacity=".8" />
                    </g>
                    <path d="M238.2 220.4 q-10 -8.6 -20.6 -0.6" fill="none" stroke="#3d2b18" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M237 224.4 q-9 3.6 -18.4 -1.2" fill="none" stroke="#96714b" strokeWidth=".9" opacity=".6" />
                    <rect className="convener-lid" ref={lidRRef} x="217" y="212" width="22" height="9.6" fill={`url(#${gradient("skin")})`} style={{ transformOrigin: "228px 213px" }} />
                  </g>
                  <g className="convener-brow is-left">
                    <path d="M155 208 q15 -11 30 -4" fill="none" stroke="#e6e0d2" strokeWidth="6.5" strokeLinecap="round" />
                    <path d="M158 204 q10 -6 20 -5" fill="none" stroke="#f5f1e6" strokeWidth="3" strokeLinecap="round" />
                    <path d="M153 211 q6 -4 12 -4" fill="none" stroke="#cfc8b8" strokeWidth="2.2" strokeLinecap="round" />
                  </g>
                  <g className="convener-brow is-right">
                    <path d="M245 208 q-15 -11 -30 -4" fill="none" stroke="#e6e0d2" strokeWidth="6.5" strokeLinecap="round" />
                    <path d="M242 204 q-10 -6 -20 -5" fill="none" stroke="#f5f1e6" strokeWidth="3" strokeLinecap="round" />
                    <path d="M247 211 q-6 -4 -12 -4" fill="none" stroke="#cfc8b8" strokeWidth="2.2" strokeLinecap="round" />
                  </g>
                  {/* hair: swept back, thinning at the crown, wisps at the temples */}
                  <path d="M152 200 q-13 -11 -9 -30 q5 -23 28 -30 q-13 20 -6 31 q-9 11 -13 29z" fill={`url(#${gradient("beard")})`} />
                  <path d="M248 200 q13 -11 9 -30 q-5 -23 -28 -30 q13 20 6 31 q9 11 13 29z" fill={`url(#${gradient("beard")})`} />
                  <path d="M160 170 q-3 -25 21 -35 q19 -8 43 -3 q21 5 27 24 q4 10 1 19 q-12 -14 -30 -15 q-32 -3 -46 3 q-12 5 -16 7z" fill={`url(#${gradient("beard")})`} />
                  <path d="M166 158 q12 -14 34 -15 M212 142 q14 5 21 15 M158 176 q-3 8 -2 16" fill="none" stroke="#f7f4ea" strokeWidth="2.4" strokeLinecap="round" opacity=".8" />
                  <path d="M176 146 q22 -8 46 -2" stroke="#b5ac99" strokeWidth="1.4" fill="none" opacity=".55" />
                  <path d="M150 192 q-7 9 -5 20 M250 192 q7 9 5 20" stroke="#d8d2c4" strokeWidth="3.6" fill="none" strokeLinecap="round" />
                </g>
              </g>
              {/* ---- the two candles, in front of him ---- */}
              {/* Left: nearer, taller, the key light on his right cheek. */}
              <g>
                <ellipse className="convener-glow" ref={glowLRef} cx="96" cy="286" rx="96" ry="104" fill={`url(#${gradient("bloom")})`} opacity=".55" />
                <path d="M84 396 v-86 q0 -7 12 -7 q12 0 12 7 v86 z" fill={`url(#${gradient("wax")})`} />
                <path d="M84 316 q7 12 3 22 q-5 11 1 20" fill="none" stroke="#f2e8d2" strokeWidth="4" strokeLinecap="round" opacity=".75" />
                <path d="M108 322 q-6 14 -1 26" fill="none" stroke="#cbbda0" strokeWidth="3" strokeLinecap="round" opacity=".6" />
                <ellipse cx="96" cy="303" rx="12" ry="4" fill="#f6efdc" />
                <ellipse cx="96" cy="303" rx="7.5" ry="2.4" fill="#8a7a5e" />
                <path d="M96 303 v-9" stroke="#2b2118" strokeWidth="1.8" strokeLinecap="round" />
                <path
                  className="convener-flame"
                  ref={flameLRef}
                  d="M96 296 c-9 -10 -8 -24 0 -38 c8 14 9 28 0 38 z"
                  fill={`url(#${gradient("flame")})`}
                />
                <path d="M96 294 c-4 -6 -3.5 -14 0 -22 c3.5 8 4 16 0 22 z" fill="#fff6d8" opacity=".95" />
              </g>
              {/* Right: further, shorter, the cool fill that keeps him round. */}
              <g>
                <ellipse className="convener-glow" ref={glowRRef} cx="306" cy="316" rx="78" ry="86" fill={`url(#${gradient("bloom")})`} opacity=".42" />
                <path d="M296 396 v-58 q0 -6 10 -6 q10 0 10 6 v58 z" fill={`url(#${gradient("wax")})`} />
                <path d="M296 344 q6 10 2 19" fill="none" stroke="#efe4cc" strokeWidth="3.4" strokeLinecap="round" opacity=".7" />
                <ellipse cx="306" cy="332" rx="10" ry="3.4" fill="#f6efdc" />
                <ellipse cx="306" cy="332" rx="6" ry="2" fill="#8a7a5e" />
                <path d="M306 332 v-7" stroke="#2b2118" strokeWidth="1.6" strokeLinecap="round" />
                <path
                  className="convener-flame"
                  ref={flameRRef}
                  d="M306 326 c-7 -8 -6.5 -19 0 -30 c6.5 11 7 22 0 30 z"
                  fill={`url(#${gradient("flame")})`}
                />
                <path d="M306 324 c-3 -5 -2.6 -11 0 -17 c2.6 6 3 12 0 17 z" fill="#fff6d8" opacity=".92" />
              </g>

              {/* Motes drifting through the light — the cheapest thing that
                  reads as "air in the room" rather than "flat artwork". */}
              <g className="convener-motes" aria-hidden="true">
                <circle cx="126" cy="250" r="1.5" fill="#ffe6b4" />
                <circle cx="168" cy="196" r="1.1" fill="#ffdca0" />
                <circle cx="243" cy="228" r="1.3" fill="#ffe6b4" />
                <circle cx="286" cy="176" r="1" fill="#ffd88f" />
                <circle cx="205" cy="128" r="1.2" fill="#ffe6b4" />
                <circle cx="141" cy="150" r="0.9" fill="#ffdca0" />
              </g>

              {/* Everything above sits inside the dark. */}
              <rect x="58" y="40" width="284" height="356" fill={`url(#${gradient("vignette")})`} />
              <rect
                x="58" y="40" width="284" height="356"
                filter={`url(#${gradient("grain")})`}
                opacity=".07"
                style={{ mixBlendMode: "overlay" }}
              />

              <g stroke="#000" strokeWidth=".6" fill="none" opacity=".16">
                <path d="M70 90 q30 8 44 -6 q20 12 34 2 M300 120 q-16 10 -30 4 M90 330 q24 -6 40 6 M270 350 q20 -10 40 -2 M120 60 q10 14 30 10" />
              </g>
              <rect x="58" y="40" width="284" height="356" rx="3" fill="none" stroke="#000" strokeOpacity=".55" strokeWidth="10" style={{ filter: "blur(6px)" }} />
            </g>

            {/* plaque */}
            <g>
              <rect x="118" y="418" width="164" height="40" rx="4" fill={`url(#${gradient("plaque")})`} stroke="#4a3410" strokeWidth="1.6" />
              <text x="200" y="435" textAnchor="middle" fontFamily="Georgia, serif" fontSize="12.5" letterSpacing="2.4" fill="#3a2708" style={{ fontVariant: "small-caps" }}>Ye Auld Convener</text>
              <text x="200" y="450" textAnchor="middle" fontFamily="Georgia, serif" fontSize="9.5" letterSpacing="3" fill="#5c421a">· PATRON O’ THE HALL ·</text>
            </g>
          </svg>
        </button>

        <div
          className={`convener-speech${quip ? " is-quip" : ""}`}
          onClick={skipTyping}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              skipTyping();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Skip to the end of the Convener's line"
        >
          <p className="convener-speech-who">Ye Auld Convener · first o’ the Deacons</p>
          <p className="convener-speech-text" aria-hidden="true">
            <span ref={typedRef} />
            {speaking ? <span className="convener-caret">▌</span> : null}
          </p>
        </div>
        {/* Outside the speech box on purpose: that box is itself a button that
            skips the line, and a control nested in a control is a click the
            visitor cannot aim. */}
        <button
          type="button"
          className="convener-mute"
          onClick={toggleVoiceMuted}
          aria-pressed={voiceMuted}
          aria-label={voiceMuted ? "Let the Convener speak aloud" : "Silence the Convener's voice"}
          title={voiceMuted ? "Let him speak" : "Silence him"}
        >
          <span aria-hidden="true">{voiceMuted ? "🔇" : "🔊"}</span>
        </button>
        <p className="convener-sr-only" role="status" aria-live="polite" ref={liveRef} />
      </div>
    );
  },
);
