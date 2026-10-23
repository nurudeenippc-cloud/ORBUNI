// Retired 24 Sep 2026: this was a one-off diagnostic. Kept as a stub that does nothing
// until it is deleted from the Supabase dashboard (Edge Functions → askuni-debug-shot → Delete).
Deno.serve(() => new Response(JSON.stringify({ error: "retired" }), { status: 410, headers: { "content-type": "application/json" } }));
