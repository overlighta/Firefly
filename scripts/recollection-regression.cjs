const assert=require('node:assert/strict');
const {chromium}=require('playwright');
process.loadEnvFile('.env.local');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4330';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[];let originalRows=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',async response=>{if(response.url().includes('/rest/v1/memories?')&&response.request().method()==='GET'&&response.ok()){try{const data=await response.json();if(Array.isArray(data)&&data[0]?.perspectives?.length)originalRows=data;}catch{}}});
  await page.goto(base+'/space/login/');await page.fill('#login-email',process.env.TEST_AUTH_EMAIL);await page.fill('#login-password',process.env.TEST_AUTH_PASSWORD);await page.click('button[type=submit]');
  await page.locator('nav a[href="/memories/"]').click();await page.locator('.recollection-letter').waitFor({timeout:45000});
  assert.equal(await page.locator('.recollection-voices > section').count(),2);
  const count=await page.locator('.recollection-index__list button').count();const seen=new Set();
  for(let i=0;i<count;i++){const id=await page.locator('.recollection-letter').getAttribute('data-memory-id');assert.ok(!seen.has(id),'no repeats in a round');seen.add(id);if(i<count-1)await page.getByRole('button',{name:'再抽一封',exact:true}).click();}
  for(const width of [1440,820,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow at '+width);
   await page.screenshot({path:`test-results/recollections-${width}.png`,fullPage:true});
  }
  await page.locator('.recollection-index__list button').last().click();
  assert.equal(await page.locator('.recollection-index__list button[aria-pressed="true"]').count(),1);
  await page.locator('.recollection-letter > footer a').click();await page.locator('.memory-detail__back').waitFor({timeout:45000});
  const ids=[...new Set(originalRows.flatMap(row=>row.perspectives??[]).map(item=>item.user_id))];
  assert.ok(ids.length>=2,'live membership available for read-only fixtures');
  const row=originalRows[0];
  let fixture=[
   {...row,id:'00000000-0000-4000-8000-000000000001',title:'两封不同的心情',memory_photos:[],perspectives:[{id:'p1',user_id:ids[0],content:'记得那天的风，很温柔。',mood:'治愈'},{id:'p2',user_id:ids[1],content:'我记得你说，下次还要一起去。',mood:'想念'}]},
   {...row,id:'00000000-0000-4000-8000-000000000002',title:'还没写完',memory_photos:[],perspectives:[{id:'p3',user_id:ids[0],content:'平常的一天。',mood:'平静'}]},
  ];
  fixture=fixture.map(memory=>({...memory,perspectives:memory.perspectives.map(item=>({...item,created_at:'2026-09-26T00:00:00Z',updated_at:'2026-09-26T00:00:00Z'}))}));
  await page.route('**/rest/v1/memories?*',route=>route.request().method()==='GET'?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}):route.abort());
  await page.goto(base+'/memories/');await page.locator('.recollection-letter').waitFor({timeout:45000});
  await page.getByRole('button',{name:/两人都写过/}).click();
  assert.equal(await page.locator('.recollection-voices blockquote').count(),2);
  assert.equal(await page.getByRole('button',{name:'再抽一封',exact:true}).isDisabled(),true);
  await page.getByLabel('按当时的心情').selectOption('平静');await page.locator('.recollection-no-match').waitFor();
  await page.getByRole('button',{name:'查看所有旧信',exact:true}).click();await page.getByLabel('按当时的心情').selectOption('平静');
  assert.equal(await page.locator('.recollection-unwritten').count(),1);
  await page.getByRole('button',{name:/夹着照片的/}).click();await page.locator('.recollection-no-match').waitFor();
  fixture=[];await page.reload();await page.locator('.memory-memories-empty').waitFor({timeout:45000});
  assert.deepEqual(errors,[]);
  console.log('PASS: four viewports, both voices, draw without repeats, letter selection/detail link, mood/type intersection, missing perspective, no match and empty states; no writes');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
