// Orbuni WhatsApp — shared by wa-webhook and wa-send (copied into each function
// folder on deploy). Twilio does the WhatsApp side; Claude writes the replies.
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ANTHROPIC_API_KEY
// (and RESEND_* via the existing email outbox for staff alerts).
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
export const SUPABASE_URL = env("SUPABASE_URL");
export const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
export const ANON_KEY = env("SUPABASE_ANON_KEY");
const TW_SID = env("TWILIO_ACCOUNT_SID");
const TW_TOKEN = env("TWILIO_AUTH_TOKEN");
export const WA_FROM = env("TWILIO_WHATSAPP_FROM") || "whatsapp:+14434481577";
const ANTHROPIC_KEY = env("ANTHROPIC_API_KEY");
export const WEBHOOK_URL = "https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/wa-webhook";
const PORTAL = "https://myorbuni.com";

export const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

// "+234 801-234 5678", "whatsapp:+2348012345678" → "+2348012345678"
export function e164(raw: string): string {
  const s = String(raw || "").replace(/^whatsapp:/i, "").trim();
  const d = s.replace(/\D/g, "");
  return d ? "+" + d : "";
}

// ---------------------------------------------------------------- Twilio
export async function twilioValid(req: Request, params: Record<string, string>): Promise<boolean> {
  const sig = req.headers.get("x-twilio-signature") || "";
  if (!sig || !TW_TOKEN) return false;
  const data = WEBHOOK_URL + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TW_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const b64 = btoa(String.fromCharCode(...mac));
  return b64 === sig;
}

type SendOpts = { body?: string; contentSid?: string; vars?: Record<string, string> };
export async function twilioSend(toE164: string, o: SendOpts): Promise<{ ok: boolean; sid?: string; status?: string; error?: string }> {
  const form = new URLSearchParams({ From: WA_FROM, To: "whatsapp:" + toE164, StatusCallback: WEBHOOK_URL });
  if (o.contentSid) {
    form.set("ContentSid", o.contentSid);
    if (o.vars) form.set("ContentVariables", JSON.stringify(o.vars));
  } else {
    form.set("Body", (o.body || "").slice(0, 1600));
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

// Sends and records one outgoing message. Returns the stored row id.
export async function sendAndLog(
  db: ReturnType<typeof sb>,
  contact: { id: string; phone: string },
  o: SendOpts & { author: "ai" | "staff" | "system" | "template"; staffId?: string | null; templateKey?: string | null; preview?: string },
) {
  const res = await twilioSend(contact.phone, o);
  const text = o.body ?? o.preview ?? (o.templateKey ? `[template: ${o.templateKey}]` : "");
  const { data } = await db.from("wa_messages").insert({
    contact_id: contact.id, direction: "out", author: o.author, staff_id: o.staffId || null,
    body: text, template_key: o.templateKey || null,
    twilio_sid: res.sid || null, status: res.ok ? (res.status || "queued") : "failed", error: res.ok ? null : res.error,
  }).select("id").single();
  await db.from("wa_contacts").update({
    last_message_at: new Date().toISOString(),
    last_preview: (o.author === "ai" ? "AI: " : o.author === "staff" ? "You: " : "") + text.slice(0, 120),
  }).eq("id", contact.id);
  return { ...res, id: data?.id };
}

// ---------------------------------------------------------------- staff alert
// Emails the owner(s) through the existing email outbox (same pipeline as every
// other Orbuni email), so a handover is never missed.
export async function alertStaff(db: ReturnType<typeof sb>, subject: string, body: string, dedupe: string) {
  const { data: owners } = await db.from("profiles").select("id,email").or("is_owner.eq.true,role.eq.admin");
  for (const p of owners || []) {
    if (!p.email) continue;
    await db.from("email_outbox").insert({
      profile_id: p.id, to_email: p.email, template: "custom_notice",
      vars: { subject, body: body + "\n\nOpen the WhatsApp inbox: " + PORTAL + "/#portal=admin:wa" },
      dedupe_key: dedupe + ":" + p.id,
    }).then(() => {}, () => {});
  }
}

// ---------------------------------------------------------------- the AI agent
const MODELS = [env("WA_AGENT_MODEL"), "claude-sonnet-5-5", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"].filter((m, i, a) => m && a.indexOf(m) === i);
let GOOD_MODEL = "";

const RULES = `You are the WhatsApp assistant for Orbuni. You reply to students and parents on Orbuni's WhatsApp number. You are an AI assistant, and if anyone asks, you say so honestly; Nurudeen (Managing Director) and Godfrey (COO) are the humans behind you.

ABOUT ORBUNI
- Orbuni helps international students (mostly from Africa and the Middle East) get admission and scholarships at universities in Türkiye and Northern Cyprus — from choosing a programme to the offer letter, visa, airport pickup and registration. Office: Istanbul.
- Start here: the free 2-minute assessment at https://myorbuni.com/#start — it matches the student to programmes and shows real fees. The student portal (track the application, upload documents, message the counsellor) is https://myorbuni.com
- Service packages (one-time service fee, in USD):
  • Standard $800 — university and programme selection; application preparation and submission; every document checked before it is sent; every update from submission to offer letter; acceptance steps after the offer; a named Orbuni counsellor.
  • Plus $1,650 — everything in Standard + visa assistance (what to prepare, how to apply; government fees paid by the student) + airport pickup in Türkiye + arrival assistance in the first days.
  • Premier $2,650 — everything in Plus + a trusted visa agent in the student's own country + pickup and escort to the university for registration + our agent stays up to 2 days after arrival + residence permit support (government fees paid by the student) + help with local registrations.
- Payment: only through the secure checkout on myorbuni.com (card, transfer and local methods such as M-Pesa and Nigerian bank options). Tuition and deposits are ALWAYS paid directly to the university, never to a person.
- Fees we show are the university's published fee; the scholarship shown is the one the student actually gets once the university confirms it in writing. Never invent fees, scholarships, deadlines or guarantees.
- Refunds (Student Service Agreement): the service fee is never refunded in full, because work starts the day you pay. When a refund is due (Orbuni cannot complete the service, e.g. visa refused, or the student stops before it is complete) the student gets back 10% on Standard, 20% on Plus, 30–40% on Premier. If the visa is refused the student may instead carry the service over to the next intake at no extra fee. Extra services (e.g. airport pickup) are refunded in full if cancelled 48h+ before. Refund requests: email hello@myorbuni.com with the subject "Refund". Masterclass ($10): full refund within 7 days.
- Safety: never ask for or accept money, card details, passwords or documents over WhatsApp. Documents are uploaded only inside the portal. If someone claims to be Orbuni and asks for money elsewhere, it is a scam.

HOW TO REPLY
- WhatsApp style: short (usually 1–4 sentences), warm, plain English. Reply in the language the student writes in (English, French, Arabic, Turkish…).
- One clear next step per message (take the assessment, log in to the portal, upload a document, choose a package, book a call).
- Use the STUDENT FILE below when it exists: their name, application status, missing or rejected documents, payments. Do not read the whole file back to them; use what answers the question.
- If they send a photo or document here, thank them and ask them to upload it in the portal (Documents), because files on WhatsApp are not stored in their application.
- Never promise admission, a visa, a scholarship amount or a date. Say what is usual and that their counsellor confirms.
- If you don't know, say so and hand over — don't guess.

HAND OVER TO A HUMAN (set handoff=true) when:
- they ask for a refund, cancellation or money back; they complain or are angry; they mention a scam, fraud, police or lawyer;
- their visa was refused, or there is an emergency (arrival problems, safety, health);
- they ask for a human / Nurudeen / Godfrey / a call;
- payment problems (charged twice, payment failed, proof of payment);
- you have already failed to answer the same question twice, or the question needs a decision only staff can make (special discounts, exceptions, fee negotiations).
When handing over, still send a short kind reply: say a member of the team will reply here personally soon (Istanbul working hours), and don't argue or decide anything yourself.`;

export type AgentOut = { reply: string; handoff: boolean; reason: string; model: string };

export async function runAgent(history: { role: "user" | "assistant"; content: string }[], file: unknown, contactName: string): Promise<AgentOut | null> {
  if (!ANTHROPIC_KEY) return null;
  const system = RULES + "\n\nSTUDENT FILE (from Orbuni's records; may be empty for a new enquiry):\n" + JSON.stringify(file ?? {}, null, 0).slice(0, 6000) +
    (contactName ? `\nTheir WhatsApp profile name: ${contactName}` : "") +
    `\nToday: ${new Date().toISOString().slice(0, 10)} (Istanbul time zone).`;
  const tools = [{
    name: "respond",
    description: "Send the WhatsApp reply to the student.",
    input_schema: {
      type: "object",
      properties: {
        reply: { type: "string", description: "The message to send, WhatsApp style." },
        handoff: { type: "boolean", description: "true if a human (Nurudeen/Godfrey) must take over this chat." },
        reason: { type: "string", description: "If handoff: one short line for the team saying why." },
      },
      required: ["reply", "handoff"],
    },
  }];
  const order = GOOD_MODEL ? [GOOD_MODEL, ...MODELS.filter((m) => m !== GOOD_MODEL)] : MODELS;
  for (const model of order) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 700, system, messages: history, tools, tool_choice: { type: "tool", name: "respond" } }),
      });
      if (!r.ok) {
        const t = await r.text();
        if (r.status === 404 || /model/i.test(t)) continue;   // try the next model
        console.error("anthropic", r.status, t.slice(0, 300));
        return null;
      }
      const j = await r.json();
      const use = (j.content || []).find((c: any) => c.type === "tool_use");
      if (!use?.input?.reply) return null;
      GOOD_MODEL = model;
      return { reply: String(use.input.reply), handoff: !!use.input.handoff, reason: String(use.input.reason || ""), model };
    } catch (e) {
      console.error("anthropic fetch", String(e));
      return null;
    }
  }
  return null;
}

// Words that always mean a person should look, whatever the model thinks.
export const HANDOFF_WORDS = /\b(refund|money back|chargeback|scam|fraud|police|lawyer|court|complain|complaint|visa (was )?(refused|rejected|denied)|human|real person|speak to (someone|a person|nurudeen|godfrey)|call me|emergency|rembours|arnaque|remboursement)\b/i;
