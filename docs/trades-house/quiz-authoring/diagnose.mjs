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
const K=["a1","a2","a3","a4","a5"];
const dot=(a,b)=>K.reduce((s,k)=>s+(a[k]??0)*(b[k]??0),0);
const mag=(a)=>Math.hypot(...K.map(k=>a[k]??0));
const cos=(a,b)=>{const m=mag(a)*mag(b);return m===0?0:dot(a,b)/m;};
const add=(t,v)=>Object.fromEntries(K.map(k=>[k,(t[k]??0)+(v[k]??0)]));
const show=(v)=>K.map(k=>(v[k]??0)).join(",");

for (const [id,target] of Object.entries(CRAFTS)) {
  let t={a1:0,a2:0,a3:0,a4:0,a5:0}; const picks=[];
  SCENES.forEach((s,si)=>{
    const best=[...s.options].map((o,i)=>({o,i,c:cos(o.axes,target)})).sort((a,b)=>b.c-a.c)[0];
    t=add(t,best.o.axes); picks.push(`Q${si+1}.${best.i+1}`);
  });
  const rank=Object.entries(CRAFTS).map(([c,v])=>[c,cos(t,v)]).sort((a,b)=>b[1]-a[1]);
  const ok=rank[0][0]===id;
  const margin=rank[0][1]-rank[1][1];
  if (!ok || margin<0.02)
    console.log(`${ok?"thin ":"MISS "} ${id.padEnd(10)} -> ${rank[0][0].padEnd(10)} m=${margin.toFixed(3)} | sum(${show(t)}) want(${show(target)})\n        runner-up ${rank[1][0]} | picks ${picks.join(" ")}`);
}
