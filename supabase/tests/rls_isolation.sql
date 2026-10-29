-- Orbuni data-isolation regression test. READ-ONLY: it only SELECTs, impersonating
-- each real student and partner through Postgres roles + JWT claims, and always
-- ends by raising an exception, so the whole transaction is rolled back.
--
-- Run it in the Supabase SQL editor (or execute_sql) after ANY change to RLS
-- policies, storage policies, views or security-definer functions.
--   Result "RLS_ISOLATION PASS ..."  -> every check held.
--   Result "RLS_ISOLATION FAIL ..."  -> the listed person can see someone else's rows.
-- No names, emails or contents are printed: only role, first 8 chars of an id, counts.
do $$
declare
  p record; t text; bad bigint; fails text := ''; checked int := 0; allowed uuid[];
  anon_ok text[] := array['app_flags','articles_public','feed_comments','feed_posts','housing_listings_public',
    'life_videos','life_videos_public','programme_search','programmes','scholarship_offers','universities',
    'university_videos_public','whop_config'];
  r record; n bigint;
begin
  -- 1. anonymous visitors: only the public catalogue may return rows
  execute 'set local role anon';
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r','v','m','p') loop
    begin
      execute format('select count(*) from public.%I', r.relname) into n;
      if n > 0 and not (r.relname = any(anon_ok)) then fails := fails || 'anon:' || r.relname || '=' || n || '; '; end if;
    exception when others then null;  -- no privilege = blocked, which is fine
    end;
  end loop;
  execute 'reset role';

  -- 2. every student and partner: tables keyed by profile_id
  for p in select id, role, partner_id from public.profiles where role in ('student','partner') loop
    if p.role = 'partner' then
      select coalesce(array_agg(id), '{}') || p.id into allowed from public.profiles where partner_id = p.partner_id and role = 'student';
    else
      allowed := array[p.id];
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true);
    foreach t in array array['documents','applications','agreement_acceptances','paystack_payments','student_details','push_subscriptions'] loop
      execute 'set local role authenticated';
      execute format('select count(*) from public.%I where not (profile_id = any($1))', t) using allowed into bad;
      execute 'reset role';
      checked := checked + 1;
      if bad <> 0 then fails := fails || p.role || ':' || left(p.id::text, 8) || ' ' || t || '=' || bad || '; '; end if;
    end loop;
    -- application history follows the application's owner
    execute 'set local role authenticated';
    select count(*) into bad from public.application_events e
      where not exists (select 1 from public.applications a where a.id = e.application_id and a.profile_id = any(allowed));
    execute 'reset role';
    checked := checked + 1;
    if bad <> 0 then fails := fails || p.role || ':' || left(p.id::text, 8) || ' application_events=' || bad || '; '; end if;
    -- private storage: own folder, own partner's students, staff avatars, and chat channels only
    execute 'set local role authenticated';
    select count(*) into bad from storage.objects o
      where o.bucket_id in ('documents','cvs','wa-media','partner-docs')
        and not (split_part(o.name, '/', 1) = any(select x::text from unnest(allowed) x));
    execute 'reset role';
    checked := checked + 1;
    if bad <> 0 then fails := fails || p.role || ':' || left(p.id::text, 8) || ' storage=' || bad || '; '; end if;
  end loop;

  if fails = '' then
    raise exception 'RLS_ISOLATION PASS (% checks, anon + every student and partner)', checked;
  else
    raise exception 'RLS_ISOLATION FAIL: %', fails;
  end if;
end $$;
