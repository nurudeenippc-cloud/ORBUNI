// Retired (4 Oct 2026): this public check is no longer needed.
Deno.serve(() => new Response(JSON.stringify({ error: "gone" }), { status: 410, headers: { "Content-Type": "application/json" } }));
