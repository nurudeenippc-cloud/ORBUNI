// Orbuni - records every confirmed Paystack payment in Whop, so Whop holds the
// full sales report (dollar payments made on Whop + naira payments made on Paystack).
// Each paid Paystack payment becomes a Whop invoice on the hidden product
// "Paid by Paystack (naira)", for the exact naira amount, marked "paid outside
// Whop" straight away. No money moves; it is bookkeeping only.
// The invoice is addressed to Orbuni's own payments inbox, so the student never
// gets a confusing "please pay" email for something they already paid; the
// student's name, email, item and Paystack reference are on the invoice.
// Runs every 5 minutes (pg_cron, x-orb-secret) and is safe to re-run: a payment
// is only recorded once (paystack_payments.whop_invoice_id).
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = env("ORB_CRON_SECRET");
const WHOP_KEY = env("WHOP_API_KEY").replace(/\s+/g, "");
const WHOP_ACCOUNT = env("WHOP_ACCOUNT_ID") || "biz_340OHdZOPCa81N";
const PRODUCT = env("WHOP_PAYSTACK_PRODUCT_ID") || "prod_Z4JuuyO2gkJuO";
const INBOX = env("WHOP_PAYSTACK_INBOX") || "nurudeen@myorbuni.com";
const scrub = (x: unknown) => String(x).replace(/apik_[A-Za-z0-9_]+/g, "[key]").replace(/Bearer\s+[^\s"']+/g, "Bearer [key]");
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const WH = () => ({ Authorization: `Bearer ${WHOP_KEY}`, "Content-Type": "application/json", Accept: "application/json" });

async function whop(path: string, body: unknown) {
  const r = await fetch("https://api.whop.com/api/v1" + path, { method: "POST", headers: WH(), body: JSON.stringify(body) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { ok: r.ok, status: r.status, j, t: scrub(t).slice(0, 300) };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-orb-secret") !== CRON_SECRET) return json(403, { error: "forbidden" });
  if (!WHOP_KEY) return json(200, { error: "WHOP_API_KEY not set" });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const reqBody = await req.json().catch(() => ({}));
  // team self-test: one ₦100 bookkeeping invoice to Orbuni's own inbox, marked paid (no money moves)
  if (reqBody?.test === true) {
    const body: any = { company_id: WHOP_ACCOUNT, collection_method: "send_invoice", due_date: new Date(Date.now() + 864e5).toISOString(),
      email_address: INBOX, customer_name: "TEST · Paystack record check", product_id: PRODUCT,
      plan: { initial_price: 100, currency: "ngn", plan_type: "one_time", visibility: "hidden", internal_notes: "Self-test of the Paystack → Whop recorder" } };
    let r = await whop("/invoices", body);
    if (!r.ok && /company_id|account_id/i.test(r.t)) { delete body.company_id; body.account_id = WHOP_ACCOUNT; r = await whop("/invoices", body); }
    if (!r.ok || !r.j?.id) return json(200, { step: "create", status: r.status, detail: r.t });
    const m = await whop(`/invoices/${encodeURIComponent(r.j.id)}/mark_paid`, {});
    return json(200, { invoice: r.j.id, created_status: r.j.status, mark_paid: m.status, detail: m.ok ? "ok" : m.t });
  }

  const { data: rows } = await sb.from("paystack_payments")
    .select("id,reference,profile_id,order_id,booking_id,product,email,amount_usd,amount_ngn,rate,channel,paid_at,whop_invoice_id")
    .eq("status", "paid").is("whop_recorded_at", null).order("paid_at", { ascending: true }).limit(20);
  const out: any[] = [];
  for (const p of rows ?? []) {
    try {
      // who and what, for the invoice
      let name = "", email = p.email || "";
      if (p.profile_id) {
        const { data: pr } = await sb.from("profiles").select("first_name,last_name,email").eq("id", p.profile_id).maybeSingle();
        name = [pr?.first_name, pr?.last_name].filter(Boolean).join(" "); email = email || pr?.email || "";
      }
      let item = "Paystack payment";
      if (p.product === "masterclass") item = "The Scholarship Masterclass";
      else if (p.product === "partner_program") item = "Partner Growth Program";
      else if (p.order_id) {
        const { data: o } = await sb.from("student_orders").select("package_id").eq("id", p.order_id).maybeSingle();
        item = ({ essential: "Standard", complete: "Plus", arrival: "Premier" } as any)[o?.package_id] + " service fee";
      } else if (p.booking_id) {
        const { data: b } = await sb.from("service_bookings").select("addon_id").eq("id", p.booking_id).maybeSingle();
        const { data: a } = b ? await sb.from("service_addons").select("name").eq("id", b.addon_id).maybeSingle() : { data: null };
        item = a?.name || "Extra service";
      }
      const who = (name || email || "Customer").slice(0, 60);
      let inv = p.whop_invoice_id as string | null;
      if (!inv) {
        const due = new Date(Date.now() + 864e5).toISOString();
        const body: any = {
          company_id: WHOP_ACCOUNT, collection_method: "send_invoice", due_date: due,
          email_address: INBOX, customer_name: (who + " · Paystack " + p.reference).slice(0, 100), product_id: PRODUCT,
          plan: { initial_price: Number(p.amount_ngn), currency: "ngn", plan_type: "one_time", visibility: "hidden",
            internal_notes: `${item} · ${who}${email ? " <" + email + ">" : ""} · Paystack ${p.reference} · ${p.channel || "paystack"} · $${p.amount_usd} at ₦${p.rate}/$ · paid ${p.paid_at}`.slice(0, 900) },
        };
        let r = await whop("/invoices", body);
        if (!r.ok && /company_id|account_id/i.test(r.t)) { delete body.company_id; body.account_id = WHOP_ACCOUNT; r = await whop("/invoices", body); }
        if (!r.ok || !r.j?.id) throw new Error("create " + r.status + ": " + r.t);
        inv = String(r.j.id);
        await sb.from("paystack_payments").update({ whop_invoice_id: inv, whop_error: null }).eq("id", p.id);
      }
      const m = await whop(`/invoices/${encodeURIComponent(inv)}/mark_paid`, {});
      if (!m.ok && !/already|paid/i.test(m.t)) throw new Error("mark_paid " + m.status + ": " + m.t);
      await sb.from("paystack_payments").update({ whop_recorded_at: new Date().toISOString(), whop_error: null }).eq("id", p.id);
      out.push({ ref: p.reference, invoice: inv, ok: true });
    } catch (e) {
      const msg = scrub(e).slice(0, 400);
      await sb.from("paystack_payments").update({ whop_error: msg }).eq("id", p.id);
      out.push({ ref: p.reference, ok: false, error: msg });
    }
  }
  return json(200, { checked: (rows ?? []).length, results: out });
});
