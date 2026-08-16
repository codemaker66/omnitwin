// Which Craft's WORLD does each option live in?  Solves the assignment.
//
// FIT is my judgment, from the fourteen dossiers, of how honestly an option's
// SITUATION can carry a Craft's material and moral world with a light rewrite:
// 3 = the scene practically asks for it (Q1.2 cuttings -> gardeners),
// 2 = true with a sentence, 1 = a stretch. Absent = no.
// Constraints: four DISTINCT homes per scene; every Craft 3..4 homes; the six
// Crafts the temperament channel starves (measured by calibrate.mjs) prefer 4;
// the two it over-serves (dyers, coopers) prefer 3.
const FIT = {
 "1.1":{hammermen:3,wrights:3,barbers:2,tailors:1},
 "1.2":{gardeners:3,maltmen:1,bakers:1},
 "1.3":{tailors:2,weavers:2,maltmen:2,coopers:2,masons:1,skinners:1},
 "1.4":{cordiners:3,fleshers:3,barbers:2,dyers:2},
 "2.1":{fleshers:3,hammermen:2,dyers:2,cordiners:1},
 "2.2":{wrights:3,tailors:2,coopers:1,hammermen:1},
 "2.3":{barbers:3,bakers:2,maltmen:2,fleshers:1},
 "2.4":{weavers:3,masons:3,gardeners:1},
 "3.1":{wrights:3,masons:3,coopers:2,tailors:1},
 "3.2":{barbers:3,weavers:2,maltmen:2,skinners:1},
 "3.3":{wrights:3,hammermen:3,masons:2},
 "3.4":{gardeners:3,bakers:2,dyers:2,cordiners:1},
 "4.1":{coopers:2,weavers:2,masons:1,tailors:1,gardeners:1},
 "4.2":{hammermen:3,wrights:3,cordiners:2,bakers:2,tailors:2,weavers:2,fleshers:2},
 "4.3":{maltmen:3,skinners:3,barbers:2,gardeners:1},
 "4.4":{dyers:3,cordiners:3,hammermen:1},
 "5.1":{masons:3,tailors:3,weavers:2,coopers:2},
 "5.2":{hammermen:3,fleshers:3,tailors:2},
 "5.3":{barbers:3,maltmen:3,bakers:2,dyers:2},
 "5.4":{cordiners:3,skinners:3,coopers:2,wrights:1},
 "6.1":{coopers:3,tailors:2,fleshers:2},
 "6.2":{fleshers:2,dyers:2,hammermen:1,cordiners:1},
 "6.3":{barbers:3,maltmen:2,bakers:1},
 "6.4":{dyers:3,maltmen:2,wrights:2,hammermen:2},
 "7.1":{bakers:3,maltmen:2,cordiners:2,gardeners:1},
 "7.2":{tailors:3,weavers:2,coopers:2,masons:1},
 "7.3":{gardeners:3,coopers:2,skinners:1,masons:1},
 "7.4":{maltmen:3,bakers:3,skinners:2,fleshers:2},
 "8.1":{dyers:3,fleshers:2,hammermen:2},
 "8.2":{coopers:3,skinners:2,weavers:1,masons:1},
 "8.3":{barbers:3,maltmen:2,bakers:1},
 "8.4":{masons:3,wrights:2,gardeners:1},
 "9.1":{wrights:3,hammermen:3,masons:2,gardeners:1},
 "9.2":{masons:3,cordiners:3,bakers:2,wrights:2},
 "9.3":{barbers:2,fleshers:2,hammermen:2,dyers:2},
 "9.4":{dyers:2,gardeners:2,cordiners:2,skinners:1},
 "10.1":{weavers:3,wrights:3,masons:2},
 "10.2":{tailors:2,coopers:2,masons:1,hammermen:1},
 "10.3":{fleshers:3,hammermen:3,bakers:2,maltmen:1},
 "10.4":{gardeners:3,barbers:2,maltmen:2,cordiners:1},
 "11.1":{wrights:3,hammermen:3,tailors:2,barbers:2},
 "11.2":{skinners:3,masons:2,coopers:2,weavers:2},
 "11.3":{gardeners:3,maltmen:3,bakers:3},
 "11.4":{barbers:3,fleshers:2,bakers:2,maltmen:2},
 "12.1":{tailors:3,hammermen:3,coopers:2,wrights:2},
 "12.2":{cordiners:3,bakers:3,barbers:3},
 "12.3":{dyers:3,gardeners:2,fleshers:2,hammermen:1},
 "12.4":{masons:3,skinners:3,coopers:2},
};
// How forceful the ACT in each option is (2 bold, 1 mildly). A bold act homed to a
// steady Craft makes the two channels contradict each other on one answer, which
// is the one thing this design must never do.
const BOLD={"2.1":2,"2.3":1,"4.4":2,"5.2":2,"6.2":2,"6.4":2,"7.1":1,"8.1":2,"9.1":1,"9.3":2,"11.4":1,"12.3":2,"1.4":0};
const A4={hammermen:2,wrights:0,masons:-2,coopers:-1,tailors:1,weavers:-3,dyers:3,skinners:-2,cordiners:-1,bakers:0,fleshers:2,maltmen:-1,gardeners:-2,barbers:-1};
const IDS=["hammermen","wrights","masons","coopers","tailors","weavers","dyers","skinners","cordiners","bakers","fleshers","maltmen","gardeners","barbers"];
const PREFER4=new Set(["gardeners","cordiners","weavers","masons","hammermen","tailors"]);
const PREFER3=new Set(["dyers","coopers"]);
const SLOTS=Object.keys(FIT);
let seed=99; const rnd=()=>((seed=(seed*1103515245+12345)&0x7fffffff)/0x7fffffff);

function score(a){
  let s=0; const count=Object.fromEntries(IDS.map(i=>[i,0]));
  for(const k of SLOTS){ const c=a[k]; s+=FIT[k][c]??-50; count[c]++;
    const b=BOLD[k]??0; if(b===2&&A4[c]<=-1) s-=3; if(b===2&&A4[c]>=2) s+=1; if(b===1&&A4[c]<=-2) s-=1; }
  // scene distinctness
  for(let q=1;q<=12;q++){ const set=new Set([1,2,3,4].map(o=>a[`${q}.${o}`])); if(set.size<4) s-=40*(4-set.size); }
  for(const id of IDS){ const n=count[id];
    if(n<3) s-=60*(3-n); if(n>4) s-=60*(n-4);
    if(PREFER4.has(id)&&n===4) s+=4; if(PREFER3.has(id)&&n===3) s+=4; }
  return s;
}
// init greedy: best fit per slot
let a={}; for(const k of SLOTS){ a[k]=Object.entries(FIT[k]).sort((x,y)=>y[1]-x[1])[0][0]; }
let best=score(a);
for(let it=0;it<300000;it++){
  const k=SLOTS[Math.floor(rnd()*SLOTS.length)];
  const cands=Object.keys(FIT[k]); const c=cands[Math.floor(rnd()*cands.length)];
  const old=a[k]; if(c===old) continue; a[k]=c;
  const s=score(a); if(s>=best) best=s; else a[k]=old;
}
console.log("score",best);
const count=Object.fromEntries(IDS.map(i=>[i,[]]));
for(const k of SLOTS) count[a[k]].push(k);
for(const id of IDS) console.log(id.padEnd(10), String(count[id].length), count[id].join(" "));
console.log("\nby scene:");
for(let q=1;q<=12;q++) console.log(`Q${q}: `+[1,2,3,4].map(o=>`${o}=${a[`${q}.${o}`]}(${FIT[`${q}.${o}`][a[`${q}.${o}`]]})`).join("  "));
console.log("\nexport const HOMES = "+JSON.stringify(a)+";");
