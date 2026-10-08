// Orbuni - "Book a free call with our team" from the assessment result.
//
// POST { action: "slots" }                         -> { slots: ["2026-09-25T07:00:00Z", …], tz: "Europe/Istanbul" }
// POST { action: "book", slot, name, email, phone, note, pathway, website? }
//                                                   -> { ok, starts_at, join_url, host }
//
// Hosts are the Orbuni team members who have connected Google Calendar in the
// portal and are in the lead rotation. Slots: Mon–Sat, 10:00–18:00 Türkiye
// time, 30 minutes, from 3 hours ahead up to 7 days. A slot is offered when at
// least one host is free in Google Calendar and has no Orbuni call booked.
// Booking creates the Google Calendar event with a Meet link and the student
// as a guest (Google sends the invite), saves it in call_bookings, tells the
// team and queues a confirmation email.
// While nobody has connected Google Calendar, every working-hours slot that is not
// already taken is offered; the booking is saved as "requested" and the team
// confirms it with the student on WhatsApp (the alert carries their number).
//
// Open to people who are not signed in (they come straight from the landing
// page), so it is fenced: the email must belong to a lead from the last 30
// days (or the caller must be signed in), at most 2 upcoming calls per email,
// 30 bookings per hour in total, and a honeypot field.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TZ_OFFSET_H = 3;           // Türkiye, UTC+3 all year
const OPEN_H = 10, CLOSE_H = 18; // local hours
const SLOT_MIN = 30, DAYS = 7, LEAD_H = 3;

const CACHE: { at: number; data: unknown } = { at: 0, data: null };
type Host = { id: string; name: string; conn: string; token: string | null };

async function freshToken(connectionId: string) {
  const { data: tok } = await admin.from("user_connection_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
  if (!tok?.access_token) return null;
  const stillGood = !tok.expires_at || new Date(tok.expires_at).getTime() - Date.now() > 120_000;
  if (stillGood) return tok.access_token as string;
  if (!tok.refresh_token) return null;
  // The secret lives in Vault; the vault schema is not reachable through the API, so it
  // comes through the service-role-only database function connector_client_secret().
  const { data: prov } = await admin.from("connector_providers").select("client_id").eq("id", "google").maybeSingle();
  const { data: sec } = await admin.rpc("connector_client_secret", { p_provider: "google" });
  const secret = (sec as string | null) || null;
  if (!prov?.client_id || !secret) return null;
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token,
    client_id: String(prov.client_id).replace(/\s+/g, ""), client_secret: String(secret).replace(/\s+/g, "") });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return null;
  await admin.from("user_connection_tokens").update({
    access_token: j.access_token, refresh_token: j.refresh_token ?? tok.refresh_token,
    expires_at: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null, updated_at: new Date().toISOString(),
  }).eq("connection_id", connectionId);
  return j.access_token as string;
}

async function hosts(): Promise<Host[]> {
  const { data: conns } = await admin.from("user_connections").select("id, profile_id, status").eq("provider", "google");
  const out: Host[] = [];
  for (const c of conns ?? []) {
    if (c.status && c.status !== "connected") continue;
    const { data: p } = await admin.from("profiles").select("first_name, last_name, role, is_owner, accepts_students").eq("id", c.profile_id).maybeSingle();
    if (!p || !(p.is_owner || p.role === "admin" || p.role === "staff")) continue;
    if (p.accepts_students === false && !p.is_owner) continue;
    out.push({ id: c.profile_id, name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Orbuni", conn: c.id, token: await freshToken(c.id) });
  }
  return out;
}

function candidateSlots(): Date[] {
  const out: Date[] = [];
  const now = Date.now(), earliest = now + LEAD_H * 36e5;
  for (let d = 0; d <= DAYS; d++) {
    const local = new Date(now + TZ_OFFSET_H * 36e5 + d * 864e5);           // "local" date via shifted UTC
    const y = local.getUTCFullYear(), m = local.getUTCMonth(), day = local.getUTCDate();
    const dow = new Date(Date.UTC(y, m, day)).getUTCDay();
    if (dow === 0) continue;                                                 // Sunday off
    for (let mins = OPEN_H * 60; mins + SLOT_MIN <= CLOSE_H * 60; mins += SLOT_MIN) {
      const t = Date.UTC(y, m, day, 0, mins) - TZ_OFFSET_H * 36e5;
      if (t >= earliest && t <= now + DAYS * 864e5) out.push(new Date(t));
    }
  }
  return out;
}

async function busyFor(h: Host, from: Date, to: Date): Promise<[number, number][]> {
  const busy: [number, number][] = [];
  if (h.token) {
    try {
      const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", { method: "POST",
        headers: { Authorization: "Bearer " + h.token, "Content-Type": "application/json" },
        body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] }) });
      if (r.ok) {
        const j = await r.json();
        for (const b of j?.calendars?.primary?.busy ?? []) busy.push([new Date(b.start).getTime(), new Date(b.end).getTime()]);
      }
    } catch (_) { /* treat as free; our own bookings still block below */ }
  }
  const { data: mine } = await admin.from("call_bookings").select("starts_at, ends_at").eq("host_id", h.id).eq("status", "booked")
    .gte("ends_at", from.toISOString()).lte("starts_at", to.toISOString());
  for (const b of mine ?? []) busy.push([new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]);
  return busy;
}
const free = (busy: [number, number][], s: number, e: number) => !busy.some(([a, b]) => a < e && b > s);

async function availability() {
  const hs = await hosts();
  const cands = candidateSlots();
  if (!cands.length) return { hs, cands, byHost: new Map<string, [number, number][]>(), open: [] as number[] };
  if (!hs.length) {
    // Nobody has connected Google Calendar yet: offer working hours, minus calls already requested.
    const { data: taken } = await admin.from("call_bookings").select("starts_at").in("status", ["booked", "requested"])
      .gte("starts_at", new Date().toISOString());
    const t = new Set((taken ?? []).map((b) => new Date(b.starts_at).getTime()));
    return { hs, cands, byHost: new Map<string, [number, number][]>(), open: cands.map((d) => d.getTime()).filter((x) => !t.has(x)) };
  }
  const from = cands[0], to = new Date(cands[cands.length - 1].getTime() + SLOT_MIN * 60000);
  const byHost = new Map<string, [number, number][]>();
  for (const h of hs) byHost.set(h.id, await busyFor(h, from, to));
  const open = cands.map((d) => d.getTime()).filter((t) => hs.some((h) => free(byHost.get(h.id)!, t, t + SLOT_MIN * 60000)));
  return { hs, cands, byHost, open };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "slots");

  if (action === "slots") {
    // Public and cheap: one calendar check a minute, whoever asks.
    if (!CACHE.data || Date.now() - CACHE.at > 60_000) {
      const { open, hs } = await availability();
      CACHE.data = { slots: open.map((t) => new Date(t).toISOString()), tz: "Europe/Istanbul", minutes: SLOT_MIN, hosts: hs.length };
      CACHE.at = Date.now();
    }
    return json(CACHE.data);
  }
  if (action !== "book") return json({ error: "Unknown action." }, 400);

  // ---- fences ----
  if (body.website) return json({ ok: true });                                  // honeypot
  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const note = String(body.note || "").trim().slice(0, 500);
  const pathway = ["higher", "medium", "lower"].includes(String(body.pathway)) ? String(body.pathway) : null;
  if (name.length < 2) return json({ error: "Add your name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Add an email we can send the invitation to." }, 400);
  const slot = new Date(String(body.slot || ""));
  if (isNaN(slot.getTime())) return json({ error: "Pick a time." }, 400);

  let userId: string | null = null;
  const auth = req.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    try {
      const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const { data: u } = await asUser.auth.getUser();
      userId = u?.user?.id ?? null;
    } catch (_) { userId = null; }
  }
  const emailLike = email.replace(/[%_\\]/g, (c) => "\\" + c);
  const { data: lead } = await admin.from("leads").select("id, owner_id, name, phone").ilike("email", emailLike)
    .gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let found = lead;
  // No email on the assessment? Match the lead by the WhatsApp number they gave (last 2 days).
  const digits = phone.replace(/\D/g, "").slice(-9);
  if (!found && digits.length >= 7) {
    const { data: byPhone } = await admin.from("leads").select("id, owner_id, name, phone, email").ilike("phone", "%" + digits + "%")
      .gte("created_at", new Date(Date.now() - 2 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (byPhone) found = byPhone;
  }
  if (!found && !userId) return json({ error: "Take the 2-minute assessment first — then you can book your call." }, 403);

  const { count: upcoming } = await admin.from("call_bookings").select("id", { count: "exact", head: true })
    .ilike("email", emailLike).in("status", ["booked", "requested"]).gte("starts_at", new Date().toISOString());
  if ((upcoming ?? 0) >= 2) return json({ error: "You already have a call booked — check your email for the details." }, 409);
  const { count: lastHour } = await admin.from("call_bookings").select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 36e5).toISOString());
  if ((lastHour ?? 0) >= 30) return json({ error: "Lots of bookings right now — please try again in a few minutes." }, 429);

  // ---- the slot must still be open; pick the host ----
  const { hs, byHost, open } = await availability();
  const t = slot.getTime();
  if (!open.includes(t)) return json({ error: "That time was just taken — please pick another." }, 409);
  const freeHosts = hs.filter((h) => free(byHost.get(h.id)!, t, t + SLOT_MIN * 60000));
  const host = freeHosts.find((h) => found?.owner_id && h.id === found.owner_id) || freeHosts[0];
  const endsAt = new Date(t + SLOT_MIN * 60000);

  let joinUrl: string | null = null, htmlLink: string | null = null, externalId: string | null = null;
  if (host?.token) {
    const ev = {
      summary: "Orbuni call with " + name,
      description: "Free call booked from myorbuni.com.\n\nStudent: " + name + "\nEmail: " + email + (phone ? "\nWhatsApp: " + phone : "")
        + (pathway ? "\nAssessment: " + pathway + " intent" : "") + (note ? "\n\nNote: " + note : ""),
      start: { dateTime: slot.toISOString(), timeZone: "Europe/Istanbul" },
      end: { dateTime: endsAt.toISOString(), timeZone: "Europe/Istanbul" },
      attendees: [{ email }],
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    };
    const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      { method: "POST", headers: { Authorization: "Bearer " + host.token, "Content-Type": "application/json" }, body: JSON.stringify(ev) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      joinUrl = j.hangoutLink ?? j.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? null;
      htmlLink = j.htmlLink ?? null; externalId = j.id ?? null;
    }
  }

  const { data: row, error } = await admin.from("call_bookings").insert({
    lead_id: found?.id ?? null, profile_id: userId, name, email, phone: phone || null, note: note || null, pathway,
    starts_at: slot.toISOString(), ends_at: endsAt.toISOString(), host_id: host?.id ?? null,
    join_url: joinUrl, html_link: htmlLink, external_id: externalId, status: host ? "booked" : "requested",
  }).select("id").single();
  if (error) return json({ error: "Could not save the booking — please try again." }, 500);

  CACHE.data = null;
  const when = slot.toLocaleString("en-GB", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const contactLine = (phone ? " · WhatsApp " + phone : "") + " · " + email;
  try {
    await admin.rpc("raise_notification", { p_kind: "lead_assigned", p_title: "Call booked: " + name,
      p_body: when + " (Türkiye)" + (host ? " with " + host.name : " · no calendar connected: confirm the time with the student and send the video link")
        + (pathway ? " · " + pathway + " intent" : "") + contactLine + (note ? " · Note: " + note : ""),
      p_subject_id: userId, p_entity_type: "call_booking", p_entity_id: row.id, p_payload: { lead_id: found?.id ?? null } });
  } catch (_) { /* never block the booking on a notification */ }
  try {
    await admin.from("email_outbox").insert({ profile_id: userId, to_email: email, template: "call_booked",
      vars: { first_name: name.split(" ")[0], when: when + " (Türkiye time)", host: host?.name ?? "the Orbuni team", link: joinUrl ?? "" },
      dedupe_key: "call:" + row.id });
  } catch (_) { /* ignore */ }
  return json({ ok: true, starts_at: slot.toISOString(), when, join_url: joinUrl, host: host?.name ?? null });
});
