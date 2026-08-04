#!/usr/bin/env node
/*
 * Checks the Discover Your Craft quiz content without installing anything.
 *
 *   node projects/trades-house/tools/check.mjs
 *
 * Node 18 or newer, no dependencies, no build. It reads the authored content
 * and the two TypeScript files that define the quiz's structure, then reports
 * what is wrong and how the answers are balanced. Exits non-zero on any error.
 *
 * The same rules are asserted by craft-quiz-content.test.ts, and CI runs this
 * file as well, so the two cannot quietly disagree.
 */

import { existsSync, readFileSync } from "node:fs";

const ROOT = new URL("../../../", import.meta.url);
const CONTENT = "packages/web/src/features/trades-house/craft-quiz.content.json";
const MODEL = "packages/web/src/features/trades-house/craft-quiz-model.ts";
const ICONS = "packages/web/src/features/trades-house/CraftOptionIcon.tsx";
const CRESTS = "packages/web/public/trades-house-media/assets/crests";
const QR = "packages/web/public/trades-house-media/assets/qr-trades-hall.svg";
const QR_DESTINATION = "https://www.tradeshallglasgow.co.uk";
const WEIGHT_CEILING = 5;

const errors = [];
const notes = [];
const fail = (message) => errors.push(message);
const read = (relativePath) => readFileSync(new URL(relativePath, ROOT), "utf8");

/* ---------- the structure the content must fit ---------- */

function craftOrderFromModel() {
  const block = /export const CRAFT_ORDER = \[([\s\S]*?)\] as const;/u.exec(read(MODEL));
  if (block === null) {
    throw new Error(`Could not find CRAFT_ORDER in ${MODEL}. Has the model been restructured?`);
  }
  const ids = [...block[1].matchAll(/"([a-z]+)"/gu)].map((match) => match[1]);
  if (ids.length === 0) {
    throw new Error(`CRAFT_ORDER in ${MODEL} parsed as empty.`);
  }
  return ids;
}

function drawableIconsFromRenderer() {
  const block = /const ICON_PATHS = \{([\s\S]*?)\n\} as const/u.exec(read(ICONS));
  if (block === null) {
    throw new Error(`Could not find ICON_PATHS in ${ICONS}. Has the renderer been restructured?`);
  }
  const keys = [...block[1].matchAll(/^ {2}([A-Za-z][\w]*):/gmu)].map((match) => match[1]);
  if (keys.length === 0) {
    throw new Error(`ICON_PATHS in ${ICONS} parsed as empty.`);
  }
  return keys;
}

/* ---------- content rules ---------- */

function checkCrafts(content, craftOrder) {
  const authored = Object.keys(content.crafts ?? {});
  const missing = craftOrder.filter((id) => !authored.includes(id));
  const unknown = authored.filter((id) => !craftOrder.includes(id));

  for (const id of missing) fail(`crafts: "${id}" is in CRAFT_ORDER but has no entry.`);
  for (const id of unknown) fail(`crafts: "${id}" is not one of the fourteen Crafts in CRAFT_ORDER.`);

  for (const id of craftOrder) {
    const craft = content.crafts?.[id];
    if (craft === undefined) continue;

    for (const field of ["name", "archetype", "omen", "motto", "essence", "reveal"]) {
      const value = craft[field];
      if (typeof value !== "string" || value.trim() === "") {
        fail(`crafts.${id}.${field} is missing or blank.`);
      }
    }

    if (typeof craft.omen === "string") {
      if (craft.omen !== craft.omen.toLowerCase()) {
        fail(`crafts.${id}.omen is capitalised; it is read mid-sentence as "The Chain senses …".`);
      }
      if (/[.,;:!?]$/u.test(craft.omen)) {
        fail(`crafts.${id}.omen ends in punctuation; it is read mid-sentence.`);
      }
    }

    if (!existsSync(new URL(`${CRESTS}/${id}.png`, ROOT))) {
      fail(`crafts.${id}: no crest image at ${CRESTS}/${id}.png.`);
    }
  }
}

function checkQuestions(content, craftOrder, icons) {
  const questions = content.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    fail("questions: the quiz has no questions.");
    return;
  }

  const seenPrompts = new Set();

  questions.forEach((question, questionIndex) => {
    const where = `questions[${questionIndex}]`;

    if (typeof question.prompt !== "string" || question.prompt.trim() === "") {
      fail(`${where}.prompt is missing or blank.`);
    } else if (seenPrompts.has(question.prompt)) {
      fail(`${where}.prompt repeats an earlier question.`);
    } else {
      seenPrompts.add(question.prompt);
    }

    if (!Array.isArray(question.options) || question.options.length === 0) {
      fail(`${where}.options is missing or empty.`);
      return;
    }
    if (question.options.length !== 4) {
      fail(`${where} offers ${question.options.length} options; the layout is built for four.`);
    }

    const seenTitles = new Set();

    question.options.forEach((option, optionIndex) => {
      const optionWhere = `${where}.options[${optionIndex}]`;

      for (const field of ["title", "subtitle"]) {
        if (typeof option[field] !== "string" || option[field].trim() === "") {
          fail(`${optionWhere}.${field} is missing or blank.`);
        }
      }

      if (seenTitles.has(option.title)) {
        fail(`${optionWhere}.title repeats another option in the same question.`);
      } else {
        seenTitles.add(option.title);
      }

      if (!icons.includes(option.icon)) {
        fail(
          `${optionWhere}.icon is "${option.icon}", which the renderer cannot draw. ` +
            `Available: ${icons.join(", ")}.`,
        );
      }

      const weights = option.weights;
      if (typeof weights !== "object" || weights === null || Object.keys(weights).length === 0) {
        fail(`${optionWhere}.weights rewards no Craft, so choosing it does nothing.`);
        return;
      }

      for (const [craftId, weight] of Object.entries(weights)) {
        if (!craftOrder.includes(craftId)) {
          fail(`${optionWhere}.weights names "${craftId}", which is not one of the fourteen Crafts.`);
          continue;
        }
        if (!Number.isInteger(weight) || weight < 1 || weight > WEIGHT_CEILING) {
          fail(
            `${optionWhere}.weights.${craftId} is ${JSON.stringify(weight)}; ` +
              `it must be a whole number from 1 to ${WEIGHT_CEILING}.`,
          );
        }
      }
    });
  });
}

/* ---------- balance ---------- */

function winnerCounts(content, craftOrder) {
  const questions = content.questions.map((question) =>
    question.options.map((option) => craftOrder.map((id) => option.weights[id] ?? 0)),
  );
  const counts = new Map(craftOrder.map((id) => [id, 0]));
  const scores = new Array(craftOrder.length).fill(0);

  /*
   * Mirrors rankCrafts: highest score wins, ties go to whoever the final answer
   * favoured, and CRAFT_ORDER settles the rest. Ranking a Craft first only via
   * that tie-break still counts as reachable, so the tie-break has to be here.
   */
  const walk = (questionIndex, lastWeights) => {
    if (questionIndex === questions.length) {
      let best = 0;
      for (let index = 1; index < scores.length; index += 1) {
        if (
          scores[index] > scores[best] ||
          (scores[index] === scores[best] && lastWeights[index] > lastWeights[best])
        ) {
          best = index;
        }
      }
      counts.set(craftOrder[best], counts.get(craftOrder[best]) + 1);
      return;
    }

    for (const weights of questions[questionIndex]) {
      for (let index = 0; index < scores.length; index += 1) scores[index] += weights[index];
      walk(questionIndex + 1, weights);
      for (let index = 0; index < scores.length; index += 1) scores[index] -= weights[index];
    }
  };

  walk(0, new Array(craftOrder.length).fill(0));
  return counts;
}

function reportBalance(content, craftOrder) {
  const paths = content.questions.reduce((total, question) => total * question.options.length, 1);
  if (paths > 2_000_000) {
    notes.push(`Balance not computed: ${paths.toLocaleString("en-GB")} answer paths is too many to walk.`);
    return;
  }

  const counts = winnerCounts(content, craftOrder);
  const unreachable = [...counts].filter(([, count]) => count === 0).map(([id]) => id);

  for (const id of unreachable) {
    fail(`crafts.${id} cannot win on any of the ${paths.toLocaleString("en-GB")} answer paths.`);
  }

  const ranked = [...counts].sort((left, right) => right[1] - left[1]);
  const width = Math.max(...craftOrder.map((id) => id.length));
  const peak = ranked[0][1];

  notes.push(`Balance across all ${paths.toLocaleString("en-GB")} answer paths:`);
  for (const [id, count] of ranked) {
    const share = (count / paths) * 100;
    const bar = "#".repeat(Math.round((count / peak) * 34));
    notes.push(`  ${id.padEnd(width)}  ${share.toFixed(1).padStart(5)}%  ${bar}`);
  }
}

/* ---------- the leaflet's QR code ---------- */

function decodeQr(svg) {
  const stroke = /<path stroke="[^"]*" d="([^"]+)"/u.exec(svg);
  if (stroke === null) return null;

  const size = Number(/viewBox="0 0 (\d+)/u.exec(svg)?.[1] ?? 0);
  if (size !== 29) return null; // only version 3 is decoded here

  const grid = Array.from({ length: size }, () => new Array(size).fill(0));
  let x = 0;
  let y = 0;
  for (const token of stroke[1].match(/[MmHh][^MmHh]*/gu) ?? []) {
    const args = token.slice(1).trim().split(/[\s,]+/u).map(Number);
    if (token[0] === "M") [x, y] = [args[0], Math.floor(args[1])];
    else if (token[0] === "m") [x, y] = [x + args[0], y + Math.floor(args[1])];
    else {
      const run = token[0] === "h" ? args[0] : args[0] - x;
      for (let step = 0; step < run; step += 1) grid[y][x + step] = 1;
      x += run;
    }
  }

  const formatCells = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  let format = 0;
  for (const [row, column] of formatCells) format = (format << 1) | grid[row][column];
  format ^= 0b101010000010010;

  const maskId = (format >> 10) & 7;
  const masks = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];
  const mask = masks[maskId];

  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserve = (row0, column0, height, width) => {
    for (let r = row0; r < row0 + height; r += 1) {
      for (let c = column0; c < column0 + width; c += 1) {
        if (r >= 0 && r < size && c >= 0 && c < size) reserved[r][c] = true;
      }
    }
  };
  reserve(0, 0, 9, 9);
  reserve(0, size - 8, 9, 8);
  reserve(size - 8, 0, 8, 9);
  reserve(20, 20, 5, 5);
  for (let index = 0; index < size; index += 1) {
    reserved[6][index] = true;
    reserved[index][6] = true;
  }

  const bits = [];
  let upward = true;
  for (let pair = size - 1; pair > 0; pair -= 2) {
    if (pair === 6) pair = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [pair, pair - 1]) {
        if (reserved[row][column]) continue;
        bits.push(grid[row][column] ^ (mask(row, column) ? 1 : 0));
      }
    }
    upward = !upward;
  }

  const readBits = (offset, length) => {
    let value = 0;
    for (let index = 0; index < length; index += 1) value = (value << 1) | bits[offset + index];
    return value;
  };

  if (readBits(0, 4) !== 4) return null; // not byte mode
  const length = readBits(4, 8);
  let text = "";
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(readBits(12 + index * 8, 8));
  return text;
}

function checkQrCode() {
  if (!existsSync(new URL(QR, ROOT))) {
    fail(`The leaflet QR code is missing at ${QR}.`);
    return;
  }

  const payload = decodeQr(read(QR));
  if (payload === null) {
    notes.push("QR code: present, but not the version-3 byte format this checker reads. Verify it by scanning.");
    return;
  }
  if (payload !== QR_DESTINATION) {
    fail(`The leaflet QR code encodes "${payload}", not the expected "${QR_DESTINATION}".`);
    return;
  }

  notes.push(`QR code: scans to ${payload}`);
}

/* ---------- run ---------- */

function main() {
  let content;
  try {
    content = JSON.parse(read(CONTENT));
  } catch (cause) {
    console.error(`Could not read ${CONTENT}: ${cause.message}`);
    process.exit(1);
  }

  const craftOrder = craftOrderFromModel();
  const icons = drawableIconsFromRenderer();

  checkCrafts(content, craftOrder);
  checkQuestions(content, craftOrder, icons);
  checkQrCode();
  if (errors.length === 0) reportBalance(content, craftOrder);

  if (errors.length > 0) {
    console.error(`\n${errors.length} problem${errors.length === 1 ? "" : "s"} found:\n`);
    for (const message of errors) console.error(`  - ${message}`);
    console.error("");
    process.exit(1);
  }

  const questionCount = content.questions.length;
  console.log(
    `Quiz content is sound: ${craftOrder.length} Crafts, ${questionCount} questions, ` +
      `${icons.length} drawable icons.\n`,
  );
  for (const note of notes) console.log(note);
  console.log("");
}

main();
