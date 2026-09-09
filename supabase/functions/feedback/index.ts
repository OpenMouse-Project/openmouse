// Feedback relay to Discord. The webhook URL is stored only as the Supabase
// Edge Function secret DISCORD_FEEDBACK_WEBHOOK (supabase secrets set ...) —
// it never ships to the browser and never lives in this repository. The
// client's payload (the JSON embed, or the multipart form with the
// diagnostics attachment) is streamed straight to Discord.
//
// Deploy:
//   supabase link --project-ref <project-ref>
//   supabase secrets set DISCORD_FEEDBACK_WEBHOOK="https://discordapp.com/api/webhooks/..."
//   supabase functions deploy feedback
//   supabase functions deploy feedback --project-ref <project-ref> (unlinked)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const ALLOWED_ORIGINS = new Set([
  "https://openmouse.app",
  "https://www.openmouse.app",
  "https://control.openmouse.app",
]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }
  const origin = req.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ message: "Origin not allowed." }, 403);
  }

  const webhook = Deno.env.get("DISCORD_FEEDBACK_WEBHOOK");
  if (!webhook || !webhook.startsWith("https://discord")) {
    return json({ message: "Feedback is not configured." }, 503);
  }

  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": req.headers.get("Content-Type") ?? "application/json" },
      body: req.body,
    });
    if (!response.ok) {
      return json({ message: "Discord rejected the feedback." }, response.status);
    }
    return json({ ok: true });
  } catch {
    return json({ message: "Discord unreachable." }, 502);
  }
});