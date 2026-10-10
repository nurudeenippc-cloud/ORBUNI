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
create or replace function public.payment_receipt_item(p_key text, p_title text) returns text language sql immutable set search_path = public as $$
  select coalesce(case p_key
    when 'masterclass' then 'The Scholarship Masterclass'
    when 'partner_program' then 'Partner Growth Program'
    when 'essential' then 'Orbuni Standard — service fee'
    when 'standard' then 'Orbuni Standard — service fee'
    when 'complete' then 'Orbuni Plus — service fee'
    when 'plus' then 'Orbuni Plus — service fee'
    when 'arrival' then 'Orbuni Premier — service fee'
    when 'premier' then 'Orbuni Premier — service fee'
    when 'premier_2pay' then 'Orbuni Premier — service fee (part payment)'
    when 'partner_verified' then 'Verified Partner — monthly plan'
    when 'partner_growth' then 'Partner Growth — monthly plan'
    when 'partner_pro' then 'Partner Pro — monthly plan'
    when 'partner_max' then 'Partner Max — monthly plan'
    else null end, nullif(p_title,''), 'Orbuni purchase')
$$;

create or replace function public.payment_receipt_from_whop() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text;
begin
  if new.status <> 'paid' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'paid' then return new; end if;
  if coalesce(new.paid_at, new.created_at, now()) < now() - interval '3 days' then return new; end if;
  select coalesce(nullif(new.user_email,''), p.email), coalesce(nullif(trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),''), new.user_name)
    into v_email, v_name from (select 1) x left join profiles p on p.id = new.profile_id;
  if v_email is null then return new; end if;
  insert into payment_receipts(provider, payment_ref, profile_id, email, name, item, amount_usd, method, paid_at, receipt_no)
  values ('whop', new.id, new.profile_id, lower(v_email), v_name, payment_receipt_item(new.tier, new.product_title),
          new.amount, 'Card / local method, by Whop', coalesce(new.paid_at, now()),
          'ORB-W-' || upper(right(regexp_replace(new.id, '[^A-Za-z0-9]', '', 'g'), 8)))
  on conflict (provider, payment_ref) do nothing;
  return new;
end $$;

create or replace function public.payment_receipt_from_paystack() returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text; v_key text;
begin
  if new.status <> 'paid' or old.status = 'paid' then return new; end if;
  select coalesce(nullif(new.email,''), p.email), nullif(trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),'')
    into v_email, v_name from (select 1) x left join profiles p on p.id = new.profile_id;
  if v_email is null then return new; end if;
  v_key := coalesce(new.product, (select o.package_id::text from student_orders o where o.id = new.order_id));
  insert into payment_receipts(provider, payment_ref, profile_id, email, name, item, amount_usd, amount_local, method, paid_at, receipt_no)
  values ('paystack', new.reference, new.profile_id, lower(v_email), v_name,
          case when new.booking_id is not null then 'Extra service booking' else payment_receipt_item(v_key, null) end,
          new.amount_usd, '₦' || to_char(coalesce(new.paid_kobo/100, new.amount_ngn), 'FM999,999,999,990'),
          'Naira via Paystack' || coalesce(' · ' || replace(new.channel,'_',' '), ''), coalesce(new.paid_at, now()),
          'ORB-P-' || upper(right(regexp_replace(new.reference, '[^A-Za-z0-9]', '', 'g'), 8)))
  on conflict (provider, payment_ref) do nothing;
  return new;
end $$;
revoke execute on function public.payment_receipt_from_whop(), public.payment_receipt_from_paystack() from public, anon, authenticated;

create or replace function public.push_receipts() returns bigint language plpgsql security definer set search_path = public as $$
declare v_secret text; v_id bigint;
begin
  if not exists (select 1 from public.payment_receipts where created_at > now() - interval '3 days'
                 and (email_sent_at is null or wa_status is null or wa_status = 'waiting_template') and attempts < 6) then
    return null;   -- nothing waiting: no call at all
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'orb_cron_secret';
  if v_secret is null then return null; end if;
  select net.http_post(
    url := 'https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/payment-receipts',
    headers := jsonb_build_object('Content-Type','application/json','x-orb-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 55000) into v_id;
  return v_id;
end $$;
revoke execute on function public.push_receipts() from public, anon, authenticated;
create trigger paystack_payments_receipt after update of status on public.paystack_payments for each row execute function public.payment_receipt_from_paystack();
create trigger whop_payments_receipt after insert or update of status on public.whop_payments for each row execute function public.payment_receipt_from_whop();
select cron.schedule('orb-payment-receipts', '*/2 * * * *', $$ select public.push_receipts(); $$);
