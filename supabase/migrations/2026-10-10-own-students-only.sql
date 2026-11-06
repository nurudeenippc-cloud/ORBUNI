-- 10 Oct 2026 · A teammate sees the students they brought, not everyone's.
--
-- Owner and admins still see every student (staff_can('allstudents') is true for them).
-- Any other staff account sees: themselves, and students whose counsellor is them
-- (Create a student sets that automatically). The owner can open "All students and
-- applications" for a person in Team & alerts → Who can open what.
--
-- Nothing is dropped. Rollback = ALTER POLICY ... back to public.is_staff() on each line.

create or replace function public.section_list() returns text[]
language sql immutable set search_path to 'public' as
$$ select array['partners','enq','jobs','ops','schol','arts','team','finance','finance-rules','marketing','projects','leads','content','wa','askuni','docs','allstudents']::text[] $$;

create or replace function public.my_student(p_profile uuid) returns boolean
language sql stable security definer set search_path to 'public' as
$$ select public.is_staff() and exists (select 1 from public.profiles s where s.id = p_profile and s.counsellor_id = auth.uid()) $$;
revoke all on function public.my_student(uuid) from public, anon;
grant execute on function public.my_student(uuid) to authenticated;

alter policy "read own profile" on public.profiles
  using (id = auth.uid() or public.staff_can('allstudents') or (public.is_staff() and counsellor_id = auth.uid()));
alter policy "update own profile" on public.profiles
  using (id = auth.uid() or public.staff_can('allstudents') or (public.is_staff() and counsellor_id = auth.uid()))
  with check (id = auth.uid() or public.staff_can('allstudents') or (public.is_staff() and counsellor_id = auth.uid()));

alter policy "own details" on public.student_details
  using (profile_id = auth.uid() or public.staff_can('allstudents') or public.my_student(profile_id))
  with check (profile_id = auth.uid() or public.staff_can('allstudents') or public.my_student(profile_id));

alter policy "own applications" on public.applications
  using (profile_id = auth.uid() or public.staff_can('allstudents') or public.my_student(profile_id))
  with check (profile_id = auth.uid() or public.staff_can('allstudents') or public.my_student(profile_id));

alter policy "own application history" on public.application_events
  using (exists (select 1 from public.applications a where a.id = application_events.application_id
                 and (a.profile_id = auth.uid() or public.staff_can('allstudents') or public.my_student(a.profile_id))));

alter policy "own documents" on public.documents
  using (profile_id = auth.uid() or public.staff_can('docs') or public.my_student(profile_id))
  with check (profile_id = auth.uid() or public.staff_can('docs') or public.my_student(profile_id));
alter policy "staff write student documents" on public.documents
  using (public.staff_can('docs') or public.my_student(profile_id))
  with check (public.staff_can('docs') or public.my_student(profile_id));

alter policy "creator manages their pending students" on public.pending_students
  using (created_by = auth.uid() or public.staff_can('allstudents'))
  with check (created_by = auth.uid() or public.staff_can('allstudents'));

alter policy "so_staff" on public.student_orders
  using (public.staff_can('allstudents') or public.my_student(profile_id))
  with check (public.staff_can('allstudents') or public.my_student(profile_id));

-- the student's files in storage: their own folder, an owner/admin, or the student's own counsellor
alter policy "own documents files" on storage.objects
  using (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.staff_can('docs')
         or exists (select 1 from public.profiles s where s.id::text = (storage.foldername(name))[1] and public.my_student(s.id))
         or exists (select 1 from public.documents d where d.storage_path = objects.name and d.profile_id = auth.uid())))
  with check (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.staff_can('docs')
         or exists (select 1 from public.profiles s where s.id::text = (storage.foldername(name))[1] and public.my_student(s.id))
         or exists (select 1 from public.documents d where d.storage_path = objects.name and d.profile_id = auth.uid())));
alter policy "staff write student files" on storage.objects
  using (bucket_id = 'documents' and (public.staff_can('docs')
         or exists (select 1 from public.profiles s where s.id::text = (storage.foldername(name))[1] and public.my_student(s.id))))
  with check (bucket_id = 'documents' and (public.staff_can('docs')
         or exists (select 1 from public.profiles s where s.id::text = (storage.foldername(name))[1] and public.my_student(s.id))));

-- assigning a student to someone: owners/admins, or handing over a student who is already yours
create or replace function public.set_counsellor(p_student uuid, p_counsellor uuid) returns void
language plpgsql security definer set search_path to 'public' as
$$
begin
  if not public.is_staff() then raise exception 'Only staff can assign a counsellor.'; end if;
  if not (public.staff_can('allstudents') or public.my_student(p_student)) then
    raise exception 'You can only hand over students who are yours.';
  end if;
  if p_counsellor is not null and not exists (
       select 1 from public.profiles where id = p_counsellor and role in ('staff','admin'))
  then raise exception 'That person is not on the team.'; end if;
  update public.profiles set counsellor_id = p_counsellor where id = p_student and role = 'student';
end $$;
