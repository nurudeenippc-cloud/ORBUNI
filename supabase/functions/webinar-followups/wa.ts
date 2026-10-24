// Orbuni WhatsApp — shared helpers (sending side). The AI agent lives in wa-webhook's copy.
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
export const SUPABASE_URL = env("SUPABASE_URL");
export const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const TW_SID = env("TWILIO_ACCOUNT_SID");
const TW_TOKEN = env("TWILIO_AUTH_TOKEN");
export const WA_FROM = env("TWILIO_WHATSAPP_FROM") || "whatsapp:+14434481577";
export const WEBHOOK_URL = "https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/wa-webhook";

export const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type SendOpts = { body?: string; contentSid?: string; vars?: Record<string, string>; mediaUrls?: string[] };
export async function twilioSend(toE164: string, o: SendOpts): Promise<{ ok: boolean; sid?: string; status?: string; error?: string }> {
  const form = new URLSearchParams({ From: WA_FROM, To: "whatsapp:" + toE164, StatusCallback: WEBHOOK_URL });
  if (o.contentSid) {
    form.set("ContentSid", o.contentSid);
    if (o.vars) form.set("ContentVariables", JSON.stringify(o.vars));
  } else {
    form.set("Body", (o.body || "").slice(0, 1600));
    for (const u of o.mediaUrls || []) form.append("MediaUrl", u);
  }
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TW_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `${j.code || r.status}: ${j.message || "Twilio refused the message"}` };
    return { ok: true, sid: j.sid, status: j.status };
  } catch (e) {
    return { ok: false, error: "couldn't reach Twilio: " + String(e).slice(0, 120) };
  }
}

export async function sendAndLog(
  db: ReturnType<typeof sb>,
  contact: { id: string; phone: string },
  o: SendOpts & { author: "ai" | "staff" | "system" | "template"; staffId?: string | null; templateKey?: string | null; preview?: string; media?: unknown[] | null; buttons?: unknown[] | null },
) {
  const res = await twilioSend(contact.phone, o);
  const text = o.body ?? o.preview ?? (o.templateKey ? `[template: ${o.templateKey}]` : "");
  const { data } = await db.from("wa_messages").insert({
    contact_id: contact.id, direction: "out", author: o.author, staff_id: o.staffId || null,
    body: text, template_key: o.templateKey || null, media: o.media || null, buttons: o.buttons || null,
    twilio_sid: res.sid || null, status: res.ok ? (res.status || "queued") : "failed", error: res.ok ? null : res.error,
  }).select("id").single();
  await db.from("wa_contacts").update({
    last_message_at: new Date().toISOString(),
    last_preview: (o.author === "ai" ? "AI: " : o.author === "staff" ? "You: " : "") + (text || (o.media?.length ? "[file]" : "")).slice(0, 120),
  }).eq("id", contact.id);
  return { ...res, id: data?.id };
}

export type Btn = { title: string; url: string };
async function sha(t: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(d).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function buttonContent(db: ReturnType<typeof sb>, body: string, quick: string[], link: Btn | null, mediaUrl: string | null = null): Promise<string | null> {
  const text = body.trim().slice(0, 1000);
  const L = link;
  let types: Record<string, unknown>, kind: string;
  if (mediaUrl && (L || quick.length)) {
    kind = "card";
    types = { "twilio/card": { title: text, media: [mediaUrl],
      actions: L ? [{ type: "URL", title: L.title, url: L.url }] : quick.map((q) => ({ type: "QUICK_REPLY", title: q, id: q.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60) || "reply" })) } };
  } else if (L) {
    kind = "cta";
    types = { "twilio/call-to-action": { body: text, actions: [{ type: "URL", title: L.title, url: L.url }] },
      "twilio/text": { body: text + "\n" + L.url } };
  } else if (quick.length) {
    kind = "quick";
    types = { "twilio/quick-reply": { body: text, actions: quick.map((q) => ({ title: q, id: q.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60) || "reply" })) },
      "twilio/text": { body: text } };
  } else return null;
  const hash = await sha(JSON.stringify(types));
  const { data: hit } = await db.from("wa_content_cache").select("content_sid").eq("hash", hash).maybeSingle();
  if (hit?.content_sid) return hit.content_sid;
  try {
    const r = await fetch("https://content.twilio.com/v1/Content", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/json" },
      body: JSON.stringify({ friendly_name: "orb_" + kind + "_" + hash.slice(0, 12), language: "en", types }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.sid) { console.warn("button content", r.status, JSON.stringify(j).slice(0, 200)); return null; }
    await db.from("wa_content_cache").upsert({ hash, content_sid: j.sid, kind });
    return j.sid;
  } catch (e) { console.warn("button content", String(e)); return null; }
}

export type Media = { key: string; kind: string; url: string; title?: string };
const MIME: Record<string, string> = { video: "video/mp4", image: "image/jpeg", pdf: "application/pdf" };
export async function sendRich(db: ReturnType<typeof sb>, contact: { id: string; phone: string },
  o: { author: "ai" | "staff" | "system"; body: string; quick?: string[]; link?: Btn | null; media?: Media | null; staffId?: string | null }): Promise<{ ok: boolean; sid?: string; status?: string; error?: string; id?: string }> {
  const quick = o.quick || [], link = o.link || null, m = o.media || null;
  const btnLog = link ? [{ type: "url", title: link.title, url: link.url }] : quick.map((t) => ({ type: "reply", title: t }));
  const mediaLog = m ? [{ type: MIME[m.kind] || "application/octet-stream", url: m.url, name: m.key }] : null;
  if (m && (link || quick.length)) {
    const csid = await buttonContent(db, o.body, quick, link, m.url);
    if (csid) {
      const r = await sendAndLog(db, contact, { author: o.author, staffId: o.staffId, contentSid: csid, body: o.body, media: mediaLog, buttons: btnLog });
      if (r.ok) return r;
    }
    await sendAndLog(db, contact, { author: o.author, staffId: o.staffId, body: "", mediaUrls: [m.url], media: mediaLog });
    await new Promise((r) => setTimeout(r, 2500));
    return sendRich(db, contact, { ...o, media: null });
  }
  if (m) return sendAndLog(db, contact, { author: o.author, staffId: o.staffId, body: o.body, mediaUrls: [m.url], media: mediaLog });
  if (link || quick.length) {
    const csid = await buttonContent(db, o.body, quick, link);
    if (csid) return sendAndLog(db, contact, { author: o.author, staffId: o.staffId, contentSid: csid, body: o.body, buttons: btnLog });
  }
  return sendAndLog(db, contact, { author: o.author, staffId: o.staffId, body: o.body + (link && o.body.indexOf(link.url) < 0 ? "\n" + link.url : "") });
}
