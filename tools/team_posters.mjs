// Team-only WhatsApp posters (1080 square), so team alerts never look like student messages.
// No student photo: a dark "control room" card with a big icon, a TEAM badge and three steps.
// Three looks per kind (navy, ink, gold), named <kind>_1..3.jpg like every other poster.
// Usage: node tools/team_posters.mjs site/img/wa [people.json]   (needs Playwright)
// people.json: [{ slug, name, role, photo }] (photo = a local JPEG). With it, every poster is also made
// per person (<kind>_<slug>_1..3.jpg) with their real photo at the side and "For <name>".
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'path';
import fs from 'fs';

const out = process.argv[2] || 'site/img/wa';
const I = {
  leads: '<path d="M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/><circle cx="19" cy="6" r="3" fill="currentColor" stroke="none"/>',
  docs: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v4"/><circle cx="12" cy="18.5" r=".6" fill="currentColor"/>',
  payment: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><path d="m8 15 2 2 4-4"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/>',
};
const K = {
  team_leads:   { icon: 'leads',   tag: 'Leads waiting',      h: ['Students are', 'waiting for', 'a call'], hi: 2,
                  sub: 'People asked about studying with Orbuni. The first reply wins them.',
                  steps: ['Open Leads in the portal', 'Call the oldest first', 'Mark them contacted'] },
  team_docs:    { icon: 'docs',    tag: 'Documents missing',  h: ['A student file', 'is missing', 'documents'], hi: 2,
                  sub: 'The application cannot go to the university until the file is complete.',
                  steps: ['Open the student file', 'Message them what is missing', 'Check it when it arrives'] },
  team_payment: { icon: 'payment', tag: 'Payment received',   h: ['A payment', 'just came', 'in'], hi: 2,
                  sub: 'Money arrived. Make sure the student feels it the same day.',
                  steps: ['Check it under Finance', 'Switch on what they paid for', 'Say thank you'] },
  team_general: { icon: 'bell',    tag: 'Needs your attention', h: ['Something', 'needs your', 'attention'], hi: 2,
                  sub: 'Something came up that needs a person from the team.',
                  steps: ['Read the message', 'Do the next step', 'Reply done to the AI'] },
  team_chat:    { icon: 'chat',    tag: 'Chat needs a person', h: ['A WhatsApp', 'chat needs', 'you'], hi: 2,
                  sub: 'The AI has paused and handed this conversation to the team.',
                  steps: ['Open the WhatsApp inbox', 'Reply to the student', 'Press Done'] },
};
const LOOK = [
  { bg: 'radial-gradient(900px 700px at 85% 15%, #1d3a6e 0%, #0b1426 60%)', fg: '#fff', dim: '#A9B7CC', acc: '#F2B544', card: 'rgba(255,255,255,.06)', line: 'rgba(255,255,255,.12)', chip: '#F2B544', chipfg: '#0E1626' },
  { bg: 'linear-gradient(160deg, #11161f 0%, #1b2230 100%)', fg: '#fff', dim: '#9AA6B8', acc: '#5BD1A1', card: 'rgba(91,209,161,.07)', line: 'rgba(91,209,161,.25)', chip: '#5BD1A1', chipfg: '#0E1626' },
  { bg: 'linear-gradient(150deg, #F7C25A 0%, #E08A33 100%)', fg: '#0E1626', dim: '#3a2a12', acc: '#0E1626', card: 'rgba(14,22,38,.08)', line: 'rgba(14,22,38,.18)', chip: '#0E1626', chipfg: '#F7C25A' },
];
const html = (k, L, who) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{width:1080px;height:1080px;background:${L.bg};color:${L.fg};font-family:Inter,system-ui,sans-serif;position:relative;overflow:hidden}
.grid{position:absolute;inset:0;background-image:linear-gradient(${L.line} 1px,transparent 1px),linear-gradient(90deg,${L.line} 1px,transparent 1px);background-size:60px 60px;opacity:.35;mask-image:linear-gradient(120deg,transparent 30%,#000 100%)}
.top{position:absolute;top:70px;left:72px;right:72px;display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font:800 26px/1 Inter;letter-spacing:.32em}
.team{background:${L.chip};color:${L.chipfg};font:900 22px/1 Inter;letter-spacing:.2em;padding:14px 22px;border-radius:12px}
.tag{position:absolute;top:200px;left:72px;border:2px solid ${L.acc};color:${L.acc};font:800 22px/1 Inter;letter-spacing:.16em;text-transform:uppercase;padding:14px 22px;border-radius:40px}
h1{position:absolute;top:280px;left:72px;font:900 ${who ? 88 : 96}px/1.02 Inter;letter-spacing:-.04em;width:${who ? 580 : 620}px}
h1 b{color:${L.acc}}
.sub{position:absolute;top:620px;left:72px;width:${who ? 520 : 560}px;font:500 28px/1.45 Inter;color:${L.dim}}
.icon{position:absolute;right:72px;top:250px;width:300px;height:300px;border-radius:44px;background:${L.card};border:2px solid ${L.line};display:flex;align-items:center;justify-content:center;color:${L.acc}}
.icon svg{width:170px;height:170px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.steps{position:absolute;left:72px;right:72px;bottom:120px;display:flex;gap:18px}
.st{flex:1;background:${L.card};border:2px solid ${L.line};border-radius:20px;padding:22px 22px;font:700 24px/1.3 Inter}
.st i{display:block;font:900 20px/1 Inter;color:${L.acc};font-style:normal;margin-bottom:10px;letter-spacing:.1em}
.who{position:absolute;right:72px;top:236px;width:330px;text-align:center}
.ph{position:relative;width:300px;height:300px;margin:0 auto;border-radius:50%;padding:8px;background:${L.acc}}
.ph img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;border:6px solid ${L.chipfg === '#0E1626' ? '#0b1426' : '#F7C25A'}}
.ph .bd{position:absolute;right:-4px;bottom:6px;width:96px;height:96px;border-radius:50%;background:${L.chip};color:${L.chipfg};display:flex;align-items:center;justify-content:center;border:6px solid ${L.chipfg === '#0E1626' ? '#0b1426' : '#F7C25A'}}
.ph .bd svg{width:50px;height:50px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.who b{display:block;margin-top:22px;font:900 34px/1.1 Inter}
.who span{display:block;margin-top:8px;font:600 21px/1.3 Inter;color:${L.dim}}
.foot{position:absolute;left:72px;right:72px;bottom:56px;display:flex;justify-content:space-between;font:700 22px/1 Inter;color:${L.dim}}
</style></head><body><div class="grid"></div>
<div class="top"><div class="brand"><svg width="44" height="44" viewBox="0 0 64 64"><circle cx="32" cy="32" r="17" fill="none" stroke="${L.acc}" stroke-width="5"/><ellipse cx="32" cy="32" rx="17" ry="7" fill="none" stroke="${L.acc}" stroke-width="3" opacity=".75" transform="rotate(-28 32 32)"/></svg>ORBUNI</div><div class="team">TEAM ONLY</div></div>
<div class="tag">${k.tag}</div>
<h1>${k.h.map((l, i) => i === k.hi ? `<b>${l}</b>` : l).join('<br>')}</h1>
<div class="sub">${k.sub}</div>
${who ? `<div class="who"><div class="ph"><img src="${who.src}"><div class="bd"><svg viewBox="0 0 24 24">${I[k.icon]}</svg></div></div><b>For ${who.name}</b><span>${who.role}</span></div>`
     : `<div class="icon"><svg viewBox="0 0 24 24">${I[k.icon]}</svg></div>`}
<div class="steps">${k.steps.map((s, i) => `<div class="st"><i>STEP ${i + 1}</i>${s}</div>`).join('')}</div>
<div class="foot"><span>Orbuni team alert</span><span>myorbuni.com/#portal=admin</span></div>
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1080 } });
const people = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [];
const runs = [null, ...people.map((x) => ({ ...x, src: 'data:image/jpeg;base64,' + fs.readFileSync(x.photo).toString('base64') }))];
for (const who of runs) for (const [name, k] of Object.entries(K)) for (let v = 0; v < 3; v++) {
  await p.setContent(html(k, LOOK[v], who), { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(250);
  const f = path.join(out, `${name}${who ? '_' + who.slug : ''}_${v + 1}.jpg`);
  await p.screenshot({ path: f, type: 'jpeg', quality: 86 });
  console.log(f);
}
await b.close();
