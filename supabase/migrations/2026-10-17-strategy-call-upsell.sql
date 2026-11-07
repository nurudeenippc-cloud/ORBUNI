-- The last upsell, shown right after the VIP payment (17 Oct 2026).
-- Whop (created through the Whop API, not SQL):
--   product prod_iuSMqj7heDQSd  "1:1 Scholarship Strategy Call"
--   plan    plan_hkkrbCPUbpJTV   one payment of $39, metadata orbuni_tier=strategy_call
-- The site finds the plan through whop_config; whop-sync labels these payments tier 'strategy_call'
-- and the existing payment trigger alerts the team on WhatsApp ("Payment received: $39 ...").
insert into public.whop_config(key, value) values
  ('checkout_strategy_call', 'https://whop.com/checkout/plan_hkkrbCPUbpJTV'),
  ('product_strategy_call', 'prod_iuSMqj7heDQSd')
on conflict (key) do update set value = excluded.value;
-- Video slots (set in Team portal > Webinar > Videos): webinar_recover_vsl, webinar_upsell_vsl.
