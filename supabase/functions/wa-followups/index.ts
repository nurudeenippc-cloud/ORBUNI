// Orbuni WhatsApp — automatic follow-ups (pg_cron, hourly). Each one uses a
// Meta-approved template and goes out once only (public.wa_followups.dedupe_key).
//   quiz      — took the study assessment 20 min–2 days ago and left a number
//   payment   — started a service checkout 2 h–3 days ago and didn't pay
//   documents — signed up 2+ days ago, file incomplete (at most once a week)
//   offer     — an application moved to "offer received" in the last 2 days
//   checkin   — wrote to us 14 days ago and has been silent since
// Never: outside 07–19 UTC, to anyone who sent STOP, to a chat active in the
// last 24 h, or before Meta approved the template. Also warns the team when
// the Twilio balance drops under $5.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sb, json, sendAndLog, alertStaff } from "./wa.ts";

const CRON = (Deno.env.get("ORB_CRON_SECRET") ?? "").trim();
const SID = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
const TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
const MAX_PER_RUN = 40;
const H = 3600e3;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

// Only numbers written with a country code are usable ("+234…" or "00234…").
function intl(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!/^(\+|00)/.test(s)) return "";
  const d = s.replace(/^00/, "").replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? "+" + d : "";
}
const first = (n: string | null | undefined) => (String(n || "").trim().split(/\s+/)[0] || "there").slice(0, 40);

Deno.serve(async (req) => {
  if (!CRON || (req.headers.get("x-orb-secret") || "") !== CRON) return json(403, { error: "forbidden" });
  const db = sb();
  const out: Record<string, unknown> = {};

  // ---- Twilio balance warning (once a day)
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Balance.json`, { headers: { Authorization: "Basic " + btoa(SID + ":" + TOKEN) } });
    const b = await r.json();
    const bal = Number(b.balance);
    out.balance = bal;
    if (Number.isFinite(bal) && bal < 5) {
      await alertStaff(db, `Twilio balance is low: $${bal.toFixed(2)}`,
        `The WhatsApp number's prepaid balance is $${bal.toFixed(2)}. When it reaches $0, WhatsApp messages (and the AI replies) stop.\n\nTop up: console.twilio.com → Billing → Add funds ($20 is enough for a few thousand messages).`,
        `wa-balance:${new Date().toISOString().slice(0, 10)}`);
    }
  } catch { /* balance check is best-effort */ }

  const hour = new Date().getUTCHours();
  if (hour < 7 || hour >= 19) return json(200, { ...out, skipped: "quiet hours" });

  const { data: tpls } = await db.from("wa_templates").select("key,content_sid,approval,body");
  const T: Record<string, any> = {};
  for (const t of tpls || []) if (t.approval === "approved" && t.content_sid) T[t.key] = t;
  if (!Object.keys(T).length) return json(200, { ...out, skipped: "no approved templates yet" });

  type Job = { trigger: string; key: string; tpl: string; phone: string; name: string; profile_id?: string | null; lead_id?: string | null };
  const jobs: Job[] = [];

  if (T.orbuni_quiz_followup) {
    const { data } = await db.from("leads").select("id,name,phone,student_id").not("quiz", "is", null)
      .gte("created_at", ago(48 * H)).lte("created_at", ago(20 * 60e3)).limit(200);
    for (const l of data || []) jobs.push({ trigger: "quiz", key: `quiz:${l.id}`, tpl: "orbuni_quiz_followup", phone: intl(l.phone), name: first(l.name), lead_id: l.id, profile_id: l.student_id });
  }
  if (T.orbuni_payment_help) {
    const { data } = await db.from("student_orders").select("id,profile_id,status,paid_at,profiles(first_name,phone,whatsapp)")
      .is("paid_at", null).not("status", "in", "(paid,cancelled,canceled,refunded)")
      .gte("created_at", ago(72 * H)).lte("created_at", ago(2 * H)).limit(200);
    for (const o of data || []) {
      const p: any = (o as any).profiles || {};
      jobs.push({ trigger: "payment", key: `pay:${o.id}`, tpl: "orbuni_payment_help", phone: intl(p.whatsapp) || intl(p.phone), name: first(p.first_name), profile_id: o.profile_id });
    }
  }
  if (T.orbuni_documents_needed) {
    const { data } = await db.from("student_readiness").select("profile_id,first_name,phone,whatsapp,has_photo,has_passport,personal_done,choice_count,joined_at")
      .lte("joined_at", ago(48 * H)).gte("joined_at", ago(30 * 24 * H)).limit(300);   // weekly, for their first month only
    const week = Math.floor(Date.now() / (7 * 24 * H));
    for (const r of data || []) {
      if (r.has_photo && r.has_passport && r.personal_done && Number(r.choice_count) > 0) continue;
      jobs.push({ trigger: "documents", key: `docs:${r.profile_id}:${week}`, tpl: "orbuni_documents_needed", phone: intl(r.whatsapp) || intl(r.phone), name: first(r.first_name), profile_id: r.profile_id });
    }
  }
  if (T.orbuni_offer_ready) {
    const { data } = await db.from("application_events").select("application_id,applications(profile_id,profiles(first_name,phone,whatsapp))")
      .eq("to_status", "offer_received").gte("at", ago(48 * H)).limit(200);
    for (const e of data || []) {
      const a: any = (e as any).applications || {}; const p: any = a.profiles || {};
      jobs.push({ trigger: "offer", key: `offer:${e.application_id}`, tpl: "orbuni_offer_ready", phone: intl(p.whatsapp) || intl(p.phone), name: first(p.first_name), profile_id: a.profile_id });
    }
  }
  if (T.orbuni_checkin) {
    const { data } = await db.from("wa_contacts").select("id,phone,wa_name,profile_id,lead_id,last_inbound_at")
      .eq("opted_out", false).gte("last_inbound_at", ago(15 * 24 * H)).lte("last_inbound_at", ago(14 * 24 * H)).limit(200);
    for (const c of data || []) jobs.push({ trigger: "checkin", key: `checkin:${c.id}:${String(c.last_inbound_at).slice(0, 10)}`, tpl: "orbuni_checkin", phone: c.phone, name: first(c.wa_name), profile_id: c.profile_id, lead_id: c.lead_id });
  }

  const sent: string[] = [], skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };
  for (const j of jobs) {
    if (sent.length >= MAX_PER_RUN) { skip("run limit"); continue; }
    if (!j.phone) { skip("no number with country code"); continue; }
    const { data: done } = await db.from("wa_followups").select("id").eq("dedupe_key", j.key).maybeSingle();
    if (done) { skip("already sent"); continue; }

    let { data: c } = await db.from("wa_contacts").select("*").eq("phone", j.phone).maybeSingle();
    if (c?.opted_out) { skip("sent STOP"); continue; }
    if (c?.last_message_at && Date.parse(c.last_message_at) > Date.now() - 24 * H) { skip("chat active"); continue; }
    if (!c) {
      c = (await db.from("wa_contacts").insert({ phone: j.phone, wa_name: j.name !== "there" ? j.name : null, profile_id: j.profile_id || null, lead_id: j.lead_id || null }).select("*").single()).data;
      if (!c) { skip("could not create chat"); continue; }
    }
    // claim the key first so two overlapping runs can't both send
    const claim = await db.from("wa_followups").insert({ contact_id: c.id, trigger: j.trigger, dedupe_key: j.key, status: "sending" });
    if (claim.error) { skip("already sent"); continue; }
    const t = T[j.tpl];
    const res = await sendAndLog(db, c, { author: "template", contentSid: t.content_sid, vars: { "1": j.name }, templateKey: j.tpl, preview: String(t.body).split("{{1}}").join(j.name) });
    await db.from("wa_followups").update({ status: res.ok ? "sent" : "failed: " + (res.error || "").slice(0, 200) }).eq("dedupe_key", j.key);
    if (res.ok) sent.push(j.key); else skip("Twilio refused");
  }
  return json(200, { ...out, candidates: jobs.length, sent: sent.length, skipped });
});
