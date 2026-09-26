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
  return {together:load('@/lib/memory/together'),recollections:load('@/lib/memory/recollections'),footprints:load('@/lib/memory/footprints'),locations:load('@/lib/memory/locations'),mapper:load('@/lib/memory/mapper'),cache:load('@/lib/memory/cache'),api:load('@/lib/memory/real-memory'),auth,change:()=>invalidation.notifySpaceChanged('space'),advance:ms=>time+=ms};
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


test('city locations resolve exact names and explicit city-place labels without guessing landmarks',()=>{
  const {locations}=setup();
  const city=locations.findCity('南京市');
  assert.equal(city.name,'南京');
  assert.ok(city.latitude>31 && city.latitude<33 && city.longitude>118 && city.longitude<120);
  assert.equal(locations.findCity(' Nanjing · 玄武湖 ').name,'南京');
  assert.equal(locations.findCity('南京路'),null);
  assert.equal(locations.findCity('家里'),null);
  assert.equal(locations.findCity(''),null);
  assert.equal(locations.searchCities('xian')[0].name,'西安');
});

test('city records appear on the map while existing explicit locations retain their coordinates',()=>{
  const {mapper}=setup();
  const city=mapper.mapMemory({...row('city'),location:'南京 · 玄武湖',latitude:null,longitude:null});
  assert.ok(city.coordinates.latitude>31 && city.coordinates.longitude>118);
  const precise=mapper.mapMemory({...row('exact'),location:'南京',latitude:32.09,longitude:118.8});
  assert.equal(precise.coordinates.latitude,32.09);
  assert.equal(precise.coordinates.longitude,118.8);
  assert.equal(mapper.mapMemory({...row('home'),location:'家里'}).coordinates,null);
});


test('travel album merges city aliases and landmarks without overwriting stored coordinates',()=>{
 const {footprints,mapper}=setup();
 const first=mapper.mapMemory({...row('one'),location:'南京',latitude:30,longitude:120});
 const second=mapper.mapMemory({...row('two'),location:'南京市 · 玄武湖',latitude:32.1,longitude:118.8});
 const third=mapper.mapMemory({...row('three'),location:'Nanjing',latitude:null,longitude:null});
 const groups=footprints.buildFootprints([first,second,third]);
 assert.equal(groups.length,1);assert.equal(groups[0].memories.length,3);assert.equal(groups[0].location,'南京');
 assert.equal(first.coordinates.latitude,30);assert.ok(groups[0].coordinates.latitude>32);assert.equal(groups[0].x,50);assert.equal(groups[0].y,50);
});

test('travel album keeps custom and missing places readable and places pins on the shared axis center',()=>{
 const {footprints,mapper}=setup();
 const memories=[mapper.mapMemory({...row('a'),location:'家里'}),mapper.mapMemory({...row('b'),location:null}),mapper.mapMemory({...row('c'),location:'地方一',latitude:30,longitude:120}),mapper.mapMemory({...row('d'),location:'地方二',latitude:32,longitude:120})];
 const groups=footprints.buildFootprints(memories);
 assert.equal(groups.length,4);assert.equal(groups.at(-1).pending,true);assert.equal(groups.find(g=>g.location==='家里').coordinates,null);
 for(const group of groups.filter(g=>g.coordinates)){assert.equal(group.x,50);assert.ok(Number.isFinite(group.y));}
 assert.equal(footprints.buildFootprints([]).length,0);
});


test('old-letter filters use saved moods, distinct authors and actual photos',()=>{
 const {recollections:r,mapper}=setup();
 const memory=mapper.mapMemory({...row('one'),perspectives:[{user_id:'a',mood:' 开心 ',content:'A'},{user_id:'b',mood:'开心',content:'B'}],memory_photos:[{id:'photo'}]});
 assert.equal(r.memoryMoods(memory).length,1);
 assert.equal(r.filterRecollections([memory],'both','开心').length,1);
 assert.equal(r.filterRecollections([memory],'photos','开心').length,1);
 assert.equal(r.filterRecollections([memory],'all','想念').length,0);
 const duplicate={...memory,perspectives:memory.perspectives.map(p=>({...p,userId:'a'}))};
 assert.equal(r.filterRecollections([duplicate],'both','').length,0);
});

test('draw letters without repeats until a complete round, and avoid repeating across rounds',()=>{
 const {recollections:r}=setup();const items=[{id:'a'},{id:'b'},{id:'c'}];let current=null,seen=[];const ids=[];
 for(let i=0;i<3;i++){const next=r.drawRecollection(items,current,seen,()=>0);current=next.id;seen=next.seen;ids.push(current);}
 assert.equal(new Set(ids).size,3);
 const next=r.drawRecollection(items,current,seen,()=>0);assert.notEqual(next.id,current);assert.equal(next.seen.length,1);
 assert.equal(r.drawRecollection([],null,[]).id,null);
 assert.equal(r.drawRecollection([{id:'a'}],'a',['a']).id,'a');
 assert.equal(r.drawRecollection([{id:'b'}],'a',['a']).id,'b');
});

test('together overview counts distinct dates and only genuine writing by current members',()=>{
 const {together:t}=setup();
 const memory=(id,date,perspectives)=>({id,date,createdAt:date,perspectives:perspectives.map(([userId,content])=>({userId,content}))});
 const items=[memory('a','2024-02-29',[['me','我的'],['partner','你的']]),memory('b','2024-02-29',[['partner','另一条'],['me','  ']]),memory('c','2025-01-02',[['outsider','不属于成员']]),memory('d','2025-01-01',[['me','仅自己']])];
 const summary=t.togetherSummary(items,['me','partner'],'me');
 assert.equal(summary.days.length,3);
 assert.equal(summary.shared.length,1);
 assert.equal(summary.waiting.length,1);assert.equal(summary.waiting[0].id,'b');
 assert.equal(summary.first.date,'2024-02-29');
 assert.equal(t.togetherSummary(items,['me','partner'],'partner').waiting[0].id,'d');
 assert.equal(t.togetherSummary(items,['me'],'me').shared.length,0);
 assert.equal(t.togetherSummary(items,['me','partner'],'unknown').waiting.length,0);
 assert.equal(t.togetherSummary([],['me','partner'],'me').first,null);
 assert.equal(items[0].id,'a','sorting never mutates shared cached records');
});

test('shared calendar is Monday-first and supports leap days and year boundaries',()=>{
 const {together:t}=setup();
 const leap=t.monthDays('2024-02');
 assert.equal(leap.filter(Boolean).length,29);assert.equal(leap[3],'2024-02-01');assert.equal(leap.at(-1),'2024-02-29');
 assert.equal(t.monthDays('2025-02').filter(Boolean).length,28);
 assert.equal(t.monthDays('2024-12').filter(Boolean).length,31);
 assert.equal(t.monthDays('2026-00').length,0);assert.equal(t.monthDays('').length,0);
});
