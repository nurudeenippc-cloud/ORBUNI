import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// The client secret lives in Vault (connector_providers.client_secret_id). The vault
// schema is not reachable through the API, so it is read through the service-role-only
// database function connector_client_secret(); reading vault.decrypted_secrets directly
// returned nothing, every hourly token refresh failed and connections were marked "expired".
async function providerSecret(provider: string) {
  const { data, error } = await admin.rpc("connector_client_secret", { p_provider: provider });
  if (error) console.error("connector secret", error.message);
  return (data as string | null) || null;
}

async function freshToken(connectionId: string, provider: string) {
  const { data: tok } = await admin.from("user_connection_tokens")
    .select("*").eq("connection_id", connectionId).maybeSingle();
  if (!tok?.access_token) return null;
  const stillGood = !tok.expires_at || new Date(tok.expires_at).getTime() - Date.now() > 120_000;
  if (stillGood) return tok.access_token;
  if (!tok.refresh_token) return null;
  const { data: prov } = await admin.from("connector_providers")
    .select("client_id, client_secret, client_secret_id").eq("id", provider).maybeSingle();
  const secret = prov ? await providerSecret(provider) : null;
  if (!prov?.client_id || !secret) return null;
  const endpoint = provider === "google" ? "https://oauth2.googleapis.com/token" : "https://zoom.us/oauth/token";
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (provider === "zoom") headers["Authorization"] = "Basic " + btoa(`${prov.client_id}:${secret}`);
  else {
    form.set("client_id", String(prov.client_id).replace(/\s+/g, ""));
    form.set("client_secret", String(secret).replace(/\s+/g, ""));
  }
  const r = await fetch(endpoint, { method: "POST", headers, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return null;
  await admin.from("user_connection_tokens").update({
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? tok.refresh_token,
    expires_at: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("connection_id", connectionId);
  // a successful refresh means the link is healthy again
  await admin.from("user_connections").update({ status: "connected" }).eq("id", connectionId);
  return j.access_token as string;
}

async function googleCreate(token: string, ev: unknown) {
  return await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(ev) },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "auth", message: "Sign in first." }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: "Bearer " + jwt } }, auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "auth", message: "Sign in first." }, 401);

  const { data: prof } = await admin.from("profiles")
    .select("role, is_owner, first_name, last_name").eq("id", user.id).maybeSingle();
  if (!prof || !(prof.is_owner || prof.role === "staff" || prof.role === "admin"))
    return json({ error: "forbidden", message: "Only the Orbuni team can book a call." }, 403);

  const body = await req.json().catch(() => ({}));

  // Settings asks this whenever it opens: renew each of my connections and
  // report the honest state, so a link that can be renewed heals by itself.
  if (body.action === "check") {
    const { data: mine } = await admin.from("user_connections").select("id, provider").eq("profile_id", user.id);
    const out: Record<string, string> = {};
    for (const c of mine ?? []) {
      const tok = await freshToken(c.id, c.provider);
      const status = tok ? "connected" : "expired";
      await admin.from("user_connections").update({ status }).eq("id", c.id);
      out[c.provider] = status;
    }
    return json({ ok: true, status: out });
  }

  const channelId = String(body.channel_id ?? "");
  const startsAt = new Date(String(body.starts_at ?? ""));
  const minutes = Math.min(180, Math.max(10, Number(body.minutes ?? 30)));
  const title = String(body.title ?? "Call with Orbuni").slice(0, 200);
  const guestId = body.guest_id ? String(body.guest_id) : null;
  if (!channelId || isNaN(startsAt.getTime())) {
    return json({ error: "bad_request", message: "A channel and a real time are needed." }, 400);
  }
  const endsAt = new Date(startsAt.getTime() + minutes * 60000);

  let guestEmail: string | null = body.guest_email ?? null;
  if (!guestEmail && guestId) {
    const { data: g } = await admin.from("profiles").select("email").eq("id", guestId).maybeSingle();
    guestEmail = g?.email ?? null;
  }

  const { data: conn } = await admin.from("user_connections")
    .select("id, provider, account_email").eq("profile_id", user.id)
    .in("provider", ["google", "zoom"]).order("connected_at", { ascending: false });
  const wanted = body.provider ? String(body.provider) : null;
  const use = (conn ?? []).find((c) => !wanted || c.provider === wanted);

  let provider = "none", joinUrl: string | null = null, htmlLink: string | null = null, externalId: string | null = null;

  if (use) {
    const token = await freshToken(use.id, use.provider);
    if (!token) {
      await admin.from("user_connections").update({ status: "expired" }).eq("id", use.id);
      return json({ error: "reconnect", message: "Reconnect Google Calendar in Settings, then book again." }, 409);
    }

    if (use.provider === "google") {
      const base = {
        summary: title,
        description: "Booked through the Orbuni portal.",
        start: { dateTime: startsAt.toISOString(), timeZone: "Europe/Istanbul" },
        end: { dateTime: endsAt.toISOString(), timeZone: "Europe/Istanbul" },
        attendees: guestEmail ? [{ email: guestEmail }] : undefined,
      };
      const withMeet = {
        ...base,
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      };
      let r = await googleCreate(token, withMeet);
      let j = await r.json().catch(() => ({}));
      if (!r.ok) {
        r = await googleCreate(token, base);
        j = await r.json().catch(() => ({}));
      }
      if (!r.ok) {
        const msg = j?.error?.message || j?.error_description || "Google refused the booking. Enable Google Calendar API in Cloud Console, then try again.";
        return json({ error: "calendar_failed", message: String(msg) }, 200);
      }
      provider = "google";
      joinUrl = j.hangoutLink ?? j.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? null;
      htmlLink = j.htmlLink ?? null;
      externalId = j.id ?? null;
    }
    await admin.from("user_connections").update({ last_used_at: new Date().toISOString() }).eq("id", use.id);
  }

  await admin.from("meetings").insert({
    channel_id: channelId, host_id: user.id, guest_id: guestId, guest_email: guestEmail,
    title, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
    provider, external_id: externalId, join_url: joinUrl, html_link: htmlLink,
  });

  const when = startsAt.toLocaleString("en-GB", { timeZone: "Europe/Istanbul" });
  const lines = [
    "Meeting booked",
    "When: " + when + " (Istanbul)",
    "Minutes: " + minutes,
    joinUrl ? "Join: " + joinUrl : (htmlLink ? "Calendar: " + htmlLink : "Join: host will confirm"),
  ];
  await admin.from("messages").insert({
    channel_id: channelId, author_id: user.id, body: lines.join("\n"),
  });

  return json({
    ok: true, provider, join_url: joinUrl,
    note: joinUrl ? "Booked. Meet link is in the thread and on your Google Calendar." :
      (provider === "google" ? "Event is on your Google Calendar. Enable Meet on the event if no link appeared." :
        "Saved in chat. Connect a calendar for a Meet link next time."),
  });
});
