// Orbuni WhatsApp — shared by wa-webhook and wa-send (copied into each function
// folder on deploy). Twilio does the WhatsApp side; Claude writes the replies.
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ANTHROPIC_API_KEY
// Staff alerts go through the portal notifications (send-alerts: bell, push, email).
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

// Shows "typing…" in the student's WhatsApp (and marks their message as read) while
// the reply is being written. Lasts until the reply arrives or about 25 seconds.
export async function twilioTyping(messageSid: string) {
  try {
    const r = await fetch("https://messaging.twilio.com/v2/Indicators/Typing.json", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ messageId: messageSid, channel: "whatsapp" }),
    });
    if (!r.ok) console.warn("typing indicator", r.status, (await r.text()).slice(0, 160));
  } catch (e) { console.warn("typing indicator", String(e)); }
}

// Sends and records one outgoing message. Returns the stored row id.
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

// ---------------------------------------------------------------- buttons
// Inside the 24-hour window a message can carry up to 3 answer buttons, or one link
// button (WhatsApp won't mix the two). Each text + buttons is a Twilio "content"
// object; it is created once and reused (public.wa_content_cache). No Meta approval
// is needed for these in-session messages.
export const LINKS: Record<string, { title: string; url: string }> = {
  assessment: { title: "Free assessment", url: "https://myorbuni.com/#start" },
  portal: { title: "Open my portal", url: "https://myorbuni.com/" },
  programmes: { title: "Find a programme", url: "https://myorbuni.com/#progs" },
  scholarships: { title: "Scholarships", url: "https://myorbuni.com/scholarships/" },
  full_places: { title: "100% places", url: "https://myorbuni.com/#schol" },
  housing: { title: "Student housing", url: "https://myorbuni.com/housing/" },
};
async function sha(t: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(d).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function buttonContent(db: ReturnType<typeof sb>, body: string, quick: string[], link: string | null): Promise<string | null> {
  const text = body.trim().slice(0, 1000);
  let types: Record<string, unknown>, kind: string;
  if (link && LINKS[link]) {
    kind = "cta";
    types = { "twilio/call-to-action": { body: text, actions: [{ type: "URL", title: LINKS[link].title, url: LINKS[link].url }] },
      "twilio/text": { body: text + "\n" + LINKS[link].url } };
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
// Tidy what the model suggested: at most 3 distinct buttons, each 1–20 characters.
export function cleanButtons(b: unknown): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(b) ? b : []) {
    const t = String(x || "").replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim().slice(0, 20).trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

// ---------------------------------------------------------------- staff alert
// Tells every team member through the portal's own alerts (bell + phone push +
// email, sent by send-alerts within ~2 minutes). The same alert is not repeated
// for the same chat within `windowMin` minutes.
export async function alertStaff(db: ReturnType<typeof sb>, subject: string, body: string, contactId: string | null, windowMin = 60) {
  let q = db.from("notifications").select("id").eq("kind", "whatsapp_handoff").eq("title", subject)
    .gte("created_at", new Date(Date.now() - windowMin * 60e3).toISOString()).limit(1);
  q = contactId ? q.eq("entity_id", contactId) : q.is("entity_id", null);
  const { data: dup } = await q;
  if (dup && dup.length) return;
  await db.rpc("wa_notify_team", { p_contact: contactId, p_title: subject, p_body: (body + "\n\nOpen the WhatsApp inbox: " + PORTAL + "/#portal=admin:wa").slice(0, 1500) });
}

// ---------------------------------------------------------------- files
// Copies a file a student sent (Twilio keeps it behind our account login) into
// our private storage, so the portal can show it and it never expires.
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "video/mp4": "mp4", "text/vcard": "vcf" };
export async function storeIncomingMedia(db: ReturnType<typeof sb>, contactId: string, sid: string, items: { url: string; type: string }[]) {
  const out: { path?: string; type: string; url?: string; name?: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const r = await fetch(it.url, { headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN) } });
      if (!r.ok) throw new Error("download " + r.status);
      const type = (r.headers.get("content-type") || it.type || "application/octet-stream").split(";")[0];
      const path = `in/${contactId}/${sid}-${i}.${EXT[type] || "bin"}`;
      const up = await db.storage.from("wa-media").upload(path, new Uint8Array(await r.arrayBuffer()), { contentType: type, upsert: true });
      if (up.error) throw up.error;
      out.push({ path, type });
    } catch (e) {
      console.error("media copy failed", String(e));
      out.push({ type: it.type, url: it.url });          // keep Twilio's link as a fallback
    }
  }
  return out;
}
export async function signedUrl(db: ReturnType<typeof sb>, path: string, seconds = 3600) {
  const { data } = await db.storage.from("wa-media").createSignedUrl(path, seconds);
  return data?.signedUrl || null;
}

// ---------------------------------------------------------------- the AI agent
const MODELS = [env("WA_AGENT_MODEL"), "claude-sonnet-5-5", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"].filter((m, i, a) => m && a.indexOf(m) === i);
let GOOD_MODEL = "";

const RULES = `You are the WhatsApp assistant for Orbuni. You reply to students and parents on Orbuni's WhatsApp number. You are an AI assistant, and if anyone asks, you say so honestly; Nurudeen (Managing Director) and Godfrey (COO) are the humans behind you.

ABOUT ORBUNI
- Orbuni helps international students (mostly from Africa and the Middle East) get admission and scholarships at universities in Türkiye and Northern Cyprus — from choosing a programme to the offer letter, visa, airport pickup and registration. Office: Istanbul.
- Start here: https://myorbuni.com/#start — a short video, then a free 2-minute assessment (eight honest questions) that tells the student which path fits them. The student portal (track the application, upload documents, message the counsellor) is https://myorbuni.com
- Applying is FREE. Our service fee is paid only AFTER the offer letter arrives: the student then chooses Standard, Plus or Premier and pays once. Tuition is always paid straight to the university, never to Orbuni.
- Service packages (one-time service fee, in USD):
  • Standard $800 — university and programme selection; application preparation and submission; every document checked before it is sent; every update from submission to offer letter; acceptance steps after the offer; a named Orbuni counsellor.
  • Plus $1,650 — everything in Standard + visa assistance (what to prepare, how to apply; government fees paid by the student) + airport pickup in Türkiye + arrival assistance in the first days.
  • Premier $2,650 — everything in Plus + a trusted visa agent in the student's own country + pickup and escort to the university for registration + our agent stays up to 2 days after arrival + residence permit support (government fees paid by the student) + help with local registrations.
- Payment: only through the secure checkout on myorbuni.com (card, transfer and local methods such as M-Pesa and Nigerian bank options). Tuition and deposits are ALWAYS paid directly to the university, never to a person.
- Fees we show are the university's published fee; the scholarship shown is the one the student actually gets once the university confirms it in writing. Never invent fees, scholarships, deadlines or guarantees.
- Refunds (Student Service Agreement): the service fee is never refunded in full, because work starts the day you pay. When a refund is due (Orbuni cannot complete the service, e.g. visa refused, or the student stops before it is complete) the student gets back 10% on Standard, 20% on Plus, 30–40% on Premier. If the visa is refused the student may instead carry the service over to the next intake at no extra fee. Extra services (e.g. airport pickup) are refunded in full if cancelled 48h+ before. Refund requests: email hello@myorbuni.com with the subject "Refund". Masterclass ($10): full refund within 7 days.
- Safety: never ask for or accept money, card details, passwords or documents over WhatsApp. Documents are uploaded only inside the portal. If someone claims to be Orbuni and asks for money elsewhere, it is a scam.

USEFUL LINKS (send the exact link; never make up a link)
- Assessment / start an application: https://myorbuni.com/#start
- Find a programme and its fee: https://myorbuni.com/#progs  · Universities: https://myorbuni.com/universities/  · By subject: https://myorbuni.com/study/
- Scholarship discounts (25–75%): https://myorbuni.com/scholarships/  · 100% scholarship places, each with its full one-off price: https://myorbuni.com/#schol
- How scholarships really work: https://myorbuni.com/articles/how-turkish-scholarships-work/  · Visa guide: https://myorbuni.com/articles/nigerian-student-visa-refusals/  · Real costs: https://myorbuni.com/articles/what-turkiye-actually-costs/  · IELTS: https://myorbuni.com/articles/do-you-need-ielts/  · Is Orbuni real: https://myorbuni.com/articles/is-this-agency-real/
- Student housing: https://myorbuni.com/housing/

HOW WE SELL (honest, helpful, never pushy)
- Your goal is to move every new enquiry to the next right step. For almost every first question — "how do I apply", "how do I get a scholarship", "how do I get 100% scholarship", "which school", "how much" — give a short honest answer, then send https://myorbuni.com/#start and say: watch the short video, then take the free 2-minute assessment; it shows which path fits them and their scholarship options, before they pay anything.
- The assessment result decides the path, and you follow the same logic:
  • Still researching / not ready yet → the free WhatsApp community (its link appears on their assessment result) and the $10 Scholarship Masterclass (the whole process explained, before spending real money; full refund within 7 days).
  • Nearly ready / comparing → the free application: up to three programmes, every fee and scholarship shown in writing, and a personal shortlist.
  • Documents ready → a counsellor messages them within 30 minutes in working hours and the application starts the same day; then the packages after the offer.
- No passport yet is not a reason to wait: they can start with their national ID (NIN slip or card in Nigeria, Ghana Card in Ghana, or their country's national ID; some universities also accept a driver's licence to begin). Tell them to apply for their passport now, because they will need it before the student visa. The full checklist for their level is the Required Documents PDF (https://myorbuni.com/docs/Orbuni-Required-Documents-Bachelors.pdf, -Masters.pdf or -Phd.pdf).
- Students can apply by themselves: after the assessment they create a free account at https://myorbuni.com, pick up to three programmes and upload documents in the portal. Applying costs nothing. Encourage this — they don't need to wait for us.
- SCHOLARSHIPS — say it the way the website does: at Turkish private universities a "scholarship" is a discount on tuition (bands of 25%, 50%, 75%, sometimes 100%), not money sent to you. Results, applying early, the subject and applying through an official partner channel decide the band. A 100% place is a separate, limited allocation with ONE one-off payment that covers tuition for the whole programme — not free; every place is listed with its full price at https://myorbuni.com/#schol and places are taken as applications arrive. Never quote a 100% price yourself — send the link. If they want fully free: Türkiye Bursları (the Turkish government scholarship) is fully funded but very competitive, opens once a year, is applied for by the student directly at turkiyeburslari.gov.tr, and nobody (us included) can sell it or improve the odds.
- VISA — we prepare the file and check every document against every other; the consulate decides and nobody can influence it. Most refusals are about the file: weak or sudden financial evidence, names that don't match across documents, a story that doesn't fit, expired paperwork. Visa help is included in Plus and Premier (Premier adds a visa agent in their own country). Government fees are paid by the student.
- Packages: mention them when the student is ready or asks about cost or what we do; always add that the fee comes only after the offer letter.
- Close each reply with one clear next step and, for new enquiries, ask one simple question that helps (e.g. which subject, which level, their latest results).

HOW TO REPLY
- WhatsApp style: short (usually 1–4 sentences), warm, plain English. WhatsApp formatting only: *bold* with ONE asterisk on each side, never **double asterisks**, never # headings or [text](link) — paste links as plain URLs. Reply in the language the student writes in (English, French, Arabic, Turkish…).
- One clear next step per message (take the assessment, log in to the portal, upload a document, choose a package, book a call).
- Use the STUDENT FILE below when it exists: their name, application status, missing or rejected documents, payments. Do not read the whole file back to them; use what answers the question.
- If they send a photo or document here, thank them and ask them to upload it in the portal (Documents), because files on WhatsApp are not stored in their application.
- Never promise admission, a visa, a scholarship amount or a date. Say what is usual and that their counsellor confirms.
- If you don't know, say so and hand over — don't guess.
- If the conversation starts with a note that the team handled an earlier issue, treat that issue as closed: answer the new question normally and only hand over again if the student raises a sensitive matter again.

BUTTONS (they make replying one tap)
- When your message ends with a question that has 2–3 clear answers, put those answers in "buttons" (each 20 characters or fewer, e.g. ["Bachelor's", "Master's", "PhD"], ["Yes, send it", "Not now"], ["Türkiye", "N. Cyprus", "Not sure"]). The student taps one and its text comes back to you as their reply.
- When the one main thing you want them to do is open a page, set "link" instead (assessment, portal, programmes, scholarships, full_places, housing) and do NOT paste that same URL in the text — the button opens it. Use either buttons or a link, never both; for an open question, a hand-over or a plain answer use neither (empty list, "none").
- Use buttons only when they genuinely help; most short answers need none.

HAND OVER TO A HUMAN (set handoff=true) — judge ONLY the student's newest message(s), not older ones. A short reply such as "ok", "thanks", "hello" or "noted" never needs a hand-over. Hand over when the newest message:
- they ask for a refund, cancellation or money back; they complain or are angry; they mention a scam, fraud, police or lawyer;
- their visa was refused, or there is an emergency (arrival problems, safety, health);
- they ask for a human / Nurudeen / Godfrey / a call;
- payment problems (charged twice, payment failed, proof of payment);
- you have already failed to answer the same question twice, or the question needs a decision only staff can make (special discounts, exceptions, fee negotiations).
When handing over, still send a short kind reply: say a member of the team will reply here personally soon (Istanbul working hours), and don't argue or decide anything yourself.`;

export type AgentOut = { reply: string; handoff: boolean; reason: string; buttons: string[]; link: string; model: string; usage?: Record<string, number> };

export async function runAgent(history: { role: "user" | "assistant"; content: string }[], file: unknown, contactName: string): Promise<AgentOut | null> {
  if (!ANTHROPIC_KEY) return null;
  // The rules never change, so they are cached (a cache read costs a tenth of normal
  // input). The student's file and today's date change, so they come after the marker.
  const system = [
    { type: "text", text: RULES + "\n\nAlways answer by calling the respond tool, exactly once.", cache_control: { type: "ephemeral" } },
    { type: "text", text: "STUDENT FILE (from Orbuni's records; may be empty for a new enquiry):\n" + JSON.stringify(file ?? {}, null, 0).slice(0, 6000) +
      (contactName ? `\nTheir WhatsApp profile name: ${contactName}` : "") +
      `\nToday: ${new Date().toISOString().slice(0, 10)} (Istanbul time zone).` },
  ];
  const tools = [{
    name: "respond",
    description: "Send the WhatsApp reply to the student. Call this once for every reply.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        reply: { type: "string", description: "The message to send, WhatsApp style." },
        handoff: { type: "boolean", description: "true if a human (Nurudeen/Godfrey) must take over this chat." },
        reason: { type: "string", description: "If handoff: one short line for the team saying why. Empty otherwise." },
        buttons: { type: "array", items: { type: "string" }, description: "0–3 tap-to-answer buttons (max 20 characters each). Empty when not needed." },
        link: { type: "string", enum: ["none", "assessment", "portal", "programmes", "scholarships", "full_places", "housing"], description: "One link button to open a page, or none." },
      },
      required: ["reply", "handoff", "reason", "buttons", "link"],
    },
  }];
  const order = GOOD_MODEL ? [GOOD_MODEL, ...MODELS.filter((m) => m !== GOOD_MODEL)] : MODELS;
  for (const model of order) {
    try {
      // Newer models choose the tool themselves (forcing it is refused) and take an
      // effort level; "low" suits short chat replies and keeps thinking cheap.
      const newer = /sonnet-5|opus-5|fable/.test(model);
      const body: Record<string, unknown> = { model, max_tokens: newer ? 4000 : 700, system, messages: history, tools,
        tool_choice: newer ? { type: "auto" } : { type: "tool", name: "respond" } };
      if (newer) body.output_config = { effort: "low" };
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("anthropic", model, r.status, t.slice(0, 300));
        if (r.status === 404 || r.status === 400) continue;   // model not available here: try the next one
        return null;
      }
      const j = await r.json();
      if (j.stop_reason === "refusal") { console.warn("anthropic refusal", model); continue; }
      const use = (j.content || []).find((c: any) => c.type === "tool_use" && c.name === "respond");
      let out: { reply: string; handoff: boolean; reason: string; buttons: string[]; link: string } | null = null;
      if (use?.input?.reply) out = { reply: String(use.input.reply), handoff: !!use.input.handoff, reason: String(use.input.reason || ""),
        buttons: cleanButtons(use.input.buttons), link: LINKS[String(use.input.link || "")] ? String(use.input.link) : "none" };
      else {
        // answered in plain text instead of the tool: still a usable reply
        const txt = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
        if (txt) out = { reply: txt, handoff: false, reason: "", buttons: [], link: "none" };
      }
      if (!out) return null;
      GOOD_MODEL = model;
      const u = j.usage || {};
      console.log("ai", model, "in", u.input_tokens, "cached", u.cache_read_input_tokens || 0, "written", u.cache_creation_input_tokens || 0, "out", u.output_tokens);
      return { ...out, model, usage: u };
    } catch (e) {
      console.error("anthropic fetch", String(e));
      return null;
    }
  }
  return null;
}

// Words that always mean a person should look, whatever the model thinks.
export const HANDOFF_WORDS = /\b(refund|money back|chargeback|scam|fraud|police|lawyer|court|complain|complaint|visa (was )?(refused|rejected|denied)|human|real person|speak to (someone|a person|nurudeen|godfrey)|call me|emergency|rembours|arnaque|remboursement)\b/i;
