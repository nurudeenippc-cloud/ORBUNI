// Orbuni - sends the queued student emails. Called by pg_cron every two minutes.
// Secrets: ORB_CRON_SECRET (required), RESEND_API_KEY, RESEND_FROM, RESEND_REPLY_TO
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { render as renderBase, BODIES as BASE_BODIES } from "./mail.ts";
import { EXTRA_SUBJECTS, EXTRA_BODIES } from "./extra.ts";

// mail.ts has the application emails; extra.ts has checkout follow-ups and
// extra-service bookings. One render() for both.
const BODIES: Record<string, unknown> = { ...BASE_BODIES, ...EXTRA_BODIES };
function render(template: string, vars: Record<string, unknown>){
  const x = EXTRA_BODIES[template];
  if(x) return { subject: (EXTRA_SUBJECTS[template] ?? (() => "Orbuni"))(vars), html: x(vars) };
  return renderBase(template, vars);
}

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET  = env("ORB_CRON_SECRET");
const RESEND_KEY   = env("RESEND_API_KEY");
const RESEND_FROM  = env("RESEND_FROM") || "Orbuni <onboarding@resend.dev>";
const REPLY_TO     = env("RESEND_REPLY_TO");

// A misconfiguration usually takes longer to fix than the two minutes between runs.
const BACKOFF_MIN = [0, 5, 20, 60, 240];

const DEMO = {
  first_name: "Aisha", counsellor: "Nurudeen Abdulkareem", choices: "3 programmes",
  submitted: "27 Aug 2026", missing: "Your passport photo page",
  status: "Sent to the university", programme: "Computer Engineering",
  university: "Istanbul Medipol University",
  note: "Your file went out this morning. Medipol usually reply within ten working days.",
  published_fee: "$5,000", discount: "50%", net_fee: "$2,500", deadline: "30 Nov 2026", days: "12",
  what: "the Scholarship Masterclass", amount: "$10", link: "https://myorbuni.com/#portal=student:learn", step: 1,
  service: "Airport pickup", when: "Sat 12 Sep 2026, 14:30 (Türkiye time)", flight: "TK 624", airport: "Istanbul (IST)",
  pathway: "middle", community: "https://whop.com/orbuni/",
  price: "$150", who: "Emre Yılmaz", phone: "+90 555 000 00 00", host: "Nurudeen Abdulkareem",
  receipt_no: "ORB-W-7Q2KX9", date: "4 Oct 2026", billed_to: "Aisha Bello · aisha@example.com", item: "The Scholarship Masterclass",
  amount_local: "₦15,800", method: "Card, by Whop"
};

function safeEqual(a: string, b: string): boolean {
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const given = req.headers.get("x-orb-secret") || "";
  if(!CRON_SECRET || !safeEqual(given, CRON_SECRET)){
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" }});
  }

  // ?preview=welcome renders one; ?preview=all renders every template on one page.
  const preview = url.searchParams.get("preview");
  if(preview === "all"){
    const parts = Object.keys(BODIES).map(k => {
      const r = render(k, DEMO)!;
      return `<section><header>${k}<span>${r.subject}</span></header>
<iframe srcdoc="${r.html.replace(/&/g,"&amp;").replace(/"/g,"&quot;")}"></iframe></section>`;
    }).join("");
    return new Response(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbuni emails</title>
<style>body{margin:0;background:#0B0F17;color:#EEF3FA;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px;padding:18px}
section{background:#141C2B;border:1px solid #23304a;border-radius:12px;overflow:hidden}
header{padding:12px 14px;border-bottom:1px solid #23304a;font-weight:600;font-size:14px}
header span{display:block;font-weight:400;font-size:12px;color:#8B99AD;margin-top:3px}
iframe{width:100%;height:720px;border:0;background:#fff;display:block}</style>
<div class="g">${parts}</div>`, { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }
  if(preview){
    const r = render(preview, DEMO);
    if(!r) return new Response("unknown template", { status: 404 });
    return new Response(r.html, { headers: { "Content-Type": "text/html; charset=utf-8" }});
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }});

  const { data: queue, error } = await sb.from("email_outbox")
    .select("id, to_email, template, vars, attempts")
    .is("sent_at", null)
    .lt("attempts", BACKOFF_MIN.length)
    .lte("next_try_at", new Date().toISOString())
    .order("created_at", { ascending: true }).limit(40);

  if(error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" }});

  if(!RESEND_KEY){
    return new Response(JSON.stringify({ due: (queue ?? []).length, sent: 0, configured: false }),
      { headers: { "Content-Type": "application/json" }});
  }

  let sent = 0; const problems: string[] = [];
  for(const row of (queue ?? [])){
    const built = render(row.template, (row.vars ?? {}) as Record<string, unknown>);
    if(!built){
      await sb.from("email_outbox").update({ attempts: 99, last_error: "unknown template" }).eq("id", row.id);
      continue;
    }
    const body: Record<string, unknown> = {
      from: RESEND_FROM, to: [row.to_email], subject: built.subject, html: built.html
    };
    if(REPLY_TO) body.reply_to = REPLY_TO;
    // follow-up emails carry a signed one-click "stop" link; mail apps show it as Unsubscribe
    const unsub = String((row.vars as any)?.unsub ?? "");
    if(/^https:\/\/ytsebzdykfeiiuxbdtvr\.supabase\.co\/functions\/v1\/email-optout\?/.test(unsub)){
      body.headers = { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if(r.ok){
      await sb.from("email_outbox").update({ sent_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    }else{
      const why = `${r.status}: ${(await r.text()).slice(0, 240)}`;
      problems.push(why);
      const next = (row.attempts ?? 0) + 1;
      const waitMin = BACKOFF_MIN[Math.min(next, BACKOFF_MIN.length - 1)];
      await sb.from("email_outbox").update({
        attempts: next, last_error: why,
        next_try_at: new Date(Date.now() + waitMin * 60000).toISOString()
      }).eq("id", row.id);
    }
  }

  const { count: stuck } = await sb.from("email_outbox")
    .select("id", { count: "exact", head: true }).is("sent_at", null);

  return new Response(JSON.stringify({ due: (queue ?? []).length, sent, unsent_total: stuck ?? 0,
    configured: true, problems: problems.slice(0, 3) }), { headers: { "Content-Type": "application/json" }});
});
