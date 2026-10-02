import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { createReviewStore } from './card-review-store.mjs';

const connectionString=process.env.CARD_REVIEW_TEST_DATABASE_URL;
if(!connectionString || new URL(connectionString).pathname !== '/trades_hall_card_review_test_20261002') throw new Error('Explicit isolated CARD_REVIEW_TEST_DATABASE_URL is required. Production is never a test target.');
const sql=neon(connectionString);
const query=(text,values=[])=>sql(text,values);
const store=createReviewStore(query);
const hash=()=>randomBytes(32).toString('hex');
const hashes=[];
const key=()=>{const value=hash();hashes.push(value);return value;};
const data=(extra={})=>({reviewerName:'Integration fixture',favourite:'38',comments:{'43':'Reverse comment'},generalComment:'Private test only',revision:0,...extra});
before(async()=>{const rows=await query('SELECT current_database() AS name');assert.equal(rows[0].name,'trades_hall_card_review_test_20261002');});
after(async()=>{await query('DELETE FROM card_review.responses WHERE session_hash = ANY($1::text[])',[hashes]);await query('DELETE FROM card_review.rate_limits WHERE key = ANY($1::text[])',[hashes]);});
test('real database persists and reopens exact comments',async()=>{
  const session=key();const saved=await store.saveResponse(session,data());
  assert.equal(saved.revision,1);assert.deepEqual((await store.getResponse(session)).comments,{'43':'Reverse comment'});
  assert.equal(await store.getResponse(key()),null);
});
test('real database persists Nocturne and Nocturne 2 choices and comments',async()=>{
  const session=key();const saved=await store.saveResponse(session,data({favourite:'nocturne',comments:{'nocturne-2':'Keep the illuminated windows.'}}));
  assert.equal(saved.favourite,'nocturne');
  assert.deepEqual((await store.getResponse(session)).comments,{'nocturne-2':'Keep the illuminated windows.'});
});
test('concurrent first submissions create exactly one response',async()=>{
  const session=key();const results=await Promise.all(Array.from({length:8},()=>store.saveResponse(session,data())));
  assert.equal(results.filter(Boolean).length,1);
  const rows=await query('SELECT count(*)::int AS count FROM card_review.responses WHERE session_hash=$1',[session]);assert.equal(rows[0].count,1);
});
test('concurrent edits admit one expected revision and reject stale writes',async()=>{
  const session=key();await store.saveResponse(session,data());
  const results=await Promise.all(['43','46','05'].map(favourite=>store.saveResponse(session,data({favourite,revision:1}))));
  assert.equal(results.filter(Boolean).length,1);assert.equal((await store.getResponse(session)).revision,2);
  assert.equal(await store.saveResponse(session,data({revision:1})),null);
  assert.equal(await store.saveResponse(key(),data({revision:1})),null);
});
test('concurrent durable rate counting admits exactly the configured limit',async()=>{
  const rateKey=key();const results=await Promise.all(Array.from({length:12},()=>store.takeRateLimit(rateKey,5)));
  assert.equal(results.filter(Boolean).length,5);
  const rows=await query('SELECT count FROM card_review.rate_limits WHERE key=$1',[rateKey]);assert.equal(rows[0].count,12);
});
test('database rejects malformed known-design values and hashes',async()=>{
  await assert.rejects(store.saveResponse(key(),data({favourite:'not-a-design'})));
  await assert.rejects(store.saveResponse('invalid-hash',data()));
});
