// Acceptance gate for the R2 question set's scoring geometry.
// Run: node docs/trades-house/quiz-authoring/check-geometry.mjs
//
// Gate (from the 2026-08-05 coverage audit, finding "Verification of quoted
// figures"): (1) every craft gets >=3 top-2 pulls across the 48 options;
// (2) every pure-craft respondent simulation lands its own craft at #1;
// (3) no same-direction within-question option pair above cos 0.70.
// Plus advisories: label honesty (every "quietly serves" label in the
// option's computed top-2), axis budgets.
//
// At wiring time this file's checks become a Vitest suite against the real
// model data; until then it guards the drafts in R2-DRAFTS.md.

// v0.3 profiles: dossier-16 v0.2 with synthesis Part 2.3 amendments 1 & 2
// (Gardeners A5 -> -1, Maltmen A5 -> -1).
const PROFILES = {
  hammermen: [2, 3, 2, 2, 1],
  tailors: [0, 3, 0, 1, 1],
  cordiners: [1, -2, 1, -1, -1],
  maltmen: [-1, -2, -3, -1, -1],
  weavers: [1, 1, 1, -3, 0],
  bakers: [-1, -3, -1, 0, 1],
  skinners: [1, 1, -1, -2, -3],
  wrights: [2, 1, 1, 0, 3],
  coopers: [2, 2, 2, -1, -3],
  fleshers: [0, -2, 0, 2, 0],
  masons: [3, 1, 1, -2, 1],
  gardeners: [-3, 0, 1, -2, -1],
  barbers: [-2, 1, -2, -1, -1],
  bonnetmakers: [-2, 1, -1, 3, 2],
};

// Revised option vectors (post-audit). id: [A1..A5], labels = quietly-serves.
const OPTIONS = [
  { id: "A1", v: [2, 0, 0, -1, 1], labels: ["masons"] },
  { id: "A2", v: [0, 0, 1, -2, 0], labels: ["weavers"] },
  { id: "A3", v: [0, -2, -1, 0, 0], labels: ["bakers", "maltmen"] },
  { id: "A4", v: [1, 0, 0, 0, -2], labels: ["coopers", "skinners"] },

  { id: "B1", v: [1, 2, 2, 0, 0], labels: ["hammermen"] },
  { id: "B2", v: [-1, 2, -1, 0, 0], labels: ["tailors"] },
  { id: "B3", v: [0, 0, -2, -2, 0], labels: ["maltmen"] },
  { id: "B4", v: [0, -2, 1, 0, -1], labels: ["cordiners"] },

  { id: "C1", v: [0, -2, 0, 1, 0], labels: ["fleshers", "bakers"] },
  { id: "C2", v: [0, 1, 0, 0, -2], labels: ["coopers", "skinners"] },
  { id: "C3", v: [2, 0, 0, 0, 0], labels: ["masons"] },
  { id: "C4", v: [-1, 0, -1, 3, 1], labels: ["bonnetmakers"] },

  { id: "D1", v: [1, 2, 2, 1, 0], labels: ["hammermen"] },
  { id: "D2", v: [0, -1, 0, 0, 2], labels: ["bakers"] },
  { id: "D3", v: [0, 0, 0, 0, -3], labels: ["skinners", "coopers"] },
  { id: "D4", v: [0, 0, -2, -1, 0], labels: ["maltmen"] },

  { id: "E1", v: [0, -1, -2, 0, 0], labels: ["maltmen"] },
  { id: "E2", v: [0, 2, 0, 0, -1], labels: ["coopers", "tailors"] },
  { id: "E3", v: [-2, 0, -1, 0, 0], labels: ["barbers"] },
  { id: "E4", v: [0, 0, 0, -1, -2], labels: ["skinners", "coopers"] },

  { id: "F1", v: [0, 3, 0, 0, 0], labels: ["tailors"] },
  { id: "F2", v: [0, 1, 1, 0, -2], labels: ["coopers"] },
  { id: "F3", v: [0, -1, 0, 2, 0], labels: ["fleshers"] },
  { id: "F4", v: [0, 0, 0, -2, -1], labels: ["weavers", "skinners"] },

  { id: "G1", v: [0, -2, -1, 0, 0], labels: ["bakers", "maltmen"] },
  { id: "G2", v: [0, 0, 0, 3, 1], labels: ["bonnetmakers"] },
  { id: "G3", v: [0, 1, 0, -3, 0], labels: ["weavers"] },
  { id: "G4", v: [0, 0, 1, 0, 2], labels: ["wrights"] },

  { id: "H1", v: [2, 1, 0, 0, 0], labels: ["masons"] },
  { id: "H2", v: [0, -2, 0, -1, -1], labels: ["cordiners"] },
  { id: "H3", v: [0, 0, 0, -2, -2], labels: ["skinners"] },
  { id: "H4", v: [0, 0, 1, 1, 2], labels: ["wrights"] },

  { id: "I1", v: [0, 0, -3, 0, 0], labels: ["maltmen"] },
  { id: "I2", v: [0, 2, 0, 1, 0], labels: ["tailors"] },
  { id: "I3", v: [0, 0, -1, 3, 1], labels: ["bonnetmakers"] },
  { id: "I4", v: [0, -1, 1, 0, -1], labels: ["cordiners"] },

  { id: "J1", v: [-2, 0, -2, 0, 0], labels: ["barbers"] },
  { id: "J2", v: [0, 2, 0, 0, -1], labels: ["coopers", "tailors"] },
  { id: "J3", v: [0, 0, -1, 0, -2], labels: ["skinners"] },
  { id: "J4", v: [2, 1, 0, -2, 0], labels: ["masons"] },

  { id: "K1", v: [-2, 0, 1, -1, 0], labels: ["gardeners"] },
  { id: "K2", v: [0, 1, 0, 0, 2], labels: ["wrights"] },
  { id: "K3", v: [-1, 0, 0, 2, 1], labels: ["bonnetmakers"] },
  { id: "K4", v: [1, 0, -1, 0, -1], labels: ["skinners"] },

  { id: "L1", v: [-3, 0, 0, 0, 0], labels: ["gardeners", "barbers"] },
  { id: "L2", v: [2, 0, 0, 0, -2], labels: ["coopers", "skinners"] },
  { id: "L3", v: [0, -2, 0, 1, 0], labels: ["fleshers", "bakers"] },
  { id: "L4", v: [-1, 0, 1, -2, 0], labels: ["gardeners", "weavers"] },
];

const CRAFTS = Object.keys(PROFILES);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a));
const cos = (a, b) => {
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot(a, b) / n;
};

const rankings = OPTIONS.map((o) => ({
  ...o,
  ranked: CRAFTS.map((c) => ({ c, s: cos(o.v, PROFILES[c]) })).sort((x, y) => y.s - x.s),
}));

let failures = 0;
const warn = [];

// --- Gate 1: every craft >= 3 top-2 pulls -----------------------------------
console.log("== Gate 1: top-2 pulls per craft (need >=3) ==");
for (const c of CRAFTS) {
  const top1 = rankings.filter((o) => o.ranked[0].c === c);
  const top2 = rankings.filter((o) => o.ranked[0].c === c || o.ranked[1].c === c);
  const ok = top2.length >= 3;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "  ok " : "FAIL "}${c.padEnd(13)} top1=${String(top1.length).padStart(2)} top2=${String(top2.length).padStart(2)}  [${top2.map((o) => o.id).join(" ")}]`,
  );
}

// --- Gate 2: pure-craft simulations land self at #1 --------------------------
console.log("\n== Gate 2: pure-craft respondent simulations ==");
const questions = [...new Set(OPTIONS.map((o) => o.id[0]))];
for (const c of CRAFTS) {
  const sum = [0, 0, 0, 0, 0];
  for (const q of questions) {
    const opts = rankings.filter((o) => o.id[0] === q);
    const best = opts.reduce((a, b) => (cos(b.v, PROFILES[c]) > cos(a.v, PROFILES[c]) ? b : a));
    best.v.forEach((x, i) => { sum[i] += x; });
  }
  const outcome = CRAFTS.map((k) => ({ k, s: cos(sum, PROFILES[k]) })).sort((x, y) => y.s - x.s);
  const ok = outcome[0].k === c;
  if (!ok) failures += 1;
  const margin = (outcome[0].s - outcome[1].s).toFixed(3);
  console.log(
    `${ok ? "  ok " : "FAIL "}${c.padEnd(13)} -> ${outcome[0].k} ${outcome[0].s.toFixed(3)} (next ${outcome[1].k} ${outcome[1].s.toFixed(3)}, margin ${margin})`,
  );
}

// --- Gate 3: within-question same-direction pairs <= 0.70 --------------------
console.log("\n== Gate 3: within-question collinearity (cos > 0.70 fails) ==");
let collinear = 0;
for (const q of questions) {
  const opts = OPTIONS.filter((o) => o.id[0] === q);
  for (let i = 0; i < opts.length; i += 1) {
    for (let j = i + 1; j < opts.length; j += 1) {
      const s = cos(opts[i].v, opts[j].v);
      if (s > 0.7) {
        collinear += 1;
        failures += 1;
        console.log(`FAIL ${opts[i].id}/${opts[j].id} cos=${s.toFixed(3)}`);
      }
    }
  }
}
if (collinear === 0) console.log("  ok — no pair above 0.70");

// --- Advisory: label honesty (every label in computed top-2) -----------------
console.log("\n== Advisory: label honesty ==");
for (const o of rankings) {
  for (const label of o.labels) {
    const rank = o.ranked.findIndex((r) => r.c === label);
    const s = o.ranked[rank].s;
    if (rank > 1 || s < 0.6) {
      warn.push(`${o.id} label "${label}" rank #${rank + 1} cos=${s.toFixed(3)} (top: ${o.ranked[0].c} ${o.ranked[0].s.toFixed(3)})`);
    }
  }
}
console.log(warn.length === 0 ? "  ok — every label sits in its option's top-2 at cos >= 0.60" : warn.map((w) => `WARN ${w}`).join("\n"));

// --- Advisory: axis budgets ---------------------------------------------------
const budget = [0, 1, 2, 3, 4].map((axis) => ({
  axis: `A${axis + 1}`,
  sumAbs: OPTIONS.reduce((s, o) => s + Math.abs(o.v[axis]), 0),
  net: OPTIONS.reduce((s, o) => s + o.v[axis], 0),
  posSum: OPTIONS.reduce((s, o) => s + Math.max(0, o.v[axis]), 0),
}));
console.log("\n== Advisory: axis budgets ==");
for (const b of budget) console.log(`  ${b.axis} sum|w|=${b.sumAbs} net=${b.net} positive=${b.posSum}`);

console.log(`\n${failures === 0 ? "GATE PASSED" : `GATE FAILED (${failures} failures)`} — ${warn.length} label warnings`);
process.exit(failures === 0 ? 0 : 1);
