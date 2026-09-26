const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

function store(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    subscribe(fn) { listeners.add(fn); fn(value); return () => listeners.delete(fn); },
    set(next) { value = next; for (const fn of listeners) fn(value); },
    update(fn) { this.set(fn(value)); },
  };
}
function setup() {
  let time = Date.now();
  const versions = store({version: 0, spaceId: 'space'});
  const auth = store({status:'authenticated',user:{id:'user'},space:{id:'space'}});
  const modules = new Map();
  const invalidation = {spaceDataVersion: versions, notifySpaceChanged(spaceId) { versions.update(s => ({version:s.version+1,spaceId})); }};
  const stubs = {
    'svelte/store': {get(s) { let value; s.subscribe(v => value=v)(); return value; }},
    '@/lib/auth/state': {authState:auth},
    '@/lib/auth/debug': {getErrorCode:e=>e?.code},
    '@/lib/realtime/invalidation': invalidation,
  };
  function load(name) {
    if(stubs[name]) return stubs[name];
    if(modules.has(name)) return modules.get(name);
    const filename = path.resolve('src',name.slice(2)+'.ts');
    const code = fs.readFileSync(filename,'utf8').replaceAll('import.meta.env.DEV','false');
    const compiled = ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module = {exports:{}};
    const Clock = class extends Date {static now(){return time;}};
    const run = vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`,{Date:Clock,DOMException,console,window:{},crypto:{randomUUID},setTimeout,clearTimeout});
    run(load,module,module.exports);
    modules.set(name,module.exports);
    return module.exports;
  }
  return {cache:load('@/lib/memory/cache'),api:load('@/lib/memory/real-memory'),auth,change:()=>invalidation.notifySpaceChanged('space'),advance:ms=>time+=ms};
}
function deferred() { let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}; }
function client(execute, storage = {}) {
  return {
    rpc:async()=>({error:{code:'PGRST202'}}),
    storage:{from:()=>storage},
    from(table) {
      const state={table,action:'select',filters:{}};
      const builder=new Proxy({}, {get(_,key) {
        if(key === 'then') return (resolve,reject)=>Promise.resolve().then(()=>execute(state)).then(resolve,reject);
        return (...args)=>{
          if(['insert','upsert','delete','update'].includes(key)) {state.action=key;state.values=args[0];}
          if(key === 'eq') state.filters[args[0]]=args[1];
          if(key === 'range') state.range=args;
          return builder;
        };
      }});
      return builder;
    },
  };
}
const ok = data => ({data,error:null});
const row = id => ({id,space_id:'space',created_by:'user',memory_date:'2026-09-26',created_at:'2026-09-26',updated_at:'2026-09-26',title:'Day',perspectives:[],memory_photos:[]});

test('concurrent reads share one request; an update during that request forces a fresh read',async()=>{
  const {cache,change}=setup();const pending=deferred();let reads=0;
  const loader=()=>++reads === 1 ? pending.promise : Promise.resolve('new');
  const a=cache.loadMemoryQuery('space:timeline',loader);
  const b=cache.loadMemoryQuery('space:timeline',loader);
  assert.equal(a,b);change();pending.resolve('old');
  assert.equal(await a,'new');assert.equal(reads,2);
  assert.equal(await cache.loadMemoryQuery('space:timeline',loader),'new');assert.equal(reads,2);
});
test('expired results await the replacement instead of returning an invisible stale snapshot',async()=>{
  const {cache,advance}=setup();await cache.loadMemoryQuery('x',async()=>1);
  advance(61_000);const pending=deferred();let completed=false;
  const next=cache.loadMemoryQuery('x',()=>pending.promise).then(v=>{completed=true;return v;});
  await Promise.resolve();assert.equal(completed,false);pending.resolve(2);assert.equal(await next,2);
});
test('logout and account changes fence late data and photo URL writes',async()=>{
  const {cache,auth}=setup();const pending=deferred();const epoch=cache.currentCacheEpoch();
  const old=cache.loadMemoryQuery('x',()=>pending.promise);
  auth.set({status:'unauthenticated'});pending.resolve('private');
  await assert.rejects(old,{name:'AbortError'});
  cache.setCachedSignedUrls([['photo','private-url']],epoch);
  assert.equal(cache.getCachedSignedUrls(['photo']).urls.size,0);
  assert.equal(await cache.loadMemoryQuery('x',async()=>'other-account'),'other-account');
});
test('failed requests are removed so retry can succeed',async()=>{
  const {cache}=setup();await assert.rejects(cache.loadMemoryQuery('x',async()=>{throw Error('offline');}),/offline/);
  assert.equal(await cache.loadMemoryQuery('x',async()=>'online'),'online');
});
test('all pages of history are read beyond the former 200/300-record limits',async()=>{
  const {api}=setup();const rows=Array.from({length:451},(_,i)=>row(String(i)));const ranges=[];
  const db=client(s=>{ranges.push(s.range);return ok(rows.slice(s.range[0],s.range[1]+1));});
  const result=await api.loadSpaceTimelineMemories(db,'space');
  assert.equal(result.memories.length,451);assert.equal(result.memories[450].id,'450');
  assert.deepEqual(ranges.map(r=>Array.from(r)),[[0,199],[200,399],[400,599]]);
});
test('photo removal can be retried when storage succeeded but metadata deletion failed',async()=>{
  const {api}=setup();let stored=true,metadata=true,deletes=0;
  const storagePath='space/memory/user/photo.webp';
  const db=client(s=>{
    if(s.action==='select') return ok(metadata?{id:'photo',uploaded_by:'user',storage_path:storagePath}:null);
    if(++deletes===1) return {error:Error('temporary metadata failure')};
    metadata=false;return ok(null);
  },{remove:async()=>{const data=stored?[{name:storagePath}]:[];stored=false;return ok(data);},list:async()=>ok([])});
  const input={id:'photo',storagePath,userId:'user'};
  await assert.rejects(api.deleteOwnMemoryPhoto(db,input),/metadata failure/);
  assert.equal(stored,false);assert.equal(metadata,true);
  await api.deleteOwnMemoryPhoto(db,input);assert.equal(metadata,false);
  await api.deleteOwnMemoryPhoto(db,input);assert.equal(deletes,2);
});
test('empty storage removal cannot delete metadata when the object still exists',async()=>{
  const {api}=setup();let deleted=false;const storagePath='space/memory/user/photo.webp';
  const db=client(s=>{if(s.action==='delete') deleted=true;return ok({id:'photo',storage_path:storagePath});},{remove:async()=>ok([]),list:async()=>ok([{name:'photo.webp'}])});
  await assert.rejects(api.deleteOwnMemoryPhoto(db,{id:'photo',storagePath,userId:'user'}),{name:'PhotoPipelineError'});
  assert.equal(deleted,false);
});
test('a lost create response is recovered using the same request ID without a second memory',async()=>{
  const {api}=setup();let memory=null,perspective=null,inserts=0,attempts=0;
  const db=client(s=>{
    if(s.table==='memories') {
      if(s.action==='insert') {inserts++;memory={...row(s.values.id),...s.values};}
      if(s.action==='delete') memory=null;
      return ok(memory);
    }
    if(s.action==='upsert') {
      perspective={id:'perspective',...s.values};
      if(++attempts===1) return {error:Error('response lost')};
    }
    return ok(perspective);
  });
  const input={requestId:'stable',userId:'user',spaceId:'space',date:'2026-09-26',text:'A moment',title:null,location:null};
  await assert.rejects(api.createMemoryWithPerspective(db,input),/response lost/);
  const recovered=await api.createMemoryWithPerspective(db,input);
  assert.equal(recovered.id,'stable');assert.equal(inserts,1);assert.equal(recovered.perspectives[0].content,'A moment');
});
test('a proven failed perspective write compensates the incomplete memory',async()=>{
  const {api}=setup();let memory=null;
  const db=client(s=>{
    if(s.table==='memories') {
      if(s.action==='insert') memory={...row(s.values.id),...s.values};
      if(s.action==='delete') memory=null;
      return ok(memory);
    }
    return s.action==='upsert'?{error:Error('write rejected')}:ok(null);
  });
  await assert.rejects(api.createMemoryWithPerspective(db,{requestId:'stable',userId:'user',spaceId:'space',date:'2026-09-26',text:'A moment',title:null,location:null}),/write rejected/);
  assert.equal(memory,null);
});
test('deleting a memory also cleans photos added since its detail was opened',async()=>{
  const {api}=setup();let removed=[];
  const db=client(s=>s.table==='memory_photos'?ok([{storage_path:'space/m/user/new.webp'}]):ok([{id:'m'}]),{
    remove:async paths=>{removed=Array.from(paths);return ok(paths.map(name=>({name})));},
  });
  const result=await api.deleteMemory(db,{memoryId:'m',spaceId:'space',photoPaths:['space/m/user/old.webp']});
  assert.equal(result.deleted,true);assert.equal(result.cleanupFailedPaths,0);
  assert.deepEqual(removed.sort(),['space/m/user/new.webp','space/m/user/old.webp']);
});
