import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const url=new URL(process.env.PUBLIC_SUPABASE_URL).origin;
const config={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,process.env.SUPABASE_SECRET_KEY,config);
const sender=createClient(url,process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,config);
const recipient=createClient(url,process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,config);
const anon=createClient(url,process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,config);
const ids=[randomUUID(),randomUUID()];
let inserted=false;
try {
 const s=await sender.auth.signInWithPassword({email:process.env.TEST_AUTH_EMAIL,password:process.env.TEST_AUTH_PASSWORD});
 const r=await recipient.auth.signInWithPassword({email:process.env.TEST_PARTNER_EMAIL,password:process.env.TEST_PARTNER_PASSWORD});
 assert.ok(!s.error&&!r.error,'Both existing users sign in');
 const actual=await sender.from('birthday_letters').select('*').eq('occasion_key','birthday-2026-09-30').single();
 assert.ok(!actual.error,'Birthday migration installed');
 assert.equal(actual.data.sender_id,s.data.user.id);assert.equal(actual.data.recipient_id,r.data.user.id);
 assert.equal(new Date(actual.data.opens_at).toISOString(),'2026-09-29T16:00:00.000Z');
 const stamp=Date.now();
 const rows=ids.map((id,i)=>({id,space_id:actual.data.space_id,occasion_key:'audit-'+id,sender_id:s.data.user.id,recipient_id:r.data.user.id,recipient_name:'权限检查',opens_at:new Date(stamp+(i===0?86400000:-86400000)).toISOString(),body:'临时权限测试，不是生日信',signature:'audit',is_ready:true}));
 const insert=await admin.from('birthday_letters').insert(rows);assert.ok(!insert.error,'Create isolated audit rows');inserted=true;
 let result=await recipient.from('birthday_letters').select('id').in('id',ids);
 assert.deepEqual(result.data?.map(row=>row.id),[ids[1]],'Server clock hides a ready future letter');
 result=await anon.from('birthday_letters').select('id').in('id',ids);assert.ok(result.error,'Anonymous cannot read');
 result=await recipient.from('birthday_letters').update({body:'not allowed'}).eq('id',ids[1]).select('id');assert.ok(result.error||!result.data?.length,'Recipient cannot edit body');
 result=await sender.from('birthday_letters').update({opened_at:new Date().toISOString()}).eq('id',ids[1]);assert.ok(result.error,'Sender cannot consume recipient opening');
 result=await sender.rpc('open_birthday_letter',{letter_id:ids[1]});assert.ok(result.error,'Sender cannot acknowledge as recipient');
 result=await recipient.rpc('open_birthday_letter',{letter_id:ids[0]});assert.ok(result.error,'Future letter cannot be opened with RPC');
 result=await recipient.rpc('open_birthday_letter',{letter_id:ids[1]});assert.ok(!result.error&&result.data,'Due recipient can acknowledge');const first=result.data;
 result=await recipient.rpc('open_birthday_letter',{letter_id:ids[1]});assert.equal(result.data,first,'Opening is idempotent');
 result=await sender.from('birthday_letters').update({body:'saved audit',signature:'sender',is_ready:false}).eq('id',ids[1]).select('id');assert.equal(result.data?.length,1,'Sender may save and unpublish');
 result=await recipient.from('birthday_letters').select('id').eq('id',ids[1]);assert.equal(result.data?.length,0,'Unpublished letter becomes private');
 console.log('PASS: actual birthday configuration, server-time embargo, anonymous denial, sender-only edit, protected receipt and idempotent opening; production letter untouched');
} finally {
 if(inserted){const cleanup=await admin.from('birthday_letters').delete().in('id',ids);assert.ok(!cleanup.error,'Remove only isolated audit rows');console.log('Temporary permission test rows removed');}
 await Promise.all([sender.auth.signOut({scope:'local'}),recipient.auth.signOut({scope:'local'})]);
}
