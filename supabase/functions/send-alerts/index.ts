// Orbuni — pushes queued notifications out by browser push, email and WhatsApp.
// Called every two minutes by pg_cron. Safe to call by hand.
// Team members get push + email, and WhatsApp for the urgent kinds (sent from the
// Orbuni Twilio number with a Meta-approved template). Students and partners get the
// phone/browser push, plus one WhatsApp when their application status changes
// (orbuni_application_update / orbuni_partner_update, the poster "_card" versions once Meta
// approves them). Partners also get an email for those status changes; students' emails
// come from send-student-emails, in their own friendlier templates.
//
// WhatsApp layout (16 Oct 2026): orbuni_team_alert_v2 once Meta approves it —
//   *Orbuni · Team alert* / *headline* / detail / Who / Next step + "Open the team portal" button.
// Until then the older orbuni_staff_alert (title + one line) is used, with the same tidy wording.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { shell, kick, h1, button, panel, withHero, variant } from "./brand.ts";

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

// 23 Oct 2026: the same frame as every other Orbuni email (brand.ts), with a coloured
// label so the team can tell a payment from a handoff at a glance, and the team poster
// on every kind (23 Oct night: one per kind, three designs each). Partners get their own version for status changes.
const KIND_LABEL: Record<string, [string, string, string]> = {   // label, text colour, background
  whatsapp_handoff:      ["WhatsApp: needs a person", "#B42318", "#FDECEA"],
  team_alert:            ["Urgent", "#B42318", "#FDECEA"],
  lead_overdue:          ["Lead waiting", "#B42318", "#FDECEA"],
  payment_received:      ["Payment received", "#127A52", "#EAF7F1"],
  lead_assigned:         ["New lead for you", "#1D4ED8", "#EAF0FE"],
  message_received:      ["New message", "#1D4ED8", "#EAF0FE"],
  message_mention:       ["You were mentioned", "#1D4ED8", "#EAF0FE"],
  enquiry_received:      ["New enquiry", "#1D4ED8", "#EAF0FE"],
  student_signup:        ["New student", "#127A52", "#EAF7F1"],
  partner_application:   ["Partner application", "#B8791A", "#FFF3DC"],
  application_submitted: ["New application", "#B8791A", "#FFF3DC"],
  document_uploaded:     ["Document uploaded", "#48566B", "#EEF1F6"],
  documents_missing:     ["Documents missing", "#B8791A", "#FFF3DC"],
  status_change:         ["Status changed", "#B8791A", "#FFF3DC"],
};
// every team email carries a poster: the one that matches the kind, else the team alert poster
const POSTER: Record<string, string> = {
  payment_received: "team_payment", lead_assigned: "team_lead", enquiry_received: "team_lead", student_signup: "team_lead",
  lead_overdue: "team_lead", documents_missing: "team_docs", document_uploaded: "team_docs",
  application_submitted: "team_application", status_change: "team_application", partner_application: "team_partner",
};
// the body is plain text from the database: escape it, then keep its line breaks
const text = (s: string | null) => esc(s || "").replace(/\n/g, "<br>");

export function emailHtml(title: string, body: string | null, kind: string){
  const [label, fg, bg] = KIND_LABEL[kind] ?? ["Team alert", "#B8791A", "#FFF3DC"];
  const html = shell(esc(title), kick(label, fg, bg) + h1(esc(title)) + (body ? panel(text(body)) : "")
    + button("Open in Orbuni", portalUrl(kind)), "team");
  return withHero(POSTER[kind] || "team_alert", html, title);
}

export function partnerHtml(name: string, title: string, body: string | null){
  const html = shell(esc(title), kick("Partner update") + h1(esc(title))
    + `<tr><td class="pad" style="padding:14px 32px 0"><p style="margin:0;font:400 16px/1.65 ${SANS};color:#48566B">Hello ${esc(name)}, there is a new status on an application you sent us.</p></td></tr>`
    + (body ? panel(text(body)) : "")
    + button("Open the partner portal", PORTAL + "/#portal=partner:home"), "partner");
  return withHero("partner_update", html, name + title);
}

function emailText(title: string, body: string | null, kind: string){
  return [title, body || "", "", "Open in Orbuni: " + portalUrl(kind), "", "myorbuni.com"].filter(Boolean).join("\n");
}

async function sendEmail(to: string, title: string, body: string | null, kind: string, html = emailHtml(title, body, kind)){
  if(!RESEND_KEY) return { ok:false, why:"no RESEND_API_KEY" };
  const r = await fetch("https://api.resend.com/emails", { signal: AbortSignal.timeout(20000),
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject: title,
      html,
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

// The poster templates ("_card") take the poster's file name as their last variable: the team
// alert gets the picture for what happened (payment, lead, documents...), one of three designs.
const WA_POSTER: Record<string, string> = { payment_received: "payment_received", lead_assigned: "welcome", enquiry_received: "welcome",
  student_signup: "welcome", lead_overdue: "welcome", documents_missing: "documents_needed", document_uploaded: "documents_needed",
  application_submitted: "offer_ready", status_change: "offer_ready", partner_application: "partner_update" };
const waPoster = (img: string, seed: string) => `${img}_${variant(img, seed)}.jpg`;

async function sendWhatsApp(contentSid: string, v2: boolean, to: string, kind: string, title: string, body: string | null, card = false){
  const d = String(to).replace(/[^0-9]/g, "");
  if(d.length < 8) return { ok:false, why:"no usable number" };
  const vars = waVars(v2, kind, title, body) as Record<string, string>;
  if(card) vars["5"] = waPoster(WA_POSTER[kind] || "team_alert", d + title);
  const form = new URLSearchParams({ From: TW_FROM, To: "whatsapp:+" + d, ContentSid: contentSid,
    ContentVariables: JSON.stringify(vars) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { signal: AbortSignal.timeout(20000),
    method: "POST",
    headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  if(!r.ok) return { ok:false, why: `twilio ${r.status}: ${(await r.text()).slice(0,200)}` };
  return { ok:true };
}

// The student / partner update: three plain variables (name, headline, detail).
async function sendUpdate(contentSid: string, to: string, name: string, headline: string, detail: string, poster = ""){
  const d = String(to).replace(/[^0-9]/g, "");
  if(d.length < 8) return { ok:false, why:"no usable number" };
  const vars: Record<string, string> = { "1": name || "there", "2": headline || "Update", "3": detail || "-" };
  if(poster) vars["4"] = waPoster(poster, d + headline);
  const form = new URLSearchParams({ From: TW_FROM, To: "whatsapp:+" + d, ContentSid: contentSid,
    ContentVariables: JSON.stringify(vars) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { signal: AbortSignal.timeout(20000),
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

  // The staff WhatsApp template: the poster version, then the new layout, once Meta has approved
  // them, else the older one. The poster versions take the same variables as the ones before them.
  const { data: tpls } = await sb.from("wa_templates").select("key, content_sid, approval")
    .in("key", ["orbuni_team_alert_card", "orbuni_team_alert_v2", "orbuni_staff_alert",
                "orbuni_application_update_card", "orbuni_application_update", "orbuni_partner_update_card", "orbuni_partner_update"]);
  const ok = (k: string) => (tpls ?? []).find(t => t.key === k && t.approval === "approved" && t.content_sid);
  const pick = ok("orbuni_team_alert_card") || ok("orbuni_team_alert_v2") || ok("orbuni_staff_alert");
  const WA_SID = TW_SID && TW_TOKEN && pick ? String(pick.content_sid) : "";
  const WA_V2 = pick?.key !== "orbuni_staff_alert";
  // students and partners: one WhatsApp per application status change
  const stu = ok("orbuni_application_update_card") || ok("orbuni_application_update");
  const par = ok("orbuni_partner_update_card") || ok("orbuni_partner_update");
  const STU_SID = TW_SID && TW_TOKEN ? String(stu?.content_sid || "") : "";
  const PAR_SID = TW_SID && TW_TOKEN ? String(par?.content_sid || "") : "";
  const WA_CARD = pick?.key === "orbuni_team_alert_card";

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
      // the team gets every kind; partners get their status changes (students get theirs from send-student-emails)
      const partnerMail = p?.role === "partner" && n.kind === "status_change";
      if(!(staff || partnerMail) || !p?.email){ patch.email_sent_at = now(); }   // nothing to send: never re-queue
      else {
        const r = await sendEmail(p.email, n.title, n.body, n.kind,
          partnerMail ? partnerHtml(p.first_name || "there", n.title, n.body) : undefined);
        if(r.ok){ patch.email_sent_at = now(); emailed++; }
        else if(r.why === "no RESEND_API_KEY"){ patch.email_sent_at = now(); }
        else if(r.why) problems.push(r.why);
      }
    }
    if(!row.whatsapp_sent_at && !staff){
      const sid = n.kind === "status_change" ? (p?.role === "partner" ? PAR_SID : p?.role === "student" ? STU_SID : "") : "";
      if(!sid || !(p?.whatsapp || p?.phone)){ patch.whatsapp_sent_at = now(); }
      else {
        const card = (p?.role === "partner" ? par : stu)?.key?.endsWith("_card");
        const r = await sendUpdate(sid, p.whatsapp || p.phone, flat(p.first_name || "there", 60), flat(noEmoji(n.title), 120), flat(n.body || "Open your portal to see what changed.", 400),
          card ? (p?.role === "partner" ? "partner_update" : "offer_ready") : "");
        patch.whatsapp_sent_at = now();
        if(r.ok) whatsapped++; else problems.push(r.why || "whatsapp failed");
      }
    }
    if(!row.whatsapp_sent_at && !patch.whatsapp_sent_at){
      if(!staff || !WA_SID || !WA_KINDS.has(n.kind) || !(p?.whatsapp || p?.phone)){ patch.whatsapp_sent_at = now(); }
      else {
        const r = await sendWhatsApp(WA_SID, WA_V2, p.whatsapp || p.phone, n.kind, n.title, n.body, WA_CARD);
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
