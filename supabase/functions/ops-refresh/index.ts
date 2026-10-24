// Orbuni - reads what the tools will actually tell a machine and writes it into ops_tools.
// Called by the Refresh button in the portal (signed-in admins only) and by the weekly brief.
//
// Secrets it uses, all optional except the service key:
//   RESEND_API_KEY     already set - domain status and how much has been sent
//   NETLIFY_TOKEN      a personal access token, if you want Netlify read live
//   NETLIFY_SITE       the site name, defaults to "orbuni"
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY  = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY     = env("SUPABASE_ANON_KEY");
const RESEND_KEY   = env("RESEND_API_KEY");
const NETLIFY_TOKEN= env("NETLIFY_TOKEN");
const NETLIFY_SITE = env("NETLIFY_SITE") || "orbuni";

const nf = (n: number) => n.toLocaleString("en-US");
const mb = (bytes: number) => bytes >= 1073741824
  ? (bytes / 1073741824).toFixed(2) + " GB"
  : (bytes / 1048576).toFixed(1) + " MB";

// Cross-origin call from myorbuni.com -> needs an explicit answer to the
// browser's OPTIONS preflight, or the browser blocks the real response and
// the page sees a bare network failure instead of whatever this returns.
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

  // Confirm the caller really is a member of staff, using THEIR token, not the service key.
  const asUser = createClient(SUPABASE_URL, ANON_KEY || "", {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false }
  });
  const { data: userWrap } = await asUser.auth.getUser();
  const uid = userWrap?.user?.id;
  if(!uid) return json(401, { error: "sign in first" });
  const { data: me } = await asUser.from("profiles").select("id, role").eq("id", uid).maybeSingle();
  if(!me || (me.role !== "admin" && me.role !== "staff")) return json(403, { error: "admins only" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }});
  const now = new Date().toISOString();
  const done: string[] = [];
  const couldNot: string[] = [];

  // ---------- Supabase: real size and real counts ----------
  try{
    const { data: size } = await sb.rpc("ops_database_size");
    const counts = await Promise.all([
      sb.from("programmes").select("id", { count:"exact", head:true }),
      sb.from("profiles").select("id", { count:"exact", head:true }),
      sb.from("documents").select("id", { count:"exact", head:true }),
      sb.from("messages").select("id", { count:"exact", head:true }),
    ]);
    const line = (size ? mb(Number(size)) + " of 500 MB used · " : "")
      + nf(counts[0].count ?? 0) + " programmes · "
      + nf(counts[1].count ?? 0) + " accounts · "
      + nf(counts[2].count ?? 0) + " documents · "
      + nf(counts[3].count ?? 0) + " messages";
    await sb.from("ops_tools").update({ usage_note: line, checked_at: now }).eq("name", "Supabase");
    done.push("Supabase");
  }catch(_e){ couldNot.push("Supabase"); }

  // ---------- Resend: is the domain still verified, how much has gone out ----------
  if(RESEND_KEY){
    try{
      const r = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${RESEND_KEY}` }});
      let domainLine = "";
      if(r.ok){
        const j = await r.json();
        // deno-lint-ignore no-explicit-any
        const d = (j?.data ?? []).find((x: any) => x.name === "myorbuni.com") ?? (j?.data ?? [])[0];
        if(d) domainLine = `${d.name} ${d.status}`;
      }else{ couldNot.push(`Resend (${r.status})`); }
      const sent = await sb.from("email_outbox").select("id", { count:"exact", head:true })
        .not("sent_at", "is", null);
      const waiting = await sb.from("email_outbox").select("id", { count:"exact", head:true })
        .is("sent_at", null);
      const alerts = await sb.from("notification_recipients").select("notification_id", { count:"exact", head:true })
        .not("email_sent_at", "is", null);
      const patch: Record<string, unknown> = {
        usage_note: [domainLine,
          nf((sent.count ?? 0) + (alerts.count ?? 0)) + " emails sent",
          (waiting.count ?? 0) + " waiting"].filter(Boolean).join(" · "),
        checked_at: now
      };
      if(domainLine) patch.status = domainLine.includes("verified") ? "live" : "expiring";
      await sb.from("ops_tools").update(patch).eq("name", "Resend");
      if(domainLine) done.push("Resend");
    }catch(_e){ couldNot.push("Resend"); }
  }else{ couldNot.push("Resend (no key)"); }

  // ---------- Netlify: only if a token has been provided ----------
  if(NETLIFY_TOKEN){
    try{
      const r = await fetch(`https://api.netlify.com/api/v1/sites/${NETLIFY_SITE}.netlify.app`, {
        headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` }});
      if(r.ok){
        const s = await r.json();
        const dev = await sb.from("push_subscriptions").select("id", { count:"exact", head:true });
        await sb.from("ops_tools").update({
          usage_note: [
            s.published_deploy?.published_at
              ? "last deployed " + new Date(s.published_deploy.published_at).toISOString().slice(0,10)
              : null,
            s.ssl_url ? "HTTPS on" : null,
            (dev.count ?? 0) + " devices on notifications"
          ].filter(Boolean).join(" · "),
          checked_at: now
        }).eq("name", "Netlify");
        done.push("Netlify");
      }else{ couldNot.push(`Netlify (${r.status})`); }
    }catch(_e){ couldNot.push("Netlify"); }
  }else{
    // No token: still report what we can see from our own side.
    const dev = await sb.from("push_subscriptions").select("id", { count:"exact", head:true });
    await sb.from("ops_tools").update({
      usage_note: "site is live · " + (dev.count ?? 0) + " devices on notifications",
      checked_at: now
    }).eq("name", "Netlify");
    couldNot.push("Netlify billing (needs NETLIFY_TOKEN)");
  }

  couldNot.push("Squarespace, Google Workspace and Meta have no readable API - those stay manual");

  return json(200, { refreshed: done, could_not: couldNot, at: now });
});
