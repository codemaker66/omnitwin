import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { OptionSeal } from "../features/trades-house/OptionSeal.js";
import { ConvenerPortrait, type ConvenerHandle } from "../features/trades-house/convener/ConvenerPortrait.js";
import { ConvenerPainting } from "../features/trades-house/convener/ConvenerPainting.js";

/**
 * Which skin of him is mounted. The painting is a real oil portrait with the
 * life added in CSS; the SVG is the hand-authored original. Both satisfy
 * ConvenerHandle, so everything that drives him is indifferent to the choice.
 *
 * Switchable by query string ONLY so the two can be judged against each other
 * on the same screen and the same lines: /quiz?convener=svg
 */
const Convener: typeof ConvenerPortrait = (() => {
  if (typeof window === "undefined") return ConvenerPainting;
  const asked = new URLSearchParams(window.location.search).get("convener");
  return asked === "svg" ? ConvenerPortrait : ConvenerPainting;
})();
import {
  completedRuns,
  loadConvenerVoice,
  recordCompletedRun,
  unlockConvenerVoice,
} from "../features/trades-house/convener/convener-voice.js";
import {
  observePlay,
  type Observation,
  type ObservationId,
} from "../features/trades-house/convener/convener-observations.js";
import {
  CONVENER_DELIBERATION,
  CONVENER_THRESHOLD,
  CONVENER_DELIBERATION_BEAT_MS,
  convenerReaction,
} from "../features/trades-house/convener/convener-lines.js";
import { useMediaQuery } from "../hooks/use-media-query.js";
import {
  CRAFT_ORDER,
  CRAFT_PROFILES,
  CRAFT_QUESTIONS,
  applyCraftQuizAnswer,
  buildCraftIntroductionMailto,
  ZERO_AXIS_TOTALS,
  rankCrafts,
  type AxisTotals,
  type AxisVector,
  type CraftId,
  type CraftRankingEntry,
} from "../features/trades-house/craft-quiz-model.js";
import "./TradesHouseCraftQuizPage.css";

type QuizScreen = "intro" | "threshold" | "question" | "weighing" | "result";

function railLabel(name: string): string {
  return name.replace(/^THE\s+/u, "");
}

interface CraftRailProps {
  readonly craftIds: readonly CraftId[];
  readonly side: "left" | "right";
}

function CraftRail({ craftIds, side }: CraftRailProps): ReactElement {
  return (
    <aside className={`craft-quiz-rail is-${side}`} aria-label={`${side} Craft crests`}>
      {craftIds.map((craftId) => {
        const craft = CRAFT_PROFILES[craftId];
        const label = railLabel(craft.name);
        return (
          <div className={`craft-quiz-rail-item${label.length > 12 ? " is-long" : ""}`} key={craftId}>
            <img data-testid="craft-rail-crest" src={craft.crest} alt={craft.name} />
            <span>{label}</span>
            <i aria-hidden="true">◆</i>
          </div>
        );
      })}
    </aside>
  );
}

interface IntroScreenProps {
  readonly onBegin: () => void;
}

function IntroScreen({ onBegin }: IntroScreenProps): ReactElement {
  return (
    <section className="craft-quiz-intro" aria-labelledby="craft-quiz-title">
      <CraftRail craftIds={CRAFT_ORDER.slice(0, 7)} side="left" />
      <CraftRail craftIds={CRAFT_ORDER.slice(7)} side="right" />
      <div className="craft-quiz-intro-core">
        <div className="craft-quiz-achievement-wrap">
          {/* Desktop shows the arms ALONE — achievement.png has the gold
              building engraving fused above the shield, and arms-over-
              architecture reads as collage at invitation scale. */}
          <picture>
            <source media="(min-width: 1180px)" srcSet="/trades-house-media/assets/crest-sm.png" />
            <img
              className="craft-quiz-achievement"
              src="/trades-house-media/assets/achievement.png"
              alt="Trades House of Glasgow — Union is Strength"
            />
          </picture>
        </div>
        <h1 id="craft-quiz-title" aria-label="Which Craft is yours?">
          <span>Which&nbsp;</span>
          <strong>Craft</strong>
          <br className="craft-quiz-title-break" aria-hidden="true" />
          <span>is yours?</span>
        </h1>
        <div className="craft-quiz-divider" aria-hidden="true"><i>❖</i></div>
        <p>{CRAFT_QUESTIONS.length} questions · four centuries · one fellowship</p>
        <button type="button" className="craft-quiz-begin" onClick={onBegin} aria-label="Begin the Craft quiz">
          Begin
        </button>
        <p className="craft-quiz-intro-foot">Your journey into Glasgow’s living heritage</p>
      </div>
    </section>
  );
}

interface QuizProgressProps {
  readonly activeIndex: number;
}

function QuizProgress({ activeIndex }: QuizProgressProps): ReactElement {
  return (
    <div className="craft-quiz-progress" aria-hidden="true">
      {CRAFT_QUESTIONS.map((question, index) => (
        <span className={index <= activeIndex ? "is-lit" : ""} data-active={index === activeIndex} key={question.title}>
          ⚜︎{index < CRAFT_QUESTIONS.length - 1 ? <i>◆</i> : null}
        </span>
      ))}
    </div>
  );
}

/** Halfway through, the Chain names the two Crafts it is torn between. */
function midQuizOmen(totals: AxisTotals, questionIndex: number): string | null {
  if (questionIndex !== Math.floor(CRAFT_QUESTIONS.length / 2)) return null;
  const [first, second] = rankCrafts(totals);
  if (first === undefined || second === undefined) return null;
  return `The Chain senses ${first.profile.omen} and ${second.profile.omen}. It is not yet decided.`;
}

interface QuestionScreenProps {
  readonly questionIndex: number;
  readonly totals: AxisTotals;
  readonly onAnswer: (optionIndex: number) => void;
  /** The option just chosen; locks the set while the Convener reacts. */
  readonly pickedIndex: number | null;
  /** The Convener glances at whichever option the pointer is weighing. */
  readonly onOptionHover: (clientX: number, clientY: number) => void;
  /**
   * Narrow viewports show the four leads only and open one at a time. Four
   * priced options and a scene cannot share a phone without either scrolling
   * or type too small to read, and a consequential choice deserves the second
   * tap anyway — the accordion is a confirm step, not just a space saver.
   */
  readonly compact: boolean;
  /** His reply to the answer just given, or null while the scene is open. */
  readonly reply: string | null;
  readonly onContinue: () => void;
  /** Occasionally, what he has noticed about HOW you are answering. */
  readonly observation: Observation | null;
}

function QuestionScreen({
  questionIndex,
  totals,
  onAnswer,
  pickedIndex,
  onOptionHover,
  compact,
  reply,
  onContinue,
  observation,
}: QuestionScreenProps): ReactElement {
  const question = CRAFT_QUESTIONS[questionIndex];
  if (question === undefined) throw new RangeError(`Question ${String(questionIndex)} is unavailable.`);
  const omen = midQuizOmen(totals, questionIndex);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  // A new scene arrives closed, so nobody answers the last question's shape.
  useEffect(() => { setOpenIndex(null); }, [questionIndex]);

  // Move focus to Continue when he replies: a keyboard user should not have to
  // hunt for the only live control on the screen.
  useEffect(() => {
    if (reply !== null) continueRef.current?.focus();
  }, [reply]);

  return (
    <section className="craft-quiz-question" aria-labelledby="craft-question-title">
      <p className="craft-quiz-sr-only" role="status" aria-live="polite">Question {questionIndex + 1} of {CRAFT_QUESTIONS.length}</p>
      <QuizProgress activeIndex={questionIndex} />
      <p className="craft-quiz-question-count">QUESTION {questionIndex + 1} OF {CRAFT_QUESTIONS.length}</p>
      {omen === null ? null : <p className="craft-quiz-omen">{omen}</p>}
      {/* The Convener speaks this aloud; on narrow viewports his bubble is its
          only visible rendering, so it stays in the tree either way. */}
      <h1 id="craft-question-title">{question.scene}</h1>
      <div className={`craft-quiz-options${compact ? " is-accordion" : ""}${reply === null ? "" : " is-replying"}`}>
        {question.options.map((option, optionIndex) => {
          const picked = pickedIndex === optionIndex;
          const faded = pickedIndex !== null && !picked;
          const open = !compact || openIndex === optionIndex;
          return (
            /* aria-disabled, NOT disabled: disabling the focused button drops
               keyboard focus to <body> on every answer. answerQuestion() is
               the real re-entry guard; this is the accessible signal. */
            <button
              type="button"
              className={`craft-quiz-option${picked ? " is-picked" : ""}${faded ? " is-faded" : ""}${open ? " is-open" : ""}`}
              aria-disabled={pickedIndex !== null}
              aria-expanded={compact ? open : undefined}
              onClick={() => {
                // On a phone the first tap opens the option and the second
                // commits it; on a wide screen one tap does both.
                if (compact && openIndex !== optionIndex) setOpenIndex(optionIndex);
                else onAnswer(optionIndex);
              }}
              onPointerEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onOptionHover(rect.left + rect.width / 2, rect.top + rect.height / 2);
              }}
              key={option.lead}
            >
              <OptionSeal index={optionIndex} />
              <span>
                <strong>{option.lead}</strong>
                {open ? <small>{option.body}</small> : null}
                {/* Naming the price is what keeps the four options equally
                    choosable — remove it and the cheapest one always wins. */}
                {open ? <em className="craft-quiz-option-cost">Costs you: {option.cost}</em> : null}
                {open && compact && reply === null
                  ? <em className="craft-quiz-option-confirm">Tap again to choose</em>
                  : null}
              </span>
            </button>
          );
        })}
      </div>

      {/* His reply gets its own box and stays until YOU move on. Overwriting
          the scene with it, and advancing on a timer, meant the best writing in
          the quiz flashed past unread — and tying the advance to a promise is
          what let a stray say() race the whole quiz to the end. */}
      {reply === null ? null : (
        <div className="craft-quiz-reply" role="group" aria-label="The Convener replies">
          <p className="craft-quiz-reply-who">The Convener</p>
          <p className="craft-quiz-reply-text">{reply}</p>
          {/* Rare by design — twice in twelve scenes, not every answer. He is
              remarking on HOW you answered, so it is set apart from the reply
              to what you answered. */}
          {observation === null ? null : (
            <p className="craft-quiz-reply-aside" data-observation={observation.id}>
              <span aria-hidden="true">❦</span> {observation.text}
            </p>
          )}
          <button
            type="button"
            className="craft-quiz-continue"
            ref={continueRef}
            onClick={onContinue}
          >
            {questionIndex === CRAFT_QUESTIONS.length - 1 ? "See your Craft" : "Go on"}
          </button>
        </div>
      )}

      <p className="craft-quiz-est">Trades House of Glasgow · Est. 1605</p>
    </section>
  );
}

function ResultLaurel(): ReactElement {
  const leaves: ReactElement[] = [];
  const centre = 135;
  const radius = 100;
  for (let side = 0; side < 2; side += 1) {
    for (let index = 0; index < 11; index += 1) {
      const angle = side === 0 ? 98 + index * 11.5 : 82 - index * 11.5;
      const radians = angle * Math.PI / 180;
      const x = centre + radius * Math.cos(radians);
      const y = 133 + radius * Math.sin(radians);
      const rotation = angle + 90 + (side === 0 ? 24 : -24);
      leaves.push(
        <ellipse
          key={`${String(side)}-${String(index)}`}
          cx={x}
          cy={y}
          rx="4.6"
          ry={13 - index * 0.25}
          transform={`rotate(${String(rotation)} ${String(x)} ${String(y)})`}
        />,
      );
    }
  }
  return <svg className="craft-result-laurel" viewBox="0 0 270 270" aria-hidden="true"><path d="M 62 68 A 100 100 0 1 0 208 68" />{leaves}</svg>;
}

/**
 * Threshold pacing, taken from the recordings rather than guessed. The three
 * beats measure 75, 76 and 84 ms per character in the manifest; the first
 * attempt at this used 42 and advanced the screen while he was still talking,
 * cutting him off mid-sentence every time.
 *
 * 90 sits deliberately above the slowest measured line, because a moment of
 * silence after he finishes costs nothing and a clipped sentence costs the
 * whole effect. Anyone who disagrees has the skip button from the first frame.
 */
const THRESHOLD_BASE_MS = 700;
const THRESHOLD_MS_PER_CHAR = 90;

interface ThresholdScreenProps {
  readonly onReady: () => void;
  readonly compact: boolean;
}

/**
 * The threshold. Pressing BEGIN used to drop the reader straight into a moral
 * dilemma with no idea what the thing was — which is a poor welcome, and it
 * also wastes the one moment when they are certain to be listening.
 *
 * Beats accumulate rather than replace, so someone who cannot hear the audio,
 * or who reads faster than he speaks, still gets the whole explanation. The
 * continue button is present from the first frame: nobody should have to sit
 * through an introduction to reach the thing they came for.
 */
function ThresholdScreen({ onReady, compact }: ThresholdScreenProps): ReactElement {
  const [beat, setBeat] = useState(0);
  const readyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (beat >= CONVENER_THRESHOLD.length - 1) return undefined;
    // Paced off the line's own length rather than a flat interval — the third
    // beat is half again as long as the first, and a fixed timer would either
    // clip it or leave dead air after the short ones.
    const line = CONVENER_THRESHOLD[beat] ?? "";
    const timer = window.setTimeout(() => {
      setBeat((current) => current + 1);
    }, THRESHOLD_BASE_MS + line.length * THRESHOLD_MS_PER_CHAR);
    return () => { window.clearTimeout(timer); };
  }, [beat]);

  useEffect(() => { readyRef.current?.focus(); }, []);

  // His bubble carries the line he is saying NOW; the list carries the ones he
  // has finished. Rendering the current line in both put the same sentence on
  // screen twice, which reads as a bug rather than as emphasis.
  const said = CONVENER_THRESHOLD.slice(0, beat);
  const spoken = CONVENER_THRESHOLD[beat] ?? null;

  return (
    <section className="craft-quiz-threshold" aria-labelledby="craft-threshold-title">
      <h1 className="craft-quiz-sr-only" id="craft-threshold-title">Before you begin</h1>
      <p className="craft-result-kicker"><span />Before you begin<span /></p>
      <div className="craft-threshold-portrait">
        <Convener compact={compact} restingLine={spoken} />
      </div>
      <ol className="craft-threshold-beats">
        {said.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <button type="button" className="craft-quiz-continue" ref={readyRef} onClick={onReady}>
        {beat >= CONVENER_THRESHOLD.length - 1 ? "I am ready" : "Skip ahead"}
      </button>
    </section>
  );
}

interface WeighingScreenProps {
  readonly onDecided: () => void;
  readonly compact: boolean;
}

/**
 * The deliberation. Twelve hard scenes used to end with an instant verdict,
 * which reads as a lookup table rather than a judgement — the pause is what
 * makes the answer feel earned, and it is the beat every sorting hat is
 * actually remembered for.
 *
 * Timers, not promises. The previous auto-advance chained navigation onto
 * `convener.say(...).then(...)`, so a stray resolution could race the quiz to
 * the end — a failure that only ever appeared on CI. Here one interval owns
 * the beat count, one effect owns the handover, and both clean up.
 */
function WeighingScreen({ onDecided, compact }: WeighingScreenProps): ReactElement {
  const [beat, setBeat] = useState(0);
  const skipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBeat((current) => current + 1);
    }, CONVENER_DELIBERATION_BEAT_MS);
    return () => { window.clearInterval(timer); };
  }, []);

  // Handing over is its own effect so the interval never navigates: the beat
  // counter is the single source of truth for where we are in the ceremony.
  useEffect(() => {
    if (beat >= CONVENER_DELIBERATION.length) onDecided();
  }, [beat, onDecided]);

  // Anyone who has already waited twelve scenes is entitled to be impatient.
  useEffect(() => { skipRef.current?.focus(); }, []);

  const line = CONVENER_DELIBERATION[Math.min(beat, CONVENER_DELIBERATION.length - 1)] ?? "";

  return (
    <section className="craft-quiz-weighing" aria-labelledby="craft-weighing-title">
      <h1 className="craft-quiz-sr-only" id="craft-weighing-title">The Convener is weighing your answers</h1>
      <p className="craft-result-kicker"><span />The Chain is weighing<span /></p>
      {/* He is the one deliberating, so he is on screen doing it. His bubble
          stays empty here: the beats change faster than the typewriter can
          finish a line, and a half-typed thought reads as a stall. */}
      <div className="craft-weighing-portrait">
        <Convener compact={compact} restingLine={null} />
      </div>
      <div className="craft-weighing-chain" aria-hidden="true">
        {CONVENER_DELIBERATION.map((_, index) => (
          <i key={index} data-lit={index <= beat ? "true" : "false"} />
        ))}
      </div>
      <p className="craft-weighing-line" role="status" aria-live="polite">{line}</p>
      <button type="button" className="craft-weighing-skip" ref={skipRef} onClick={onDecided}>
        Tell me now
      </button>
    </section>
  );
}

interface ResultScreenProps {
  readonly ranking: readonly CraftRankingEntry[];
  readonly onRetake: () => void;
}

function ResultScreen({ ranking, onRetake }: ResultScreenProps): ReactElement {
  const [winner, runnerUp, third] = ranking;
  if (winner === undefined || runnerUp === undefined || third === undefined) {
    throw new Error("The Craft result requires three ranked Crafts.");
  }
  const craft = winner.profile;

  return (
    <section className="craft-quiz-result" aria-labelledby="craft-result-name">
      <p className="craft-result-kicker"><span />The Chain has chosen<span /></p>
      <div className="craft-result-medallion">
        <div className="craft-result-rays" />
        <div className="craft-result-glow" />
        <span className="craft-result-ember is-one" />
        <span className="craft-result-ember is-two" />
        <span className="craft-result-ember is-three" />
        <span className="craft-result-ember is-four" />
        <span className="craft-result-ember is-five" />
        <ResultLaurel />
        <img src={craft.crest} alt={`${craft.name} crest`} />
      </div>
      <h1 id="craft-result-name">{craft.name}</h1>
      <p className="craft-result-archetype">{craft.archetype}</p>
      <p className="craft-result-essence">{craft.essence}</p>
      <p className="craft-result-reveal">{craft.reveal}</p>
      <p className="craft-result-motto">{craft.motto}</p>
      {/* The near-miss. A sorting hat is remembered for what it ALMOST said,
          not for what it said — so he admits how close it ran, by name. This
          is also the line people screenshot. */}
      <p className="craft-result-affinities">
        <span className="craft-result-affinities-who">The Convener, quieter</span>
        “It ran closer than you would think. You were a hair from <strong>{runnerUp.profile.name}</strong>,
        and I nearly said <strong>{third.profile.name}</strong> aloud before I caught myself.
        Any of the three would have you. Go and ask them.”
      </p>
      <a className="craft-result-introduction" href={buildCraftIntroductionMailto(winner.craftId)}>Request an introduction</a>
      <button type="button" className="craft-result-retake" onClick={onRetake}>Retake the questions</button>
      <a className="craft-result-leaflet" href="/trades-house/leaflet">View the visitor leaflet</a>
      <p className="craft-result-signoff">Host here · belong here</p>
    </section>
  );
}

export function TradesHouseCraftQuizPage(): ReactElement {
  const [screen, setScreen] = useState<QuizScreen>("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totals, setTotals] = useState<AxisTotals>(ZERO_AXIS_TOTALS);
  const [lastAxes, setLastAxes] = useState<AxisVector>({});
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const convenerRef = useRef<ConvenerHandle>(null);

  // ---- what he notices about how you play ----
  // Refs, not state: none of this may cause a render, and all of it is read
  // exactly once, at the moment an answer is committed.
  const sceneShownAtRef = useRef<number>(Date.now());
  const answerMsRef = useRef<number[]>([]);
  const seatsRef = useRef<number[]>([]);
  const skipsRef = useRef(0);
  const spentObservationsRef = useRef<Set<ObservationId>>(new Set());
  const priorRunsRef = useRef(0);
  const [observation, setObservation] = useState<Observation | null>(null);

  // Fetch the voice manifest while the visitor is still reading the invitation.
  // The portrait mounts on the question screen and speaks in the same tick, so
  // starting the fetch there means the opening scene races it — and loses.
  useEffect(() => { void loadConvenerVoice(); }, []);
  const wideStage = useMediaQuery("(min-width: 980px)");
  const ranking = useMemo(() => rankCrafts(totals, lastAxes), [lastAxes, totals]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Discover Your Craft — Trades House Glasgow";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // He performs each scene as it arrives — the host, not a caption. The
  // portrait owns that: it speaks whatever `restingLine` holds, so the scene
  // survives remounts without the page having to time a say() call.

  function beginQuiz(): void {
    // Spend the tap's gesture on audio permission BEFORE any state change:
    // iOS grants it only synchronously inside a real user gesture, and this is
    // the one deliberate press the visitor makes before he starts speaking.
    unlockConvenerVoice();
    priorRunsRef.current = completedRuns();
    answerMsRef.current = [];
    seatsRef.current = [];
    skipsRef.current = 0;
    spentObservationsRef.current = new Set();
    setObservation(null);
    sceneShownAtRef.current = Date.now();
    setTotals(ZERO_AXIS_TOTALS);
    setLastAxes({});
    setQuestionIndex(0);
    setPickedIndex(null);
    setReply(null);
    setScreen("threshold");
  }

  function resetQuiz(): void {
    setTotals(ZERO_AXIS_TOTALS);
    setLastAxes({});
    setQuestionIndex(0);
    setPickedIndex(null);
    setReply(null);
    setScreen("intro");
  }

  function answerQuestion(optionIndex: number): void {
    if (pickedIndex !== null) return;
    const option = CRAFT_QUESTIONS[questionIndex]?.options[optionIndex];
    if (option === undefined) return;
    setPickedIndex(optionIndex);
    const answer = applyCraftQuizAnswer(totals, questionIndex, optionIndex);
    setTotals(answer.totals);
    setLastAxes(answer.lastAxes);
    // Answering opens his reply and stops there. Nothing advances on a clock:
    // the reader decides when they have finished with the line.
    // Everything he might remark on, recorded before the reaction is chosen.
    answerMsRef.current.push(Date.now() - sceneShownAtRef.current);
    seatsRef.current.push(optionIndex);
    const noticed = observePlay(
      {
        answerMs: answerMsRef.current,
        seats: seatsRef.current,
        skips: skipsRef.current,
        priorRuns: priorRunsRef.current,
      },
      spentObservationsRef.current,
    );
    if (noticed !== null) spentObservationsRef.current.add(noticed.id);
    setObservation(noticed);

    const reaction = convenerReaction(questionIndex, optionIndex);
    setReply(reaction);
    convenerRef.current?.express(optionIndex % 3 === 1 ? "press" : "smile", 1_400);
    // He SAYS the reply while the panel shows it. Aside, not say(): his bubble
    // must keep holding the scene, or answering would wipe the question the
    // reader is still weighing.
    convenerRef.current?.speakAside(reaction, noticed?.text ?? null);
  }

  // Stable identity: WeighingScreen's handover effect lists this in its deps,
  // and a fresh arrow every render would make that effect churn.
  const revealCraft = useCallback(() => {
    // Banked at the reveal, not at BEGIN: a run abandoned at question three is
    // not a visit he should claim to remember.
    recordCompletedRun();
    setScreen("result");
  }, []);

  function continueFromReply(): void {
    setReply(null);
    setObservation(null);
    sceneShownAtRef.current = Date.now();
    setPickedIndex(null);
    // The last scene hands over to the deliberation, never straight to the
    // verdict: an instant answer after twelve dilemmas reads as a lookup.
    if (questionIndex === CRAFT_QUESTIONS.length - 1) setScreen("weighing");
    else setQuestionIndex((current) => current + 1);
  }

  return (
    <main className="trades-house-craft-quiz-page" data-screen={screen}>
      <div className="trades-house-craft-quiz-shell">
        {screen === "intro" ? <IntroScreen onBegin={beginQuiz} /> : null}
        {screen === "threshold" ? (
          <ThresholdScreen onReady={() => { setScreen("question"); }} compact={!wideStage} />
        ) : null}
        {screen === "question" ? (
          <div className="craft-quiz-stage">
            <div className="craft-quiz-stage-portrait">
              <Convener
                ref={convenerRef}
                compact={!wideStage}
                /* His bubble always holds the SCENE. The reply lives in its own
                   panel beside the options, so answering never wipes the
                   question the reader is still thinking about. */
                restingLine={CRAFT_QUESTIONS[questionIndex]?.scene ?? null}
                onSkip={() => { skipsRef.current += 1; }}
              />
            </div>
            <QuestionScreen
              questionIndex={questionIndex}
              totals={totals}
              compact={!wideStage}
              onAnswer={answerQuestion}
              pickedIndex={pickedIndex}
              reply={reply}
              onContinue={continueFromReply}
              onOptionHover={(clientX, clientY) => { convenerRef.current?.glanceAt(clientX, clientY); }}
              observation={observation}
            />
          </div>
        ) : null}
        {screen === "weighing" ? <WeighingScreen onDecided={revealCraft} compact={!wideStage} /> : null}
        {screen === "result" ? <ResultScreen ranking={ranking} onRetake={resetQuiz} /> : null}
      </div>
    </main>
  );
}
