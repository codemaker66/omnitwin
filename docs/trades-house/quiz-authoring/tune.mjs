// Hill-climb small, defensible tweaks (max +/-2 from the authored vector on any
// axis) until every Craft sorts to itself with a real margin. Small deltas are
// the point: a vector is a claim the prose makes, so it may be nudged, never
// rewritten out from under the words.
import { SCENES } from "./R3-LEGUIN-DRAFT.mjs";
const CRAFTS = {
  hammermen:{a1:2,a2:3,a3:2,a4:2,a5:1},   wrights:{a1:2,a2:1,a3:1,a4:0,a5:3},
  masons:{a1:3,a2:1,a3:1,a4:-2,a5:1},     coopers:{a1:2,a2:2,a3:2,a4:-1,a5:-3},
  tailors:{a1:0,a2:3,a3:0,a4:1,a5:1},     weavers:{a1:1,a2:1,a3:1,a4:-3,a5:0},
  dyers:{a1:-2,a2:1,a3:-1,a4:3,a5:2},     skinners:{a1:1,a2:1,a3:-1,a4:-2,a5:-3},
  cordiners:{a1:1,a2:-2,a3:1,a4:-1,a5:-1},bakers:{a1:-1,a2:-3,a3:-1,a4:0,a5:1},
  fleshers:{a1:0,a2:-2,a3:0,a4:2,a5:0},   maltmen:{a1:-1,a2:-2,a3:-3,a4:-1,a5:-1},
  gardeners:{a1:-3,a2:0,a3:1,a4:-2,a5:-1},barbers:{a1:-2,a2:1,a3:-2,a4:-1,a5:-1},
};
const K=["a1","a2","a3","a4","a5"], IDS=Object.keys(CRAFTS);
const dot=(a,b)=>K.reduce((s,k)=>s+(a[k]??0)*(b[k]??0),0);
const mag=(a)=>Math.hypot(...K.map(k=>a[k]??0));
const cos=(a,b)=>{const m=mag(a)*mag(b);return m===0?0:dot(a,b)/m;};

const base = SCENES.map(s=>s.options.map(o=>K.map(k=>o.axes[k]??0)));
const V=(arr)=>Object.fromEntries(K.map((k,i)=>[k,arr[i]]));

function score(g){
  let correct=0, minMargin=1, penalty=0;
  for (const id of IDS){
    const target=CRAFTS[id];
    let t=[0,0,0,0,0];
    for (let q=0;q<g.length;q++){
      let best=null,bc=-2;
      for (let o=0;o<4;o++){const c=cos(V(g[q][o]),target); if(c>bc){bc=c;best=o;}}
      for(let i=0;i<5;i++) t[i]+=g[q][best][i];
    }
    const rank=IDS.map(c=>[c,cos(V(t),CRAFTS[c])]).sort((a,b)=>b[1]-a[1]);
    if(rank[0][0]===id){correct++; minMargin=Math.min(minMargin, rank[0][1]-rank[1][1]);}
  }
  // collinearity: any same-direction pair over 0.70 is disqualifying
  for(const q of g) for(let i=0;i<4;i++) for(let j=i+1;j<4;j++){
    const c=cos(V(q[i]),V(q[j])); if(c>0.70) penalty += (c-0.70)*100;
    if(mag(V(q[i]))===0) penalty += 50;
  }
  return correct*10 + (correct===14?minMargin*100:0) - penalty;
}

let g = base.map(q=>q.map(o=>[...o]));
let cur = score(g);
let seed=7; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
for (let iter=0; iter<120000 && cur < 142; iter++){
  const q=Math.floor(rnd()*12), o=Math.floor(rnd()*4), a=Math.floor(rnd()*5);
  const delta = rnd()<0.5?1:-1;
  const next = g[q][o][a]+delta;
  if (Math.abs(next)>3) continue;
  // The DOMINANT axis is what the prose is actually about — "The tools" is a
  // Make answer and must stay one. Lock its sign and keep it dominant; the
  // secondary axes are where the unintended correlation lives, and the only
  // place tuning is honest.
  const b = base[q][o];
  const domMag = Math.max(...b.map(Math.abs));
  const isDom = Math.abs(b[a]) === domMag && domMag >= 2;
  if (isDom) {
    if (Math.sign(next) !== Math.sign(b[a]) || Math.abs(next) < domMag - 1) continue;
  } else if (Math.abs(next - b[a]) > 2) continue;
  const old=g[q][o][a]; g[q][o][a]=next;
  const s=score(g);
  if (s>=cur) cur=s; else g[q][o][a]=old;
}
console.log("phase 1 score", cur.toFixed(2), "(140 = all 14 sort correctly)");

// Phase 2 — parsimony as a separate pass. Walk every change back one at a time
// and keep the revert whenever correctness survives it. A search that is merely
// allowed to prefer small diffs wanders; a search that must JUSTIFY each
// surviving change cannot.
let reverted = 0;
for (let pass = 0; pass < 3; pass++) {
  for (let q = 0; q < 12; q++) for (let o = 0; o < 4; o++) for (let i = 0; i < 5; i++) {
    if (g[q][o][i] === base[q][o][i]) continue;
    const keep = g[q][o][i];
    const step = keep > base[q][o][i] ? -1 : 1;
    g[q][o][i] = keep + step;
    const s2 = score(g);
    if (s2 >= cur) { cur = s2; reverted++; } else { g[q][o][i] = keep; }
  }
}
console.log("phase 2 reverted", reverted, "step(s); score", cur.toFixed(2));
const changes=[];
for(let q=0;q<12;q++)for(let o=0;o<4;o++)for(let i=0;i<5;i++)
  if(g[q][o][i]!==base[q][o][i]) changes.push(`Q${q+1}.${o+1} ${K[i]}: ${base[q][o][i]} -> ${g[q][o][i]}  "${SCENES[q].options[o].lead}"`);
console.log(`${changes.length} tweaks:`); changes.forEach(c=>console.log("  "+c));
console.log("\nFINAL VECTORS");
for(let q=0;q<12;q++) console.log(`Q${q+1} ${JSON.stringify(g[q])}`);

// Write the tuned vectors back into the draft, leaving every word untouched.
import { readFileSync, writeFileSync } from "node:fs";
const P = new URL("./R3-LEGUIN-DRAFT.mjs", import.meta.url);
let text = readFileSync(P, "utf8");
let n = 0;
const axesRe = /axes: \{[^}]*\}/g;
const all = [...text.matchAll(axesRe)];
if (all.length !== 48) { console.error(`expected 48 axes blocks, found ${all.length}`); process.exit(1); }
let out = "", last = 0;
all.forEach((m, idx) => {
  const q = Math.floor(idx / 4), o = idx % 4;
  const body = K.map((k, i) => `${k}: ${g[q][o][i]}`).filter((_, i) => g[q][o][i] !== 0).join(", ");
  out += text.slice(last, m.index) + `axes: { ${body} }`;
  last = m.index + m[0].length; n++;
});
out += text.slice(last);
writeFileSync(P, out);
console.log(`\nwrote ${n} tuned vectors back into the draft (prose untouched)`);
