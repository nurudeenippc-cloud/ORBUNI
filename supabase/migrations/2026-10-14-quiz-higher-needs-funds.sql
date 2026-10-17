-- 14 Oct 2026 · Scoring audit: "Ready to apply" (higher) needs intent, a near intake AND money in place.
-- Applied to project ytsebzdykfeiiuxbdtvr as migration quiz_higher_needs_funds. Same rule in site/index.html lpScore().
-- Rollback: remove "or coalesce((dims->>'finance')::int,0) < 2" from the check below.
create or replace function public.lead_quiz_score(p_quiz jsonb)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  w record; v int; got numeric := 0; maxp numeric := 0; pct int; path text;
  dims jsonb := '{}'::jsonb;
begin
  for w in select dim, weight from public.quiz_weights loop
    v := least(3, greatest(0, coalesce((p_quiz->>w.dim)::int, 0)));
    dims := dims || jsonb_build_object(w.dim, v);
    got  := got + v * w.weight;
    maxp := maxp + 3 * w.weight;
  end loop;
  pct := case when maxp > 0 then round(got * 100 / maxp) else 0 end;
  path := case when pct >= 65 then 'higher' when pct >= 40 then 'medium' else 'lower' end;
  if path = 'higher' and (coalesce((dims->>'intent')::int,0) < 2 or coalesce((dims->>'timeline')::int,0) < 2
                          or coalesce((dims->>'finance')::int,0) < 2) then
    path := 'medium';
  end if;
  return jsonb_build_object('score', pct, 'pathway', path, 'dims', dims);
end $function$;
