// Orbuni - after every payment: the receipt (which is also the invoice) by email,
// and a short "payment received" WhatsApp message.
// Rows come from public.payment_receipts, filled by database triggers on
// whop_payments (dollars) and paystack_payments (naira). Finance and the team's
// alert are written by the existing triggers; this only talks to the payer.
// Called by pg_cron every two minutes with x-orb-secret.
// Secrets: ORB_CRON_SECRET, RESEND_API_KEY, RESEND_FROM, RESEND_REPLY_TO,
//          TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
// WhatsApp rule: free text only inside 24 hours of the student's last message;
// outside that, only the Meta-approved template "orbuni_payment_received".
// This function creates that template once and keeps its approval up to date.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const CRON = env("ORB_CRON_SECRET");
const RESEND_KEY = env("RESEND_API_KEY");
const RESEND_FROM = env("RESEND_FROM") || "Orbuni <onboarding@resend.dev>";
const REPLY_TO = env("RESEND_REPLY_TO");
const TW_SID = env("TWILIO_ACCOUNT_SID");
const TW_TOKEN = env("TWILIO_AUTH_TOKEN");
const WA_FROM = env("TWILIO_WHATSAPP_FROM") || "whatsapp:+14434481577";
const WEBHOOK = "https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/wa-webhook";
const TW_AUTH = "Basic " + btoa(TW_SID + ":" + TW_TOKEN);
const TPL_KEY = "orbuni_payment_received";
const TPL_BODY = "Hi {{1}}, we received your payment of {{2}} for {{3}}. Thank you! Your receipt is in your email and your Orbuni portal is already updated.";
const SITE = "https://myorbuni.com";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const db = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: unknown) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (t: unknown) => new Date(String(t || Date.now())).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
const first = (n: unknown) => String(n || "").trim().split(/\s+/)[0] || "there";
// test and placeholder addresses never get mail (same rule as the email outbox)
const isTest = (e: string) => /@(example\.(com|org|net)|test\.|.*\.test$|.*\.invalid$)|\+test@|^test@/i.test(e);

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------------------------------------------------------------- email
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
function receiptHtml(r: any) {
  const row = (k: string, v: string, i: number) =>
    `<tr><td class="stack" style="${i ? "border-top:1px solid #E4E8EF;" : ""}padding:13px 0;font:400 14px/1.45 ${SANS};color:#7A8798;width:40%;vertical-align:top">${k}</td>` +
    `<td class="stack rt" style="${i ? "border-top:1px solid #E4E8EF;" : ""}padding:13px 0;font:600 15px/1.45 ${SANS};color:#111826;text-align:right;vertical-align:top">${v}</td></tr>`;
  const pairs: [string, string][] = [
    ["Receipt / invoice no.", esc(r.receipt_no)], ["Date", esc(day(r.paid_at))],
    ["Billed to", esc([r.name, r.email].filter(Boolean).join(" · "))], ["Item", esc(r.item)],
    ["Amount", esc(usd(r.amount_usd)) + (r.amount_local ? " (" + esc(r.amount_local) + ")" : "")],
    ["Paid with", esc(r.method)], ["Status", `<span style="color:#127A52">PAID</span>`],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Orbuni receipt</title>
<style>a{color:#B8791A}@media only screen and (max-width:600px){.wrap{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}
.stack{display:block!important;width:100%!important;text-align:left!important;padding-bottom:0!important}.stack.rt{padding-top:2px!important;padding-bottom:13px!important}h1{font-size:22px!important}}</style></head>
<body style="margin:0;padding:0;background:#F5F7FA">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Payment received: ${esc(usd(r.amount_usd))} for ${esc(r.item)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F7FA"><tr><td align="center" style="padding:26px 12px 34px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td bgcolor="#0E1626" style="background:#0E1626;border-radius:14px 14px 0 0;padding:20px 32px;font:800 18px/1 ${SANS};color:#FFFFFF">Orbuni</td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-left:1px solid #E4E8EF;border-right:1px solid #E4E8EF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="pad" style="padding:26px 32px 0"><div style="font:700 11px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#B8791A">Payment received</div></td></tr>
<tr><td class="pad" style="padding:6px 32px 0"><h1 style="margin:0;font:700 25px/1.28 ${SANS};color:#111826;letter-spacing:-.02em">Thank you, ${esc(first(r.name))}. You're paid.</h1></td></tr>
<tr><td class="pad" style="padding:14px 32px 0"><p style="margin:0;font:400 16px/1.65 ${SANS};color:#48566B">This email is your invoice and your receipt. Keep it for your records.</p></td></tr>
<tr><td class="pad" style="padding:24px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F7FA" style="background:#F5F7FA;border-radius:12px"><tr><td style="padding:6px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pairs.map(([k, v], i) => row(k, v, i)).join("")}</table></td></tr></table></td></tr>
<tr><td class="pad" style="padding:24px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EAF7F1" style="background:#EAF7F1;border-radius:12px"><tr><td style="padding:16px 18px;border-left:4px solid #127A52;border-radius:12px">
<div style="font:700 13.5px/1.4 ${SANS};color:#127A52;margin-bottom:5px">What happens next</div>
<div style="font:400 14px/1.6 ${SANS};color:#48566B">Your counsellor has been told and your portal is already updated. Open it any time to see where things stand.</div></td></tr></table></td></tr>
<tr><td class="pad" style="padding:26px 32px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#0E1626" style="border-radius:10px">
<a href="${SITE}/#login" style="display:block;padding:15px 30px;font:700 16px/1 ${SANS};color:#FFFFFF;text-decoration:none;border-radius:10px">Open my portal</a></td></tr></table></td></tr>
<tr><td class="pad" style="padding:16px 32px 0"><p style="margin:0;font:400 13px/1.6 ${SANS};color:#7A8798">Orbuni Education · Istanbul, Türkiye. Tuition is always paid directly to the university, never to Orbuni or a person. Questions about this payment? Reply to this email.</p></td></tr>
<tr><td style="height:34px;line-height:34px;font-size:0">&nbsp;</td></tr></table></td></tr>
<tr><td bgcolor="#F5F7FA" class="pad" style="background:#F5F7FA;border:1px solid #E4E8EF;border-top:0;border-radius:0 0 14px 14px;padding:22px 32px">
<p style="margin:0;font:400 12.5px/1.65 ${SANS};color:#7A8798"><a href="${SITE}" style="color:#B8791A;text-decoration:none;font-weight:600">myorbuni.com</a> · Istanbul, Türkiye</p></td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(r: any): Promise<string | null> {
  if (!RESEND_KEY) return "email not configured";
  const body: Record<string, unknown> = {
    from: RESEND_FROM, to: [r.email], subject: `Receipt ${r.receipt_no} — payment received, thank you`, html: receiptHtml(r),
  };
  if (REPLY_TO) body.reply_to = REPLY_TO;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.ok ? null : `${res.status}: ${(await res.text()).slice(0, 200)}`;
}

// ---------------------------------------------------------------- WhatsApp
async function tw(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: TW_AUTH, ...(init.headers || {}) } });
  const j: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
// create the template once, submit it to Meta, then follow the decision (at most every 30 min)
async function template(sb: ReturnType<typeof db>): Promise<{ sid: string; approved: boolean } | null> {
  if (!TW_SID || !TW_TOKEN) return null;
  const { data: row } = await sb.from("wa_templates").select("*").eq("key", TPL_KEY).maybeSingle();
  let cur: any = row;
  if (!cur?.content_sid) {
    const c = await tw("https://content.twilio.com/v1/Content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      friendly_name: TPL_KEY, language: "en", variables: { "1": "Aisha", "2": "$10.00", "3": "The Scholarship Masterclass" },
      types: { "twilio/call-to-action": { body: TPL_BODY, actions: [{ type: "URL", title: "Open my portal", url: SITE + "/" }] } } }) });
    if (!c.ok || !c.j.sid) { console.warn("template create", c.status, JSON.stringify(c.j).slice(0, 200)); return null; }
    cur = { key: TPL_KEY, content_sid: c.j.sid, approval: "not_submitted", body: TPL_BODY };
    await sb.from("wa_templates").upsert({ ...cur, updated_at: new Date().toISOString() }, { onConflict: "key" });
  }
  if (cur.approval === "not_submitted") {
    const s = await tw(`https://content.twilio.com/v1/Content/${cur.content_sid}/ApprovalRequests/whatsapp`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: TPL_KEY, category: "UTILITY" }) });
    if (s.ok) { cur.approval = "pending"; await sb.from("wa_templates").update({ approval: "pending", updated_at: new Date().toISOString() }).eq("key", TPL_KEY); }
    else console.warn("template submit", s.status, JSON.stringify(s.j).slice(0, 200));
  } else if (cur.approval !== "approved" && cur.approval !== "rejected") {
    const age = Date.now() - Date.parse(cur.updated_at || 0);
    if (!(age < 30 * 60 * 1000)) {
      const a = await tw(`https://content.twilio.com/v1/Content/${cur.content_sid}/ApprovalRequests`);
      const st = String(a.j?.whatsapp?.status || cur.approval || "pending").toLowerCase();
      cur.approval = st;
      await sb.from("wa_templates").update({ approval: st, updated_at: new Date().toISOString() }).eq("key", TPL_KEY);
    }
  }
  return { sid: cur.content_sid, approved: cur.approval === "approved" };
}

async function waSend(toE164: string, o: { body?: string; contentSid?: string; vars?: Record<string, string> }) {
  const form = new URLSearchParams({ From: WA_FROM, To: "whatsapp:" + toE164, StatusCallback: WEBHOOK });
  if (o.contentSid) { form.set("ContentSid", o.contentSid); if (o.vars) form.set("ContentVariables", JSON.stringify(o.vars)); }
  else form.set("Body", String(o.body || "").slice(0, 1600));
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: "POST", headers: { Authorization: TW_AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j: any = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, sid: j.sid as string, status: j.status as string } : { ok: false, error: `${j.code || r.status}: ${j.message || "refused"}` };
}

async function whatsapp(sb: ReturnType<typeof db>, r: any, tpl: { sid: string; approved: boolean } | null): Promise<string> {
  if (!TW_SID || !TW_TOKEN) return "not_configured";
  // the chat: by account first, then by the phone on the account
  let contact: any = null;
  if (r.profile_id) {
    const { data } = await sb.from("wa_contacts").select("id,phone,opted_out,last_inbound_at").eq("profile_id", r.profile_id).order("last_message_at", { ascending: false }).limit(1);
    contact = data?.[0] || null;
    if (!contact) {
      const { data: p } = await sb.from("profiles").select("phone").eq("id", r.profile_id).maybeSingle();
      const ph = "+" + String(p?.phone || "").replace(/\D/g, "");
      if (ph.length >= 9) {
        const { data: c2 } = await sb.from("wa_contacts").select("id,phone,opted_out,last_inbound_at").eq("phone", ph).limit(1);
        contact = c2?.[0] || { id: null, phone: ph, opted_out: false, last_inbound_at: null };
      }
    }
  }
  if (!contact) return "no_phone";
  if (contact.opted_out) return "opted_out";
  const amount = usd(r.amount_usd) + (r.amount_local ? " (" + r.amount_local + ")" : "");
  const inWindow = contact.last_inbound_at && Date.now() - Date.parse(contact.last_inbound_at) < 23.5 * 3600 * 1000;
  const text = `Hi ${first(r.name)}, we received your payment of ${amount} for ${r.item}. Thank you! 🎉\n\nYour receipt (${r.receipt_no}) is in your email, and your Orbuni portal is already updated: ${SITE}/`;
  let res: any;
  if (inWindow) res = await waSend(contact.phone, { body: text });
  else if (tpl?.approved) res = await waSend(contact.phone, { contentSid: tpl.sid, vars: { "1": first(r.name), "2": amount, "3": String(r.item).slice(0, 120) } });
  else return "waiting_template";
  if (!res.ok) { console.warn("receipt whatsapp", res.error); return "failed"; }
  if (contact.id) {
    await sb.from("wa_messages").insert({ contact_id: contact.id, direction: "out", author: inWindow ? "system" : "template",
      body: text, template_key: inWindow ? null : TPL_KEY, twilio_sid: res.sid || null, status: res.status || "queued" });
    await sb.from("wa_contacts").update({ last_message_at: new Date().toISOString(), last_preview: text.slice(0, 120) }).eq("id", contact.id);
  }
  return "sent";
}

Deno.serve(async (req) => {
  if (!CRON || !safeEqual(req.headers.get("x-orb-secret") || "", CRON)) return json(403, { error: "forbidden" });
  const sb = db();
  const tpl = await template(sb).catch((e) => { console.warn("template", String(e).slice(0, 160)); return null; });
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data: rows, error } = await sb.from("payment_receipts").select("*")
    .or("email_sent_at.is.null,wa_status.is.null,wa_status.eq.waiting_template")
    .lt("attempts", 6).gte("created_at", since).order("created_at").limit(25);
  if (error) return json(500, { error: error.message });
  let emails = 0, was = 0;
  for (const r of rows || []) {
    const patch: Record<string, unknown> = {};
    if (!r.email_sent_at) {
      if (isTest(String(r.email || ""))) { patch.email_sent_at = new Date().toISOString(); patch.email_error = "test address — not sent"; }
      else {
        const err = await sendEmail(r);
        if (err) { patch.email_error = err; patch.attempts = (r.attempts || 0) + 1; }
        else { patch.email_sent_at = new Date().toISOString(); patch.email_error = null; emails++; }
      }
    }
    if (!r.wa_status || r.wa_status === "waiting_template") {
      const st = isTest(String(r.email || "")) ? "skipped_test" : await whatsapp(sb, r, tpl).catch((e) => { console.warn("wa", String(e).slice(0, 160)); return "failed"; });
      if (st !== "waiting_template" || r.wa_status !== "waiting_template") patch.wa_status = st;
      if (st === "sent") { patch.wa_sent_at = new Date().toISOString(); was++; }
      // "waiting_template" is retried on later runs until Meta decides (rows older than 3 days stop)
    }
    if (Object.keys(patch).length) await sb.from("payment_receipts").update(patch).eq("id", r.id);
  }
  return json(200, { due: (rows || []).length, emails, whatsapp: was, template: tpl ? (tpl.approved ? "approved" : "pending") : "unavailable" });
});
