// Orbuni — the "Stop these emails" link at the bottom of follow-up emails.
// GET  ?e=<email>&t=<token>  → redirects to myorbuni.com/unsubscribe.html, which asks
//                               "Stop follow-up emails?" with a button
// POST ?e=<email>&t=<token>  → records the opt-out (the page's button, and Gmail's
//                               one-click "Unsubscribe", per RFC 8058)
// The token is an HMAC of the address made in the database (public.optout_token),
// so nobody can stop someone else's emails. Public: no sign-in.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

const CORS = { "Access-Control-Allow-Origin": "https://myorbuni.com", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Vary": "Origin" };
const out = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

Deno.serve(async (req: Request) => {
  if(req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(req.url);
  const e = String(u.searchParams.get("e") || "").trim().toLowerCase().slice(0, 200);
  const t = String(u.searchParams.get("t") || "").trim();
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && /^[0-9a-f]{32}$/.test(t);
  // Opening the link sends the person to a confirmation page on myorbuni.com
  // (Supabase won't serve web pages from this address, and a mail scanner
  // following the link must not unsubscribe anyone).
  if(req.method === "GET"){
    const to = "https://myorbuni.com/unsubscribe.html" + (ok ? "?e=" + encodeURIComponent(e) + "&t=" + t : "");
    return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
  }
  if(req.method !== "POST") return out(405, { error: "POST only" });
  if(!ok) return out(400, { error: "This link isn't complete." });
  const { data, error } = await sb.rpc("email_optout_apply", { p_email: e, p_token: t });
  if(error || data !== true) return out(400, { error: "We couldn't confirm this link." });
  return out(200, { ok: true });
});
