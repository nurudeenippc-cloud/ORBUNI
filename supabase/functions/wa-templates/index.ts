// Orbuni WhatsApp — creates the message templates in Twilio, submits them to Meta
// for approval, and keeps public.wa_templates in step with Meta's decision.
// Called by pg_cron (x-orb-secret) — safe to run any number of times: a template
// that already exists is only re-checked, never duplicated.
// {{1}} is always the student's first name.
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
export const TEMPLATES: { key: string; category: "UTILITY" | "MARKETING"; body: string }[] = [
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
];

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
        body: JSON.stringify({ friendly_name: t.key, language: "en", variables: { "1": "Aisha" }, types: { "twilio/text": { body: t.body } } }),
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
