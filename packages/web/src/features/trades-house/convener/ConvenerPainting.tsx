// -----------------------------------------------------------------------------
// The Convener as a PAINTING rather than as markup.
//
// The SVG portrait is ~1100 lines of hand-authored paths and it reads as flat
// vector however much it is polished, because a convincing painted face needs
// hundreds of soft overlapping tonal shapes and markup is the wrong tool for
// that. This skin hangs the painting instead, and spends its effort on making
// it ALIVE — which is the part markup is genuinely good at.
//
// It implements the same ConvenerHandle, so it is a drop-in swap and nothing
// that drives him needs to know which skin is mounted.
//
// The life is four things, all cheap, all on one rAF loop:
//
//   FOLLOW   a small 3D rotation toward the pointer. Not eyes darting about —
//            the whole head turning a couple of degrees, which is what actually
//            reads as a portrait noticing you. Painted eyes are far too subtle
//            to replace with drawn ones; every attempt looks worse than the
//            still it replaced.
//   BREATH   a scale oscillation of a fraction of a percent. Invisible when you
//            look straight at it, and the whole difference between a person and
//            a JPEG.
//   CANDLE   warm light drifting on his lit side, in the direction the painter
//            already lit him from.
//   SPEECH   while a line plays the light lifts and the head carries a slow nod,
//            so the stillness of a painting does not fight the movement of a
//            voice.
// -----------------------------------------------------------------------------

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useMediaQuery } from "../../../hooks/use-media-query.js";
import {
  GAZE_FOLLOW_OMEGA,
  GAZE_GLANCE_OMEGA,
  isSpringSettled,
  stepCriticallyDampedSpring,
  type GazeRect,
  type SpringState,
} from "./convener-gaze.js";
import {
  displayCharsSpokenBy,
  getConvenerVoicePlayer,
  isConvenerVoiceMuted,
  loadConvenerVoice,
  type ConvenerVoiceLine,
} from "./convener-voice.js";
import type { ConvenerHandle, ConvenerMouth, ConvenerSayOptions } from "./ConvenerPortrait.js";
import "./ConvenerPainting.css";

/** Degrees of head turn at the far edge of the viewport. Two is plenty: past
 *  about three the flat canvas starts to shear and betrays that it is a plane. */
const TURN_MAX_DEG = 2.1;
/** Parallax of the canvas inside its frame, in px — depth without distortion. */
const SHIFT_MAX_PX = 7;
const TYPE_DEFAULT_CPS = 42;
const TYPE_HOLD_DEFAULT_MS = 900;
const BREATH_PERIOD_MS = 5_400;
const ASIDE_GAP_MS = 900;

interface ConvenerPaintingProps {
  readonly compact?: boolean;
  readonly className?: string;
  readonly restingLine?: string | null;
  readonly onSkip?: () => void;
}

export const ConvenerPainting = forwardRef<ConvenerHandle, ConvenerPaintingProps>(
  function ConvenerPainting(
    { compact = false, className, restingLine = null, onSkip },
    handleRef,
  ): ReactElement {
    const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
    const [speaking, setSpeaking] = useState(false);

    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const typedRef = useRef<HTMLSpanElement>(null);
    const liveRef = useRef<HTMLParagraphElement>(null);

    // Hot path: refs only. None of this may cause a render.
    const xRef = useRef<SpringState>({ value: 0, velocity: 0 });
    const yRef = useRef<SpringState>({ value: 0, velocity: 0 });
    const targetRef = useRef({ x: 0, y: 0 });
    const omegaRef = useRef(GAZE_FOLLOW_OMEGA);
    const rectRef = useRef<GazeRect | null>(null);
    const speakingRef = useRef(false);
    const reducedRef = useRef(reducedMotion);
    reducedRef.current = reducedMotion;

    const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const voiceRafRef = useRef<number | null>(null);
    const resolveRef = useRef<(() => void) | null>(null);
    const fullTextRef = useRef("");
    const linesRef = useRef<ReadonlyMap<string, ConvenerVoiceLine> | null>(null);

    useEffect(() => {
      let live = true;
      void loadConvenerVoice().then((index) => { if (live) linesRef.current = index; });
      return () => { live = false; };
    }, []);

    const finishSay = useCallback((): void => {
      if (typeTimerRef.current !== null) clearInterval(typeTimerRef.current);
      typeTimerRef.current = null;
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      if (voiceRafRef.current !== null) cancelAnimationFrame(voiceRafRef.current);
      voiceRafRef.current = null;
      speakingRef.current = false;
      setSpeaking(false);
      const resolve = resolveRef.current;
      resolveRef.current = null;
      resolve?.();
    }, []);

    const armHold = useCallback((ms: number): void => {
      if (holdTimerRef.current !== null) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        finishSay();
      }, ms);
    }, [finishSay]);

    const runTypewriter = useCallback((
      full: string,
      opts: ConvenerSayOptions | undefined,
      hold: number,
    ): void => {
      if (reducedRef.current) {
        if (typedRef.current !== null) typedRef.current.textContent = full;
        armHold(hold + Math.round((full.length * 1_000) / (opts?.cps ?? TYPE_DEFAULT_CPS)));
        return;
      }
      const cps = opts?.cps ?? TYPE_DEFAULT_CPS;
      let shown = 0;
      if (typedRef.current !== null) typedRef.current.textContent = "";
      typeTimerRef.current = setInterval(() => {
        shown += 1;
        if (typedRef.current !== null) typedRef.current.textContent = full.slice(0, shown);
        if (shown >= full.length) {
          if (typeTimerRef.current !== null) clearInterval(typeTimerRef.current);
          typeTimerRef.current = null;
          armHold(hold);
        }
      }, Math.max(8, Math.round(1_000 / cps)));
    }, [armHold]);

    const say = useCallback((text: string, options?: ConvenerSayOptions): Promise<void> => {
      finishSay();
      fullTextRef.current = text;
      speakingRef.current = true;
      setSpeaking(true);
      if (options?.announce !== false && liveRef.current !== null) liveRef.current.textContent = text;
      const holdMs = options?.holdMs ?? TYPE_HOLD_DEFAULT_MS;

      return new Promise<void>((resolve) => {
        resolveRef.current = resolve;
        const line = linesRef.current?.get(text);
        const player = getConvenerVoicePlayer();

        // With audio the typewriter runs on the audio's own clock, so the words
        // appear exactly as he says them. Without it, on a rate.
        if (line !== undefined && !isConvenerVoiceMuted() && player.supported) {
          void player.play(line).then((audio) => {
            if (audio === null) { runTypewriter(text, options, holdMs); return; }
            const times = line.charStartTimesMs;
            const step = (): void => {
              if (typedRef.current !== null) {
                const ms = audio.currentTime * 1_000;
                typedRef.current.textContent = text.slice(0, displayCharsSpokenBy(times, ms, text.length));
              }
              if (audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration)) {
                voiceRafRef.current = null;
                if (typedRef.current !== null) typedRef.current.textContent = text;
                armHold(holdMs);
                return;
              }
              voiceRafRef.current = requestAnimationFrame(step);
            };
            voiceRafRef.current = requestAnimationFrame(step);
          });
          return;
        }
        runTypewriter(text, options, holdMs);
      });
    }, [armHold, finishSay, runTypewriter]);

    /** Speaks without touching the bubble — his reply lives in its own panel. */
    const speakAsideRef = useRef<((text: string, then?: string | null) => void) | null>(null);
    const speakAside = useCallback((text: string, then: string | null = null): void => {
      const line = linesRef.current?.get(text);
      const player = getConvenerVoicePlayer();
      if (line === undefined || isConvenerVoiceMuted() || !player.supported) return;
      speakingRef.current = true;
      setSpeaking(true);
      void player.play(line).then((audio) => {
        if (audio === null) { speakingRef.current = false; setSpeaking(false); return; }
        const done = (): void => {
          audio.removeEventListener("ended", done);
          speakingRef.current = false;
          setSpeaking(false);
          // Chained, never concurrent: two of him talking at once is a haunting.
          if (then !== null && then !== "") {
            setTimeout(() => { speakAsideRef.current?.(then); }, ASIDE_GAP_MS);
          }
        };
        audio.addEventListener("ended", done);
      });
    }, []);
    speakAsideRef.current = speakAside;

    const measuredRect = useCallback((): GazeRect | null => {
      if (rectRef.current === null && rootRef.current !== null) {
        const r = rootRef.current.getBoundingClientRect();
        rectRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
      }
      return rectRef.current;
    }, []);

    const glanceAt = useCallback((clientX: number, clientY: number): void => {
      const rect = measuredRect();
      if (rect === null) return;
      omegaRef.current = GAZE_GLANCE_OMEGA;
      const clamp = (n: number): number => Math.max(-1, Math.min(1, n));
      targetRef.current = {
        x: clamp((clientX - (rect.left + rect.width / 2)) / (rect.width * 1.6)),
        y: clamp((clientY - (rect.top + rect.height / 2)) / (rect.height * 1.6)),
      };
    }, [measuredRect]);

    useImperativeHandle(handleRef, (): ConvenerHandle => ({
      say,
      speakAside,
      glanceAt,
      // A painting holds one expression. That is the honest trade for having a
      // face worth looking at; these stay so the swap is total.
      express: (_mouth: ConvenerMouth, _ms?: number): void => undefined,
      setMull: (): void => undefined,
      setLean: (): void => undefined,
    }), [glanceAt, say, speakAside]);

    // ---- the single rAF loop: follow, breathe, and the speaking nod ----
    useEffect(() => {
      if (reducedMotion) {
        canvasRef.current?.style.setProperty("transform", "none");
        return undefined;
      }
      let last = performance.now();
      let raf = 0;
      const tick = (ts: number): void => {
        const dt = Math.min(0.05, (ts - last) / 1_000);
        last = ts;
        const omega = omegaRef.current;
        xRef.current = stepCriticallyDampedSpring(xRef.current, targetRef.current.x, omega, dt);
        yRef.current = stepCriticallyDampedSpring(yRef.current, targetRef.current.y, omega, dt);
        if (isSpringSettled(xRef.current, targetRef.current.x)) omegaRef.current = GAZE_FOLLOW_OMEGA;

        const breath = Math.sin(((ts % BREATH_PERIOD_MS) / BREATH_PERIOD_MS) * Math.PI * 2);
        const nod = speakingRef.current ? Math.sin(ts / 260) * 0.22 : 0;

        const el = canvasRef.current;
        if (el !== null) {
          const ry = xRef.current.value * TURN_MAX_DEG;
          const rx = -yRef.current.value * TURN_MAX_DEG * 0.7 + nod;
          const tx = -xRef.current.value * SHIFT_MAX_PX;
          const ty = -yRef.current.value * SHIFT_MAX_PX * 0.6 + breath * 1.2;
          el.style.transform =
            `rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg) `
            + `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) `
            + `scale(${(1 + breath * 0.0016).toFixed(5)})`;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => { cancelAnimationFrame(raf); };
    }, [reducedMotion]);

    // He follows the pointer ANYWHERE on the page, not only over the options.
    // That is the whole trick of a portrait that watches you: it has to notice
    // the cursor crossing the room, not just the cursor arriving at a button.
    useEffect(() => {
      const passive = { passive: true } as const;
      const invalidate = (): void => { rectRef.current = null; };
      const onPointerMove = (event: PointerEvent): void => {
        omegaRef.current = GAZE_FOLLOW_OMEGA;
        const rect = measuredRect();
        if (rect === null) return;
        const clamp = (n: number): number => Math.max(-1, Math.min(1, n));
        targetRef.current = {
          x: clamp((event.clientX - (rect.left + rect.width / 2)) / (rect.width * 1.35)),
          y: clamp((event.clientY - (rect.top + rect.height / 2)) / (rect.height * 1.35)),
        };
      };
      document.addEventListener("pointermove", onPointerMove, passive);
      window.addEventListener("resize", invalidate, passive);
      window.addEventListener("scroll", invalidate, { passive: true, capture: true });
      return () => {
        document.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("resize", invalidate);
        window.removeEventListener("scroll", invalidate, { capture: true });
      };
    }, [measuredRect]);

    // He returns to the scene after any self-initiated theatre: on a narrow
    // screen his bubble is the ONLY rendering of the prompt, so wandering off
    // script must never leave the question lost.
    useEffect(() => {
      if (restingLine === null || restingLine === "") return;
      void say(restingLine);
    }, [restingLine, say]);

    return (
      <div
        className={`convener-painting${compact ? " is-compact" : ""}${speaking ? " is-speaking" : ""}${className === undefined ? "" : ` ${className}`}`}
        ref={rootRef}
      >
        <div className="convener-painting-stage">
          <div className="convener-painting-canvas" ref={canvasRef}>
            <picture>
              <source
                type="image/webp"
                srcSet="/trades-house-media/assets/convener-portrait-900.webp 900w, /trades-house-media/assets/convener-portrait-1100.webp 1100w"
                sizes="(max-width: 979px) 92vw, 34vw"
              />
              <img
                src="/trades-house-media/assets/convener-portrait-1100.jpg"
                alt="An oil portrait of the Convener, in tartan and half-armour, watching from the wall."
                draggable={false}
              />
            </picture>
            {/* Candlelight on the side the painter already lit him from. */}
            <div className="convener-painting-candle" aria-hidden="true" />
            {/* The painted nameplate is blank. Ours goes in it. */}
            <div className="convener-painting-plate" aria-hidden="true">The Convener</div>
          </div>
        </div>

        <div className="convener-painting-speech" data-speaking={speaking ? "true" : "false"}>
          <p className="convener-painting-typed"><span ref={typedRef} /></p>
          <button
            type="button"
            className="convener-painting-skip"
            onClick={() => {
              if (!speakingRef.current) return;
              onSkip?.();
              if (typedRef.current !== null) typedRef.current.textContent = fullTextRef.current;
              getConvenerVoicePlayer().stop();
              finishSay();
            }}
          >
            Skip
          </button>
        </div>
        <p className="convener-painting-live" aria-live="polite" ref={liveRef} />
      </div>
    );
  },
);
