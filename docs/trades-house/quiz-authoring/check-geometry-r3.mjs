// Proves the R3 draft against the SHIPPED craft directions before any prose
// reaches the app. Three gates, all of which the app's own tests re-assert:
//   1. every Craft reachable   2. pure respondents self-sort
//   3. no same-direction within-scene pair above cos 0.70
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
const K = ["a1","a2","a3","a4","a5"];
const dot=(a,b)=>K.reduce((s,k)=>s+(a[k]??0)*(b[k]??0),0);
const mag=(a)=>Math.hypot(...K.map(k=>a[k]??0));
const cos=(a,b)=>{const m=mag(a)*mag(b); return m===0?0:dot(a,b)/m;};
const winner=(t)=>Object.entries(CRAFTS).map(([id,v])=>[id,cos(t,v)]).sort((x,y)=>y[1]-x[1]);
const add=(t,v)=>Object.fromEntries(K.map(k=>[k,(t[k]??0)+(v[k]??0)]));

let fail=0;
console.log(`scenes ${SCENES.length}, options ${SCENES.flatMap(s=>s.options).length}`);

// --- Gate 3 first: it is the cheapest and the most likely to bite ----------
console.log("\n== Gate 3: within-scene collinearity (cos > 0.70 fails) ==");
let worst=[];
SCENES.forEach((s,si)=>s.options.forEach((l,li)=>s.options.slice(li+1).forEach((r,off)=>{
  const c=cos(l.axes,r.axes);
  worst.push([c,`Q${si+1} opt${li+1}/${li+off+2}`]);
  if (c>0.70){ console.log(`  FAIL Q${si+1} opt${li+1}/${li+off+2} = ${c.toFixed(2)}`); fail++; }
})));
worst.sort((a,b)=>b[0]-a[0]);
console.log(`  highest same-direction pair: ${worst[0][1]} = ${worst[0][0].toFixed(2)}`);

// --- Gate 1: reachability by random walk ------------------------------------
console.log("\n== Gate 1: every Craft reachable ==");
const reached=new Set();
let seed=12345; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
for (let trial=0;trial<200000;trial++){
  let t={a1:0,a2:0,a3:0,a4:0,a5:0};
  for (const s of SCENES) t=add(t,s.options[Math.floor(rnd()*4)].axes);
  reached.add(winner(t)[0][0]);
}
const missing=Object.keys(CRAFTS).filter(c=>!reached.has(c));
console.log(`  reached ${reached.size}/14`);
if (missing.length){ console.log(`  FAIL unreachable: ${missing.join(", ")}`); fail++; }

// --- Gate 2: a pure respondent lands somewhere facing the same way ----------
console.log("\n== Gate 2: pure respondents self-sort ==");
for (const axis of K) for (const dir of [1,-1]) {
  let t={a1:0,a2:0,a3:0,a4:0,a5:0};
  for (const s of SCENES){
    const best=[...s.options].sort((a,b)=>dir*((b.axes[axis]??0)-(a.axes[axis]??0)))[0];
    t=add(t,best.axes);
  }
  const [id,score]=winner(t)[0];
  const ok=Math.sign(CRAFTS[id][axis]||0)===dir||CRAFTS[id][axis]===0;
  console.log(`  ${axis}${dir>0?"+":"-"} -> ${id.padEnd(10)} (${score.toFixed(2)}) craft ${axis}=${CRAFTS[id][axis]} ${ok?"ok":"MISMATCH"}`);
  if(!ok) fail++;
}
console.log(`\n${fail===0?"ALL GATES PASS":`${fail} FAILURE(S)`}`);
