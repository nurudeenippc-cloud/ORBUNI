// Orbuni — sends a student their sign-in invite, after a partner or staff
// member has created their account through the "Create a student" wizard.
//
// The wizard writes everything it collects (contact details, personal and
// academic info, chosen programmes, and already-uploaded document paths)
// straight into a `pending_students` row using the caller's own session —
// normal RLS covers that, no service key needed. This function's only job
// is the one step that DOES need the service key: actually creating the
// student's login and sending them the email to set their own password.
//
// It never sees or sets a password — Supabase's own invite flow handles
// that when the student clicks the link. Once handle_new_user() (the DB
// trigger) sees the new auth user and matches it to this pending row, it
// copies over student_details / documents / applications server-side.
// The one piece the trigger cannot do is move the actual file bytes, so
// this function does that immediately after the invite succeeds.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY     = env("SUPABASE_ANON_KEY");
const SITE_URL     = env("SITE_URL") || "https://myorbuni.com";

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

  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "sign in first" });

  let body: { pending_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: "bad request" }); }
  const pendingId = body.pending_id;
  if (!pendingId) return json(400, { error: "which student?" });

  // Confirm the caller really is signed in, using THEIR token.
  const asUser = createClient(SUPABASE_URL, ANON_KEY || "", {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false }
  });
  const { data: userWrap } = await asUser.auth.getUser();
  const uid = userWrap?.user?.id;
  if (!uid) return json(401, { error: "sign in first" });
  const { data: me } = await asUser.from("profiles").select("id, role").eq("id", uid).maybeSingle();
  if (!me || (me.role !== "admin" && me.role !== "staff" && me.role !== "partner")) {
    return json(403, { error: "only staff and approved partners can do this" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: pending, error: pErr } = await sb.from("pending_students").select("*").eq("id", pendingId).maybeSingle();
  if (pErr || !pending) return json(404, { error: "that draft no longer exists" });

  // A partner may only send invites for a student they themselves created;
  // staff and admins may send for anyone's draft.
  const isStaff = me.role === "admin" || me.role === "staff";
  if (!isStaff && pending.created_by !== uid) {
    return json(403, { error: "that draft belongs to someone else" });
  }
  if (pending.status !== "invited") {
    return json(400, { error: pending.status === "claimed" ? "this student already has a login" : "this draft has expired" });
  }
  if (!pending.email) return json(400, { error: "this draft has no email address on file" });

  const { data: already } = await sb.from("profiles").select("id").ilike("email", pending.email).maybeSingle();
  if (already) return json(400, { error: "That email address already has an account on Orbuni." });

  const { error: inviteErr } = await sb.auth.admin.inviteUserByEmail(pending.email, { redirectTo: SITE_URL });
  if (inviteErr) {
    const msg = /already been registered|already exists/i.test(inviteErr.message)
      ? "That email address already has an account on Orbuni."
      : inviteErr.message;
    return json(400, { error: msg });
  }

  // handle_new_user() ran synchronously as part of the invite above — the
  // pending row is now claimed and the documents rows point at their final
  // new.id/<file> paths. The bytes themselves are still sitting at the old
  // pending/<id>/<file> path, so move each one across now.
  const { data: claimed } = await sb.from("pending_students").select("claimed_profile_id, documents").eq("id", pendingId).maybeSingle();
  const newId = claimed?.claimed_profile_id;
  const moveWarnings: string[] = [];
  if (newId && Array.isArray(claimed?.documents)) {
    for (const doc of claimed.documents as any[]) {
      if (!doc?.storage_path || !doc?.final_name) continue;
      const { error: moveErr } = await sb.storage.from("documents").move(doc.storage_path, `${newId}/${doc.final_name}`);
      if (moveErr) moveWarnings.push(`${doc.original_name || doc.final_name}: ${moveErr.message}`);
    }
  }

  return json(200, { ok: true, sent_to: pending.email, warnings: moveWarnings });
});
