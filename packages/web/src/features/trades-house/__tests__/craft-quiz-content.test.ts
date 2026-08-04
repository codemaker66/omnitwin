import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DRAWABLE_ICON_KEYS } from "../CraftOptionIcon.js";
import {
  CRAFT_ORDER,
  CRAFT_PROFILES,
  CRAFT_QUESTIONS,
  applyCraftQuizAnswer,
  rankCrafts,
  type CraftId,
  type CraftScores,
} from "../craft-quiz-model.js";

const CHECKER = "projects/trades-house/tools/check.mjs";

/* Vitest does not hand modules a file: URL, so walk up to the workspace marker. */
function repositoryRoot(): string {
  let directory = resolve(process.cwd());

  while (!existsSync(join(directory, "pnpm-workspace.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Could not locate the repository root from the test's working directory.");
    }
    directory = parent;
  }

  return directory;
}

/**
 * Walks every possible way through the quiz and reports which Craft each path
 * awards. Nine four-way questions is 262,144 paths, which is small enough to
 * settle reachability by exhaustion rather than by argument.
 */
function winnerCountsByCraft(): ReadonlyMap<CraftId, number> {
  const counts = new Map<CraftId, number>(CRAFT_ORDER.map((craftId) => [craftId, 0]));

  const walk = (questionIndex: number, scores: CraftScores): void => {
    if (questionIndex === CRAFT_QUESTIONS.length) {
      const [winner] = rankCrafts(scores);
      if (winner === undefined) {
        throw new Error("A completed quiz produced no ranking.");
      }
      counts.set(winner.craftId, (counts.get(winner.craftId) ?? 0) + 1);
      return;
    }

    const question = CRAFT_QUESTIONS[questionIndex];
    if (question === undefined) {
      throw new Error(`Question ${String(questionIndex)} is unavailable.`);
    }

    for (let optionIndex = 0; optionIndex < question.options.length; optionIndex += 1) {
      walk(questionIndex + 1, applyCraftQuizAnswer(scores, questionIndex, optionIndex).scores);
    }
  };

  walk(0, {});
  return counts;
}

describe("craft quiz content", () => {
  it("describes every Craft named in CRAFT_ORDER and no others", () => {
    expect(Object.keys(CRAFT_PROFILES).sort()).toEqual([...CRAFT_ORDER].sort());
  });

  it("gives every Craft complete, non-empty result copy", () => {
    for (const craftId of CRAFT_ORDER) {
      const profile = CRAFT_PROFILES[craftId];
      for (const [field, value] of Object.entries(profile)) {
        expect(value.trim(), `${craftId}.${field} is blank`).not.toBe("");
      }
      expect(profile.crest).toBe(`/trades-house-media/assets/crests/${craftId}.png`);
    }
  });

  it("keeps omens usable in the mid-quiz sentence", () => {
    for (const craftId of CRAFT_ORDER) {
      const { omen } = CRAFT_PROFILES[craftId];
      expect(omen, `${craftId} omen is capitalised`).toBe(omen.toLowerCase());
      expect(omen, `${craftId} omen ends in punctuation`).not.toMatch(/[.,;:!?]$/u);
    }
  });

  it("offers a full set of distinct options for every question", () => {
    const prompts = CRAFT_QUESTIONS.map((question) => question.prompt);
    expect(new Set(prompts).size, "two questions share a prompt").toBe(prompts.length);

    for (const question of CRAFT_QUESTIONS) {
      expect(question.options.length, `"${question.prompt}" is not a four-way choice`).toBe(4);

      const titles = question.options.map((option) => option.title);
      expect(new Set(titles).size, `"${question.prompt}" repeats an option title`).toBe(titles.length);

      for (const option of question.options) {
        expect(option.title.trim()).not.toBe("");
        expect(option.subtitle.trim()).not.toBe("");
      }
    }
  });

  it("only names icons the option renderer can actually draw", () => {
    for (const question of CRAFT_QUESTIONS) {
      for (const option of question.options) {
        expect(DRAWABLE_ICON_KEYS, `"${option.title}" names the unknown icon "${option.icon}"`)
          .toContain(option.icon);
      }
    }
  });

  it("scores every option with positive whole points on the established scale", () => {
    for (const question of CRAFT_QUESTIONS) {
      for (const option of question.options) {
        const entries = Object.entries(option.weights);
        expect(entries.length, `"${option.title}" rewards no Craft`).toBeGreaterThan(0);

        for (const [craftId, weight] of entries) {
          expect(CRAFT_ORDER, `"${option.title}" rewards the unknown Craft "${craftId}"`)
            .toContain(craftId);
          expect(Number.isInteger(weight), `"${option.title}" gives ${craftId} a fractional score`)
            .toBe(true);
          expect(weight, `"${option.title}" gives ${craftId} an off-scale score`)
            .toBeGreaterThanOrEqual(1);
          expect(weight).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it("leaves every Craft winnable by some run of answers", () => {
    const counts = winnerCountsByCraft();
    const unreachable = [...counts].filter(([, count]) => count === 0).map(([craftId]) => craftId);

    expect(unreachable, "these Crafts cannot be reached by any answer").toEqual([]);
  });

  it("keeps the checker other agents rely on passing against this content", () => {
    expect(() => {
      execFileSync(process.execPath, [CHECKER], { cwd: repositoryRoot(), stdio: "pipe" });
    }).not.toThrow();
  });
});
