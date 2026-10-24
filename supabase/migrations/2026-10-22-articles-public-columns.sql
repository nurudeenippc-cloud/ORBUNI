-- Portal guides and the student feed ask articles_public for excerpt + published_at (400 errors before this).
create or replace view public.articles_public as
 SELECT slug, category, title, dek, read_minutes, body, video_id, video_title, video_channel, video_note, image_path, sources, updated_at, sort,
        dek as excerpt, updated_at as published_at
   FROM articles
  WHERE published;
