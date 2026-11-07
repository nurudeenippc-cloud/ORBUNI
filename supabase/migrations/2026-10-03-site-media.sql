-- Applied to the live project on 2026-10-03. Kept here as the record; already applied.
-- Public bucket for website media (background videos and their poster frames on the guides).
-- Files: bg/7683332, bg/6145693, bg/7683405 (.mp4 + .jpg), free Pexels clips (Pexels licence).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 20971520, array['video/mp4','image/jpeg','image/webp'])
on conflict (id) do nothing;
