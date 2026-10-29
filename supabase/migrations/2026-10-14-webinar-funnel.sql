-- APPLIED 14 Oct 2026 through execute_sql, in parts. The "drop policy if exists" /
-- "drop trigger if exists" lines below were NOT run on the live database (there was
-- nothing to drop on a first install); everything else is live, plus the revoke at the end.
-- 14 Oct 2026 · Funnel A: the free Scholarship webinar ("Scholarship 1.0").
-- Registrations live in their own table (not in leads), so thousands of sign-ups do not
-- flood counsellors with lead alerts. A registrant becomes a lead when they buy the $10 VIP
-- seat (it is the Scholarship Masterclass purchase) or take the assessment after the webinar.
-- Nothing here is public to read: the page talks to the database only through the functions
-- below, and a registrant sees their own seat only with their private token.

create table if not exists public.webinars (
  id text primary key,
  title text not null,
  starts_at timestamptz not null,
  duration_min int not null default 90 check (duration_min between 15 and 600),
  live_url text,            -- the room (YouTube Live / Whop livestream / Meet). Never shown before the doors open.
  replay_url text,
  replay_days int not null default 3,   -- free seats keep the replay this long; VIP keep it for life
  registration_open boolean not null default true,
  vip_price numeric not null default 10,
  created_at timestamptz not null default now()
);
alter table public.webinars enable row level security;
drop policy if exists "staff manage webinars" on public.webinars;
create policy "staff manage webinars" on public.webinars for all using (public.is_staff()) with check (public.is_staff());

insert into public.webinars (id, title, starts_at, duration_min)
values ('scholarship-1', 'Scholarship 1.0: how Turkish scholarships really work', '2027-02-06 15:00:00+00', 90)
on conflict (id) do nothing;

create table if not exists public.webinar_registrations (
  id uuid primary key default gen_random_uuid(),
  webinar_id text not null references public.webinars(id) on delete cascade,
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  name text not null check (char_length(name) between 2 and 120),
  email text check (email is null or (char_length(email) <= 160 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or char_length(phone) <= 40),
  country text check (country is null or char_length(country) <= 80),
  role text check (role is null or role in ('student','parent','helper')),
  level text check (level is null or char_length(level) <= 40),
  start_when text check (start_when is null or char_length(start_when) <= 40),
  question text check (question is null or char_length(question) <= 80),
  funding text check (funding is null or char_length(funding) <= 40),
  consent boolean not null default false,
  ticket text not null default 'free' check (ticket in ('free','vip')),
  vip_checkout_at timestamptz,
  vip_receipt text check (vip_receipt is null or char_length(vip_receipt) <= 80),
  vip_at timestamptz,
  attended_at timestamptz,
  join_clicks int not null default 0,
  lead_id uuid references public.leads(id) on delete set null,
  utm_source text check (utm_source is null or char_length(utm_source) <= 120),
  utm_medium text check (utm_medium is null or char_length(utm_medium) <= 120),
  utm_campaign text check (utm_campaign is null or char_length(utm_campaign) <= 200),
  created_at timestamptz not null default now()
);
create unique index if not exists webinar_reg_email on public.webinar_registrations (webinar_id, lower(email)) where email is not null;
create unique index if not exists webinar_reg_phone on public.webinar_registrations (webinar_id, regexp_replace(phone, '\D', '', 'g')) where phone is not null;
create index if not exists webinar_reg_created on public.webinar_registrations (webinar_id, created_at);
alter table public.webinar_registrations enable row level security;
drop policy if exists "staff read webinar registrations" on public.webinar_registrations;
create policy "staff read webinar registrations" on public.webinar_registrations for select using (public.is_staff());
drop policy if exists "staff update webinar registrations" on public.webinar_registrations;
create policy "staff update webinar registrations" on public.webinar_registrations for update using (public.is_staff()) with check (public.is_staff());

-- the same per-connection limit the lead form uses (10 an hour per IP, 3,000 an hour in total)
drop trigger if exists rate_guard_webinar on public.webinar_registrations;
create trigger rate_guard_webinar before insert on public.webinar_registrations
  for each row execute function public.rate_guard('webinar', '10', '3000');

-- ---------- what the public page may know ----------
create or replace function public.webinar_info(p_id text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('id', w.id, 'title', w.title, 'starts_at', w.starts_at, 'duration_min', w.duration_min,
           'registration_open', w.registration_open and w.starts_at > now() - make_interval(mins => w.duration_min),
           'vip_price', w.vip_price,
           'registered', (select count(*) from public.webinar_registrations r where r.webinar_id = w.id))
    from public.webinars w where w.id = p_id
$$;

-- ---------- register ----------
create or replace function public.webinar_register(p_id text, p_name text, p_email text, p_phone text, p_country text,
  p_role text, p_level text, p_start text, p_question text, p_funding text, p_consent boolean, p_utm jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare w record; v_email text; v_phone text; v_id uuid; v_tok text; v_dup uuid;
begin
  select * into w from public.webinars where id = p_id;
  if w.id is null then raise exception 'This webinar does not exist.' using errcode = 'P0001'; end if;
  if not w.registration_open or w.starts_at < now() - make_interval(mins => w.duration_min) then
    raise exception 'Registration for this webinar is closed.' using errcode = 'P0001'; end if;
  if coalesce(p_consent, false) is not true then raise exception 'Please tick the box so we can send you the link.' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Your name, please.' using errcode = 'P0001'; end if;
  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone := nullif(trim(coalesce(p_phone, '')), '');
  if v_phone is null or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 7 then
    raise exception 'A WhatsApp number we can send the link to, with the country code.' using errcode = 'P0001'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.' using errcode = 'P0001'; end if;

  -- already registered: never hand someone else's seat to whoever typed the number. Re-send the link to the owner instead.
  select id into v_dup from public.webinar_registrations r
   where r.webinar_id = p_id and ((v_email is not null and lower(r.email) = v_email)
         or regexp_replace(coalesce(r.phone,''), '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')) limit 1;
  if v_dup is not null then
    perform public.webinar_queue_email(v_dup, 'webinar_registered', 'web:resend:' || v_dup || ':' || to_char(now(), 'YYYYMMDD'));
    return jsonb_build_object('duplicate', true);
  end if;

  insert into public.webinar_registrations (webinar_id, name, email, phone, country, role, level, start_when, question, funding, consent,
                                            utm_source, utm_medium, utm_campaign)
  values (p_id, left(trim(p_name), 120), v_email, left(v_phone, 40), nullif(left(trim(coalesce(p_country,'')), 80), ''),
          case when p_role in ('student','parent','helper') then p_role end,
          nullif(left(coalesce(p_level,''), 40), ''), nullif(left(coalesce(p_start,''), 40), ''),
          nullif(left(coalesce(p_question,''), 80), ''), nullif(left(coalesce(p_funding,''), 40), ''), true,
          nullif(left(coalesce(p_utm->>'utm_source',''), 120), ''), nullif(left(coalesce(p_utm->>'utm_medium',''), 120), ''),
          nullif(left(coalesce(p_utm->>'utm_campaign',''), 200), ''))
  returning id, token into v_id, v_tok;

  perform public.webinar_queue_email(v_id, 'webinar_registered', 'web:reg:' || v_id);
  perform public.push_webinar('reg', v_id);
  return jsonb_build_object('token', v_tok);
end $$;

-- ---------- a registrant's own seat (by private token) ----------
create or replace function public.webinar_seat(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r record; w record; v_open timestamptz; v_end timestamptz;
begin
  if p_token is null or char_length(p_token) < 30 then return null; end if;
  select * into r from public.webinar_registrations where token = p_token;
  if r.id is null then return null; end if;
  select * into w from public.webinars where id = r.webinar_id;
  v_open := w.starts_at - interval '15 minutes'; v_end := w.starts_at + make_interval(mins => w.duration_min);
  return jsonb_build_object(
    'first_name', split_part(r.name, ' ', 1), 'ticket', r.ticket, 'role', r.role,
    'webinar', jsonb_build_object('id', w.id, 'title', w.title, 'starts_at', w.starts_at, 'duration_min', w.duration_min, 'vip_price', w.vip_price),
    'state', case when now() < v_open then 'before' when now() <= v_end then 'live' else 'after' end,
    'room_ready', (now() between v_open and v_end) and coalesce(w.live_url,'') <> '',
    'replay', case when now() > v_end and coalesce(w.replay_url,'') <> ''
                    and (r.ticket = 'vip' or now() < v_end + make_interval(days => w.replay_days)) then true else false end,
    'replay_until', case when r.ticket = 'vip' then null else v_end + make_interval(days => w.replay_days) end,
    'vip_pending', r.ticket = 'free' and r.vip_receipt is not null);
end $$;

-- the "Join now" button: counts attendance, then hands over the room link (only while the doors are open)
create or replace function public.webinar_join(p_token text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare r record; w record;
begin
  select * into r from public.webinar_registrations where token = p_token;
  if r.id is null then return null; end if;
  select * into w from public.webinars where id = r.webinar_id;
  if now() between w.starts_at - interval '15 minutes' and w.starts_at + make_interval(mins => w.duration_min) and coalesce(w.live_url,'') <> '' then
    update public.webinar_registrations set attended_at = coalesce(attended_at, now()), join_clicks = join_clicks + 1 where id = r.id;
    return w.live_url;
  end if;
  if now() > w.starts_at + make_interval(mins => w.duration_min) and coalesce(w.replay_url,'') <> ''
     and (r.ticket = 'vip' or now() < w.starts_at + make_interval(mins => w.duration_min) + make_interval(days => w.replay_days)) then
    return w.replay_url;
  end if;
  return null;
end $$;

-- ---------- VIP: the $10 seat is the Scholarship Masterclass purchase ----------
create or replace function public.webinar_vip_checkout(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  select * into r from public.webinar_registrations where token = p_token;
  if r.id is null then return null; end if;
  update public.webinar_registrations set vip_checkout_at = coalesce(vip_checkout_at, now()) where id = r.id and ticket = 'free';
  return jsonb_build_object('name', r.name, 'email', r.email);
end $$;

create or replace function public.webinar_make_vip(p_reg uuid, p_receipt text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record; v_lead uuid;
begin
  select * into r from public.webinar_registrations where id = p_reg;
  if r.id is null or r.ticket = 'vip' then return; end if;
  update public.webinar_registrations set ticket = 'vip', vip_at = now(), vip_receipt = coalesce(p_receipt, vip_receipt) where id = r.id;
  -- a paying VIP is a warm lead: give them a counsellor
  if r.lead_id is null then
    insert into public.leads (name, email, phone, country, source, utm_source, utm_medium, utm_campaign, landing_page, message,
                              decision_maker, urgency, budget_band)
    values (r.name, r.email, r.phone, r.country, 'webinar', r.utm_source, r.utm_medium, coalesce(r.utm_campaign, r.webinar_id), '/#webinar',
            left('Webinar VIP ($10) · ' || r.webinar_id || coalesce(' · ' || r.role, '') || coalesce(' · ' || r.level, '')
                 || coalesce(' · starts ' || r.start_when, '') || coalesce(' · pays: ' || r.funding, '') || coalesce(' · asks: ' || r.question, ''), 1000),
            r.role = 'parent',
            case when r.start_when ilike '%2027%' and r.start_when ilike '%sep%' then 'this_intake' when r.start_when ilike '%later%' or r.start_when ilike '%not sure%' then 'exploring' else 'next_intake' end,
            case when r.funding ilike '%ready%' then '1500_2499' when r.funding ilike '%full%' then 'under_800' else '800_1499' end)
    returning id into v_lead;
    update public.webinar_registrations set lead_id = v_lead where id = r.id;
  end if;
  perform public.webinar_queue_email(r.id, 'webinar_vip_welcome', 'web:vipwelcome:' || r.id);
  perform public.push_webinar('vip', r.id);
end $$;

-- after the checkout sheet says "paid": check Whop really has it, then upgrade
create or replace function public.webinar_vip_mark(p_token text, p_receipt text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare r record;
begin
  select * into r from public.webinar_registrations where token = p_token;
  if r.id is null then return null; end if;
  if r.ticket = 'vip' then return 'vip'; end if;
  if p_receipt is not null and char_length(p_receipt) <= 80 then
    update public.webinar_registrations set vip_receipt = p_receipt where id = r.id and vip_receipt is null;
  end if;
  if exists (select 1 from public.whop_payments p where p.status = 'paid' and p.tier = 'masterclass'
              and (p.id = p_receipt or (r.email is not null and lower(p.user_email) = lower(r.email) and p.created_at > r.created_at - interval '1 day'))) then
    perform public.webinar_make_vip(r.id, p_receipt);
    return 'vip';
  end if;
  return 'pending';
end $$;

-- every 10 minutes: Whop payments that arrived after the sheet closed
create or replace function public.webinar_sync_vip()
returns int language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in select g.* from public.webinar_registrations g
            where g.ticket = 'free' and (g.vip_receipt is not null or g.vip_checkout_at is not null)
              and exists (select 1 from public.whop_payments p where p.status = 'paid' and p.tier = 'masterclass'
                          and (p.id = g.vip_receipt or (g.email is not null and lower(p.user_email) = lower(g.email) and p.created_at > g.created_at - interval '1 day')))
  loop perform public.webinar_make_vip(r.id, r.vip_receipt); n := n + 1; end loop;
  return n;
end $$;

-- ---------- emails ----------
create or replace function public.webinar_queue_email(p_reg uuid, p_template text, p_key text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r record; w record;
begin
  select * into r from public.webinar_registrations where id = p_reg;
  if r.id is null or r.email is null or public.is_test_email(r.email) or public.is_opted_out(r.email) then return; end if;
  select * into w from public.webinars where id = r.webinar_id;
  insert into public.email_outbox (profile_id, to_email, template, vars, dedupe_key)
  values ((select id from public.profiles where lower(email) = lower(r.email) limit 1), r.email, p_template,
          jsonb_build_object('first_name', initcap(split_part(r.name, ' ', 1)), 'title', w.title,
            'when', to_char(w.starts_at at time zone 'Africa/Lagos', 'FMDay DD FMMonth YYYY, HH24:MI') || ' WAT ('
                    || to_char(w.starts_at at time zone 'Europe/Istanbul', 'HH24:MI') || ' Türkiye)',
            'starts_at', w.starts_at, 'seat', 'https://myorbuni.com/s/' || r.token,
            'quiz', 'https://myorbuni.com/quiz?t=' || r.token, 'ticket', r.ticket,
            'vip_price', '$' || trim(to_char(w.vip_price, 'FM999990')), 'unsub', public.optout_link(r.email),
            'gcal', 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' || replace(replace(w.title, ' ', '+'), ':', '%3A')
                    || '&dates=' || to_char(w.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"') || '/'
                    || to_char((w.starts_at + make_interval(mins => w.duration_min)) at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"')
                    || '&details=Your+seat%3A+https%3A%2F%2Fmyorbuni.com%2Fs%2F' || r.token) || p_extra,
          p_key)
  on conflict do nothing;
end $$;

-- the WhatsApp side (instant on sign-up and on VIP; the rest by the 10-minute schedule)
create or replace function public.push_webinar(p_kind text, p_id uuid)
returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'vault' as $$
declare v_secret text; v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'orb_cron_secret';
  if v_secret is null then return null; end if;
  select net.http_post(url := 'https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/webinar-followups',
    headers := jsonb_build_object('Content-Type','application/json','x-orb-secret', v_secret),
    body := jsonb_build_object('kind', p_kind, 'id', p_id), timeout_milliseconds := 30000) into v_id;
  return v_id;
exception when others then return null;
end $$;

-- the schedule: who gets which email, and when (WhatsApp follows the same rules in webinar-followups)
create or replace function public.queue_webinar_followups()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0; v_end timestamptz;
begin
  perform public.webinar_sync_vip();
  for r in select g.*, w.starts_at, w.duration_min, w.replay_url, w.replay_days
             from public.webinar_registrations g join public.webinars w on w.id = g.webinar_id
            where g.email is not null and w.starts_at > now() - interval '10 days'
  loop
    v_end := r.starts_at + make_interval(mins => r.duration_min);
    -- free seats: one VIP invitation the day after signing up (only while the webinar is more than a day away)
    if r.ticket = 'free' and r.created_at < now() - interval '20 hours' and r.starts_at > now() + interval '24 hours' then
      perform public.webinar_queue_email(r.id, 'webinar_vip_offer', 'web:vipoffer:' || r.id); n := n + 1; end if;
    -- started the VIP checkout and did not pay
    if r.ticket = 'free' and r.vip_checkout_at is not null and r.vip_checkout_at between now() - interval '48 hours' and now() - interval '1 hour' then
      perform public.webinar_queue_email(r.id, 'webinar_vip_unpaid', 'web:vipunpaid:' || r.id); end if;
    -- reminders
    if now() between r.starts_at - interval '26 hours' and r.starts_at - interval '20 hours' then
      perform public.webinar_queue_email(r.id, 'webinar_reminder', 'web:rem1d:' || r.id, '{"when_short":"tomorrow"}'); end if;
    if now() between r.starts_at - interval '75 minutes' and r.starts_at - interval '20 minutes' then
      perform public.webinar_queue_email(r.id, 'webinar_reminder', 'web:rem1h:' || r.id, '{"when_short":"in one hour"}'); end if;
    if now() between r.starts_at - interval '5 minutes' and r.starts_at + interval '25 minutes' and r.attended_at is null then
      perform public.webinar_queue_email(r.id, 'webinar_live', 'web:live:' || r.id); end if;
    -- after: came → next step (the assessment link that skips the video); missed → replay
    if now() > v_end + interval '30 minutes' and now() < v_end + interval '5 days' then
      if r.attended_at is not null then
        perform public.webinar_queue_email(r.id, 'webinar_next', 'web:next:' || r.id);
      elsif coalesce(r.replay_url, '') <> '' then
        perform public.webinar_queue_email(r.id, 'webinar_replay', 'web:replay:' || r.id);
      end if;
    end if;
    -- VIP: the 100% scholarship places, the day after the webinar
    if r.ticket = 'vip' and now() > v_end + interval '20 hours' and now() < v_end + interval '6 days' then
      perform public.webinar_queue_email(r.id, 'webinar_vip_scholarship', 'web:vipschol:' || r.id); end if;
  end loop;
  return jsonb_build_object('checked', n);
end $$;

revoke all on function public.webinar_make_vip(uuid, text), public.webinar_sync_vip(), public.webinar_queue_email(uuid, text, text, jsonb),
  public.push_webinar(text, uuid), public.queue_webinar_followups() from public, anon, authenticated;
grant execute on function public.webinar_info(text), public.webinar_register(text, text, text, text, text, text, text, text, text, text, boolean, jsonb),
  public.webinar_seat(text), public.webinar_join(text), public.webinar_vip_checkout(text), public.webinar_vip_mark(text, text) to anon, authenticated;

-- push_wa may also start the webinar WhatsApp run
create or replace function public.push_wa(p_fn text)
 returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'vault' as $function$
declare v_secret text; v_id bigint;
begin
  if p_fn not in ('wa-templates','wa-followups','webinar-followups') then raise exception 'unknown function'; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'orb_cron_secret';
  if v_secret is null then return null; end if;
  select net.http_post(
    url     := 'https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/' || p_fn,
    headers := jsonb_build_object('Content-Type','application/json','x-orb-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into v_id;
  return v_id;
end $function$;

select cron.schedule('orb-webinar', '*/10 * * * *', $$ select public.queue_webinar_followups(); select public.push_wa('webinar-followups'); $$);
