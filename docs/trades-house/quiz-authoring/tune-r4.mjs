// Bounded re-vectoring against FAIRNESS, with the two-channel score.
// Moves: ±1 steps, never more than 2 from the authored value, dominant axis sign
// locked and kept dominant (the prose's claim may be sharpened, never reversed),
// home agreement cos>=0.55 kept, within-scene pairs <=0.70 kept.
// Objective: raise the floor of both populations, keep pure respondents sorting.
import { SCENES } from "./R4-WORLDS-DRAFT.mjs";
import { writeFileSync } from "node:fs";
const CRAFTS = {
  hammermen:{a1:2,a2:3,a3:2,a4:2,a5:1},   wrights:{a1:2,a2:1,a3:1,a4:0,a5:3},
  masons:{a1:3,a2:1,a3:1,a4:-2,a5:1},     coopers:{a1:2,a2:2,a3:2,a4:-1,a5:-3},
  tailors:{a1:0,a2:3,a3:0,a4:1,a5:1},     weavers:{a1:1,a2:1,a3:1,a4:-3,a5:0},
  dyers:{a1:-2,a2:1,a3:-1,a4:3,a5:2},     skinners:{a1:1,a2:1,a3:-1,a4:-2,a5:-3},
  cordiners:{a1:1,a2:-2,a3:1,a4:-1,a5:-1},bakers:{a1:-1,a2:-3,a3:-1,a4:0,a5:1},
  fleshers:{a1:0,a2:-2,a3:0,a4:2,a5:0},   maltmen:{a1:-1,a2:-2,a3:-3,a4:-1,a5:-1},
  gardeners:{a1:-3,a2:0,a3:1,a4:-2,a5:-1},barbers:{a1:-2,a2:1,a3:-2,a4:-1,a5:-1},
};
const K=["a1","a2","a3","a4","a5"], IDS=Object.keys(CRAFTS), LAM=Number(process.env.LAM??0.9);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0), nz=a=>Math.hypot(...a)||1, cos=(a,b)=>dot(a,b)/(nz(a)*nz(b));
const CV=Object.fromEntries(IDS.map(id=>[id,K.map(k=>CRAFTS[id][k])]));
const base=SCENES.map(s=>s.options.map(o=>K.map(k=>o.axes[k]??0)));
const worlds=SCENES.map(s=>s.options.map(o=>o.world));
const homes=Object.fromEntries(IDS.map(id=>[id,0])); worlds.flat().forEach(w=>homes[w]++);
let seed=31337; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);
const gauss=()=>{let u=0,v=0;while(u===0)u=rnd();while(v===0)v=rnd();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);};
// Fixed respondent panels so the objective is deterministic across moves.
const PANEL=Array.from({length:1500},()=>[gauss(),gauss(),gauss(),gauss(),gauss()]);
const DICE=Array.from({length:2500},()=>Array.from({length:12},()=>Math.floor(rnd()*4)));
const rank=(tot,w)=>IDS.map(id=>[id,cos(tot,CV[id])+LAM*(w[id]/homes[id])]).sort((a,b)=>b[1]-a[1]);
function shares(g, mode){
  const t=Object.fromEntries(IDS.map(id=>[id,0]));
  const N = mode==="dice"?DICE.length:PANEL.length;
  for(let n=0;n<N;n++){ let tot=[0,0,0,0,0]; const w=Object.fromEntries(IDS.map(id=>[id,0]));
    for(let q=0;q<12;q++){ let oi;
      if(mode==="dice") oi=DICE[n][q];
      else { let best=-2; for(let o=0;o<4;o++){const c=cos(g[q][o],PANEL[n]); if(c>best){best=c;oi=o;}} }
      tot=tot.map((x,i)=>x+g[q][oi][i]); w[worlds[q][oi]]++; }
    t[rank(tot,w)[0][0]]++; }
  return IDS.map(id=>t[id]/N);
}
function pure(g){ let ok=0;
  for(const id of IDS){ let tot=[0,0,0,0,0]; const w=Object.fromEntries(IDS.map(i=>[i,0]));
    for(let q=0;q<12;q++){ let bi=0,bc=-2; for(let o=0;o<4;o++){const c=cos(g[q][o],CV[id]); if(c>bc){bc=c;bi=o;}} tot=tot.map((x,i)=>x+g[q][bi][i]); w[worlds[q][bi]]++; }
    if(rank(tot,w)[0][0]===id) ok++; }
  return ok;
}
function structural(g){ let pen=0;
  for(let q=0;q<12;q++){ for(let o=0;o<4;o++){ if(cos(g[q][o],CV[worlds[q][o]])<0.55) pen+=5; if(nz(g[q][o])<1) pen+=50; }
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){const c=cos(g[q][i],g[q][j]); if(c>0.70) pen+=20*(c-0.70)*10;} }
  return pen;
}
function score(g){
  const d=shares(g,"dice"), l=shares(g,"latent");
  const p=pure(g);
  let drift=0; for(let q=0;q<12;q++)for(let o=0;o<4;o++)for(let i=0;i<5;i++) drift+=Math.abs(g[q][o][i]-base[q][o][i]);
  return 100*Math.min(...d) + 100*Math.min(...l) - 40*Math.max(...d) - 40*Math.max(...l) + 3*p - structural(g) - 0.15*drift;
}
let g=base.map(q=>q.map(o=>[...o])); let cur=score(g); const start=cur;
const ITER=Number(process.env.ITER??25000);
for(let it=0;it<ITER;it++){
  const q=Math.floor(rnd()*12), o=Math.floor(rnd()*4), a=Math.floor(rnd()*5), d=rnd()<0.5?1:-1;
  const b=base[q][o], next=g[q][o][a]+d;
  if(Math.abs(next)>3 || Math.abs(next-b[a])>2) continue;
  const domMag=Math.max(...b.map(Math.abs)), isDom=Math.abs(b[a])===domMag&&domMag>=2;
  if(isDom && (Math.sign(next)!==Math.sign(b[a]) || Math.abs(next)<domMag-1)) continue;
  const old=g[q][o][a]; g[q][o][a]=next; const s=score(g); if(s>cur) cur=s; else g[q][o][a]=old;
}
const d=shares(g,"dice"), l=shares(g,"latent");
console.log(`score ${start.toFixed(1)} -> ${cur.toFixed(1)} | dice min ${(Math.min(...d)*100).toFixed(1)}% max ${(Math.max(...d)*100).toFixed(1)}% | latent min ${(Math.min(...l)*100).toFixed(1)}% max ${(Math.max(...l)*100).toFixed(1)}% | pure ${pure(g)}/14`);
const changes=[]; for(let q=0;q<12;q++)for(let o=0;o<4;o++)for(let i=0;i<5;i++) if(g[q][o][i]!==base[q][o][i]) changes.push(`Q${q+1}.${o+1} ${K[i]} ${base[q][o][i]}->${g[q][o][i]}`);
console.log(changes.length+" tweaks: "+changes.join("  "));
writeFileSync(new URL("./tuned-r4.json", import.meta.url), JSON.stringify(g));
