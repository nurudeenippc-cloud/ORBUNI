-- Applied to the live project on 2026-10-04. Kept here as the record; already applied, do not run twice.

-- ---------------------------------------------------------------- feed_badges
-- The blue tick on the Feed. Every team member has it unless the owner turns it off.
create table if not exists public.feed_badges (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  verified boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.feed_badges enable row level security;
create policy feed_badges_read on public.feed_badges for select to authenticated using (true);

create or replace function public.set_feed_badge(p_profile uuid, p_on boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_owner) then
    raise exception 'Only the owner can give or remove the blue tick.';
  end if;
  insert into feed_badges (profile_id, verified, updated_by, updated_at) values (p_profile, p_on, auth.uid(), now())
  on conflict (profile_id) do update set verified = excluded.verified, updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function public.set_feed_badge(uuid, boolean) from public, anon;
grant execute on function public.set_feed_badge(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- hiring_stages
-- Where each job applicant is in the four hiring steps.
alter table public.job_applications add column if not exists stage text not null default 'new'
  check (stage in ('new','replied','call','task','hired','declined'));
alter table public.job_applications add column if not exists stage_at timestamptz;

create or replace function public.set_job_stage(p_id uuid, p_stage text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_staff() then raise exception 'Only the Orbuni team can move applicants.'; end if;
  update job_applications set stage = p_stage, stage_at = now() where id = p_id;
end $$;
revoke all on function public.set_job_stage(uuid, text) from public, anon;
grant execute on function public.set_job_stage(uuid, text) to authenticated;

-- ---------------------------------------------------------------- ops_tools_paid_so_far
-- The stack: what has actually been paid for each tool, from the receipts.
alter table public.ops_tools add column if not exists paid_so_far numeric check (paid_so_far is null or paid_so_far >= 0);
alter table public.ops_tools add column if not exists paid_currency text not null default 'USD';

-- ---------------------------------------------------------------- wa_content_cache
-- WhatsApp button messages (quick replies / link buttons): each text + buttons is a
-- Twilio content object, created once and reused. Server-only (RLS on, no policies).
create table if not exists public.wa_content_cache (
  hash text primary key,
  content_sid text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
alter table public.wa_content_cache enable row level security;
alter table public.wa_messages add column if not exists buttons jsonb;
