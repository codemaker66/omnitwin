import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { adaptEntry, adaptHtml } from "../prepare-amissing-book-resume.mjs";
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
test("bootstrap prioritizes the original title audio over speculative artwork", async () => {
  const source = readFileSync(new URL("../../public/amissing-book/assets/index-BvgeSwOx.js", import.meta.url), "utf8");
  async function boot(entry, events) {
    // Execute the actual title and bootstrap functions, without importing Pixi or
    // fetching assets. These doubles observe orchestration, not audible playback.
    const start = entry.indexOf("async function Qf(");
    const end = entry.indexOf("}$f();export{", start);
    assert.ok(start >= 0 && end > start, "original title/bootstrap extraction boundary");
    const EmptyUi = class {};
    const stage = class {
      async init() {}
      async show() { events.push("required opening artwork"); }
      punch() {}
      impact() {}
      flash() {}
    };
    const audio = class {
      async loadIndex() { await Promise.resolve(); events.push("audio manifest ready"); }
      setVolume() {}
      unlock() { events.push("audio unlocked"); }
      ambience(ids) { assert.deepEqual([...ids], ["amb_now_street_night"]); }
      async preload(ids) {
        assert.ok(events.includes("audio manifest ready"));
        assert.deepEqual([...ids], ["stg_title_slam", "sfx_bell_nobody", "sfx_strike_through", "sfx_unwrite_rise"]);
        events.push("original title audio requested");
      }
      sfx() {}
      async hit(_id, effect) { effect(); }
    };
    const node = (tag, className) => {
      if (className === "title") events.push("original title shown");
      return { append() {}, remove() {}, classList: { add() {} },
        addEventListener(type, callback) {
          assert.equal(tag, "button");
          assert.equal(type, "click");
          queueMicrotask(callback);
        } };
    };
    await runInNewContext(`${entry.slice(start, end + 1)}\n$f()`, {
      Xf() {}, Zf() {}, M: node, Tl: async () => {},
      document: { getElementById: () => node(), body: node() },
      Kf: stage, Mt: audio, Df: { glassford: {} }, Mc: [],
      Fl: EmptyUi, jl: EmptyUi, Pl: EmptyUi, Il: EmptyUi, Ll: EmptyUi, Rl: EmptyUi,
      sf: class { flags = new Set(); },
      Bf: class { preload() { throw new Error("speculative artwork queued before title audio"); } },
      uf: class { async run() { events.push("story started"); } },
      installResume: ({ revision }) => {
        assert.equal(revision, "unchanged-story-revision");
        return { start: (originalTitle) => originalTitle() };
      },
      localStorage: { getItem: () => null }, location: { search: "" }, URLSearchParams,
      xt: "", St: "", Ct: "", wt: "", Tt: "",
    });
  }
  const original = [];
  await assert.rejects(boot(source, original), /speculative artwork queued before title audio/u);
  assert.ok(!original.includes("original title audio requested"));
  const adapted = [];
  await boot(adaptEntry(source, "unchanged-story-revision"), adapted);
  assert.deepEqual(adapted, ["required opening artwork", "audio manifest ready", "original title shown",
    "audio unlocked", "original title audio requested", "story started"]);
});
test("rejects absent or duplicate speculative-artwork bootstrap markers", () => {
  const source = readFileSync(new URL("../../public/amissing-book/assets/index-BvgeSwOx.js", import.meta.url), "utf8");
  const marker = "d.preload();let f=new uf";
  assert.throws(() => adaptEntry(source.replace(marker, "let f=new uf"), "revision"), /bootstrap changed/u);
  assert.throws(() => adaptEntry(`${source}\n${marker}`, "revision"), /bootstrap changed/u);
});
test("uses the existing site icon instead of requesting a missing favicon.ico", () => {
  const source = '<html><head><title>The Amissing Book</title></head><body></body></html>';
  const adapted = adaptHtml(source);
  assert.ok(adapted.includes('rel="icon" href="/favicon.svg"'));
  assert.equal(adaptHtml(adapted), adapted);
  assert.ok(adapted.includes('<title>The Amissing Book</title>'));
  assert.throws(() => adaptHtml("<html>"));
});
