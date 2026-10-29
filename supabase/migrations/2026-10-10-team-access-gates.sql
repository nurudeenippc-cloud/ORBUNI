-- 10 Oct 2026 · Who may see WhatsApp, AskUni, student documents and the stack.
--
-- Until now any account with role staff could read these tables straight from the
-- API, even when the portal hid the menu item. They now follow the same rule as the
-- other gated sections: the owner and admins always have them; anyone else needs the
-- owner to open the section for them (Team & alerts → Who can open what).
--
-- Nothing is dropped or deleted. Rollback = ALTER POLICY ... USING (public.is_staff()) on each line below.

create or replace function public.section_list() returns text[]
language sql immutable set search_path to 'public' as
$$ select array['partners','enq','jobs','ops','schol','arts','team','finance','finance-rules','marketing','projects','leads','content','wa','askuni','docs']::text[] $$;

create or replace function public.staff_can(p_section text) returns boolean
language sql stable security definer set search_path to 'public' as
$$
  select public.is_staff() and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and (p.is_owner or p.role = 'admin'))
    or exists (select 1 from public.section_access a where a.profile_id = auth.uid() and a.section = p_section)
  );
$$;
revoke all on function public.staff_can(text) from public, anon;
grant execute on function public.staff_can(text) to authenticated;

-- WhatsApp
alter policy wa_contacts_staff_read   on public.wa_contacts      using (public.staff_can('wa'));
alter policy wa_contacts_staff_update on public.wa_contacts      using (public.staff_can('wa')) with check (public.staff_can('wa'));
alter policy wa_followups_staff_read  on public.wa_followups     using (public.staff_can('wa'));
alter policy wa_messages_staff_read   on public.wa_messages      using (public.staff_can('wa'));
alter policy wa_qr_staff_all          on public.wa_quick_replies using (public.staff_can('wa')) with check (public.staff_can('wa'));
alter policy wa_templates_staff_read  on public.wa_templates     using (public.staff_can('wa'));

-- AskUni pipeline
alter policy askuni_apps_staff_read   on public.askuni_applications using (public.staff_can('askuni'));
alter policy askuni_comm_staff_read   on public.askuni_commissions  using (public.staff_can('askuni'));
alter policy askuni_events_staff_read on public.askuni_events       using (public.staff_can('askuni'));

-- Student documents (passports, transcripts)
alter policy "own documents" on public.documents
  using (profile_id = auth.uid() or public.staff_can('docs'))
  with check (profile_id = auth.uid() or public.staff_can('docs'));
alter policy "staff write student documents" on public.documents
  using (public.staff_can('docs')) with check (public.staff_can('docs'));

-- The stack
alter policy "staff read ops"        on public.ops_tools  using (public.staff_can('ops'));
alter policy "staff read ops events" on public.ops_events using (public.staff_can('ops'));

-- File storage that backs the same data (applied in the same round)
alter policy "wa_media_staff_read"   on storage.objects using (bucket_id = 'wa-media' and public.staff_can('wa'));
alter policy "wa_media_staff_upload" on storage.objects with check (bucket_id = 'wa-media' and public.staff_can('wa') and (storage.foldername(name))[1] = 'out');
alter policy "staff write student files" on storage.objects
  using (bucket_id = 'documents' and public.staff_can('docs')) with check (bucket_id = 'documents' and public.staff_can('docs'));
alter policy "own documents files" on storage.objects
  using (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.staff_can('docs') or exists (select 1 from public.documents d where d.storage_path = objects.name and d.profile_id = auth.uid())))
  with check (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.staff_can('docs') or exists (select 1 from public.documents d where d.storage_path = objects.name and d.profile_id = auth.uid())));
