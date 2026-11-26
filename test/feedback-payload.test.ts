import assert from "node:assert/strict";
import test from "node:test";

import { feedbackPayload } from "../functions/_lib/feedback-payload.js";

test("feedbackPayload caps total embed text at 6000 chars", () => {
  const big = "x".repeat(4096);
  const over = { embeds: [{ description: big }, { description: big }] };
  assert.throws(() => feedbackPayload(over), /Embeds too long/);
  assert.ok(feedbackPayload({ embeds: [{ description: big }] }).embeds);
});

test("feedbackPayload caps embeds at 10 and fields at 25", () => {
  const embeds = Array.from({ length: 11 }, () => ({ title: "t" }));
  assert.throws(() => feedbackPayload({ embeds }), /Invalid embeds/);
  const fields = Array.from({ length: 26 }, (_, i) => ({ name: `f${i}`, value: "v" }));
  assert.throws(() => feedbackPayload({ embeds: [{ title: "t", fields }] }), /Invalid fields/);
});

test("feedbackPayload bounds color to a 24-bit integer", () => {
  assert.equal(feedbackPayload({ embeds: [{ title: "t", color: 0x123456 }] }).embeds[0].color, 0x123456);
  for (const color of [-1, 0x1000000, 1.5, "red"]) {
    assert.throws(() => feedbackPayload({ embeds: [{ title: "t", color }] }), /Invalid color/, String(color));
  }
});

test("feedbackPayload rejects unparseable timestamps and keeps valid ones", () => {
  const stamp = new Date("2026-01-02T03:04:05Z").toISOString();
  assert.equal(feedbackPayload({ embeds: [{ timestamp: stamp }] }).embeds[0].timestamp, stamp);
  assert.throws(() => feedbackPayload({ embeds: [{ timestamp: "not-a-date" }] }), /Invalid timestamp/);
});

test("feedbackPayload always resets allowed_mentions and ignores caller authority fields", () => {
  const body = feedbackPayload({
    content: "hi",
    username: "Admin",
    allowed_mentions: { parse: ["everyone"] },
    embeds: [{ title: "t" }],
  });
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal("username" in body, false);
});
