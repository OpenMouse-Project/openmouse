import assert from "node:assert/strict";
import test from "node:test";

import { feedbackRelayHint, sendToDiscord, validateFeedbackRequest } from "./dev-feedback-plugin.ts";

test("validateFeedbackRequest accepts a POST carrying an embeds array", () => {
  const raw = JSON.stringify({ embeds: [{ title: "Hardware Test Report" }] });
  const validated = validateFeedbackRequest("POST", raw);
  assert.equal(validated.valid, true);
  assert.equal(validated.status, 200);
  assert.deepEqual(validated.embeds, [{ title: "Hardware Test Report" }]);
  assert.equal(validated.rawBody, raw);
});

test("validateFeedbackRequest rejects non-POST methods like the production relay", () => {
  assert.equal(validateFeedbackRequest("GET", "").valid, false);
  assert.equal(validateFeedbackRequest("GET", "").status, 405);
  assert.equal(validateFeedbackRequest("OPTIONS", "").status, 405);
  assert.equal(validateFeedbackRequest("PUT", "").status, 405);
});

test("validateFeedbackRequest rejects malformed JSON and bodies without an embeds array", () => {
  assert.equal(validateFeedbackRequest("POST", "").status, 400);
  assert.equal(validateFeedbackRequest("POST", "{nope").status, 400);
  assert.equal(validateFeedbackRequest("POST", "hello").status, 400);
  assert.equal(validateFeedbackRequest("POST", "{}").status, 400);
  assert.equal(validateFeedbackRequest("POST", JSON.stringify({ content: "hello" })).status, 400);
});

test("sendToDiscord reports an accepted delivery", async () => {
  let forwardedBody = "";
  const fakeFetch = (async (url: string, init: { body: string }) => {
    assert.equal(url, "https://discord.example/webhook");
    assert.equal(init.body, "{}");
    forwardedBody = init.body;
    return { ok: true, status: 204 } as Response;
  }) as unknown as typeof fetch;

  const result = await sendToDiscord("https://discord.example/webhook", "{}", fakeFetch);
  assert.deepEqual(result, { ok: true, status: 204 });
  assert.equal(forwardedBody, "{}");
});

test("sendToDiscord reports when Discord rejects the payload", async () => {
  const fakeFetch = (async () => ({ ok: false, status: 400 }) as Response) as unknown as typeof fetch;
  const result = await sendToDiscord("https://discord.example/webhook", "bad", fakeFetch);
  assert.deepEqual(result, { ok: false, status: 400 });
});

test("sendToDiscord maps network failures to 502", async () => {
  const fakeFetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const result = await sendToDiscord("https://discord.example/webhook", "{}", fakeFetch);
  assert.deepEqual(result, { ok: false, status: 502 });
});

test("feedbackRelayHint announces live delivery when the webhook is configured", () => {
  const hint = feedbackRelayHint("https://discord.com/api/webhooks/1/abc");
  assert.match(hint, /delivers to Discord/);
  assert.doesNotMatch(hint, /503/);
});

test("feedbackRelayHint tells the developer to configure the webhook when it is missing", () => {
  for (const webhook of [undefined, "", "https://example.com/not-discord"]) {
    const hint = feedbackRelayHint(webhook);
    assert.match(hint, /DISCORD_FEEDBACK_WEBHOOK/);
    assert.match(hint, /503/);
    assert.match(hint, /restart the dev server/);
  }
});