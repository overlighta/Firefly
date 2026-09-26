const assert = require('node:assert/strict');
const fs = require('node:fs');
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
    await page.locator('nav a[href="/map/"]').click();
    await page.locator('.travel-album').waitFor({timeout:45000});
    await page.waitForFunction(()=>{const image=document.querySelector('.travel-photo--hero img');return image?.complete&&image.naturalWidth>0;},null,{timeout:60000});
    const labels=await page.locator('.travel-tabs button > span').allTextContents();
    assert.equal(new Set(labels).size,labels.length,'no duplicate city labels');
    for(const width of [1440,820,390,320]) {
      await page.setViewportSize({width,height:width<500?844:1000});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow at '+width);
      await page.screenshot({path:`test-results/travel-${width}.png`,fullPage:true});
    }
    await page.locator('.travel-story').first().click();
    await page.locator('.memory-detail__back').waitFor({timeout:45000});
    // Read-only fixtures exercise places the private journal does not yet contain.
    let fixture=[
      {location:'南京',latitude:30,longitude:120},
      {location:'南京市 · 玄武湖',latitude:32.1,longitude:118.8},
      {location:'杭州',latitude:null,longitude:null},
      {location:'家里',latitude:null,longitude:null},
      {location:null,latitude:null,longitude:null},
    ].map((item,index)=>({id:`00000000-0000-4000-8000-00000000000${index}`,space_id:'fixture',created_by:null,memory_date:`2026-09-${26-index}`,created_at:'2026-09-26',updated_at:'2026-09-26',title:'地点展示检查',perspectives:[],memory_photos:[],...item}));
    await page.route('**/rest/v1/memories?*',route=>route.request().method()==='GET'?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)}):route.abort());
    await page.goto(base+'/map/');
    await page.locator('.travel-tabs button').first().waitFor({timeout:45000});
    assert.equal(await page.locator('.travel-tabs button').count(),4);
    assert.equal(await page.locator('.travel-story').count(),2);
    for(const name of ['杭州','家里','待补充地点','南京']) {
      await page.locator('.travel-tabs button').filter({has:page.getByText(name,{exact:true})}).click();
      assert.equal(await page.locator('.travel-letter h2').textContent(),name);
      await page.locator('.travel-no-photo').waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    fixture=[];
    await page.reload();
    await page.locator('.travel-empty').waitFor({timeout:45000});
    assert.equal(await page.locator('.travel-empty a').getAttribute('href'),'/');
    assert.deepEqual(errors,[]);
    console.log('PASS: live photos, unique city groups, four viewports, detail link, city switching, no-photo/custom/unlocated/empty states; no data writes');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
