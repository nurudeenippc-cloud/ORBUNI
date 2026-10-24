-- 4 Oct 2026 security pass (already applied live; kept here as the record).
-- 1. Spam guard on the forms anyone can submit (per visitor address and in total, per hour).
create table if not exists public.rate_hits (id bigserial primary key, bucket text not null, ip text not null, at timestamptz not null default now());
create index if not exists rate_hits_bucket_ip_at on public.rate_hits (bucket, ip, at);
create index if not exists rate_hits_bucket_at on public.rate_hits (bucket, at);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;
-- public.rate_guard(): see the live definition; raises "Too many submissions…" past the limit.
-- triggers: leads 10/IP + 1500 total, enquiries 10 + 500, job_applications 5 + 200,
--           partners 3 + 100, funnel_events 600/IP (no total).
-- 2. A student creating their own order can never mark it paid.
alter policy so_own_insert on public.student_orders
  with check (profile_id = auth.uid() and status = 'pending' and paid_at is null);
-- 3. CV uploads (job applications, no sign-in): at most 60 an hour in total.
create or replace function public.cv_upload_ok() returns boolean language sql stable security definer
  set search_path = public, storage as $$ select count(*) < 60 from storage.objects where bucket_id = 'cvs' and created_at > now() - interval '1 hour' $$;
alter policy "cv upload" on storage.objects with check (bucket_id = 'cvs' and public.cv_upload_ok());
