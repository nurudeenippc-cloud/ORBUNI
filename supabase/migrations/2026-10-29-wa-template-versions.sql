-- 29 Oct 2026: new WhatsApp poster designs mean new Meta templates ("<key>4").
-- To swap with no gap, the new version waits in next_sid until Meta approves it;
-- senders keep using content_sid (the approved version) until then.
-- meta_name records which version content_sid is. Rollback: drop the three columns.
alter table public.wa_templates add column if not exists meta_name text;
alter table public.wa_templates add column if not exists next_sid text;
alter table public.wa_templates add column if not exists next_approval text;
update public.wa_templates set meta_name = key || '3' where meta_name is null and key like '%\_card' escape '\';
update public.wa_templates set meta_name = key where meta_name is null;
