// Orbuni — pushes queued notifications out by browser push, email and WhatsApp.
// Called every two minutes by pg_cron. Safe to call by hand.
// Team members get push + email, and WhatsApp for the urgent kinds (sent from the
// Orbuni Twilio number with a Meta-approved template). Students and partners get the
// phone/browser push only — their emails come from send-student-emails, in their own
// friendlier templates.
//
// WhatsApp layout (16 Oct 2026): orbuni_team_alert_v2 once Meta approves it —
//   *Orbuni · Team alert* / *headline* / detail / Who / Next step + "Open the team portal" button.
// Until then the older orbuni_staff_alert (title + one line) is used, with the same tidy wording.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const env = (k: string) => Deno.env.get(k) ?? "";

const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET  = env("ORB_CRON_SECRET");

const VAPID_PUB  = env("VAPID_PUBLIC_KEY");
const VAPID_PRIV = env("VAPID_PRIVATE_KEY");
const VAPID_SUB  = env("VAPID_SUBJECT") || "mailto:nurudeen@myorbuni.com";

const RESEND_KEY  = env("RESEND_API_KEY");
const RESEND_FROM = env("RESEND_FROM") || "Orbuni <alerts@myorbuni.com>";

// WhatsApp to the team: Twilio (the Orbuni number) with an approved staff template.
const TW_SID   = env("TWILIO_ACCOUNT_SID").trim();
const TW_TOKEN = env("TWILIO_AUTH_TOKEN").trim();
const TW_FROM  = env("TWILIO_WHATSAPP_FROM").trim() || "whatsapp:+14434481577";
const WA_KINDS = new Set(["whatsapp_handoff", "team_alert", "lead_assigned", "payment_received"]);   // urgent only

const PORTAL = "https://myorbuni.com";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const PUSH_READY = !!(VAPID_PUB && VAPID_PRIV);
if (PUSH_READY) webpush.setVapidDetails(VAPID_SUB, VAPID_PUB, VAPID_PRIV);

function esc(s: string){
  return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!));
}

function portalUrl(kind: string){
  if(kind === "message_received") return PORTAL + "/#chat";
  if(kind === "application_submitted" || kind === "application") return PORTAL + "/#students";
  return PORTAL;
}

function emailHtml(title: string, body: string | null, kind: string){
  const href = portalUrl(kind);
  const detail = body ? `<tr><td style="padding:0 32px 20px">
  <p style="margin:0;font:400 16px/1.6 ${SANS};color:#4B5568">${esc(body)}</p>
</td></tr>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Orbuni</title>
</head>
<body style="margin:0;padding:0;background:#F4F5F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F4F5F7" style="background:#F4F5F7">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
<tr><td style="padding:0 8px 18px">
  <p style="margin:0;font:800 18px/1 ${SANS};color:#111827;letter-spacing:-0.02em">Orbuni</p>
</td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:28px 32px 8px">
  <p style="margin:0;font:700 11px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#B8791A">Team alert</p>
</td></tr>
<tr><td style="padding:8px 32px 12px">
  <h1 style="margin:0;font:700 22px/1.35 ${SANS};color:#111827">${esc(title)}</h1>
</td></tr>
${detail}
<tr><td style="padding:4px 32px 28px">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#111827" style="background:#111827;border-radius:6px">
      <a href="${href}" style="display:inline-block;padding:12px 22px;font:700 14px/1 ${SANS};color:#FFFFFF;text-decoration:none">Open in Orbuni</a>
    </td>
  </tr></table>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:18px 8px 0">
  <p style="margin:0;font:400 12px/1.6 ${SANS};color:#6B7280">You are on the Orbuni team. Change what you get told about under Team &amp; alerts in the portal.</p>
  <p style="margin:8px 0 0;font:400 12px/1.6 ${SANS};color:#6B7280"><a href="${PORTAL}" style="color:#B8791A;text-decoration:none">myorbuni.com</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function emailText(title: string, body: string | null, kind: string){
  return [title, body || "", "", "Open in Orbuni: " + portalUrl(kind), "", "myorbuni.com"].filter(Boolean).join("\n");
}

async function sendEmail(to: string, title: string, body: string | null, kind: string){
  if(!RESEND_KEY) return { ok:false, why:"no RESEND_API_KEY" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject: title,
      html: emailHtml(title, body, kind),
      text: emailText(title, body, kind)
    })
  });
  if(!r.ok) return { ok:false, why: `resend ${r.status}: ${(await r.text()).slice(0,200)}` };
  return { ok:true };
}

// WhatsApp template values may not contain line breaks, tabs or long runs of spaces, nor be empty.
const flat = (s: string, n: number) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t) || "-";
};
const noEmoji = (s: string) => String(s || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").trim();

type Parts = { headline: string; detail: string; who: string; next: string };

// Turns a notification (written for push/email) into the four short lines of the WhatsApp alert.
export function alertParts(kind: string, title: string, body: string | null): Parts {
  const t = noEmoji(title);
  const b = String(body || "").replace(/\n*Open the WhatsApp inbox: \S+\s*$/, "").trim();
  const grab = (re: RegExp) => (b.match(re)?.[1] || "").trim();

  if(kind === "whatsapp_handoff"){
    const m = b.match(/^(.*?)\s*\((\+?\d[\d ]{6,})\)/);
    const who = m ? `${m[1].trim() || "Unknown name"}, ${m[2].replace(/\s/g, "")}` : "-";
    if(/still waiting/i.test(title)){
      const msg = grab(/while waiting for the team:\s*"([\s\S]*?)"\s*(?:\n|$)/);
      const why = grab(/Why it was handed over:\s*(.+)/);
      return {
        headline: "A student is still waiting for a reply",
        detail: [why && `Reason: ${why.replace(/\.$/, "")}.`, msg && `New message: "${msg}"`].filter(Boolean).join(" ") || b,
        who, next: "Reply in the WhatsApp inbox, then press Done"
      };
    }
    const why = grab(/Why:\s*(.+)/);
    const msg = grab(/Their last message:\s*"([\s\S]*?)"\s*(?:\n|$)/);
    return {
      headline: "A WhatsApp chat needs a reply",
      detail: [why && `Reason: ${why.replace(/\.$/, "")}.`, msg && `Last message: "${msg}"`].filter(Boolean).join(" ") || b,
      who, next: "Reply in the WhatsApp inbox, then press Done. The AI is paused on this chat."
    };
  }
  if(kind === "lead_assigned"){
    const [name, ...rest] = b.split(" · ");
    return {
      headline: t || "New lead assigned to you",
      detail: rest.length ? rest.join(" · ") : b,
      who: rest.length ? name : "-",
      next: "Contact them within 30 minutes from Leads in the team portal"
    };
  }
  if(kind === "payment_received"){
    return { headline: t || "Payment received", detail: b || "-", who: "-", next: "Check it under Finance in the team portal" };
  }
  // team_alert: a message a team member sent to everyone. "— Name" at the end is the sender.
  const sig = b.match(/\n?\s*—\s*([^\n]+)\s*$/);
  return {
    headline: t || "Team message",
    detail: (sig ? b.slice(0, sig.index) : b).trim() || "-",
    who: sig ? `From ${sig[1].trim()}` : "-",
    next: "Open the team portal for the details"
  };
}

function waVars(v2: boolean, kind: string, title: string, body: string | null){
  const p = alertParts(kind, title, body);
  if(v2) return { "1": flat(p.headline, 120), "2": flat(p.detail, 500), "3": flat(p.who, 120), "4": flat(p.next, 160) };
  // older two-slot template: headline, then one tidy line
  const line = [p.detail !== "-" && p.detail, p.who !== "-" && `Who: ${p.who}`, `Next step: ${p.next.replace(/\.$/, "")}`].filter(Boolean).join(" · ");
  return { "1": flat(p.headline, 180), "2": flat(line, 600) };
}

async function sendWhatsApp(contentSid: string, v2: boolean, to: string, kind: string, title: string, body: string | null){
  const d = String(to).replace(/[^0-9]/g, "");
  if(d.length < 8) return { ok:false, why:"no usable number" };
  const form = new URLSearchParams({ From: TW_FROM, To: "whatsapp:+" + d, ContentSid: contentSid,
    ContentVariables: JSON.stringify(waVars(v2, kind, title, body)) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  if(!r.ok) return { ok:false, why: `twilio ${r.status}: ${(await r.text()).slice(0,200)}` };
  return { ok:true };
}

// deno-lint-ignore no-explicit-any
async function sendPush(sb: any, profileId: string, title: string, body: string | null, kind: string, staff: boolean){
  if(!PUSH_READY) return { ok:false, why:"no VAPID keys" };
  const { data: subs } = await sb.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("profile_id", profileId);
  if(!subs || !subs.length) return { ok:false, why:"no devices" };

  const payload = JSON.stringify({
    title, body: body || "", kind,
    url: staff ? portalUrl(kind) : PORTAL, tag: kind,
    important: kind === "application_submitted" || kind === "message_received" || kind === "payment_received"
  });

  let delivered = 0;
  for(const s of subs){
    try{
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: "high" }
      );
      delivered++;
      await sb.from("push_subscriptions")
        .update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
    }catch(err){
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.statusCode;
      if(code === 404 || code === 410){
        await sb.from("push_subscriptions").delete().eq("id", s.id);
      }else{
        await sb.rpc("bump_push_failure", { p_id: s.id }).catch(() => {});
      }
    }
  }
  return delivered ? { ok:true } : { ok:false, why:"every device refused" };
}

function safeEqual(a: string, b: string): boolean {
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const given = req.headers.get("x-orb-secret") || "";
  if(!CRON_SECRET || !safeEqual(given, CRON_SECRET)){
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" }});
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // The staff WhatsApp template: the new layout once Meta has approved it, else the older one.
  const { data: tpls } = await sb.from("wa_templates").select("key, content_sid, approval")
    .in("key", ["orbuni_team_alert_v2", "orbuni_staff_alert"]);
  const ok = (k: string) => (tpls ?? []).find(t => t.key === k && t.approval === "approved" && t.content_sid);
  const pick = ok("orbuni_team_alert_v2") || ok("orbuni_staff_alert");
  const WA_SID = TW_SID && TW_TOKEN && pick ? String(pick.content_sid) : "";
  const WA_V2 = pick?.key === "orbuni_team_alert_v2";

  const { data: queue, error } = await sb
    .from("notification_recipients")
    .select("notification_id, profile_id, email_sent_at, whatsapp_sent_at, push_sent_at, notifications!inner(title, body, kind, created_at), profiles!inner(email, whatsapp, phone, first_name, role)")
    .or("email_sent_at.is.null,whatsapp_sent_at.is.null,push_sent_at.is.null")
    .gte("notifications.created_at", new Date(Date.now() - 3 * 864e5).toISOString())
    .limit(80);

  if(error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" }});

  let emailed = 0, whatsapped = 0, pushed = 0;
  const problems: string[] = [];
  const now = () => new Date().toISOString();

  for(const row of (queue ?? [])){
    // deno-lint-ignore no-explicit-any
    const n: any = (row as any).notifications;
    // deno-lint-ignore no-explicit-any
    const p: any = (row as any).profiles;
    const staff = p?.role === "staff" || p?.role === "admin";
    const patch: Record<string, string> = {};

    if(!row.push_sent_at){
      const r = await sendPush(sb, row.profile_id, n.title, n.body, n.kind, staff);
      if(r.ok){ patch.push_sent_at = now(); pushed++; }
      else if(r.why === "no devices" || r.why === "no VAPID keys"){ patch.push_sent_at = now(); }
      else if(r.why) problems.push(r.why);
    }
    if(!row.email_sent_at){
      if(!staff || !p?.email){ patch.email_sent_at = now(); }            // nothing to send: never re-queue
      else {
        const r = await sendEmail(p.email, n.title, n.body, n.kind);
        if(r.ok){ patch.email_sent_at = now(); emailed++; }
        else if(r.why === "no RESEND_API_KEY"){ patch.email_sent_at = now(); }
        else if(r.why) problems.push(r.why);
      }
    }
    if(!row.whatsapp_sent_at){
      if(!staff || !WA_SID || !WA_KINDS.has(n.kind) || !(p?.whatsapp || p?.phone)){ patch.whatsapp_sent_at = now(); }
      else {
        const r = await sendWhatsApp(WA_SID, WA_V2, p.whatsapp || p.phone, n.kind, n.title, n.body);
        if(r.ok){ patch.whatsapp_sent_at = now(); whatsapped++; }
        else { patch.whatsapp_sent_at = now(); problems.push(r.why || "whatsapp failed"); }   // never retry-loop a WhatsApp
      }
    }

    if(Object.keys(patch).length){
      await sb.from("notification_recipients").update(patch)
        .eq("notification_id", row.notification_id).eq("profile_id", row.profile_id);
    }
  }

  return new Response(JSON.stringify({
    queued: (queue ?? []).length, pushed, emailed, whatsapped,
    push_configured: PUSH_READY,
    email_configured: !!RESEND_KEY,
    whatsapp_configured: !!WA_SID,
    whatsapp_template: pick?.key || null,
    problems: problems.slice(0, 5)
  }), { headers: { "Content-Type": "application/json" }});
});
