// Orbuni - pulls payments from Whop into public.whop_payments.
// A trigger on that table mirrors each paid payment into Finance exactly once
// and matches the payer to their Orbuni account by email.
// Since 24 Sep 2026 it also pulls Whop "leads" — people who reached Whop's own
// checkout page and typed their email but didn't pay — into
// public.whop_checkout_leads, so the follow-up emails can reach them too.
//
// Called three ways:
//   - pg_cron every 10 minutes, with header x-orb-secret = ORB_CRON_SECRET
//   - a staff member pressing "Sync Whop now" in the portal (their own JWT)
//   - a student landing back on the portal after paying (their own JWT,
//     throttled to one run a minute so it can never be used to hammer Whop)
// Secrets: WHOP_API_KEY (company API key from whop.com > Developer), ORB_CRON_SECRET
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const CRON_SECRET = env("ORB_CRON_SECRET");
// Pasted keys sometimes carry a line break or spaces — strip all whitespace.
const WHOP_KEY = env("WHOP_API_KEY").replace(/\s+/g, "");
// Never let a key reach a log, a table or a browser inside an error message.
const scrub = (x: unknown) => String(x).replace(/apik_[A-Za-z0-9_]+/g, "[key]").replace(/Bearer\s+[^\s"']+/g, "Bearer [key]");
const WHOP_ACCOUNT = env("WHOP_ACCOUNT_ID") || "biz_340OHdZOPCa81N";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-orb-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function tierOf(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("premier")) return "premier";
  if (t.includes("plus")) return "plus";
  if (t.includes("standard")) return "standard";
  if (t.includes("masterclass")) return "masterclass";
  // The Verified Partner subscription (Oct 2026) must not be read as the
  // Partner Growth Program course — a trigger turns it into a partner plan.
  if (t.includes("verified partner")) return "partner_verified";
  if (t.includes("partner")) return "partner_program";
  return "other";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // --- who is calling ---
  const given = req.headers.get("x-orb-secret") || "";
  let allowed = !!CRON_SECRET && given === CRON_SECRET;
  if (!allowed) {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json(403, { error: "Sign in first." });
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false }
    });
    const { data: u } = await asUser.auth.getUser();
    if (!u?.user) return json(403, { error: "Sign in first." });
    const { data: staff } = await asUser.rpc("is_staff");
    if (staff !== true) {
      const { data: last } = await sb.from("whop_sync_log").select("ran_at").order("id", { ascending: false }).limit(1).maybeSingle();
      if (last && Date.now() - new Date(last.ran_at).getTime() < 60000) {
        return json(200, { configured: !!WHOP_KEY, throttled: true });
      }
    }
    allowed = true;
  }
  if (!allowed) return json(403, { error: "Not allowed." });

  if (!WHOP_KEY) {
    await sb.from("whop_sync_log").insert({ ok: false, fetched: 0, upserted: 0, note: "WHOP_API_KEY not set" });
    return json(200, { configured: false, error: "The Whop API key has not been added yet (Supabase secret WHOP_API_KEY)." });
  }

  let after: string | null = null, fetched = 0, upserted = 0, pages = 0;
  // Whop dropped the updated_after filter (Sep 2026), so read newest first:
  // the latest 300 payments each run (refunds on recent ones included), and
  // up to 1,000 on the very first run.
  const { data: lastOk } = await sb.from("whop_sync_log").select("ran_at").eq("ok", true).order("id", { ascending: false }).limit(1).maybeSingle();
  const maxPages = lastOk ? 3 : 10;
  const problems: string[] = [];
  try {
    while (pages < maxPages) {
      const u = new URL("https://api.whop.com/api/v1/payments");
      u.searchParams.set("account_id", WHOP_ACCOUNT);
      u.searchParams.set("first", "100");
      u.searchParams.set("order", "created_at");
      u.searchParams.set("direction", "desc");
      if (after) u.searchParams.set("after", after);
      const r = await fetch(u, { headers: { Authorization: `Bearer ${WHOP_KEY}`, Accept: "application/json" } });
      if (!r.ok) { problems.push(`${r.status}: ${scrub(await r.text()).slice(0, 300)}`); break; }
      const body = await r.json();
      const rows = (body.data ?? []) as any[];
      fetched += rows.length;
      if (rows.length) {
        const mapped = rows.map((p) => ({
          id: p.id,
          status: p.status ?? null,
          substatus: p.substatus ?? null,
          // Adaptive pricing lets people pay in naira, cedis…; the ledger is in USD.
          amount: p.usd_total ?? p.total ?? p.subtotal ?? null,
          refunded_amount: (p.usd_total != null && p.total && p.refunded_amount)
            ? Math.round(Number(p.refunded_amount) * Number(p.usd_total) / Number(p.total) * 100) / 100
            : (p.refunded_amount ?? 0),
          currency: p.usd_total != null ? "usd" : (p.currency ?? "usd"),
          product_id: p.product?.id ?? null,
          product_title: p.product?.title ?? null,
          plan_id: p.plan?.id ?? null,
          tier: tierOf(p.product?.title ?? ""),
          user_email: p.user?.email ?? null,
          user_name: p.user?.name ?? p.user?.username ?? null,
          paid_at: p.paid_at ?? null,
          created_at: p.created_at ?? null,
          synced_at: new Date().toISOString(),
          raw: p
        }));
        const { error } = await sb.from("whop_payments").upsert(mapped, { onConflict: "id" });
        if (error) problems.push(error.message); else upserted += mapped.length;
      }
      pages++;
      if (!body.page_info?.has_next_page) break;
      after = body.page_info.end_cursor;
    }
  } catch (e) {
    problems.push(scrub(e).slice(0, 300));
  }

  // --- Whop checkout leads (last 7 days, newest first). A failure here never
  // blocks the payments sync above; it is only noted in the log.
  let leads = 0;
  try {
    const u = new URL("https://api.whop.com/api/v1/leads");
    u.searchParams.set("company_id", WHOP_ACCOUNT);
    u.searchParams.set("account_id", WHOP_ACCOUNT);
    u.searchParams.set("first", "100");
    u.searchParams.set("created_after", new Date(Date.now() - 7 * 864e5).toISOString());
    const r = await fetch(u, { headers: { Authorization: `Bearer ${WHOP_KEY}`, Accept: "application/json" } });
    if (!r.ok) problems.push(`leads ${r.status}: ${scrub(await r.text()).slice(0, 200)}`);
    else {
      const body = await r.json();
      const rows = ((body.data ?? []) as any[]).map((l) => {
        const email = l.user?.email ?? l.email ?? l.member?.email ?? null;
        const title = l.product?.title ?? l.access_pass?.title ?? null;
        return {
          id: l.id, email: email ? String(email).toLowerCase() : null,
          name: l.user?.name ?? l.user?.username ?? l.name ?? null,
          product_id: l.product?.id ?? l.access_pass?.id ?? null, product_title: title, tier: tierOf(title ?? ""),
          created_at: l.created_at ?? null, synced_at: new Date().toISOString(), raw: l
        };
      }).filter((x) => x.id);
      if (rows.length) {
        const { error } = await sb.from("whop_checkout_leads").upsert(rows, { onConflict: "id" });
        if (error) problems.push("leads: " + error.message); else leads = rows.length;
      }
    }
  } catch (e) {
    problems.push("leads: " + scrub(e).slice(0, 200));
  }

  // lead problems are reported but don't mark the payments sync as failed
  const payProblems = problems.filter((p) => !p.startsWith("leads"));
  await sb.from("whop_sync_log").insert({ ok: payProblems.length === 0, fetched, upserted, note: problems.join(" | ").slice(0, 900) || null });
  return json(200, { configured: true, fetched, upserted, leads, problems });
});
