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

  const { data: canRules } = await asUser.rpc("can_manage_section", { p_section: "finance-rules" });
  if(!canRules) return json(403, { error: "you cannot change the commission rules" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth:{ persistSession:false } });

  if(action === "save"){
    const label = String(body.label || "").trim();
    const min_amount = Number(body.min_amount);
    const max_amount = (body.max_amount === null || body.max_amount === "" || body.max_amount === undefined) ? null : Number(body.max_amount);
    const rate_pct = Number(body.rate_pct);
    if(!label) return json(400, { error: "give this tier a name" });
    if(!(min_amount >= 0)) return json(400, { error: "the minimum amount can't be negative" });
    if(max_amount !== null && !(max_amount > min_amount)) return json(400, { error: "the maximum must be more than the minimum" });
    if(!(rate_pct >= 0 && rate_pct <= 100)) return json(400, { error: "the rate must be between 0 and 100" });

    if(body.id){
      const { error } = await sb.from("commission_rules")
        .update({ label, min_amount, max_amount, rate_pct, updated_at: new Date().toISOString() })
        .eq("id", body.id);
      if(error) return json(400, { error: error.message });
    } else {
      const { error } = await sb.from("commission_rules")
        .insert({ label, min_amount, max_amount, rate_pct, created_by: uid });
      if(error) return json(400, { error: error.message });
    }
    return json(200, { ok: true });
  }

  if(action === "deactivate"){
    if(!body.id) return json(400, { error: "which tier?" });
    const { error } = await sb.from("commission_rules").update({ active: false }).eq("id", body.id);
    if(error) return json(400, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "unknown action" });
});
