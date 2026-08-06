import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { OptionSeal } from "../features/trades-house/OptionSeal.js";
import { ConvenerPortrait, type ConvenerHandle } from "../features/trades-house/convener/ConvenerPortrait.js";
import { useMediaQuery } from "../hooks/use-media-query.js";
import {
  CRAFT_ORDER,
  CRAFT_PROFILES,
  CRAFT_QUESTIONS,
  applyCraftQuizAnswer,
  buildCraftIntroductionMailto,
  rankCrafts,
  type CraftId,
  type CraftRankingEntry,
  type CraftScores,
  type CraftWeights,
} from "../features/trades-house/craft-quiz-model.js";
import "./TradesHouseCraftQuizPage.css";

type QuizScreen = "intro" | "question" | "result";

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
          <img
            className="craft-quiz-achievement"
            src="/trades-house-media/assets/achievement.png"
            alt="Trades House of Glasgow — Union is Strength"
          />
        </div>
        <h1 id="craft-quiz-title" aria-label="Which Craft is yours?">
          <span>Which&nbsp;</span>
          <strong>Craft</strong>
          <br className="craft-quiz-title-break" aria-hidden="true" />
          <span>is yours?</span>
        </h1>
        <div className="craft-quiz-divider" aria-hidden="true"><i>❖</i></div>
        <p>Nine questions · four centuries · one fellowship</p>
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
        <span className={index <= activeIndex ? "is-lit" : ""} data-active={index === activeIndex} key={question.prompt}>
          ⚜︎{index < CRAFT_QUESTIONS.length - 1 ? <i>◆</i> : null}
        </span>
      ))}
    </div>
  );
}

function midQuizOmen(scores: Readonly<CraftScores>, questionIndex: number): string | null {
  if (questionIndex !== 4) return null;
  const [first, second] = rankCrafts(scores);
  if (first === undefined || second === undefined) return null;
  return `The Chain senses ${first.profile.omen} and ${second.profile.omen}. It is not yet decided.`;
}

interface QuestionScreenProps {
  readonly questionIndex: number;
  readonly scores: Readonly<CraftScores>;
  readonly onAnswer: (optionIndex: number) => void;
  /** The option just chosen; locks the set while the Convener reacts. */
  readonly pickedIndex: number | null;
  /** The Convener glances at whichever option the pointer is weighing. */
  readonly onOptionHover: (clientX: number, clientY: number) => void;
}

function QuestionScreen({
  questionIndex,
  scores,
  onAnswer,
  pickedIndex,
  onOptionHover,
}: QuestionScreenProps): ReactElement {
  const question = CRAFT_QUESTIONS[questionIndex];
  if (question === undefined) throw new RangeError(`Question ${String(questionIndex)} is unavailable.`);
  const omen = midQuizOmen(scores, questionIndex);

  return (
    <section className="craft-quiz-question" aria-labelledby="craft-question-title">
      <p className="craft-quiz-sr-only" role="status" aria-live="polite">Question {questionIndex + 1} of {CRAFT_QUESTIONS.length}</p>
      <QuizProgress activeIndex={questionIndex} />
      <p className="craft-quiz-question-count">QUESTION {questionIndex + 1} OF {CRAFT_QUESTIONS.length}</p>
      {omen === null ? null : <p className="craft-quiz-omen">{omen}</p>}
      <h1 id="craft-question-title">{question.prompt}</h1>
      <div className="craft-quiz-options">
        {question.options.map((option, optionIndex) => {
          const picked = pickedIndex === optionIndex;
          const faded = pickedIndex !== null && !picked;
          return (
            /* aria-disabled, NOT disabled: disabling the focused button drops
               keyboard focus to <body> on every answer. answerQuestion() is
               the real re-entry guard; this is the accessible signal. */
            <button
              type="button"
              className={`craft-quiz-option${picked ? " is-picked" : ""}${faded ? " is-faded" : ""}`}
              aria-disabled={pickedIndex !== null}
              onClick={() => { onAnswer(optionIndex); }}
              onPointerEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onOptionHover(rect.left + rect.width / 2, rect.top + rect.height / 2);
              }}
              key={option.title}
            >
              <OptionSeal index={optionIndex} />
              <span>
                <strong>{option.title}</strong>
                <small>{option.subtitle}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="craft-quiz-divider is-muted" aria-hidden="true"><i>❖</i></div>
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
      <p className="craft-result-affinities">
        Your close affinities are <strong>{runnerUp.profile.name}</strong> and <strong>{third.profile.name}</strong> — an affinity is an invitation to explore, and enquiries are warmly welcomed.
      </p>
      <a className="craft-result-introduction" href={buildCraftIntroductionMailto(winner.craftId)}>Request an introduction</a>
      <button type="button" className="craft-result-retake" onClick={onRetake}>Retake the questions</button>
      <a className="craft-result-leaflet" href="/trades-house/leaflet">View the visitor leaflet</a>
      <div className="craft-result-building" aria-hidden="true" />
      <p className="craft-result-signoff">Host here · belong here</p>
    </section>
  );
}

export function TradesHouseCraftQuizPage(): ReactElement {
  const [screen, setScreen] = useState<QuizScreen>("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [scores, setScores] = useState<CraftScores>({});
  const [lastWeights, setLastWeights] = useState<CraftWeights>({});
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const convenerRef = useRef<ConvenerHandle>(null);
  const wideStage = useMediaQuery("(min-width: 980px)");
  const ranking = useMemo(() => rankCrafts(scores, lastWeights), [lastWeights, scores]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Discover Your Craft — Trades House Glasgow";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // He reads each question aloud as it arrives — the host, not a caption.
  useEffect(() => {
    if (screen !== "question") return;
    const prompt = CRAFT_QUESTIONS[questionIndex]?.prompt;
    if (prompt !== undefined) void convenerRef.current?.say(prompt);
  }, [screen, questionIndex]);

  function beginQuiz(): void {
    setScores({});
    setLastWeights({});
    setQuestionIndex(0);
    setPickedIndex(null);
    setScreen("question");
  }

  function resetQuiz(): void {
    setScores({});
    setLastWeights({});
    setQuestionIndex(0);
    setPickedIndex(null);
    setScreen("intro");
  }

  function answerQuestion(optionIndex: number): void {
    if (pickedIndex !== null) return;
    const option = CRAFT_QUESTIONS[questionIndex]?.options[optionIndex];
    if (option === undefined) return;
    setPickedIndex(optionIndex);
    const answer = applyCraftQuizAnswer(scores, questionIndex, optionIndex);
    setScores(answer.scores);
    setLastWeights(answer.lastWeights);

    const advance = (): void => {
      setPickedIndex(null);
      if (questionIndex === CRAFT_QUESTIONS.length - 1) setScreen("result");
      else setQuestionIndex((current) => current + 1);
    };
    const convener = convenerRef.current;
    if (convener === null) {
      advance();
      return;
    }
    // He reacts, THEN the quiz moves on — the beat is the personality.
    convener.express("smile", 900);
    void convener.say(option.convenerLine, { quip: true }).then(advance);
  }

  return (
    <main className="trades-house-craft-quiz-page" data-screen={screen}>
      <div className="trades-house-craft-quiz-shell">
        {screen === "intro" ? <IntroScreen onBegin={beginQuiz} /> : null}
        {screen === "question" ? (
          <div className="craft-quiz-stage">
            <div className="craft-quiz-stage-portrait">
              <ConvenerPortrait
                ref={convenerRef}
                compact={!wideStage}
                restingLine={CRAFT_QUESTIONS[questionIndex]?.prompt ?? null}
              />
            </div>
            <QuestionScreen
              questionIndex={questionIndex}
              scores={scores}
              onAnswer={answerQuestion}
              pickedIndex={pickedIndex}
              onOptionHover={(clientX, clientY) => { convenerRef.current?.glanceAt(clientX, clientY); }}
            />
          </div>
        ) : null}
        {screen === "result" ? <ResultScreen ranking={ranking} onRetake={resetQuiz} /> : null}
      </div>
    </main>
  );
}
