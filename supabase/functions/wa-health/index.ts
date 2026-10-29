// Orbuni — read-only WhatsApp health check (x-orb-secret). Returns the WhatsApp sender's
// profile and Meta status (display name, name approval, quality, limits) and the Twilio
// balance. Never returns keys or message contents.
const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const SID = env("TWILIO_ACCOUNT_SID"), TOKEN = env("TWILIO_AUTH_TOKEN"), CRON = env("ORB_CRON_SECRET");
const FROM = env("TWILIO_WHATSAPP_FROM") || "whatsapp:+14434481577";
const AUTH = { Authorization: "Basic " + btoa(SID + ":" + TOKEN) };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const get = async (u: string) => { const r = await fetch(u, { headers: AUTH }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

Deno.serve(async (req) => {
  if (!CRON || req.headers.get("x-orb-secret") !== CRON) return json(403, { error: "forbidden" });
  const out: Record<string, unknown> = { from: FROM.replace(/\d(?=\d{4})/g, "•") };
  const s = await get("https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=20");
  out.senders_http = s.status;
  out.senders = (s.j.senders || []).map((x: any) => ({
    sender: String(x.sender_id || "").replace(/\d(?=\d{4})/g, "•"), status: x.status,
    display_name: x.profile?.name ?? null, about: x.profile?.about ?? null, vertical: x.profile?.vertical ?? null,
    has_logo: !!x.profile?.logo_url, websites: x.profile?.websites ?? null,
    properties: x.properties ?? null, offline_reasons: x.offline_reasons ?? null,
  }));
  if (!out.senders || !(out.senders as any[]).length) out.raw_keys = Object.keys(s.j || {});
  const b = await get(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Balance.json`);
  out.balance = b.j.balance ?? null; out.currency = b.j.currency ?? null;
  return json(200, out);
});
