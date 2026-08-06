// ---------------------------------------------------------------------------
// The Convener's voice — offline batch generation (phase R4)
//
// Every line he speaks is authored corpus, so nothing is generated at runtime:
// the site serves static mp3s and the API key never reaches a browser. This
// script reads the corpus from the SAME modules the app renders from, so the
// audio cannot drift from the text on screen.
//
//   pnpm --filter @omnitwin/web voice:generate            (priced dry run)
//   pnpm --filter @omnitwin/web voice:generate -- --write (spends credits)
//   pnpm --filter @omnitwin/web voice:generate -- --prune (delete orphaned audio)
//
// It costs money to run, so it REFUSES TO SPEND unless given --write. The bare
// invocation prices the job: how many characters each section will consume and
// what is already on disk. A metered API should never bill you because a script
// did the obvious thing by default.
//
// Regeneration is keyed by content hash, so editing one line re-bills one line.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..", "..");
const OUT_DIR = join(WEB_ROOT, "public", "trades-house-media", "voice");
const MANIFEST = join(OUT_DIR, "manifest.json");
const CONFIG = JSON.parse(readFileSync(join(HERE, "voice.config.json"), "utf8"));

const WRITE = process.argv.includes("--write");
const PRUNE = process.argv.includes("--prune");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);

/** The key is read here and nowhere else, and is never logged. */
function readApiKey() {
  const envPath = join(WEB_ROOT, ".env.local");
  if (!existsSync(envPath)) {
    throw new Error(`No ${envPath}. Put ELEVENLABS_API_KEY=... in it (it is gitignored).`);
  }
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith("ELEVENLABS_API_KEY="));
  if (line === undefined) throw new Error("ELEVENLABS_API_KEY missing from .env.local");
  const key = line.slice(line.indexOf("=") + 1).trim();
  if (key === "") throw new Error("ELEVENLABS_API_KEY is empty");
  return key;
}

/**
 * The corpus, pulled from the real modules rather than a copy. `displayText` is
 * what the typewriter shows; `speechText` is what he says. They are identical
 * today, and the split exists because TTS occasionally mispronounces a Scots
 * spelling that must stay on screen — when that happens, only speechText moves.
 */
async function collectCorpus() {
  const model = await import("../../src/features/trades-house/craft-quiz-model.ts");
  const lines = await import("../../src/features/trades-house/convener/convener-lines.ts");
  const observations = await import("../../src/features/trades-house/convener/convener-observations.ts");

  const corpus = [];
  const add = (section, id, text) => {
    const trimmed = (text ?? "").trim();
    if (trimmed !== "") corpus.push({ section, id, displayText: trimmed, speechText: trimmed });
  };

  model.CRAFT_QUESTIONS.forEach((q, i) => { add("scene", `scene-${i + 1}`, q.scene); });

  for (const [craftId, profile] of Object.entries(model.CRAFT_PROFILES)) {
    add("reveal", `reveal-${craftId}`, profile.reveal);
  }

  lines.CONVENER_REACTIONS.forEach((replies, qi) => {
    replies.forEach((text, oi) => { add("reaction", `reaction-${qi + 1}-${oi + 1}`, text); });
  });

  lines.CONVENER_DELIBERATION.forEach((t, i) => { add("deliberation", `deliberation-${i + 1}`, t); });
  lines.CONVENER_ACKNOWLEDGEMENTS.forEach((t, i) => { add("acknowledgement", `ack-${i + 1}`, t); });
  lines.CONVENER_POKES.forEach((t, i) => { add("poke", `poke-${i + 1}`, t); });
  lines.CONVENER_IDLE_MURMURS.forEach((t, i) => { add("idle", `idle-${i + 1}`, t); });
  observations.CONVENER_OBSERVATIONS.forEach((t, i) => { add("observation", `observation-${i + 1}`, t); });
  add("doze", "doze", lines.CONVENER_DOZE);
  add("wake", "wake", lines.CONVENER_WAKE);

  return corpus;
}

// The voice and model are in the hash because re-recording the same words in a
// different voice must produce a different file, not silently reuse the old one.
const hashOf = (speechText) =>
  createHash("sha1")
    .update(`${CONFIG.voiceId}::${CONFIG.modelId}::${speechText}`)
    .digest("hex")
    .slice(0, 16);

/**
 * The with-timestamps endpoint returns per-character start times, which is the
 * whole point: the typewriter reveals each character exactly when he says it,
 * and the mouth flaps on that same clock. Without it we would be guessing at a
 * characters-per-second rate and drifting further with every sentence.
 */
async function synthesise(key, speechText) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${CONFIG.voiceId}/with-timestamps`
    + `?output_format=${encodeURIComponent(CONFIG.outputFormat)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: speechText,
      model_id: CONFIG.modelId,
      voice_settings: CONFIG.voiceSettings,
    }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const align = json.normalized_alignment ?? json.alignment ?? null;
  return {
    audio: Buffer.from(json.audio_base64, "base64"),
    charStartTimesMs: align === null
      ? null
      : align.character_start_times_seconds.map((s) => Math.round(s * 1000)),
    characters: align?.characters ?? null,
  };
}

async function main() {
  const corpus = await collectCorpus();
  const selected = ONLY === undefined ? corpus : corpus.filter((e) => e.section === ONLY);
  if (selected.length === 0) {
    throw new Error(`No lines matched --only=${String(ONLY)}.`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const manifest = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, "utf8"))
    : { voiceId: CONFIG.voiceId, modelId: CONFIG.modelId, entries: {} };

  const todo = [];
  const bySection = new Map();
  for (const entry of selected) {
    const hash = hashOf(entry.speechText);
    const onDisk = existsSync(join(OUT_DIR, `${hash}.mp3`));
    const r = bySection.get(entry.section) ?? { items: 0, chars: 0, have: 0, needChars: 0 };
    r.items += 1;
    r.chars += entry.speechText.length;
    if (onDisk) r.have += 1;
    else { r.needChars += entry.speechText.length; todo.push({ ...entry, hash }); }
    bySection.set(entry.section, r);
  }

  console.log(`voice: ${CONFIG.voiceName} (${CONFIG.voiceId})   model: ${CONFIG.modelId}`);
  console.log("section          items  onDisk    chars   toBill");
  let totalChars = 0;
  let billChars = 0;
  for (const [section, r] of bySection) {
    console.log(
      section.padEnd(16)
      + String(r.items).padStart(5)
      + String(r.have).padStart(8)
      + String(r.chars).padStart(9)
      + String(r.needChars).padStart(9),
    );
    totalChars += r.chars;
    billChars += r.needChars;
  }
  console.log(
    "TOTAL".padEnd(16)
    + String(selected.length).padStart(5)
    + String(selected.length - todo.length).padStart(8)
    + String(totalChars).padStart(9)
    + String(billChars).padStart(9),
  );

  // Audio for a line that no longer exists in the corpus. The generator adds
  // but never removed, so deleting a line left its mp3 shipping to every
  // visitor forever — dead weight nobody would notice was there. Skipped under
  // --only, where "not in this section" looks exactly like an orphan.
  if (ONLY === undefined) {
    const wanted = new Set(corpus.map((entry) => `${hashOf(entry.speechText)}.mp3`));
    const orphanEntries = Object.entries(manifest.entries).filter(([, e]) => !wanted.has(e.file));
    const orphanFiles = readdirSync(OUT_DIR).filter((f) => f.endsWith(".mp3") && !wanted.has(f));
    if (orphanEntries.length > 0 || orphanFiles.length > 0) {
      console.log(`\norphaned by deleted lines: ${String(orphanFiles.length)} file(s)`);
      for (const [, e] of orphanEntries) console.log(`  ${e.id}  "${e.displayText.slice(0, 46)}…"`);
      if (PRUNE) {
        for (const [hash] of orphanEntries) delete manifest.entries[hash];
        for (const f of orphanFiles) rmSync(join(OUT_DIR, f));
        writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log("  removed.");
      } else {
        console.log("  re-run with --prune to remove them (deletes files, costs nothing).");
      }
    }
  }

  if (!WRITE) {
    console.log(`\nDry run. ${todo.length} line(s) would be generated, costing ~${billChars} characters.`);
    console.log("Re-run with --write to spend credits. --only=<section> narrows it.");
    return;
  }
  if (todo.length === 0) {
    console.log("\nNothing to generate — every line is already on disk.");
    return;
  }

  const key = readApiKey();
  let done = 0;
  for (const entry of todo) {
    // Serial on purpose: ElevenLabs rate-limits concurrency by plan, and a
    // parallel burst that 429s mid-run leaves a half-written corpus the next
    // run cannot distinguish from a deliberate partial generation.
    const { audio, charStartTimesMs, characters } = await synthesise(key, entry.speechText);
    writeFileSync(join(OUT_DIR, `${entry.hash}.mp3`), audio);
    manifest.entries[entry.hash] = {
      id: entry.id,
      section: entry.section,
      displayText: entry.displayText,
      speechText: entry.speechText,
      file: `${entry.hash}.mp3`,
      charStartTimesMs,
      characters,
    };
    done += 1;
    console.log(`  [${done}/${todo.length}] ${entry.id} (${entry.speechText.length} chars)`);
    // Flushed every line: a run interrupted at line 60 of 102 must leave a
    // manifest describing the 60 that exist, or the next run regenerates
    // everything and bills for it twice.
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  manifest.voiceId = CONFIG.voiceId;
  manifest.modelId = CONFIG.modelId;
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${done} file(s) and the manifest to ${OUT_DIR}`);
}

// The failures that actually happen here are account-state problems, not bugs,
// and a stack trace is the wrong way to tell somebody their plan is too small.
const KNOWN = [
  [/ivc_not_permitted|Instantly cloned voices are not available/i,
    "This voice is an instant clone, which the free plan will not serve over the API.\n"
    + "Any paid tier (Starter upward) unlocks it — and also grants the commercial\n"
    + "licence this site needs. Nothing else about the setup needs to change."],
  [/Free users cannot use library voices/i,
    "Voice-library voices need a paid plan. Either upgrade, or pin a stock voice\n"
    + "id in voice.config.json."],
  [/quota|character_limit|exceeds/i,
    "Out of characters for this billing period. `--only=<section>` generates one\n"
    + "section at a time; the run is resumable because finished lines are skipped."],
  [/401|invalid_api_key|Unauthorized/i,
    "The API key was rejected. Check ELEVENLABS_API_KEY in packages/web/.env.local."],
];

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const hint = KNOWN.find(([pattern]) => pattern.test(message))?.[1];
  console.error(`\nGeneration stopped: ${message.split("\n")[0]}`);
  if (hint !== undefined) console.error(`\n${hint}`);
  console.error("\nNothing was left half-written — rerun when resolved and only the\n"
    + "missing lines are billed.");
  process.exitCode = 1;
}
