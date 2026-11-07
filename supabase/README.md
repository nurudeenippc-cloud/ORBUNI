# WhatsApp (Twilio) — backend

Deployed to Supabase project `ytsebzdykfeiiuxbdtvr` (edge functions are deployed
from here by hand / by Claude; nothing deploys automatically).

| Function | What it does | Auth |
|---|---|---|
| `wa-webhook` | Twilio posts every incoming WhatsApp message and delivery update here. Saves it, runs the AI agent, hands sensitive chats to a person, handles STOP/START. | Twilio signature (`X-Twilio-Signature`) |
| `wa-send` | The portal inbox: reply, send a template, AI on/off, hand back to AI, mark read. | signed-in staff (`is_staff()`) |
| `wa-templates` | Creates the message templates in Twilio, submits them to Meta, records Meta's decision. pg_cron every 30 min. | `x-orb-secret` |
| `wa-followups` | Hourly automatic follow-ups (quiz, unpaid checkout, missing documents, offer, 14-day check-in) + low Twilio balance warning. | `x-orb-secret` |

`_wa/wa.ts` is the shared code; a copy sits next to each function that uses it
(the deploy tool uploads one folder at a time). Edit `_wa/wa.ts`, then copy it.

Secrets (Supabase → Edge Functions → Secrets): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_WHATSAPP_FROM` (`whatsapp:+14434481577`), `ANTHROPIC_API_KEY`, `ORB_CRON_SECRET`.
Optional: `WA_AGENT_MODEL` to pin the Claude model.

The number: +1 443 448 1577 (Twilio), WhatsApp Business Account `1395270946120928`
(MY ORBUNI), Twilio sender `XE11e81b6e3a483307ce45549c816e295c`.
Database: `supabase/migrations/2026-10-03-whatsapp.sql`.
