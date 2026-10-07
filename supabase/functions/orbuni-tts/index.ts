// Orbuni - a natural voice for the portal assistant.
// The browser's built-in voices sound robotic, so when a voice provider key is
// set the assistant speaks through a neural voice instead:
//   ELEVENLABS_API_KEY  (+ optional ELEVENLABS_VOICE_ID)  → ElevenLabs Flash, streamed
//   OPENAI_API_KEY      (+ optional OPENAI_TTS_VOICE)      → OpenAI TTS, streamed
// With neither set, { on:false } and the portal keeps using the device's best voice.
// GET  ?ping=1            → { on, provider }
// POST { text } + sign-in → audio/mpeg, streamed as it is made
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const SUPABASE_URL = env("SUPABASE_URL");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const EL_KEY = env("ELEVENLABS_API_KEY").replace(/\s+/g, "");
const EL_VOICE = env("ELEVENLABS_VOICE_ID") || "EXAVITQu4vr4xnSDxMaL";
const OA_KEY = env("OPENAI_API_KEY").replace(/\s+/g, "");
const OA_VOICE = env("OPENAI_TTS_VOICE") || "shimmer";
const provider = EL_KEY ? "elevenlabs" : OA_KEY ? "openai" : "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method === "GET") return json({ on: !!provider, provider: provider || null });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!provider) return json({ on: false }, 503);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in first." }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Sign in first." }, 401);

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
  if (!text) return json({ error: "Nothing to say." }, 400);

  let r: Response;
  if (provider === "elevenlabs") {
    r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(EL_VOICE)}/stream?output_format=mp3_44100_64&optimize_streaming_latency=3`, {
      method: "POST",
      headers: { "xi-api-key": EL_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5",
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
    });
  } else {
    r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: "Bearer " + OA_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: OA_VOICE, input: text, response_format: "mp3",
        instructions: "Warm, calm and natural, like a friendly colleague on a phone call. Conversational pace." }),
    });
  }
  if (!r.ok || !r.body) {
    const detail = (await r.text().catch(() => "")).slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, "[key]");
    console.error("tts " + provider + " " + r.status + ": " + detail);
    return json({ error: "voice_failed", status: r.status }, 502);
  }
  return new Response(r.body, { headers: { ...CORS, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
