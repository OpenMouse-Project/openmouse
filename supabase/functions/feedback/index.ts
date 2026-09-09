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

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

// Deno KV-backed rate limiting. Global buckets are the real backstop — they
// hold even if a caller spoofs the forwarded-IP headers. Per-IP buckets spread
// the allowance across real users. Best-effort: if KV is unavailable, requests
// are served rather than failing feedback.
const MAX_GLOBAL_PER_MIN = 30;
const MAX_GLOBAL_PER_HOUR = 200;
const MAX_PER_IP_PER_MIN = 5;
const MAX_PER_IP_PER_HOUR = 30;

let kv: Deno.Kv | null = null;
try {
  kv = await Deno.openKv();
} catch {
  kv = null;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

async function overLimit(id: string, key: string, periodMs: number, max: number): Promise<boolean> {
  if (!kv) return false;
  const k = ["feedback", "ratelimit", id, key, Math.floor(Date.now() / periodMs)];
  const res = await kv.atomic().mutate({ key: k, type: "sum", value: new Deno.KvU64(1n) }).commit();
  if (!res.ok) return false;
  const value = (await kv.get<Deno.KvU64>(k)).value?.value ?? 0n;
  return value > BigInt(max);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ message: "Method not allowed." }, 405);
  }
  const origin = req.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ message: "Origin not allowed." }, 403);
  }

  const ip = clientIp(req);
  if (
    (await overLimit("ip", ip, MINUTE_MS, MAX_PER_IP_PER_MIN)) ||
    (await overLimit("ip", ip, HOUR_MS, MAX_PER_IP_PER_HOUR)) ||
    (await overLimit("global", "all", MINUTE_MS, MAX_GLOBAL_PER_MIN)) ||
    (await overLimit("global", "all", HOUR_MS, MAX_GLOBAL_PER_HOUR))
  ) {
    return new Response(JSON.stringify({ message: "Too many requests. Try again later." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    });
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