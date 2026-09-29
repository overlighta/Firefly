const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('src/lib/birthday.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(`(function(require,module,exports){${source}\n})`,{Intl,Date,Error,Boolean})((name)=>{if(name==='svelte/store')return {writable:()=>({set(){}})};throw Error(name);},mod,mod.exports);
const api=mod.exports;
test('birthday auto offer requires recipient, ready letter and no receipt',()=>{
 const letter={recipient_id:'her',is_ready:true,opened_at:null};
 assert.equal(api.shouldOfferBirthday(letter,'her'),true);
 assert.equal(api.shouldOfferBirthday(letter,'him'),false);
 assert.equal(api.shouldOfferBirthday({...letter,is_ready:false},'her'),false);
 assert.equal(api.shouldOfferBirthday({...letter,opened_at:'2026-09-30'},'her'),false);
 assert.equal(api.shouldOfferBirthday(null,'her'),false);
});
test('birthday save refuses blank publication and detects concurrent edits',async()=>{
 const letter={id:'letter',updated_at:'version1'};
 await assert.rejects(api.saveBirthday(null,letter,'  ','name',true),/先写下/);
 await assert.rejects(api.saveBirthday(null,letter,'a'.repeat(20001),'name',false),/长度/);
 const filters={},writes=[];
 const builder={update(value){writes.push(value);return this;},eq(key,value){filters[key]=value;return this;},select(){return this;},async maybeSingle(){return {data:null,error:null};}};
 const client={from:()=>builder};
 await assert.rejects(api.saveBirthday(client,letter,'draft',' him ',false),/其他页面更新/);
 assert.equal(filters.updated_at,'version1');assert.equal(filters.id,'letter');
 assert.deepEqual(Object.keys(writes[0]).sort(),['body','is_ready','signature']);
 assert.equal(writes[0].signature,'him');
});
test('birthday display uses Shanghai date even when server timestamp is prior UTC date',()=>{
 const label=api.birthdayTimeLabel('2026-09-29T16:00:00Z');
 assert.ok(label.includes('2026')&&label.includes('9')&&label.includes('30'));
 assert.ok(label.includes('00:00'));
});
