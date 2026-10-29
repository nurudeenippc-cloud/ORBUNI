import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY     = env("SUPABASE_ANON_KEY");

// The site calls this cross-origin (myorbuni.com -> supabase.co), so the
// browser preflights with OPTIONS. Without these headers on every response
// (including the preflight) the browser blocks the real response and
// supabase-js reports "Failed to send a request to the Edge Function" --
// a network failure, never reaching our own 401/403/400 checks below.
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

  const { data: canFinance } = await asUser.rpc("can_manage_section", { p_section: "finance" });
  if(!canFinance) return json(403, { error: "you don't have finance access" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

  if(action === "record"){
    const kind = body.kind;
    const amount = Number(body.amount);
    if(!["income","commission_payout","salary","expense","adjustment"].includes(kind))
      return json(400, { error: "what kind of entry is this?" });
    if(!(amount > 0)) return json(400, { error: "amount must be more than zero" });

    let direction = body.direction;
    if(kind === "income") direction = "in";
    else if(kind !== "adjustment") direction = "out";
    if(direction !== "in" && direction !== "out") return json(400, { error: "which direction is this money moving?" });

    if(kind === "salary" && !body.beneficiary_id) return json(400, { error: "which teammate is this salary for?" });
    if(kind === "commission_payout" && !body.partner_id && !body.beneficiary_id) return json(400, { error: "which partner or teammate is this commission for?" });

    const row: Record<string, unknown> = {
      kind, direction, amount,
      currency: body.currency || "USD",
      status: body.status || (kind === "income" ? "recorded" : "pending"),
      partner_id: body.partner_id || null,
      beneficiary_id: body.beneficiary_id || null,
      application_id: body.application_id || null,
      description: body.description || null,
      occurred_on: body.occurred_on || new Date().toISOString().slice(0,10),
      source: "manual",
      created_by: uid,
    };
    // Idempotency: the portal sends one request_id per save. A repeat (double tap, retried
    // request) returns the entry already recorded instead of adding a second one.
    const requestId = typeof body.request_id === "string" && body.request_id.trim()
      ? body.request_id.trim().slice(0, 120) : null;
    const already = async () => {
      if(!requestId) return null;
      const { data } = await sb.from("finance_transactions").select().eq("client_request_id", requestId).maybeSingle();
      return data;
    };
    const earlier = await already();
    if(earlier) return json(200, { ok: true, transaction: earlier, duplicate: true });
    if(requestId) row.client_request_id = requestId;

    const { data: inserted, error: insErr } = await sb.from("finance_transactions").insert(row).select().single();
    if(insErr){
      if(insErr.code === "23505"){  // the same request won a race a moment earlier
        const first = await already();
        if(first) return json(200, { ok: true, transaction: first, duplicate: true });
      }
      return json(400, { error: insErr.message });
    }

    let warning: string | null = null;
    let payout: unknown = null;
    if(kind === "income" && body.partner_id){
      const { data: tier } = await sb.rpc("commission_rate_for", { p_amount: amount }).maybeSingle<{ rule_id: string; rate_pct: number }>();
      if(tier && tier.rate_pct != null){
        const payAmount = Math.round(Number(amount) * Number(tier.rate_pct)) / 100;
        const { data: payoutRow, error: poErr } = await sb.from("finance_transactions").insert({
          kind: "commission_payout", direction: "out", amount: payAmount, currency: row.currency,
          status: "pending", partner_id: body.partner_id, application_id: body.application_id || null,
          source_transaction_id: inserted.id, commission_rule_id: tier.rule_id, rate_pct: tier.rate_pct,
          description: "Auto-calculated at " + tier.rate_pct + "% of " + row.currency + " " + Number(amount).toFixed(2),
          occurred_on: row.occurred_on, source: "automatic", created_by: uid,
        }).select().single();
        if(poErr) warning = "Income recorded, but the automatic commission payout failed: " + poErr.message;
        else payout = payoutRow;
      } else {
        warning = "Income recorded, but no commission rule covers " + row.currency + " " + Number(amount).toFixed(2) + " yet — add one, or record the partner's payout by hand.";
      }
    }
    return json(200, { ok: true, transaction: inserted, payout, warning });
  }

  if(action === "mark_paid" || action === "void"){
    const id = body.id;
    if(!id) return json(400, { error: "which entry?" });
    const { data: existing } = await sb.from("finance_transactions").select("id,status").eq("id", id).maybeSingle();
    if(!existing) return json(404, { error: "that entry no longer exists" });
    if(action === "mark_paid" && existing.status !== "pending")
      return json(400, { error: "only a pending entry can be marked paid" });
    const newStatus = action === "mark_paid" ? "paid" : "void";
    const { error: updErr } = await sb.from("finance_transactions").update({ status: newStatus }).eq("id", id);
    if(updErr) return json(400, { error: updErr.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
});
