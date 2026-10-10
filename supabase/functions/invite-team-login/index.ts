// Orbuni — emails a teammate their login link.
//
// Why this exists: new STUDENT accounts are paused, so the public "create account"
// screen is closed. Someone the owner has added to the team (team_invites) still
// needs a way in, and a way to get a fresh link if the first one expired.
//
// What it does, and nothing else:
//   - email has a PENDING team invite  -> Supabase's own invite email (they pick their password)
//   - email belongs to a staff/admin account that never signed in -> the invitation is re-sent
//   - anything else -> does nothing
// The answer is always the same ({ok:true}), so nobody can use it to find out who is on the team.
// It never sees or sets a password. Roles and sections come from handle_new_user() in the database.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SITE_URL = env("SITE_URL") || "https://myorbuni.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let email = "";
  try { email = String((await req.json())?.email ?? "").trim().toLowerCase(); } catch { return json(400, { error: "bad request" }); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(400, { error: "That does not look like an email address." });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const { data: inv } = await sb.from("team_invites").select("id").eq("email", email).is("accepted_at", null).maybeSingle();
    if (inv) {
      const { error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL });
      if (error) console.warn("invite failed", error.message.slice(0, 120));
      return json(200, { ok: true });
    }
    const { data: prof } = await sb.from("profiles").select("id, role").eq("email", email).in("role", ["staff", "admin"]).maybeSingle();
    if (prof) {
      const { data: u } = await sb.auth.admin.getUserById(prof.id);
      if (u?.user && !u.user.last_sign_in_at) {
        // Still unconfirmed: Supabase re-sends the same invitation. Confirmed but never signed in: a password-setup link.
        const { error } = u.user.email_confirmed_at
          ? await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL + "/?reset=1" })
          : await sb.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL });
        if (error) console.warn("resend failed", error.message.slice(0, 120));
      }
    }
  } catch (e) {
    console.warn("invite-team-login", String(e).slice(0, 120));
  }
  return json(200, { ok: true });
});
