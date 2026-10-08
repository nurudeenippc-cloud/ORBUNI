import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PUBLIC_REDIRECT = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/connector-oauth`;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// The client secret lives in Supabase Vault (connector_providers.client_secret_id).
// The vault schema is not reachable through the API, so it is read through the
// service-role-only database function connector_client_secret(). Reading
// vault.decrypted_secrets directly returned nothing, so "Connect" answered
// "not_configured" (409) and the portal showed "Edge Function returned a non-2xx status code".
async function providerSecret(provider: string) {
  const { data, error } = await admin.rpc("connector_client_secret", { p_provider: provider });
  if (error) console.error("connector secret", error.message);
  return (data as string | null) || null;
}

const PROVIDERS: Record<string, {
  authorize: string; token: string; scope: string; basicAuth: boolean; whoami: string;
  emailAt: (j: any) => string | null;
}> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    basicAuth: false,
    whoami: "https://www.googleapis.com/oauth2/v3/userinfo",
    emailAt: (j) => j?.email ?? null,
  },
  zoom: {
    authorize: "https://zoom.us/oauth/authorize",
    token: "https://zoom.us/oauth/token",
    scope: "meeting:write user:read",
    basicAuth: true,
    whoami: "https://api.zoom.us/v2/users/me",
    emailAt: (j) => j?.email ?? null,
  },
};

const enc = new TextEncoder();
async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(SERVICE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function signState(payload: unknown) {
  const body = b64u(JSON.stringify(payload));
  return body + "." + (await hmac(body));
}
async function readState(state: string) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  if ((await hmac(body)) !== sig) return null;
  try {
    const p = JSON.parse(unb64u(body));
    if (!p.ts || Date.now() - p.ts > 10 * 60 * 1000) return null;
    return p;
  } catch { return null; }
}

function safeReturn(raw: string | undefined) {
  const fallback = "https://myorbuni.com/#connected=google";
  try {
    const u = new URL(String(raw));
    const ok = u.protocol === "https:" &&
      (u.hostname === "myorbuni.com" || u.hostname.endsWith(".myorbuni.com") ||
       u.hostname.endsWith(".netlify.app"));
    if (!ok) return fallback;
    const hash = u.hash && u.hash !== "#" ? u.hash : "#connected=google";
    return u.origin + u.pathname + hash;
  } catch { return fallback; }
}

function bounce(to: string, extraHash: string) {
  const base = to.split("#")[0];
  const keep = to.includes("#") ? to.slice(to.indexOf("#") + 1) : "";
  const add = String(extraHash || "").replace(/^#/, "");
  const hash = [keep, add].filter(Boolean).join("&");
  return new Response(null, { status: 302, headers: { Location: base + (hash ? "#" + hash : "") } });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const redirectUri = PUBLIC_REDIRECT;

  if (req.method === "GET" && (url.searchParams.get("code") || url.searchParams.get("error"))) {
    const st = await readState(url.searchParams.get("state") ?? "");
    const back = safeReturn(st?.ret);
    if (!st) return bounce("https://myorbuni.com/", "#connector_error=expired");
    if (url.searchParams.get("error")) return bounce(back, "#connector_error=declined");

    const spec = PROVIDERS[st.provider];
    const { data: prov } = await admin.from("connector_providers")
      .select("client_id").eq("id", st.provider).maybeSingle();
    const secret = prov ? await providerSecret(st.provider) : null;
    if (!spec || !prov?.client_id || !secret) return bounce(back, "#connector_error=not_configured");

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: url.searchParams.get("code")!,
      redirect_uri: redirectUri,
    });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (spec.basicAuth) headers["Authorization"] = "Basic " + btoa(`${prov.client_id}:${secret}`);
    else {
      form.set("client_id", String(prov.client_id).replace(/\s+/g, ""));
      form.set("client_secret", String(secret).replace(/\s+/g, ""));
    }

    const tr = await fetch(spec.token, { method: "POST", headers, body: form });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) return bounce(back, "#connector_error=exchange_failed");

    let email: string | null = null;
    try {
      const who = await fetch(spec.whoami, { headers: { Authorization: "Bearer " + tok.access_token } });
      if (who.ok) email = spec.emailAt(await who.json());
    } catch {}

    const { data: conn, error: ce } = await admin.from("user_connections").upsert({
      profile_id: st.uid,
      provider: st.provider,
      account_email: email,
      scopes: tok.scope ?? spec.scope,
      status: "connected",
      connected_at: new Date().toISOString(),
    }, { onConflict: "profile_id,provider" }).select("id").single();
    if (ce || !conn) return bounce(back, "#connector_error=save_failed");

    await admin.from("user_connection_tokens").upsert({
      connection_id: conn.id,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? null,
      expires_at: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    });

    return bounce(back, "connected=" + st.provider);
  }

  if (req.method === "POST") {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Sign in first." }, 401);

    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + jwt } }, auth: { persistSession: false },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: "Sign in first." }, 401);

    const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!prof || (prof.role !== "staff" && prof.role !== "admin"))
      return json({ error: "Only the Orbuni team can connect a calendar." }, 403);

    const body = await req.json().catch(() => ({}));
    const provider = String(body.provider ?? "");
    const spec = PROVIDERS[provider];
    if (!spec) return json({ error: "Unknown connector." }, 400);

    const { data: prov } = await admin.from("connector_providers")
      .select("client_id, label").eq("id", provider).maybeSingle();
    const secret = prov ? await providerSecret(provider) : null;
    if (!prov?.client_id || !secret) {
      return json({ error: "not_configured", message: "Not registered yet.", redirect_uri: redirectUri }, 409);
    }

    const state = await signState({ uid: user.id, provider, ret: body.return_url, ts: Date.now() });
    const q = new URLSearchParams({
      client_id: String(prov.client_id).replace(/\s+/g, ""),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: spec.scope,
      state,
    });
    if (provider === "google") { q.set("access_type", "offline"); q.set("prompt", "consent"); }
    return json({ url: spec.authorize + "?" + q.toString(), redirect_uri: redirectUri });
  }

  return json({ ok: true, redirect_uri: redirectUri });
});
