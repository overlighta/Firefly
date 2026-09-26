import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const makeClient=()=>createClient(process.env.PUBLIC_SUPABASE_URL,process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const owner=makeClient(),partner=makeClient(),anonymous=makeClient();
const ids=[randomUUID(),randomUUID()];
const check=(label)=>console.log(`[MEMORY-AUDIT] ${label}: pass`);
try {
  const [a,b]=await Promise.all([
    owner.auth.signInWithPassword({email:process.env.TEST_AUTH_EMAIL,password:process.env.TEST_AUTH_PASSWORD}),
    partner.auth.signInWithPassword({email:process.env.TEST_PARTNER_EMAIL,password:process.env.TEST_PARTNER_PASSWORD}),
  ]);
  assert.ifError(a.error);assert.ifError(b.error);
  const membership=await owner.from('space_members').select('space_id').eq('user_id',a.data.user.id).single();assert.ifError(membership.error);
  const args={p_id:ids[0],p_space_id:membership.data.space_id,p_date:'2026-09-26',p_title:'Temporary atomic creation audit',p_location:null,p_content:'Temporary validation record; automatically removed.'};
  const created=await owner.rpc('create_memory_with_perspective',args);assert.ifError(created.error);
  assert.equal(created.data.id,ids[0]);assert.equal(created.data.perspectives.length,1);check('atomic memory and perspective creation');
  const again=await owner.rpc('create_memory_with_perspective',args);assert.ifError(again.error);assert.equal(again.data.id,ids[0]);
  const perspectives=await owner.from('perspectives').select('id').eq('memory_id',ids[0]);assert.ifError(perspectives.error);assert.equal(perspectives.data.length,1);check('retry is idempotent');
  const bad=await owner.rpc('create_memory_with_perspective',{...args,p_id:ids[1],p_content:'  '});assert.ok(bad.error);
  const absent=await owner.from('memories').select('id').eq('id',ids[1]);assert.ifError(absent.error);assert.equal(absent.data.length,0);check('invalid creation leaves no partial row');
  const visible=await partner.from('memories').select('id').eq('id',ids[0]);assert.ifError(visible.error);assert.equal(visible.data.length,1);
  const shared=await partner.from('perspectives').insert({memory_id:ids[0],user_id:b.data.user.id,content:'Temporary partner perspective'});assert.ifError(shared.error);check('partner reads and adds own perspective');
  const forbidden=await partner.from('memories').delete().eq('id',ids[0]).select('id');assert.ok(forbidden.error||forbidden.data.length===0);check('partner cannot delete creator record');
  const hidden=await anonymous.from('memories').select('id').eq('id',ids[0]);assert.ok(hidden.error||hidden.data.length===0);check('anonymous read blocked');
} finally {
  const cleanup=await owner.from('memories').delete().in('id',ids);
  assert.ifError(cleanup.error);
  const remaining=await owner.from('memories').select('id').in('id',ids);
  assert.ifError(remaining.error);assert.equal(remaining.data.length,0);check('temporary records cleaned');
  await Promise.all([owner.auth.signOut({scope:'local'}),partner.auth.signOut({scope:'local'})]);
}
