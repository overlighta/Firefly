const assert = require('node:assert/strict');
const {chromium} = require('playwright');
process.loadEnvFile('.env.local');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4332';

(async () => {
 const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:390,height:844},reducedMotion:'no-preference'});
  const errors=[];let requests=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().endsWith('/audio/growing-up-scott-buckley-v1.mp3'))requests++;});
  await page.addInitScript(() => {
   const probe=window.__musicProbe={audio:[],contexts:[],gains:[],denyNext:false};
   const NativeAudio=window.Audio,NativeContext=window.AudioContext;
   window.Audio=new Proxy(NativeAudio,{construct(Target,args){const audio=new Target(...args);probe.audio.push(audio);return audio;}});
   window.AudioContext=class extends NativeContext {
    constructor(...args){super(...args);probe.contexts.push(this);}
    createGain(){const gain=super.createGain();probe.gains.push(gain);return gain;}
   };
   const play=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(){if(probe.denyNext){probe.denyNext=false;return Promise.reject(new DOMException('Test autoplay refusal','NotAllowedError'));}return play.call(this);};
  });
  // Read the real sender's page only. This suite never writes a letter or receipt.
  await page.route('**/rest/v1/birthday_letters?*',async route=>{
   if(route.request().method()!=='GET')throw new Error('Unexpected birthday write');
   const response=await route.fetch();const rows=await response.json();
   await route.fulfill({response,json:rows.map(row=>({...row,body:'音乐排版测试文字。\n\n不修改正式生日信。',signature:'测试署名'}))});
  });
  await page.route('**/rest/v1/rpc/open_birthday_letter',()=>{throw new Error('A preview tried to mark the letter read');});
  await page.goto(base+'/space/login/?next=%2Fbirthday%2F');
  await page.fill('#login-email',process.env.TEST_AUTH_EMAIL);
  await page.fill('#login-password',process.env.TEST_AUTH_PASSWORD);
  await page.click('button[type=submit]');
  await page.locator('.birthday-editor').waitFor({timeout:45000});
  const preview=()=>page.getByRole('button',{name:'预览惊喜',exact:true}).click();
  const unseal=()=>page.getByRole('button',{name:'拆开这份生日心意',exact:true}).click();
  const ready=()=>page.getByRole('button',{name:'暂停音乐',exact:true}).waitFor({timeout:25000});
  const sample=()=>page.evaluate(()=>{const p=window.__musicProbe;return{value:p.gains.at(-1)?.gain.value,paused:p.audio.at(-1)?.paused,time:p.audio.at(-1)?.currentTime,duration:p.audio.at(-1)?.duration,contexts:p.contexts.map(c=>c.state)};});
  const silent=()=>page.waitForFunction(()=>window.__musicProbe.audio.every(a=>a.paused)&&window.__musicProbe.contexts.every(c=>c.state==='closed'));

  await preview();assert.equal(requests,0,'No audio request before opening the envelope');
  await unseal();
  const initial=await sample();assert.ok(initial.value<.08,'Music begins near silence: '+JSON.stringify(initial));
  await ready();await page.waitForTimeout(3200);
  const candle=await sample();assert.ok(Math.abs(candle.value-.32)<.005&&candle.time>0&&candle.duration>110,'Real piano decodes and fades to candle volume');
  await page.screenshot({path:'test-results/birthday-music-mobile.png'});
  for(const width of [320,390,820,1440]){
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>{const d=document.querySelector('.birthday-dialog');return d.scrollWidth<=d.clientWidth;}),'Music header fits '+width);
  }
  await page.getByRole('button',{name:'暂停音乐',exact:true}).click();
  const fading=await sample();assert.ok(!fading.paused&&fading.value>0,'Pause fades before stopping');
  await page.waitForTimeout(850);assert.ok((await sample()).paused);assert.ok((await sample()).value<.001);
  await page.getByRole('button',{name:'播放音乐',exact:true}).click();await ready();
  await page.waitForTimeout(3200);assert.ok((await sample()).value>.31);
  await page.getByRole('button',{name:'许好愿了，点灭蜡烛',exact:true}).click();
  await page.locator('.birthday-letter').waitFor();await page.waitForTimeout(2600);
  assert.ok(Math.abs((await sample()).value-.19)<.005,'Reading gently lowers the same track');
  await page.keyboard.press('Escape');
  assert.ok(!(await sample()).paused,'Close leaves a short fading tail');
  await silent();

  // A fresh preview cannot stack with a fading-out player.
  await preview();await unseal();await ready();
  await page.waitForTimeout(500);await page.keyboard.press('Escape');
  await preview();await unseal();await ready();
  assert.ok(await page.evaluate(()=>window.__musicProbe.audio.filter(a=>!a.paused).length===1),'Rapid reopen keeps one player');
  // Returning from another tab leaves a visible manual-resume button.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(450);assert.ok((await sample()).paused);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  await page.getByRole('button',{name:'播放音乐',exact:true}).waitFor();assert.ok((await sample()).paused);
  await page.getByRole('button',{name:'播放音乐',exact:true}).click();await ready();
  await page.keyboard.press('Escape');await silent();

  await page.evaluate(()=>window.__musicProbe.denyNext=true);
  await preview();await unseal();
  await page.getByRole('button',{name:'播放音乐',exact:true}).waitFor();
  assert.ok((await sample()).paused,'Blocked autoplay stays silent');
  await page.getByRole('button',{name:'播放音乐',exact:true}).click();await ready();
  await page.keyboard.press('Escape');await silent();

  // Network failure remains recoverable and never blocks the candle/letter flow.
  await page.route('**/audio/growing-up-scott-buckley-v1.mp3',route=>route.fulfill({status:503,body:'Unavailable'}));
  await preview();await unseal();
  await page.getByRole('button',{name:'重试音乐',exact:true}).waitFor({timeout:20000});
  await page.unroute('**/audio/growing-up-scott-buckley-v1.mp3');
  await page.getByRole('button',{name:'重试音乐',exact:true}).click();await ready();
  await page.keyboard.press('Escape');await silent();

  // Closing while download is delayed also cancels pending play promises.
  await page.route('**/audio/growing-up-scott-buckley-v1.mp3',async route=>{await new Promise(r=>setTimeout(r,1000));await route.abort();});
  await preview();await unseal();await page.keyboard.press('Escape');
  await page.waitForTimeout(1300);await silent();
  await page.unroute('**/audio/growing-up-scott-buckley-v1.mp3');
  assert.deepEqual(errors,[]);
  console.log('PASS: real piano, gesture start, fade in/out, lower reading volume, pause/resume, four header widths, close cleanup, rapid reopen, background pause, autoplay/network recovery, pending-load cancellation; no birthday data writes');
 } finally {await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
