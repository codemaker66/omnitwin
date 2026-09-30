import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { adaptEntry } from "../prepare-amissing-book-resume.mjs";
import { CHECKPOINT_KEY, clearCheckpoint, parseCheckpoint, restoreActors } from "./resume-runtime.mjs";

const contract = {
  revision: "story-revision", scenes: { cross: { actors: { dog: {} } } },
  crafts: [{ code: "WRI" }], soul: { axes: { law_mercy: 0 }, abilities: { hand: 0 } },
  audioIds: ["mus_cross", "amb_snow_01"],
};
function snapshot() {
  return {
    version: 1, revision: contract.revision,
    ink: JSON.stringify({ inkSaveVersion: 10, flows: {} }),
    line: { text: "An old mastiff sits on your foot.", speaker: "", narration: true, think: false },
    soul: { name: "Agnes", pronoun: "she", face: "B1a", strength: "hand", axes: { law_mercy: 2 },
      abilities: { hand: 2 }, approval: { Wattie: 1 }, party: ["Wattie"], flags: ["q1_family"],
      ribbons: { WRI: "warm" }, unwriting: 1, voteAxes: null },
    world: { scene: "cross", actors: ["dog"], struck: [], grade: Array(20).fill(0), weather: "snow",
      music: "mus_cross", ambience: ["amb_snow"], objective: "Follow the bell", minute: "",
      chosen: "", ribbons: false, hudHidden: false, letterbox: false, white: false, bell: false },
  };
}

test("round-trips full player/choice/presentation state without interpreting HTML", () => {
  const save = snapshot();
  save.soul.name = "<b>Agnes</b>";
  assert.deepEqual(parseCheckpoint(JSON.stringify(save), contract), save);
});
test("audio network failure does not invalidate a saved place or its variant groups", () => {
  const offline = { ...contract, audio: { files: () => { throw new Error("network unavailable"); } } };
  assert.deepEqual(parseCheckpoint(JSON.stringify(snapshot()), offline), snapshot());
});
test("restores actors before applying a saved strike, including asynchronous asset loads", async () => {
  const order = [];
  const actors = new Set();
  await restoreActors({
    show: async (_scene, duration) => { assert.equal(duration, 0); order.push("scene"); },
    actor: async (id) => { await new Promise((done) => setTimeout(done, 5)); actors.add(id); order.push(id); },
    strike: async (id) => { assert.ok(actors.has(id)); order.push(`strike:${id}`); },
  }, {}, ["crowd", "amissing"], ["amissing"]);
  assert.deepEqual(order, ["scene", "crowd", "amissing", "strike:amissing"]);
});
for (const [name, alter] of [
  ["story changed", (v) => { v.revision = "older"; }],
  ["legacy partial data", (v) => { delete v.ink; }],
  ["invalid scene", (v) => { v.world.scene = "https://untrusted.example/"; }],
  ["invalid actor", (v) => { v.world.actors = ["outsider"]; }],
  ["invalid music", (v) => { v.world.music = "untrusted"; }],
  ["invalid craft", (v) => { v.soul.ribbons = { FAKE: "warm" }; }],
  ["invalid numeric state", (v) => { v.soul.axes.law_mercy = null; }],
  ["oversized flags", (v) => { v.soul.flags = Array(2001).fill("x"); }],
  ["prototype field", (v) => { v.soul.approval = JSON.parse('{"__proto__":1}'); }],
  ["invalid Ink format", (v) => { v.ink = '{"inkSaveVersion":1,"flows":{}}'; }],
]) {
  test(`rejects ${name} before presenting Resume`, () => {
    const save = snapshot();
    alter(save);
    assert.throws(() => parseCheckpoint(JSON.stringify(save), contract));
  });
}
test("rejects corrupt and oversized storage", () => {
  for (const raw of ["{", "x".repeat(1_000_001), "null"]) assert.throws(() => parseCheckpoint(raw, contract));
});
test("explicit restart clears only the new checkpoint and tolerates blocked storage", () => {
  const removed = [];
  clearCheckpoint({ removeItem: (key) => removed.push(key) });
  assert.deepEqual(removed, [CHECKPOINT_KEY]);
  assert.doesNotThrow(() => clearCheckpoint({ removeItem: () => { throw new Error("denied"); } }));
});
test("replay handles a blocked localStorage getter before the method can be called", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("denied"); } });
  try { assert.doesNotThrow(() => clearCheckpoint()); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});
test("bootstrap adaptation retains original opening and fails when upstream boot/replay contracts drift", () => {
  const source = readFileSync(new URL("../../public/amissing-book/assets/index-BvgeSwOx.js", import.meta.url), "utf8");
  const adapted = adaptEntry(source, "revision");
  assert.ok(adapted.includes('.start(()=>Qf(e,n,r,s))'));
  assert.ok(adapted.includes('from "./amissing-book-resume.js"'));
  assert.ok(adapted.includes("function nu(){clearCheckpoint();"));
  assert.throws(() => adaptEntry(source.replace("else await Qf(e,n,r,s)", "else await upstreamTitle()"), "revision"));
  assert.throws(() => adaptEntry(source.replace("function nu(){", "function replacement(){"), "revision"));
});
