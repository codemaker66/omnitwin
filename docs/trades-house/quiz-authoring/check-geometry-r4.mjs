// R4 gate: proves the draft before it reaches the app, and sweeps the world
// weight λ so it is chosen from data rather than taste.
import { SCENES } from "./R4-WORLDS-DRAFT.mjs";
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
const vec=o=>K.map(k=>o[k]??0), dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0), nz=a=>Math.hypot(...a)||1, cos=(a,b)=>dot(a,b)/(nz(a)*nz(b));
const CV=Object.fromEntries(IDS.map(id=>[id,vec(CRAFTS[id])]));
const homes=Object.fromEntries(IDS.map(id=>[id,0])); SCENES.forEach(s=>s.options.forEach(o=>homes[o.world]++));
let fail=0;

console.log("== worlds: 4 distinct per scene, 3..4 homes per Craft ==");
SCENES.forEach((s,i)=>{ if(new Set(s.options.map(o=>o.world)).size!==4){console.log(`  FAIL Q${i+1} duplicate world`);fail++;} });
for(const id of IDS){ if(homes[id]<3||homes[id]>4){console.log(`  FAIL ${id} has ${homes[id]} homes`);fail++;} }
console.log("  homes:", IDS.map(id=>`${id}=${homes[id]}`).join(" "));

console.log("\n== channels agree: each home option within ~55° of its Craft (cos>=0.55) ==");
let worstAgree=[1,""];
SCENES.forEach((s,i)=>s.options.forEach((o,j)=>{ const c=cos(vec(o.axes),CV[o.world]); if(c<worstAgree[0]) worstAgree=[c,`Q${i+1}.${j+1} ${o.lead} -> ${o.world}`]; if(c<0.55){console.log(`  FAIL Q${i+1}.${j+1} "${o.lead}" vs ${o.world} = ${c.toFixed(2)}`);fail++;} }));
console.log(`  weakest agreement: ${worstAgree[1]} = ${worstAgree[0].toFixed(2)}`);

console.log("\n== collinearity: no same-direction within-scene pair above cos 0.70 ==");
let worst=[0,""];
SCENES.forEach((s,i)=>s.options.forEach((l,li)=>s.options.slice(li+1).forEach((r,off)=>{const c=cos(vec(l.axes),vec(r.axes)); if(c>worst[0])worst=[c,`Q${i+1} ${li+1}/${li+off+2}`]; if(c>0.70){console.log(`  FAIL Q${i+1} ${li+1}/${li+off+2} = ${c.toFixed(2)}`);fail++;}})));
console.log(`  highest: ${worst[1]} = ${worst[0].toFixed(2)}`);

// ---- the blended score, mirrored from the intended model ------------------
function rank(totals, world, lam){
  return IDS.map(id=>[id, cos(totals,CV[id]) + lam*(world[id]/homes[id])]).sort((a,b)=>b[1]-a[1]);
}
let seed=777; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const gauss=()=>{let u=0,v=0;while(u===0)u=rnd();while(v===0)v=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
function population(pick, lam, N=20000){
  const t=Object.fromEntries(IDS.map(id=>[id,0]));
  for(let n=0;n<N;n++){ const tt=[gauss(),gauss(),gauss(),gauss(),gauss()]; let tot=[0,0,0,0,0]; const w=Object.fromEntries(IDS.map(id=>[id,0]));
    for(const s of SCENES){ const o=s.options[pick(s,tt)]; tot=tot.map((x,i)=>x+vec(o.axes)[i]); w[o.world]++; }
    t[rank(tot,w,lam)[0][0]]++; }
  return IDS.map(id=>t[id]/N);
}
const dice=()=>Math.floor(rnd()*4);
const latent=(tau)=>(s,tt)=>{ const sc=s.options.map(o=>cos(vec(o.axes),tt)/tau); const m=Math.max(...sc); const e=sc.map(x=>Math.exp(x-m)); const Z=e.reduce((a,b)=>a+b,0); let r=rnd()*Z; for(let i=0;i<4;i++){r-=e[i]; if(r<=0)return i;} return 3; };
function pureOK(lam){ // temperament-pure AND world-pure respondents both self-sort
  let ok=0, misses=[];
  for(const id of IDS){ let tot=[0,0,0,0,0]; const w=Object.fromEntries(IDS.map(i=>[i,0]));
    for(const s of SCENES){ const best=[...s.options].sort((a,b)=>cos(vec(b.axes),CV[id])-cos(vec(a.axes),CV[id]))[0]; tot=tot.map((x,i)=>x+vec(best.axes)[i]); w[best.world]++; }
    const r=rank(tot,w,lam); if(r[0][0]===id) ok++; else misses.push(`${id}->${r[0][0]}`); }
  let okW=0, missesW=[];
  for(const id of IDS){ let tot=[0,0,0,0,0]; const w=Object.fromEntries(IDS.map(i=>[i,0]));
    for(const s of SCENES){ const home=s.options.find(o=>o.world===id); const best=home ?? [...s.options].sort((a,b)=>cos(vec(b.axes),CV[id])-cos(vec(a.axes),CV[id]))[0]; tot=tot.map((x,i)=>x+vec(best.axes)[i]); w[best.world]++; }
    const r=rank(tot,w,lam); if(r[0][0]===id) okW++; else missesW.push(`${id}->${r[0][0]}`); }
  return {ok, misses, okW, missesW};
}
console.log("\n== λ sweep (min share / max share of consistent respondents; pure sorts) ==");
for(const lam of [0,0.2,0.35,0.5,0.7,0.9,1.2]){
  const sh=population(latent(0.15),lam,12000); const lo=Math.min(...sh), hi=Math.max(...sh);
  const shD=population(dice,lam,12000); const loD=Math.min(...shD), hiD=Math.max(...shD);
  const p=pureOK(lam);
  console.log(`  λ=${String(lam).padEnd(4)} latent min ${(lo*100).toFixed(1)}% max ${(hi*100).toFixed(1)}% (${(hi/lo).toFixed(1)}x)   dice min ${(loD*100).toFixed(1)}% max ${(hiD*100).toFixed(1)}%   temp-pure ${p.ok}/14 ${p.misses.join(",")}   world-pure ${p.okW}/14 ${p.missesW.join(",")}`);
}
console.log(fail===0?"\nSTRUCTURAL GATES PASS":`\n${fail} STRUCTURAL FAILURE(S)`);

// ---- full distribution at the chosen λ, so the low crafts are named --------
const LAM = Number(process.env.LAM ?? 0.9);
for (const [label, pick] of [["dice", dice], ["latent τ=0.15", latent(0.15)], ["latent τ=0.5", latent(0.5)]]) {
  const sh = population(pick, LAM, 30000);
  const rows = IDS.map((id,i)=>[id,sh[i]]).sort((a,b)=>b[1]-a[1]);
  console.log(`\n== ${label} @ λ=${LAM} ==  ` + rows.map(([id,s])=>`${id.slice(0,5)} ${(s*100).toFixed(1)}`).join("  "));
}
