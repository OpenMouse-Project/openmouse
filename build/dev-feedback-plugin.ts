import type { Plugin } from "vite";
import { loadEnv } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface FeedbackValidation {
  valid: boolean;
  status: number;
  body: string;
  embeds: unknown[] | null;
  rawBody: string;
}

export interface DiscordForwardResult {
  ok: boolean;
  status: number;
}

export function feedbackRelayHint(webhook: string | undefined): string {
  if (!webhook || !webhook.startsWith("https://discord")) {
    return "[dev-feedback] relay up, but DISCORD_FEEDBACK_WEBHOOK is not set in .env.local — Share report will answer 503 until it is; add it and restart the dev server";
  }
  return "[dev-feedback] relay up — DISCORD_FEEDBACK_WEBHOOK set; Share report delivers to Discord";
}

const MAX_DEV_BODY_BYTES = 1024 * 1024;

export function validateFeedbackRequest(method: string | undefined, rawBody: string): FeedbackValidation {
  if (method !== "POST") {
    return { valid: false, status: 405, body: JSON.stringify({ message: "Method not allowed." }), embeds: null, rawBody };
  }
  if (typeof rawBody !== "string" || rawBody === "") {
    return { valid: false, status: 400, body: JSON.stringify({ message: "Expected a JSON body." }), embeds: null, rawBody };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { valid: false, status: 400, body: JSON.stringify({ message: "Invalid JSON." }), embeds: null, rawBody };
  }
  const embeds = (parsed as { embeds?: unknown }).embeds;
  if (!Array.isArray(embeds)) {
    return { valid: false, status: 400, body: JSON.stringify({ message: "Expected an embeds array." }), embeds: null, rawBody };
  }
  return { valid: true, status: 200, body: JSON.stringify({ ok: true }), embeds, rawBody };
}

export async function sendToDiscord(
  webhook: string,
  rawBody: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordForwardResult> {
  try {
    const response = await fetchImpl(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 502 };
  }
}

function endJson(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

export function devFeedback(): Plugin {
  return {
    name: "openmouse:dev-feedback",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, "");
      const webhook = env.DISCORD_FEEDBACK_WEBHOOK;
      server.config.logger.info(feedbackRelayHint(webhook));
      server.middlewares.use("/api/feedback", (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let finished = false;
        req.on("data", (chunk: Buffer) => {
          if (finished) return;
          size += chunk.length;
          if (size <= MAX_DEV_BODY_BYTES) {
            chunks.push(chunk);
            return;
          }
          finished = true;
          endJson(res, 413, JSON.stringify({ message: "Payload too large." }));
        });
        req.on("end", async () => {
          if (finished) return;
          const raw = Buffer.concat(chunks).toString("utf8");
          const validation = validateFeedbackRequest(req.method, raw);
          if (!validation.valid) {
            endJson(res, validation.status, validation.body);
            return;
          }
          const count = validation.embeds?.length ?? 0;
          const titles = (validation.embeds ?? [])
            .map((embed) => (embed as { title?: unknown })?.title ?? "untitled")
            .join(" · ");
          if (!webhook || !webhook.startsWith("https://discord")) {
            server.config.logger.info(
              `[dev-feedback] received ${count} embed(s) (${titles}) but DISCORD_FEEDBACK_WEBHOOK is not set — add it to .env.local to deliver from dev`,
            );
            endJson(
              res,
              503,
              JSON.stringify({
                message: "Feedback is not configured — set DISCORD_FEEDBACK_WEBHOOK in .env.local to deliver locally.",
              }),
            );
            return;
          }
          const delivery = await sendToDiscord(webhook, raw);
          if (!delivery.ok) {
            server.config.logger.info(`[dev-feedback] Discord rejected the delivery (${delivery.status}).`);
            endJson(res, delivery.status, JSON.stringify({ message: "Discord rejected the feedback." }));
            return;
          }
          server.config.logger.info(`[dev-feedback] relayed ${count} embed(s) to Discord: ${titles}`);
          endJson(res, 200, JSON.stringify({ ok: true }));
        });
      });
    },
  };
}