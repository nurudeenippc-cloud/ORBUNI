// Orbuni — WhatsApp side of the webinar (Scholarship 1.0). Called with x-orb-secret:
//   { kind:"reg", id }   by webinar_register()  → the seat link, seconds after signing up
//   { kind:"vip", id }   by webinar_make_vip()  → VIP confirmed
//   {}                   by pg_cron every 10 min → reminders (1 day, 1 hour), "we are live",
//                         after the webinar (came → assessment link; missed → replay) and an
//                         unfinished VIP payment (1–48 h after it was started)
// The emails follow the same rules in public.queue_webinar_followups().
// Each message goes out once (public.wa_followups.dedupe_key), only with a Meta-approved
// template, only to people who ticked the consent box, never after STOP. Reminders and
// "live" are tied to the webinar time and always go; the rest wait for 07–19 UTC.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendRich } from "./wa.ts";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const CRON = env("ORB_CRON_SECRET");
const TW_SID = env("TWILIO_ACCOUNT_SID"), TW_TOKEN = env("TWILIO_AUTH_TOKEN");
const WA_FROM = env("TWILIO_WHATSAPP_FROM") || "whatsapp:+14434481577";
const WEBHOOK = "https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/wa-webhook";
const SITE = "https://myorbuni.com";
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const MIN = 60e3, H = 3600e3;

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
async function twilio(to: string, contentSid: string, vars: Record<string, string>) {
  const form = new URLSearchParams({ From: WA_FROM, To: "whatsapp:" + to, StatusCallback: WEBHOOK, ContentSid: contentSid, ContentVariables: JSON.stringify(vars) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
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

const seat = (r: any) => `${SITE}/s/${r.token}`;
function whenText(iso: string) {
  const d = new Date(iso), f = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...o }).format(d);
  return `${f("Africa/Lagos", { weekday: "short", day: "numeric", month: "short" })}, ${f("Africa/Lagos", { hour: "2-digit", minute: "2-digit" })} WAT (${f("Europe/Istanbul", { hour: "2-digit", minute: "2-digit" })} Türkiye)`;
}
const fill = (body: string, vars: Record<string, string>) => body.replace(/\{\{(\d+)\}\}/g, (_m, k) => vars[k] ?? "");

Deno.serve(async (req) => {
  if (!CRON || req.headers.get("x-orb-secret") !== CRON) return json(403, { error: "forbidden" });
  const body = await req.json().catch(() => ({}));
  const { data: tpls } = await db.from("wa_templates").select("key,content_sid,approval,body").like("key", "orbuni_webinar_%");
  const T: Record<string, any> = {}; for (const t of tpls || []) if (t.approval === "approved" && t.content_sid) T[t.key] = t;

  // rich: inside the 24-hour window send this media-library item with buttons instead of the template
  type Job = { r: any; tpl: string; key: string; vars: Record<string, string>; anyHour?: boolean; rich?: { media: string; body: string; btn: string } };
  const jobs: Job[] = [];
  const sel = "id,token,name,phone,country,consent,ticket,vip_checkout_at,attended_at,lead_id,created_at,utm_campaign,webinars(title,starts_at,duration_min,replay_url)";

  if (body.kind === "reg" || body.kind === "vip") {
    const { data: r } = await db.from("webinar_registrations").select(sel).eq("id", String(body.id || "")).maybeSingle();
    if (!r) return json(200, { skipped: "no registration" });
    const w: any = (r as any).webinars;
    // saved with one tap inside WhatsApp: the chat reply already carried the seat link
    if (body.kind === "reg" && r.utm_campaign === "wa_one_tap") return json(200, { skipped: "registered in the WhatsApp chat" });
    if (body.kind === "reg") jobs.push({ r, tpl: "orbuni_webinar_seat", key: `web:wa:reg:${r.id}`, vars: { "1": first(r.name), "2": whenText(w.starts_at), "3": seat(r) }, anyHour: true });
    else jobs.push({ r, tpl: "orbuni_webinar_vip", key: `web:wa:vip:${r.id}`, vars: { "1": first(r.name), "2": seat(r) }, anyHour: true });
  } else {
    const { data: rows } = await db.from("webinar_registrations").select(sel)
      .gte("created_at", new Date(Date.now() - 60 * 24 * H).toISOString()).limit(2000);
    const now = Date.now();
    for (const r of rows || []) {
      const w: any = (r as any).webinars; if (!w) continue;
      const st = Date.parse(w.starts_at), end = st + (w.duration_min || 90) * MIN, n = first(r.name);
      if (now >= st - 26 * H && now <= st - 20 * H)
        jobs.push({ r, tpl: "orbuni_webinar_reminder", key: `web:wa:rem1d:${r.id}`, vars: { "1": n, "2": "tomorrow, " + whenText(w.starts_at), "3": seat(r) }, anyHour: true });
      if (now >= st - 75 * MIN && now <= st - 20 * MIN)
        jobs.push({ r, tpl: "orbuni_webinar_reminder", key: `web:wa:rem1h:${r.id}`, vars: { "1": n, "2": "in about one hour", "3": seat(r) }, anyHour: true });
      if (now >= st - 5 * MIN && now <= st + 25 * MIN && !r.attended_at)
        jobs.push({ r, tpl: "orbuni_webinar_live", key: `web:wa:live:${r.id}`, vars: { "1": n, "2": seat(r) }, anyHour: true });
      if (now > end + 30 * MIN && now < end + 5 * 24 * H) {
        if (r.attended_at) jobs.push({ r, tpl: "orbuni_webinar_next", key: `web:wa:next:${r.id}`, vars: { "1": n, "2": `${SITE}/quiz` } });
        else if (w.replay_url) jobs.push({ r, tpl: "orbuni_webinar_replay", key: `web:wa:replay:${r.id}`, vars: { "1": n, "2": seat(r) } });
      }
      // the VIP video, once, 2–72 hours after a free seat was saved (never to someone who already started paying)
      if (r.ticket === "free" && !r.vip_checkout_at && now >= Date.parse(r.created_at) + 2 * H && now <= Date.parse(r.created_at) + 72 * H && now < st)
        jobs.push({ r, tpl: "orbuni_webinar_vip_vid", key: `web:wa:vipvid:${r.id}`, vars: { "1": n, "2": r.token },
          rich: { media: "vip_offer", btn: "Get VIP · $10",
            body: `${n}, your free seat is saved. Want a head start before the webinar? This 30-second video shows what the $10 VIP seat adds. Your free seat stays either way.` } });
      if (r.ticket === "free" && r.vip_checkout_at) {
        const t = Date.parse(r.vip_checkout_at);
        if (now >= t + H && now <= t + 48 * H) jobs.push({ r, tpl: "orbuni_webinar_vip_unpaid", key: `web:wa:vipunpaid:${r.id}`, vars: { "1": n, "2": seat(r) } });
      }
    }
  }

  const hour = new Date().getUTCHours(), quiet = hour < 7 || hour >= 19;
  const sent: string[] = [], skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };
  for (const j of jobs) {
    if (sent.length >= 60) { skip("run limit"); continue; }
    if (!j.r.consent) { skip("no consent"); continue; }
    if (quiet && !j.anyHour) { skip("quiet hours"); continue; }
    const phone = intl(j.r.phone, j.r.country);
    if (!phone) { skip("no usable number"); continue; }
    if (j.rich) {
      // inside the 24-hour window: the video + button as a normal chat message (no template needed)
      const { data: c } = await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
      const open = c && !c.opted_out && c.last_inbound_at && Date.parse(c.last_inbound_at) > Date.now() - 23 * H;
      if (open) {
        const { data: m } = await db.from("wa_media").select("key,kind,url").eq("key", j.rich.media).eq("active", true).maybeSingle();
        const { data: prev } = await db.from("wa_messages").select("id").eq("contact_id", c.id).contains("media", [{ name: j.rich.media }]).limit(1);
        if (!m) { skip("media missing"); continue; }
        if (prev && prev.length) { skip("video already sent in chat"); continue; }
        const claim = await db.from("wa_followups").insert({ contact_id: c.id, trigger: "webinar", dedupe_key: j.key, status: "sending" });
        if (claim.error) { skip("already sent"); continue; }
        const res = await sendRich(db as any, c, { author: "system", body: j.rich.body, link: { title: j.rich.btn, url: `${SITE}/v/${j.r.token}` }, media: { key: m.key, kind: m.kind, url: m.url } });
        await db.from("wa_followups").update({ status: res.ok ? "sent" : "failed: " + String(res.error || "").slice(0, 200) }).eq("dedupe_key", j.key);
        if (res.ok) sent.push(j.key); else skip("Twilio refused");
        continue;
      }
    }
    if (!T[j.tpl]) { skip("template not approved yet"); continue; }
    const t = T[j.tpl];
    const res = await waOnce(phone, first(j.r.name), j.key, "webinar", { lead_id: j.r.lead_id || undefined },
      () => twilio(phone, t.content_sid, j.vars), fill(String(t.body), j.vars), j.tpl);
    if (res === "sent") sent.push(j.key); else skip(res.startsWith("failed") ? "Twilio refused" : res);
  }
  return json(200, { candidates: jobs.length, sent: sent.length, skipped });
});
