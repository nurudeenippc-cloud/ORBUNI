-- Load test 2026-10-22: 500 webinar sign-ups in 7.2 s, all OK (22 of 60 DB connections).
-- The whole-site quiz/form ceiling (60 leads per 5 minutes) was the real bottleneck: one good ad could hit it.
-- Raised to 240 per 5 minutes; the per-connection limit (rate_guard) and 3-per-person limit are unchanged.
CREATE OR REPLACE FUNCTION public.guard_lead_flood()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n_same int; n_all int;
begin
  if current_user <> 'anon' then return new; end if;
  select count(*) into n_same from public.leads
   where created_at > now() - interval '10 minutes'
     and ((new.email is not null and lower(email) = lower(new.email))
          or (new.phone is not null and regexp_replace(phone, '\D', '', 'g') = regexp_replace(new.phone, '\D', '', 'g')));
  if n_same >= 3 then raise exception 'Too many requests — please wait a few minutes.' using errcode = '54000'; end if;
  -- whole-site ceiling: 240 quiz/form leads per 5 minutes (was 60, which a single good ad could hit)
  select count(*) into n_all from public.leads where created_at > now() - interval '5 minutes' and source in ('quiz','website','form');
  if n_all >= 240 then raise exception 'We are receiving a lot of requests — please try again shortly.' using errcode = '54000'; end if;
  return new;
end $function$;
