-- The Google/Zoom app secret lives in Vault, but the vault schema is not reachable
-- through the API, so edge functions that read vault.decrypted_secrets directly got
-- nothing back: "Connect" failed (409) and every token refresh marked connections
-- "expired". Functions now read it through this service-role-only function.
create or replace function public.connector_client_secret(p_provider text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select v.decrypted_secret from vault.decrypted_secrets v
       join public.connector_providers p on p.client_secret_id = v.id where p.id = p_provider),
    (select p.client_secret from public.connector_providers p where p.id = p_provider));
$$;
revoke all on function public.connector_client_secret(text) from public, anon, authenticated;
grant execute on function public.connector_client_secret(text) to service_role;
