// Orbuni WhatsApp — creates the message templates in Twilio, submits them to Meta
// for approval, and keeps public.wa_templates in step with Meta's decision.
// Called by pg_cron (x-orb-secret) — safe to run any number of times: a template
// that already exists is only re-checked, never duplicated.
// {{1}} is the student's first name, except in orbuni_staff_alert (sent to the team:
// {{1}} what happened, {{2}} the details).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = () => createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SID = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
const TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
const CRON = (Deno.env.get("ORB_CRON_SECRET") ?? "").trim();
const AUTH = { Authorization: "Basic " + btoa(SID + ":" + TOKEN) };

// Keep these short and factual: Meta rejects pushy or vague marketing wording,
// and "utility" templates (about something the student already started) are cheaper.
type Btn = { title: string; id?: string; url?: string };
export const TEMPLATES: { key: string; category: "UTILITY" | "MARKETING"; body: string; vars?: Record<string, string>; quick?: Btn[]; link?: Btn }[] = [
  { key: "orbuni_welcome", category: "UTILITY",
    body: "Hi {{1}}, this is Orbuni. Thanks for your interest in studying in Türkiye. Reply here with any question about universities, fees or scholarships and we will help you. Reply STOP to opt out." },
  { key: "orbuni_quiz_followup", category: "MARKETING",
    body: "Hi {{1}}, thanks for taking the Orbuni study assessment. Would you like help choosing a university and applying for a scholarship? Reply YES and we will guide you. Reply STOP to opt out." },
  { key: "orbuni_payment_help", category: "UTILITY",
    body: "Hi {{1}}, it looks like your Orbuni checkout was not completed and nothing was charged. If something went wrong with the payment, reply here and we will help you finish. Reply STOP to opt out." },
  { key: "orbuni_documents_needed", category: "UTILITY",
    body: "Hi {{1}}, your Orbuni application is waiting for one or more documents. Please log in at myorbuni.com and upload them under Documents so we can send your file to the university. Reply here if you need help." },
  { key: "orbuni_offer_ready", category: "UTILITY",
    body: "Hi {{1}}, good news: there is an update on your university application. Please log in at myorbuni.com to see it, and reply here if you have any questions." },
  { key: "orbuni_checkin", category: "MARKETING",
    body: "Hi {{1}}, it is Orbuni checking in. Are you still planning to study in Türkiye? Reply here with any question and we will help with your next step. Reply STOP to opt out." },
  { key: "orbuni_team_reply", category: "UTILITY",
    body: "Hi {{1}}, this is the Orbuni team following up on your message. Reply here and we will continue where we left off." },
  { key: "orbuni_staff_alert", category: "UTILITY",
    body: "Orbuni team alert: {{1}}. Details: {{2}}. Open the Orbuni portal to see it and take action.",
    vars: { "1": "Call booked with Aisha Bello", "2": "Mon 6 Oct, 14:00 Turkiye time with Nurudeen" } },
  // Button versions: wa-followups uses "<key>_btn" once Meta approves it, and the plain one until then.
  { key: "orbuni_quiz_followup_btn", category: "MARKETING",
    body: "Hi {{1}}, thanks for taking the Orbuni study assessment. Would you like help choosing a university and applying for a scholarship?",
    quick: [{ title: "Yes, help me", id: "YES" }, { title: "Not now", id: "LATER" }, { title: "Stop messages", id: "STOP" }] },
  { key: "orbuni_checkin_btn", category: "MARKETING",
    body: "Hi {{1}}, it is Orbuni checking in. Are you still planning to study in Türkiye?",
    quick: [{ title: "Yes, still planning", id: "YES" }, { title: "Maybe later", id: "LATER" }, { title: "Stop messages", id: "STOP" }] },
  { key: "orbuni_payment_help_btn", category: "UTILITY",
    body: "Hi {{1}}, it looks like your Orbuni checkout was not completed and nothing was charged. Would you like help finishing it?",
    quick: [{ title: "Help me pay", id: "PAY_HELP" }, { title: "I will do it later", id: "LATER" }] },
  { key: "orbuni_documents_needed_btn", category: "UTILITY",
    body: "Hi {{1}}, your Orbuni application is waiting for one or more documents. Please upload them in your portal under Documents so we can send your file to the university.",
    link: { title: "Upload documents", url: "https://myorbuni.com/" } },
  { key: "orbuni_offer_ready_btn", category: "UTILITY",
    body: "Hi {{1}}, good news: there is an update on your university application. Open your portal to see it, and reply here if you have any questions.",
    link: { title: "See the update", url: "https://myorbuni.com/" } },
  { key: "orbuni_welcome_btn", category: "UTILITY",
    body: "Hi {{1}}, this is Orbuni. Thanks for your interest in studying in Türkiye. Start with the free 2-minute assessment, or reply here with any question about universities, fees or scholarships.",
    link: { title: "Free assessment", url: "https://myorbuni.com/#start" } },
  // 8 Oct 2026: sent seconds after the assessment / a booked call (lead-instant)
  { key: "orbuni_required_docs", category: "UTILITY",
    body: "Hi {{1}}, thank you for completing the Orbuni assessment. Here is the checklist of documents needed for a {{2}} application: {{3}} Keep it handy and reply here if you have any questions.",
    vars: { "1": "Aisha", "2": "bachelor's degree", "3": "https://myorbuni.com/docs/Orbuni-Required-Documents-Bachelors.pdf" } },
  { key: "orbuni_call_booked", category: "UTILITY",
    body: "Hi {{1}}, your free call with Orbuni is booked for {{2}} (Türkiye time). Join with this Google Meet link: {{3}} Reply here if you need to change the time.",
    vars: { "1": "Aisha", "2": "Mon 13 Oct, 14:00", "3": "https://meet.google.com/abc-defg-hij" } },
];
function typesFor(t: typeof TEMPLATES[number]) {
  if (t.quick) return { "twilio/quick-reply": { body: t.body, actions: t.quick.map((q) => ({ title: q.title, id: q.id || q.title })) } };
  if (t.link) return { "twilio/call-to-action": { body: t.body, actions: [{ type: "URL", title: t.link.title, url: t.link.url }] } };
  return { "twilio/text": { body: t.body } };
}

async function tw(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

Deno.serve(async (req) => {
  if ((req.headers.get("x-orb-secret") || "") !== CRON || !CRON) return json(403, { error: "forbidden" });
  const db = sb();
  const { data: rows } = await db.from("wa_templates").select("*");
  const have: Record<string, any> = {};
  for (const r of rows || []) have[r.key] = r;
  const report: any[] = [];

  for (const t of TEMPLATES) {
    let row = have[t.key];
    // 1. create the content in Twilio once
    if (!row?.content_sid) {
      const c = await tw("https://content.twilio.com/v1/Content", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendly_name: t.key, language: "en", variables: t.vars || { "1": "Aisha" }, types: typesFor(t) }),
      });
      if (!c.ok) { report.push({ key: t.key, step: "create", error: c.j.message || c.status }); continue; }
      row = { key: t.key, content_sid: c.j.sid, approval: "not_submitted", body: t.body };
      await db.from("wa_templates").upsert({ ...row, updated_at: new Date().toISOString() });
    }
    // 2. submit to Meta once
    if (row.approval === "not_submitted") {
      const s = await tw(`https://content.twilio.com/v1/Content/${row.content_sid}/ApprovalRequests/whatsapp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t.key, category: t.category }),
      });
      if (!s.ok) { report.push({ key: t.key, step: "submit", error: s.j.message || s.status }); continue; }
      row.approval = "received";
      await db.from("wa_templates").update({ approval: "received", updated_at: new Date().toISOString() }).eq("key", t.key);
    }
    // 3. read Meta's decision
    const a = await tw(`https://content.twilio.com/v1/Content/${row.content_sid}/ApprovalRequests`);
    const st = String(a.j?.whatsapp?.status || row.approval || "").toLowerCase();
    const why = a.j?.whatsapp?.rejection_reason || null;
    if (st && st !== row.approval) {
      await db.from("wa_templates").update({ approval: st, updated_at: new Date().toISOString() }).eq("key", t.key);
    }
    report.push({ key: t.key, approval: st, ...(why ? { why } : {}) });
  }
  return json(200, { templates: report });
});
