import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {gzipSync} from 'node:zlib';
try {process.loadEnvFile('.env.local');} catch {}
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(dir,entry.name)):[join(dir,entry.name)]);}
const output=files('dist');
const html=output.filter(file=>file.endsWith('.html')).map(file=>relative('dist',file).replaceAll('\\','/')).sort();
const expected=['404.html','index.html','map/index.html','memories/index.html','memory/index.html','search/index.html','space/index.html','space/login/index.html','timeline/index.html'].sort();
assert.deepEqual(html,expected,'Only the nine private application shells may be published');
const secrets=Object.entries(process.env).filter(([name,value])=>/^(SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|TEST_AUTH_PASSWORD|TEST_PARTNER_PASSWORD)$/.test(name)&&value).map(([,value])=>value);
let bytes=0,jsGzipBytes=0;
for(const file of output){
  assert.ok(!/(pagefind|rss\.xml|sitemap|\/posts\/|\.env|test-accounts)/.test(file.replaceAll('\\','/')),'Legacy or private local file in build');
  const data=readFileSync(file);bytes+=data.length;
  for(const secret of secrets) assert.ok(!data.includes(Buffer.from(secret)),'A local secret appeared in the public build');
  assert.ok(!/sb_secret_[a-zA-Z0-9_-]{20,}/.test(data.toString()),'Unexpected admin credential in build');
  if(file.endsWith('.html')) assert.match(data.toString(),/name="robots" content="noindex/);
  if(file.endsWith('.js')) jsGzipBytes+=gzipSync(data).length;
}
console.log(JSON.stringify({pages:html.length,files:output.length,totalKiB:Math.round(bytes/1024),javascriptGzipKiB:Math.round(jsGzipBytes/1024),legacyRoutes:'absent',localSecrets:'absent'},null,2));
