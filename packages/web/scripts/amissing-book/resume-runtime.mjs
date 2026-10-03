// Hosting adapter for the exported Ink game. The original export only wrote a
// partial Soul under lost-years-save and never read it. Keep that data intact.
export const CHECKPOINT_KEY = "amissing-book-checkpoint-v1";
const MAX_BYTES = 1_000_000;
const ownRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
  && Object.keys(v).every((k) => !["__proto__", "prototype", "constructor"].includes(k));
const text = (v, max = 256) => typeof v === "string" && v.length <= max;
const strings = (v, max = 100) => Array.isArray(v) && v.length <= max && v.every((x) => text(x));
const finite = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100_000;
const numbers = (v, keys) => ownRecord(v) && Object.keys(v).length === keys.length
  && keys.every((k) => finite(v[k]));
const numericRecord = (v) => ownRecord(v) && Object.keys(v).length <= 50 && Object.entries(v).every(([k, n]) => text(k, 64) && finite(n));

export function parseCheckpoint(raw, { revision, scenes, crafts, soul, audioIds }) {
  if (typeof raw !== "string" || raw.length > MAX_BYTES) throw new Error("Invalid checkpoint size");
  const v = JSON.parse(raw);
  if (!ownRecord(v) || v.version !== 1 || v.revision !== revision || !ownRecord(v.soul)
    || !ownRecord(v.world) || !ownRecord(v.line) || !text(v.ink, MAX_BYTES / 2)) throw new Error("Incompatible checkpoint");
  const s = v.soul, w = v.world, craftIds = new Set(crafts.map((c) => c.code));
  // Validation must not depend on a successful network request for audio. The
  // trusted export's IDs are embedded by prepare; numeric variants have aliases.
  const knownAudio = new Set(audioIds.flatMap((id) => [id, id.replace(/_\d+$/u, "")]));
  if (!text(s.name, 18) || !["he", "she", "they"].includes(s.pronoun) || !/^B[1-8]a$/u.test(s.face)
    || !["", ...Object.keys(soul.abilities)].includes(s.strength)
    || !numbers(s.axes, Object.keys(soul.axes)) || !numbers(s.abilities, Object.keys(soul.abilities))
    || !numericRecord(s.approval) || !strings(s.party, 3) || s.party.some((p) => !["Wattie", "Bethia", "Sandy"].includes(p))
    || !strings(s.flags, 2000) || !finite(s.unwriting) || s.unwriting < 0 || s.unwriting > 5
    || !ownRecord(s.ribbons) || Object.entries(s.ribbons).some(([k, r]) => !craftIds.has(k) || !["plain", "warm", "bright", "frayed", "cut"].includes(r))
    || (s.voteAxes !== null && !numbers(s.voteAxes, Object.keys(soul.axes)))) throw new Error("Invalid player state");
  if (!text(w.scene) || !Object.hasOwn(scenes, w.scene) || !strings(w.actors) || !strings(w.struck)
    || [...w.actors, ...w.struck].some((id) => !Object.hasOwn(scenes[w.scene].actors ?? {}, id))
    || !Array.isArray(w.grade) || w.grade.length !== 20 || !w.grade.every(finite)
    || !["none", "rain", "snow", "embers", "motes", "ash"].includes(w.weather)
    || !text(w.music) || (w.music !== "" && !knownAudio.has(w.music))
    || !strings(w.ambience, 20) || w.ambience.some((id) => !knownAudio.has(id))
    || !text(w.objective, 2000) || !text(w.minute, 5000)
    || !["", ...craftIds].includes(w.chosen)
    || [w.ribbons, w.hudHidden, w.letterbox, w.white, w.bell].some((x) => typeof x !== "boolean")) throw new Error("Invalid scene state");
  if (!text(v.line.text, 10_000) || !text(v.line.speaker, 128) || typeof v.line.narration !== "boolean"
    || typeof v.line.think !== "boolean") throw new Error("Invalid dialogue");
  const ink = JSON.parse(v.ink);
  if (!ownRecord(ink) || ink.inkSaveVersion !== 10 || !ownRecord(ink.flows)) throw new Error("Invalid story state");
  return v;
}

export function clearCheckpoint(storage) {
  try { (storage ?? localStorage).removeItem(CHECKPOINT_KEY); } catch { /* replay still works without storage */ }
}

export async function restoreActors(stage, scene, actors, struck) {
  // The exported Stage.present starts its actor promises without awaiting them.
  // Restore explicitly so a strike cannot land before its actor has registered.
  await stage.show(scene, 0);
  await Promise.all(actors.map((id) => stage.actor(id, true, 0)));
  for (const id of struck) await stage.strike(id);
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

export function installResume(game) {
  const { host, stage, audio, runner, soul, director, scenes, crafts, revision } = game;
  const { dialogue, hud, overlays } = director.ui;
  let enabled = false;
  let lastLine = null;
  let struck = new Set();
  let bell = false;
  let rememberedScene = "glassford";
  let music = "";
  let ambience = ["amb_now_street_night"];
  let notice = "";
  let saved = null;
  const initialInk = runner.story.state.ToJson();
  let storage;
  try { storage = localStorage; } catch { notice = "Saving is unavailable in this browser. You can still play."; }
  if (storage) {
    try {
      const raw = storage.getItem(CHECKPOINT_KEY);
      if (raw !== null) {
        saved = parseCheckpoint(raw, game);
        runner.story.state.LoadJson(saved.ink);
        if (runner.story.canContinue || runner.story.currentChoices.length === 0) throw new Error("Not a choice checkpoint");
      } else if (storage.getItem("lost-years-save") !== null) {
        notice = "An older save has no story position. It is kept, but this game must begin again.";
      }
    } catch { saved = null; notice = "Your saved place could not be opened. It is kept; you can begin a new game."; }
    finally { runner.story.state.LoadJson(initialInk); }
  }
  // The old partial write would overwrite a retained legacy save on every pick.
  soul.save = () => {};
  const status = element("p", "amissing-save-status");
  status.setAttribute("role", "status");
  status.style.cssText = "position:fixed;left:50%;top:8px;transform:translateX(-50%);max-width:80vw;margin:0;padding:4px 10px;background:#07080be6;color:#efe3c8;font-size:12px;text-align:center;z-index:15;pointer-events:none";
  status.hidden = true;
  host.append(status);
  function report(message) { status.textContent = message; status.hidden = false; }
  const say = dialogue.say.bind(dialogue);
  dialogue.say = (line) => {
    lastLine = { text: line.text, speaker: line.speaker ?? "", narration: line.narration, think: line.think === true };
    return say(line);
  };
  const apply = director.apply.bind(director);
  director.apply = async (tags, storyRunner) => {
    await apply(tags, storyRunner);
    for (const [key, value] of tags) {
      if (key === "scene" && rememberedScene !== value.split(/\s+/u)[0]) {
        rememberedScene = value.split(/\s+/u)[0];
        struck = new Set();
      }
      if (key === "strike") struck.add(value);
      if (key === "bell") bell = value === "on";
      if (key === "music") { const id = value.split(/\s+/u)[0]; music = ["stop", "none"].includes(id) ? "" : id; }
      if (key === "amb") ambience = value === "none" ? [] : value.split(",").map((id) => id.trim()).filter(Boolean);
    }
  };
  const choose = dialogue.choose.bind(dialogue);
  dialogue.choose = (views) => {
    if (enabled && lastLine && storage) {
      const snapshot = {
        version: 1, revision, ink: runner.story.state.ToJson(), line: lastLine,
        soul: { name: soul.name, pronoun: soul.pronoun, face: soul.face, strength: soul.strength,
          axes: { ...soul.axes }, abilities: { ...soul.abilities }, approval: { ...soul.approval },
          ribbons: { ...soul.ribbons }, unwriting: soul.unwriting, party: [...soul.party],
          flags: [...soul.flags], voteAxes: soul.voteAxes ? { ...soul.voteAxes } : null },
        world: { scene: director.sceneId, actors: [...stage.actors.keys()], struck: [...struck],
          grade: [...stage.gradeNow], weather: stage.weather.kind, music,
          ambience, objective: hud.objective.hidden ? "" : hud.objective.textContent,
          ribbons: !hud.ribbons.hidden, hudHidden: hud.left.hidden,
          letterbox: overlays.bars.classList.contains("is-on"), white: overlays.white.classList.contains("is-on"),
          bell, chosen: director.chosen?.code ?? "", minute: director.lastMinute },
      };
      try {
        const raw = JSON.stringify(snapshot);
        parseCheckpoint(raw, game);
        storage.setItem(CHECKPOINT_KEY, raw);
        // A subsequent successful save clears a previous quota/error notice.
        status.hidden = true;
      } catch { report("Your place could not be saved. Keep this page open to continue."); }
    }
    return choose(views);
  };
  const screen = director.screen.bind(director);
  director.screen = (which, storyRunner) => {
    if ((which === "join" || which === "whitepage") && storage) clearCheckpoint(storage);
    return screen(which, storyRunner);
  };

  async function restore(snapshot) {
    const s = snapshot.soul, w = snapshot.world;
    for (const key of ["name", "pronoun", "face", "strength", "axes", "abilities", "approval", "ribbons", "unwriting", "party"]) soul[key] = s[key];
    soul.flags = new Set(s.flags);
    soul.voteAxes = s.voteAxes ?? undefined;
    runner.story.state.LoadJson(snapshot.ink);
    await restoreActors(stage, scenes[w.scene], w.actors, w.struck);
    director.sceneId = w.scene;
    rememberedScene = w.scene;
    director.entered(w.scene);
    director.chosen = crafts.find((c) => c.code === w.chosen);
    director.lastMinute = w.minute;
    struck = new Set(w.struck);
    for (const key of ["gradeFrom", "gradeTo", "gradeNow"]) stage[key] = [...w.grade];
    stage.grade.matrix = [...w.grade];
    stage.gradeT = 1;
    stage.weather.set(w.weather);
    await Promise.all([audio.music(w.music || "stop", 0), audio.ambience(w.ambience, 0)]);
    music = w.music;
    ambience = [...w.ambience];
    hud.setObjective(w.objective);
    if (w.ribbons) hud.showRibbons(crafts, soul.ribbons);
    hud.left.hidden = w.hudHidden;
    hud.setUnwriting(soul.unwriting);
    director.refreshParty();
    overlays.letterbox(w.letterbox);
    overlays.whitePage(w.white);
    if (w.bell) await director.apply([["bell", "on"]], runner);
    bell = w.bell;
    lastLine = snapshot.line;
    // Show the already-read line without replaying its state-changing tags or
    // narrating over the pending choice. The next line uses the original voice.
    dialogue.panel.hidden = false;
    dialogue.panel.classList.toggle("is-narration", lastLine.narration);
    dialogue.panel.classList.toggle("is-think", lastLine.think);
    dialogue.name.textContent = lastLine.speaker;
    dialogue.name.hidden = lastLine.narration;
    const portrait = lastLine.speaker ? director.portrait(lastLine.speaker) : undefined;
    dialogue.portrait.hidden = !portrait;
    if (portrait) dialogue.portrait.style.backgroundImage = `url(${portrait})`;
    dialogue.text.textContent = lastLine.text;
  }

  return {
    async start(originalTitle) {
      if (notice) report(notice);
      if (saved) {
        const title = element("section", "title");
        const heading = element("h1", "", "The Amissing Book");
        const resume = element("button", "dice-cta", "Resume");
        const restart = element("button", "btn", "Start again");
        resume.type = restart.type = "button";
        title.append(heading, element("p", "", "Return to your most recent choice. Your place is saved in this browser."), resume, restart);
        host.append(title);
        const action = await new Promise((resolve) => {
          resume.addEventListener("click", () => { audio.unlock(); resolve("resume"); }, { once: true });
          restart.addEventListener("click", () => resolve("restart"), { once: true });
        });
        title.remove();
        if (action === "resume") {
          try { await restore(saved); enabled = true; return; }
          catch {
            report("Your saved place could not be restored. Reload to retry; your save has been kept.");
            const reload = element("button", "dice-cta", "Reload and retry");
            reload.type = "button";
            reload.addEventListener("click", () => location.reload());
            const recovery = element("section", "title");
            recovery.append(element("h1", "", "The Amissing Book"), reload);
            host.append(recovery);
            await new Promise(() => {});
          }
        }
        if (storage) clearCheckpoint(storage);
      }
      await originalTitle();
      enabled = true;
    },
  };
}
