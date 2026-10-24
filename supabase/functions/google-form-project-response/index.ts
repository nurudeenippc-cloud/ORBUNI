// Google Form → growth project responses / tester videos (called by the form's Apps Script).
// Auth: the shared secret lives in the edge-function secret GFORM_WEBHOOK_SECRET and must be
// sent in the "x-orbuni-webhook-secret" header. It is never accepted in the URL (URLs end up in logs).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("GFORM_WEBHOOK_SECRET") ?? "";
const DEFAULT_PROJECT = "4a0ae101-a3b9-4adf-979a-31a1d3cba0f7";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

// constant-time string compare, so the secret cannot be guessed from response timing
function sameText(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function client() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!WEBHOOK_SECRET) {
    console.error("google-form-project-response: GFORM_WEBHOOK_SECRET is not set");
    return json({ error: "Not configured" }, 503);
  }
  const secret = req.headers.get("x-orbuni-webhook-secret") ?? "";
  if (!sameText(secret, WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const supabase = client();
  const projectId = body.project_id || DEFAULT_PROJECT;
  const action = body.action || "submit";

  if (action === "prepare-video") {
    const ext = String(body.file_name || "video.mp4").split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
    const path = `${projectId}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    const { data, error } = await supabase.storage
      .from("growth-project-videos")
      .createSignedUploadUrl(path);
    if (error || !data?.signedUrl) return json({ error: error?.message || "Could not create upload URL" }, 500);
    return json({ ok: true, path, signedUrl: data.signedUrl, token: data.token });
  }

  if (action === "commit-video") {
    const path = String(body.path || "");
    if (!path) return json({ error: "path required" }, 400);
    const { data: videoRow, error } = await supabase.from("growth_project_videos").insert({
      project_id: projectId,
      tester_name: body.tester_name || "Unknown",
      storage_path: path,
      file_name: body.file_name || "Form video",
      notes: body.notes || null,
      status: "pending"
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, video_id: videoRow.id, path });
  }

  const { data: project, error: projectError } = await supabase
    .from("growth_projects").select("id").eq("id", projectId).maybeSingle();
  if (projectError || !project) return json({ error: "Project not found" }, 400);

  const externalId = body.external_response_id ? String(body.external_response_id) : null;
  if (externalId) {
    const { data: existing } = await supabase.from("growth_project_responses")
      .select("id").eq("source", "google_form").eq("external_response_id", externalId).maybeSingle();
    if (existing) return json({ ok: true, duplicate: true, id: existing.id });
  }

  const answers = body.answers && typeof body.answers === "object" ? body.answers : body.response_data || body;
  const respondentName = body.respondent_name || answers["Full Name"] || answers["full_name"] || answers["Name"] || null;
  const respondentEmail = body.respondent_email || answers["Email Address"] || answers["email"] || answers["Email"] || null;

  const { data: responseRow, error: responseError } = await supabase.from("growth_project_responses").insert({
    project_id: projectId,
    submitted_at: body.submitted_at ? new Date(body.submitted_at).toISOString() : new Date().toISOString(),
    respondent_name: respondentName,
    respondent_email: respondentEmail,
    response_data: answers,
    source: "google_form",
    external_response_id: externalId
  }).select("id").single();
  if (responseError) return json({ error: responseError.message }, 500);

  let videoId = body.video_id || null;
  const storagePath = body.video_storage_path || body.storage_path || null;
  const videoLink = body.video_link || answers["Loom Link or Video Link"] || answers["Loom Link"] || answers["Video Link"] || answers["loom_link"] || answers["video_link"] || null;

  if (!videoId && storagePath) {
    const { data: videoRow } = await supabase.from("growth_project_videos").insert({
      project_id: projectId,
      tester_name: respondentName || "Unknown",
      storage_path: storagePath,
      file_name: body.file_name || "Form video",
      notes: answers["Short summary of your experience"] || answers["summary"] || null,
      status: "pending"
    }).select("id").single();
    if (videoRow) videoId = videoRow.id;
  } else if (!videoId && videoLink && typeof videoLink === "string" && videoLink.trim().length > 5) {
    const { data: videoRow } = await supabase.from("growth_project_videos").insert({
      project_id: projectId,
      tester_name: respondentName || "Unknown",
      storage_path: videoLink.trim(),
      file_name: videoLink.includes("loom.com") ? "Loom recording" : "Video link",
      notes: answers["Short summary of your experience"] || answers["summary"] || null,
      status: "pending"
    }).select("id").single();
    if (videoRow) videoId = videoRow.id;
  }

  return json({ ok: true, response_id: responseRow.id, video_id: videoId });
});
