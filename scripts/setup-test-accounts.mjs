import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!adminKey) {
  console.error("Add SUPABASE_SECRET_KEY to the ignored .env.local file, then run this script again. Never use a PUBLIC_ prefix for this key.");
  process.exit(2);
}
const bootstrap = readFileSync("supabase/bootstrap/fixed-two-user-space.local.sql", "utf8");
const ids = ["overlight_user_id", "rain_user_id"].map(name => bootstrap.match(new RegExp(name + "\\s+uuid\\s*:=\\s*'([0-9a-f-]{36})'", "i"))?.[1]);
if (ids.some(id => !id)) throw new Error("The two existing account IDs were not found. No accounts changed.");
const url = new URL(process.env.PUBLIC_SUPABASE_URL);
url.pathname = "/";
const admin = createClient(url.href, adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = ids.map((id, index) => ({ id, email: index === 0 ? "overlight@firefly.test" : "luoyu@firefly.test", password: "Journal!" + randomBytes(12).toString("base64url"), displayName: index === 0 ? "overlight" : "落雨带伞" }));
// Validate both targets before changing either. Keep their UUIDs, membership and all existing data.
for (const account of accounts) {
  const result = await admin.auth.admin.getUserById(account.id);
  if (result.error || !result.data.user) throw new Error("Unable to validate both existing accounts. No accounts changed.");
}
if (!process.argv.includes("--apply")) {
  console.log("Validated two existing accounts. --apply resets their login email/password while preserving their IDs and data.");
  process.exit(0);
}
// Save credentials before the first remote change, so partial failure remains recoverable.
writeFileSync(".test-accounts.local.txt", accounts.map(a => `${a.displayName}\nEmail: ${a.email}\nPassword: ${a.password}\n`).join("\n"), { mode: 0o600 });
for (const account of accounts) {
  const result = await admin.auth.admin.updateUserById(account.id, { email: account.email, password: account.password, email_confirm: true });
  if (result.error) throw new Error(`Account reset failed for ${account.displayName}. The local credentials file is retained; do not run again before checking the completed step.`);
  console.log(`Reset ${account.displayName}; existing records and membership preserved.`);
}
let env = readFileSync(".env.local", "utf8");
function setEnv(name, value) {
  const pattern = new RegExp("^" + name + "=.*$", "m");
  env = pattern.test(env) ? env.replace(pattern, name + "=" + value) : env.trimEnd() + "\n" + name + "=" + value + "\n";
}
setEnv("TEST_AUTH_EMAIL", accounts[0].email); setEnv("TEST_AUTH_PASSWORD", accounts[0].password);
setEnv("TEST_PARTNER_EMAIL", accounts[1].email); setEnv("TEST_PARTNER_PASSWORD", accounts[1].password);
writeFileSync(".env.local", env, { mode: 0o600 });
for (const account of accounts) {
  const browser = createClient(url.href, process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await browser.auth.signInWithPassword({ email: account.email, password: account.password });
  if (result.error) throw new Error(`Reset completed but login verification failed for ${account.displayName}.`);
  const membership = await browser.from("space_members").select("space_id").eq("user_id", account.id);
  if (membership.error || !membership.data?.length) throw new Error(`Login works but space access verification failed for ${account.displayName}.`);
  await browser.auth.signOut({ scope: "local" });
}
console.log("Both accounts can log in and access their existing space. Credentials: .test-accounts.local.txt (ignored by Git).");
