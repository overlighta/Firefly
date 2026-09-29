const assert=require('node:assert/strict');
const {chromium}=require('playwright');
process.loadEnvFile('.env.local');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4330';
async function login(page,partner=false,next='/birthday/'){
 await page.goto(base+'/space/login/?next='+encodeURIComponent(next));
 await page.fill('#login-email',partner?process.env.TEST_PARTNER_EMAIL:process.env.TEST_AUTH_EMAIL);
 await page.fill('#login-password',partner?process.env.TEST_PARTNER_PASSWORD:process.env.TEST_AUTH_PASSWORD);
 await page.click('button[type=submit]');
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:process.env.TEST_MOTION==='normal'?'no-preference':'reduce'});
  const errors=[];let source=null,receipts=0,writes=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',async response=>{if(response.url().includes('/rest/v1/birthday_letters?')&&response.request().method()==='GET'&&response.ok())try{const result=await response.json();source=Array.isArray(result)?result[0]??source:result??source;}catch{}});
  await login(page);await page.locator('.birthday-editor').waitFor({timeout:45000});
  await page.getByRole('button',{name:'预览惊喜',exact:true}).click();
  await page.locator('.birthday-dialog[open]').waitFor();
  await page.getByRole('button',{name:'拆开这份生日心意',exact:true}).click();
  await page.getByRole('button',{name:'愿望藏好了，打开信 →',exact:true}).click();
  await page.locator('.birthday-letter').waitFor();
  await page.getByRole('button',{name:'退出预览',exact:false}).click();
  assert.ok(source?.id,'Author seed loaded without publishing');
  let fixture={...source,body:'这是一段仅用于检查排版的测试文字。\n\n第二段仍然保持分段。',signature:'测试署名',is_ready:false,opened_at:null};
  await page.route('**/rest/v1/birthday_letters?*',async route=>{
   if(route.request().method()==='PATCH'){writes++;fixture={...fixture,...route.request().postDataJSON(),updated_at:new Date(Date.now()+writes*1000).toISOString()};}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([fixture])});
  });
  await page.route('**/rest/v1/rpc/open_birthday_letter',route=>{receipts++;fixture={...fixture,opened_at:new Date().toISOString()};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture.opened_at)});});
  await page.reload();await page.locator('.birthday-editor').waitFor({timeout:45000});
  await page.locator('#birthday-body').fill('小刘老师，这是浏览器测试文字，不会写入正式信件。\n\n'+'愿每一页都值得收藏。'.repeat(18));
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.locator('.birthday-editor__notice').waitFor();
  assert.equal(writes,1);assert.equal(fixture.is_ready,false);
  await page.getByRole('button',{name:'预览惊喜',exact:true}).click();
  for(const width of [1440,820,390,320]){
   await page.setViewportSize({width,height:width<500?844:1000});
   assert.ok(await page.evaluate(()=>{const d=document.querySelector('.birthday-dialog');return d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth;}),'no overflow at '+width);
   await page.screenshot({path:`test-results/birthday-envelope-${width}.png`});
  }
  await page.getByRole('button',{name:'拆开这份生日心意',exact:true}).click();
  await page.screenshot({path:'test-results/birthday-candle-320.png'});
  await page.getByRole('button',{name:'许好愿了，点灭蜡烛',exact:true}).click();
  await page.locator('.birthday-letter').waitFor();
  assert.ok((await page.locator('.birthday-letter__body').textContent()).includes('\n\n'),'Letter preserves paragraphs');
  await page.screenshot({path:'test-results/birthday-letter-320.png'});
  assert.equal(receipts,0,'Preview never acknowledges recipient opening');
  await page.getByRole('button',{name:'退出预览',exact:false}).click();
  await page.getByRole('button',{name:'准备好了，生日送给她',exact:true}).click();
  await page.locator('.birthday-editor__status.is-ready').waitFor();assert.equal(fixture.is_ready,true);
  await page.getByRole('button',{name:'暂停送出，改为草稿',exact:true}).click();
  await page.locator('.birthday-editor__status:not(.is-ready)').waitFor();assert.equal(fixture.is_ready,false);
  // Real sign-out destroys author DOM. Future/draft response stays empty to recipient.
  await page.locator('.journal-signout').click();await page.locator('#login-email').waitFor();
  assert.equal(await page.locator('#birthday-body').count(),0);
  let released=false;
  await page.unroute('**/rest/v1/birthday_letters?*');
  fixture={...fixture,is_ready:true,opened_at:null};
  await page.route('**/rest/v1/birthday_letters?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(released?[fixture]:[])}));
  await login(page,true,'/');await page.locator('.journal-signout').waitFor({timeout:45000});
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.birthday-entry').count(),0);assert.equal(await page.locator('.birthday-dialog[open]').count(),0);
  // Simulate the server making a due, ready letter available while the tab is open.
  released=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('.birthday-dialog[open]').waitFor({timeout:20000});
  await page.getByRole('button',{name:'先回手记',exact:false}).click();assert.equal(receipts,0,'Dismissing envelope does not mark it read');
  await page.locator('.birthday-entry').click();await page.locator('.birthday-dialog[open]').waitFor();
  await page.getByRole('button',{name:'拆开这份生日心意',exact:true}).click();
  await page.getByRole('button',{name:'许好愿了，点灭蜡烛',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.birthday-letter'));
  await page.waitForTimeout(200);assert.equal(receipts,1);
  await page.getByRole('button',{name:'先回手记',exact:false}).click();
  await page.waitForURL('**/space/');await page.reload();await page.locator('.birthday-entry').waitFor({timeout:45000});
  assert.equal(await page.locator('.birthday-dialog[open]').count(),0,'Read birthday does not automatically replay after reload');
  await page.locator('.birthday-entry').click();await page.locator('.birthday-dialog[open]').waitFor();
  await page.keyboard.press('Escape');assert.equal(await page.locator('.birthday-dialog[open]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: real author preview, four widths, envelope/candle/letter, paragraph layout, isolated draft/publish/pause, recipient embargo and automatic trigger, dismiss/reopen, read-once and Escape; no production letter writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
