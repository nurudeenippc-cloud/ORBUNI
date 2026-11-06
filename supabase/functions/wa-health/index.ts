// Orbuni — read-only WhatsApp health check (x-orb-secret). Returns the WhatsApp sender's
// profile and Meta status (display name, name approval, quality, limits) and the Twilio
// balance. Never returns keys or message contents.
// POST {"set_name": "..."} (same secret) asks Meta, through Twilio, to change the display
// name of the online sender on TWILIO_WHATSAPP_FROM; Meta reviews it (usually 1-3 days).
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
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const name = String(body.set_name || "").trim();
    if (name.length < 3 || name.length > 60) return json(400, { error: "set_name: 3 to 60 characters" });
    const me = (s.j.senders || []).find((x: any) => x.sender_id === FROM && x.status === "ONLINE");
    if (!me?.sid) return json(404, { error: "no online sender for TWILIO_WHATSAPP_FROM" });
    const r = await fetch(`https://messaging.twilio.com/v2/Channels/Senders/${me.sid}`, {
      method: "POST", headers: { ...AUTH, "Content-Type": "application/json" }, body: JSON.stringify({ profile: { name } }) });
    const j: any = await r.json().catch(() => ({}));
    out.set_name = { http: r.status, requested: name, now: j.profile?.name ?? null, status: j.status ?? null,
      properties: j.properties ?? null, error: r.ok ? null : (j.message || j.code || "refused") };
  }
  if (!out.senders || !(out.senders as any[]).length) out.raw_keys = Object.keys(s.j || {});
  const b = await get(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Balance.json`);
  out.balance = b.j.balance ?? null; out.currency = b.j.currency ?? null;
  return json(200, out);
});
