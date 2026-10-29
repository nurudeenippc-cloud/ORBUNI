-- Verified Partner subscription (Whop product prod_NAI3V7tvDGR7B).
-- A paid Whop payment switches the agency's plan on by itself:
--   whop-sync pulls the payment -> whop_payments -> trigger below
--   -> partner_plans row (tier + paid-until) -> the portal shows the blue tick,
--      the plan card, and (Growth and up) the partner AI assistant.
-- The plan runs 33 days from the latest payment (30-day billing + 3 days grace).
-- Upgrading = buying a higher plan; the highest tier paid in the window wins.
-- Partners can only READ their plan. Nothing a browser sends can switch it on.

alter table public.whop_payments add column if not exists partner_id uuid references public.partners(id) on delete set null;

create table if not exists public.partner_plans (
  partner_id      uuid primary key references public.partners(id) on delete cascade,
  tier            text not null check (tier in ('verified','growth','pro','max')),
  since           timestamptz not null default now(),
  paid_until      timestamptz not null,
  last_payment_id text,
  revoked         boolean not null default false,
  revoked_note    text,
  updated_at      timestamptz not null default now()
);
alter table public.partner_plans enable row level security;
create policy partner_plans_read on public.partner_plans for select to authenticated
  using (partner_id = public.my_partner_id() or public.is_staff());
revoke all on public.partner_plans from anon, authenticated;
grant select on public.partner_plans to authenticated;

create or replace function public.partner_tier_rank(t text) returns int language sql immutable as $$
  select case t when 'verified' then 1 when 'growth' then 2 when 'pro' then 3 when 'max' then 4 else 0 end $$;

create or replace function public.partner_plan_tier_of(p_plan text, p_meta jsonb) returns text language sql immutable as $$
  select case p_plan
    when 'plan_QkbDz7cq98h8q' then 'verified' when 'plan_m0amEOKZhd1H7' then 'growth'
    when 'plan_L980IT6ghiKXP' then 'pro'      when 'plan_FQpB8zywWjsJ5' then 'max'
    else case when p_meta->>'orbuni_tier' in ('verified','growth','pro','max') then p_meta->>'orbuni_tier' end end $$;

-- BEFORE trigger: find the agency a Verified Partner payment belongs to.
create or replace function public.whop_payment_match_partner() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_meta text;
begin
  if new.product_id is distinct from 'prod_NAI3V7tvDGR7B' then return new; end if;
  new.tier := 'partner_verified';
  if tg_op = 'UPDATE' then new.partner_id := coalesce(new.partner_id, old.partner_id); end if;
  -- 1) the agency id our own checkout (whop-checkout { partner_tier }) put in the metadata
  v_meta := coalesce(new.raw->'metadata'->>'orbuni_partner_id', new.raw->'membership'->'metadata'->>'orbuni_partner_id', '');
  if new.partner_id is null and v_meta ~ '^[0-9a-f-]{36}$' then
    select pa.id into new.partner_id from public.partners pa where pa.id = v_meta::uuid and pa.status = 'approved';
  end if;
  -- 2) otherwise by email: the agency's email, or any partner login on that agency
  if new.partner_id is null and new.user_email is not null then
    select pa.id into new.partner_id from public.partners pa
     where pa.status = 'approved' and lower(pa.email) = lower(new.user_email) limit 1;
    if new.partner_id is null then
      select pr.partner_id into new.partner_id from public.profiles pr join auth.users u on u.id = pr.id
       where pr.role = 'partner' and pr.partner_id is not null and lower(u.email) = lower(new.user_email) limit 1;
    end if;
  end if;
  return new;
end $$;

-- Recompute one agency's plan from its payments. Returns the plan as jsonb.
create or replace function public.partner_plan_refresh(p_partner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tier text; v_until timestamptz; v_last text; v_old partner_plans; v_new partner_plans;
        v_pa partners; v_was_active boolean; v_to text; v_first text; v_perks text;
begin
  select * into v_pa from partners where id = p_partner;
  if v_pa.id is null then return null; end if;
  select * into v_old from partner_plans where partner_id = p_partner;
  select max(coalesce(w.paid_at, w.created_at)) + interval '33 days',
         (array_agg(w.id order by coalesce(w.paid_at, w.created_at) desc))[1]
    into v_until, v_last
    from whop_payments w
   where w.partner_id = p_partner and w.status = 'paid' and w.product_id = 'prod_NAI3V7tvDGR7B';
  if v_until is null then  -- every payment refunded/cancelled: the plan ends now
    update partner_plans set paid_until = least(paid_until, now()), updated_at = now() where partner_id = p_partner;
    return null;
  end if;
  select t into v_tier from (
    select public.partner_plan_tier_of(w.plan_id, coalesce(w.raw->'metadata','{}'::jsonb)) t
      from whop_payments w
     where w.partner_id = p_partner and w.status = 'paid' and w.product_id = 'prod_NAI3V7tvDGR7B'
       and coalesce(w.paid_at, w.created_at) > v_until - interval '66 days') s
   where t is not null order by public.partner_tier_rank(t) desc limit 1;
  v_tier := coalesce(v_tier, 'verified');
  -- a plan that lapsed long ago restarts "since" today
  v_was_active := v_old.partner_id is not null and not v_old.revoked and v_old.paid_until > now();
  insert into partner_plans(partner_id, tier, since, paid_until, last_payment_id, updated_at)
  values (p_partner, v_tier, now(), v_until, v_last, now())
  on conflict (partner_id) do update set tier = excluded.tier, paid_until = excluded.paid_until,
     last_payment_id = excluded.last_payment_id, updated_at = now(),
     since = case when partner_plans.paid_until < now() - interval '1 day' then now() else partner_plans.since end
  returning * into v_new;

  -- Tell people when it switches on or moves up a tier (once per payment).
  if v_new.revoked or v_new.paid_until <= now() then return to_jsonb(v_new); end if;
  if v_was_active and public.partner_tier_rank(v_old.tier) >= public.partner_tier_rank(v_new.tier) then return to_jsonb(v_new); end if;

  v_perks := case v_new.tier
    when 'verified' then E'• Your blue tick is now on your agency everywhere students see it\n• You are listed as a verified Orbuni partner'
    when 'growth'   then E'• Blue tick and verified listing\n• Your own Orbuni AI assistant in the partner portal (top right, or the small Orbuni button)\n• Priority review of your students\' applications\n• Monthly partner webinar and WhatsApp support: https://wa.me/14434481577'
    when 'pro'      then E'• Everything in Growth (blue tick, AI assistant, priority review, webinar, WhatsApp support)\n• A named partner manager will message you within one working day\n• Featured placement and a co-branded landing page + tracking link\n• 5 priority support cases a month'
    else                 E'• Everything in Pro (blue tick, AI assistant, partner manager, featured placement, landing page)\n• Unlimited priority support\n• A quarterly strategy call with the founders — we will reach out to book the first one\n• First access to new universities and scholarships' end;
  v_to := coalesce(nullif(v_pa.email, ''), (select u.email from profiles pr join auth.users u on u.id = pr.id
           where pr.partner_id = p_partner and pr.role = 'partner' order by pr.created_at limit 1));
  v_first := coalesce(nullif(split_part(coalesce(v_pa.contact_name, ''), ' ', 1), ''), 'there');
  if v_to is not null then
    insert into email_outbox(to_email, template, vars, dedupe_key)
    values (v_to, 'custom_notice', jsonb_build_object(
      'subject', 'Your Orbuni ' || initcap(v_new.tier) || ' plan is on',
      'body', 'Hi ' || v_first || E',\n\nThank you — ' || v_pa.agency_name || ' is now an Orbuni ' || initcap(v_new.tier)
        || E' partner. Everything below is already switched on in your partner portal:\n\n' || v_perks
        || E'\n\nSee your plan, or move up a tier any time: https://myorbuni.com/#portal=partner:settings'
        || E'\n\nThe Orbuni team'),
      'partnerplan:' || p_partner || ':' || v_new.tier || ':' || coalesce(v_last, ''))
    on conflict do nothing;
  end if;
  perform public.raise_notification('payment_received', 'Partner plan on: ' || v_pa.agency_name,
    initcap(v_new.tier) || ' · paid until ' || to_char(v_new.paid_until at time zone 'Europe/Istanbul', 'DD Mon YYYY'),
    null, 'partner', p_partner, jsonb_build_object('tier', v_new.tier));
  perform public.notify_people(array(select id from profiles where partner_id = p_partner and role = 'partner'),
    'payment_received', 'Your ' || initcap(v_new.tier) || ' plan is on', 'Your blue tick and plan tools are switched on.',
    null, 'partner', p_partner, '{}'::jsonb);
  return to_jsonb(v_new);
end $$;
revoke all on function public.partner_plan_refresh(uuid) from public, anon, authenticated;

-- AFTER trigger: refresh the plan, or tell the team if the payer is not a known agency.
create or replace function public.whop_payment_partner_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.product_id is distinct from 'prod_NAI3V7tvDGR7B' then return null; end if;
  if new.partner_id is not null then
    perform public.partner_plan_refresh(new.partner_id);
  elsif new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    perform public.raise_notification('payment_received', 'Verified Partner payment needs linking',
      coalesce(new.user_email, 'Someone') || ' paid but is not an approved agency yet. Link it in Services & fees.',
      null, 'payment', null, jsonb_build_object('whop_payment', new.id));
  end if;
  return null;
end $$;

drop trigger if exists whop_payments_match_partner on public.whop_payments;
create trigger whop_payments_match_partner before insert or update on public.whop_payments
  for each row execute function public.whop_payment_match_partner();
drop trigger if exists whop_payments_partner_plan on public.whop_payments;
create trigger whop_payments_partner_plan after insert or update on public.whop_payments
  for each row execute function public.whop_payment_partner_plan();

-- The partner portal: "what is my plan?" (null = no plan).
create or replace function public.my_partner_plan() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when pp.partner_id is null then null else jsonb_build_object(
    'tier', pp.tier, 'since', pp.since, 'paid_until', pp.paid_until,
    'active', not pp.revoked and pp.paid_until > now(), 'revoked', pp.revoked) end
  from (select public.my_partner_id() id) me left join partner_plans pp on pp.partner_id = me.id $$;
revoke all on function public.my_partner_plan() from public, anon;
grant execute on function public.my_partner_plan() to authenticated;

-- Is this agency's plan at least p_min right now? (used by the assistant)
create or replace function public.partner_plan_ok(p_partner uuid, p_min text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from partner_plans where partner_id = p_partner and not revoked
    and paid_until > now() and public.partner_tier_rank(tier) >= public.partner_tier_rank(p_min)) $$;

-- Owner / admin: link a payment to an agency (when they paid with another email),
-- or switch a plan off/on (e.g. failed identity check).
create or replace function public.partner_plan_link(p_payment text, p_partner uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_staff() and public.my_role() = 'admin') then raise exception 'Only an Orbuni admin can do this.' using errcode = '42501'; end if;
  update whop_payments set partner_id = p_partner where id = p_payment and product_id = 'prod_NAI3V7tvDGR7B';
  if not found then raise exception 'That is not a Verified Partner payment.'; end if;
  return public.partner_plan_refresh(p_partner);
end $$;
revoke all on function public.partner_plan_link(text, uuid) from public, anon;
grant execute on function public.partner_plan_link(text, uuid) to authenticated;

create or replace function public.partner_plan_set_revoked(p_partner uuid, p_revoked boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_staff() and public.my_role() = 'admin') then raise exception 'Only an Orbuni admin can do this.' using errcode = '42501'; end if;
  update partner_plans set revoked = p_revoked, revoked_note = left(p_note, 300), updated_at = now() where partner_id = p_partner;
end $$;
revoke all on function public.partner_plan_set_revoked(uuid, boolean, text) from public, anon;
grant execute on function public.partner_plan_set_revoked(uuid, boolean, text) to authenticated;

-- Public: which agencies carry the blue tick (for showing it next to their name).
create or replace function public.verified_partner_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select partner_id from partner_plans where not revoked and paid_until > now() $$;
grant execute on function public.verified_partner_ids() to anon, authenticated;

-- Follow-up links for people who started the Verified Partner checkout and stopped.
create or replace function public.tier_link(p_tier text, p_has_account boolean)
returns text language sql immutable set search_path to '' as $$
  select case
    when p_tier = 'masterclass' and not p_has_account then 'https://myorbuni.com/?buy=masterclass#start'
    when p_tier = 'masterclass' then 'https://myorbuni.com/#portal=student:learn'
    when p_tier = 'partner_program' then 'https://myorbuni.com/#portal=partner:growth'
    when p_tier = 'partner_verified' then 'https://myorbuni.com/#portal=partner:settings'
    when p_tier in ('standard','plus','premier') and p_has_account then 'https://myorbuni.com/#portal=student:pay'
    when p_tier = 'extra' then 'https://myorbuni.com/#portal=student:extras'
    else 'https://myorbuni.com/#start' end $$;
