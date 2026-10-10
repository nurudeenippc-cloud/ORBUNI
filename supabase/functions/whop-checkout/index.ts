// Orbuni - prepares a Whop checkout that opens INSIDE myorbuni.com (Whop's
// embedded checkout), for:
//   { order_id }      a student's service fee (Standard / Plus / Premier), at the exact
//                     amount due (package + extras - cashback, from order_due()).
//                     Requires the Student Service Agreement for this order.
//   { booking_id }    an extra service the student booked (airport pickup, escort…),
//                     at the price stored on the booking by book_extra().
//   { product: "masterclass" | "partner_program" }   a course, for the signed-in person
//   { partner_tier: "verified" | "growth" | "pro" | "max" }   a Verified Partner monthly plan,
//                     for the signed-in agency (agency id in the metadata)
// plus optional { return_url } (must be on myorbuni.com or localhost).
//
// -> { configured, session, plan_id, url, amount, parts }
// Whop caps one payment at whop_config.max_one_payment (2500 today): above
// it, a hidden 2-part plan is made (half now, half in 30 days, then it stops).
// Every checkout offers the payment methods in PMC (card, M-Pesa, Nigerian bank
// transfer / USSD / cards, OPay, bank wire, PayPal, crypto) plus Whop's defaults.
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
const TIER: Record<string, string> = { essential: "standard", complete: "plus", arrival: "premier" };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const H = () => ({ Authorization: `Bearer ${WHOP_KEY}`, "Content-Type": "application/json", Accept: "application/json" });
// Payment methods offered on every Orbuni checkout (Whop adds its own defaults for the buyer's country too).
const PMC = { enabled: ["card", "apple_pay", "google_pay", "m_pesa", "ng_bank_transfer", "ng_bank", "ng_card", "ng_ussd", "ng_wallet", "ng_market",
                        "opay", "verve", "bank_wire", "paypal", "crypto"], disabled: [], include_platform_defaults: true };
const planFromLink = (u: string) => (String(u || "").match(/plan_[A-Za-z0-9]+/) || [""])[0];

function safeReturn(u: unknown, fallback: string): string {
  try {
    const x = new URL(String(u || ""));
    const okProto = x.protocol === "https:" || (x.protocol === "http:" && x.hostname === "localhost");
    if (okProto && (/^(www\.)?myorbuni\.com$/.test(x.hostname) || x.hostname === "localhost")) return x.toString();
  } catch (_) { /* ignore */ }
  return fallback;
}

async function makeCheckout(body: Record<string, unknown>) {
  const withPm: Record<string, unknown> = { payment_method_configuration: PMC, ...body };
  if (withPm.plan && typeof withPm.plan === "object") withPm.plan = { payment_method_configuration: PMC, ...(withPm.plan as Record<string, unknown>) };
  const r = await fetch(API + "/checkout_configurations", { method: "POST", headers: H(), body: JSON.stringify(withPm) });
  if (!r.ok) throw new Error("checkout " + r.status + ": " + scrub(await r.text()).slice(0, 300));
  const cc = await r.json();
  return { session: cc.id || "", plan_id: cc.plan?.id || (body.plan_id as string) || "", url: cc.purchase_url || "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in first." });
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return json(401, { error: "Sign in first." });

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: cfgRows } = await sb.from("whop_config").select("key,value");
  const cfg: Record<string, string> = {};
  (cfgRows ?? []).forEach((r: any) => { cfg[r.key] = r.value || ""; });

  // ---------- a Verified Partner plan (monthly), for the signed-in agency ----------
  // The agency id travels in the payment's metadata, so the plan switches on
  // even when they pay with a different email (trigger whop_payment_match_partner).
  if (body.partner_tier) {
    const tier = String(body.partner_tier);
    const PLAN: Record<string, string> = { verified: "plan_QkbDz7cq98h8q", growth: "plan_m0amEOKZhd1H7", pro: "plan_L980IT6ghiKXP", max: "plan_FQpB8zywWjsJ5" };
    if (!PLAN[tier]) return json(400, { error: "Unknown plan." });
    const url = "https://whop.com/checkout/" + PLAN[tier] + "/";
    const { data: pid } = await asUser.rpc("my_partner_id");
    if (!pid) return json(403, { error: "This sign-in is not linked to an approved agency yet." });
    const ret = safeReturn(body.return_url, "https://myorbuni.com/?whop=paid&pkg=partner_" + tier + "#portal=partner:settings");
    if (!WHOP_KEY) return json(200, { configured: false, plan_id: PLAN[tier], url });
    try {
      const c = await makeCheckout({ mode: "payment", plan_id: PLAN[tier], redirect_url: ret,
        metadata: { orbuni_partner_id: String(pid), orbuni_profile_id: u.user.id, orbuni_tier: tier, orbuni_kind: "partner_subscription" } });
      return json(200, { configured: true, ...c, plan_id: c.plan_id || PLAN[tier], amount: null, parts: 1 });
    } catch (e) {
      return json(200, { configured: false, plan_id: PLAN[tier], url, error: scrub(e).slice(0, 200) });
    }
  }

  // ---------- a course ----------
  if (body.product) {
    const key = String(body.product);
    if (!["masterclass", "partner_program"].includes(key)) return json(400, { error: "Unknown product." });
    const plan = planFromLink(cfg["checkout_" + key]);
    if (!plan) return json(200, { configured: false, error: "This course is not on sale yet." });
    const ret = safeReturn(body.return_url, "https://myorbuni.com/?whop=paid&pkg=" + key);
    if (!WHOP_KEY) return json(200, { configured: false, plan_id: plan, url: cfg["checkout_" + key] });
    try {
      const c = await makeCheckout({ mode: "payment", plan_id: plan, redirect_url: ret,
        metadata: { orbuni_profile_id: u.user.id, orbuni_tier: key } });
      return json(200, { configured: true, ...c, plan_id: c.plan_id || plan, amount: null, parts: 1 });
    } catch (e) {
      return json(200, { configured: false, plan_id: plan, url: cfg["checkout_" + key], error: scrub(e).slice(0, 200) });
    }
  }

  // ---------- an extra service booking ----------
  if (body.booking_id) {
    const bid = String(body.booking_id);
    if (!/^[0-9a-f-]{36}$/.test(bid)) return json(400, { error: "Which booking?" });
    const { data: b } = await sb.from("service_bookings").select("*").eq("id", bid).maybeSingle();
    if (!b || b.profile_id !== u.user.id) return json(404, { error: "That booking is not yours." });
    if (b.status !== "pending_payment") return json(409, { error: "That booking is already " + b.status.replace("_", " ") + "." });
    const amount = Math.round(Number(b.price) * 100) / 100;
    if (!(amount >= 1)) return json(400, { error: "Nothing to pay on this booking." });
    const productId = cfg["product_extras"] || "";
    if (!WHOP_KEY || !productId) return json(200, { configured: false, error: "Extra services cannot be paid online yet — your counsellor will send the link." });
    const { data: ad } = await sb.from("service_addons").select("name").eq("id", b.addon_id).maybeSingle();
    const meta = { orbuni_booking_id: bid, orbuni_profile_id: b.profile_id, orbuni_tier: "extra", orbuni_addon: b.addon_id };
    const ret = safeReturn(body.return_url, "https://myorbuni.com/?whop=paid&pkg=extra#portal=student:extras");
    try {
      const c = await makeCheckout({ mode: "payment", metadata: meta, redirect_url: ret,
        plan: { account_id: ACC, product_id: productId, currency: "usd", plan_type: "one_time",
                initial_price: amount, visibility: "hidden", title: String(ad?.name || "Orbuni extra service").slice(0, 80) } });
      return json(200, { configured: true, ...c, amount, parts: 1 });
    } catch (e) {
      return json(200, { configured: false, amount, error: scrub(e).slice(0, 240) });
    }
  }

  // ---------- a service fee ----------
  const orderId = String(body.order_id || "");
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return json(400, { error: "Which order?" });
  const { data: o } = await sb.from("student_orders").select("*").eq("id", orderId).maybeSingle();
  if (!o || o.profile_id !== u.user.id) return json(404, { error: "That order is not yours." });
  if (o.status !== "pending") return json(409, { error: "That order is already " + o.status + "." });
  const tier = TIER[o.package_id];
  if (!tier) return json(400, { error: "Unknown package." });

  // the agreement must be accepted, for this order, in this version
  const { data: agr } = await sb.from("agreement_acceptances").select("id").eq("profile_id", u.user.id)
    .eq("doc", "service").eq("version", cfg["agreement_version"] || "").contains("context", { order_id: orderId }).limit(1);
  if (!agr || !agr.length) return json(412, { error: "Please read and accept the Student Service Agreement first.", need_agreement: true });

  const { data: due, error: dueErr } = await sb.rpc("order_due", { p_order: orderId });
  if (dueErr || due == null) return json(500, { error: "Could not work out the amount due." });
  const amount = Math.round(Number(due) * 100) / 100;
  if (amount < 1) return json(400, { error: "Nothing to pay on this order." });
  if (Number(o.total) !== amount) await sb.from("student_orders").update({ total: amount }).eq("id", orderId);

  const productId = cfg["product_" + tier] || "";
  const maxOne = Number(cfg["max_one_payment"]) || 2500;
  const split = amount > maxOne;
  const half = Math.round(amount * 50) / 100;
  const fixedPlan = planFromLink(split ? cfg["checkout_premier_2pay"] : cfg["checkout_" + tier]);
  if (!WHOP_KEY || !productId) {
    // Not connected yet: the fixed plan still works when the total is the plain price.
    return json(200, { configured: false, plan_id: fixedPlan, amount, parts: split ? 2 : 1,
                       error: WHOP_KEY ? "The Whop product for this package is not set yet." : "Whop is not connected yet." });
  }
  const meta = { orbuni_order_id: orderId, orbuni_profile_id: o.profile_id, orbuni_tier: tier, orbuni_parts: split ? "2" : "1" };
  const ret = safeReturn(body.return_url, "https://myorbuni.com/?whop=paid&pkg=" + tier + "#portal=student:pay");
  try {
    let c;
    if (split) {
      const pr = await fetch(API + "/plans", { method: "POST", headers: H(), body: JSON.stringify({
        account_id: ACC, product_id: productId, currency: "usd", plan_type: "renewal",
        billing_period: 30, initial_price: 0, renewal_price: half, split_pay_required_payments: 2,
        visibility: "hidden", title: "Orbuni service fee — 2 parts", metadata: meta, payment_method_configuration: PMC }) });
      if (!pr.ok) throw new Error("plan " + pr.status + ": " + scrub(await pr.text()).slice(0, 300));
      const plan = await pr.json();
      c = await makeCheckout({ mode: "payment", plan_id: plan.id, metadata: meta, redirect_url: ret });
      if (!c.plan_id) c.plan_id = plan.id;
    } else {
      c = await makeCheckout({ mode: "payment", metadata: meta, redirect_url: ret,
        plan: { account_id: ACC, product_id: productId, currency: "usd", plan_type: "one_time",
                initial_price: amount, visibility: "hidden", title: "Orbuni service fee" } });
    }
    if (c.url) await sb.from("student_orders").update({ checkout_url: c.url }).eq("id", orderId);
    return json(200, { configured: true, ...c, amount, parts: split ? 2 : 1 });
  } catch (e) {
    return json(200, { configured: false, plan_id: fixedPlan, amount, parts: split ? 2 : 1, error: scrub(e).slice(0, 240) });
  }
});
