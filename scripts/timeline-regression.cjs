const assert = require('node:assert/strict');
const { chromium } = require('playwright');
process.loadEnvFile('.env.local');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4330';
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/space/login/');
    await page.fill('#login-email',process.env.TEST_AUTH_EMAIL);
    await page.fill('#login-password',process.env.TEST_AUTH_PASSWORD);
    await page.click('button[type=submit]');
    await page.locator('nav a[href="/timeline/"]').waitFor();
    assert.equal(await page.locator('.chronicle-photo img').count(),0,'inactive timeline does not load photos');
    await page.locator('nav a[href="/timeline/"]').click();
    await page.locator('.chronicle-entry').first().waitFor({timeout:45000});
    await page.waitForFunction(()=>{const img=document.querySelector('.chronicle-photo img');return img?.complete&&img.naturalWidth>0;},null,{timeout:60000});
    const dates = () => page.locator('.chronicle-entry time').evaluateAll(nodes=>nodes.map(node=>node.dateTime));
    const recent = await dates();
    assert.deepEqual(recent,[...recent].sort().reverse());
    for(const photo of await page.locator('.chronicle-photo').all()) {
      await photo.scrollIntoViewIfNeeded();
      await photo.locator('img').waitFor({timeout:45000});
      await photo.locator('img').evaluate(img=>new Promise((resolve,reject)=>{
        if(img.complete) return img.naturalWidth>0?resolve():reject(new Error('photo failed'));
        img.addEventListener('load',resolve,{once:true});img.addEventListener('error',()=>reject(new Error('photo failed')),{once:true});
      }));
    }
    await page.getByLabel('翻阅顺序').selectOption({label:'从最早看'});
    assert.deepEqual(await dates(),[...recent].sort());
    await page.getByLabel('翻阅顺序').selectOption({label:'从最近看'});
    for(const width of [1440,820,390,320]) {
      await page.setViewportSize({width,height:width<500?844:1000});
      await page.evaluate(()=>scrollTo(0,0));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow at '+width);
      await page.screenshot({path:`test-results/timeline-${width}.png`,fullPage:true});
      if(width===1440) await page.screenshot({path:'test-results/timeline-preview.png'});
    }
    await page.locator('.chronicle-directory button').last().click();
    assert.ok(await page.locator('.chronicle-month').last().evaluate(node=>document.activeElement===node),'month jump moves keyboard focus');
    await page.locator('.chronicle-entry footer > a').last().click();
    await page.locator('.memory-detail__back').waitFor({timeout:45000});
    // Read-only response fixtures: deliberately unsorted, including equal dates.
    let fixture = ['2025-12-31','2026-02-02','2026-01-04','2026-02-02'].map((date,index)=>({
      id:`00000000-0000-4000-8000-00000000000${index}`,space_id:'fixture',created_by:null,
      memory_date:date,created_at:`2026-09-2${index}T00:00:00Z`,updated_at:'2026-09-26T00:00:00Z',
      title:index===0?null:'很长的一段生活记录'.repeat(8),location:'南京 · 一起去过的街角',
      note:index===0?null:'当天写下的内容。'.repeat(18),perspectives:[],memory_photos:[],
    }));
    await page.route('**/rest/v1/memories?*',route=>route.request().method()==='GET'?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}):route.abort());
    await page.goto(base+'/timeline/');
    await page.locator('.chronicle-entry').first().waitFor({timeout:45000});
    assert.deepEqual(await dates(),['2026-02-02','2026-02-02','2026-01-04','2025-12-31']);
    assert.equal(await page.locator('.chronicle-directory__year').count(),2);
    assert.equal(await page.locator('.chronicle-month').count(),3);
    assert.equal(await page.locator('.chronicle-photo').count(),0);
    assert.equal(await page.locator('.chronicle-excerpt--empty').count(),1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long text wraps on narrow mobile');
    await page.getByLabel('翻阅顺序').selectOption({label:'从最早看'});
    assert.deepEqual(await dates(),['2025-12-31','2026-01-04','2026-02-02','2026-02-02']);
    await page.locator('.chronicle-directory button').last().click();
    assert.ok(await page.locator('.chronicle-month').last().evaluate(node=>document.activeElement===node));
    fixture=[];await page.reload();
    await page.locator('.memory-timeline-empty').waitFor({timeout:45000});
    assert.equal(await page.locator('.memory-timeline-empty a').getAttribute('href'),'/');
    assert.deepEqual(errors,[]);
    console.log('PASS: live photo, four widths, both date orders, month jump/focus, detail navigation, unsorted multiple-year fixture, text-only, long text and empty states; no data writes');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
