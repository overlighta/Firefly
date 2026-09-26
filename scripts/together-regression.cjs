const assert = require('node:assert/strict');
const {chromium} = require('playwright');
process.loadEnvFile('.env.local');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4330';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  const errors=[];let currentId='',originalRows=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{
   try {
    if(response.url().includes('/auth/v1/token')&&response.ok()) currentId=(await response.json()).user?.id || currentId;
    if(response.url().includes('/rest/v1/memories?')&&response.request().method()==='GET'&&response.ok()) {const rows=await response.json();if(Array.isArray(rows)&&rows.length)originalRows=rows;}
   }catch{}
  });
  await page.goto(base+'/space/login/');await page.fill('#login-email',process.env.TEST_AUTH_EMAIL);await page.fill('#login-password',process.env.TEST_AUTH_PASSWORD);await page.click('button[type=submit]');
  await page.locator('nav a[href="/space/"]').click();await page.locator('.together-cover').waitFor({timeout:45000});
  assert.equal(await page.locator('.together img').count(),0,'no photo decoration or downloads');
  assert.equal(await page.locator('.together-signatures > div').count(),2);
  for(const button of await page.locator('.together-author-switch button').all()){
   await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');await page.locator('.together-quote blockquote').waitFor();
  }
  for(const width of [1440,820,390,320]) {
   await page.setViewportSize({width,height:width<500?844:1100});await page.evaluate(()=>scrollTo(0,0));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);
   await page.screenshot({path:`test-results/together-${width}.png`,fullPage:true});
   if(width===1440)await page.screenshot({path:'test-results/together-preview.png'});
  }
  const options=await page.locator('#together-month option').evaluateAll(nodes=>nodes.map(n=>n.value));
  for(const option of options){await page.locator('#together-month').selectOption(option);await page.locator('.together-days .has-entry').first().click();assert.equal(await page.locator('.together-days [aria-pressed=true]').count(),1);assert.ok(await page.locator('.together-day-stories > a').count()>0);}
  await page.locator('.together-day-stories > a').first().click();await page.locator('.memory-detail__back').waitFor({timeout:45000});
  const partnerId=originalRows.flatMap(row=>row.perspectives || []).map(p=>p.user_id).find(id=>id!==currentId);
  assert.ok(currentId&&partnerId,'actual member IDs available for read-only fixtures');
  let fixture=[
   ['2024-02-29',[[partnerId,'对方的一句话']]],
   ['2024-02-29',[[currentId,'我的一句话'],[partnerId,'另一个视角']]],
   ['2025-01-01',[]],
   ['2025-01-02',[[currentId,'我先记下这一天']]],
  ].map(([date,voices],index)=>({id:`00000000-0000-4000-8000-00000000000${index}`,memory_date:date,space_id:'fixture',created_by:null,created_at:'2026-09-26T00:00:00Z',updated_at:'2026-09-26T00:00:00Z',title:'生活记录与很长的标题'.repeat(12),memory_photos:[],perspectives:voices.map(([id,content],j)=>({id:`voice-${index}-${j}`,user_id:id,content,mood:null,created_at:'2026-09-26T00:00:00Z',updated_at:'2026-09-26T00:00:00Z'}))}));
  await page.route('**/rest/v1/memories?*',route=>route.request().method()==='GET'?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}):route.abort());
  await page.goto(base+'/space/');await page.locator('.together-cover').waitFor({timeout:45000});
  assert.equal((await page.locator('.together-colophon p strong').textContent()).trim(),'3');
  assert.equal((await page.locator('.together-ribbon > span strong').nth(1).textContent()).trim(),'1');
  assert.equal(await page.locator('.together-unfinished__list > a').count(),1);
  assert.ok((await page.locator('.together-unfinished__list > a').getAttribute('href')).endsWith('000000000000/'));
  await page.locator('#together-month').selectOption('2024-02');
  assert.equal(await page.locator('.together-days > button').count(),29);
  assert.equal(await page.locator('.together-day-stories > a').count(),2);
  assert.equal(await page.locator('.together-days .has-entry .is-written').count(),2);
  await page.locator('#together-month').selectOption('2025-01');
  await page.locator('.together-days button').filter({hasText:/^1$/}).click();
  assert.equal(await page.locator('.together-days [aria-pressed=true] .is-written').count(),0,'record without writing has no author dots');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fixture=[];await page.reload();await page.locator('.together-calendar-empty').waitFor({timeout:45000});
  assert.equal((await page.locator('.together-colophon p strong').textContent()).trim(),'0');
  await page.locator('.together-quote__empty').waitFor();
  assert.equal(await page.locator('.together-new-page').getAttribute('href'),'/');
  assert.deepEqual(errors,[]);
  console.log('PASS: no images, four widths, member switching, month/day selection, detail links, unique dates, shared writing, current-user pending entries, leap month, long titles, no-writing days and empty state; no data writes');
 } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
