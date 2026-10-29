// Orbuni - serves the Whop courses inside the Orbuni portal, so students and
// partners never have to leave myorbuni.com to learn.
//
// POST { course: "masterclass" | "partner_program" }  (JWT optional)
//   -> { access, course:{ id, title, tagline }, chapters:[{ id, title, lessons:[{ id, title, type, content?, embed_type?, embed_id? }] }] }
// Everyone sees the chapter and lesson titles (the curriculum). Lesson bodies
// are only returned to staff and to people who have paid for that course
// (public.my_courses(), fed by whop-sync). Lessons are cached for 10 minutes.
// Secrets: WHOP_API_KEY.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
// Pasted keys sometimes carry a line break or spaces — strip all whitespace.
const WHOP_KEY = env("WHOP_API_KEY").replace(/\s+/g, "");
// Never let a key reach a log, a table or a browser inside an error message.
const scrub = (x: unknown) => String(x).replace(/apik_[A-Za-z0-9_]+/g, "[key]").replace(/Bearer\s+[^\s"']+/g, "Bearer [key]");
const API = "https://api.whop.com/api/v1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Cached = { at: number; course: any; chapters: any[] };
const CACHE = new Map<string, Cached>();

async function whop(path: string) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${WHOP_KEY}`, Accept: "application/json" } });
  if (!r.ok) throw new Error(path.split("?")[0] + " " + r.status + ": " + scrub(await r.text()).slice(0, 200));
  return await r.json();
}

async function loadCourse(courseId: string): Promise<Cached> {
  const hit = CACHE.get(courseId);
  if (hit && Date.now() - hit.at < 600000) return hit;
  const course = await whop("/courses/" + encodeURIComponent(courseId));
  // every lesson with its markdown body, across all chapters
  const lessons: any[] = [];
  let after = "", guard = 0;
  while (guard++ < 5) {
    const page = await whop("/course_lessons?course_id=" + encodeURIComponent(courseId) + "&first=100" + (after ? "&after=" + encodeURIComponent(after) : ""));
    lessons.push(...(page.data ?? []));
    if (!page.page_info?.has_next_page) break;
    after = page.page_info.end_cursor;
  }
  const byId = new Map(lessons.map((l) => [l.id, l]));
  let rawChapters = course.chapters ?? [];
  if (!rawChapters.length) {
    // older shape: chapters listed separately, lessons carry their chapter
    try {
      const cl = await whop("/course_chapters?course_id=" + encodeURIComponent(courseId) + "&first=100");
      rawChapters = (cl.data ?? []).map((c: any) => ({
        ...c, lessons: lessons.filter((l) => (l.chapter?.id ?? l.chapter_id) === c.id)
      }));
    } catch (_) { /* fall through */ }
    if (!rawChapters.length) rawChapters = [{ id: "all", title: "Lessons", order: 1, lessons }];
  }
  const chapters = rawChapters
    .slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
    .map((c: any) => ({
      id: c.id, title: c.title,
      lessons: (c.lessons ?? []).slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((l: any) => {
          const full: any = byId.get(l.id) ?? l;
          return { id: l.id, title: full.title ?? l.title, type: full.lesson_type ?? l.lesson_type,
                   content: full.content ?? null, embed_type: full.embed_type ?? null, embed_id: full.embed_id ?? null,
                   visible: (full.visibility ?? "visible") !== "hidden" };
        }).filter((l: any) => l.visible)
    }));
  const out = { at: Date.now(), course: { id: course.id, title: course.title, tagline: course.tagline ?? null }, chapters };
  CACHE.set(courseId, out);
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const key = String(body.course || "");
  if (!["masterclass", "partner_program"].includes(key)) return json(400, { error: "Which course?" });
  if (!WHOP_KEY) return json(200, { configured: false, error: "Whop is not connected yet." });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: cfg } = await sb.from("whop_config").select("value").eq("key", "course_" + key).maybeSingle();
  const courseId = cfg?.value || "";
  if (!courseId) return json(200, { configured: false, error: "This course is not set up yet." });

  // who is asking, and what have they paid for
  let access = false;
  const auth = req.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u } = await asUser.auth.getUser();
    if (u?.user) {
      const { data: staff } = await asUser.rpc("is_staff");
      if (staff === true) access = true;
      else {
        const { data: mine } = await asUser.rpc("my_courses");
        access = Array.isArray(mine) && mine.includes(key);
      }
    }
  }

  try {
    const c = await loadCourse(courseId);
    const chapters = c.chapters.map((ch: any) => ({
      id: ch.id, title: ch.title,
      lessons: ch.lessons.map((l: any) => access ? l : { id: l.id, title: l.title, type: l.type, locked: true })
    }));
    return json(200, { configured: true, access, course: c.course, chapters });
  } catch (e) {
    return json(502, { error: "Could not load the course from Whop just now.", detail: scrub(e).slice(0, 300) });
  }
});
