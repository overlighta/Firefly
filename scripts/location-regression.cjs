const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium}=require('playwright');
process.loadEnvFile('.env.local');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4330';
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const report=[];
 try {
  for(const width of [320,390,820,1440]) {
   const context=await browser.newContext({viewport:{width,height:width<500?740:1000},reducedMotion:'reduce'});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/space/login/');await page.fill('#login-email',process.env.TEST_AUTH_EMAIL);await page.fill('input[type=password]',process.env.TEST_AUTH_PASSWORD);await page.click('button[type=submit]');
   await page.locator('.journal-collection').waitFor({timeout:45000});
   // Location checks do not wait for full-size photo downloads; app-regression covers the lightbox.
   const layout=await page.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();const gallery=rect('.memory-gallery');const footer=rect('.memory-today__footer');return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,galleryBottom:gallery.bottom,footerTop:footer.top};});
   assert.ok(layout.scroll<=width,'no page overflow');assert.ok(layout.galleryBottom<=layout.footerTop,'gallery does not overlap footer');
   await page.screenshot({path:`test-results/journal-home-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'记录今天',exact:true}).click();
   let dialog=page.locator('dialog[open]');
   await dialog.getByLabel('城市或地点，可选').fill('hangzhou');
   await dialog.getByRole('button',{name:'杭州',exact:true}).click();
   await dialog.getByLabel('具体地点，可选').fill('西湖');
   assert.equal(await dialog.getByLabel('城市或地点，可选').inputValue(),'杭州 · 西湖');
   let createPayload;
   await page.route('**/rest/v1/rpc/create_memory_with_perspective',async route=>{createPayload=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message:'Browser verification: write intentionally intercepted'})});});
   await dialog.getByLabel('今天发生了什么？').fill('Browser verification - intercepted, never saved');
   await dialog.getByRole('button',{name:'保存这段记忆',exact:true}).click();
   await dialog.locator('.memory-dialog__error').waitFor();
   assert.equal(createPayload.p_location,'杭州 · 西湖');

   await dialog.getByRole('button',{name:'取消',exact:true}).click();
   await page.locator('[data-view="home"] a[href^="/memory/"]').first().click();
   await page.getByRole('button',{name:'编辑记录',exact:true}).click();dialog=page.locator('dialog[open]');
   assert.equal(await dialog.getByText('纬度，可选',{exact:true}).count(),0);
   await dialog.getByLabel('城市或地点，可选').fill('南京');await dialog.getByRole('button',{name:'南京',exact:true}).click();
   await dialog.getByLabel('具体地点，可选').fill('玄武湖');
   await dialog.screenshot({path:`test-results/journal-edit-${width}.png`});
   const payloads=[];
   await page.route('**/rest/v1/memories?*',async route=>{if(route.request().method()==='PATCH'){payloads.push(route.request().postDataJSON());await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message:'Browser verification: write intentionally intercepted'})});}else await route.continue();});
   await dialog.getByRole('button',{name:'保存修改',exact:true}).click();
   await dialog.locator('.memory-dialog__error').waitFor();
   assert.equal(payloads[0].location,'南京 · 玄武湖');assert.ok(payloads[0].latitude>31&&payloads[0].latitude<33);assert.ok(payloads[0].longitude>118&&payloads[0].longitude<120);
   await dialog.getByLabel('城市或地点，可选').fill('家里');
   await dialog.getByRole('button',{name:'保存修改',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('dialog[open] button[type=submit]').disabled);
   assert.equal(payloads[1].latitude,null);assert.equal(payloads[1].longitude,null);
   await dialog.getByRole('button',{name:'取消',exact:true}).click();
   for(const view of ['timeline','memories','map','space']){
    await page.locator(`nav a[href="/${view}/"]`).click();await page.locator(`[data-view="${view}"]`).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow in '+view);
    if(width===390||width===1440)await page.screenshot({path:`test-results/journal-${view}-${width}.png`,fullPage:true});
   }
   assert.deepEqual(errors,[]);report.push({width,layout:'pass',citySelection:'pass',landmarkLabel:'pass',coordinateClearing:'pass',writes:'intercepted',errors});
   await context.close();
  }
 } finally {await browser.close();}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
