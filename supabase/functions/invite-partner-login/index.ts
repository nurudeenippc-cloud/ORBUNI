// Orbuni — sends an approved partner their sign-in invite.
// Called by the "Send them their login" button in Partner requests. Admins only.
//
// This does not decide what role the invitee gets: that comes from
// handle_new_user() matching their email against an *approved* row in the
// partners table, server-side, at the moment they accept the invite and set
// a password. This function's only job is to trigger Supabase's own invite
// email — it never sees or sets a password.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY     = env("SUPABASE_ANON_KEY");
const SITE_URL     = env("SITE_URL") || "https://myorbuni.com";

// The site (myorbuni.com) calls this function from a different origin than
// supabase.co, so the browser sends a CORS preflight (OPTIONS) first because
// the request carries an Authorization header and a JSON body. Without these
// headers the browser blocks even a successful response and supabase-js
// surfaces it to the page as "Failed to send a request to the Edge Function"
// — a network-level failure, not a 401/403/400 from our own checks below.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown){
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("Authorization") || "";
  if(!auth.startsWith("Bearer ")) return json(401, { error: "sign in first" });

  let body: { partner_id?: string };
  try{ body = await req.json(); }catch{ return json(400, { error: "bad request" }); }
  const partnerId = body.partner_id;
  if(!partnerId) return json(400, { error: "which partner?" });

  // Confirm the caller really is a member of staff, using THEIR token.
  const asUser = createClient(SUPABASE_URL, ANON_KEY || "", {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false }
  });
  const { data: userWrap } = await asUser.auth.getUser();
  const uid = userWrap?.user?.id;
  if(!uid) return json(401, { error: "sign in first" });
  const { data: me } = await asUser.from("profiles").select("id, role").eq("id", uid).maybeSingle();
  if(!me || (me.role !== "admin" && me.role !== "staff")) return json(403, { error: "admins only" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }});

  const { data: partner, error: pErr } = await sb.from("partners").select("*").eq("id", partnerId).maybeSingle();
  if(pErr || !partner) return json(404, { error: "that partner request no longer exists" });
  if(partner.status !== "approved") return json(400, { error: "approve them first" });
  if(!partner.email) return json(400, { error: "this application has no email address on file" });

  // Already has a login? Don't send a second invite that could confuse them.
  const { data: already } = await sb.from("profiles").select("id").eq("partner_id", partnerId).maybeSingle();
  if(already) return json(400, { error: "they already have a login" });

  const { error: inviteErr } = await sb.auth.admin.inviteUserByEmail(partner.email, {
    redirectTo: SITE_URL
  });
  if(inviteErr){
    // Supabase returns this when the address already has an account (of any role).
    const msg = /already been registered|already exists/i.test(inviteErr.message)
      ? "That email address already has an account on Orbuni."
      : inviteErr.message;
    return json(400, { error: msg });
  }

  await sb.from("partners").update({ login_invited_at: new Date().toISOString() }).eq("id", partnerId);

  return json(200, { ok: true, sent_to: partner.email });
});
