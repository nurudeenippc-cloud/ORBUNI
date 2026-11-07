// The team on WhatsApp (7 Nov 2026).
// A message from a team member's own number never reaches the student AI. It goes to the team
// assistant (orbuni-assistant, "__wa" mode) acting as that person, with the same permissions as in the
// portal. Every draft it makes (lead update, task, email, …) comes back as its own message with
// Approve / Reject buttons. Admins can approve lead updates, tasks and emails right here; anything
// else is approved in the portal (the message links there).
import { sb, sendAndLog, twilioSend, SUPABASE_URL } from "./wa.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const CRON = env("ORB_CRON_SECRET");
const TW_SID = env("TWILIO_ACCOUNT_SID").trim();
const TW_TOKEN = env("TWILIO_AUTH_TOKEN").trim();
type DB = ReturnType<typeof sb>;
type Contact = { id: string; phone: string };

const APPROVABLE = new Set(["lead_update", "add_task", "send_email"]);
const PORTAL = "https://myorbuni.com/#portal=admin";

// One reusable "Approve / Reject" button message per draft text (Twilio content, cached in wa_content_cache).
async function approveContent(db: DB, text: string, approvable: boolean): Promise<string | null> {
  const body = text.trim().slice(0, 1000);
  const actions = approvable
    ? [{ title: "Approve", id: "ai_approve" }, { title: "Reject", id: "ai_reject" }]
    : [{ title: "Reject", id: "ai_reject" }];
  const types = { "twilio/quick-reply": { body, actions }, "twilio/text": { body } };
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("team:" + JSON.stringify(types)))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data: hit } = await db.from("wa_content_cache").select("content_sid").eq("hash", hash).maybeSingle();
  if (hit?.content_sid) return hit.content_sid;
  const r = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(TW_SID + ":" + TW_TOKEN), "Content-Type": "application/json" },
    body: JSON.stringify({ friendly_name: "orb_team_" + hash.slice(0, 12), language: "en", types }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !j.sid) return null;
  await db.from("wa_content_cache").upsert({ hash, content_sid: j.sid, kind: "team" });
  return j.sid;
}

const KIND_WORD: Record<string, string> = { lead_update: "Lead update", add_task: "New task", send_email: "Email", record: "Finance entry",
  add_tool: "Add to The Stack", update_tool: "Update The Stack", add_application: "Application", file_document: "File a document", askuni_send: "Send to AskUni" };

// ------------------------------------------------------------ a message from a team member
export async function teamAnswer(contactId: string, staffId: string) {
  const db = sb();
  await new Promise((r) => setTimeout(r, 3000));          // let a burst of short messages land
  const { data: contact } = await db.from("wa_contacts").select("id,phone").eq("id", contactId).single();
  if (!contact) return;
  const { data: rows } = await db.from("wa_messages").select("direction,body,created_at").eq("contact_id", contactId)
    .order("created_at", { ascending: false }).limit(14);
  const msgs = (rows || []).reverse().filter((m) => (m.body || "").trim() && !/^\[template/.test(m.body || ""));
  // the newest run of their messages is the question; everything before is the history
  let i = msgs.length; while (i > 0 && msgs[i - 1].direction === "in") i--;
  const question = msgs.slice(i).map((m) => m.body).join("\n").trim();
  if (!question) return;
  const history = msgs.slice(0, i).map((m) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.body }));

  const r = await fetch(SUPABASE_URL + "/functions/v1/orbuni-assistant", {
    method: "POST", signal: AbortSignal.timeout(140000),
    headers: { "content-type": "application/json", "x-orb-secret": CRON },
    body: JSON.stringify({ section: "__wa", as_profile: staffId, message: question, history }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) } as unknown as Response));
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.reply) {
    await sendAndLog(db, contact as Contact, { author: "ai", body: "Sorry, the Orbuni assistant couldn't answer just now. Try again in a minute, or use the assistant in the portal: " + PORTAL });
    return;
  }
  await sendAndLog(db, contact as Contact, { author: "ai", body: String(out.reply).slice(0, 1550) });

  const { data: me } = await db.from("profiles").select("role").eq("id", staffId).maybeSingle();
  const admin = me?.role === "admin";
  for (const p of (out.proposals || []) as any[]) {
    if (!p?.ai_action_id) continue;
    const can = admin && APPROVABLE.has(p.action);
    const text = `📝 *${KIND_WORD[p.action] || "Draft"}*\n${String(p.summary || "").slice(0, 600)}` +
      (can ? "" : `\n\nApprove this one in the portal: ${PORTAL}`);
    const csid = await approveContent(db, text, can);
    await new Promise((x) => setTimeout(x, 1200));
    const sent = csid ? await sendAndLog(db, contact as Contact, { author: "ai", contentSid: csid, body: text, buttons: [{ ai_action_id: p.ai_action_id }] })
                      : await sendAndLog(db, contact as Contact, { author: "ai", body: text + (can ? "\n\nReply *approve* or *reject*." : ""), buttons: [{ ai_action_id: p.ai_action_id }] });
    if (!sent.ok) console.warn("team draft send failed", sent.error);
  }
}

// ------------------------------------------------------------ Approve / Reject
// From a button (ButtonPayload ai_approve / ai_reject, on the draft message it replied to) or a typed
// "approve" / "reject" (the newest draft still waiting).
export async function teamDecide(contact: Contact, staffId: string, decision: "approve" | "reject", repliedSid: string | null) {
  const db = sb();
  let actionId: string | null = null;
  if (repliedSid) {
    const { data: m } = await db.from("wa_messages").select("buttons").eq("twilio_sid", repliedSid).maybeSingle();
    actionId = (Array.isArray(m?.buttons) ? m!.buttons : []).map((b: any) => b?.ai_action_id).find(Boolean) || null;
  }
  if (!actionId) {
    const { data: last } = await db.from("ai_actions").select("id").eq("created_by", staffId).eq("status", "proposed")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    actionId = last?.id || null;
  }
  const say = (t: string) => sendAndLog(db, contact, { author: "ai", body: t });
  if (!actionId) return say("There's nothing waiting for your OK right now.");
  const { data: a } = await db.from("ai_actions").select("id,status,proposal,summary,created_by").eq("id", actionId).maybeSingle();
  if (!a) return say("I couldn't find that draft any more.");
  if (a.status !== "proposed") return say(`That one is already ${a.status}.`);

  if (decision === "reject") {
    await db.from("ai_actions").update({ status: "rejected", reviewed_by: staffId, reviewed_at: new Date().toISOString() }).eq("id", a.id);
    return say("❌ Rejected. Nothing was changed.");
  }
  const { data: me } = await db.from("profiles").select("role,first_name").eq("id", staffId).maybeSingle();
  const p = a.proposal || {};
  if (me?.role !== "admin" || !APPROVABLE.has(p.action)) return say("This one needs the portal to approve: " + PORTAL);

  let table: string | null = null, rid: string | null = null, err: string | null = null, done = "";
  if (p.action === "lead_update") {
    const patch: Record<string, unknown> = {};
    if (p.stage) patch.stage = p.stage;
    if (p.stage === "lost") patch.lost_reason = p.lost_reason || "Marked lost via Orbuni AI";
    if (p.next_action_on) patch.next_action_at = p.next_action_on + "T09:00:00+03:00";
    if (p.owner_id) patch.owner_id = p.owner_id;
    if (Object.keys(patch).length) { const r = await db.from("leads").update(patch).eq("id", p.lead_id); if (r.error) err = r.error.message; }
    if (!err && p.note) { const r = await db.from("lead_events").insert({ lead_id: p.lead_id, kind: "note", body: p.note, actor_id: staffId }); if (r.error) err = r.error.message; }
    table = "leads"; rid = p.lead_id; done = "Lead updated.";
  } else if (p.action === "add_task") {
    const r = await db.from("project_tasks").insert({ project_id: p.project_id, title: p.title, team: p.team || "admissions", assignee_id: p.assignee_id || null, due_on: p.due_on || null, status: "todo" }).select("id").single();
    if (r.error) err = r.error.message; else { table = "project_tasks"; rid = r.data.id; done = "Task added."; }
  } else if (p.action === "send_email") {
    if (!p.to_email) err = "no address on the draft";
    else {
      // queued like every other Orbuni email; send-student-emails sends it within two minutes
      const r = await db.from("email_outbox").insert({ to_email: p.to_email, profile_id: p.profile_id || null, template: "custom_notice",
        vars: { first_name: p.first_name || "", subject: p.subject, body: p.body } }).select("id").single();
      if (r.error) err = r.error.message; else { table = "email_outbox"; rid = r.data.id; done = `Email to ${p.to_email} is on its way (within 2 minutes).`; }
    }
  }
  if (err) return say("⚠️ That didn't go through: " + err.slice(0, 200));
  await db.from("ai_actions").update({ status: "approved", reviewed_by: staffId, reviewed_at: new Date().toISOString(), result_table: table, result_id: rid }).eq("id", a.id);
  return say("✅ Approved. " + done);
}

export { twilioSend };
