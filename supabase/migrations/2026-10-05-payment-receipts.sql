-- r46: receipt + invoice email and WhatsApp after every payment (Whop and Paystack).
-- Applied live on 2026-10-04/05. Sending is done by the edge function payment-receipts,
-- called every 2 minutes by pg_cron job "orb-payment-receipts" via public.push_receipts().
-- Also in r46 (applied live): visitors may run the "who am I" helpers (they answer
-- "nobody" for a visitor), which stops the public price lookup failing:
--   grant execute on function public.my_role(), public.my_partner_id(), public.can_open(text),
--     public.my_sections(), public.can_manage_section(text) to anon;
--   revoke execute on function public.whop_payment_match_partner(), public.whop_payment_partner_plan() from anon, authenticated, public;
--   revoke execute on function public.partner_plan_ok(uuid,text) from anon, public;
--   alter function public.partner_tier_rank set search_path = public;
--   alter function public.partner_plan_tier_of set search_path = public;
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('whop','paystack')),
  payment_ref text not null,
  profile_id uuid, email text, name text, item text, amount_usd numeric, amount_local text, method text,
  paid_at timestamptz, receipt_no text, email_sent_at timestamptz, email_error text, wa_status text, wa_sent_at timestamptz,
  attempts int not null default 0, created_at timestamptz not null default now(),
  unique (provider, payment_ref)
);
alter table public.payment_receipts enable row level security;
create policy "staff read receipts" on public.payment_receipts for select to authenticated using (public.is_staff());
create policy "own receipts" on public.payment_receipts for select to authenticated using (profile_id = auth.uid());
-- functions payment_receipt_item, payment_receipt_from_whop, payment_receipt_from_paystack, push_receipts:
-- see the live database (pg_get_functiondef) — same text as applied in the session.
create trigger paystack_payments_receipt after update of status on public.paystack_payments for each row execute function public.payment_receipt_from_paystack();
create trigger whop_payments_receipt after insert or update of status on public.whop_payments for each row execute function public.payment_receipt_from_whop();
select cron.schedule('orb-payment-receipts', '*/2 * * * *', $$ select public.push_receipts(); $$);
