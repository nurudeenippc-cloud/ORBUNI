-- The language each webinar seat signed up in (en / fr / ar), so WhatsApp messages go out in it.
alter table public.webinar_registrations add column if not exists lang text;
-- webinar_register(): saves p_utm->>'lang' (the page language), or guesses it from the country
-- (French- and Arabic-speaking countries). Full definition applied in the database on 22 Oct 2026.
