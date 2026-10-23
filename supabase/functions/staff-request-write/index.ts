import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY     = env("SUPABASE_ANON_KEY");

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

  const auth = req.headers.get("Authorization") || "";
  if(!auth.startsWith("Bearer ")) return json(401, { error: "sign in first" });

  let body: any;
  try{ body = await req.json(); }catch{ return json(400, { error: "bad request" }); }
  const action = body.action;

  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global:{ headers:{ Authorization: auth } }, auth:{ persistSession:false } });
  const { data: userWrap } = await asUser.auth.getUser();
  const uid = userWrap?.user?.id;
  if(!uid) return json(401, { error: "sign in first" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

  if(action === "submit"){
    const { data: me } = await sb.from("profiles").select("id,role").eq("id", uid).maybeSingle();
    if(!me || (me.role !== "staff" && me.role !== "admin"))
      return json(403, { error: "this is for people on the Orbuni team" });

    const kind = body.kind;
    if(!["payout","expense","leave"].includes(kind)) return json(400, { error: "what kind of request is this?" });

    const row: Record<string, unknown> = {
      profile_id: uid, kind, status: "pending",
      description: body.description || null,
      currency: body.currency || "USD",
    };
    if(kind === "expense"){
      const amount = Number(body.amount);
      if(!(amount > 0)) return json(400, { error: "enter an amount above zero" });
      row.amount = amount;
    }
    if(kind === "leave"){
      if(!body.start_date || !body.end_date) return json(400, { error: "pick a start and end date" });
      if(new Date(body.end_date) < new Date(body.start_date)) return json(400, { error: "the end date is before the start date" });
      row.start_date = body.start_date; row.end_date = body.end_date;
    }
    const { data: inserted, error } = await sb.from("staff_requests").insert(row).select().single();
    if(error) return json(400, { error: error.message });
    return json(200, { ok: true, request: inserted });
  }

  if(action === "decide"){
    const { data: canFinance } = await asUser.rpc("can_manage_section", { p_section: "finance" });
    if(!canFinance) return json(403, { error: "you don't have finance access" });

    const id = body.id;
    const decision = body.decision;
    if(!["approved","declined","done"].includes(decision)) return json(400, { error: "unknown decision" });
    const { data: existing } = await sb.from("staff_requests").select("*").eq("id", id).maybeSingle();
    if(!existing) return json(404, { error: "that request no longer exists" });

    const { error: updErr } = await sb.from("staff_requests").update({
      status: decision, decided_by: uid, decided_at: new Date().toISOString(),
      decision_note: body.note || null,
    }).eq("id", id);
    if(updErr) return json(400, { error: updErr.message });

    let transaction: unknown = null;
    if(decision === "approved" && existing.kind === "expense"){
      const { data: tx, error: txErr } = await sb.from("finance_transactions").insert({
        kind: "expense", direction: "out", amount: existing.amount, currency: existing.currency,
        status: "pending", beneficiary_id: existing.profile_id,
        description: "Expense claim: " + (existing.description || ""),
        occurred_on: new Date().toISOString().slice(0,10), source: "manual", created_by: uid,
      }).select().single();
      if(txErr) return json(200, { ok: true, warning: "Approved, but recording the expense in the ledger failed: " + txErr.message });
      transaction = tx;
    }
    return json(200, { ok: true, transaction });
  }

  return json(400, { error: "unknown action" });
});
