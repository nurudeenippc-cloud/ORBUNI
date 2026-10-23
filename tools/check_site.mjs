// node tools/check_site.mjs  — the site has no build step, so this is its "build check":
//  1. every inline <script> in every page under site/ must parse (catches a broken deploy);
//  2. no server-side secret may appear in anything the browser downloads.
// Exits 1 on any failure. Read-only; touches no network.
import fs from "fs";
import path from "path";
import vm from "vm";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../site");
const pages = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!["photos", "video", "videos", "vendor", "docs"].includes(f.name)) walk(p); }
    else if (/\.(html|js)$/.test(f.name)) pages.push(p);
  }
})(root);

let failures = 0, scripts = 0;
const SECRETS = [
  [/service_role/i, "a service_role reference"],
  [/sk_live_[A-Za-z0-9]{8}/, "a Paystack live secret key"],
  [/sk-ant-[A-Za-z0-9-]{8}/, "an Anthropic API key"],
  [/re_[A-Za-z0-9]{20,}/, "a Resend API key"],
  [/apik_[A-Za-z0-9]{10}/, "a Whop API key"],
  [/\bAC[a-f0-9]{32}\b/, "a Twilio account SID"],
  [/sb_secret_[A-Za-z0-9]/, "a Supabase secret key"],
];
for (const file of pages) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const [re, what] of SECRETS) if (re.test(src)) { console.error(`FAIL ${rel}: contains ${what}`); failures++; }
  const blocks = file.endsWith(".js") ? [src]
    : [...src.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/(?:ld\+)?json|text\/template)")[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const code of blocks) {
    scripts++;
    try { new vm.Script(code, { filename: rel }); }
    catch (e) { console.error(`FAIL ${rel}: script does not parse: ${e.message}`); failures++; }
  }
}
console.log(`${pages.length} files, ${scripts} scripts parsed, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
