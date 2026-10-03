// Orbuni WhatsApp webhook — Twilio calls this for every incoming WhatsApp message
// and for every delivery update (sent / delivered / read / failed).
//
// Incoming message → saved in the inbox → (if the AI is on for that chat) Claude
// writes a reply and it goes out from +1 443 448 1577. Anything sensitive (refund,
// complaint, visa refused, "I want a person"…) is handed to Nurudeen / Godfrey:
// the chat is flagged in the portal inbox and they get an email.
// STOP / START work as the student expects.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sb, e164, twilioValid, sendAndLog, alertStaff, runAgent, HANDOFF_WORDS, storeIncomingMedia, twilioTyping, buttonContent, LINKS } from "./wa.ts";

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = () => new Response(TWIML_EMPTY, { headers: { "Content-Type": "text/xml" } });

const STOP_WORDS = /^\s*(stop|unsubscribe|stopall|arrêt|arret|stop messages|stop receiving)\s*[.!]*\s*$/i;
const START_WORDS = /^\s*(start|unstop|resume)\s*[.!]*\s*$/i;

// Twilio's delivery states, in order; never move a message backwards.
const RANK: Record<string, number> = { failed: 9, undelivered: 9, read: 5, delivered: 4, sent: 3, queued: 1, accepted: 1, sending: 2 };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  if (!(await twilioValid(req, params))) {
    console.warn("wa-webhook: bad Twilio signature");
    return new Response("forbidden", { status: 403 });
  }
  const db = sb();

  // ---- delivery update for a message we sent
  // (incoming messages always carry a Body field, even when empty; status callbacks never do)
  if (params.MessageStatus && !("Body" in params)) {
    const sid = params.MessageSid || params.SmsSid;
    const st = params.MessageStatus;
    if (sid) {
      const { data: m } = await db.from("wa_messages").select("id,status").eq("twilio_sid", sid).maybeSingle();
      if (m && (RANK[st] ?? 0) >= (RANK[m.status || ""] ?? 0)) {
        await db.from("wa_messages").update({
          status: st,
          error: params.ErrorCode ? `${params.ErrorCode}${params.ErrorMessage ? ": " + params.ErrorMessage : ""}` : null,
        }).eq("id", m.id);
      }
    }
    return twiml();
  }

  // ---- incoming message from a student
  const phone = e164(params.From || "");
  if (!phone) return twiml();
  const body = (params.Body || "").trim();
  const nMedia = Number(params.NumMedia || 0);
  const media = nMedia > 0
    ? Array.from({ length: nMedia }, (_, i) => ({ url: params[`MediaUrl${i}`], type: params[`MediaContentType${i}`] }))
    : null;
  const now = new Date().toISOString();

  // find or create the chat
  let { data: contact } = await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle();
  if (!contact) {
    const { data: ctx } = await db.rpc("wa_person_context", { p_phone: phone });
    const ins = await db.from("wa_contacts").insert({
      phone, wa_name: params.ProfileName || null,
      profile_id: ctx?.profile_id || null, lead_id: ctx?.lead_id || null,
    }).select("*").single();
    contact = ins.data;
    if (!contact) { // lost a race with a second message — read it back
      contact = (await db.from("wa_contacts").select("*").eq("phone", phone).single()).data;
    }
  }
  if (!contact) return twiml();

  // skip Twilio retries of a message we already saved
  const sid = params.MessageSid || params.SmsSid || null;
  if (sid) {
    const { data: dup } = await db.from("wa_messages").select("id").eq("twilio_sid", sid).maybeSingle();
    if (dup) return twiml();
  }
  const { data: saved } = await db.from("wa_messages").insert({
    contact_id: contact.id, direction: "in", author: "student",
    body: body || (media ? `[${media.map((m) => (m.type || "file").split("/")[0]).join(", ")}]` : ""),
    media, twilio_sid: sid, status: "received",
  }).select("id").single();
  await db.from("wa_contacts").update({
    wa_name: params.ProfileName || contact.wa_name,
    last_inbound_at: now, last_message_at: now,
    last_preview: (body || "[attachment]").slice(0, 120),
    unread: (contact.unread || 0) + 1,
  }).eq("id", contact.id);

  // STOP / START
  if (STOP_WORDS.test(body) || /^stop/i.test(String(params.ButtonPayload || ""))) {
    await db.from("wa_contacts").update({ opted_out: true, opted_out_at: now }).eq("id", contact.id);
    await sendAndLog(db, contact, { author: "system", body: "You won't get any more messages from Orbuni here. Reply START any time to turn them back on." });
    return twiml();
  }
  if (START_WORDS.test(body) && contact.opted_out) {
    await db.from("wa_contacts").update({ opted_out: false, opted_out_at: null }).eq("id", contact.id);
    await sendAndLog(db, contact, { author: "system", body: "You're back on. How can we help?" });
    return twiml();
  }

  // Photos / documents: copy them into our own storage after Twilio has its answer.
  if (media && saved?.id && sid) {
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(storeIncomingMedia(db, contact.id, sid, media as any).then((m) =>
      db.from("wa_messages").update({ media: m }).eq("id", saved.id)));
  }

  // Handed over to a person: the AI stays out of it, but the student is never left
  // in silence — at most one short note every 30 minutes — and the team is reminded.
  if (contact.needs_human && !contact.opted_out) {
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(holding(contact.id, body));
    return twiml();
  }

  // AI reply runs after Twilio gets its answer (Twilio waits only 15s).
  if (contact.ai_on) {
    // the student sees "typing…" straight away, while the AI writes
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (sid) EdgeRuntime.waitUntil(twilioTyping(sid));
    // @ts-ignore EdgeRuntime is provided by Supabase
    EdgeRuntime.waitUntil(answer(contact.id, saved?.id || null));
  }
  return twiml();
});

async function answer(contactId: string, messageId: string | null) {
  const db = sb();
  // Students often send 2–3 short messages in a row: wait, then answer once.
  await new Promise((r) => setTimeout(r, 6000));
  const { data: latest } = await db.from("wa_messages").select("id").eq("contact_id", contactId).eq("direction", "in")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (messageId && latest && latest.id !== messageId) return;   // a newer message will answer

  const { data: c } = await db.from("wa_contacts").select("*").eq("id", contactId).single();
  if (!c || !c.ai_on || c.needs_human || c.opted_out) return;   // a person took over meanwhile

  // Only what was said since a person last pressed "Done" — an issue the team already
  // handled must not make the AI hand the chat over again.
  let mq = db.from("wa_messages").select("direction,author,body,created_at").eq("contact_id", contactId);
  if (c.resolved_at) mq = mq.gte("created_at", c.resolved_at);
  const { data: msgs } = await mq.order("created_at", { ascending: false }).limit(24);
  const rows = (msgs || []).reverse();

  // Claude wants alternating turns starting with the student.
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of rows) {
    const role = m.direction === "in" ? "user" : "assistant";
    const text = (m.author === "staff" ? "[Orbuni team member] " : "") + (m.body || "");
    if (!text.trim()) continue;
    const last = history[history.length - 1];
    if (last && last.role === role) last.content += "\n" + text;
    else history.push({ role, content: text });
  }
  while (history.length && history[0].role !== "user") history.shift();
  if (!history.length || history[history.length - 1].role !== "user") return;
  if (c.resolved_at) history[0].content = "[Note: the Orbuni team already handled this student's earlier issue.]\n" + history[0].content;

  const { data: file } = await db.rpc("wa_person_context", { p_phone: c.phone });
  if (file && (!c.profile_id && file.profile_id || !c.lead_id && file.lead_id)) {
    await db.from("wa_contacts").update({ profile_id: c.profile_id || file.profile_id, lead_id: c.lead_id || file.lead_id }).eq("id", c.id);
  }

  const lastText = history[history.length - 1].content;
  const out = await runAgent(history, file, c.wa_name || "");

  if (!out) {
    // AI unavailable: never leave the student unanswered, and tell the team.
    await sendAndLog(db, c, { author: "system", body: "Thanks for your message! A member of the Orbuni team will reply here shortly." });
    await handOver(db, c, "The AI assistant could not answer (service error).", lastText);
    return;
  }

  // the reply carries tap buttons when the AI asked a question with clear answers or points to one page
  const quick = out.handoff ? [] : out.buttons, link = out.handoff || out.link === "none" ? null : out.link;
  const csid = (quick.length || link) ? await buttonContent(db, out.reply, quick, link) : null;
  if (csid) {
    await sendAndLog(db, c, { author: "ai", contentSid: csid, body: out.reply,
      buttons: link ? [{ type: "url", title: LINKS[link].title, url: LINKS[link].url }] : quick.map((t) => ({ type: "reply", title: t })) });
  } else {
    // no buttons (or Twilio refused them): plain text, with the link written out
    await sendAndLog(db, c, { author: "ai", body: out.reply + (link && out.reply.indexOf(LINKS[link].url) < 0 ? "\n" + LINKS[link].url : "") });
  }

  const forced = HANDOFF_WORDS.test(lastText);
  if (out.handoff || forced) {
    await handOver(db, c, out.reason || (forced ? "Sensitive topic (refund / complaint / visa / asked for a person)." : "AI asked for a human."), lastText);
  }
}

async function handOver(db: ReturnType<typeof sb>, c: any, reason: string, lastText: string) {
  await db.from("wa_contacts").update({ needs_human: true, handoff_reason: reason.slice(0, 300), handoff_at: new Date().toISOString(), held_ack_at: new Date().toISOString() }).eq("id", c.id);
  const who = c.wa_name || c.phone;
  await alertStaff(db, `WhatsApp: ${who} needs a person`,
    `${who} (${c.phone}) needs a reply from the team.\nWhy: ${reason}\nTheir last message: "${lastText.slice(0, 400)}"\nThe AI has paused on this chat until someone presses Done.`,
    c.id, 60);
}

// A student writes while the chat is waiting for the team.
async function holding(contactId: string, text: string) {
  const db = sb();
  const { data: c } = await db.from("wa_contacts").select("*").eq("id", contactId).single();
  if (!c || !c.needs_human) return;
  const last = c.held_ack_at ? Date.parse(c.held_ack_at) : 0;
  if (Date.now() - last > 30 * 60e3) {
    await sendAndLog(db, c, { author: "system", body: "Thanks for your message — a member of the Orbuni team has your chat and will reply here personally soon." });
    await db.from("wa_contacts").update({ held_ack_at: new Date().toISOString() }).eq("id", c.id);
  }
  const who = c.wa_name || c.phone;
  await alertStaff(db, `WhatsApp: ${who} is still waiting`,
    `${who} (${c.phone}) wrote again while waiting for the team: "${String(text || "[file]").slice(0, 400)}"\nWhy it was handed over: ${c.handoff_reason || "-"}`,
    c.id, 60);
}
