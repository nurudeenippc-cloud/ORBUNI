-- Funnel watchdog (17 Oct 2026). Every 30 minutes the database asks its own public API, exactly like a logged-out
-- visitor would, for the VIP and strategy-call plans. The next run reads the answer; if it is not a 200 with both
-- plans, the team gets a "The VIP checkout is broken for visitors" alert (push, email and WhatsApp), at most once per 6 hours.
-- Born from the whop_config permission failure that hid the VIP payment form from every logged-out visitor.
create table if not exists public.funnel_health_state (id int primary key, req_id bigint, checked_at timestamptz);
alter table public.funnel_health_state enable row level security;
-- function public.funnel_health(): see the live database (created with security definer; uses net.http_get + raise_notification)
-- cron: select cron.schedule('orb-funnel-health', '*/30 * * * *', 'select public.funnel_health()');
