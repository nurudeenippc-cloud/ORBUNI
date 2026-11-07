// Orbuni - the staff "Whop" hub inside the Orbuni portal. Reads the ORBUNI
// account on Whop (never writes) so the team sees money, products, members,
// courses, ads and verification without leaving myorbuni.com.
//
// POST { part: "overview" | "payments" | "products" | "members" | "ads" | "courses" | "affiliates" }
//      { part: "ads_pause" | "ads_unpause", id }   owner only
//      { part: "forum_list" }                       recent posts in the Orbuni Community forum
//      { part: "forum_post", title, content, notify, images? } owner, or whoever manages Reach
//        images: up to 6 picture URLs on myorbuni.com or Orbuni's own Supabase
//        storage — each is copied into Whop's file store and attached.
// Staff only (public.is_staff()). Each part is fetched on its own so one slow
// or failing Whop endpoint never blanks the whole page.
// Secrets: WHOP_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
// Pasted keys sometimes carry a line break or spaces — strip all whitespace.
const WHOP_KEY = env("WHOP_API_KEY").replace(/\s+/g, "");
// Never let a key reach a log, a table or a browser inside an error message.
const scrub = (x: unknown) => String(x).replace(/apik_[A-Za-z0-9_]+/g, "[key]").replace(/Bearer\s+[^\s"']+/g, "Bearer [key]");
const ACC = env("WHOP_ACCOUNT_ID") || "biz_340OHdZOPCa81N";
const API = "https://api.whop.com/api/v1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function whop(path: string) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${WHOP_KEY}`, Accept: "application/json" } });
  if (!r.ok) throw new Error(path.split("?")[0] + " → " + r.status + " " + scrub(await r.text()).slice(0, 160));
  return await r.json();
}
const day = (d: Date) => d.toISOString().slice(0, 10);
async function safe<T>(f: () => Promise<T>, errs: string[]): Promise<T | null> {
  try { return await f(); } catch (e) { errs.push(scrub(e).slice(0, 220)); return null; }
}
async function stat(key: string, from: string, to: string, errs: string[], extra = "") {
  return await safe(() => whop(`/stats/${key}?account_id=${ACC}&from=${from}&to=${to}&interval=day&convert_to=usd${extra}`), errs);
}

// Copy one picture that already lives on an Orbuni host into Whop's file
// store and return the file id to attach. Only our own hosts are fetched, so
// this can never be pointed at an arbitrary URL.
const IMG_HOSTS = /^https:\/\/(myorbuni\.com|www\.myorbuni\.com|ytsebzdykfeiiuxbdtvr\.supabase\.co\/storage\/v1\/object\/public)\//;
async function whopUpload(url: string): Promise<string | null> {
  if (!IMG_HOSTS.test(url)) return null;
  const img = await fetch(url);
  if (!img.ok) return null;
  const type = (img.headers.get("content-type") || "image/jpeg").split(";")[0];
  if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
  const bytes = new Uint8Array(await img.arrayBuffer());
  if (bytes.length > 12e6) return null;
  const ext = type.split("/")[1].replace("jpeg", "jpg");
  const f = await fetch(API + "/files", { method: "POST",
    headers: { Authorization: `Bearer ${WHOP_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ filename: "orbuni-" + Date.now() + "." + ext, visibility: "public" }) });
  if (!f.ok) return null;
  const fj: any = await f.json();
  if (!fj?.upload_url) return null;
  const put = await fetch(fj.upload_url, { method: "PUT", headers: fj.upload_headers || { "Content-Type": type }, body: bytes });
  if (!put.ok) return null;
  for (let i = 0; i < 10; i++) {
    try { const g: any = await whop("/files/" + fj.id); if (g.upload_status === "ready") return fj.id; if (g.upload_status === "failed") return null; } catch (_) { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  return fj.id;
}

// Which Whop endpoints the saved key can reach — status codes only, no data,
// so it is safe without signing in (used to check a new key end to end).
let HEALTH: { at: number; out: Record<string, number> } | null = null;
async function health() {
  if (HEALTH && Date.now() - HEALTH.at < 60000) return HEALTH.out;   // at most one check a minute
  const to = day(new Date()), from = day(new Date(Date.now() - 6 * 864e5));
  const paths: Record<string, string> = {
    account: `/accounts/${ACC}`, payments: `/payments?account_id=${ACC}&first=1`,
    products: `/products?account_id=${ACC}&first=1`, memberships: `/memberships?account_id=${ACC}&first=1`,
    stats: `/stats/gross_revenue?account_id=${ACC}&from=${from}&to=${to}&interval=day`,
    ads: `/ad_campaigns?account_id=${ACC}&first=1`, affiliates: `/affiliates?account_id=${ACC}&first=1`,
    courses: `/course_lessons?course_id=cors_7P4zRQoutwOto&first=1`
  };
  const out: Record<string, number> = {};
  await Promise.all(Object.entries(paths).map(async ([k, p]) => {
    try { const r = await fetch(API + p, { headers: { Authorization: `Bearer ${WHOP_KEY}`, Accept: "application/json" } }); out[k] = r.status; await r.body?.cancel(); }
    catch (_) { out[k] = 0; }
  }));
  HEALTH = { at: Date.now(), out };
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let peek: any = {};
  try { peek = await req.clone().json(); } catch (_) { /* empty */ }
  if (peek.part === "health") return json(200, { configured: !!WHOP_KEY, status: WHOP_KEY ? await health() : {} });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in first." });
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return json(401, { error: "Sign in first." });
  const { data: staff } = await asUser.rpc("is_staff");
  if (staff !== true) return json(403, { error: "Only the Orbuni team can open this." });
  if (!WHOP_KEY) return json(200, { configured: false, error: "Whop is not connected yet — the WHOP_API_KEY secret is missing in Supabase." });

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const part = String(body.part || "overview");
  // Parts that return money data also need finance access (or the owner).
  if (["overview", "payments", "members", "affiliates", "ads"].includes(part)) {
    const { data: fin } = await asUser.rpc("can_open", { p_section: "finance" });
    if (fin !== true) {
      const { data: me } = await asUser.from("profiles").select("is_owner").eq("id", u.user.id).maybeSingle();
      if (!me?.is_owner) return json(403, { error: "Finance access needed." });
    }
  }
  const errs: string[] = [];
  const now = new Date(), from30 = day(new Date(Date.now() - 29 * 864e5)), to = day(now);

  if (part === "overview") {
    const [acc, revenue, pays, users, visits] = await Promise.all([
      safe(() => whop(`/accounts/${ACC}`), errs),
      stat("gross_revenue", from30, to, errs),
      stat("successful_payments", from30, to, errs),
      stat("new_users", from30, to, errs),
      stat("page_visits", from30, to, errs)
    ]);
    const a: any = acc || {};
    return json(200, {
      configured: true, errs,
      account: acc ? {
        title: a.title, status: a.status, route: a.route, website: a.website,
        capabilities: a.capabilities || {}, required_actions: a.required_actions || [],
        recommended_actions: (a.recommended_actions || []).slice(0, 6),
        verification: a.verification || null,
        balance: (a.balances || []).find((b: any) => b.symbol === "USD") || null,
        total_usd: a.total_usd ?? null
      } : null,
      revenue, payments: pays, users, visits
    });
  }
  if (part === "payments") {
    const p = await safe(() => whop(`/payments?account_id=${ACC}&first=25&order=created_at&direction=desc`), errs);
    return json(200, { configured: true, errs, data: (p as any)?.data ?? [] });
  }
  if (part === "products") {
    const p: any = await safe(() => whop(`/products?account_id=${ACC}&first=50`), errs);
    return json(200, { configured: true, errs, data: p?.data ?? [] });
  }
  if (part === "members") {
    const m: any = await safe(() => whop(`/memberships?account_id=${ACC}&first=50&order=created_at&direction=desc`), errs);
    return json(200, { configured: true, errs, data: m?.data ?? [] });
  }
  if (part === "ads") {
    const [c, spend]: any[] = await Promise.all([
      safe(() => whop(`/ad_campaigns?account_id=${ACC}&first=25&stats_from=${from30}&stats_to=${to}`), errs),
      stat("ad_spend", from30, to, errs)
    ]);
    return json(200, { configured: true, errs, campaigns: c?.data ?? [], spend });
  }
  if (part === "courses") {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: cfg } = await sb.from("whop_config").select("key,value").like("key", "course_%");
    const out: any[] = [];
    for (const row of cfg ?? []) {
      const s: any = await safe(() => whop(`/course_students?course_id=${encodeURIComponent(row.value)}&first=100`), errs);
      const students = s?.data ?? [];
      out.push({ key: row.key.replace("course_", ""), id: row.value, students: students.length,
                 completed: students.filter((x: any) => (x.completion_rate ?? x.completed_lessons_count ?? 0) >= 100).length });
    }
    return json(200, { configured: true, errs, data: out });
  }
  if (part === "ads_pause" || part === "ads_unpause") {
    // Turning a paid campaign on or off moves money, so only the owner can do it from here.
    const { data: me } = await asUser.from("profiles").select("is_owner").eq("id", u.user.id).maybeSingle();
    if (!me?.is_owner) return json(403, { error: "Only the owner can switch campaigns on or off." });
    const id = String(body.id || "");
    if (!/^[A-Za-z0-9_]{4,64}$/.test(id)) return json(400, { error: "Which campaign?" });
    const act = part === "ads_pause" ? "pause" : "unpause";
    const r = await fetch(`${API}/ad_campaigns/${encodeURIComponent(id)}/${act}`, { method: "POST",
      headers: { Authorization: `Bearer ${WHOP_KEY}`, "Content-Type": "application/json", Accept: "application/json" }, body: "{}" });
    if (!r.ok) return json(200, { configured: true, ok: false, error: "Whop said " + r.status + ": " + scrub(await r.text()).slice(0, 160) });
    return json(200, { configured: true, ok: true, campaign: await r.json().catch(() => null) });
  }
  if (part === "forum_list" || part === "forum_post") {
    const sbs = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: fc } = await sbs.from("whop_config").select("value").eq("key", "community_forum").maybeSingle();
    const exp = String(fc?.value || "").trim();
    if (!/^exp_[A-Za-z0-9]{6,40}$/.test(exp)) return json(200, { configured: true, ok: false, error: "No community forum is set (whop_config.community_forum)." });
    if (part === "forum_list") {
      const f: any = await safe(() => whop(`/forum_posts?experience_id=${exp}&first=12`), errs);
      return json(200, { configured: true, errs, experience: exp, data: f?.data ?? [] });
    }
    const { data: me } = await asUser.from("profiles").select("is_owner").eq("id", u.user.id).maybeSingle();
    const { data: canReach } = await asUser.rpc("can_manage_section", { p_section: "reach" });
    if (!me?.is_owner && canReach !== true) return json(403, { error: "Only the owner, or whoever runs Reach, can post to the community." });
    const title = String(body.title || "").trim().slice(0, 140);
    const content = String(body.content || "").trim().slice(0, 8000);
    if (content.length < 2) return json(400, { error: "Write the post first." });
    const urls: string[] = (Array.isArray(body.images) ? body.images : []).map((x: unknown) => String(x)).filter((x: string) => IMG_HOSTS.test(x)).slice(0, 6);
    const ids = (await Promise.all(urls.map((x) => whopUpload(x).catch(() => null)))).filter(Boolean) as string[];
    const r = await fetch(`${API}/forum_posts`, { method: "POST",
      headers: { Authorization: `Bearer ${WHOP_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ experience_id: exp, title: title || null, content, is_mention: body.notify === true,
        attachments: ids.length ? ids.map((id) => ({ id })) : undefined }) });
    if (!r.ok) return json(200, { configured: true, ok: false, error: "Whop said " + r.status + ": " + scrub(await r.text()).slice(0, 200) });
    const post = await r.json().catch(() => null);
    return json(200, { configured: true, ok: true, images: ids.length, of: urls.length, post: post ? { id: post.id, title: post.title } : null });
  }
  if (part === "affiliates") {
    const a: any = await safe(() => whop(`/affiliates?account_id=${ACC}&first=50`), errs);
    return json(200, { configured: true, errs, data: a?.data ?? [] });
  }
  return json(400, { error: "Unknown part." });
});
