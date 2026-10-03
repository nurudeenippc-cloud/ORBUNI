-- WhatsApp inbox, AI agent context and schedules. Applied 3 Oct 2026 as
-- migrations whatsapp_inbox, whatsapp_person_context, whatsapp_cron
-- (+ the orb-wa-followups cron line at the bottom).

-- ===================================================== whatsapp_inbox
create table if not exists public.wa_contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,                 -- E.164, e.g. +2348012345678
  wa_name text,                               -- the name on their WhatsApp profile
  profile_id uuid references public.profiles(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  ai_on boolean not null default true,        -- AI agent answers this chat
  needs_human boolean not null default false, -- handed over to Nurudeen / Godfrey
  handoff_reason text,
  handoff_at timestamptz,
  ai_misses smallint not null default 0,
  opted_out boolean not null default false,   -- sent STOP
  opted_out_at timestamptz,
  last_inbound_at timestamptz,                -- opens the 24h free-reply window
  last_message_at timestamptz,
  last_preview text,
  unread integer not null default 0,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists wa_contacts_last_idx on public.wa_contacts (last_message_at desc nulls last);

create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.wa_contacts(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  author text not null default 'student' check (author in ('student','ai','staff','system','template')),
  staff_id uuid references public.profiles(id) on delete set null,
  body text,
  media jsonb,
  template_key text,
  twilio_sid text unique,
  status text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists wa_messages_contact_idx on public.wa_messages (contact_id, created_at);

create table if not exists public.wa_templates (
  key text primary key, content_sid text, approval text, body text,
  updated_at timestamptz not null default now()
);
create table if not exists public.wa_followups (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.wa_contacts(id) on delete cascade,
  trigger text not null,
  dedupe_key text not null unique,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

alter table public.wa_contacts enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_templates enable row level security;
alter table public.wa_followups enable row level security;
create policy wa_contacts_staff_read on public.wa_contacts for select to authenticated using (public.is_staff());
create policy wa_contacts_staff_update on public.wa_contacts for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy wa_messages_staff_read on public.wa_messages for select to authenticated using (public.is_staff());
create policy wa_templates_staff_read on public.wa_templates for select to authenticated using (public.is_staff());
create policy wa_followups_staff_read on public.wa_followups for select to authenticated using (public.is_staff());
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.wa_contacts; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.wa_messages; exception when duplicate_object then null; end;
  end if;
end $$;

-- ===================================================== whatsapp_person_context
-- Finds the student / lead behind a WhatsApp number (last 9 digits) and returns
-- what the AI agent may know about them. Service role only.
create or replace function public.wa_person_context(p_phone text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  d text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 9);
  v_profile uuid; v_lead uuid; out jsonb := '{}'::jsonb;
begin
  if length(d) < 8 then return out; end if;
  select id into v_profile from profiles
   where role = 'student'
     and (right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = d
       or right(regexp_replace(coalesce(whatsapp,''), '\D', '', 'g'), 9) = d)
   order by created_at desc limit 1;
  select id into v_lead from leads
   where right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 9) = d
   order by created_at desc limit 1;
  out := jsonb_build_object('profile_id', v_profile, 'lead_id', v_lead);
  if v_profile is not null then
    out := out || jsonb_build_object(
      'student', (select jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name, 'email', p.email,
                     'counsellor', (select trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')) from profiles c where c.id = p.counsellor_id),
                     'joined', p.created_at::date) from profiles p where p.id = v_profile),
      'applications', coalesce((select jsonb_agg(jsonb_build_object('choice', a.choice_rank, 'status', a.status, 'programme', pr.course,
                     'level', pr.degree_level, 'university', u.name, 'city', u.city, 'country', u.country,
                     'published_fee_usd', pr.published_fee, 'scholarship_pct', pr.discount_pct, 'net_fee_usd', pr.net_fee,
                     'decision', a.decision, 'submitted', a.submitted_at::date) order by a.choice_rank)
                  from applications a left join programmes pr on pr.id = a.programme_id left join universities u on u.id = pr.university_id
                  where a.profile_id = v_profile), '[]'::jsonb),
      'documents', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'status', x.status, 'reject_reason', x.reject_reason))
                  from documents x where x.profile_id = v_profile), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('package', o.package_id, 'total_usd', o.total, 'status', o.status, 'paid', o.paid_at::date))
                  from student_orders o where o.profile_id = v_profile), '[]'::jsonb));
  end if;
  if v_lead is not null then
    out := out || jsonb_build_object('lead',
      (select jsonb_build_object('name', l.name, 'country', l.country, 'programme_interest', l.programme_interest,
              'university_interest', l.university_interest, 'intake', l.intake, 'budget_band', l.budget_band,
              'stage', l.stage, 'pathway', l.pathway, 'took_quiz', l.quiz is not null, 'since', l.created_at::date)
       from leads l where l.id = v_lead));
  end if;
  return out;
end $$;
revoke all on function public.wa_person_context(text) from public, anon, authenticated;

-- ===================================================== whatsapp_cron
create or replace function public.push_wa(p_fn text)
returns bigint language plpgsql security definer set search_path to 'public', 'extensions', 'vault' as $$
declare v_secret text; v_id bigint;
begin
  if p_fn not in ('wa-templates','wa-followups') then raise exception 'unknown function'; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'orb_cron_secret';
  if v_secret is null then return null; end if;
  select net.http_post(
    url := 'https://ytsebzdykfeiiuxbdtvr.supabase.co/functions/v1/' || p_fn,
    headers := jsonb_build_object('Content-Type','application/json','x-orb-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 55000) into v_id;
  return v_id;
end $$;
revoke all on function public.push_wa(text) from public, anon, authenticated;

select cron.schedule('orb-wa-templates', '7,37 * * * *', $c$ select public.push_wa('wa-templates'); $c$);
select cron.schedule('orb-wa-followups', '15 * * * *', $c$ select public.push_wa('wa-followups'); $c$);
