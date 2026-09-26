const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
process.loadEnvFile(".env.local");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4328";
const motion = process.env.TEST_MOTION === "normal" ? "no-preference" : "reduce";
const report = { motion, viewports: [], errors: [] };
async function main() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_EXECUTABLE, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
  const browser = await chromium.launch({ executablePath: candidates.find(p => fs.existsSync(p)), headless: true });
  fs.mkdirSync("test-results", {recursive:true});
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({viewport:{width,height:1000}, reducedMotion: motion});
      const page = await context.newPage();
      page.on("pageerror", e => report.errors.push(e.message));
      await page.goto(base + "/space/login/");
      await page.locator("#login-email").waitFor();
      await page.screenshot({path:`test-results/login-${width}.png`,fullPage:true});
      await page.fill("input[type=email]",width === 390 ? process.env.TEST_PARTNER_EMAIL : process.env.TEST_AUTH_EMAIL);
      await page.fill("input[type=password]",width === 390 ? process.env.TEST_PARTNER_PASSWORD : process.env.TEST_AUTH_PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForFunction(()=>document.documentElement.dataset.privateAuth === "authenticated", null,{timeout:45000});
      await page.locator('[data-view="home"] .memory-today, [data-view="home"] .memory-real-empty').first().waitFor({timeout:45000});
      const runtime = await page.evaluate(()=>document.documentElement.dataset.authRuntimeInstance);
      let htmlFetches = 0;
      page.on("request", r => { const u = new URL(r.url()); if(u.origin === new URL(base).origin && (r.resourceType() === "document" || (r.resourceType() === "fetch" && !u.pathname.includes("/_astro/") && !u.pathname.includes("/src/")))) htmlFetches++; });
      const timings = [];
      for (const [href,view] of [["/timeline/","timeline"],["/map/","map"],["/memories/","memories"],["/space/","space"],["/","home"],["/timeline/","timeline"],["/map/","map"]]) {
        const start = Date.now();
        await page.locator(`nav a[href="${href}"]`).click();
        await page.locator(`[data-view="${view}"]:visible`).waitFor();
        const frameMs = Date.now()-start;
        await page.waitForFunction(view => {const el=document.querySelector(`[data-view="${view}"]`);return el && !/正在(翻开|读取|整理|打开|寻找|加载)/.test(el.innerText);},view,{timeout:45000});
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.authRuntimeInstance),runtime,"auth runtime persisted");
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        assert.ok(overflow <= 2,`No horizontal overflow at ${width}px on ${view}: ${overflow}`);
        timings.push({view,frameMs,dataVisibleMs:Date.now()-start});
      }
      assert.equal(htmlFetches,0,"module switches require no HTML requests");
      await page.locator('nav a[href="/"]').click();
      await page.screenshot({path:`test-results/home-${width}.png`,fullPage:true});
      await page.getByRole('button',{name:'记录今天',exact:true}).click();
      const compose=page.locator('dialog[open]');
      await compose.locator('textarea').fill('表单回归检查，不保存');
      await compose.screenshot({path:`test-results/compose-${width}.png`});
      const dialogBounds=await compose.boundingBox();
      assert.ok(dialogBounds.x>=0 && dialogBounds.x+dialogBounds.width<=width+1,'compose fits viewport');
      await compose.getByRole('button',{name:'取消',exact:true}).click();
      assert.equal(await page.locator('dialog[open]').count(),0,'compose closes');
      const photoLink=page.locator('[data-view="home"] a[data-fancybox]').first();
      if(await photoLink.count()) {
        await photoLink.scrollIntoViewIfNeeded();
        await photoLink.click();
        await page.locator('.journal-lightbox[open]').waitFor();
        await page.waitForFunction(()=>{const img=document.querySelector('.journal-lightbox img');return img?.complete && img.naturalWidth>0;},null,{timeout:45000});
        await page.getByRole('button',{name:'关闭照片',exact:true}).click();
        assert.equal(await page.locator('dialog[open]').count(),0,'photo viewer closes');
      }
      await page.locator('nav a[href="/memories/"]').click();
      await page.screenshot({path:`test-results/memories-${width}.png`,fullPage:true});
      const detailLink=page.locator('[data-view="memories"] a[href^="/memory/"]').first();
      if(await detailLink.count()) {
        const href=await detailLink.getAttribute("href");
        await detailLink.click(); await page.locator(".memory-detail__back").waitFor({timeout:45000});
        await page.reload(); await page.locator(".memory-detail__back").waitFor({timeout:45000});
        assert.equal(new URL(page.url()).pathname,href,"detail direct URL preserved");
        await page.screenshot({path:`test-results/detail-${width}.png`,fullPage:true});
      }
      const beforeSearch=htmlFetches;
      await page.locator('a[aria-label="搜索记忆"]').click();
      await page.locator("#memory-search").fill("2026");
      await page.locator(".journal-search__meta").waitFor();
      assert.equal(htmlFetches,beforeSearch,"search navigation is local");
      await page.goBack();
      assert.notEqual(new URL(page.url()).pathname,"/search/");
      report.viewports.push({width,timings,moduleHtmlRequests:0,detailReloadRequests:htmlFetches});
      await page.locator(".journal-signout").click();
      await page.locator("#login-email").waitFor({timeout:15000});
      assert.equal(await page.locator("[data-private-app]").count(),0,"private DOM cleared on logout");
      await page.fill("#login-email", width === 390 ? process.env.TEST_PARTNER_EMAIL : process.env.TEST_AUTH_EMAIL);
      await page.fill("#login-password", width === 390 ? process.env.TEST_PARTNER_PASSWORD : process.env.TEST_AUTH_PASSWORD);
      await page.click("button[type=submit]");
      await page.waitForFunction(()=>document.documentElement.dataset.privateAuth === "authenticated", null, {timeout:45000});
      await page.locator(".journal-signout").click();
      await page.locator("#login-email").waitFor({timeout:15000});
      await context.close();
    }
    assert.deepEqual(report.errors,[],"No uncaught browser errors");
    console.log(JSON.stringify(report,null,2));
    fs.writeFileSync("test-results/app-regression.json",JSON.stringify(report,null,2));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error.message);console.error(JSON.stringify(report,null,2));process.exitCode=1;});
