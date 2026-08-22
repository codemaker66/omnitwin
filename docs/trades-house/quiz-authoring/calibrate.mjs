// Fairness instrument: what share of a REALISTIC population lands on each Craft?
//   node --experimental-strip-types docs/trades-house/quiz-authoring/calibrate.mjs
// Reads the shipped model, so it measures what visitors actually get.
//
// Three populations:
//   dice     uniform random option per scene (what reachability tests use — a floor)
//   latent   respondents with a hidden temperament t ~ N(0,I) in axis space who
//            pick the option nearest their temperament (softmax, temperature τ)
//   pure     one perfect respondent per Craft (the existing self-sort gate)
import { CRAFT_QUESTIONS, CRAFT_AXIS_PROFILES, rankCrafts, ZERO_CRAFT_QUIZ_PROGRESS, applyCraftQuizAnswer }
  from "../../../packages/web/src/features/trades-house/craft-quiz-model.ts";

const K = ["a1","a2","a3","a4","a5"];
const IDS = Object.keys(CRAFT_AXIS_PROFILES);
const N = 40000;
let seed = 424242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => { let u=0,v=0; while(u===0)u=rnd(); while(v===0)v=rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
const vec = (o) => K.map(k => o[k] ?? 0);
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
const norm = (a) => Math.hypot(...a) || 1;
const cos = (a,b) => dot(a,b)/(norm(a)*norm(b));

function run(pickFn) {
  const tally = Object.fromEntries(IDS.map(id=>[id,0]));
  for (let n=0;n<N;n++){
    let progress = ZERO_CRAFT_QUIZ_PROGRESS;
    const t = [gauss(),gauss(),gauss(),gauss(),gauss()];
    CRAFT_QUESTIONS.forEach((q,qi)=>{ progress = applyCraftQuizAnswer(progress, qi, pickFn(q, t)); });
    tally[rankCrafts(progress)[0].craftId] += 1;
  }
  return tally;
}
const dice = () => Math.floor(rnd()*4);
const latent = (tau) => (q,t) => {
  const s = q.options.map(o => cos(vec(o.axes), t)/tau);
  const m = Math.max(...s); const e = s.map(x=>Math.exp(x-m)); const Z=e.reduce((a,b)=>a+b,0);
  let r = rnd()*Z; for (let i=0;i<4;i++){ r-=e[i]; if (r<=0) return i; } return 3;
};

function report(label, tally){
  const shares = IDS.map(id => tally[id]/N);
  const uni = 1/IDS.length;
  const lo = Math.min(...shares), hi = Math.max(...shares);
  console.log(`\n== ${label} ==   uniform=${(uni*100).toFixed(1)}%   min=${(lo*100).toFixed(1)}%  max=${(hi*100).toFixed(1)}%  ratio=${(hi/Math.max(lo,1e-9)).toFixed(1)}x`);
  IDS.map((id,i)=>[id,shares[i]]).sort((a,b)=>b[1]-a[1]).forEach(([id,s])=>{
    const bar = "█".repeat(Math.round(s*200));
    const flag = s < uni*0.6 ? "  ◄ starved" : s > uni*1.5 ? "  ◄ hoards" : "";
    console.log(`  ${id.padEnd(10)} ${(s*100).toFixed(1).padStart(5)}%  ${bar}${flag}`);
  });
}
report("dice (uniform random picks)", run(dice));
report("latent temperament, τ=0.15 (consistent people)", run(latent(0.15)));
report("latent temperament, τ=0.5 (noisier people)", run(latent(0.5)));

// Legibility probe: which options push hardest toward each Craft?
console.log("\n== what each Craft's strongest answers actually SAY (top 3 by cosine) ==");
for (const id of IDS){
  const c = vec(CRAFT_AXIS_PROFILES[id]);
  const all=[]; CRAFT_QUESTIONS.forEach((q,qi)=>q.options.forEach((o,oi)=>all.push([cos(vec(o.axes),c),`Q${qi+1}.${oi+1} ${o.lead}`])));
  all.sort((a,b)=>b[0]-a[0]);
  console.log(`  ${id.padEnd(10)} ${all.slice(0,3).map(([s,l])=>`${l} (${s.toFixed(2)})`).join("  |  ")}`);
}
