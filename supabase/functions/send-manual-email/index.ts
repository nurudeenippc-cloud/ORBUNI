// Orbuni — the "Send an email" composer's backend. A staff member picks a
// student, teammate or partner, a template, fills in a few fields, hits
// Preview (renders the exact email, sends nothing), then Send (sends it
// for real, right away — this does NOT go through the email_outbox queue
// the way the automatic system emails do, since a human is standing right
// there waiting for it to go out, not two minutes from now).
// Secrets (shared project-wide with send-student-emails — no need to add
// them twice): RESEND_API_KEY, RESEND_FROM, RESEND_REPLY_TO
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { render } from "./mail.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY     = env("SUPABASE_ANON_KEY");
const RESEND_KEY   = env("RESEND_API_KEY");
const RESEND_FROM  = env("RESEND_FROM") || "Orbuni <onboarding@resend.dev>";
const REPLY_TO     = env("RESEND_REPLY_TO");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown){
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if(req.method !== "POST") return json(405, { error: "POST only" });

  const auth = req.headers.get("Authorization") || "";
  if(!auth.startsWith("Bearer ")) return json(401, { error: "sign in first" });

  let body: any;
  try{ body = await req.json(); }catch{ return json(400, { error: "bad request" }); }

  const to_email = String(body.to_email || "").trim();
  const template = String(body.template || "");
  const vars = body.vars && typeof body.vars === "object" ? body.vars : {};
  const preview = !!body.preview;

  if(!template) return json(400, { error: "pick a template" });
  if(!preview && !to_email) return json(400, { error: "pick who this is for" });

  // Same section-access check every other write in the portal goes through —
  // an admin or anyone Nurudeen has explicitly granted the "comms" section to.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: userWrap } = await asUser.auth.getUser();
  const uid = userWrap?.user?.id;
  if(!uid) return json(401, { error: "sign in first" });
  const { data: canSend } = await asUser.rpc("can_manage_section", { p_section: "comms" });
  if(!canSend) return json(403, { error: "you don't have access to send emails" });

  const built = render(template, vars);
  if(!built) return json(400, { error: "unknown template \"" + template + "\"" });

  if(preview){
    return json(200, { subject: built.subject, html: built.html });
  }

  if(!RESEND_KEY){
    return json(500, { error: "Email sending isn't switched on yet — add a RESEND_API_KEY secret in Supabase (Edge Functions → Secrets), same as for send-student-emails." });
  }

  const payload: Record<string, unknown> = { from: RESEND_FROM, to: [to_email], subject: built.subject, html: built.html };
  if(REPLY_TO) payload.reply_to = REPLY_TO;

  let resendRes: Response;
  try{
    resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }catch(e){
    return json(502, { error: "couldn't reach the email service right now — try again in a moment" });
  }

  if(!resendRes.ok){
    const why = resendRes.status + ": " + (await resendRes.text()).slice(0, 300);
    return json(502, { error: "the email service turned this down", detail: why });
  }

  // Logged into the SAME table the automatic emails use, with sent_at set
  // immediately — so this shows up in the same place if anyone ever builds
  // a "sent emails" history view, indistinguishable from a queued one
  // except that it went out the moment Send was clicked.
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  await sb.from("email_outbox").insert({
    to_email, template, vars, sent_at: new Date().toISOString(),
    profile_id: body.profile_id || null,
  });

  return json(200, { ok: true, subject: built.subject });
});