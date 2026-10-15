-- WhatsApp rich media funnel (15 Oct 2026)
-- 1. wa_media: the videos, images and PDFs the WhatsApp AI and the follow-ups may send.
--    The AI only ever sends what is listed here (and active), by key.
-- 2. wa_webinar_status(phone): what the AI needs to know about this person and the webinar.
-- 3. webinar_register_wa(...): one-tap "Save my free seat" from inside WhatsApp.

create table if not exists public.wa_media (
  key        text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  kind       text not null check (kind in ('video','image','pdf')),
  title      text not null,
  url        text not null check (url ~ '^https://'),
  caption    text,
  use_when   text,                -- guidance for the AI: when this is the right thing to send
  level      text,                -- bachelors / masters / phd, or null for everyone
  active     boolean not null default true,
  sort       int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wa_media enable row level security;
drop policy if exists "team reads wa media" on public.wa_media;
create policy "team reads wa media" on public.wa_media for select using (public.is_staff());
drop policy if exists "team edits wa media" on public.wa_media;
create policy "team edits wa media" on public.wa_media for all using (public.is_staff()) with check (public.is_staff());

-- what the AI should know about this phone number and the webinar
create or replace function public.wa_webinar_status(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 9); w record; r record;
begin
  select * into w from webinars where registration_open and starts_at > now() - make_interval(mins => duration_min)
   order by starts_at limit 1;
  if w.id is null then return jsonb_build_object('webinar_open', false); end if;
  if length(d) >= 8 then
    select * into r from webinar_registrations x
     where x.webinar_id = w.id and right(regexp_replace(coalesce(x.phone,''), '\D', '', 'g'), 9) = d
     order by created_at desc limit 1;
  end if;
  return jsonb_build_object(
    'webinar_open', true,
    'title', w.title,
    'when', to_char(w.starts_at at time zone 'Africa/Lagos', 'FMDay DD FMMonth YYYY, HH24:MI') || ' WAT ('
            || to_char(w.starts_at at time zone 'Europe/Istanbul', 'HH24:MI') || ' Türkiye)',
    'vip_price_usd', w.vip_price,
    'registered', r.id is not null,
    'ticket', r.ticket,
    'seat_link', case when r.id is not null then 'https://myorbuni.com/s/' || r.token end,
    'vip_checkout_started', r.vip_checkout_at is not null,
    'attended', r.attended_at is not null);
end $$;
revoke all on function public.wa_webinar_status(text) from public, anon, authenticated;

-- "Save my free seat" tapped in WhatsApp: they asked for it in the chat, which is their consent
create or replace function public.webinar_register_wa(p_phone text, p_name text, p_level text default null, p_country text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; res jsonb; tok text; d text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 9);
begin
  select * into w from webinars where registration_open and starts_at > now() - make_interval(mins => duration_min)
   order by starts_at limit 1;
  if w.id is null then return jsonb_build_object('ok', false, 'error', 'no webinar open'); end if;
  res := public.webinar_register(w.id, coalesce(nullif(trim(p_name), ''), 'Friend'), null, p_phone, p_country, 'student',
           case when p_level in ('bachelors','masters','phd') then p_level end, null, null, null, true,
           jsonb_build_object('utm_source','whatsapp','utm_medium','chat','utm_campaign','wa_one_tap'));
  select token into tok from webinar_registrations x where x.webinar_id = w.id
     and right(regexp_replace(coalesce(x.phone,''), '\D', '', 'g'), 9) = d order by created_at desc limit 1;
  return jsonb_build_object('ok', tok is not null, 'duplicate', coalesce((res->>'duplicate')::boolean, false),
                            'seat_link', case when tok is not null then 'https://myorbuni.com/s/' || tok end);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke all on function public.webinar_register_wa(text, text, text, text) from public, anon, authenticated;
