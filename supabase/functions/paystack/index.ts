// Orbuni - Paystack (Nigeria) payments, in naira, for the same things Whop
// takes in dollars: { order_id } a student's service fee at order_due(), or
// { booking_id } an extra service at the booking's price, or
// { product: "masterclass" | "partner_program", email? } a course (v5 - works before
// the buyer has an account); optional { return_url }.
// Routes (verify_jwt = false — auth is done here):
//   POST {order_id|booking_id} + user JWT -> start a payment
//   POST {product, email?} (JWT optional) -> start a course payment (price is set HERE, never by the browser)
//   POST + x-paystack-signature (webhook, HMAC-SHA512 of the raw body) -> verify + paystack_settle()
//   GET ?verify=<reference> -> re-verify a payment (own payment with a JWT; a course payment by its secret reference)
//   GET ?ping=1 -> { on } (the checkout hides the option until Paystack is switched on)
//   POST + x-orb-secret (team self-test) -> is the key accepted? + a ₦100 test checkout link (never settled)
// Secret: PAYSTACK_SECRET_KEY. Naira rate cached 6 h in paystack_config (open.er-api.com).
// v6 (2 Oct 2026): the Paystack window opens on Card first.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const PS_KEY = env("PAYSTACK_SECRET_KEY").replace(/\s+/g, "");
const CRON_SECRET = env("ORB_CRON_SECRET");
const scrub = (x: unknown) => String(x)
  .replace(/sk_(live|test)_\w+/g, "[key]")
  .replace(/Bearer\s+[^\s"']+/g, "Bearer [key]");
const PS_API = "https://api.paystack.co";
const FX_API = "https://open.er-api.com/v6/latest/USD";
const FX_MAX_AGE_MS = 6 * 3600 * 1000;
const TIER_NAME: Record<string, string> = { essential: "Standard", complete: "Plus", arrival: "Premier" };
// Course prices - the same as the Whop plans. The browser only ever says WHICH course.
const COURSES: Record<string, { usd: number; title: string }> = {
  masterclass: { usd: 10, title: "The Scholarship Masterclass" },
  partner_program: { usd: 150, title: "Partner Growth Program" }
};
const UUID = /^[0-9a-f-]{36}$/;
const REF = /^orb_[A-Za-z0-9]{8,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const PH = () => ({ Authorization: `Bearer ${PS_KEY}`, "Content-Type": "application/json", Accept: "application/json" });
const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function safeReturn(u: unknown, fallback: string): string {
  try {
    const x = new URL(String(u || ""));
    const okProto = x.protocol === "https:" || (x.protocol === "http:" && x.hostname === "localhost");
    if (okProto && (/^(www\.)?myorbuni\.com$/.test(x.hostname) || x.hostname === "localhost")) return x.toString();
  } catch (_) { /* ignore */ }
  return fallback;
}

async function signedInUser(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await asUser.auth.getUser();
  return u?.user ?? null;
}

async function usdNgn(sb: ReturnType<typeof admin>): Promise<{ rate: number; buffer: number } | null> {
  const { data: rows } = await sb.from("paystack_config").select("key,value").in("key", ["usd_ngn", "usd_ngn_at", "fx_buffer_pct"]);
  const cfg: Record<string, string> = {};
  (rows ?? []).forEach((r: any) => { cfg[r.key] = r.value || ""; });
  const buffer = Math.max(0, Math.min(50, Number(cfg["fx_buffer_pct"]) || 0));
  const cached = Number(cfg["usd_ngn"]);
  const at = Date.parse(cfg["usd_ngn_at"] || "");
  const sane = (n: number) => Number.isFinite(n) && n > 100 && n < 100000;
  if (sane(cached) && Number.isFinite(at) && Date.now() - at < FX_MAX_AGE_MS) return { rate: cached, buffer };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(FX_API, { signal: ctl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (r.ok) {
      const b = await r.json();
      const rate = Number(b?.rates?.NGN);
      if (sane(rate)) {
        const now = new Date().toISOString();
        await sb.from("paystack_config").upsert([
          { key: "usd_ngn", value: String(rate), updated_at: now },
          { key: "usd_ngn_at", value: now, updated_at: now }
        ], { onConflict: "key" });
        return { rate, buffer };
      }
    }
  } catch (_) { /* fall through */ }
  if (sane(cached)) return { rate: cached, buffer };
  return null;
}

async function verifyAndSettle(sb: ReturnType<typeof admin>, reference: string): Promise<string> {
  const { data: pay } = await sb.from("paystack_payments").select("reference,status,amount_ngn").eq("reference", reference).maybeSingle();
  if (!pay) return "not_found";
  if (pay.status !== "pending") return pay.status;
  const r = await fetch(PS_API + "/transaction/verify/" + encodeURIComponent(reference), { headers: PH() });
  if (!r.ok) {
    console.error("paystack verify " + r.status + ": " + scrub(await r.text()).slice(0, 200));
    return "pending";
  }
  const b = await r.json();
  const d = b?.data ?? {};
  if (d.status !== "success") return d.status === "failed" || d.status === "abandoned" ? String(d.status) : "pending";
  if (String(d.reference) !== reference) return "pending";
  if (String(d.currency).toUpperCase() !== "NGN") { console.error("paystack " + reference + ": wrong currency"); return "pending"; }
  const paidKobo = Math.round(Number(d.amount));
  if (!(paidKobo >= Number(pay.amount_ngn) * 100)) { console.error("paystack " + reference + ": amount short"); return "pending"; }
  const { data: st, error } = await sb.rpc("paystack_settle", {
    p_reference: reference,
    p_paid_kobo: paidKobo,
    p_channel: String(d.channel || "").slice(0, 40) || null,
    p_paid_at: d.paid_at || d.paidAt || new Date().toISOString()
  });
  if (error) { console.error("paystack_settle " + reference + ": " + scrub(error.message).slice(0, 200)); return "pending"; }
  return String(st || "paid");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacSha512Hex(key: string, raw: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(raw)));
  return Array.from(sig, (x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ================= webhook =================
  const sigHeader = req.headers.get("x-paystack-signature");
  if (sigHeader !== null) {
    if (req.method !== "POST" || !PS_KEY) return new Response("no", { status: 401 });
    const raw = await req.text();
    const expected = await hmacSha512Hex(PS_KEY, raw);
    if (!safeEqual(expected, sigHeader.trim().toLowerCase())) return new Response("bad signature", { status: 401 });
    let evt: any = {};
    try { evt = JSON.parse(raw); } catch (_) { return new Response("ok", { status: 200 }); }
    const ref = String(evt?.data?.reference || "");
    if (evt?.event === "charge.success" && REF.test(ref)) {
      const work = verifyAndSettle(admin(), ref).catch((e) => console.error("paystack webhook: " + scrub(e).slice(0, 200)));
      const rt = (globalThis as any).EdgeRuntime;
      if (rt && typeof rt.waitUntil === "function") rt.waitUntil(work); else await work;
    }
    return new Response("ok", { status: 200 });
  }

  // ================= self-test (team only, cron secret): is the key accepted by Paystack? =================
  if (req.method === "POST" && CRON_SECRET && req.headers.get("x-orb-secret") === CRON_SECRET) {
    if (!PS_KEY) return json(200, { key_set: false });
    const rnd = new Uint8Array(6); crypto.getRandomValues(rnd);
    const reference = "orb-selftest-" + Array.from(rnd, (x) => x.toString(16).padStart(2, "0")).join("");
    const r = await fetch(PS_API + "/transaction/initialize", { method: "POST", headers: PH(), body: JSON.stringify({
      email: "payments@myorbuni.com", amount: 10000, currency: "NGN", reference, callback_url: "https://myorbuni.com/",
      channels: ["card", "bank_transfer", "ussd", "bank"], metadata: { selftest: true } }) });
    const b: any = await r.json().catch(() => ({}));
    return json(200, { key_set: true, mode: PS_KEY.startsWith("sk_live_") ? "live" : PS_KEY.startsWith("sk_test_") ? "test" : "unknown",
      accepted: !!(r.ok && b?.status), message: scrub(b?.message || "").slice(0, 200), authorization_url: b?.data?.authorization_url || null, reference });
  }

  // ================= routes =================
  const user = await signedInUser(req);   // null when the visitor has no account yet
  const sb = admin();

  if (req.method === "GET" && new URL(req.url).searchParams.get("ping")) return json(200, { on: !!PS_KEY });

  if (req.method === "GET") {
    const ref = new URL(req.url).searchParams.get("verify") || "";
    if (!REF.test(ref)) return json(400, { error: "Which payment?" });
    const { data: pay } = await sb.from("paystack_payments").select("reference,profile_id,status,product").eq("reference", ref).maybeSingle();
    if (!pay) return json(404, { error: "That payment is not yours." });
    const isOwner = !!user && pay.profile_id === user.id;
    if (!isOwner && !pay.product) return user ? json(404, { error: "That payment is not yours." }) : json(401, { error: "Sign in first." });
    if (pay.status !== "pending") return json(200, { status: pay.status });
    if (!PS_KEY) return json(200, { status: "pending", configured: false });
    try {
      return json(200, { status: await verifyAndSettle(sb, ref) });
    } catch (e) {
      return json(200, { status: "pending", error: scrub(e).slice(0, 200) });
    }
  }
  if (req.method !== "POST") return json(405, { error: "Not allowed." });

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const courseKey = String(body.product || "");
  if (!user && !courseKey) return json(401, { error: "Sign in first." });
  if (!PS_KEY) return json(200, { configured: false, error: "Paystack is not switched on yet." });

  let email = String(user?.email || "").trim();
  let usd = 0, orderId: string | null = null, bookingId: string | null = null, label = "", ret = "";
  let product: string | null = null;

  if (courseKey) {
    const course = COURSES[courseKey];
    if (!course) return json(400, { error: "Which course?" });
    if (!email) email = String(body.email || "").trim();
    email = email.toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) return json(400, { error: "Add the email you will use to read the course — Paystack sends the receipt there." });
    const { data: owned } = await sb.from("whop_payments").select("id").eq("tier", courseKey).eq("status", "paid")
      .eq("user_email", email).limit(1);
    if (owned && owned.length) return json(409, { error: "That email already has this course. Sign in with it to read." });
    const half = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count: mineRecent } = await sb.from("paystack_payments").select("id", { count: "exact", head: true })
      .eq("product", courseKey).eq("email", email).gte("created_at", half);
    if ((mineRecent ?? 0) >= 6) return json(429, { error: "Too many tries for this email — wait a few minutes, or pay in dollars." });
    const ten = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count: allRecent } = await sb.from("paystack_payments").select("id", { count: "exact", head: true })
      .not("product", "is", null).gte("created_at", ten);
    if ((allRecent ?? 0) >= 150) return json(429, { error: "Busy right now — please try again in a minute." });
    usd = course.usd;
    product = courseKey;
    label = courseKey;
    ret = safeReturn(body.return_url, "https://myorbuni.com/?paystack=paid");
  } else if (body.booking_id) {
    if (!email) return json(400, { error: "Add an email address to your account first — Paystack sends the receipt there." });
    const bid = String(body.booking_id);
    if (!UUID.test(bid)) return json(400, { error: "Which booking?" });
    const { data: b } = await sb.from("service_bookings").select("*").eq("id", bid).maybeSingle();
    if (!b || b.profile_id !== user!.id) return json(404, { error: "That booking is not yours." });
    if (b.status !== "pending_payment") return json(409, { error: "That booking is already " + String(b.status).replace("_", " ") + "." });
    usd = Math.round(Number(b.price) * 100) / 100;
    if (!(usd >= 1)) return json(400, { error: "Nothing to pay on this booking." });
    bookingId = bid;
    label = "extra";
    ret = safeReturn(body.return_url, "https://myorbuni.com/?paystack=paid");
  } else {
    if (!email) return json(400, { error: "Add an email address to your account first — Paystack sends the receipt there." });
    const oid = String(body.order_id || "");
    if (!UUID.test(oid)) return json(400, { error: "Which order?" });
    const { data: o } = await sb.from("student_orders").select("*").eq("id", oid).maybeSingle();
    if (!o || o.profile_id !== user!.id) return json(404, { error: "That order is not yours." });
    if (o.status !== "pending") return json(409, { error: "That order is already " + o.status + "." });
    if (!TIER_NAME[o.package_id]) return json(400, { error: "Unknown package." });
    const { data: wc } = await sb.from("whop_config").select("value").eq("key", "agreement_version").maybeSingle();
    const { data: agr } = await sb.from("agreement_acceptances").select("id").eq("profile_id", user!.id)
      .eq("doc", "service").eq("version", wc?.value || "").contains("context", { order_id: oid }).limit(1);
    if (!agr || !agr.length) return json(412, { error: "Please read and accept the Student Service Agreement first.", need_agreement: true });
    const { data: due, error: dueErr } = await sb.rpc("order_due", { p_order: oid });
    if (dueErr || due == null) return json(500, { error: "Could not work out the amount due." });
    usd = Math.round(Number(due) * 100) / 100;
    if (usd < 1) return json(400, { error: "Nothing to pay on this order." });
    if (Number(o.total) !== usd) await sb.from("student_orders").update({ total: usd }).eq("id", oid);
    orderId = oid;
    label = String(o.package_id);
    ret = safeReturn(body.return_url, "https://myorbuni.com/?paystack=paid");
  }

  const fx = await usdNgn(sb);
  if (!fx) return json(503, { error: "We couldn't get today's naira rate just now. Please try again in a few minutes, or pay in dollars." });
  const amountNgn = Math.ceil(usd * fx.rate * (1 + fx.buffer / 100));
  const amountKobo = amountNgn * 100;

  const rnd = new Uint8Array(12);
  crypto.getRandomValues(rnd);
  const reference = "orb_" + Array.from(rnd, (x) => x.toString(16).padStart(2, "0")).join("");

  const meta: Record<string, unknown> = { usd, rate: fx.rate, orbuni_tier: label };
  if (user) meta.profile_id = user.id;
  if (orderId) meta.order_id = orderId;
  if (bookingId) meta.booking_id = bookingId;
  if (product) { meta.product = product; meta.product_title = COURSES[product].title; }

  try {
    const r = await fetch(PS_API + "/transaction/initialize", { method: "POST", headers: PH(), body: JSON.stringify({
      email, amount: amountKobo, currency: "NGN", reference, callback_url: ret,
      // card first (Paystack opens on the first channel), then transfer, USSD, bank
      channels: ["card", "bank_transfer", "ussd", "bank"], metadata: meta }) });
    const txt = await r.text();
    let b: any = {};
    try { b = JSON.parse(txt); } catch (_) { /* not json */ }
    if (!r.ok || !b?.status || !b?.data?.authorization_url) {
      throw new Error("initialize " + r.status + ": " + scrub(b?.message || txt).slice(0, 240));
    }
    const { error: insErr } = await sb.from("paystack_payments").insert({
      reference, profile_id: user?.id ?? null, order_id: orderId, booking_id: bookingId,
      product, email: product ? email : null,
      amount_usd: usd, amount_ngn: amountNgn, rate: fx.rate, status: "pending",
      access_code: b.data.access_code || null, authorization_url: b.data.authorization_url
    });
    if (insErr) throw new Error("record: " + insErr.message);
    return json(200, { configured: true, reference, access_code: b.data.access_code || null,
                       authorization_url: b.data.authorization_url, amount_usd: usd, amount_ngn: amountNgn, rate: fx.rate });
  } catch (e) {
    const msg = scrub(e).slice(0, 240);
    console.error("paystack init: " + msg);
    return json(200, { configured: true, error: "Paystack could not start this payment. " + msg });
  }
});
