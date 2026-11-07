// Orbuni — the first reply, within seconds (not the next hourly run).
// Called by database triggers (x-orb-secret) the moment:
//   { kind:"lead", id }  someone finishes the assessment and leaves a number/email
//   { kind:"call", id }  someone books a free call
// For a new lead it sends, at once and only once:
//   • WhatsApp — the approved assessment template with tap-to-reply buttons
//     (and the "required documents" template once Meta approves it). When they
//     reply, the WhatsApp AI takes over, knowing who they are and where they stopped.
//   • Email — written for the student, the parent or the helper: their result,
//     the right Required Documents PDF for their level, and the next step.
// For a booked call: a WhatsApp with the time and the Google Meet link (the
// email and the Google Calendar invitation are already sent by book-call).
// Never twice (public.wa_followups.dedupe_key, email_outbox.dedupe_key); never to
// anyone who sent STOP.
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const CRON = env("ORB_CRON_SECRET");
const TW_SID = env("TWILIO_ACCOUNT_SID"), TW_TOKEN = env("TWILIO_AUTH_TOKEN");
const WA_FROM = env("TWILIO_WHATSAPP_FROM") || "whatsapp:+14434481577";
const WEBHOOK = "https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/wa-webhook";
const SITE = "https://myorbuni.com";
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

// country calling codes, so a local "0803…" number still reaches WhatsApp
const CC: Record<string, string> = { Nigeria: "234", Ghana: "233", Kenya: "254", Cameroon: "237", Uganda: "256", Tanzania: "255", Ethiopia: "251",
  "Sierra Leone": "232", Liberia: "231", "The Gambia": "220", Senegal: "221", "South Africa": "27", Zambia: "260", Zimbabwe: "263", Rwanda: "250",
  Sudan: "249", Somalia: "252", Egypt: "20", Morocco: "212", Algeria: "213", Tunisia: "216", Libya: "218", Pakistan: "92", Bangladesh: "880",
  India: "91", Afghanistan: "93", Iraq: "964", Iran: "98", Syria: "963", Jordan: "962", Yemen: "967", Azerbaijan: "994", Kazakhstan: "7",
  Uzbekistan: "998", Turkmenistan: "993", Kyrgyzstan: "996" };
function intl(raw: string | null | undefined, country?: string | null): string {
  const s = String(raw || "").trim(); if (!s) return "";
  let d = s.replace(/\D/g, "");
  if (/^(\+|00)/.test(s)) d = d.replace(/^00/, "");
  else if (country && CC[country]) d = CC[country] + d.replace(/^0+/, "");
  else return "";
  return d.length >= 10 && d.length <= 15 ? "+" + d : "";
}
const first = (n: string | null | undefined) => (String(n || "").trim().split(/\s+/)[0] || "there").slice(0, 40);
const LEVEL: Record<string, [string, string]> = { bachelors: ["bachelor's degree", "Bachelors"], masters: ["master's degree", "Masters"], phd: ["PhD", "Phd"] };

// Poster templates ("_card") take the poster's file name as their last variable: one of three
// designs, picked per person and day (same rule as variant() in send-student-emails/brand.ts).
function posterVars(key: string, vars: Record<string, string>, seed: string): Record<string, string> {
  if (!key.endsWith("_card")) return vars;
  const img = key.replace(/^orbuni_|_card$/g, "").replace("application_update", "offer_ready");
  let h = 0; for (const c of img + "|" + seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const n = String(Math.max(...Object.keys(vars).map(Number)) + 1);
  return { ...vars, [n]: `${img}_${1 + ((h + Math.floor(Date.now() / 864e5)) % 3)}.jpg` };
}
async function twilio(to: string, contentSid: string, vars: Record<string, string>) {
  const form = new URLSearchParams({ From: WA_FROM, To: "whatsapp:" + to, StatusCallback: WEBHOOK, ContentSid: contentSid, ContentVariables: JSON.stringify(vars) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { signal: AbortSignal.timeout(20000),
    method: "POST", headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, sid: j.sid as string, status: j.status as string } : { ok: false, error: `${j.code || r.status}: ${j.message || "refused"}` };
}
async function twilioText(to: string, body: string) {
  const form = new URLSearchParams({ From: WA_FROM, To: "whatsapp:" + to, StatusCallback: WEBHOOK, Body: body.slice(0, 1500) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, { signal: AbortSignal.timeout(20000),
    method: "POST", headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, sid: j.sid as string, status: j.status as string } : { ok: false, error: `${j.code || r.status}: ${j.message || "refused"}` };
}

// one WhatsApp message, once: claim the key, send, log in the inbox like every other message
async function waOnce(phone: string, name: string, key: string, trigger: string, links: { lead_id?: string; profile_id?: string | null },
  send: () => Promise<{ ok: boolean; sid?: string; status?: string; error?: string }>, preview: string, templateKey: string | null) {
  let { data: c } = await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
  if (c?.opted_out) return "opted out";
  if (!c) c = (await db.from("wa_contacts").insert({ phone, wa_name: name !== "there" ? name : null, lead_id: links.lead_id || null, profile_id: links.profile_id || null }).select("*").single()).data;
  if (!c) return "no chat";
  const claim = await db.from("wa_followups").insert({ contact_id: c.id, trigger, dedupe_key: key, status: "sending" });
  if (claim.error) return "already sent";
  const res = await send();
  await db.from("wa_messages").insert({ contact_id: c.id, direction: "out", author: templateKey ? "template" : "system", body: preview, template_key: templateKey,
    twilio_sid: res.sid || null, status: res.ok ? (res.status || "queued") : "failed", error: res.ok ? null : res.error });
  await db.from("wa_contacts").update({ last_message_at: new Date().toISOString(), last_preview: preview.slice(0, 120),
    lead_id: c.lead_id || links.lead_id || null }).eq("id", c.id);
  await db.from("wa_followups").update({ status: res.ok ? "sent" : "failed: " + String(res.error || "").slice(0, 200) }).eq("dedupe_key", key);
  return res.ok ? "sent" : "failed: " + res.error;
}

Deno.serve(async (req) => {
  if (!CRON || req.headers.get("x-orb-secret") !== CRON) return json(403, { error: "forbidden" });
  const body = await req.json().catch(() => ({}));
  const { data: tpls } = await db.from("wa_templates").select("key,content_sid,approval,body");
  const T: Record<string, any> = {}; for (const t of tpls || []) if (t.approval === "approved" && t.content_sid) T[t.key] = t;
  const out: Record<string, unknown> = {};

  if (body.kind === "lead") {
    const { data: l } = await db.from("leads").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (!l) return json(200, { skipped: "no lead" });
    const q = (l.quiz || {}) as any;
    const role = q.role || q.who || "student";
    const lvl = LEVEL[q.level] ? q.level : "bachelors";
    const name = first(l.name), student = q.student_name ? first(q.student_name) : "";
    const path = l.pathway || "medium";
    const pdf = `${SITE}/docs/Orbuni-Required-Documents-${LEVEL[lvl][1]}.pdf`;
    const { data: flag } = await db.from("app_flags").select("on_off").eq("key", "student_signups_open").maybeSingle();
    const open = !(flag && flag.on_off === false);

    // ---- WhatsApp, straight away
    const phone = intl(l.phone, l.country);
    if (!phone) out.whatsapp = "no usable number";
    else {
      const tk = T.orbuni_quiz_followup_btn ? "orbuni_quiz_followup_btn" : T.orbuni_quiz_followup ? "orbuni_quiz_followup" : "";
      if (tk) out.whatsapp = await waOnce(phone, name, `quiz:${l.id}`, "quiz", { lead_id: l.id, profile_id: l.student_id },
        () => twilio(phone, T[tk].content_sid, { "1": name }), String(T[tk].body).split("{{1}}").join(name), tk);
      // the poster version once Meta approves it (its button holds https://myorbuni.com/, so {{3}} is the rest)
      const docsKey = T.orbuni_required_docs_card ? "orbuni_required_docs_card" : T.orbuni_required_docs ? "orbuni_required_docs" : "";
      if (docsKey && path !== "lower") {
        const lv = LEVEL[lvl][0];
        const v3 = docsKey.endsWith("_card") ? pdf.slice(SITE.length + 1) : pdf;
        out.whatsapp_docs = await waOnce(phone, name, `docs_pdf:${l.id}`, "documents", { lead_id: l.id, profile_id: l.student_id },
          () => twilio(phone, T[docsKey].content_sid, posterVars(docsKey, { "1": name, "2": lv, "3": v3 }, phone)),
          String(T[docsKey].body).split("{{1}}").join(name).split("{{2}}").join(lv).split("{{3}}").join(pdf), docsKey);
      }
    }

    // ---- email, written for who they are
    if (l.email && /@/.test(l.email)) {
      const forWho = role === "parent" ? (student ? student : "your child") : role === "helper" ? (student ? student : "the student") : "you";
      const poss = role === "parent" ? (student ? student + "'s" : "your child's") : role === "helper" ? (student ? student + "'s" : "the student's") : "your";
      const lv = LEVEL[lvl][0];
      const verdict = path === "higher" ? (role === "student" ? "you are ready to apply" : `${forWho} is ready to apply`)
        : path === "medium" ? (role === "student" ? "you are close — a few things still need to fall into place" : `${forWho} is close — a few things still need to fall into place`)
        : (role === "student" ? "you are at the start — the best time to learn how it really works" : `${forWho} is at the start — the best time to learn how it really works`);
      const lines: string[] = [];
      lines.push(`Hi ${name},`, "");
      lines.push(`Thank you for taking the Orbuni assessment${role !== "student" && student ? " for " + student : ""}. Your result: ${verdict}.`, "");
      if (path !== "lower") {
        lines.push(`1. Get the documents ready. Here is the full checklist for a ${lv} — view it, screenshot it or download it:`, pdf, "");
        lines.push(open
          ? `2. Start ${poss} application — it's free, and you only pay our service fee after a university sends the offer letter: ${SITE}/#signup`
          : `2. Most universities have closed applications for this intake. ${poss.charAt(0).toUpperCase() + poss.slice(1)} place is on our priority list: we'll message you the moment applications open for the next one, so it can go in on day one.`, "");
        lines.push("3. Prefer to talk first? Reply to this email or message us on WhatsApp (+1 443 448 1577) and we'll book a free call with Nurudeen or Godfrey on Google Meet.", "");
      } else {
        lines.push("Your next step: join our free WhatsApp community for deadlines, scholarship news and answers, and if you'd like the whole process explained in one evening, the $10 Scholarship Masterclass:", `${SITE}/?buy=masterclass#start`, "");
        lines.push(`When you're ready, this is the document checklist for a ${lv}: ${pdf}`, "");
      }
      lines.push(role === "parent"
        ? "A note for parents: tuition is always paid directly to the university, never to Orbuni or to a person, and every fee and scholarship is shown to you in writing before anything is paid."
        : "Tuition is always paid directly to the university — never to Orbuni or to a person.", "", "The Orbuni team", "Istanbul, Türkiye · myorbuni.com");
      const subject = role === "student" ? (path === "lower" ? "Your Orbuni result and your next step" : "Your Orbuni result + the documents you need")
        : role === "parent" ? `${student ? student + "'s" : "Your child's"} Orbuni result + the documents needed`
        : `${student ? student + "'s" : "The"} Orbuni result + the documents needed`;
      const ins = await db.from("email_outbox").insert({ to_email: String(l.email).toLowerCase(), template: "custom_notice",
        vars: { subject, body: lines.join("\n"), first_name: name }, dedupe_key: `lead_instant:${l.id}` });
      out.email = ins.error ? (/duplicate/.test(ins.error.message) ? "already sent" : ins.error.message) : "queued";
    } else out.email = "no email";
    await db.from("lead_events").insert({ lead_id: l.id, kind: "note", body: `First reply sent automatically — WhatsApp: ${out.whatsapp ?? "-"}; email: ${out.email}` }).then(() => {}, () => {});
    return json(200, out);
  }

  if (body.kind === "call") {
    const { data: b } = await db.from("call_bookings").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (!b) return json(200, { skipped: "no booking" });
    let country: string | null = null;
    if (b.lead_id) { const { data: l } = await db.from("leads").select("country").eq("id", b.lead_id).maybeSingle(); country = l?.country ?? null; }
    const phone = intl(b.phone, country); const name = first(b.name);
    if (!phone) return json(200, { whatsapp: "no usable number" });
    const when = new Date(b.starts_at).toLocaleString("en-GB", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const link = b.join_url || `${SITE}`;
    const text = `Hi ${name}, your free call with Orbuni is booked for ${when} (Türkiye time).` + (b.join_url ? ` Join with this Google Meet link: ${b.join_url}` : " We'll send you the video link shortly.") + " Reply here if you need to change the time.";
    // the poster version needs a Google Meet link (its button is https://meet.google.com/{{3}})
    const MEET = "https://meet.google.com/";
    const callKey = T.orbuni_call_booked_card && String(b.join_url || "").startsWith(MEET) ? "orbuni_call_booked_card" : "orbuni_call_booked";
    if (T[callKey] && b.join_url) {
      const v3 = callKey.endsWith("_card") ? link.slice(MEET.length) : link;
      out.whatsapp = await waOnce(phone, name, `call:${b.id}`, "call", { lead_id: b.lead_id, profile_id: b.profile_id },
        () => twilio(phone, T[callKey].content_sid, posterVars(callKey, { "1": name, "2": when, "3": v3 }, phone)), text, callKey);
    } else {
      // without the approved template, free text only reaches people who wrote to us in the last 24 h
      const { data: c } = await db.from("wa_contacts").select("last_inbound_at").eq("phone", phone).maybeSingle();
      if (c?.last_inbound_at && Date.parse(c.last_inbound_at) > Date.now() - 23.5 * 3600e3)
        out.whatsapp = await waOnce(phone, name, `call:${b.id}`, "call", { lead_id: b.lead_id, profile_id: b.profile_id }, () => twilioText(phone, text), text, null);
      else out.whatsapp = "waiting for the call template to be approved (email + calendar invite already sent)";
    }
    return json(200, out);
  }
  return json(400, { error: "kind?" });
});
