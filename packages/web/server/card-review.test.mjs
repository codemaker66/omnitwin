import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReviewHandler, readBody, tokenHash, validateResponse } from './card-review-core.mjs';

const ownerToken = randomBytes(32).toString('base64url');
const sessionToken = randomBytes(32).toString('base64url');
const otherToken = randomBytes(32).toString('base64url');
const rates = new Map();
const records = new Map();
let failures = false;
const store = {
  async takeRateLimit(key, limit) { const count = (rates.get(key) ?? 0) + 1; rates.set(key, count); return count <= limit; },
  async getResponse(hash) { if (failures) throw new Error('database detail that must not leak'); return records.get(hash) ?? null; },
  async listResponses() { return [...records.values()]; },
  async saveResponse(hash, body) {
    const current = records.get(hash);
    if ((current?.revision ?? 0) !== body.revision) return null;
    const row = {...body, id:current?.id ?? randomUUID(), revision:body.revision + 1, createdAt:current?.createdAt ?? new Date().toISOString(), updatedAt:new Date().toISOString()};
    records.set(hash,row); return row;
  },
};
const server = createServer(createReviewHandler({store, ownerToken, rateSecret:randomBytes(32).toString('base64url'),allowedOrigins:['https://venviewer.com']}));
let base;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(()=>new Promise(resolve=>server.close(resolve)));
beforeEach(()=>{rates.clear();records.clear();failures=false;});
const valid = (extra={}) => ({reviewerName:'Elaine',favourite:'38',comments:{'43':'Beautiful reverse.'},generalComment:'',revision:0,...extra});
async function request({method='GET',token=sessionToken,body,origin='https://venviewer.com',path='/api/card-review',headers={}}={}) {
  return fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(origin?{Origin:origin}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
}

test('save, reopen and edit preserve one response and increase revision',async()=>{
  let response=await request({method:'POST',body:valid()});assert.equal(response.status,200);
  const saved=(await response.json()).response;assert.equal(saved.revision,1);
  assert.equal(records.size,1);assert.ok(!JSON.stringify(saved).includes(sessionToken));
  response=await request();assert.equal((await response.json()).response.id,saved.id);
  response=await request({method:'POST',body:valid({favourite:'46',revision:1})});assert.equal(response.status,200);
  assert.equal((await response.json()).response.revision,2);assert.equal(records.size,1);
});
test('another respondent cannot read or overwrite the first',async()=>{
  await request({method:'POST',body:valid()});
  assert.equal((await (await request({token:otherToken})).json()).response,null);
  const edit=await request({method:'POST',token:otherToken,body:valid({revision:1})});assert.equal(edit.status,409);
  assert.equal(records.get(tokenHash(sessionToken)).favourite,'38');
});
test('owner alone can list responses, with cache prevention',async()=>{
  await request({method:'POST',body:valid()});
  assert.equal((await request({path:'/api/card-review?view=all'})).status,403);
  assert.equal((await request({token:null,path:'/api/card-review?view=all'})).status,401);
  const response=await request({token:ownerToken,path:'/api/card-review?view=all'});
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  const data=await response.json();assert.equal(data.responses.length,1);assert.ok(!JSON.stringify(data).includes('session_hash'));
});
test('owner token cannot accidentally submit a review',async()=>{
  assert.equal((await request({method:'POST',token:ownerToken,body:valid()})).status,403);assert.equal(records.size,0);
});
test('stale revision fails without replacing saved text',async()=>{
  await request({method:'POST',body:valid()});
  const response=await request({method:'POST',body:valid({favourite:'05'})});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'STALE_RESPONSE');
  assert.equal(records.get(tokenHash(sessionToken)).favourite,'38');
});
test('unknown designs, fields and excessive text fail',async()=>{
  for(const body of [valid({favourite:'99'}),valid({comments:{'99':'x'}}),valid({reviewerName:'x'.repeat(101)}),valid({comments:{'38':'x'.repeat(2001)}}),valid({generalComment:'x'.repeat(2001)}),valid({revision:-1}),valid({owner:true})]){
    assert.equal((await request({method:'POST',body})).status,400);
  }
  assert.equal(records.size,0);
});
test('comments-only response is accepted while empty response is rejected',async()=>{
  assert.equal((await request({method:'POST',body:valid({favourite:null,comments:{},generalComment:'Consider a warmer gold.'})})).status,200);
  assert.equal((await request({method:'POST',token:otherToken,body:valid({favourite:null,comments:{},generalComment:'  '})})).status,400);
});
test('cross-origin and originless mutations are rejected',async()=>{
  for(const origin of ['https://evil.example',null]) assert.equal((await request({method:'POST',body:valid(),origin})).status,403);
  assert.equal((await request({headers:{'sec-fetch-site':'cross-site'}})).status,403);
});
test('missing and malformed session credentials fail',async()=>{
  assert.equal((await request({token:null})).status,401);
  assert.equal((await request({token:'short'})).status,401);
});
test('body byte limit rejects large submissions before storage',async()=>{
  const response=await request({method:'POST',body:valid({generalComment:'x'.repeat(45_000)})});
  assert.equal(response.status,413);assert.equal(records.size,0);
});
test('content type and unsupported methods are rejected',async()=>{
  assert.equal((await request({method:'POST',body:valid(),headers:{'Content-Type':'text/plain'}})).status,415);
  const response=await request({method:'DELETE'});assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, POST');
});
test('durable rate store rejects excess attempts without retaining raw address',async()=>{
  for(let i=0;i<60;i++) await request({method:'POST',body:valid({revision:-1})});
  const response=await request({method:'POST',body:valid()});assert.equal(response.status,429);
  assert.equal(response.headers.get('retry-after'),'3600');assert.ok([...rates.keys()].every(key=>/^[a-f0-9]{64}$/.test(key)));
});
test('storage failures expose a useful error without internals',async()=>{
  failures=true;const response=await request();assert.equal(response.status,503);
  assert.ok(!(await response.text()).includes('database detail'));
});
test('validation trims name and drops blank comments',()=>{
  const body=validateResponse(valid({reviewerName:' Elaine ',comments:{'38':'  ','43':' Good '}}));
  assert.equal(body.reviewerName,'Elaine');assert.deepEqual(body.comments,{'43':'Good'});
});
test('Vercel parsed-body helper preserves valid data and rejects oversized bodies',async()=>{
  const headers={'content-type':'application/json'};
  assert.deepEqual(await readBody({headers,body:valid()}),valid());
  await assert.rejects(readBody({headers,body:{text:'x'.repeat(45_000)}}),error=>error.status===413);
});
test('Vercel lazy malformed-JSON helper becomes a useful validation error',async()=>{
  const req={headers:{'content-type':'application/json'},get body(){throw new SyntaxError('malformed');}};
  await assert.rejects(readBody(req),error=>error.status===400&&error.code==='VALIDATION_ERROR');
});
