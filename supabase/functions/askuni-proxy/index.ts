// Orbuni — the "Send to AskUni" and "Check AskUni" buttons' backend. Keeps
// askuni-bot's INTERNAL_SHARED_SECRET off the public website: the portal
// calls this function with normal Supabase auth, and only this function
// (server-side) talks to askuni-bot.
//
// Actions (v2, 24 Sep 2026):
//   start    { application_id }                         -> opens AskUni; returns submission_id,
//                                                         session_id, needs_login, live view urls
//   continue { application_id, session_id, submission_id } -> carry on (after a login or a hand fix);
//                                                         returns at once, progress is in askuni_submissions
//   cancel   { session_id, submission_id }              -> closes the AskUni window
//   check    {}                                         -> reads decisions + commissions from AskUni
// Secrets: ASKUNI_BOT_SECRET (= askuni-bot's INTERNAL_SHARED_SECRET), ASKUNI_BOT_URL (optional).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const BOT = env("ASKUNI_BOT_URL") || "https://askuni-bot.onrender.com";
const SECRET = env("ASKUNI_BOT_SECRET");
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "sign in first" });
  let body: any; try { body = await req.json(); } catch { return json(400, { error: "bad request" }); }
  const action = String(body.action || "");
  if (!["start", "continue", "cancel", "check"].includes(action)) return json(400, { error: "unknown action" });
  const application_id = String(body.application_id || "");
  const session_id = String(body.session_id || "");
  const submission_id = String(body.submission_id || "");
  if ((action === "start" || action === "continue") && !UUID.test(application_id)) return json(400, { error: "application_id required" });
  if ((action === "continue" || action === "cancel") && !/^[\w-]{8,80}$/.test(session_id)) return json(400, { error: "session_id required" });
  if (submission_id && !UUID.test(submission_id)) return json(400, { error: "bad submission_id" });

  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: w } = await asUser.auth.getUser();
  const uid = w?.user?.id;
  if (!uid) return json(401, { error: "sign in first" });
  const { data: can } = await asUser.rpc("can_manage_section", { p_section: "applications" });
  const { data: me } = await asUser.from("profiles").select("is_owner").eq("id", uid).maybeSingle();
  if (!can && !me?.is_owner) return json(403, { error: "you don't have access to send applications to AskUni" });
  if (!SECRET) return json(500, { error: "askuni-bot isn't wired up — add the ASKUNI_BOT_SECRET secret in Supabase." });

  const path = action === "start" ? "/submissions" : action === "check" ? "/check-responses"
    : "/submissions/" + encodeURIComponent(session_id) + "/" + action;
  let r: Response;
  try {
    r = await fetch(BOT + path, { method: "POST", signal: AbortSignal.timeout(action === "check" ? 140000 : 90000),
      headers: { "content-type": "application/json", "x-internal-secret": SECRET },
      body: JSON.stringify({ application_id, submission_id: submission_id || undefined, staff_id: uid }) });
  } catch (_e) {
    return json(502, { error: "Couldn't reach the AskUni helper — it may be waking up (about 30 seconds). Try again in a moment." });
  }
  let out: any = null; try { out = await r.json(); } catch {}
  if (!r.ok) return json(r.status, { error: (out && out.error) || ("askuni-bot returned " + r.status), submission_id: out && out.submission_id });
  return json(200, out);
});
