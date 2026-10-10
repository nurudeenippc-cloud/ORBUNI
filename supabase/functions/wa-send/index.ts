// Orbuni WhatsApp — what the portal inbox calls when a team member acts.
// POST (signed-in staff only) with one of:
//   { action:"reply",    contact_id, body }                 free text (only within 24h of the student's last message)
//   { action:"template", contact_id | phone, key, vars }    an approved template (works any time; starts a new chat)
//   { action:"ai",       contact_id, on:true|false }         switch the AI agent on/off for this chat
//   { action:"resolve",  contact_id }                       done with the handover → AI may answer again
//   { action:"read",     contact_id }                       clear the unread count
//   { action:"media",    contact_id, path, type, caption }  send a file the browser uploaded to wa-media/out/…
//   { action:"typing",   contact_id }                       show "typing…" to the student while a team member writes
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sb, json, CORS, e164, sendAndLog, signedUrl, twilioTyping, SUPABASE_URL, ANON_KEY } from "./wa.ts";

const DAY = 24 * 3600 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "sign in first" });

  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await asUser.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return json(401, { error: "sign in first" });
  const { data: staff } = await asUser.rpc("is_staff");
  if (!staff) return json(403, { error: "only the Orbuni team can use the WhatsApp inbox" });

  let b: any;
  try { b = await req.json(); } catch { return json(400, { error: "bad request" }); }
  const db = sb();
  const action = String(b.action || "");

  let contact: any = null;
  if (b.contact_id) {
    contact = (await db.from("wa_contacts").select("*").eq("id", b.contact_id).maybeSingle()).data;
    if (!contact) return json(404, { error: "chat not found" });
  }

  if (["read", "ai", "resolve", "reply", "media", "typing"].includes(action) && !contact) return json(400, { error: "pick a chat first" });

  if (action === "typing") {
    // WhatsApp shows "typing…" against the student's latest message, for up to 25 seconds or until we reply
    const last = contact.last_inbound_at ? Date.parse(contact.last_inbound_at) : 0;
    if (contact.opted_out || Date.now() - last > DAY) return json(200, { ok: false });
    const { data: m } = await db.from("wa_messages").select("twilio_sid").eq("contact_id", contact.id).eq("direction", "in")
      .not("twilio_sid", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (m?.twilio_sid) await twilioTyping(m.twilio_sid);
    return json(200, { ok: !!m?.twilio_sid });
  }

  if (action === "read") {
    await db.from("wa_contacts").update({ unread: 0 }).eq("id", contact.id);
    return json(200, { ok: true });
  }
  if (action === "ai") {
    await db.from("wa_contacts").update({ ai_on: !!b.on }).eq("id", contact.id);
    return json(200, { ok: true, ai_on: !!b.on });
  }
  if (action === "resolve") {
    await db.from("wa_contacts").update({ needs_human: false, handoff_reason: null, handoff_at: null, held_ack_at: null, unread: 0, resolved_at: new Date().toISOString() }).eq("id", contact.id);
    return json(200, { ok: true });
  }

  if (action === "reply") {
    const text = String(b.body || "").trim();
    if (!text) return json(400, { error: "type a message first" });
    if (contact.opted_out) return json(409, { error: "This student sent STOP. You can't message them until they reply START." });
    const last = contact.last_inbound_at ? Date.parse(contact.last_inbound_at) : 0;
    if (Date.now() - last > DAY) {
      return json(409, { error: "More than 24 hours since their last message — WhatsApp only allows an approved template now. Use “Send a template”.", needs_template: true });
    }
    const r = await sendAndLog(db, contact, { author: "staff", staffId: uid, body: text });
    // a person answered: the handover is being dealt with
    await db.from("wa_contacts").update({ unread: 0, assigned_to: contact.assigned_to || uid }).eq("id", contact.id);
    return r.ok ? json(200, { ok: true, id: r.id }) : json(502, { error: "WhatsApp didn't accept it: " + r.error });
  }

  if (action === "media") {
    const path = String(b.path || "");
    const type = String(b.type || "application/octet-stream").slice(0, 80);
    if (!/^out\/[\w\-./]+$/.test(path) || path.includes("..")) return json(400, { error: "bad file" });
    if (contact.opted_out) return json(409, { error: "This student sent STOP. You can't message them until they reply START." });
    const last = contact.last_inbound_at ? Date.parse(contact.last_inbound_at) : 0;
    if (Date.now() - last > DAY) return json(409, { error: "More than 24 hours since their last message — send a template first.", needs_template: true });
    const url = await signedUrl(db, path, 3600);
    if (!url) return json(400, { error: "couldn't read the uploaded file" });
    const caption = String(b.caption || "").trim();
    const r = await sendAndLog(db, contact, { author: "staff", staffId: uid, body: caption, mediaUrls: [url], media: [{ path, type, name: String(b.name || "").slice(0, 120) }] });
    await db.from("wa_contacts").update({ unread: 0, assigned_to: contact.assigned_to || uid }).eq("id", contact.id);
    return r.ok ? json(200, { ok: true, id: r.id }) : json(502, { error: "WhatsApp didn't accept it: " + r.error });
  }

  if (action === "template") {
    const key = String(b.key || "");
    const { data: t } = await db.from("wa_templates").select("*").eq("key", key).maybeSingle();
    if (!t?.content_sid) return json(400, { error: "unknown template" });
    if (t.approval !== "approved") return json(409, { error: `Meta hasn't approved “${key}” yet (status: ${t.approval || "not submitted"}).` });
    if (!contact) {
      const phone = e164(String(b.phone || ""));
      if (phone.length < 9) return json(400, { error: "enter the student's number with country code, e.g. +234…" });
      contact = (await db.from("wa_contacts").select("*").eq("phone", phone).maybeSingle()).data;
      if (!contact) {
        const { data: ctx } = await db.rpc("wa_person_context", { p_phone: phone });
        contact = (await db.from("wa_contacts").insert({ phone, wa_name: b.name || null, profile_id: ctx?.profile_id || null, lead_id: ctx?.lead_id || null }).select("*").single()).data;
      }
    }
    if (contact.opted_out) return json(409, { error: "This student sent STOP. You can't message them until they reply START." });
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.vars || {})) vars[k] = String(v ?? "").slice(0, 200);
    let preview = String(t.body || "");
    for (const [k, v] of Object.entries(vars)) preview = preview.split(`{{${k}}}`).join(v);
    const r = await sendAndLog(db, contact, { author: "template", staffId: uid, contentSid: t.content_sid, vars, templateKey: key, preview });
    return r.ok ? json(200, { ok: true, id: r.id, contact_id: contact.id }) : json(502, { error: "WhatsApp didn't accept it: " + r.error });
  }

  return json(400, { error: "unknown action" });
});
