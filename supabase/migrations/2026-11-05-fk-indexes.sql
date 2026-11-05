-- 5 Nov 2026: an index on every foreign key that had none (102 of them, flagged by the
-- Supabase performance advisor). Joins and "rows that belong to X" lookups (a student's
-- documents, a lead's messages, a project's files) stay fast as the tables grow, and
-- deletes on the parent table no longer scan the child table.
-- Safe to re-run. Rollback: drop index public.ix_<table>_<column> for any you want gone.
do $$ declare r record; begin
  for r in
    with fk as (
      select c.conrelid, c.conkey, cl.relname tbl,
        (select string_agg(quote_ident(a.attname), ', ' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) cols,
        (select string_agg(a.attname, '_' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) colnames
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      where c.contype = 'f' and n.nspname = 'public')
    select format('create index if not exists %I on public.%I (%s)', left('ix_' || tbl || '_' || colnames, 63), tbl, cols) ddl
    from fk where not exists (select 1 from pg_index i where i.indrelid = fk.conrelid
                              and (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] = fk.conkey)
  loop
    execute r.ddl;
  end loop;
end $$;
