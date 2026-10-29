-- Additive: lets finance-write record each manual entry exactly once.
-- The portal sends one request_id per save; a double tap or a retried request reuses it,
-- and the unique index turns the second insert into a no-op that returns the first row.
-- Existing rows keep NULL (allowed many times). Rollback: drop index + column.
alter table public.finance_transactions add column if not exists client_request_id text;
create unique index if not exists finance_transactions_client_request_id_key
  on public.finance_transactions (client_request_id) where client_request_id is not null;
