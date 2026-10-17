// Test harness (team only, x-orb-secret): runs the real WhatsApp AI on sample chats and
// checks that Twilio accepts the "video + buttons" card. Sends nothing to anyone.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { sb, runAgent, buttonContent } from "./wa.ts";
const CRON = (Deno.env.get("ORB_CRON_SECRET") ?? "").trim();
Deno.serve(async (req) => {
  if (!CRON || req.headers.get("x-orb-secret") !== CRON) return new Response("forbidden", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const db = sb();
  const { data: lib } = await db.from("wa_media").select("key,kind,title,url,use_when,level").eq("active", true).order("sort");
  const out: any = { cases: [] };
  for (const c of b.cases || []) {
    const t0 = Date.now();
    const r = await runAgent(c.history, c.file || {}, c.name || "", { library: lib || [], webinar: c.webinar, sentMedia: c.sent || [] });
    out.cases.push({ name: c.title, ms: Date.now() - t0, reply: r?.reply, buttons: r?.buttons, link: r?.link, media: r?.media, action: r?.action, handoff: r?.handoff, model: r?.model });
  }
  if (b.card) {
    const v = (lib || []).find((m: any) => m.key === "webinar_invite");
    out.card_link = await buttonContent(db, "Test: the webinar video with a link button.", [], { title: "Save my free seat", url: "https://myorbuni.com/webinar" }, v?.url || null);
    out.card_quick = await buttonContent(db, "Test: the webinar video with answer buttons.", ["Save my free seat", "Ask a question"], null, v?.url || null);
  }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
});
